/**
 * Tests for the revenue-leakage diagnosis + mandate policy.
 *
 * Covers:
 *  1. New cause taxonomy (CAUSE_LABELS) — gateway-era causes are gone
 *  2. Rule-based routing for SUBSCRIPTION_MANDATE_CANCELLED events
 *  3. Rule-based routing for INVOICE_OVERDUE (plain + disputed)
 *  4. Rule-based routing for CHECKOUT_ABANDONED
 *  5. Promise-broken marker routing
 *  6. Policy stopping rules for mandate_requires_reauthorization (hard stop)
 *  7. Pause-subscription execution on SUBSCRIPTION entities
 */

jest.mock("../src/config/mailer", () => ({
  mailer: { sendMail: jest.fn().mockResolvedValue({ messageId: "mock-msg-123" }) },
}));

jest.mock("../src/config/razorpay", () => ({
  razorpay: {
    subscriptions: {
      pause: jest.fn().mockResolvedValue({ id: "sub-12345", status: "paused" }),
    },
  },
}));

jest.mock("../src/config/prisma", () => ({
  prisma: {
    customer: {
      findUnique: jest.fn().mockResolvedValue({
        id: "cust-1",
        name: "Test Customer",
        email: "test@example.com",
        phone: "+919876543210",
        dncFlag: false,
      }),
    },
    action: {
      create: jest.fn().mockResolvedValue({ id: "action-1" }),
      upsert: jest.fn().mockResolvedValue({ id: "action-1" }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    promiseToPay: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    ticket: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    revenueEvent: {
      findUnique: jest.fn().mockResolvedValue({ id: "mock-event-id" }),
    },
  },
}));

import {
  CAUSE_LABELS,
  REAUTH_REQUIRED_MANDATE_STATUSES,
  diagnose,
} from "../src/services/diagnosisService";
import { filterLegalActions, FilterContext } from "../src/domain/stoppingRules";
import { _resetCache } from "../src/domain/policy";
import { EnrichedRevenueEvent } from "../src/domain/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    causeLabel: "invoice_overdue",
    customerId: "cust-1",
    isDnc: false,
    isDisputed: false,
    attemptCount: 0,
    isInCooldown: false,
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<EnrichedRevenueEvent> = {},
): EnrichedRevenueEvent {
  return {
    id: "ev-1",
    entityType: "INVOICE",
    entityId: "inv-1",
    customerId: "cust-1",
    eventType: "INVOICE_OVERDUE",
    amount: 48000,
    currency: "INR",
    occurredAt: new Date().toISOString(),
    rawPayload: {},
    riskScore: 0.5,
    urgency: 0.5,
    ...overrides,
  } as EnrichedRevenueEvent;
}

// ── Cause Label Tests ─────────────────────────────────────────────────────────

describe("CAUSE_LABELS — revenue-leakage taxonomy", () => {
  it("includes all 7 recovery causes", () => {
    expect(CAUSE_LABELS).toEqual(
      expect.arrayContaining([
        "cart_abandoned",
        "invoice_overdue",
        "invoice_disputed",
        "mandate_requires_reauthorization",
        "no_reason_signal",
        "dnc",
        "promise_broken",
      ]),
    );
    expect(CAUSE_LABELS).toHaveLength(7);
  });

  it("does NOT include gateway-era payment-failure causes", () => {
    expect(CAUSE_LABELS).not.toContain("expired_card");
    expect(CAUSE_LABELS).not.toContain("insufficient_funds");
    expect(CAUSE_LABELS).not.toContain("gateway_timeout");
    expect(CAUSE_LABELS).not.toContain("price_friction");
    expect(CAUSE_LABELS).not.toContain("mandate_execution_failed_retryable");
  });
});

describe("REAUTH_REQUIRED_MANDATE_STATUSES", () => {
  it("treats cancelled, halted, revoked, expired and paused as re-auth required", () => {
    expect(REAUTH_REQUIRED_MANDATE_STATUSES).toEqual(
      new Set(["cancelled", "halted", "revoked", "expired", "paused"]),
    );
  });
});

// ── diagnose() Routing Tests ──────────────────────────────────────────────────

jest.mock("../src/config/openai", () => ({ requestJson: jest.fn() }));
jest.mock("../src/services/retrievalService", () => ({
  findSimilarCases: jest.fn().mockResolvedValue([]),
}));

describe("diagnose() — SUBSCRIPTION_MANDATE_CANCELLED mandate routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const history = { priorFailures: 0, lifetimeValue: 1000, tenureDays: 90 };

  it("Test 1: mandate_status=cancelled → mandate_requires_reauthorization (RULE)", async () => {
    const event = makeEvent({
      entityType: "SUBSCRIPTION",
      entityId: "sub-1",
      eventType: "SUBSCRIPTION_MANDATE_CANCELLED",
      amount: 999,
      rawPayload: { mandate_status: "cancelled", mandate_ref: "rzp.abc123@bankpsp" },
    });
    const result = await diagnose(event, history);
    expect(result.causeLabel).toBe("mandate_requires_reauthorization");
    expect(result.method).toBe("RULE");
    expect(result.confidence).toBe(1);
    expect(result.reasoning).toContain("cancelled");
    expect(result.reasoning).toContain("rzp.abc123@bankpsp");
  });

  it("Test 2: subscription_status=halted signal → mandate_requires_reauthorization (RULE)", async () => {
    const event = makeEvent({
      entityType: "SUBSCRIPTION",
      eventType: "SUBSCRIPTION_MANDATE_CANCELLED",
      rawPayload: { subscription_status: "halted" },
    });
    const result = await diagnose(event, history);
    expect(result.causeLabel).toBe("mandate_requires_reauthorization");
    expect(result.method).toBe("RULE");
  });

  it("Test 3: unknown mandate status falls through to LLM", async () => {
    const { requestJson } = await import("../src/config/openai");
    (requestJson as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ cause_label: "no_reason_signal", confidence: 0.6, reasoning: "No clear signal." })
    );
    const event = makeEvent({
      entityType: "SUBSCRIPTION",
      eventType: "SUBSCRIPTION_MANDATE_CANCELLED",
      rawPayload: {},
    });
    const result = await diagnose(event, history);
    expect(result.method).toBe("LLM");
  });
});

