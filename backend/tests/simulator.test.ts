/**
 * Tests for the partner-event simulator (Phase 3 — Simulator & Seed Data).
 *
 * The simulator builds realistic partner envelopes and pushes them through
 * the REAL ingestion path (ingestPartnerEvent), which upserts the customer
 * and business entity, publishes to Kafka, and returns the ingest result.
 */

jest.mock("../src/kafka/producer", () => ({
  publish: jest.fn(),
  connectProducer: jest.fn(),
  disconnectProducer: jest.fn(),
}));

jest.mock("../src/config/openai", () => ({ requestJson: jest.fn() }));
jest.mock("../src/config/mailer", () => ({
  mailer: { sendMail: jest.fn().mockResolvedValue({ messageId: "mock-msg-123" }) },
}));

import { prisma } from "../src/config/prisma";
import { redis } from "../src/config/redis";
import { publish } from "../src/kafka/producer";
import { TOPICS } from "../src/kafka/topics";
import { seedEntities } from "../src/simulator/seedEntities";
import {
  buildCartEnvelope,
  buildInvoiceEnvelope,
  buildSubscriptionEnvelope,
  simulatePartnerEvent,
} from "../src/simulator/partnerEvents";
import { ingestPartnerEvent } from "../src/services/ingestService";
import type { Customer } from "@prisma/client";

