import { prisma } from "../src/config/prisma";
import {
  RAZORPAY_ERROR_REASONS,
  randomRazorpayErrorReason,
} from "../src/simulator/razorpayErrorReasons";
import { seedEntities } from "../src/simulator/seedEntities";
import { injectFailure } from "../src/simulator/injectFailure";
import { replayBatch } from "../src/simulator";

describe("Phase 3 - Simulator & Seed Data", () => {
  beforeAll(async () => {
    // Seed DB for tests
    await seedEntities({ customers: 50 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("3.1 - seedEntities", () => {
    it("populates the database with customers, invoices, carts, and subscriptions", async () => {
      const customerCount = await prisma.customer.count();
      expect(customerCount).toBeGreaterThanOrEqual(50);

      const invoiceCount = await prisma.invoice.count();
      const cartCount = await prisma.cart.count();
      const subscriptionCount = await prisma.subscription.count();

      expect(invoiceCount).toBeGreaterThan(0);
      expect(cartCount).toBeGreaterThan(0);
      expect(subscriptionCount).toBeGreaterThan(0);
    });

    it("includes deliberate DNC and dispute flag fixtures", async () => {
      const dncCustomers = await prisma.customer.count({
        where: { dncFlag: true },
      });
      const disputedInvoices = await prisma.invoice.count({
        where: { disputeFlag: true },
      });

      expect(dncCustomers).toBeGreaterThan(0);
      expect(disputedInvoices).toBeGreaterThan(0);
    });
  });

  describe("3.2 - razorpayErrorReasons taxonomy", () => {
    it("contains documented error reason codes and valid random selection", () => {
      expect(RAZORPAY_ERROR_REASONS.length).toBeGreaterThan(0);

      const reasons = RAZORPAY_ERROR_REASONS.map((r) => r.errorReason);
      expect(reasons).toContain("insufficient_fund");
      expect(reasons).toContain("payment_timed_out");
      expect(reasons).toContain("card_expired");

      const randomReason = randomRazorpayErrorReason();
      expect(randomReason).toHaveProperty("errorCode");
      expect(randomReason).toHaveProperty("errorReason");
      expect(randomReason).toHaveProperty("errorDescription");
    });
  });

  describe("3.3 - injectFailure", () => {
    it("creates a payment_failed event matching Razorpay webhook shape", async () => {
      const batch = await prisma.batch.create({
        data: { eventCount: 1, amountAtRisk: 100 },
      });
      const customer = await prisma.customer.findFirst({
        where: { invoices: { some: { status: "open" } } },
      });
      expect(customer).not.toBeNull();

      const event = await injectFailure(
        batch.id,
        "payment_failed",
        customer!.id,
      );

      expect(event.eventType).toBe("PAYMENT_FAILED");
      expect(event.errorReason).toBeDefined();
      expect(
        RAZORPAY_ERROR_REASONS.some((r) => r.errorReason === event.errorReason),
      ).toBe(true);

      expect(event.razorpayPaymentId).toMatch(/^pay_sim_/);
      expect(event.razorpayOrderId).toMatch(/^order_sim_/);

      // Verify DB row has riskScore and urgency as null
      const dbRow = await prisma.revenueEvent.findUnique({
        where: { id: event.id },
      });
      expect(dbRow).not.toBeNull();
      expect(dbRow!.riskScore).toBeNull();
      expect(dbRow!.urgency).toBeNull();

      // Verify rawPayload shape
      const payload = event.rawPayload as any;
      expect(payload.event).toBe("payment.failed");
      expect(payload.payload.payment.id).toBe(event.razorpayPaymentId);
      expect(payload.payload.payment.error_reason).toBe(event.errorReason);
    });

    it("creates checkout_abandoned, invoice_overdue, and subscription_failed events", async () => {
      const batch = await prisma.batch.create({
        data: { eventCount: 3, amountAtRisk: 300 },
      });

      const customer = await prisma.customer.findFirst({
        where: {
          carts: { some: {} },
          invoices: { some: { status: "open" } },
          subscriptions: { some: { status: "active" } },
        },
      });
      expect(customer).not.toBeNull();

      const abandoned = await injectFailure(
        batch.id,
        "checkout_abandoned",
        customer!.id,
      );
      expect(abandoned.eventType).toBe("CHECKOUT_ABANDONED");
      expect(
        (abandoned.rawPayload as any).hoursSinceAbandon,
      ).toBeDefined();

      const overdue = await injectFailure(
        batch.id,
        "invoice_overdue",
        customer!.id,
      );
      expect(overdue.eventType).toBe("INVOICE_OVERDUE");
      expect((overdue.rawPayload as any).daysOverdue).toBeDefined();

      const subFailed = await injectFailure(
        batch.id,
        "subscription_failed",
        customer!.id,
      );
      expect(subFailed.eventType).toBe("SUBSCRIPTION_FAILED");
      expect(
        (subFailed.rawPayload as any).razorpay_subscription_id,
      ).toBeDefined();
    });
  });

  describe("3.4 - replayBatch", () => {
    it("generates a batch of 20 events with specified mix offline", async () => {
      const mix = {
        paymentFailed: 0.4,
        checkoutAbandoned: 0.3,
        invoiceOverdue: 0.2,
        subscriptionFailed: 0.1,
      };

      const result = await replayBatch({ size: 20, mix });
      expect(result.batchId).toBeDefined();

      const batch = await prisma.batch.findUnique({
        where: { id: result.batchId },
      });
      expect(batch).not.toBeNull();
      expect(batch!.eventCount).toBe(20);
      expect(batch!.status).toBe("completed");

      const events = await prisma.revenueEvent.findMany({
        where: { batchId: result.batchId },
      });
      expect(events.length).toBe(20);

      const typeCounts = events.reduce(
        (acc, e) => {
          acc[e.eventType] = (acc[e.eventType] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      expect(typeCounts.PAYMENT_FAILED).toBe(8);
      expect(typeCounts.CHECKOUT_ABANDONED).toBe(6);
      expect(typeCounts.INVOICE_OVERDUE).toBe(4);
      expect(typeCounts.SUBSCRIPTION_FAILED).toBe(2);
    });
  });
});
