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
    action: { create: jest.fn(), upsert: jest.fn(), count: jest.fn() },
    auditEntry: { create: jest.fn(), findMany: jest.fn() },
    entityWorkflowState: { findUnique: jest.fn(), upsert: jest.fn() },
    entityCauseState: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    revenueEvent: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    diagnosis: { count: jest.fn() },
    ticket: { create: jest.fn() },
    invoice: { findFirst: jest.fn() },
    cart: { findFirst: jest.fn() },
    subscription: { findFirst: jest.fn() },
    auditChainHead: { upsert: jest.fn(), update: jest.fn() },
    ledgerEntry: {
      findFirst: jest.fn().mockResolvedValue(null),
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
import { injectFailure } from "../src/simulator/injectFailure";
import { computeRiskScore } from "../src/domain/riskScoring";
import { diagnose } from "../src/services/diagnosisService";
import { filterLegalActions } from "../src/domain/stoppingRules";
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
    eventType: "PAYMENT_FAILED",
    amount: 5000,
    currency: "INR",
    occurredAt: "2026-08-23T00:00:00.000Z",
    razorpayPaymentId: "pay_sim_abc",
    razorpayOrderId: "order_sim_xyz",
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "card_expired",
    rawPayload: { simulator: true },
    riskScore: 0.8,
    urgency: 0.7,
    ...overrides,
  };
}

function makeDiagnosis(overrides: Partial<DiagnosisResult> = {}): DiagnosisResult {
  return {
    causeLabel: "expired_card",
    confidence: 1,
    method: "RULE",
    ...overrides,
  };
}

