/**
 * Risk scoring — pure, deterministic function.
 * No I/O, no network calls. Takes plain data in, returns plain data out.
 */

import { RawRevenueEvent } from "./types";

export interface CustomerHistory {
  priorFailures: number;
  lifetimeValue: number;
  tenureDays: number;
}

const EVENT_SEVERITY: Record<RawRevenueEvent["eventType"], number> = {
  PAYMENT_FAILED: 0.8,
  SUBSCRIPTION_FAILED: 0.75,
  INVOICE_OVERDUE: 0.6,
  CHECKOUT_ABANDONED: 0.4,
};

const WEIGHTS = {
  amount: 0.35,
  severity: 0.25,
  history: 0.15,
  urgency: 0.25,
};

export function computeRiskScore(
  event: RawRevenueEvent,
  history: CustomerHistory,
  batchMaxAmount: number,
  daysOverdue?: number,
  hoursSinceAbandon?: number
): { riskScore: number; revenueAtRisk: number; urgency: number } {
  const normAmount =
    batchMaxAmount > 0 ? Math.min(event.amount / batchMaxAmount, 1) : 0;
  const severity = EVENT_SEVERITY[event.eventType];
  const historyRisk = Math.min(history.priorFailures / 5, 1);

  const urgency =
    event.eventType === "INVOICE_OVERDUE"
      ? Math.min((daysOverdue ?? 0) / 30, 1)
      : event.eventType === "CHECKOUT_ABANDONED"
        ? Math.max(0, 1 - (hoursSinceAbandon ?? 0) / 48)
        : 0.5;

  const riskScore =
    WEIGHTS.amount * normAmount +
    WEIGHTS.severity * severity +
    WEIGHTS.history * historyRisk +
    WEIGHTS.urgency * urgency;

  return {
    riskScore: Number(riskScore.toFixed(3)),
    revenueAtRisk: event.amount,
    urgency,
  };
}
