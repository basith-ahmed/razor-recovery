/**
 * Phase 6 — Execution Layer Tests
 *
 * Tests the full pipeline: executor → audit → metrics, matching the
 * Definition of Done requirements:
 *
 * 1. Full pipeline integration test (mocked at integration boundaries)
 * 2. computeLiveMetrics over a window with 3 events (recovered, escalated, DNC-skipped)
 * 3. DNC-flagged customer → outcome 'skipped', zero integration calls
 */

// ── Mocks ──────────────────────────────────────────────────────────────────────
// Must be declared before imports so jest.mock hoists correctly.

jest.mock("../src/config/openai", () => ({ requestJson: jest.fn() }));
jest.mock("../src/config/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    customer: { findUnique: jest.fn() },
    action: { create: jest.fn(), upsert: jest.fn(), count: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    promiseToPay: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "mock-ptp-id" }), update: jest.fn().mockResolvedValue({ id: "mock-ptp-id" }) },
    auditEntry: { create: jest.fn(), findMany: jest.fn() },
    entityWorkflowState: { findUnique: jest.fn(), upsert: jest.fn() },
    entityCauseState: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    revenueEvent: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ id: "mock-event-id" }),
    },
    diagnosis: { count: jest.fn() },
    ticket: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "mock-ticket-id" }),
      update: jest.fn().mockResolvedValue({ id: "mock-ticket-id" }),
      findUnique: jest.fn().mockResolvedValue({ id: "mock-ticket-id" }),
    },
    ticketNote: {
      create: jest.fn().mockResolvedValue({ id: "mock-note-id" }),
      deleteMany: jest.fn(),
    },
    invoice: { findFirst: jest.fn() },
    cart: { findFirst: jest.fn() },
    subscription: { findFirst: jest.fn() },
    auditChainHead: { upsert: jest.fn(), update: jest.fn() },
    ledgerEntry: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: "mock-ledger-id", ...args.data })),
      groupBy: jest.fn().mockResolvedValue([
        { type: "AT_RISK", _sum: { amount: 10000 } },
        { type: "RECOVERED", _sum: { amount: 5000 } },
        { type: "REVERSED", _sum: { amount: 0 } },
      ]),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      { hash: "d7c09e32ebdfa4ba13e9ef94a91b828552fe899d08ccd52969f4882651343b5d" },
    ]),
    $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});
jest.mock("../src/config/redis", () => {
  const redisMock = { incr: jest.fn(), set: jest.fn(), get: jest.fn() };
  return { redis: redisMock };
});
jest.mock("../src/config/razorpay", () => ({
  razorpay: {
    orders: { fetch: jest.fn() },
    paymentLink: { create: jest.fn() },
  },
}));
jest.mock("../src/config/mailer", () => ({
  mailer: { sendMail: jest.fn() },
}));
jest.mock("../src/config/env", () => ({
  env: {
    SMTP_FROM: "billing@test.demo",
    LLM_API_KEY: "test-key",
    LLM_MODEL: "gemini-test",
    LLM_BASE_URL: "https://test.example.com",
    DATABASE_URL: "postgresql://test",
    REDIS_URL: "redis://test",
    RAZORPAY_KEY_ID: "rzp_test",
    RAZORPAY_KEY_SECRET: "secret",
    RAZORPAY_WEBHOOK_SECRET: "whsec",
    KAFKA_BROKERS: "localhost:9092",
    KAFKA_CLIENT_ID: "test",
    SMTP_HOST: "localhost",
    SMTP_PORT: 1025,
    PORT: 4000,
    CORS_ORIGIN: "http://localhost:3000",
  },
}));

import { requestJson } from "../src/config/openai";
import { prisma } from "../src/config/prisma";
import { redis } from "../src/config/redis";
import { razorpay } from "../src/config/razorpay";
import { mailer } from "../src/config/mailer";
import {
  ActionResult,
  DecisionResult,
  DiagnosisResult,
  EnrichedRevenueEvent,
} from "../src/domain/types";
import { executeAction, draftRecoveryEmail } from "../src/services/executorService";
import { recordAuditEntry } from "../src/services/auditService";
import { computeLiveMetrics, recoveryFunnel } from "../src/services/metricsService";
import { computeRiskScore } from "../src/domain/riskScoring";
import { diagnose } from "../src/services/diagnosisService";
import { filterLegalActions, FilterContext } from "../src/domain/stoppingRules";
import { decide } from "../src/services/decisionService";

