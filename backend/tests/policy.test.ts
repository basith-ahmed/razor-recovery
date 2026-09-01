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
  evaluateLegalActions,
  filterLegalActions,
  FilterContext,
} from "../src/domain/stoppingRules";

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

describe("policy.ts", () => {
  beforeEach(() => {
    _resetCache();
  });

  it("loadPolicy returns the v2 revenue-leakage policy", () => {
    const policy = loadPolicy();
    expect(policy.version).toBe("2.3.0");
    expect(policy.rules).toHaveLength(5);
  });

  it("getPolicyVersion returns the version string", () => {
    expect(getPolicyVersion()).toBe("2.3.0");
  });

  it("getRuleForCause returns the correct rule", () => {
    const rule = getRuleForCause("cart_abandoned");
    expect(rule).toBeDefined();
    expect(rule!.cause).toBe("cart_abandoned");
    expect(rule!.actions).toContain("send_reminder_email");
    expect(rule!.escalateAboveAmount).toBe(10000);
  });

  it("mandate rule offers the winback retention flow instead of value escalation", () => {
    const rule = getRuleForCause("mandate_requires_reauthorization");
    expect(rule).toBeDefined();
    expect(rule!.actions).toEqual(
      expect.arrayContaining(["send_reminder_email", "send_winback_offer", "pause_subscription", "escalate_to_human"])
    );
    expect(rule!.winback).toEqual({ discountPercent: 20 });
    expect(rule!.escalateAboveAmount).toBeUndefined();
    expect(rule!.stopping.hardStopDays).toBe(30);
  });

  it("getRuleForCause returns undefined for unknown cause", () => {
    expect(getRuleForCause("nonexistent_cause")).toBeUndefined();
  });

  it("loadPolicy caches the result (same reference)", () => {
    const first = loadPolicy();
    const second = loadPolicy();
    expect(first).toBe(second);
  });

  it("gateway-era causes have no rules anymore", () => {
    for (const cause of [
      "expired_card",
      "insufficient_funds",
      "gateway_timeout",
      "price_friction",
      "mandate_execution_failed_retryable",
    ]) {
      expect(getRuleForCause(cause)).toBeUndefined();
    }
  });
});

