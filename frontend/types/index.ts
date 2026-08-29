export type MetricsWindow = "1h" | "24h" | "7d" | "all";

export interface MetricsSummary {
  window: MetricsWindow;
  amountAtRisk: number;
  amountRecovered: number;
  recoveryRate: number;
  eventsProcessed: number;
  funnel: { stage: string; count: number }[];
  byCause: { cause: string; recovered: number; atRisk: number }[];
  byChannel: { channel: string; count: number; recoveredAmount: number }[];
  medianTimeToRecoveryHours: number;
  compliance: { dncBlocked: number; autoEscalated: number; cooldownStopped: number };
}

export interface TrendPoint {
  bucketStart: string;
  eventsProcessed: number;
  amountRecovered: number;
}

export interface EntityItem {
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
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface EntityFilters {
  state?: string;
  cause?: string;
  eventType?: string;
  minAmount?: string | number;
  maxAmount?: string | number;
  search?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface AuditEntry {
  id: string;
  entityId: string;
  eventId: string;
  actor: string;
  outcome: string;
  inputSnapshot: Record<string, unknown>;
  diagnosisSnapshot: Record<string, unknown> | null;
  decisionSnapshot: Record<string, unknown> | null;
  actionSnapshot: Record<string, unknown> | null;
  timestamp: string;
  state?: string;
  event?: {
    id: string;
    entityId: string;
    eventType: string;
    amount: number;
    currency: string;
    diagnosis?: {
      causeLabel: string;
      confidence: number;
      method: string;
      reasoning?: string | null;
    } | null;
    customer?: {
      id: string;
      name: string;
      email: string;
      dncFlag: boolean;
    };
  };
}

export interface IncomingEventItem {
  eventId: string;
  entityId: string;
  customerId?: string;
  customerName: string;
  eventType: string;
  amount: number;
  currency: string;
  occurredAt: string;
  riskScore?: number;
  synthesized?: boolean;
  followUpType?: string;
}

export interface ActivityItem {
  entityId?: string;
  id?: string;
  timestamp: string;
  customerId?: string;
  customerName: string;
  eventType: string;
  cause: string;
  action: string;
  actionResult?: string | null;
  outcome: string;
}

export interface PolicyRule {
  cause: string;
  actions: string[];
  stopping: Record<string, unknown>;
}

export interface PolicyResponse {
  policy: {
    version: string;
    rules: PolicyRule[];
  };
  dncList: {
    entries: { id: string; name?: string; email?: string }[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  complianceLog: {
    entries: AuditEntry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface EntityFilters {
  state?: string;
  cause?: string;
  eventType?: string;
  minAmount?: string | number;
  maxAmount?: string | number;
  search?: string;
  sort?: string;
  window?: MetricsWindow;
  page?: number;
  limit?: number;
}

export interface AuditVerifyResult {
  valid: boolean;
  entriesChecked: number;
  brokenAtEntryId?: string;
  brokenAtSequence?: number;
}

export interface AuditQueryRequest {
  question: string;
  entityId?: string;
}

export interface AuditQueryResponse {
  answer: string;
  citedEntityIds: string[];
}