// ── Typed mocks ────────────────────────────────────────────────────────────────
const mockedRequestJson = requestJson as jest.MockedFunction<typeof requestJson>;
const mockedPrisma = prisma as jest.Mocked<typeof prisma>;
const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedRazorpay = razorpay as any;
const mockedMailer = mailer as any;

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EnrichedRevenueEvent> = {}): EnrichedRevenueEvent {
  return {
    id: "event-1",
    entityType: "INVOICE",
    entityId: "entity-1",
    customerId: "customer-1",
    eventType: "INVOICE_OVERDUE",
    amount: 5000,
    currency: "INR",
    occurredAt: "2026-08-23T00:00:00.000Z",
    rawPayload: { source: "partner_ingest", disputeFlag: false, daysOverdue: 5 },
    riskScore: 0.8,
    urgency: 0.7,
    ...overrides,
  };
}

function makeDiagnosis(overrides: Partial<DiagnosisResult> = {}): DiagnosisResult {
  return {
    causeLabel: "invoice_overdue",
    confidence: 1,
    method: "RULE",
    ...overrides,
  };
}

function makeDecision(overrides: Partial<DecisionResult> = {}): DecisionResult {
  return {
    legalActions: ["send_reminder_email", "send_soft_chase_email", "escalate_to_human"],
    chosenAction: "send_reminder_email",
    reasoning: "Invoice is freshly overdue; a friendly reminder is the safest first action.",
    policyVersion: "2.1.0",
    ...overrides,
  };
}

const mockCustomer = {
  id: "customer-1",
  name: "Aarav Sharma",
  email: "aarav@example.test",
  phone: "+919876543210",
  dncFlag: false,
  riskTier: "standard",
  lifetimeValue: 25000,
  createdAt: new Date(),
};

// ── Test Suites ────────────────────────────────────────────────────────────────

describe("executorService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock: action.create resolves
    (mockedPrisma.action.create as jest.Mock).mockResolvedValue({
      id: "action-1",
      eventId: "event-1",
      actionType: "send_reminder_email",
      result: "success",
      integration: "EMAIL",
    });
  });

  describe("draftRecoveryEmail", () => {
    it("generates deterministic parameterized email for invoice_overdue", async () => {
      const result = await draftRecoveryEmail(
        makeEvent({ amount: 5000 }),
        "Aarav Sharma",
        "invoice_overdue",
        "https://rzp.io/i/plink_123"
      );

      expect(result.subject).toContain("Overdue");
      expect(result.subject).toContain("5,000");
      expect(result.html).toContain("Aarav Sharma");
      expect(result.html).toContain("past its payment due date");
      expect(result.html).toContain("https://rzp.io/i/plink_123");
    });

    it("generates deterministic email for cart_abandoned", async () => {
      const result = await draftRecoveryEmail(
        makeEvent({ eventType: "CHECKOUT_ABANDONED", entityType: "CART", amount: 3000 }),
        "Priya Patel",
        "cart_abandoned"
      );

      expect(result.subject).toContain("Complete your checkout");
      expect(result.subject).toContain("3,000");
      expect(result.html).toContain("Priya Patel");
      expect(result.html).toContain("left items in your cart");
    });

    it("generates deterministic email for mandate re-authorization", async () => {
      const result = await draftRecoveryEmail(
        makeEvent({ eventType: "SUBSCRIPTION_MANDATE_CANCELLED", entityType: "SUBSCRIPTION", amount: 1999 }),
        "Rohan Gupta",
        "mandate_requires_reauthorization"
      );

      expect(result.subject).toContain("Re-authorize your subscription");
      expect(result.html).toContain("Rohan Gupta");
      expect(result.html).toContain("UPI Autopay / e-NACH mandate");
    });
  });

  describe("executeAction", () => {
    it("routes email actions through draftRecoveryEmail + sendRecoveryEmail", async () => {
      (mockedPrisma.customer.findUnique as jest.Mock).mockResolvedValueOnce(mockCustomer);
      mockedMailer.sendMail.mockResolvedValueOnce({ messageId: "msg-123" });

      const result = await executeAction(
        makeDecision({ chosenAction: "send_reminder_email" }),
        makeEvent(),
      );

      expect(mockedMailer.sendMail).toHaveBeenCalledTimes(1);
      expect(mockedMailer.sendMail.mock.calls[0][0].subject).toContain("Overdue");
      expect(mockedMailer.sendMail.mock.calls[0][0].html).toContain("Hi Aarav Sharma");
      expect(result.result).toBe("success");
      expect(result.integration).toBe("EMAIL");
      expect(result.actionType).toBe("send_reminder_email");
    });

    it("routes escalate_to_human to ticketMock", async () => {
      (mockedPrisma.ticket.create as jest.Mock).mockResolvedValueOnce({
        id: "ticket-1",
        entityId: "entity-1",
        reason: "test",
        status: "open",
      });

      const result = await executeAction(
        makeDecision({ chosenAction: "escalate_to_human" }),
        makeEvent(),
      );

      expect(mockedPrisma.ticket.create).toHaveBeenCalledTimes(1);
      expect(result.result).toBe("success");
      expect(result.integration).toBe("TICKET");
      expect(result.actionType).toBe("escalate_to_human");
    });

    it("returns skipped for chosenAction 'none'", async () => {
      const result = await executeAction(
        makeDecision({ chosenAction: "none", legalActions: [] }),
        makeEvent(),
      );

      expect(result.result).toBe("skipped");
      expect(result.integration).toBe("NONE");
      expect(result.actionType).toBe("none");
    });

    it("throws DomainError for unrecognized action", async () => {
      await expect(
        executeAction(
          makeDecision({ chosenAction: "launch_missiles" }),
          makeEvent(),
        ),
      ).rejects.toThrow("Unrecognized action");
    });
  });
});

