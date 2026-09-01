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
  SUBSCRIPTION_MANDATE_CANCELLED: 0.7,
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
  recentMaxAmount: number,
  daysOverdue?: number,
  hoursSinceAbandon?: number
): { riskScore: number; revenueAtRisk: number; urgency: number } {
  // recentMaxAmount is a rolling reference value (kept in Redis, updated per event)
  const normAmount =
    recentMaxAmount > 0 ? Math.min(event.amount / recentMaxAmount, 1) : 0;
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
