/**
 * Tests for Mandate Retry Sequencer (Phase: Mandate Retry Sequencer & Re-Authorization Loop)
 *
 * Covers:
 *  1. Diagnosis rule-based routing for SUBSCRIPTION_FAILED events
 *  2. Policy stopping rules for mandate_execution_failed_retryable
 *  3. Policy stopping rules for mandate_requires_reauthorization
 *  4. Hard gate: gateway retries are never returned for mandate_requires_reauthorization
 *  5. Card-decline subscription failure falls through to card-decline cause correctly
 *  6. LLM fallthrough for ambiguous SUBSCRIPTION_FAILED with no state signals
 */

import {
  CAUSE_MAP,
  PAYMENT_CAUSE_MAP,
  MANDATE_CAUSE_MAP,
  CAUSE_LABELS,
  diagnose,
} from "../src/services/diagnosisService";
import { filterLegalActions, FilterContext } from "../src/domain/stoppingRules";
import { _resetCache } from "../src/domain/policy";
import { EnrichedRevenueEvent } from "../src/domain/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    causeLabel: "expired_card",
    customerId: "cust-1",
    isDnc: false,
    isDisputed: false,
    attemptCount: 0,
    isInCooldown: false,
    ...overrides,
  };
}

function makeSubscriptionEvent(
  overrides: Partial<EnrichedRevenueEvent> = {},
): EnrichedRevenueEvent {
  return {
    id: "ev-mandate-1",
    entityType: "SUBSCRIPTION",
    entityId: "sub-1",
    customerId: "cust-1",
    eventType: "SUBSCRIPTION_FAILED",
    amount: 999,
    currency: "INR",
    occurredAt: new Date().toISOString(),
    rawPayload: {},
    riskScore: 0.5,
    urgency: 0.5,
    ...overrides,
  } as EnrichedRevenueEvent;
}

// ── Cause Label Tests ─────────────────────────────────────────────────────────

describe("CAUSE_LABELS", () => {
  it("includes mandate_execution_failed_retryable", () => {
    expect(CAUSE_LABELS).toContain("mandate_execution_failed_retryable");
  });

  it("includes mandate_requires_reauthorization", () => {
    expect(CAUSE_LABELS).toContain("mandate_requires_reauthorization");
  });

  it("does NOT include subscription_renewal_failed", () => {
    expect(CAUSE_LABELS).not.toContain("subscription_renewal_failed");
  });
});

// ── CAUSE_MAP Scoping Tests ───────────────────────────────────────────────────

describe("MANDATE_CAUSE_MAP & PAYMENT_CAUSE_MAP separation (no collisions)", () => {
  it("MANDATE_CAUSE_MAP maps mandate_cancelled to mandate_requires_reauthorization", () => {
    expect(MANDATE_CAUSE_MAP["mandate_cancelled"]).toBe("mandate_requires_reauthorization");
  });

  it("MANDATE_CAUSE_MAP maps mandate_creation_failed to mandate_requires_reauthorization", () => {
    expect(MANDATE_CAUSE_MAP["mandate_creation_failed"]).toBe("mandate_requires_reauthorization");
  });

  it("MANDATE_CAUSE_MAP maps subscription_halted to mandate_requires_reauthorization", () => {
    expect(MANDATE_CAUSE_MAP["subscription_halted"]).toBe("mandate_requires_reauthorization");
  });

  it("PAYMENT_CAUSE_MAP preserves standard gateway_technical_error -> gateway_timeout (no overwrite)", () => {
    expect(PAYMENT_CAUSE_MAP["gateway_technical_error"]).toBe("gateway_timeout");
    expect(PAYMENT_CAUSE_MAP["payment_failed"]).toBe("gateway_timeout");
  });
});

// ── diagnose() Routing Tests ──────────────────────────────────────────────────

jest.mock("../src/config/openai", () => ({ requestJson: jest.fn() }));
jest.mock("../src/services/retrievalService", () => ({
  findSimilarCases: jest.fn().mockResolvedValue([]),
}));