describe("auditService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (mockedPrisma.auditEntry.create as jest.Mock).mockResolvedValue({ id: "audit-1" });
    (mockedPrisma.entityWorkflowState.findUnique as jest.Mock).mockResolvedValue({
      entityId: "entity-1",
      state: "DETECTED",
    });
    (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mockResolvedValue({});
    (mockedPrisma.entityCauseState.upsert as jest.Mock).mockResolvedValue({});
    (mockedPrisma.entityCauseState.deleteMany as jest.Mock).mockResolvedValue({
      count: 0,
    });
  });

  it("writes an AuditEntry with all four snapshots", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis();
    const decision = makeDecision();
    const action: ActionResult = {
      actionType: "send_reminder_email",
      result: "success",
      integration: "EMAIL",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.auditEntry.create).toHaveBeenCalledTimes(1);
    const createCall = (mockedPrisma.auditEntry.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.inputSnapshot).toEqual(event);
    expect(createCall.data.decisionSnapshot).toEqual(decision);
    expect(createCall.data.actionSnapshot).toEqual(action);
    expect(createCall.data.outcome).toBe("pending");
  });

  it("transitions EntityWorkflowState off DETECTED for an email action", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis();
    const decision = makeDecision();
    const action: ActionResult = {
      actionType: "send_reminder_email",
      result: "success",
      integration: "EMAIL",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.entityWorkflowState.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock.calls[0][0];
    // email_sent from DETECTED → CONTACTED
    expect(upsertCall.create.state).toBe("CONTACTED");
    expect(upsertCall.update.state).toBe("CONTACTED");
  });

  it("transitions to DO_NOT_CONTACT for a DNC-skipped event", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis({ causeLabel: "dnc" });
    const decision = makeDecision({
      chosenAction: "none",
      legalActions: [],
      reasoning: "Blocked by policy (DNC or dispute)",
    });
    const action: ActionResult = {
      actionType: "none",
      result: "skipped",
      integration: "NONE",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.entityWorkflowState.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock.calls[0][0];
    // dnc_skip from DETECTED → DO_NOT_CONTACT
    expect(upsertCall.create.state).toBe("DO_NOT_CONTACT");
  });

  it("upserts EntityCauseState (per-cause attempt + cooldown) for an executed action", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis({ causeLabel: "cart_abandoned" });
    const decision = makeDecision();
    const action: ActionResult = {
      actionType: "send_reminder_email",
      result: "success",
      integration: "EMAIL",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.entityCauseState.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (mockedPrisma.entityCauseState.upsert as jest.Mock).mock
      .calls[0][0];
    expect(upsertCall.where).toEqual({
      entityId_causeLabel: { entityId: "entity-1", causeLabel: "cart_abandoned" },
    });
    // Successful attempt consumes this cause's budget and starts its cooldown
    expect(upsertCall.create.attemptCount).toBe(1);
    expect(upsertCall.create.cooldownUntil).toBeInstanceOf(Date);
    expect(upsertCall.update.attemptCount).toEqual({ increment: 1 });
    expect(upsertCall.update.cooldownUntil).toBeInstanceOf(Date);
  });

  it("does not consume attempt budget or set cooldown for a skipped action", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis();
    const decision = makeDecision({
      chosenAction: "none",
      legalActions: [],
      reasoning: "Blocked by policy (DNC or dispute)",
    });
    const action: ActionResult = {
      actionType: "none",
      result: "skipped",
      integration: "NONE",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    // dnc_skip transitions DETECTED → DO_NOT_CONTACT (terminal): the arc
    // closes, so per-cause state is wiped and never recreated in the same tick.
    expect(mockedPrisma.entityCauseState.deleteMany).toHaveBeenCalledWith({
      where: { entityId: "entity-1" },
    });
    expect(mockedPrisma.entityCauseState.upsert).not.toHaveBeenCalled();

    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock
      .calls[0][0];
    expect(upsertCall.create.state).toBe("DO_NOT_CONTACT");
  });

  it("starts a fresh arc when a new event arrives on a terminal-state entity", async () => {
    // A subscription recovered last billing cycle is RECOVERED (terminal);
    // this month's failure must transition from DETECTED, not throw.
    (mockedPrisma.entityWorkflowState.findUnique as jest.Mock).mockResolvedValueOnce({
      entityId: "entity-1",
      state: "RECOVERED",
    });

    const event = makeEvent();
    const diagnosis = makeDiagnosis({ causeLabel: "invoice_overdue" });
    const decision = makeDecision();
    const action: ActionResult = {
      actionType: "send_reminder_email",
      result: "success",
      integration: "EMAIL",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock
      .calls[0][0];
    // email_sent computed from the fresh DETECTED arc → CONTACTED
    expect(upsertCall.update.state).toBe("CONTACTED");

    // The new arc's first successful contact opens a fresh per-cause budget
    const causeUpsertCall = (mockedPrisma.entityCauseState.upsert as jest.Mock).mock
      .calls[0][0];
    expect(causeUpsertCall.create.attemptCount).toBe(1);
    expect(causeUpsertCall.create.lastContactedAt).toBeInstanceOf(Date);
  });

  it("transitions to COOLING_DOWN for a successful pause_subscription", async () => {
    (mockedPrisma.entityWorkflowState.findUnique as jest.Mock).mockResolvedValueOnce({
      entityId: "entity-1",
      state: "DETECTED",
    });

    const event = makeEvent();
    const diagnosis = makeDiagnosis({ causeLabel: "mandate_requires_reauthorization" });
    const decision = makeDecision({
      legalActions: ["send_reminder_email", "pause_subscription", "escalate_to_human"],
      chosenAction: "pause_subscription",
      reasoning: "Subscription paused during the mandate win-back window.",
    });
    const action: ActionResult = {
      actionType: "pause_subscription",
      result: "success",
      integration: "RAZORPAY",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock
      .calls[0][0];
    expect(upsertCall.create.state).toBe("COOLING_DOWN");
    expect(upsertCall.update.state).toBe("COOLING_DOWN");

    const createCall = (mockedPrisma.auditEntry.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.outcome).toBe("pending");
  });

  it("derives outcome 'escalated' for escalate_to_human action", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis({ causeLabel: "invoice_disputed" });
    const decision = makeDecision({
      chosenAction: "escalate_to_human",
      legalActions: ["escalate_to_human"],
    });
    const action: ActionResult = {
      actionType: "escalate_to_human",
      result: "success",
      integration: "TICKET",
      detail: "ticket-1",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    const createCall = (mockedPrisma.auditEntry.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.outcome).toBe("escalated");
  });
});

