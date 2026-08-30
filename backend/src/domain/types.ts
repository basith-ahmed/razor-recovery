/**
 * Shared TypeScript types/interfaces used across the whole backend.
 * Mirrors Prisma enums as TS union types.
 * Zero I/O — pure type definitions only.
 */

export type EventType =
  | "PAYMENT_FAILED"
  | "CHECKOUT_ABANDONED"
  | "INVOICE_OVERDUE"
  | "SUBSCRIPTION_FAILED";

export interface RawRevenueEvent {
  id: string;
  entityType: "CUSTOMER" | "CART" | "INVOICE" | "SUBSCRIPTION";
  entityId: string;
  customerId: string;
  eventType: EventType;
  amount: number;
  currency: string;
  occurredAt: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  errorCode?: string;
  errorReason?: string;
  rawPayload: Record<string, unknown>;
}

export interface EnrichedRevenueEvent extends RawRevenueEvent {
  riskScore: number;
  urgency: number;
}

export interface DiagnosisResult {
  causeLabel: string;
  confidence: number;
  method: "RULE" | "LLM";
  reasoning?: string;
}

export interface DecisionResult {
  legalActions: string[];
  chosenAction: string;
  reasoning: string;
  policyVersion: string;
}

export interface ActionResult {
  actionType: string;
  result: "success" | "failed" | "skipped" | "scheduled" | "cancelled";
  integration: "RAZORPAY" | "EMAIL" | "MOCK";
  razorpayPaymentLinkId?: string;
  paymentLinkShortUrl?: string;
  paymentId?: string;
  emailMessageId?: string;
  detail?: string;
}

export type Window = "1h" | "24h" | "7d" | "all";

export interface MetricsSummary {
  window: Window;
  amountAtRisk: number;
  amountRecovered: number;
  recoveryRate: number;
  eventsProcessed: number;
  funnel: FunnelStage[];
  byCause: { cause: string; recovered: number; atRisk: number }[];
  byChannel: {
    channel: "razorpay" | "email" | "human";
    count: number;
    recoveredCount: number;
    recoveredAmount: number;
  }[];
  medianTimeToRecoveryHours: number | null;
  compliance: { dncBlocked: number; autoEscalated: number; cooldownStopped: number };
}

export interface TrendPoint {
  /** ISO 8601 start of the bucket. */
  bucketStart: string;
  eventsProcessed: number;
  amountRecovered: number;
}

export interface FunnelStage {
  stage: "detected" | "diagnosed" | "contacted" | "recovered";
  count: number;
}

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