describe("diagnose() — SUBSCRIPTION_FAILED mandate routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Test 1: subscription_status=halted → mandate_requires_reauthorization (RULE)", async () => {
    const event = makeSubscriptionEvent({
      rawPayload: { subscription_status: "halted" },
    });
    const result = await diagnose(event, {
      priorFailures: 0,
      lifetimeValue: 1000,
      tenureDays: 90,
    });
    expect(result.causeLabel).toBe("mandate_requires_reauthorization");
    expect(result.method).toBe("RULE");
    expect(result.confidence).toBe(1);
  });

  it("Test 2: mandate_status=cancelled → mandate_requires_reauthorization (RULE)", async () => {
    const event = makeSubscriptionEvent({
      rawPayload: { mandate_status: "cancelled" },
    });
    const result = await diagnose(event, {
      priorFailures: 0,
      lifetimeValue: 1000,
      tenureDays: 90,
    });
    expect(result.causeLabel).toBe("mandate_requires_reauthorization");
    expect(result.method).toBe("RULE");
  });

  it("Test 3: errorReason=mandate_creation_failed → mandate_requires_reauthorization (RULE)", async () => {
    const event = makeSubscriptionEvent({
      errorReason: "mandate_creation_failed",
    });
    const result = await diagnose(event, {
      priorFailures: 0,
      lifetimeValue: 1000,
      tenureDays: 90,
    });
    expect(result.causeLabel).toBe("mandate_requires_reauthorization");
    expect(result.method).toBe("RULE");
  });

  it("Test 4: subscription_status=pending + errorReason=gateway_technical_error → mandate_execution_failed_retryable (RULE)", async () => {
    const event = makeSubscriptionEvent({
      errorReason: "gateway_technical_error",
      rawPayload: { subscription_status: "pending" },
    });
    const result = await diagnose(event, {
      priorFailures: 0,
      lifetimeValue: 1000,
      tenureDays: 90,
    });
    expect(result.causeLabel).toBe("mandate_execution_failed_retryable");
    expect(result.method).toBe("RULE");
  });

  it("Test 5 (Card fallthrough): SUBSCRIPTION_FAILED + errorReason=insufficient_fund → falls through to non-mandate cause", async () => {
    const { requestJson } = await import("../src/config/openai");
    (requestJson as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ cause_label: "insufficient_funds", confidence: 0.95, reasoning: "Card declined due to low balance on subscription renewal." })
    );
    const event = makeSubscriptionEvent({
      errorReason: "insufficient_fund",
      rawPayload: {},
    });
    const result = await diagnose(event, {
      priorFailures: 1,
      lifetimeValue: 2000,
      tenureDays: 180,
    });
    expect(result.causeLabel).not.toBe("mandate_requires_reauthorization");
    expect(result.causeLabel).not.toBe("mandate_execution_failed_retryable");
  });

  it("Test 6 (LLM fallthrough): SUBSCRIPTION_FAILED with no errorReason, no subscription_status → falls to LLM", async () => {
    const { requestJson } = await import("../src/config/openai");
    (requestJson as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ cause_label: "no_reason_signal", confidence: 0.6, reasoning: "No clear signal." })
    );
    const event = makeSubscriptionEvent({ rawPayload: {} });
    const result = await diagnose(event, {
      priorFailures: 0,
      lifetimeValue: 500,
      tenureDays: 30,
    });
    expect(result.method).toBe("LLM");
  });
});

// ── Policy / Stopping Rule Tests ──────────────────────────────────────────────

describe("Policy: mandate_execution_failed_retryable", () => {
  beforeEach(() => _resetCache());

  it("Test 7: attemptCount=1 — returns retry_payment_delayed and send_payment_link", () => {
    const actions = filterLegalActions(makeCtx({
      causeLabel: "mandate_execution_failed_retryable",
      attemptCount: 1,
    }));
    expect(actions).toContain("retry_payment_delayed");
    expect(actions).toContain("send_payment_link");
    expect(actions).not.toContain("retry_payment_immediate");
  });

  it("Test 8: attemptCount=3 (onMaxAction) — returns only send_payment_link", () => {
    const actions = filterLegalActions(makeCtx({
      causeLabel: "mandate_execution_failed_retryable",
      attemptCount: 3,
    }));
    expect(actions).toEqual(["send_payment_link"]);
  });
});

describe("Policy: mandate_requires_reauthorization", () => {
  beforeEach(() => _resetCache());

  it("Test 9: attemptCount=0 — returns send_payment_link and escalate_to_human, NO gateway retries", () => {
    const actions = filterLegalActions(makeCtx({
      causeLabel: "mandate_requires_reauthorization",
      attemptCount: 0,
    }));
    expect(actions).toContain("send_payment_link");
    expect(actions).toContain("escalate_to_human");
    // Hard gate: gateway retries are strictly prohibited for halted/revoked mandates
    expect(actions).not.toContain("retry_payment_immediate");
    expect(actions).not.toContain("retry_payment_delayed");
  });

  it("Test 10: daysOverdue=30 (hardStopDays) — returns only escalate_to_human", () => {
    const actions = filterLegalActions(makeCtx({
      causeLabel: "mandate_requires_reauthorization",
      attemptCount: 0,
      daysOverdue: 30,
    }));
    expect(actions).toEqual(["escalate_to_human"]);
    expect(actions).not.toContain("retry_payment_immediate");
    expect(actions).not.toContain("retry_payment_delayed");
  });
});

// ── Execution Tests ───────────────────────────────────────────────────────────

import { executeAction } from "../src/services/executorService";

describe("Execution: retry_payment_delayed on Subscription", () => {
  it("Test 11: successfully schedules retry for SUBSCRIPTION entity without razorpayOrderId", async () => {
    const event = makeSubscriptionEvent({
      entityType: "SUBSCRIPTION",
      entityId: "sub-12345",
      razorpayOrderId: undefined,
      rawPayload: { subscription_id: "sub-12345" },
    });

    const result = await executeAction(
      {
        chosenAction: "retry_payment_delayed",
        legalActions: ["retry_payment_delayed", "send_payment_link"],
        policyVersion: "1.0.0",
        reasoning: "Schedule deferred retry",
      },
      event,
    );

    expect(result.actionType).toBe("retry_payment_delayed");
    expect(result.result).toBe("scheduled");
    expect(result.integration).toBe("RAZORPAY");
  });
});
