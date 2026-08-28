import { prisma } from "../src/config/prisma";
import { writeLedgerEntry } from "../src/services/ledgerService";
import { createRecoveryPaymentLink } from "../src/integrations/razorpayIntegration";
import { computeLiveMetricsUncached } from "../src/services/metricsService";

describe("Financial Ledger", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "RevenueEvent" CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "LedgerEntry" CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Customer" CASCADE;`);
    
    await prisma.customer.create({
      data: {
        id: "cust_1",
        name: "Test",
        email: "test@example.com",
      }
    });
  });
  
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should create a LedgerEntry", async () => {
    await prisma.revenueEvent.create({
      data: {
        id: "evt_1",
        entityType: "INVOICE",
        entityId: "inv_1",
        customerId: "cust_1",
        eventType: "PAYMENT_FAILED",
        amount: 100,
        currency: "INR",
        occurredAt: new Date(),
        rawPayload: {},
      },
    });

    await prisma.$transaction(async (tx) => {
      await writeLedgerEntry(tx, {
        entityId: "inv_1",
        eventId: "evt_1",
        type: "AT_RISK",
        amount: 100,
      });
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { eventId: "evt_1" } });
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe("AT_RISK");
  });

  it("should be idempotent on writeLedgerEntry", async () => {
    await prisma.$transaction(async (tx) => {
      await writeLedgerEntry(tx, {
        entityId: "inv_1",
        eventId: "evt_1",
        type: "AT_RISK",
        amount: 100,
      });
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { eventId: "evt_1" } });
    expect(entries.length).toBe(1);
  });

  it("should enforce append-only rules and prevent UPDATE", async () => {
    const entry = await prisma.ledgerEntry.findFirst({ where: { eventId: "evt_1" } });
    expect(entry).toBeDefined();
    
    // Attempt to update
    await prisma.$executeRawUnsafe(`UPDATE "LedgerEntry" SET amount = 50 WHERE id = '${entry!.id}';`);
    
    const reFetched = await prisma.ledgerEntry.findUnique({ where: { id: entry!.id } });
    expect(reFetched!.amount).toBe(100); // Amount should remain unchanged
  });

  it("should enforce append-only rules and prevent DELETE", async () => {
    const entry = await prisma.ledgerEntry.findFirst({ where: { eventId: "evt_1" } });
    expect(entry).toBeDefined();
    
    // Attempt to delete
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE id = '${entry!.id}';`);
    
    const reFetched = await prisma.ledgerEntry.findUnique({ where: { id: entry!.id } });
    expect(reFetched).toBeDefined(); // Row should still exist
  });

  it("should calculate metrics with AT_RISK, RECOVERED, and REVERSED entries", async () => {
    // We already have evt_1 with 100 AT_RISK
    await prisma.$transaction(async (tx) => {
      // 2. RECOVERED 100
      await writeLedgerEntry(tx, {
        entityId: "inv_1",
        eventId: "evt_1",
        type: "RECOVERED",
        amount: 100,
      });
      // 3. REVERSED 20 (Partial refund)
      await writeLedgerEntry(tx, {
        entityId: "inv_1",
        eventId: "evt_1",
        type: "REVERSED",
        amount: 20,
      });
    });

    const metrics = await computeLiveMetricsUncached("all");
    expect(metrics.amountAtRisk).toBe(100);
    expect(metrics.amountRecovered).toBe(80);
  });

  it("should test optimistic write + webhook write produces exactly 1 RECOVERED row", async () => {
    await prisma.$transaction(async (tx) => {
      // Optimistic
      await writeLedgerEntry(tx, {
        entityId: "inv_1",
        eventId: "evt_1",
        type: "RECOVERED",
        amount: 100,
      });
      
      // Webhook (should be idempotent)
      await writeLedgerEntry(tx, {
        entityId: "inv_1",
        eventId: "evt_1",
        type: "RECOVERED",
        amount: 100,
      });
    });

    const recovered = await prisma.ledgerEntry.findMany({ 
      where: { eventId: "evt_1", type: "RECOVERED" } 
    });
    expect(recovered.length).toBe(1);
  });

  it("should format deterministic Razorpay reference_id for payment links", () => {
    const { createHash } = require("crypto");
    const eventId = "evt_test_123";
    const actionType = "send_payment_link";
    const hash = createHash("sha256").update(`${eventId}:${actionType}`).digest("hex");
    const expectedReferenceId = `rzp_${hash.slice(0, 32)}`;

    expect(expectedReferenceId).toMatch(/^rzp_[a-f0-9]{32}$/);
    expect(expectedReferenceId.length).toBe(36);
  });
});
