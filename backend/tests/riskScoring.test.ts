/**
 * Tests for computeRiskScore — pure function, no mocking needed.
 */

import { computeRiskScore, CustomerHistory } from "../src/domain/riskScoring";
import { RawRevenueEvent } from "../src/domain/types";

function makeEvent(
  overrides: Partial<RawRevenueEvent> = {}
): RawRevenueEvent {
  return {
    id: "evt-1",
    entityType: "INVOICE",
    entityId: "inv-1",
    customerId: "cust-1",
    eventType: "INVOICE_OVERDUE",
    amount: 1000,
    currency: "INR",
    occurredAt: new Date().toISOString(),
    rawPayload: {},
    ...overrides,
  };
}

function makeHistory(
  overrides: Partial<CustomerHistory> = {}
): CustomerHistory {
  return {
    priorFailures: 0,
    lifetimeValue: 5000,
    tenureDays: 90,
    ...overrides,
  };
}

describe("computeRiskScore", () => {
  it("max-amount INVOICE_OVERDUE event scores the documented total", () => {
    // Event amount equals recentMaxAmount → normAmount = 1.0
    const event = makeEvent({ amount: 10000 });
    const history = makeHistory();
    const result = computeRiskScore(event, history, 10000, 15);

    // amount component = 0.35 * 1.0 = 0.35
    // severity component = 0.25 * 0.6 = 0.15  (INVOICE_OVERDUE)
    // history component = 0.15 * 0.0 = 0.00   (0 priorFailures)
    // urgency component = 0.25 * 0.5 = 0.125  (daysOverdue=15 → 0.5)
    // total = 0.625
    expect(result.riskScore).toBeCloseTo(0.625, 3);
    expect(result.revenueAtRisk).toBe(10000);
  });

  it("event exceeding recentMaxAmount caps normAmount at 1.0", () => {
    const event = makeEvent({ amount: 20000 });
    const result = computeRiskScore(event, makeHistory(), 10000, 15);

    // normAmount = min(20000/10000, 1) = 1.0 (capped)
    expect(result.riskScore).toBeCloseTo(0.625, 3);
  });

  it("recentMaxAmount of 0 yields normAmount of 0", () => {
    const event = makeEvent({ amount: 5000 });
    const result = computeRiskScore(event, makeHistory(), 0, 15);

    // amount component = 0
    // total = 0.25*0.6 + 0.15*0 + 0.25*0.5 = 0.275
    expect(result.riskScore).toBeCloseTo(0.275, 3);
  });

  it("CHECKOUT_ABANDONED at hoursSinceAbandon=48 has urgency=0", () => {
    const event = makeEvent({ eventType: "CHECKOUT_ABANDONED" });
    const result = computeRiskScore(
      event,
      makeHistory(),
      10000,
      undefined,
      48
    );

    expect(result.urgency).toBe(0);
  });

  it("CHECKOUT_ABANDONED at hoursSinceAbandon=0 has urgency=1", () => {
    const event = makeEvent({ eventType: "CHECKOUT_ABANDONED" });
    const result = computeRiskScore(
      event,
      makeHistory(),
      10000,
      undefined,
      0
    );

    expect(result.urgency).toBe(1);
  });

  it("CHECKOUT_ABANDONED at hoursSinceAbandon=24 has urgency=0.5", () => {
    const event = makeEvent({ eventType: "CHECKOUT_ABANDONED" });
    const result = computeRiskScore(
      event,
      makeHistory(),
      10000,
      undefined,
      24
    );

    expect(result.urgency).toBe(0.5);
  });

  it("INVOICE_OVERDUE at daysOverdue=30 has urgency=1", () => {
    const event = makeEvent({ eventType: "INVOICE_OVERDUE" });
    const result = computeRiskScore(event, makeHistory(), 10000, 30);

    expect(result.urgency).toBe(1);
  });

  it("INVOICE_OVERDUE at daysOverdue=15 has urgency=0.5", () => {
    const event = makeEvent({ eventType: "INVOICE_OVERDUE" });
    const result = computeRiskScore(event, makeHistory(), 10000, 15);

    expect(result.urgency).toBe(0.5);
  });

  it("SUBSCRIPTION_MANDATE_CANCELLED without a time signal has urgency=0.5", () => {
    const event = makeEvent({ eventType: "SUBSCRIPTION_MANDATE_CANCELLED" });
    const result = computeRiskScore(event, makeHistory(), 10000);

    expect(result.urgency).toBe(0.5);
  });

  it("repeat-offender (priorFailures=10) caps historyRisk at 1, not above", () => {
    const history = makeHistory({ priorFailures: 10 });
    const event = makeEvent();
    const result = computeRiskScore(event, history, 10000, 15);

    // historyRisk = min(10/5, 1) = 1.0 (capped)
    // amount = 0.35 * (1000/10000) = 0.035
    // severity = 0.25 * 0.6 = 0.15
    // history = 0.15 * 1.0 = 0.15
    // urgency = 0.25 * 0.5 = 0.125
    // total = 0.46
    expect(result.riskScore).toBeCloseTo(0.46, 3);
  });

  it("priorFailures=5 yields historyRisk=1.0 (exactly at cap)", () => {
    const history = makeHistory({ priorFailures: 5 });
    const event = makeEvent();
    const result = computeRiskScore(event, history, 10000, 15);

    // Same as priorFailures=10 case since both cap at 1.0
    expect(result.riskScore).toBeCloseTo(0.46, 3);
  });

  it("SUBSCRIPTION_MANDATE_CANCELLED has a higher severity than INVOICE_OVERDUE", () => {
    const history = makeHistory();
    const mandate = computeRiskScore(
      makeEvent({ eventType: "SUBSCRIPTION_MANDATE_CANCELLED", amount: 5000 }),
      history,
      10000
    );
    const overdue = computeRiskScore(
      makeEvent({ eventType: "INVOICE_OVERDUE", amount: 5000 }),
      history,
      10000
    );

    // MANDATE severity=0.7, INVOICE_OVERDUE severity=0.6
    expect(mandate.riskScore).toBeGreaterThan(overdue.riskScore);
  });

  it("returns the event amount as revenueAtRisk", () => {
    const event = makeEvent({ amount: 42000 });
    const result = computeRiskScore(event, makeHistory(), 100000, 15);

    expect(result.revenueAtRisk).toBe(42000);
  });
});