describe("diagnose() — INVOICE_OVERDUE routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const history = { priorFailures: 0, lifetimeValue: 1000, tenureDays: 90 };

  it("Test 4: plain overdue invoice → invoice_overdue (RULE) with days overdue in reasoning", async () => {
    const event = makeEvent({
      rawPayload: { disputeFlag: false, daysOverdue: 12 },
    });
    const result = await diagnose(event, history);
    expect(result.causeLabel).toBe("invoice_overdue");
    expect(result.method).toBe("RULE");
    expect(result.confidence).toBe(1);
    expect(result.reasoning).toContain("12 day(s)");
  });

  it("Test 5: disputed invoice → invoice_disputed (RULE), never LLM", async () => {
    const { requestJson } = await import("../src/config/openai");
    const event = makeEvent({
      rawPayload: { disputeFlag: true },
    });
    const result = await diagnose(event, history);
    expect(result.causeLabel).toBe("invoice_disputed");
    expect(result.method).toBe("RULE");
    expect(requestJson).not.toHaveBeenCalled();
  });
});

describe("diagnose() — CHECKOUT_ABANDONED routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const history = { priorFailures: 0, lifetimeValue: 1000, tenureDays: 90 };

  it("Test 6: abandoned cart → cart_abandoned (RULE) with idle hours in reasoning", async () => {
    const event = makeEvent({
      entityType: "CART",
      eventType: "CHECKOUT_ABANDONED",
      amount: 2400,
      rawPayload: { hoursSinceAbandon: 3, itemCount: 2 },
    });
    const result = await diagnose(event, history);
    expect(result.causeLabel).toBe("cart_abandoned");
    expect(result.method).toBe("RULE");
    expect(result.reasoning).toContain("2 item(s)");
    expect(result.reasoning).toContain("3h");
  });
});

describe("diagnose() — promise_broken marker routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Test 7: followUp marker promise_broken → promise_broken (RULE)", async () => {
    const event = makeEvent({
      rawPayload: { followUp: { type: "promise_broken" } },
    });
    const result = await diagnose(event, { priorFailures: 1, lifetimeValue: 1000, tenureDays: 90 });
    expect(result.causeLabel).toBe("promise_broken");
    expect(result.method).toBe("RULE");
    expect(result.confidence).toBe(1);
  });
});

// ── Policy / Stopping Rule Tests ──────────────────────────────────────────────

describe("Policy: mandate_requires_reauthorization", () => {
  beforeEach(() => _resetCache());

  it("Test 8: attemptCount=0 — returns send_reminder_email, pause_subscription, and escalate_to_human", () => {
    const actions = filterLegalActions(makeCtx({
      causeLabel: "mandate_requires_reauthorization",
      attemptCount: 0,
    }));
    expect(actions).toContain("send_reminder_email");
    expect(actions).toContain("pause_subscription");
    expect(actions).toContain("escalate_to_human");
  });

  it("Test 9: daysOverdue=30 (hardStopDays) — returns only escalate_to_human", () => {
    const actions = filterLegalActions(makeCtx({
      causeLabel: "mandate_requires_reauthorization",
      attemptCount: 0,
      daysOverdue: 30,
    }));
    expect(actions).toEqual(["escalate_to_human"]);
  });
});

// ── Execution Tests ───────────────────────────────────────────────────────────

import { executeAction } from "../src/services/executorService";

describe("Execution: pause_subscription on Subscription", () => {
  it("Test 10: successfully pauses subscription for SUBSCRIPTION entity", async () => {
    const event = makeEvent({
      entityType: "SUBSCRIPTION",
      entityId: "sub-12345",
      eventType: "SUBSCRIPTION_MANDATE_CANCELLED",
      amount: 999,
      rawPayload: { subscription_id: "sub-12345" },
    });

    const result = await executeAction(
      {
        chosenAction: "pause_subscription",
        legalActions: ["send_reminder_email", "pause_subscription", "escalate_to_human"],
        policyVersion: "2.3.0",
        reasoning: "Pause subscription during mandate cancellation win-back window",
      },
      event,
    );

    expect(result.actionType).toBe("pause_subscription");
    expect(result.result).toBe("success");
    expect(result.integration).toBe("RAZORPAY");
  });
});
