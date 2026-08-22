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
    batchId: "batch-1",
    entityType: "CUSTOMER",
    entityId: "ent-1",
    customerId: "cust-1",
    eventType: "PAYMENT_FAILED",
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
  it("max-amount event scores near 1.0 for the amount component", () => {
    // Event amount equals batchMaxAmount → normAmount = 1.0
    const event = makeEvent({ amount: 10000 });
    const history = makeHistory();
    const result = computeRiskScore(event, history, 10000);

    // amount component = 0.35 * 1.0 = 0.35
    // severity component = 0.25 * 0.8 = 0.20  (PAYMENT_FAILED)
    // history component = 0.15 * 0.0 = 0.00   (0 priorFailures)
    // urgency component = 0.25 * 0.5 = 0.125  (default urgency for PAYMENT_FAILED)
    // total = 0.675
    expect(result.riskScore).toBeCloseTo(0.675, 3);
    expect(result.revenueAtRisk).toBe(10000);
  });

  it("event exceeding batchMaxAmount caps normAmount at 1.0", () => {
    const event = makeEvent({ amount: 20000 });
    const result = computeRiskScore(event, makeHistory(), 10000);

    // normAmount = min(20000/10000, 1) = 1.0 (capped)
    expect(result.riskScore).toBeCloseTo(0.675, 3);
  });

  it("batchMaxAmount of 0 yields normAmount of 0", () => {
    const event = makeEvent({ amount: 5000 });
    const result = computeRiskScore(event, makeHistory(), 0);

    // amount component = 0
    // total = 0.25*0.8 + 0.15*0 + 0.25*0.5 = 0.325
    expect(result.riskScore).toBeCloseTo(0.325, 3);
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

  it("repeat-offender (priorFailures=10) caps historyRisk at 1, not above", () => {
    const history = makeHistory({ priorFailures: 10 });
    const event = makeEvent();
    const result = computeRiskScore(event, history, 10000);

    // historyRisk = min(10/5, 1) = 1.0 (capped)
    // amount = 0.35 * (1000/10000) = 0.035
    // severity = 0.25 * 0.8 = 0.20
    // history = 0.15 * 1.0 = 0.15
    // urgency = 0.25 * 0.5 = 0.125
    // total = 0.51
    expect(result.riskScore).toBeCloseTo(0.51, 3);
  });

  it("priorFailures=5 yields historyRisk=1.0 (exactly at cap)", () => {
    const history = makeHistory({ priorFailures: 5 });
    const event = makeEvent();
    const result = computeRiskScore(event, history, 10000);

    // Same as priorFailures=10 case since both cap at 1.0
    expect(result.riskScore).toBeCloseTo(0.51, 3);
  });

  it("PAYMENT_FAILED and SUBSCRIPTION_FAILED have different severities", () => {
    const history = makeHistory();
    const paymentFailed = computeRiskScore(
      makeEvent({ eventType: "PAYMENT_FAILED", amount: 5000 }),
      history,
      10000
    );
    const subFailed = computeRiskScore(
      makeEvent({ eventType: "SUBSCRIPTION_FAILED", amount: 5000 }),
      history,
      10000
    );

    // PAYMENT_FAILED severity=0.8, SUBSCRIPTION_FAILED severity=0.75
    expect(paymentFailed.riskScore).toBeGreaterThan(subFailed.riskScore);
  });

  it("returns the event amount as revenueAtRisk", () => {
    const event = makeEvent({ amount: 42000 });
    const result = computeRiskScore(event, makeHistory(), 100000);

    expect(result.revenueAtRisk).toBe(42000);
  });
});