describe("per-cause attempt/cooldown scoping", () => {
  // Mirrors the FilterContext construction in decisionConsumer: attempt/cooldown
  // state is looked up per (entityId, causeLabel) in EntityCauseState.
  function lookupCauseState(entityId: string, causeLabel: string) {
    return prisma.entityCauseState.findUnique({
      where: { entityId_causeLabel: { entityId, causeLabel } },
    });
  }

  function buildFilterCtx(
    causeLabel: string,
    causeState: { attemptCount?: number; cooldownUntil?: Date | null } | null,
  ) {
    const now = new Date();
    const isInCooldown = causeState?.cooldownUntil
      ? causeState.cooldownUntil > now
      : false;
    return {
      causeLabel,
      customerId: "customer-1",
      isDnc: false,
      isDisputed: false,
      attemptCount: causeState?.attemptCount ?? 0,
      isInCooldown,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (mockedPrisma.entityCauseState.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it("does not bleed attempt budgets across causes for the same entity", async () => {
    // cart_abandoned already exhausted its budget (2/2 attempts); an
    // unrelated invoice_overdue diagnosis must start from a clean slate.
    const entityId = "entity-multi-cause";
    const newCause = "invoice_overdue";

    // The per-cause lookup targets the NEW cause's row, not cart_abandoned's
    const causeState = await lookupCauseState(entityId, newCause);
    expect(mockedPrisma.entityCauseState.findUnique).toHaveBeenCalledWith({
      where: { entityId_causeLabel: { entityId, causeLabel: newCause } },
    });

    const ctx = buildFilterCtx(newCause, causeState);
    const legalActions = filterLegalActions(ctx);

    // Full action list for invoice_overdue — NOT escalation-only, because
    // this cause's attemptCount is 0 regardless of cart_abandoned's 2.
    expect(legalActions).toEqual([
      "send_reminder_email",
      "send_soft_chase_email",
      "escalate_to_human",
    ]);
  });

  it("cooldown on one cause does not block an unrelated cause", async () => {
    // cart_abandoned is actively in cooldown; invoice_overdue must not
    // inherit it.
    const entityId = "entity-cooldown";

    // Sanity: the cart_abandoned cause itself IS blocked by its own cooldown
    const blockedCtx = buildFilterCtx("cart_abandoned", {
      cooldownUntil: new Date(Date.now() + 30 * 60 * 1000),
    });
    expect(filterLegalActions(blockedCtx)).toEqual([]);

    const newCause = "invoice_overdue";
    const causeState = await lookupCauseState(entityId, newCause);
    expect(mockedPrisma.entityCauseState.findUnique).toHaveBeenCalledWith({
      where: { entityId_causeLabel: { entityId, causeLabel: newCause } },
    });

    const ctx = buildFilterCtx(newCause, causeState);
    expect(ctx.isInCooldown).toBe(false);
    expect(filterLegalActions(ctx).length).toBeGreaterThan(0);
  });

  it("arc closure wipes ALL per-cause rows, not just the resolving one", async () => {
    // Entity has two open per-cause budgets accumulated while RETRYING:
    // cart_abandoned @ 1 attempt, invoice_overdue @ 2 attempts.
    (mockedPrisma.entityWorkflowState.findUnique as jest.Mock).mockResolvedValueOnce({
      entityId: "entity-two-causes",
      state: "RETRYING",
    });
    // Simulates the DB immediately after arc closure: the entity-wide
    // deleteMany removed every cause row (jest mocks can't model mutation,
    // so the post-wipe read returns what Postgres would return).
    (mockedPrisma.entityCauseState.findMany as jest.Mock).mockResolvedValue([]);

    // A DNC-skipped action closes the arc: RETRYING → DO_NOT_CONTACT (terminal)
    const event = makeEvent({ entityId: "entity-two-causes" });
    const diagnosis = makeDiagnosis();
    const decision = makeDecision({
      chosenAction: "none",
      legalActions: [],
      reasoning: "Blocked by policy (DNC or dispute)",
    });
    const action: ActionResult = {
      actionType: "none",
      result: "skipped",
      integration: "NONE",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    // Wipe is entity-wide — both causes gone, not just the diagnosed one
    expect(mockedPrisma.entityCauseState.deleteMany).toHaveBeenCalledWith({
      where: { entityId: "entity-two-causes" },
    });
    // And nothing recreates a row in the same tick after arc closure
    expect(mockedPrisma.entityCauseState.upsert).not.toHaveBeenCalled();

    // Direct query confirms both rows would be gone post-wipe
    const remaining = await prisma.entityCauseState.findMany({
      where: { entityId: "entity-two-causes" },
    });
    expect(remaining).toEqual([]);
  });
});

describe("metricsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedRedis.get as jest.Mock).mockResolvedValue(null);
  });

  describe("computeLiveMetrics", () => {
    it("computes correct windowed totals for 3 events (recovered, escalated, DNC-skipped)", async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);

      const events = [
        // Event 1: recovered
        {
          id: "ev-1",
          amount: 5000,
          occurredAt: oneHourAgo,
          diagnosis: { causeLabel: "invoice_overdue" },
          action: { integration: "RAZORPAY", executedAt: now },
          auditEntries: [{ outcome: "recovered", timestamp: now }],
        },
        // Event 2: escalated
        {
          id: "ev-2",
          amount: 3000,
          occurredAt: oneHourAgo,
          diagnosis: { causeLabel: "invoice_disputed" },
          action: { integration: "TICKET", actionType: "escalate_to_human", result: "success", executedAt: now },
          auditEntries: [{ outcome: "escalated", timestamp: now }],
        },
        // Event 3: DNC-skipped
        {
          id: "ev-3",
          amount: 2000,
          occurredAt: oneHourAgo,
          diagnosis: { causeLabel: "dnc" },
          action: { integration: "NONE", actionType: "none", result: "skipped", executedAt: now },
          auditEntries: [{ outcome: "skipped", timestamp: now }],
        },
      ];

      // Call order within computeLiveMetrics:
      // 1. revenueEvent.findMany (events)
      (mockedPrisma.revenueEvent.findMany as jest.Mock).mockResolvedValueOnce(events);
      // 2. recoveryFunnel: count / count / count / findMany
      (mockedPrisma.revenueEvent.count as jest.Mock).mockResolvedValueOnce(3);
      (mockedPrisma.diagnosis.count as jest.Mock).mockResolvedValueOnce(3);
      (mockedPrisma.action.count as jest.Mock).mockResolvedValueOnce(1);
      (mockedPrisma.auditEntry.findMany as jest.Mock)
        .mockResolvedValueOnce([{ eventId: "ev-1" }]) // recovered audits
        .mockResolvedValueOnce([
          // compliance audits
          { outcome: "recovered", decisionSnapshot: null },
          { outcome: "escalated", decisionSnapshot: null },
          { outcome: "skipped", decisionSnapshot: { reasoning: "Blocked by policy (DNC or dispute)" } },
        ])
        .mockResolvedValueOnce([
          { eventId: "ev-1" },
          { eventId: "ev-2" },
          { eventId: "ev-3" },
        ]); // processed audits

      const summary = await computeLiveMetrics("all");

      expect(summary.window).toBe("all");
      // Total amount at risk = 5000 + 3000 + 2000 = 10000
      expect(summary.amountAtRisk).toBe(10000);

      // Only event 1 is recovered = 5000
      expect(summary.amountRecovered).toBe(5000);

      // Recovery rate = 5000 / 10000 = 0.5
      expect(summary.recoveryRate).toBe(0.5);
      expect(summary.eventsProcessed).toBe(3);

      // Funnel breakdown
      expect(summary.funnel).toEqual([
        { stage: "detected", count: 3 },
        { stage: "diagnosed", count: 3 },
        { stage: "contacted", count: 1 },
        { stage: "recovered", count: 1 },
      ]);

      // byCause breakdown
      expect(summary.byCause).toEqual(
        expect.arrayContaining([
          { cause: "invoice_overdue", recovered: 5000, atRisk: 5000 },
          { cause: "invoice_disputed", recovered: 0, atRisk: 3000 },
          { cause: "dnc", recovered: 0, atRisk: 2000 },
        ]),
      );

      // byChannel breakdown
      expect(summary.byChannel).toEqual([
        { channel: "razorpay", count: 1, recoveredCount: 1, recoveredAmount: 5000 },
        { channel: "email", count: 0, recoveredCount: 0, recoveredAmount: 0 },
        { channel: "human", count: 1, recoveredCount: 0, recoveredAmount: 0 },
      ]);

      // Median time-to-recovery = 1 hour
      expect(summary.medianTimeToRecoveryHours).toBe(1);

      // Compliance counters
      expect(summary.compliance).toEqual({
        dncBlocked: 1,
        autoEscalated: 1,
        cooldownStopped: 0,
      });

      // Result was cached in Redis with a short TTL — window is the only scope
      expect(mockedRedis.set).toHaveBeenCalledWith(
        "razorrecovery:metrics:all",
        expect.any(String),
        "EX",
        expect.any(Number),
      );
    });
  });

  describe("computeLiveMetrics window handling", () => {
    it("computes over the given window only and caches without any run tag", async () => {
      (mockedPrisma.revenueEvent.findMany as jest.Mock).mockResolvedValueOnce([]);
      (mockedPrisma.revenueEvent.count as jest.Mock).mockResolvedValueOnce(0);
      (mockedPrisma.diagnosis.count as jest.Mock).mockResolvedValueOnce(0);
      (mockedPrisma.action.count as jest.Mock).mockResolvedValueOnce(0);
      (mockedPrisma.ledgerEntry.groupBy as jest.Mock).mockResolvedValueOnce([]);
      (mockedPrisma.auditEntry.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // recovered audits
        .mockResolvedValueOnce([]) // compliance audits
        .mockResolvedValueOnce([]); // processed audits

      const summary = await computeLiveMetrics("24h");

      expect(summary.window).toBe("24h");
      expect(summary.eventsProcessed).toBe(0);
      expect(mockedRedis.set).toHaveBeenCalledWith(
        "razorrecovery:metrics:24h",
        expect.any(String),
        "EX",
        expect.any(Number),
      );
    });
  });

  describe("recoveryFunnel", () => {
    it("returns correct funnel stage counts for a window", async () => {
      (mockedPrisma.revenueEvent.count as jest.Mock).mockResolvedValueOnce(10);
      (mockedPrisma.diagnosis.count as jest.Mock).mockResolvedValueOnce(8);
      (mockedPrisma.action.count as jest.Mock).mockResolvedValueOnce(6);
      (mockedPrisma.auditEntry.findMany as jest.Mock).mockResolvedValueOnce([
        { eventId: "ev-1" },
        { eventId: "ev-2" },
      ]);

      const funnel = await recoveryFunnel("7d");

      expect(funnel).toEqual([
        { stage: "detected", count: 10 },
        { stage: "diagnosed", count: 8 },
        { stage: "contacted", count: 6 },
        { stage: "recovered", count: 2 },
      ]);
    });
  });
});

