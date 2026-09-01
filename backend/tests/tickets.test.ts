import { prisma } from "../src/config/prisma";
import {
  listTickets,
  getTicketStats,
  getTicketById,
  addTicketNote,
  sendTicketEmail,
  resolveTicket,
} from "../src/services/ticketService";
import { escalateToHuman } from "../src/integrations/ticketMock";
import { publish } from "../src/kafka/producer";
import { TOPICS } from "../src/kafka/topics";

jest.mock("../src/integrations/emailIntegration", () => ({
  sendRecoveryEmail: jest.fn().mockResolvedValue({ messageId: "msg-mock-123" }),
}));

jest.mock("../src/integrations/razorpayIntegration", () => ({
  createRecoveryPaymentLink: jest.fn().mockResolvedValue({
    actionType: "send_payment_link",
    result: "success",
    integration: "RAZORPAY",
    razorpayPaymentLinkId: "plink_test_123",
    paymentLinkUrl: "https://rzp.io/i/plink_test_123",
  }),
}));

jest.mock("../src/kafka/producer", () => ({
  publish: jest.fn(),
}));

jest.mock("../src/api/websocket", () => ({
  emitLiveUpdate: jest.fn(),
}));

describe("Human Escalation Tickets System", () => {
  let testCustomerId: string;
  let testEntityId: string;
  let testEventId: string;

  beforeAll(async () => {
    // Create test customer & event
    const customer = await prisma.customer.create({
      data: {
        name: "Escalation Test User",
        email: "escalation.user@example.com",
        phone: "+919876543210",
        riskTier: "high",
        lifetimeValue: 45000,
      },
    });
    testCustomerId = customer.id;
    testEntityId = `inv_test_${crypto.randomUUID().slice(0, 8)}`;

    const event = await prisma.revenueEvent.create({
      data: {
        entityType: "INVOICE",
        entityId: testEntityId,
        customerId: testCustomerId,
        eventType: "INVOICE_OVERDUE",
        amount: 8500,
        currency: "INR",
        rawPayload: { dispute_flag: true },
        riskScore: 0.85,
        diagnosis: {
          create: {
            causeLabel: "invoice_disputed",
            confidence: 1.0,
            method: "RULE",
            reasoning: "Invoice has active dispute flag",
          },
        },
      },
    });
    testEventId = event.id;
  });

  afterAll(async () => {
    // Cleanup tickets & notes created by this test
    await prisma.ticketNote.deleteMany({ where: { ticket: { entityId: testEntityId } } });
    await prisma.ticket.deleteMany({ where: { entityId: testEntityId } });
    await prisma.$disconnect();
  });

  it("1. escalateToHuman creates an open ticket with initial note", async () => {
    const actionResult = await escalateToHuman(
      testEntityId,
      "Invoice disputed by customer — requires human review",
    );
    expect(actionResult.result).toBe("success");
    expect(actionResult.actionType).toBe("escalate_to_human");

    const ticket = await prisma.ticket.findUnique({
      where: { id: actionResult.detail },
      include: { notes: true },
    });
    expect(ticket).toBeDefined();
    expect(ticket?.status).toBe("open");
    expect(ticket?.entityId).toBe(testEntityId);
    expect(ticket?.notes.length).toBeGreaterThanOrEqual(1);
    expect(ticket?.notes[0].type).toBe("status_change");
  });

  it("2. listTickets returns ticket enriched with customer and event details", async () => {
    const res = await listTickets({ status: "open" });
    const match = res.items.find((t) => t.entityId === testEntityId);
    expect(match).toBeDefined();
    expect(match?.customer?.name).toBe("Escalation Test User");
    expect(match?.customer?.email).toBe("escalation.user@example.com");
    expect(match?.event?.amount).toBe(8500);
    expect(match?.event?.causeLabel).toBe("invoice_disputed");
    expect(match?.notesCount).toBeGreaterThanOrEqual(1);
  });

  it("3. getTicketStats returns non-zero at-risk amount for open tickets", async () => {
    const stats = await getTicketStats();
    expect(stats.openCount).toBeGreaterThan(0);
    expect(stats.totalAtRisk).toBeGreaterThan(0);
  });

  it("4. addTicketNote appends notes to the ticket", async () => {
    const ticket = await prisma.ticket.findFirst({ where: { entityId: testEntityId } });
    expect(ticket).toBeDefined();

    const note = await addTicketNote(ticket!.id, {
      author: "Agent Smith",
      content: "Spoke with customer over phone; offered 5% settlement discount.",
    });

    expect(note.id).toBeDefined();
    expect(note.author).toBe("Agent Smith");

    const fetched = await getTicketById(ticket!.id);
    const hasNote = fetched.ticket.notes.some(
      (n) => n.content === "Spoke with customer over phone; offered 5% settlement discount.",
    );
    expect(hasNote).toBe(true);
  });

  it("5. sendTicketEmail dispatches outreach and logs email note with payment link", async () => {
    const ticket = await prisma.ticket.findFirst({ where: { entityId: testEntityId } });
    expect(ticket).toBeDefined();

    const result = await sendTicketEmail(ticket!.id, {
      subject: "Settlement offer regarding your pending invoice",
      message: "Here is your requested discounted invoice link.",
      includePaymentLink: true,
      agentName: "Agent Smith",
    });

    expect(result.success).toBe(true);
    expect(result.paymentUrl).toBe("https://rzp.io/i/plink_test_123");

    const fetched = await getTicketById(ticket!.id);
    const emailNote = fetched.ticket.notes.find((n) => n.type === "email_sent");
    expect(emailNote).toBeDefined();
    expect(emailNote?.content).toContain("Settlement offer regarding your pending invoice");
    expect(emailNote?.content).toContain("https://rzp.io/i/plink_test_123");
  });

  it("6. resolveTicket with status 'recovered' updates workflow and writes LedgerEntry", async () => {
    const ticket = await prisma.ticket.findFirst({ where: { entityId: testEntityId } });
    expect(ticket).toBeDefined();

    const updated = await resolveTicket(ticket!.id, {
      status: "recovered",
      resolutionNotes: "Customer completed payment via phone outreach.",
      agentName: "Agent Smith",
      recoveredAmount: 8500,
    });

    expect(updated.status).toBe("recovered");
    expect(updated.resolvedAt).toBeDefined();

    // Verify EntityWorkflowState is RECOVERED
    const workflow = await prisma.entityWorkflowState.findUnique({
      where: { entityId: testEntityId },
    });
    expect(workflow?.state).toBe("RECOVERED");

    // Verify LedgerEntry was written
    const ledger = await prisma.ledgerEntry.findFirst({
      where: { entityId: testEntityId, type: "RECOVERED" },
    });
    expect(ledger).toBeDefined();
    expect(ledger?.amount).toBe(8500);

    // Verify the human recovery produced a chained audit entry
    const auditEntries = await prisma.auditEntry.findMany({
      where: { entityId: testEntityId, outcome: "recovered" },
      orderBy: { sequenceNumber: "desc" },
    });
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);

    const entry = auditEntries[0];
    expect(entry.actor).toBe("agent:Agent Smith");
    expect(entry.eventId).toBeDefined();

    const decision = entry.decisionSnapshot as Record<string, unknown> | null;
    expect(decision?.chosenAction).toBe("recovered");
    expect(decision?.reasoning).toContain("Customer completed payment");
    expect(decision?.recoveredAmount).toBe(8500);

    const action = entry.actionSnapshot as Record<string, unknown> | null;
    expect(action?.actionType).toBe("manual_recovery");
    expect(action?.result).toBe("success");

    const chainHead = await prisma.auditChainHead.findUnique({ where: { id: 1 } });
    expect(chainHead?.hash).toBe(entry.hash);

    // Entry was announced for embedding + live update
    expect(publish).toHaveBeenCalledWith(TOPICS.AUDIT, entry.eventId, {
      auditEntryId: entry.id,
      event: { id: entry.eventId, entityId: testEntityId },
    });
  });

  it("7. resolveTicket with status 'written_off' writes WRITTEN_OFF ledger and a chained audit entry", async () => {
    // Test 6 already resolved the first ticket as recovered, so a new open
    // ticket is created here for the write-off scenario.
    const actionResult = await escalateToHuman(
      testEntityId,
      "Customer unreachable after repeated outreach — write off exposure",
    );
    const ticket = await prisma.ticket.findUnique({
      where: { id: actionResult.detail },
    });
    expect(ticket).toBeDefined();
    expect(ticket?.status).toBe("open");

    const updated = await resolveTicket(ticket!.id, {
      status: "written_off",
      resolutionNotes: "No viable recovery path; exposure declared as loss.",
      agentName: "Agent Smith",
    });

    expect(updated.status).toBe("written_off");
    expect(updated.resolvedAt).toBeDefined();

    // Verify EntityWorkflowState is WRITTEN_OFF
    const workflow = await prisma.entityWorkflowState.findUnique({
      where: { entityId: testEntityId },
    });
    expect(workflow?.state).toBe("WRITTEN_OFF");

    // Verify LedgerEntry was written
    const ledger = await prisma.ledgerEntry.findFirst({
      where: { entityId: testEntityId, type: "WRITTEN_OFF" },
    });
    expect(ledger).toBeDefined();

    // Verify a hash-chained audit entry was recorded for the entity
    const auditEntries = await prisma.auditEntry.findMany({
      where: { entityId: testEntityId, outcome: "written_off" },
      orderBy: { sequenceNumber: "desc" },
    });
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);

    const entry = auditEntries[0];
    expect(entry.actor).toBe("agent:Agent Smith");
    expect(entry.eventId).toBeDefined();

    const decision = entry.decisionSnapshot as Record<string, unknown> | null;
    expect(decision?.chosenAction).toBe("written_off");
    expect(decision?.reasoning).toContain("No viable recovery path");

    const action = entry.actionSnapshot as Record<string, unknown> | null;
    expect(action?.actionType).toBe("write_off");
    expect(action?.result).toBe("success");

    const chainHead = await prisma.auditChainHead.findUnique({ where: { id: 1 } });
    expect(chainHead?.hash).toBe(entry.hash);

    // Entry was announced for embedding + live update
    expect(publish).toHaveBeenCalledWith(TOPICS.AUDIT, entry.eventId, {
      auditEntryId: entry.id,
      event: { id: entry.eventId, entityId: testEntityId },
    });
  });
});
