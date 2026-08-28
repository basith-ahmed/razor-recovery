import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";
import { server } from "../src/api/server";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { seedEntities } from "../src/simulator/seedEntities";
import { verifyWebhookSignature } from "../src/api/webhooks/razorpayWebhook";
import { emitLiveUpdate } from "../src/api/websocket";

describe("Phase 8 — API Layer: REST + WebSocket Server", () => {
  let baseUrl: string;
  let port: number;

  beforeAll(async () => {
    // Seed test entities if DB has fewer customers than this suite needs
    const customerCount = await prisma.customer.count();
    if (customerCount < 5) {
      await seedEntities({ customers: 20 });
    }

    // Create a few events so list/detail/metrics endpoints always have data.
    // Direct DB setup: these tests exercise the HTTP layer, not ingestion.
    const customers = await prisma.customer.findMany({ take: 5 });
    const eventTypes = [
      "PAYMENT_FAILED",
      "CHECKOUT_ABANDONED",
      "INVOICE_OVERDUE",
      "SUBSCRIPTION_FAILED",
      "PAYMENT_FAILED",
    ] as const;
    for (let i = 0; i < customers.length; i++) {
      await prisma.revenueEvent.create({
        data: {
          entityType: "CUSTOMER",
          entityId: customers[i].id,
          customerId: customers[i].id,
          eventType: eventTypes[i],
          amount: 1000 + i,
          currency: "INR",
          occurredAt: new Date(),
          rawPayload: { event: "test.fixture", index: i },
        },
      });
    }

    // Start server on an ephemeral port
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
    await prisma.$disconnect();
  });

  describe("8.1 & Healthcheck", () => {
    it("returns HTTP 200 for GET /health", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: "ok", service: "razorrecovery-backend" });
    });
  });

  describe("8.2 — Routes", () => {
    describe("GET /entities & GET /entities/:id/audit", () => {
      it("returns a filterable/sortable paginated list of entities", async () => {
        const res = await fetch(`${baseUrl}/entities?sort=amount_desc`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          items: Array<{ id: string; entityId: string; amount: number; customerName: string; state: string }>;
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };

        expect(Array.isArray(data.items)).toBe(true);
        expect(typeof data.total).toBe("number");
        expect(typeof data.page).toBe("number");
        expect(typeof data.limit).toBe("number");
        expect(typeof data.totalPages).toBe("number");
        if (data.items.length > 1) {
          expect(data.items[0].amount).toBeGreaterThanOrEqual(data.items[1].amount);
        }
      });

      it("supports filtering by eventType, search term, and window", async () => {
        const res = await fetch(
          `${baseUrl}/entities?eventType=PAYMENT_FAILED&window=all`,
        );
        expect(res.status).toBe(200);
        const data = (await res.json()) as { items: Array<{ eventType: string }> };
        expect(Array.isArray(data.items)).toBe(true);
        data.items.forEach((e) => expect(e.eventType).toBe("PAYMENT_FAILED"));
      });

      it("returns ordered audit entries for an entity", async () => {
        const sampleEvent = await prisma.revenueEvent.findFirst();
        expect(sampleEvent).not.toBeNull();

        const res = await fetch(`${baseUrl}/entities/${sampleEvent!.entityId}/audit`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as unknown[];
        expect(Array.isArray(data)).toBe(true);
      });
    });

    describe("GET /metrics/summary & GET /metrics/trend", () => {
      it("returns exact §8.4 metrics summary shape for a window", async () => {
        const res = await fetch(`${baseUrl}/metrics/summary?window=all`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          window: string;
          amountAtRisk: number;
          amountRecovered: number;
          recoveryRate: number;
          eventsProcessed: number;
          funnel: Array<{ stage: string; count: number }>;
          byCause: Array<{ cause: string; recovered: number; atRisk: number }>;
          byChannel: Array<{ channel: string; count: number; recoveredAmount: number }>;
          medianTimeToRecoveryHours: number;
          compliance: { dncBlocked: number; autoEscalated: number; cooldownStopped: number };
        };

        expect(data.window).toBe("all");
        expect(data).not.toHaveProperty("batchId");
        expect(data).not.toHaveProperty("eventsTotal");
        expect(typeof data.amountAtRisk).toBe("number");
        expect(typeof data.amountRecovered).toBe("number");
        expect(typeof data.recoveryRate).toBe("number");
        expect(typeof data.eventsProcessed).toBe("number");

        expect(Array.isArray(data.funnel)).toBe(true);
        expect(data.funnel.map((f) => f.stage)).toEqual([
          "detected",
          "diagnosed",
          "contacted",
          "recovered",
        ]);

        expect(Array.isArray(data.byCause)).toBe(true);
        expect(Array.isArray(data.byChannel)).toBe(true);

        const channelNames = data.byChannel.map((c) => c.channel);
        expect(channelNames).toEqual(["razorpay", "email", "human"]);

        expect(typeof data.medianTimeToRecoveryHours).toBe("number");
        expect(data.compliance).toHaveProperty("dncBlocked");
        expect(data.compliance).toHaveProperty("autoEscalated");
        expect(data.compliance).toHaveProperty("cooldownStopped");
      });

      it("returns trend points from GET /metrics/trend", async () => {
        const res = await fetch(`${baseUrl}/metrics/trend?window=24h&bucket=hour`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as Array<{
          bucketStart: string;
          eventsProcessed: number;
          amountRecovered: number;
        }>;
        expect(Array.isArray(data)).toBe(true);
        if (data.length > 0) {
          expect(typeof data[0].bucketStart).toBe("string");
          expect(typeof data[0].eventsProcessed).toBe("number");
          expect(typeof data[0].amountRecovered).toBe("number");
        }
      });
    });

    describe("GET /policy", () => {
      it("returns live policy.json, paginated DNC list, and paginated compliance log", async () => {
        const res = await fetch(`${baseUrl}/policy`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          policy: { version: string; rules: unknown[] };
          dncList: {
            entries: Array<{ id: string }>;
            total: number;
            page: number;
            limit: number;
            totalPages: number;
          };
          complianceLog: { entries: unknown[]; total: number; page: number; limit: number; totalPages: number };
        };

        expect(data.policy).toHaveProperty("version");
        expect(Array.isArray(data.policy.rules)).toBe(true);

        expect(Array.isArray(data.dncList.entries)).toBe(true);
        expect(typeof data.dncList.total).toBe("number");
        expect(data.dncList.total).toBeGreaterThanOrEqual(data.dncList.entries.length);
        expect(typeof data.dncList.page).toBe("number");
        expect(typeof data.dncList.limit).toBe("number");
        expect(typeof data.dncList.totalPages).toBe("number");

        expect(typeof data.complianceLog.total).toBe("number");
        expect(Array.isArray(data.complianceLog.entries)).toBe(true);
        expect(data.complianceLog.total).toBeGreaterThanOrEqual(data.complianceLog.entries.length);
        expect(typeof data.complianceLog.totalPages).toBe("number");
      });
    });
  });

  describe("8.3 — POST /webhooks/razorpay", () => {
    it("rejects webhook requests with invalid or missing signature with HTTP 400", async () => {
      const res = await fetch(`${baseUrl}/webhooks/razorpay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "payment.captured" }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Invalid webhook signature");
    });

    it("verifies signature utility correctly", () => {
      const payloadStr = JSON.stringify({ event: "payment.captured", test: true });
      const secret = env.RAZORPAY_WEBHOOK_SECRET;
      const validSignature = crypto
        .createHmac("sha256", secret)
        .update(payloadStr)
        .digest("hex");

      expect(verifyWebhookSignature(payloadStr, validSignature, secret)).toBe(true);
      expect(verifyWebhookSignature(payloadStr, "invalid-sig", secret)).toBe(false);
    });

    it("resets entity memory on confirmed recovery (per-cause attempts + cooldowns)", async () => {
      // Arrange: an entity mid-recovery-arc with burned budgets on TWO causes
      const customer = await prisma.customer.findFirstOrThrow();
      const entityId = `entity-reset-${crypto.randomUUID().slice(0, 8)}`;
      const paymentId = `pay_reset_${crypto.randomUUID().slice(0, 8)}`;

      const event = await prisma.revenueEvent.create({
        data: {
          entityType: "INVOICE",
          entityId,
          customerId: customer.id,
          eventType: "PAYMENT_FAILED",
          amount: 999,
          currency: "INR",
          occurredAt: new Date(),
          razorpayPaymentId: paymentId,
          rawPayload: { event: "payment.failed" },
        },
      });
      await prisma.action.create({
        data: {
          eventId: event.id,
          actionType: "send_reminder_email",
          result: "success",
          integration: "EMAIL",
        },
      });
      await prisma.entityWorkflowState.create({
        data: {
          entityId,
          customerId: customer.id,
          state: "RETRYING",
        },
      });
      await prisma.entityCauseState.create({
        data: {
          entityId,
          causeLabel: "gateway_timeout",
          attemptCount: 2,
          lastContactedAt: new Date(),
          cooldownUntil: new Date(Date.now() + 3600 * 1000),
        },
      });
      await prisma.entityCauseState.create({
        data: {
          entityId,
          causeLabel: "insufficient_funds",
          attemptCount: 1,
          lastContactedAt: new Date(),
        },
      });

      const payloadObj = {
        event: "payment.captured",
        payload: {
          payment: {
            entity: { id: paymentId, order_id: `order_${paymentId}`, amount: 99900 },
          },
        },
      };
      const payloadStr = JSON.stringify(payloadObj);
      const signature = crypto
        .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
        .update(payloadStr)
        .digest("hex");

      // Act
      const res = await fetch(`${baseUrl}/webhooks/razorpay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: payloadStr,
      });

      // Assert
      expect(res.status).toBe(200);
      const state = await prisma.entityWorkflowState.findUniqueOrThrow({
        where: { entityId },
      });
      expect(state.state).toBe("RECOVERED");
      // Arc closure wipes ALL per-cause budgets, not just the resolving one
      const remainingCauseState = await prisma.entityCauseState.findMany({
        where: { entityId },
      });
      expect(remainingCauseState).toEqual([]);

      // Cleanup
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "RevenueEvent" CASCADE;`);
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "LedgerEntry" CASCADE;`);
    });

    it("processes validly-signed payment.captured webhook correctly", async () => {
      const payloadObj = {
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_test_webhook_123",
              order_id: "order_test_123",
              amount: 500,
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payloadObj);
      const secret = env.RAZORPAY_WEBHOOK_SECRET;
      const signature = crypto
        .createHmac("sha256", secret)
        .update(payloadStr)
        .digest("hex");

      const res = await fetch(`${baseUrl}/webhooks/razorpay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: payloadStr,
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; processed: boolean };
      expect(data.status).toBe("ok");
      expect(data.processed).toBe(true);
    });
  });

  describe("8.4 — WebSockets & emitLiveUpdate", () => {
    it("can invoke emitLiveUpdate without errors", async () => {
      await expect(emitLiveUpdate()).resolves.not.toThrow();
    });
  });

  describe("Phase 12 — Audit Chain Verification Endpoint", () => {
    it("GET /audit/verify returns verification status and count", async () => {
      const res = await fetch(`${baseUrl}/audit/verify`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { valid: boolean; entriesChecked: number };
      expect(typeof data.valid).toBe("boolean");
      expect(typeof data.entriesChecked).toBe("number");
    });

    it("GET /audit/verify returns 400 on invalid sequence parameter", async () => {
      const res = await fetch(`${baseUrl}/audit/verify?fromSequence=invalid`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Invalid sequence number parameter");
    });
  });
});