describe("filterLegalActions", () => {
  beforeEach(() => {
    _resetCache();
  });

  // --- Global overrides ---

  it("DNC customer always gets [] regardless of cause", () => {
    const causes = [
      "cart_abandoned",
      "invoice_overdue",
      "invoice_disputed",
      "mandate_requires_reauthorization",
      "no_reason_signal",
      "promise_broken",
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
      "cart_abandoned",
      "invoice_overdue",
      "no_reason_signal",
      "mandate_requires_reauthorization",
    ];

    for (const cause of causes) {
      const result = filterLegalActions(
        makeCtx({ causeLabel: cause, isDisputed: true })
      );
      expect(result).toEqual(["escalate_to_human"]);
    }
  });

  it("already recovered entity always gets [] regardless of cause", () => {
    const causes = [
      "cart_abandoned",
      "invoice_overdue",
      "mandate_requires_reauthorization",
      "no_reason_signal",
    ];

    for (const cause of causes) {
      const result = filterLegalActions(
        makeCtx({ causeLabel: cause, isRecovered: true })
      );
      expect(result).toEqual([]);
    }
  });

  it("returns [] for any cause when entity is already isEscalated", () => {
    const causes = [
      "cart_abandoned",
      "invoice_overdue",
      "mandate_requires_reauthorization",
      "no_reason_signal",
    ];

    for (const cause of causes) {
      const result = filterLegalActions(
        makeCtx({ causeLabel: cause, isEscalated: true })
      );
      expect(result).toEqual([]);
    }
  });

  it("returns [] when customer has active unbroken promise to pay", () => {
    const result = filterLegalActions(
      makeCtx({ causeLabel: "invoice_overdue", hasActivePromise: true })
    );
    expect(result).toEqual([]);
  });

  it("DNC takes priority over dispute", () => {
    const result = filterLegalActions(
      makeCtx({ isDnc: true, isDisputed: true })
    );
    expect(result).toEqual([]);
  });

  // --- Per-rule tests ---

  describe("cart_abandoned", () => {
    it("returns reminder and escalation when under maxAttempts", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "cart_abandoned", attemptCount: 0 })
      );
      expect(result).toEqual([
        "send_reminder_email",
        "escalate_to_human",
      ]);
    });

    it("escalates at maxAttempts (2)", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "cart_abandoned", attemptCount: 2 })
      );
      expect(result).toEqual(["escalate_to_human"]);
    });

    it("returns [] when in cooldown", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "cart_abandoned", isInCooldown: true })
      );
      expect(result).toEqual([]);
    });
  });

  describe("invoice_overdue", () => {
    it("returns the dunning ladder when under maxAttempts", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "invoice_overdue", attemptCount: 1 })
      );
      expect(result).toEqual([
        "send_reminder_email",
        "send_soft_chase_email",
        "escalate_to_human",
      ]);
    });

    it("escalates at maxAttempts (3)", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "invoice_overdue", attemptCount: 3 })
      );
      expect(result).toEqual(["escalate_to_human"]);
    });
  });

  describe("mandate_requires_reauthorization", () => {
    it("returns re-auth flow actions when under hardStopDays", () => {
      const result = filterLegalActions(
        makeCtx({
          causeLabel: "mandate_requires_reauthorization",
          daysOverdue: 5,
        })
      );
      expect(result).toEqual([
        "send_reminder_email",
        "send_winback_offer",
        "pause_subscription",
        "escalate_to_human",
      ]);
    });

    it("returns escalate_to_human when past hardStopDays", () => {
      const result = filterLegalActions(
        makeCtx({
          causeLabel: "mandate_requires_reauthorization",
          daysOverdue: 30,
        })
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

    it("returns [] when noResponseWithinHours exceeded", () => {
      const result = filterLegalActions(
        makeCtx({
          causeLabel: "no_reason_signal",
          daysSinceLastContact: 3, // 72 hours > 48 threshold
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe("promise_broken", () => {
    it("returns only escalate_to_human", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "promise_broken", attemptCount: 0 })
      );
      expect(result).toEqual(["escalate_to_human"]);
    });

    it("returns escalate_to_human even at maxAttempts", () => {
      const result = filterLegalActions(
        makeCtx({ causeLabel: "promise_broken", attemptCount: 1 })
      );
      expect(result).toEqual(["escalate_to_human"]);
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

describe("evaluateLegalActions", () => {
  beforeEach(() => {
    _resetCache();
  });

  it("reports the blocking rule for global overrides", () => {
    expect(evaluateLegalActions(makeCtx({ isRecovered: true })).blockedBy).toBe("recovered");
    expect(evaluateLegalActions(makeCtx({ isEscalated: true })).blockedBy).toBe("escalated");
    expect(evaluateLegalActions(makeCtx({ isDnc: true })).blockedBy).toBe("dnc");
    expect(evaluateLegalActions(makeCtx({ hasActivePromise: true })).blockedBy).toBe("active_promise");
    expect(evaluateLegalActions(makeCtx({ isInCooldown: true })).blockedBy).toBe("cooldown");
    expect(evaluateLegalActions(makeCtx({ isDisputed: true })).blockedBy).toBe("disputed");
    expect(
      evaluateLegalActions(makeCtx({ causeLabel: "promise_broken" })).blockedBy
    ).toBe("promise_broken");
    expect(
      evaluateLegalActions(makeCtx({ causeLabel: "totally_unknown" })).blockedBy
    ).toBe("unknown_cause");
  });

  it("reports the escalate_to_human restriction alongside its trigger", () => {
    const disputed = evaluateLegalActions(makeCtx({ isDisputed: true }));
    expect(disputed.actions).toEqual(["escalate_to_human"]);
    expect(disputed.blockedBy).toBe("disputed");

    const broken = evaluateLegalActions(makeCtx({ causeLabel: "promise_broken" }));
    expect(broken.actions).toEqual(["escalate_to_human"]);
    expect(broken.blockedBy).toBe("promise_broken");
  });

  it("reports which stopping condition fired", () => {
    const maxed = evaluateLegalActions(
      makeCtx({ causeLabel: "cart_abandoned", attemptCount: 2 })
    );
    expect(maxed.actions).toEqual(["escalate_to_human"]);
    expect(maxed.blockedBy).toBe("max_attempts");

    const hardStopped = evaluateLegalActions(
      makeCtx({ causeLabel: "mandate_requires_reauthorization", daysOverdue: 30 })
    );
    expect(hardStopped.actions).toEqual(["escalate_to_human"]);
    expect(hardStopped.blockedBy).toBe("hard_stop");

    const timedOut = evaluateLegalActions(
      makeCtx({ causeLabel: "no_reason_signal", hoursSinceLastContact: 48 })
    );
    expect(timedOut.actions).toEqual([]);
    expect(timedOut.blockedBy).toBe("no_response");
  });

  it("omits blockedBy when the cause's default action list applies", () => {
    const result = evaluateLegalActions(makeCtx({ causeLabel: "cart_abandoned" }));
    expect(result.actions).toEqual([
      "send_reminder_email",
      "escalate_to_human",
    ]);
    expect(result.blockedBy).toBeUndefined();
  });

  it("filterLegalActions stays equivalent to evaluateLegalActions().actions", () => {
    for (const ctx of [
      makeCtx({ causeLabel: "cart_abandoned" }),
      makeCtx({ causeLabel: "invoice_overdue", isDnc: true }),
      makeCtx({ causeLabel: "cart_abandoned", isInCooldown: true }),
      makeCtx({ causeLabel: "invoice_overdue", attemptCount: 3 }),
      makeCtx({ causeLabel: "totally_unknown" }),
    ]) {
      expect(filterLegalActions(ctx)).toEqual(evaluateLegalActions(ctx).actions);
    }
  });
});
