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

jest.mock("../src/integrations/emailIntegration", () => ({
  sendRecoveryEmail: jest.fn().mockResolvedValue({ messageId: "msg-mock-123" }),
}));

jest.mock("../src/integrations/razorpayIntegration", () => ({
  createRecoveryPaymentLink: jest.fn().mockResolvedValue({
    actionType: "send_payment_link",
    result: "success",
    integration: "RAZORPAY",
    razorpayPaymentLinkId: "plink_test_123",
    paymentLinkShortUrl: "https://rzp.io/i/plink_test_123",
  }),
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
  });
});
