import { prisma } from "../src/config/prisma";
import {
  writeChainedAuditEntry,
  verifyChain,
} from "../src/services/auditService";
import { GENESIS_HASH } from "../src/domain/hashChain";

describe("Tamper-Evident Audit Hash Chain Integration Tests", () => {
  let testCustomerId: string;
  let testEventId1: string;
  let testEventId2: string;
  let testEventId3: string;

  beforeAll(async () => {
    // Reset AuditEntry and AuditChainHead to pristine state for test isolation
    await prisma.auditEntry.deleteMany({});
    await prisma.auditChainHead.upsert({
      where: { id: 1 },
      create: { id: 1, hash: GENESIS_HASH },
      update: { hash: GENESIS_HASH },
    });

    // Create a customer and events for test linkage
    const customer = await prisma.customer.create({
      data: {
        name: "Hash Chain Test User",
        email: `hashchain-${Date.now()}@test.com`,
        phone: "9876543210",
      },
    });
    testCustomerId = customer.id;

    const evt1 = await prisma.revenueEvent.create({
      data: {
        customerId: testCustomerId,
        entityType: "CUSTOMER",
        entityId: testCustomerId,
        eventType: "PAYMENT_FAILED",
        amount: 1000,
        rawPayload: { test: true },
      },
    });
    testEventId1 = evt1.id;

    const evt2 = await prisma.revenueEvent.create({
      data: {
        customerId: testCustomerId,
        entityType: "CUSTOMER",
        entityId: testCustomerId,
        eventType: "PAYMENT_FAILED",
        amount: 2000,
        rawPayload: { test: true },
      },
    });
    testEventId2 = evt2.id;

    const evt3 = await prisma.revenueEvent.create({
      data: {
        customerId: testCustomerId,
        entityType: "CUSTOMER",
        entityId: testCustomerId,
        eventType: "PAYMENT_FAILED",
        amount: 3000,
        rawPayload: { test: true },
      },
    });
    testEventId3 = evt3.id;
  });

  afterAll(async () => {
    // Cleanup created test records
    await prisma.auditEntry.deleteMany({
      where: {
        eventId: { in: [testEventId1, testEventId2, testEventId3] },
      },
    });
    await prisma.revenueEvent.deleteMany({
      where: {
        id: { in: [testEventId1, testEventId2, testEventId3] },
      },
    });
    await prisma.customer.delete({
      where: { id: testCustomerId },
    });
  });

  it("should write sequentially chained audit entries with unbroken prevHash/hash pairs", async () => {
    const entry1 = await prisma.$transaction((tx) =>
      writeChainedAuditEntry(tx, {
        eventId: testEventId1,
        entityId: testCustomerId,
        actor: "system",
        inputSnapshot: { amount: 1000 },
        diagnosisSnapshot: { causeLabel: "insufficient_funds" },
        decisionSnapshot: { chosenAction: "send_payment_link" },
        actionSnapshot: { result: "success" },
        outcome: "pending",
      }),
    );

    const entry2 = await prisma.$transaction((tx) =>
      writeChainedAuditEntry(tx, {
        eventId: testEventId2,
        entityId: testCustomerId,
        actor: "system",
        inputSnapshot: { amount: 2000 },
        diagnosisSnapshot: { causeLabel: "card_expired" },
        decisionSnapshot: { chosenAction: "send_reminder_email" },
        actionSnapshot: { result: "success" },
        outcome: "pending",
      }),
    );

    expect(entry1.sequenceNumber).toBeLessThan(entry2.sequenceNumber);
    expect(entry2.prevHash).toBe(entry1.hash);

    const head = await prisma.auditChainHead.findUnique({ where: { id: 1 } });
    expect(head?.hash).toBe(entry2.hash);
  });

  it("should verify an unbroken range as valid", async () => {
    const minSeq = await prisma.auditEntry.findFirst({
      where: { eventId: testEventId1 },
    });
    const maxSeq = await prisma.auditEntry.findFirst({
      where: { eventId: testEventId2 },
    });

    expect(minSeq).toBeDefined();
    expect(maxSeq).toBeDefined();

    const result = await verifyChain(minSeq!.sequenceNumber, maxSeq!.sequenceNumber);
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(maxSeq!.sequenceNumber - minSeq!.sequenceNumber + 1);
  });

  it("should correctly verify a range starting mid-chain (fromSequence > 1)", async () => {
    const entry = await prisma.auditEntry.findFirst({
      where: { eventId: testEventId2 },
    });
    expect(entry).toBeDefined();

    const result = await verifyChain(entry!.sequenceNumber, entry!.sequenceNumber);
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(1);
  });

  it("should detect tampering if an outcome field is modified directly via SQL", async () => {
    const entry3 = await prisma.$transaction((tx) =>
      writeChainedAuditEntry(tx, {
        eventId: testEventId3,
        entityId: testCustomerId,
        actor: "system",
        inputSnapshot: { amount: 3000 },
        diagnosisSnapshot: { causeLabel: "insufficient_funds" },
        decisionSnapshot: { chosenAction: "escalate_to_human" },
        actionSnapshot: { result: "success" },
        outcome: "escalated",
      }),
    );

    // Verify valid before tamper
    const beforeTamper = await verifyChain(entry3.sequenceNumber, entry3.sequenceNumber);
    expect(beforeTamper.valid).toBe(true);

    // Tamper with the row directly
    await prisma.$executeRawUnsafe(
      `UPDATE "AuditEntry" SET outcome = 'recovered' WHERE id = '${entry3.id}'`,
    );

    const afterTamper = await verifyChain(entry3.sequenceNumber, entry3.sequenceNumber);
    expect(afterTamper.valid).toBe(false);
    expect(afterTamper.brokenAtEntryId).toBe(entry3.id);
    expect(afterTamper.brokenAtSequence).toBe(entry3.sequenceNumber);

    // Revert the tamper to restore integrity
    await prisma.$executeRawUnsafe(
      `UPDATE "AuditEntry" SET outcome = 'escalated' WHERE id = '${entry3.id}'`,
    );

    const restored = await verifyChain(entry3.sequenceNumber, entry3.sequenceNumber);
    expect(restored.valid).toBe(true);
  });

  it("should maintain sequential non-forking chain under concurrent writes", async () => {
    const writes = Array.from({ length: 5 }, (_, i) =>
      prisma.$transaction((tx) =>
        writeChainedAuditEntry(tx, {
          eventId: testEventId1,
          entityId: testCustomerId,
          actor: "concurrent_tester",
          inputSnapshot: { step: i, rand: Math.random() },
          outcome: "pending",
        }),
      ),
    );

    const results = await Promise.all(writes);
    expect(results).toHaveLength(5);

    // Sort by sequenceNumber and verify unbroken chain
    const sorted = [...results].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].prevHash).toBe(sorted[i - 1].hash);
      expect(sorted[i].sequenceNumber).toBe(sorted[i - 1].sequenceNumber + 1);
    }
  });

  it("should detect tampering on inputSnapshot and actor fields via SQL", async () => {
    const entry = await prisma.$transaction((tx) =>
      writeChainedAuditEntry(tx, {
        eventId: testEventId1,
        entityId: testCustomerId,
        actor: "original_actor",
        inputSnapshot: { amount: 500 },
        outcome: "pending",
      }),
    );

    // Tamper inputSnapshot
    await prisma.$executeRawUnsafe(
      `UPDATE "AuditEntry" SET "inputSnapshot" = '{"amount": 9999}' WHERE id = '${entry.id}'`,
    );
    const afterInputTamper = await verifyChain(entry.sequenceNumber, entry.sequenceNumber);
    expect(afterInputTamper.valid).toBe(false);
    expect(afterInputTamper.brokenAtEntryId).toBe(entry.id);

    // Restore inputSnapshot, tamper actor
    await prisma.$executeRawUnsafe(
      `UPDATE "AuditEntry" SET "inputSnapshot" = '{"amount": 500}', actor = 'rogue_actor' WHERE id = '${entry.id}'`,
    );
    const afterActorTamper = await verifyChain(entry.sequenceNumber, entry.sequenceNumber);
    expect(afterActorTamper.valid).toBe(false);
    expect(afterActorTamper.brokenAtEntryId).toBe(entry.id);

    // Restore actor
    await prisma.$executeRawUnsafe(
      `UPDATE "AuditEntry" SET actor = 'original_actor' WHERE id = '${entry.id}'`,
    );
    const restored = await verifyChain(entry.sequenceNumber, entry.sequenceNumber);
    expect(restored.valid).toBe(true);
  });

  it("should verify an untouched chain of at least 50 entries and return valid: true", async () => {
    // Generate 50 chained entries in sequence
    const fiftyEntries: string[] = [];
    for (let i = 0; i < 50; i++) {
      const row = await prisma.$transaction((tx) =>
        writeChainedAuditEntry(tx, {
          eventId: testEventId1,
          entityId: testCustomerId,
          actor: "bulk_tester",
          inputSnapshot: { index: i, timestamp: Date.now() },
          outcome: "pending",
        }),
      );
      fiftyEntries.push(row.id);
    }

    const firstSeq = (await prisma.auditEntry.findUnique({ where: { id: fiftyEntries[0] } }))!.sequenceNumber;
    const lastSeq = (await prisma.auditEntry.findUnique({ where: { id: fiftyEntries[49] } }))!.sequenceNumber;

    const result = await verifyChain(firstSeq, lastSeq);
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(50);

    // If we tamper with the 25th entry in this 50-entry chain, verify stops at entry 25
    const midEntry = await prisma.auditEntry.findUnique({ where: { id: fiftyEntries[24] } });
    await prisma.$executeRawUnsafe(
      `UPDATE "AuditEntry" SET outcome = 'tampered' WHERE id = '${midEntry!.id}'`,
    );

    const tamperedResult = await verifyChain(firstSeq, lastSeq);
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.brokenAtEntryId).toBe(midEntry!.id);
    expect(tamperedResult.brokenAtSequence).toBe(midEntry!.sequenceNumber);
    expect(tamperedResult.entriesChecked).toBe(24); // Stops at first break

    // Cleanup generated 50 entries
    await prisma.auditEntry.deleteMany({ where: { id: { in: fiftyEntries } } });
  });
});