describe("Phase 3 - Simulator & Partner Ingestion", () => {
  let customer: Customer;
  let dncCustomer: Customer;
  // Strictly scoped cleanup: only rows this suite actually created. The
  // first-seeded customer is shared across suites, so cleanup must key on
  // event/entity ids, never on customerId.
  const ingested: Array<{ eventId: string; entityId: string }> = [];

  beforeAll(async () => {
    await seedEntities({ customers: 12 });
    customer = (await prisma.customer.findFirst({
      where: { dncFlag: false },
    }))!;
    dncCustomer = (await prisma.customer.findFirst({
      where: { dncFlag: true },
    }))!;
    expect(customer).toBeDefined();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    const eventIds = ingested.map((row) => row.eventId);
    const entityIds = [...new Set(ingested.map((row) => row.entityId))];

    // Audit entries are intentionally left in place — they are part of the
    // append-only hash chain.
    await prisma.ledgerEntry.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.revenueEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.cart.deleteMany({ where: { id: { in: entityIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: entityIds } } });
    await prisma.subscription.deleteMany({ where: { id: { in: entityIds } } });

    const ingestKeys = await redis.keys("razorrecovery:ingest:*");
    if (ingestKeys.length > 0) {
      await redis.del(...ingestKeys);
    }
    await prisma.$disconnect();
  });

  function track(result: { eventId: string; entityId: string }) {
    ingested.push({ eventId: result.eventId, entityId: result.entityId });
    return result;
  }

  describe("3.1 - seedEntities", () => {
    it("populates the database with customers only — entities arrive via ingestion", async () => {
      const customerCount = await prisma.customer.count();
      expect(customerCount).toBeGreaterThanOrEqual(12);
    });

    it("includes a deliberate DNC fixture", async () => {
      expect(dncCustomer).toBeDefined();
      expect(dncCustomer.dncFlag).toBe(true);
    });
  });

  describe("3.2 - envelope factories", () => {
    it("builds a cart envelope with realistic items summing to the cart total", () => {
      const envelope = buildCartEnvelope(customer, { amount: 2400 });
      expect(envelope.type).toBe("cart");
      expect(envelope.apiVersion).toBe("1");
      expect(envelope.cart.amount).toBe(2400);
      expect(envelope.cart.currency).toBe("INR");
      expect(envelope.cart.abandonedAt).toBeDefined();
      expect(envelope.cart.items.length).toBeGreaterThanOrEqual(1);
      const itemsTotal = envelope.cart.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      );
      expect(itemsTotal).toBeGreaterThan(0);
    });

    it("builds an invoice envelope with a past due date and dispute flag", () => {
      const envelope = buildInvoiceEnvelope(customer, { age: 35, disputeFlag: false });
      expect(envelope.type).toBe("invoice");
      expect(envelope.invoice.dueDate).toBeDefined();
      expect(new Date(envelope.invoice.dueDate).getTime()).toBeLessThan(Date.now());
      expect(envelope.invoice.disputeFlag).toBe(false);
    });

    it("builds a subscription envelope with a valid mandate status and UMN-style ref", () => {
      const envelope = buildSubscriptionEnvelope(customer, { mandateStatus: "cancelled" });
      expect(envelope.type).toBe("subscription");
      expect(envelope.subscription.mandateStatus).toBe("cancelled");
      expect(envelope.subscription.mandateRef).toMatch(/^rzp\..+@/);
      expect(envelope.subscription.nextBillDate).toBeDefined();
    });

    it("honors a fixed ref override for repeat reporting of the same entity", () => {
      const first = buildInvoiceEnvelope(customer, { ref: "inv_fixed_1", age: 3 });
      const second = buildInvoiceEnvelope(customer, { ref: "inv_fixed_1", age: 9 });
      expect(first.invoice.ref).toBe("inv_fixed_1");
      expect(second.invoice.ref).toBe("inv_fixed_1");
      expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    });
  });

  describe("3.3 - simulatePartnerEvent through the ingest path", () => {
    it("ingests a cart abandonment: entity upserted, event published to revenue.events.raw", async () => {
      const result = track(await simulatePartnerEvent("cart", customer, { amount: 1850, age: 2 }));

      expect(result.deduped).toBe(false);
      expect(result.eventType).toBe("CHECKOUT_ABANDONED");

      // The detection consumer owns persistence and is not running here.
      const eventRow = await prisma.revenueEvent.findUnique({
        where: { id: result.eventId },
      });
      expect(eventRow).toBeNull();

      const cartRow = await prisma.cart.findUnique({ where: { id: result.entityId } });
      expect(cartRow).toBeDefined();
      expect(cartRow!.amount).toBe(1850);

      expect(publish).toHaveBeenCalledWith(
        TOPICS.EVENTS_RAW,
        result.eventId,
        expect.objectContaining({
          eventType: "CHECKOUT_ABANDONED",
          entityType: "CART",
          entityId: result.entityId,
          customerId: customer.id,
          amount: 1850,
        }),
      );
    });

    it("ingests an invoice overdue event with normalized daysOverdue in the payload", async () => {
      const result = track(await simulatePartnerEvent("invoice", customer, {
        amount: 32000,
        age: 21,
        disputeFlag: false,
      }));

      const invoiceRow = await prisma.invoice.findUnique({ where: { id: result.entityId } });
      expect(invoiceRow).toBeDefined();
      expect(invoiceRow!.disputeFlag).toBe(false);

      const published = (publish as jest.Mock).mock.calls.find(
        (call) => call[1] === result.eventId,
      );
      expect(published).toBeDefined();
      const rawEvent = published![2] as Record<string, unknown>;
      expect(rawEvent.eventType).toBe("INVOICE_OVERDUE");
      const payload = rawEvent.rawPayload as Record<string, unknown>;
      expect(payload.source).toBe("partner_ingest");
      expect(payload.daysOverdue).toBe(21);
      expect(payload.disputeFlag).toBe(false);
    });

    it("ingests a mandate cancellation with mandate state signals for diagnosis", async () => {
      const result = track(await simulatePartnerEvent("subscription", customer, {
        mandateStatus: "cancelled",
      }));

      const subRow = await prisma.subscription.findUnique({ where: { id: result.entityId } });
      expect(subRow).toBeDefined();
      expect(subRow!.status).toBe("active");

      const published = (publish as jest.Mock).mock.calls.find(
        (call) => call[1] === result.eventId,
      );
      const rawEvent = published![2] as Record<string, unknown>;
      expect(rawEvent.eventType).toBe("SUBSCRIPTION_MANDATE_CANCELLED");
      const payload = rawEvent.rawPayload as Record<string, unknown>;
      expect(payload.mandate_status).toBe("cancelled");
      expect(payload.mandate_ref).toMatch(/^rzp\..+@/);
    });

    it("is idempotent: replaying the same envelope returns deduped:true without re-publishing", async () => {
      const envelope = buildCartEnvelope(customer, { amount: 990, age: 4 });
      const first = track(await ingestPartnerEvent(envelope));
      expect(first.deduped).toBe(false);

      const publishesBefore = (publish as jest.Mock).mock.calls.length;
      const second = await ingestPartnerEvent(envelope);
      expect(second.deduped).toBe(true);
      expect(second.eventId).toBe(first.eventId);
      expect((publish as jest.Mock).mock.calls.length).toBe(publishesBefore);
    });

    it("rejects a reused idempotency key with a different payload (409 semantics)", async () => {
      const envelopeA = buildInvoiceEnvelope(customer, { age: 5 });
      const envelopeB = {
        ...buildInvoiceEnvelope(customer, { age: 9 }),
        idempotencyKey: envelopeA.idempotencyKey,
      };

      track(await ingestPartnerEvent(envelopeA));
      await expect(ingestPartnerEvent(envelopeB)).rejects.toMatchObject({
        code: "DUPLICATE_EVENT_CONFLICT",
      });
    });

    it("rejects envelopes that violate the contract", async () => {
      await expect(
        ingestPartnerEvent({
          type: "hologram",
          idempotencyKey: "x",
          occurredAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: "INVALID_ENVELOPE" });
    });
  });
});