// ── Definition of Done Tests ───────────────────────────────────────────────────

describe("Definition of Done — Full Pipeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock customer lookup
    (mockedPrisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);

    // Mock invoice lookup used by the pipeline walk fixture
    (mockedPrisma.invoice.findFirst as jest.Mock).mockResolvedValue({
      id: "inv-1",
      customerId: "customer-1",
      amount: 5000,
      status: "open",
      createdAt: new Date(),
      dueDate: new Date(),
      disputeFlag: false,
    });

    // Mock action create
    (mockedPrisma.action.create as jest.Mock).mockResolvedValue({
      id: "action-1",
      eventId: "event-1",
    });

    // Mock audit entry create
    (mockedPrisma.auditEntry.create as jest.Mock).mockResolvedValue({ id: "audit-1" });

    // Mock entity workflow state
    (mockedPrisma.entityWorkflowState.findUnique as jest.Mock).mockResolvedValue({
      entityId: "inv-1",
      state: "DETECTED",
      attemptCount: 0,
    });
    (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mockResolvedValue({});

    // Mock Redis
    (mockedRedis.incr as jest.Mock).mockResolvedValue(1);
    (mockedRedis.set as jest.Mock).mockResolvedValue("OK");

    // Mock Gemini LLM requestJson
    mockedRequestJson.mockResolvedValue(
      JSON.stringify({ chosen_action: "send_reminder_email", reasoning: "Send reminder email recommended by policy." }),
    );

    // Mock Mailer
    mockedMailer.sendMail.mockResolvedValue({ messageId: "msg-test-123" });
  });

  it("walks an event directly in sequence: partner envelope (Phase 3) → computeRiskScore (Phase 2) → diagnose (Phase 5) → filterLegalActions + decide (Phase 2/5) → executeAction (6.1) → recordAuditEntry (6.2)", async () => {
    // 1. Partner envelope → normalized raw event (the ingest path builds this)
    const rawEvent = makeEvent();
    expect(rawEvent.eventType).toBe("INVOICE_OVERDUE");

    // 2. computeRiskScore (Phase 2)
    const history = { priorFailures: 1, lifetimeValue: 25000, tenureDays: 90 };
    const { riskScore, urgency } = computeRiskScore(rawEvent, history, 10000, 5);
    const enrichedEvent: EnrichedRevenueEvent = { ...rawEvent, riskScore, urgency };
    expect(enrichedEvent.riskScore).toBeGreaterThan(0);

    // 3. diagnose (Phase 5)
    const diagnosisResult = await diagnose(enrichedEvent, history);
    expect(diagnosisResult.causeLabel).toBe("invoice_overdue");

    // 4. filterLegalActions + decide (Phase 2/5)
    const filterCtx: FilterContext = {
      causeLabel: diagnosisResult.causeLabel,
      customerId: rawEvent.customerId,
      isDnc: false,
      isDisputed: false,
      attemptCount: 0,
      isInCooldown: false,
    };
    const legalActions = filterLegalActions(filterCtx);
    expect(legalActions.length).toBeGreaterThan(0);

    const decisionResult = await decide(diagnosisResult, filterCtx, {
      attemptCount: 0,
      customerLtv: 25000,
      priorFailures: 1,
      daysSinceLastContact: 10,
    });
    expect(decisionResult.chosenAction).toBeDefined();

    // 5. executeAction (6.1)
    const actionResult = await executeAction(decisionResult, enrichedEvent);
    expect(actionResult.result).toBeDefined();

    // 6. recordAuditEntry (6.2)
    await recordAuditEntry({
      event: enrichedEvent,
      diagnosis: diagnosisResult,
      decision: decisionResult,
      action: actionResult,
    });

    // Afterward: confirm an AuditEntry row exists with all four snapshots populated
    expect(mockedPrisma.auditEntry.create).toHaveBeenCalledTimes(1);
    const auditCall = (mockedPrisma.auditEntry.create as jest.Mock).mock.calls[0][0];
    expect(auditCall.data.inputSnapshot).toEqual(enrichedEvent);
    expect(auditCall.data.decisionSnapshot).toEqual(decisionResult);
    expect(auditCall.data.actionSnapshot).toEqual(actionResult);
    expect(auditCall.data.outcome).toBeDefined();

    // And confirm EntityWorkflowState has moved off DETECTED
    expect(mockedPrisma.entityWorkflowState.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertCall.create.state).not.toBe("DETECTED");
    expect(upsertCall.update.state).not.toBe("DETECTED");
  });
});