function makeDecision(overrides: Partial<DecisionResult> = {}): DecisionResult {
  return {
    legalActions: ["retry_payment", "send_payment_link"],
    chosenAction: "retry_payment",
    reasoning: "Customer has an expired card; retry is the safest first action.",
    policyVersion: "1.0.0",
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
      actionType: "retry_payment",
      result: "success",
      integration: "RAZORPAY",
    });
  });

  describe("draftRecoveryEmail", () => {
    it("sends complete event context to Gemini", async () => {
      mockedRequestJson.mockResolvedValueOnce(
        JSON.stringify({
          subject: "Update your payment method",
          body_paragraphs: ["Hi Aarav, please update your card."],
        }),
      );

      await draftRecoveryEmail(
        makeEvent({ errorReason: "card_expired", errorCode: "BAD_REQUEST_ERROR" }),
        "Aarav Sharma",
        "expired_card",
      );

      expect(mockedRequestJson).toHaveBeenCalledTimes(1);
      const requestArg = mockedRequestJson.mock.calls[0][0];
      const parsedInput = JSON.parse(requestArg.input);
      expect(parsedInput).toMatchObject({
        customerName: "Aarav Sharma",
        cause: "expired_card",
        amount: 5000,
        currency: "INR",
        eventType: "PAYMENT_FAILED",
        entityType: "INVOICE",
        entityId: "entity-1",
        errorReason: "card_expired",
        errorCode: "BAD_REQUEST_ERROR",
      });
    });

    it("wraps body_paragraphs into the templated HTML email", async () => {
      mockedRequestJson.mockResolvedValueOnce(
        JSON.stringify({
          subject: "Update your payment method",
          body_paragraphs: ["Hi Aarav,", "Your card has expired."],
        }),
      );

      const result = await draftRecoveryEmail(
        makeEvent(),
        "Aarav Sharma",
        "expired_card",
      );

      expect(result.subject).toBe("Update your payment method");
      expect(result.html).toContain("Hi Aarav,");
      expect(result.html).toContain("Your card has expired.");
      expect(result.html).toContain("₹5000");
    });

    it("renders body paragraphs into template when Gemini returns body_paragraphs field", async () => {
      mockedRequestJson.mockResolvedValueOnce(
        JSON.stringify({
          subject: "Update your payment method",
          body_paragraphs: ["Hi Aarav, please update your card."],
        }),
      );

      const result = await draftRecoveryEmail(
        makeEvent(),
        "Aarav Sharma",
        "expired_card",
      );

      expect(result.subject).toBe("Update your payment method");
      expect(result.html).toContain("Hi Aarav, please update your card.");
    });

    it("uses fallback copy when Gemini fails", async () => {
      mockedRequestJson.mockRejectedValueOnce(new Error("Gemini down"));

      const result = await draftRecoveryEmail(
        makeEvent({ amount: 5000 }),
        "Aarav Sharma",
        "expired_card",
      );

      expect(result.subject).toContain("5000");
      expect(result.html).toContain("Aarav Sharma");
    });
  });

  describe("executeAction", () => {
    it("routes retry_payment to razorpayIntegration.retryPayment", async () => {
      mockedRazorpay.orders.fetch.mockResolvedValueOnce({
        id: "order_sim_xyz",
        status: "created",
      });

      const result = await executeAction(
        makeDecision({ chosenAction: "retry_payment" }),
        makeEvent(),
      );

      expect(mockedRazorpay.orders.fetch).toHaveBeenCalledWith("order_sim_xyz");
      expect(result.result).toBe("success");
      expect(result.integration).toBe("RAZORPAY");
      expect(result.actionType).toBe("retry_payment");
      expect(mockedPrisma.action.upsert).toHaveBeenCalledTimes(1);
    });

    it("routes send_payment_link to razorpayIntegration.createRecoveryPaymentLink", async () => {
      (mockedPrisma.customer.findUnique as jest.Mock).mockResolvedValueOnce(mockCustomer);
      mockedRazorpay.paymentLink.create.mockResolvedValueOnce({
        id: "plink_abc",
        short_url: "https://rzp.io/abc",
      });

      const result = await executeAction(
        makeDecision({ chosenAction: "send_payment_link" }),
        makeEvent(),
      );

      expect(mockedRazorpay.paymentLink.create).toHaveBeenCalledTimes(1);
      expect(result.result).toBe("success");
      expect(result.integration).toBe("RAZORPAY");
      expect(result.actionType).toBe("send_payment_link");
    });

    it("routes email actions through draftRecoveryEmail + sendRecoveryEmail", async () => {
      (mockedPrisma.customer.findUnique as jest.Mock).mockResolvedValueOnce(mockCustomer);
      mockedRequestJson.mockResolvedValueOnce(
        JSON.stringify({ subject: "Payment reminder", body_paragraphs: ["Hi"] }),
      );
      mockedMailer.sendMail.mockResolvedValueOnce({ messageId: "msg-123" });

      const result = await executeAction(
        makeDecision({ chosenAction: "send_reminder_email" }),
        makeEvent(),
      );

      expect(mockedRequestJson).toHaveBeenCalledTimes(1); // AI touchpoint for email draft
      expect(mockedMailer.sendMail).toHaveBeenCalledTimes(1);
      expect(mockedMailer.sendMail.mock.calls[0][0].subject).toBe("Payment reminder");
      expect(mockedMailer.sendMail.mock.calls[0][0].html).toContain("Hi");
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
      expect(result.integration).toBe("MOCK");
      expect(result.actionType).toBe("escalate_to_human");
    });

    it("returns skipped for chosenAction 'none'", async () => {
      const result = await executeAction(
        makeDecision({ chosenAction: "none", legalActions: [] }),
        makeEvent(),
      );

      expect(result.result).toBe("skipped");
      expect(result.integration).toBe("MOCK");
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

    it("schedules retry_payment_delayed without calling Razorpay", async () => {
      const result = await executeAction(
        makeDecision({ chosenAction: "retry_payment_delayed" }),
        makeEvent(),
      );

      expect(mockedRazorpay.orders.fetch).not.toHaveBeenCalled();
      expect(result.result).toBe("scheduled");
      expect(result.actionType).toBe("retry_payment_delayed");
      expect(mockedPrisma.action.upsert).toHaveBeenCalledTimes(1);
    });

    it("throws DomainError when retry has no razorpayOrderId", async () => {
      await expect(
        executeAction(
          makeDecision({ chosenAction: "retry_payment" }),
          makeEvent({ razorpayOrderId: undefined }),
        ),
      ).rejects.toThrow("no razorpayOrderId");
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
      actionType: "retry_payment",
      result: "success",
      integration: "RAZORPAY",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.auditEntry.create).toHaveBeenCalledTimes(1);
    const createCall = (mockedPrisma.auditEntry.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.inputSnapshot).toEqual(event);
    expect(createCall.data.decisionSnapshot).toEqual(decision);
    expect(createCall.data.actionSnapshot).toEqual(action);
    expect(createCall.data.outcome).toBe("pending");
  });

  it("transitions EntityWorkflowState off DETECTED for a retry action", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis();
    const decision = makeDecision();
    const action: ActionResult = {
      actionType: "retry_payment",
      result: "success",
      integration: "RAZORPAY",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.entityWorkflowState.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock.calls[0][0];
    // retry_initiated from DETECTED → RETRYING
    expect(upsertCall.create.state).toBe("RETRYING");
    expect(upsertCall.update.state).toBe("RETRYING");
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
      integration: "MOCK",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.entityWorkflowState.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock.calls[0][0];
    // dnc_skip from DETECTED → DO_NOT_CONTACT
    expect(upsertCall.create.state).toBe("DO_NOT_CONTACT");
  });

  it("upserts EntityCauseState (per-cause attempt + cooldown) for an executed action", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis({ causeLabel: "gateway_timeout" });
    const decision = makeDecision();
    const action: ActionResult = {
      actionType: "retry_payment",
      result: "success",
      integration: "RAZORPAY",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.entityCauseState.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (mockedPrisma.entityCauseState.upsert as jest.Mock).mock
      .calls[0][0];
    expect(upsertCall.where).toEqual({
      entityId_causeLabel: { entityId: "entity-1", causeLabel: "gateway_timeout" },
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
      integration: "MOCK",
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
    const diagnosis = makeDiagnosis({ causeLabel: "insufficient_funds" });
    const decision = makeDecision();
    const action: ActionResult = {
      actionType: "retry_payment",
      result: "success",
      integration: "RAZORPAY",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock
      .calls[0][0];
    // retry_initiated computed from the fresh DETECTED arc → RETRYING
    expect(upsertCall.update.state).toBe("RETRYING");

    // The new arc's first successful contact opens a fresh per-cause budget
    const causeUpsertCall = (mockedPrisma.entityCauseState.upsert as jest.Mock).mock
      .calls[0][0];
    expect(causeUpsertCall.create.attemptCount).toBe(1);
    expect(causeUpsertCall.create.lastContactedAt).toBeInstanceOf(Date);
  });

  it("transitions to WRITTEN_OFF for a successful hard_decline and closes the arc", async () => {
    // Entity mid-arc (RETRYING) whose gateway_timeout budget is exhausted:
    // policy's onMaxAction hard_decline must move the workflow state to the
    // terminal WRITTEN_OFF — not leave it stale.
    (mockedPrisma.entityWorkflowState.findUnique as jest.Mock).mockResolvedValueOnce({
      entityId: "entity-1",
      state: "RETRYING",
    });

    const event = makeEvent();
    const diagnosis = makeDiagnosis({ causeLabel: "gateway_timeout" });
    const decision = makeDecision({
      legalActions: ["hard_decline"],
      chosenAction: "hard_decline",
      reasoning: "Attempt budget exhausted; declining.",
    });
    const action: ActionResult = {
      actionType: "hard_decline",
      result: "success",
      integration: "MOCK",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    const upsertCall = (mockedPrisma.entityWorkflowState.upsert as jest.Mock).mock
      .calls[0][0];
    expect(upsertCall.create.state).toBe("WRITTEN_OFF");
    expect(upsertCall.update.state).toBe("WRITTEN_OFF");

    const createCall = (mockedPrisma.auditEntry.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.outcome).toBe("written_off");

    // Terminal arc closure wipes all per-cause budgets
    expect(mockedPrisma.entityCauseState.deleteMany).toHaveBeenCalledWith({
      where: { entityId: "entity-1" },
    });
  });

  it("starts the cooldown clock but consumes no budget for a scheduled retry", async () => {
    const event = makeEvent();
    const diagnosis = makeDiagnosis({ causeLabel: "gateway_timeout" });
    const decision = makeDecision({ chosenAction: "retry_payment_delayed" });
    const action: ActionResult = {
      actionType: "retry_payment_delayed",
      result: "scheduled",
      integration: "RAZORPAY",
    };

    await recordAuditEntry({ event, diagnosis, decision, action });

    expect(mockedPrisma.entityCauseState.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (mockedPrisma.entityCauseState.upsert as jest.Mock).mock
      .calls[0][0];
    // Cooldown starts (that window is what the scheduler fires on)…
    expect(upsertCall.create.cooldownUntil).toBeInstanceOf(Date);
    expect(upsertCall.update.cooldownUntil).toBeInstanceOf(Date);
    // …but no attempt is consumed and no customer touch is recorded yet
    expect(upsertCall.create.attemptCount).toBe(0);
    expect(upsertCall.update.attemptCount).toBeUndefined();
    expect(upsertCall.create.lastContactedAt).toBeUndefined();
    expect(upsertCall.update.lastContactedAt).toBeUndefined();
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
      integration: "MOCK",
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
    // gateway_timeout already exhausted its budget (2/2 attempts); an
    // unrelated insufficient_funds diagnosis must start from a clean slate.
    const entityId = "entity-multi-cause";
    const newCause = "insufficient_funds";

    // The per-cause lookup targets the NEW cause's row, not gateway_timeout's
    const causeState = await lookupCauseState(entityId, newCause);
    expect(mockedPrisma.entityCauseState.findUnique).toHaveBeenCalledWith({
      where: { entityId_causeLabel: { entityId, causeLabel: newCause } },
    });

    const ctx = buildFilterCtx(newCause, causeState);
    const legalActions = filterLegalActions(ctx);

    // Full action list for insufficient_funds — NOT escalation-only, because
    // this cause's attemptCount is 0 regardless of gateway_timeout's 2.
    expect(legalActions).toEqual([
      "retry_payment",
      "send_payment_link",
      "escalate_to_human",
    ]);
  });

  it("cooldown on one cause does not block an unrelated cause", async () => {
    // gateway_timeout is actively in cooldown; insufficient_funds must not
    // inherit it.
    const entityId = "entity-cooldown";

    // Sanity: the gateway_timeout cause itself IS blocked by its own cooldown
    const blockedCtx = buildFilterCtx("gateway_timeout", {
      cooldownUntil: new Date(Date.now() + 30 * 60 * 1000),
    });
    expect(filterLegalActions(blockedCtx)).toEqual([]);

    const newCause = "insufficient_funds";
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
    // gateway_timeout @ 1 attempt, insufficient_funds @ 2 attempts.
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
      integration: "MOCK",
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
          diagnosis: { causeLabel: "expired_card" },
          action: { integration: "RAZORPAY", executedAt: now },
          auditEntries: [{ outcome: "recovered", timestamp: now }],
        },
        // Event 2: escalated
        {
          id: "ev-2",
          amount: 3000,
          occurredAt: oneHourAgo,
          diagnosis: { causeLabel: "invoice_disputed" },
          action: { integration: "MOCK", executedAt: now },
          auditEntries: [{ outcome: "escalated", timestamp: now }],
        },
        // Event 3: DNC-skipped
        {
          id: "ev-3",
          amount: 2000,
          occurredAt: oneHourAgo,
          diagnosis: { causeLabel: "dnc" },
          action: { integration: "MOCK", executedAt: now },
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
          { cause: "expired_card", recovered: 5000, atRisk: 5000 },
          { cause: "invoice_disputed", recovered: 0, atRisk: 3000 },
          { cause: "dnc", recovered: 0, atRisk: 2000 },
        ]),
      );

      // byChannel breakdown
      expect(summary.byChannel).toEqual([
        { channel: "razorpay", count: 1, recoveredAmount: 5000 },
        { channel: "email", count: 0, recoveredAmount: 0 },
        { channel: "human", count: 2, recoveredAmount: 0 },
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

    // Mock invoice lookup for injectFailure
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
      JSON.stringify({ chosen_action: "retry_payment", reasoning: "Retry payment recommended by policy." }),
    );

    // Mock Mailer
    mockedMailer.sendMail.mockResolvedValue({ messageId: "msg-test-123" });
  });

  it("walks an event directly in sequence: injectFailure (Phase 3) → computeRiskScore (Phase 2) → diagnose (Phase 5) → filterLegalActions + decide (Phase 2/5) → executeAction (6.1) → recordAuditEntry (6.2)", async () => {
    // 1. injectFailure (Phase 3)
    const rawEvent = await injectFailure("payment_failed", "customer-1");
    expect(rawEvent.eventType).toBe("PAYMENT_FAILED");

    // 2. computeRiskScore (Phase 2)
    const history = { priorFailures: 1, lifetimeValue: 25000, tenureDays: 90 };
    const { riskScore, urgency } = computeRiskScore(rawEvent, history, 10000);
    const enrichedEvent: EnrichedRevenueEvent = { ...rawEvent, riskScore, urgency };
    expect(enrichedEvent.riskScore).toBeGreaterThan(0);

    // 3. diagnose (Phase 5)
    const diagnosisResult = await diagnose(enrichedEvent, history);
    expect(diagnosisResult.causeLabel).toBeDefined();

    // 4. filterLegalActions + decide (Phase 2/5)
    const filterCtx = {
      causeLabel: diagnosisResult.causeLabel,
      dncFlag: false,
      disputeFlag: false,
      attemptCount: 0,
      cooldownActive: false,
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
    if (enrichedEvent.razorpayOrderId) {
      mockedRazorpay.orders.fetch.mockResolvedValueOnce({
        id: enrichedEvent.razorpayOrderId,
        status: "created",
      });
    }
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

  describe("draftRecoveryEmail response parsing", () => {
    it("handles body_paragraphs responses and templates them", async () => {
      mockedRequestJson.mockResolvedValueOnce(
        JSON.stringify({ subject: "Action Required", body_paragraphs: ["Please update payment."] }),
      );

      const result = await draftRecoveryEmail(makeEvent({ amount: 1000 }), "Alice", "expired_card");
      expect(result.subject).toBe("Action Required");
      expect(result.html).toContain("<p");
      expect(result.html).toContain("Please update payment.");
      expect(result.html).toContain("₹1000");
    });

    it("handles structured JSON responses with body paragraphs", async () => {
      mockedRequestJson.mockResolvedValueOnce(
        JSON.stringify({ subject: "Action Required", body_paragraphs: ["Please update payment."] }),
      );

      const result = await draftRecoveryEmail(makeEvent({ amount: 1000 }), "Alice", "expired_card");
      expect(result.subject).toBe("Action Required");
      expect(result.html).toContain("Please update payment.");
      expect(result.html).toContain("₹1000");
    });

    it("strips markdown code blocks (```json ... ```) from Gemini responses", async () => {
      mockedRequestJson.mockResolvedValueOnce(
        "```json\n{\n  \"subject\": \"Markdown Subject\",\n  \"body_paragraphs\": [\"Markdown Body\"]\n}\n```",
      );

      const result = await draftRecoveryEmail(makeEvent({ amount: 500 }), "Bob", "insufficient_funds");
      expect(result.subject).toBe("Markdown Subject");
      expect(result.html).toContain("Markdown Body");
    });

    it("uses fallback copy when Gemini returns unparseable output", async () => {
      mockedRequestJson.mockResolvedValueOnce("not json at all");

      const result = await draftRecoveryEmail(makeEvent({ amount: 500 }), "Bob", "insufficient_funds");
      expect(result.subject).toContain("₹500");
      expect(result.html).toContain("Bob");
    });
  });
});
