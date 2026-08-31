/**
 * Centralized TypeScript Domain Types, DTOs, and Interfaces for RazorRecovery Backend.
 * Single source of truth for all business contracts, API request/response payloads, and service models.
 * Zero I/O — pure type definitions only.
 */

import { LedgerEntryType } from "@prisma/client";

// ==========================================
// 1. Core Event & Revenue Domain Types
// ==========================================

export type EventType =
  | "PAYMENT_FAILED"
  | "CHECKOUT_ABANDONED"
  | "INVOICE_OVERDUE"
  | "SUBSCRIPTION_FAILED";

export type EntityType = "CUSTOMER" | "CART" | "INVOICE" | "SUBSCRIPTION";

export interface RawRevenueEvent {
  id: string;
  entityType: EntityType;
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

// ==========================================
// 2. Intelligence & Pipeline Types
// ==========================================

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
  paymentLinkUrl?: string; // https://rzp.io/i/... — canonical name, previously paymentLinkShortUrl
  paymentId?: string;
  emailMessageId?: string;
  detail?: string;
}

// ==========================================
// 3. Metrics & Time Windows
// ==========================================

export type Window = "1h" | "24h" | "7d" | "all";
export const VALID_WINDOWS: readonly Window[] = ["1h", "24h", "7d", "all"] as const;

export function parseWindow(raw: unknown, defaultWindow: Window = "24h"): Window {
  return typeof raw === "string" && (VALID_WINDOWS as readonly string[]).includes(raw)
    ? (raw as Window)
    : defaultWindow;
}

export interface FunnelStage {
  stage: "detected" | "diagnosed" | "contacted" | "recovered";
  count: number;
}

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

// ==========================================
// 4. Entity & Audit Trail Types
// ==========================================

export interface ListEntitiesFilters {
  state?: string;
  cause?: string;
  eventType?: string;
  minAmount?: string | number;
  maxAmount?: string | number;
  search?: string;
  sort?: string;
  window?: Window;
}

export interface ListEntitiesPagination {
  page: number;
  limit: number;
  skip: number;
}

export interface EntitySummaryItem {
  id: string;
  entityType: string;
  entityId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  eventType: string;
  amount: number;
  currency: string;
  occurredAt: string;
  riskScore: number | null;
  state: string;
  stage: "DETECTED" | "DIAGNOSED" | "DECIDED" | "EXECUTED";
  causeLabel: string | null;
  diagnosisMethod: string | null;
  actionType: string | null;
  actionResult: string | null;
  actionIntegration: string | null;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  lastContactedAt: string | null;
  attemptCount: number;
  totalEventsCount: number;
}

export interface EntityEventDetailItem {
  id: string;
  entityType: string;
  entityId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  eventType: string;
  amount: number;
  currency: string;
  occurredAt: string;
  riskScore: number | null;
  urgency: number | null;
  state: string;
  stage: "DETECTED" | "DIAGNOSED" | "DECIDED" | "EXECUTED";
  causeLabel: string | null;
  diagnosisMethod: string | null;
  diagnosisConfidence: number | null;
  diagnosisReasoning: string | null;
  actionType: string | null;
  actionResult: string | null;
  actionIntegration: string | null;
  decisionReasoning: string | null;
  chosenAction: string | null;
  legalActions: string[];
}

export interface EntityAuditDetailsResponse {
  entityId: string;
  customer: any | null;
  workflowState: any | null;
  events: EntityEventDetailItem[];
  promises: FormattedPromiseToPay[];
  auditEntries: any[];
}

// ==========================================
// 5. Promise-to-Pay Types
// ==========================================

export type PromiseStatus = "pending" | "reminder_sent" | "kept" | "broken" | "cancelled";

export interface PromiseToPayRecord {
  id: string;
  entityId: string;
  customerId: string;
  eventId?: string | null;
  promisedAmount: number;
  currency: string;
  promisedDate: string | Date;
  status: PromiseStatus;
  reminderSentAt?: string | Date | null;
  gracePeriodUntil?: string | Date | null;
  razorpayPaymentLinkId?: string | null;
  paymentLinkUrl?: string | null;
  notes?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FormattedPromiseToPay {
  id: string;
  entityId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  promisedAmount: number;
  currency: string;
  promisedDate: string;
  status: string;
  reminderSentAt: string | null;
  gracePeriodUntil: string | null;
  razorpayPaymentLinkId: string | null;
  paymentLinkUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  msRemaining: number;
  isOverdue: boolean;
}

export interface PromiseStats {
  totalCount: number;
  pendingCount: number;
  reminderSentCount: number;
  keptCount: number;
  brokenCount: number;
  totalPromisedAmount: number;
  totalRecoveredAmount: number;
}

export interface ListPromisesParams {
  status?: string;
  customerId?: string;
  entityId?: string;
  search?: string;
  skip?: number;
  limit?: number;
}

export interface CreatePromiseInput {
  customerId: string;
  entityId?: string;
  amount: number | string;
  promisedDate: string | Date;
  notes?: string;
  sendEmail?: boolean;
}

// ==========================================
// 6. Ticket Management Types
// ==========================================

export interface ListTicketsParams {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface TicketSummaryDto {
  id: string;
  entityId: string;
  reason: string;
  status: string;
  assignedTo: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    riskTier: string;
    lifetimeValue: number;
    dncFlag: boolean;
  } | null;
  event: {
    id: string;
    eventType: string;
    entityType: string;
    amount: number;
    currency: string;
    errorReason: string | null;
    causeLabel: string | null;
    riskScore: number | null;
    occurredAt: string;
  } | null;
  notesCount: number;
}

export interface TicketStatsDto {
  openCount: number;
  resolvedCount?: number;
  writtenOffCount?: number;
  recoveredCount: number;
  totalAtRisk: number;
  totalRecovered: number;
}

export interface TicketNoteItem {
  id: string;
  ticketId: string;
  author: string;
  content: string;
  type: string;
  createdAt: string;
}

export interface TicketDetailResponse {
  ticket: any;
  customer: any;
  event: any;
  workflowState: any;
  auditEntries: any[];
  notes: TicketNoteItem[];
}

// ==========================================
// 7. Policy & DNC Types
// ==========================

export interface PolicyQueryParams {
  page?: number;
  limit?: number;
  dncPage?: number;
  dncLimit?: number;
}

export interface PolicyConfigurationResponse {
  policy: any;
  dncList: {
    entries: Array<{ id: string; name?: string; email?: string }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  complianceLog: {
    entries: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ==========================================
// 8. Customer & Ledger Types
// ==========================================

export interface CustomerLookupItem {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  riskTier: string;
  dncFlag: boolean;
}

export interface CustomerEntityLookupItem {
  entityId: string;
  entityType: string;
  amount: number;
  currency: string;
  eventType?: string;
  state?: string;
  occurredAt?: string;
  errorReason?: string | null;
}

export interface WriteLedgerEntryParams {
  entityId: string;
  eventId: string;
  type: LedgerEntryType;
  amount: number;
  currency?: string;
  referenceId?: string;
}

// ==========================================
// 9. Typed Domain Error
// ==========================================

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
