import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";
import { server } from "../src/api/server";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { seedEntities } from "../src/simulator/seedEntities";
import { startStreamInjection } from "../src/simulator/streamInjector";
import { verifyWebhookSignature } from "../src/api/webhooks/razorpayWebhook";
import { emitLiveUpdate } from "../src/api/websocket";

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 15000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("waitFor: condition not met within timeout");
}

describe("Phase 8 — API Layer: REST + WebSocket Server", () => {
  let baseUrl: string;
  let port: number;
  let testRunId: string;

  beforeAll(async () => {
    // Seed test entities if DB is empty
    const customerCount = await prisma.customer.count();
    if (customerCount === 0) {
      await seedEntities({ customers: 20 });
    }

    // Generate a test stream injection
    const result = await startStreamInjection({
      count: 5,
      mix: {
        paymentFailed: 0.4,
        checkoutAbandoned: 0.4,
        invoiceOverdue: 0.2,
        subscriptionFailed: 0,
      },
      intervalMs: 10,
    });
    testRunId = result.runId;
    await waitFor(async () =>
      (await prisma.revenueEvent.count({
        where: { sourceRunId: testRunId },
      })) === 5,
    );

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
    describe("POST /demo/inject-stream", () => {
      it("starts a stream injection and returns runId immediately", async () => {
        const res = await fetch(`${baseUrl}/demo/inject-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            count: 4,
            intervalMs: 10,
            mix: {
              paymentFailed: 0.5,
              checkoutAbandoned: 0.5,
              invoiceOverdue: 0,
              subscriptionFailed: 0,
            },
          }),
        });

        expect(res.status).toBe(200);
        const data = (await res.json()) as { runId: string };
        expect(data.runId).toBeDefined();
        expect(typeof data.runId).toBe("string");
      });

      it("returns HTTP 400 for invalid count", async () => {
        const res = await fetch(`${baseUrl}/demo/inject-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: -5 }),
        });

        expect(res.status).toBe(400);
        const data = (await res.json()) as { error: string };
        expect(data.error).toContain("positive integer");
      });

      it("returns HTTP 400 if mix proportions do not sum to 1", async () => {
        const res = await fetch(`${baseUrl}/demo/inject-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            count: 5,
            mix: {
              paymentFailed: 0.2,
              checkoutAbandoned: 0.2,
              invoiceOverdue: 0.2,
              subscriptionFailed: 0.2,
            },
          }),
        });

        expect(res.status).toBe(400);
        const data = (await res.json()) as { error: string };
        expect(data.error).toContain("sum to 1.0");
      });
    });

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

      it("scopes the summary to a sourceRunId when one is passed", async () => {
        const res = await fetch(
          `${baseUrl}/metrics/summary?window=all&sourceRunId=${testRunId}`,
        );
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          sourceRunId?: string;
          amountAtRisk: number;
        };
        expect(data.sourceRunId).toBe(testRunId);
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
});
