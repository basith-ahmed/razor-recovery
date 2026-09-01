/**
 * Tests for the partner ingestion endpoint (POST /api/v1/events):
 * API-key auth, envelope validation → field errors, idempotent replay
 * semantics, key-reuse conflicts, and the typed ingest result.
 */

jest.mock("../src/kafka/producer", () => ({
  publish: jest.fn(),
  connectProducer: jest.fn(),
  disconnectProducer: jest.fn(),
}));

import http from "http";
import { AddressInfo } from "net";
import { server } from "../src/api/server";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { redis } from "../src/config/redis";
import { publish } from "../src/kafka/producer";
import { TOPICS } from "../src/kafka/topics";

const API_KEY = env.PARTNER_API_KEY;

function cartEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    type: "cart",
    idempotencyKey: `api_cart_${crypto.randomUUID().slice(0, 8)}`,
    occurredAt: new Date().toISOString(),
    customer: { name: "Ingest Tester", email: `ingest.${crypto.randomUUID().slice(0, 8)}@example.test` },
    cart: {
      ref: `cart_api_${crypto.randomUUID().slice(0, 8)}`,
      amount: 2450,
      currency: "INR",
      abandonedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
      items: [{ sku: "pro-plan", name: "Pro plan", quantity: 1, unitPrice: 2450 }],
    },
    ...overrides,
  };
}

describe("Partner ingestion endpoint — POST /api/v1/events", () => {
  let baseUrl: string;
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    const ingestKeys = await redis.keys("razorrecovery:ingest:*");
    if (ingestKeys.length > 0) {
      await redis.del(...ingestKeys);
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects requests without an API key with HTTP 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cartEnvelope()),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("INVALID_API_KEY");
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong API key with HTTP 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "wrong-key" },
      body: JSON.stringify(cartEnvelope()),
    });
    expect(res.status).toBe(401);
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns field-level validation errors with HTTP 400 for an invalid envelope", async () => {
    const bad = cartEnvelope({ cart: { ref: "cart_bad" } });
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify(bad),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("INVALID_ENVELOPE");
    const fields = data.fields as Array<{ field: string; message: string }>;
    expect(fields.some((f) => f.field.startsWith("cart.amount"))).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it("ingests a valid cart envelope and returns the typed result", async () => {
    const envelope = cartEnvelope();
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify(envelope),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.deduped).toBe(false);
    expect(data.eventType).toBe("CHECKOUT_ABANDONED");

    const cartRow = await prisma.cart.findUnique({ where: { id: envelope.cart.ref } });
    expect(cartRow).toBeDefined();
    expect(cartRow!.amount).toBe(2450);

    const customerRow = await prisma.customer.findUnique({
      where: { email: envelope.customer.email },
    });
    expect(customerRow).toBeDefined();

    expect(publish).toHaveBeenCalledWith(
      TOPICS.EVENTS_RAW,
      data.eventId,
      expect.objectContaining({
        id: data.eventId,
        eventType: "CHECKOUT_ABANDONED",
        entityId: envelope.cart.ref,
      }),
    );

    // Cleanup: scoped to rows this test created
    await prisma.cart.deleteMany({ where: { id: envelope.cart.ref } });
    await prisma.customer.deleteMany({ where: { email: envelope.customer.email } });
  });

  it("treats an exact replay of the same idempotency key as idempotent success", async () => {
    const envelope = cartEnvelope();
    const first = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify(envelope),
    });
    expect(first.status).toBe(200);
    const firstData = await first.json();

    const publishesBefore = (publish as jest.Mock).mock.calls.length;
    const second = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify(envelope),
    });
    expect(second.status).toBe(200);
    const secondData = await second.json();
    expect(secondData.deduped).toBe(true);
    expect(secondData.eventId).toBe(firstData.eventId);
    expect((publish as jest.Mock).mock.calls.length).toBe(publishesBefore);
  });

  it("rejects reuse of an idempotency key with different payload as HTTP 409", async () => {
    const envelopeA = cartEnvelope();
    await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify(envelopeA),
    });

    const envelopeB = cartEnvelope({ idempotencyKey: envelopeA.idempotencyKey });
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify(envelopeB),
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("DUPLICATE_EVENT_CONFLICT");
  });
});
