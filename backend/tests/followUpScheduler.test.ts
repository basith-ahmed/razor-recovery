/**
 * Tests for followUpScheduler's pure selection logic.
 * No mocking needed — selectDueFollowUps is a pure function over state rows
 * plus the real policy.json rules.
 */

import {
  selectDueFollowUps,
  decideScheduledRetries,
  suppressPendingScheduledRetries,
  DueFollowUp,
} from "../src/scheduler/followUpScheduler";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const H = 3_600_000;

function arc(entityId: string, state: string) {
  return { entityId, state };
}

function cause(
  entityId: string,
  causeLabel: string,
  overrides: Partial<{
    attemptCount: number;
    lastContactedAt: Date | null;
    cooldownUntil: Date | null;
  }> = {},
) {
  return {
    entityId,
    causeLabel,
    attemptCount: 0,
    lastContactedAt: null,
    cooldownUntil: null,
    ...overrides,
  };
}

describe("followUpScheduler selection", () => {
  it("fires a cooldown-expiry follow-up when the window lapsed and budget remains", () => {
    const due = selectDueFollowUps(
      [arc("e1", "RETRYING")],
      [
        // gateway_timeout: maxAttempts 2 — 1 attempt used, cooldown ended 10m ago
        cause("e1", "cart_abandoned", {
          attemptCount: 1,
          lastContactedAt: new Date(NOW.getTime() - 2 * H),
          cooldownUntil: new Date(NOW.getTime() - 10 * 60_000),
        }),
      ],
      NOW,
    );
    const expected: DueFollowUp[] = [
      { entityId: "e1", causeLabel: "cart_abandoned", type: "cooldown_expired" },
    ];
    expect(due).toEqual(expected);
  });

  it("does not fire while the cooldown is still active", () => {
    const due = selectDueFollowUps(
      [arc("e1", "COOLING_DOWN")],
      [
        cause("e1", "cart_abandoned", {
          attemptCount: 1,
          lastContactedAt: new Date(NOW.getTime() - 0.5 * H),
          cooldownUntil: new Date(NOW.getTime() + 30 * 60_000),
        }),
      ],
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("does not chase a cause whose attempt budget is exhausted", () => {
    const due = selectDueFollowUps(
      [arc("e1", "RETRYING")],
      [
        // gateway_timeout at max (2/2): escalation/write-off is the policy
        // outcome — the scheduler must never re-contact beyond the budget
        cause("e1", "cart_abandoned", {
          attemptCount: 2,
          lastContactedAt: new Date(NOW.getTime() - 5 * H),
          cooldownUntil: new Date(NOW.getTime() - H),
        }),
      ],
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("skips escalated arcs entirely — a human owns them", () => {
    const due = selectDueFollowUps(
      [arc("e1", "ESCALATED")],
      [
        cause("e1", "invoice_overdue", {
          attemptCount: 1,
          lastContactedAt: new Date(NOW.getTime() - 8 * 24 * H),
          cooldownUntil: new Date(NOW.getTime() - H),
        }),
      ],
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("ignores terminal arcs even if stale rows exist", () => {
    const due = selectDueFollowUps(
      [
        arc("e1", "RECOVERED"),
        arc("e2", "WRITTEN_OFF"),
        arc("e3", "DO_NOT_CONTACT"),
      ],
      [
        cause("e1", "cart_abandoned", {
          attemptCount: 1,
          lastContactedAt: new Date(NOW.getTime() - 5 * H),
          cooldownUntil: new Date(NOW.getTime() - H),
        }),
        cause("e2", "invoice_overdue", {
          attemptCount: 1,
          lastContactedAt: new Date(NOW.getTime() - 5 * H),
          cooldownUntil: new Date(NOW.getTime() - H),
        }),
        cause("e3", "mandate_requires_reauthorization", {
          attemptCount: 1,
          lastContactedAt: new Date(NOW.getTime() - 5 * H),
          cooldownUntil: new Date(NOW.getTime() - H),
        }),
      ],
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("fires a no-response timeout once the silence threshold elapses", () => {
    const due = selectDueFollowUps(
      [arc("e1", "CONTACTED")],
      [
        // no_reason_signal: noResponseWithinHours 48, onTimeoutAction stop
        cause("e1", "no_reason_signal", {
          attemptCount: 1,
          lastContactedAt: new Date(NOW.getTime() - 50 * H),
        }),
      ],
      NOW,
    );
    const expected: DueFollowUp[] = [
      { entityId: "e1", causeLabel: "no_reason_signal", type: "no_response_timeout" },
    ];
    expect(due).toEqual(expected);
  });

  it("does not fire the no-response timeout before the threshold", () => {
    const due = selectDueFollowUps(
      [arc("e1", "CONTACTED")],
      [
        cause("e1", "no_reason_signal", {
          attemptCount: 1,
          lastContactedAt: new Date(NOW.getTime() - 10 * H),
        }),
      ],
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("causes without any timing config produce nothing", () => {
    // invoice_disputed: freezeWorkflow only, no maxAttempts/windows
    const due = selectDueFollowUps(
      [arc("e1", "CONTACTED")],
      [cause("e1", "invoice_disputed")],
      NOW,
    );
    expect(due).toEqual([]);
  });
});

describe("scheduled retry decisions", () => {
  it("dispatches a scheduled retry once its cooldown lapses (pipeline executes it)", () => {
    const decisions = decideScheduledRetries(
      [
        { id: "a1", entityId: "e1", cooldownUntil: new Date(NOW.getTime() - 5 * 60_000) },
      ],
      { e1: "RETRYING" },
      NOW,
    );
    expect(decisions).toEqual([{ actionId: "a1", verdict: "dispatch" }]);
  });

  it("holds retries whose cooldown has not lapsed yet", () => {
    const decisions = decideScheduledRetries(
      [
        { id: "a1", entityId: "e1", cooldownUntil: new Date(NOW.getTime() + 30 * 60_000) },
        { id: "a2", entityId: "e2", cooldownUntil: null },
      ],
      { e1: "COOLING_DOWN", e2: "RETRYING" },
      NOW,
    );
    expect(decisions).toEqual([]);
  });

  it("cancels retries on closed arcs instead of executing them", () => {
    const decisions = decideScheduledRetries(
      [
        { id: "a1", entityId: "e1", cooldownUntil: new Date(NOW.getTime() - H) },
        { id: "a2", entityId: "e2", cooldownUntil: new Date(NOW.getTime() - H) },
        { id: "a3", entityId: "e3", cooldownUntil: new Date(NOW.getTime() - H) },
      ],
      { e1: "RECOVERED", e2: "WRITTEN_OFF", e3: "DO_NOT_CONTACT" },
      NOW,
    );
    expect(decisions).toEqual([
      { actionId: "a1", verdict: "cancel", reason: "arc_closed" },
      { actionId: "a2", verdict: "cancel", reason: "arc_closed" },
      { actionId: "a3", verdict: "cancel", reason: "arc_closed" },
    ]);
  });

  it("cancels retries when the arc has been escalated to a human", () => {
    const decisions = decideScheduledRetries(
      [{ id: "a1", entityId: "e1", cooldownUntil: new Date(NOW.getTime() - H) }],
      { e1: "ESCALATED" },
      NOW,
    );
    expect(decisions).toEqual([
      { actionId: "a1", verdict: "cancel", reason: "escalated" },
    ]);
  });

  it("cancels retries for entities with no workflow row at all", () => {
    const decisions = decideScheduledRetries(
      [{ id: "a1", entityId: "ghost", cooldownUntil: new Date(NOW.getTime() - H) }],
      {},
      NOW,
    );
    expect(decisions).toEqual([
      { actionId: "a1", verdict: "cancel", reason: "arc_closed" },
    ]);
  });

  it("does not chase follow-ups when entity-level attemptCount budget is exhausted across all causes", () => {
    const due = selectDueFollowUps(
      // The entity itself has used 3 attempts across previous causes
      [{ entityId: "e1", state: "RETRYING", attemptCount: 3 }],
      [
        // This specific cause has 0 attempts recorded locally, but entity total is 3 (exceeding maxAttempts 3)
        cause("e1", "mandate_requires_reauthorization", {
          attemptCount: 0,
          lastContactedAt: new Date(NOW.getTime() - 5 * H),
          cooldownUntil: new Date(NOW.getTime() - H),
        }),
      ],
      NOW,
    );
    expect(due).toEqual([]);
  });
});

describe("suppressPendingScheduledRetries", () => {
  const due: DueFollowUp[] = [
    { entityId: "e1", causeLabel: "cart_abandoned", type: "cooldown_expired" },
    { entityId: "e1", causeLabel: "invoice_overdue", type: "cooldown_expired" },
    { entityId: "e2", causeLabel: "no_reason_signal", type: "no_response_timeout" },
  ];

  it("suppresses cooldown follow-ups for causes with a pending deferred retry", () => {
    const filtered = suppressPendingScheduledRetries(due, [
      { entityId: "e1", causeLabel: "cart_abandoned" },
    ]);
    // gateway_timeout has a scheduled retry — it is that cause's next contact;
    // expired_card and the no-response timeout are untouched.
    expect(filtered).toEqual([
      { entityId: "e1", causeLabel: "invoice_overdue", type: "cooldown_expired" },
      { entityId: "e2", causeLabel: "no_reason_signal", type: "no_response_timeout" },
    ]);
  });

  it("never suppresses no-response timeouts via pending retries", () => {
    const filtered = suppressPendingScheduledRetries(due, [
      { entityId: "e2", causeLabel: "no_reason_signal" },
    ]);
    expect(filtered).toEqual(due);
  });

  it("passes everything through when nothing is pending", () => {
    expect(suppressPendingScheduledRetries(due, [])).toEqual(due);
    expect(suppressPendingScheduledRetries(due, [{ entityId: "e9", causeLabel: null }])).toEqual(
      due,
    );
  });
});
