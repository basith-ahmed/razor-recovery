/**
 * Tests for policy.ts and stoppingRules.ts (filterLegalActions).
 * One test per rule in policy.json, plus DNC and dispute override tests.
 */

import {
  loadPolicy,
  getRuleForCause,
  getPolicyVersion,
  _resetCache,
} from "../src/domain/policy";
import {
  filterLegalActions,
  FilterContext,
} from "../src/domain/stoppingRules";

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

describe("policy.ts", () => {
  beforeEach(() => {
    _resetCache();
  });

  it("loadPolicy returns a valid PolicyConfig", () => {
    const policy = loadPolicy();
    expect(policy.version).toBe("1.0.0");
    expect(policy.rules).toHaveLength(9);
  });

  it("getPolicyVersion returns the version string", () => {
    expect(getPolicyVersion()).toBe("1.0.0");
  });

  it("getRuleForCause returns the correct rule", () => {
    const rule = getRuleForCause("expired_card");
    expect(rule).toBeDefined();
    expect(rule!.cause).toBe("expired_card");
    expect(rule!.actions).toContain("retry_payment");
  });

  it("getRuleForCause returns undefined for unknown cause", () => {
    expect(getRuleForCause("nonexistent_cause")).toBeUndefined();
  });

  it("loadPolicy caches the result (same reference)", () => {
    const first = loadPolicy();
    const second = loadPolicy();
    expect(first).toBe(second);
  });
});

describe("filterLegalActions", () => {
  beforeEach(() => {
    _resetCache();
  });

  // --- DNC and Dispute overrides ---

  it("DNC customer always gets [] regardless of cause", () => {
    const causes = [
      "expired_card",
      "insufficient_funds",
      "gateway_timeout",
      "price_friction",
      "no_reason_signal",
      "subscription_renewal_failed",
      "invoice_overdue",
      "invoice_disputed",
    ];

    for (const cause of causes) {
      const result = filterLegalActions(
        makeCtx({ causeLabel: cause, isDnc: true })
      );
      expect(result).toEqual([]);
    }
  });

  it("disputed invoice always gets exactly ['escalate_to_human']", () => {
    const causes = [
      "expired_card",
      "insufficient_funds",
      "gateway_timeout",
      "price_friction",
      "invoice_overdue",
    ];

    for (const cause of causes) {
      const result = filterLegalActions(
        makeCtx({ causeLabel: cause, isDisputed: true })
      );
      expect(result).toEqual(["escalate_to_human"]);
    }
  });

  it("DNC takes priority over dispute", () => {
    const result = filterLegalActions(
      makeCtx({ isDnc: true, isDisputed: true })
    );
    expect(result).toEqual([]);
  });

  // --- Per-rule tests ---

  describe("expired_card", () => {
    it("returns all actions when under maxAttempts", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "expired_card", attemptCount: 0 })
      );
      expect(result).toEqual([
        "retry_payment",
        "send_payment_link",
        "escalate_to_human",
      ]);
    });

    it("entity at attemptCount === maxAttempts gets escalation-only, not retry", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "expired_card", attemptCount: 3 })
      );
      expect(result).toEqual(["escalate_to_human"]);
      expect(result).not.toContain("retry_payment");
    });

    it("returns [] when in cooldown", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "expired_card", isInCooldown: true })
      );
      expect(result).toEqual([]);
    });
  });

  describe("insufficient_funds", () => {
    it("returns all actions when under maxAttempts", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "insufficient_funds", attemptCount: 1 })
      );
      expect(result).toEqual([
        "retry_payment",
        "send_payment_link",
        "escalate_to_human",
      ]);
    });

    it("escalates at maxAttempts", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "insufficient_funds", attemptCount: 3 })
      );
      expect(result).toEqual(["escalate_to_human"]);
    });
  });

  describe("gateway_timeout", () => {
    it("returns retry actions when under maxAttempts", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "gateway_timeout", attemptCount: 0 })
      );
      expect(result).toEqual([
        "retry_payment_immediate",
        "retry_payment_delayed",
      ]);
    });

    it("returns hard_decline at maxAttempts (onMaxEscalate=false)", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "gateway_timeout", attemptCount: 2 })
      );
      expect(result).toEqual(["hard_decline"]);
    });
  });

  describe("price_friction", () => {
    it("returns send_reminder_email when under maxAttempts", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "price_friction", attemptCount: 0 })
      );
      expect(result).toEqual(["send_reminder_email"]);
    });

    it("escalates when maxAttempts reached", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "price_friction", attemptCount: 2 })
      );
      expect(result).toEqual(["escalate_to_human"]);
    });
  });

  describe("no_reason_signal", () => {
    it("returns reminder email within response window", () => {
      const result = filterLegalActions(
        makeCtx({
          causeLabel: "no_reason_signal",
          daysSinceLastContact: 1,
        })
      );
      expect(result).toEqual(["send_reminder_email"]);
    });

    it("returns [] when noResponseWithinHours exceeded (onTimeoutAction=stop)", () => {
      const result = filterLegalActions(
        makeCtx({
          causeLabel: "no_reason_signal",
          daysSinceLastContact: 3, // 72 hours > 48 threshold
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe("subscription_renewal_failed", () => {
    it("returns all dunning actions when under hardStopDays", () => {
      const result = filterLegalActions(
        makeCtx({
          causeLabel: "subscription_renewal_failed",
          daysOverdue: 5,
        })
      );
      expect(result).toEqual([
        "send_dunning_email_1",
        "send_dunning_email_2",
        "send_dunning_email_3",
        "pause_subscription",
        "send_winback_offer",
      ]);
    });

    it("returns auto_cancel when past hardStopDays", () => {
      const result = filterLegalActions(
        makeCtx({
          causeLabel: "subscription_renewal_failed",
          daysOverdue: 21,
        })
      );
      expect(result).toEqual(["auto_cancel"]);
    });
  });

  describe("invoice_overdue", () => {
    it("returns all actions for overdue invoice under escalation threshold", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "invoice_overdue", daysOverdue: 10 })
      );
      expect(result).toEqual([
        "send_reminder",
        "send_soft_chase_email",
        "escalate_to_human",
        "start_promise_to_pay_tracking",
      ]);
    });

    it("includes escalate_to_human when past escalateAtDays", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "invoice_overdue", daysOverdue: 35 })
      );
      expect(result).toContain("escalate_to_human");
    });
  });

  describe("invoice_disputed", () => {
    it("returns only escalate_to_human (freezeWorkflow)", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "invoice_disputed" })
      );
      expect(result).toEqual(["escalate_to_human"]);
    });
  });

  describe("dnc rule", () => {
    it("returns [] for dnc cause (skipAndLog)", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "dnc" })
      );
      expect(result).toEqual([]);
    });
  });

  describe("unknown cause", () => {
    it("returns [] for an unknown cause", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "totally_unknown" })
      );
      expect(result).toEqual([]);
    });
  });
});
