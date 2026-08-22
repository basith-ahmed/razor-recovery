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
  batchId: string;
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
  result: "success" | "failed" | "skipped";
  integration: "RAZORPAY" | "EMAIL" | "MOCK";
  razorpayPaymentLinkId?: string;
  emailMessageId?: string;
  detail?: string;
}