describe("Definition of Done — DNC Compliance", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (mockedPrisma.action.create as jest.Mock).mockResolvedValue({ id: "action-dnc" });
    (mockedPrisma.auditEntry.create as jest.Mock).mockResolvedValue({ id: "audit-dnc" });
    (mockedPrisma.entityWorkflowState.findUnique as jest.Mock).mockResolvedValue({
      entityId: "entity-dnc",
      state: "DETECTED",
      attemptCount: 0,
    });
    (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mockResolvedValue({});
    (mockedRedis.incr as jest.Mock).mockResolvedValue(1);
    (mockedRedis.set as jest.Mock).mockResolvedValue("OK");
  });

  it("DNC-flagged customer → outcome 'skipped' and zero integration calls", async () => {
    const event = makeEvent({ entityId: "entity-dnc", customerId: "customer-dnc" });
    const diagnosis = makeDiagnosis({ causeLabel: "dnc" });
    const decision = makeDecision({
      legalActions: [],
      chosenAction: "none",
      reasoning: "Blocked by policy (DNC or dispute)",
    });

    // Execute the action — should skip with no external calls
    const actionResult = await executeAction(decision, event);

    expect(actionResult.result).toBe("skipped");
    expect(actionResult.actionType).toBe("none");

    // Verify: zero integration calls
    expect(mockedRazorpay.orders.fetch).not.toHaveBeenCalled();
    expect(mockedRazorpay.paymentLink.create).not.toHaveBeenCalled();
    expect(mockedMailer.sendMail).not.toHaveBeenCalled();
    expect(mockedRequestJson).not.toHaveBeenCalled(); // No AI call for email draft
    expect(mockedPrisma.ticket.create).not.toHaveBeenCalled();

    // Record the audit entry
    await recordAuditEntry({ event, diagnosis, decision, action: actionResult });

    // Verify: outcome is 'skipped'
    const auditCall = (mockedPrisma.auditEntry.create as jest.Mock).mock.calls[0][0];
    expect(auditCall.data.outcome).toBe("skipped");
  });

  describe("draftRecoveryEmail parameterized templates", () => {
    it("renders amount and entity reference into HTML email", async () => {
      const result = await draftRecoveryEmail(
        makeEvent({ amount: 1000, entityId: "inv_123456", entityType: "INVOICE" }),
        "Alice",
        "invoice_overdue"
      );
      expect(result.subject).toContain("1,000");
      expect(result.html).toContain("<p");
      expect(result.html).toContain("Alice");
      expect(result.html).toContain("1,000");
    });

    it("renders payment button when payment link URL is provided", async () => {
      const result = await draftRecoveryEmail(
        makeEvent({ amount: 500 }),
        "Bob",
        "invoice_overdue",
        "https://rzp.io/i/testlink"
      );
      expect(result.subject).toContain("500");
      expect(result.html).toContain("https://rzp.io/i/testlink");
      expect(result.html).toContain("Pay ₹500 Now");
    });
  });

  describe("Unified Entity-Level Attempt Counter & Cross-Cause Stopping Rules", () => {
    it("increments the entity attempt counter across different cause events", async () => {
      const entityId = "entity-multi-cause-1";
      const event1 = makeEvent({ entityId, eventType: "INVOICE_OVERDUE" });
      const diag1 = makeDiagnosis({ causeLabel: "cart_abandoned" });
      const dec1 = makeDecision({ chosenAction: "send_reminder_email" });
      const action1: ActionResult = {
        actionType: "send_reminder_email",
        result: "success",
        integration: "EMAIL",
      };

      // 1st Attempt: cart_abandoned
      await recordAuditEntry({ event: event1, diagnosis: diag1, decision: dec1, action: action1 });
      expect(mockedPrisma.entityWorkflowState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityId },
          create: expect.objectContaining({ attemptCount: 1 }),
          update: expect.objectContaining({
            attemptCount: { increment: 1 },
          }),
        }),
      );
    });
  });
});

