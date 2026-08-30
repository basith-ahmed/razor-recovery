export type MetricsWindow = "1h" | "24h" | "7d" | "all";

export interface MetricsSummary {
  window: MetricsWindow;
  amountAtRisk: number;
  amountRecovered: number;
  recoveryRate: number;
  eventsProcessed: number;
  funnel: { stage: string; count: number }[];
  byCause: { cause: string; recovered: number; atRisk: number }[];
  byChannel: {
    channel: string;
    count: number;
    recoveredCount?: number;
    recoveredAmount: number;
  }[];
  medianTimeToRecoveryHours: number | null;
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
  totalEventsCount?: number;
}

export interface EntityEventItem {
  id: string;
  entityType: string;
  entityId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  eventType: string;
  amount: number;
  currency: string;
  errorReason?: string | null;
  occurredAt: string;
  riskScore: number | null;
  urgency?: number | null;
  state: string;
  stage: "DETECTED" | "DIAGNOSED" | "DECIDED" | "EXECUTED";
  causeLabel: string | null;
  diagnosisMethod: string | null;
  diagnosisConfidence?: number | null;
  diagnosisReasoning?: string | null;
  actionType: string | null;
  actionResult: string | null;
  actionIntegration: string | null;
  decisionReasoning: string | null;
  chosenAction: string | null;
  legalActions: string[];
  attemptCount?: number;
  cooldownUntil?: string | Date | null;
  lastContactedAt?: string | Date | null;
  customer?: {
    id: string;
    name: string;
    email: string;
    dncFlag?: boolean;
  } | null;
}

export interface EntityWorkflowStateData {
  id: string;
  entityId: string;
  customerId?: string | null;
  state: string;
  attemptCount: number;
  lastContactedAt?: string | null;
  cooldownUntil?: string | null;
  updatedAt: string;
}

export interface EntityAuditResponse {
  entityId: string;
  customer?: {
    id: string;
    name: string;
    email: string;
    dncFlag?: boolean;
    phone?: string | null;
  } | null;
  workflowState?: EntityWorkflowStateData | null;
  events: EntityEventItem[];
  promises?: PromiseToPayItem[];
  auditEntries: AuditEntry[];
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
    attemptCount?: number;
    cooldownUntil?: string | Date | null;
    lastContactedAt?: string | Date | null;
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

export interface TicketNoteItem {
  id: string;
  ticketId: string;
  author: string;
  content: string;
  type: "note" | "email_sent" | "status_change";
  createdAt: string;
}

export interface TicketItem {
  id: string;
  entityId: string;
  reason: string;
  status: "open" | "recovered" | "written_off" | "resolved" | "closed";
  priority: "high" | "medium" | "low";
  assignedTo?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: {
    id: string;
    name: string;
    email: string;
    phone?: string | null;
    riskTier: string;
    lifetimeValue: number;
    dncFlag: boolean;
  } | null;
  event?: {
    id: string;
    eventType: string;
    entityType: string;
    amount: number;
    currency: string;
    errorReason?: string | null;
    causeLabel?: string | null;
    riskScore?: number | null;
    occurredAt: string;
  } | null;
  notesCount: number;
}

export interface TicketDetailResponse {
  ticket: {
    id: string;
    entityId: string;
    reason: string;
    status: string;
    priority: string;
    assignedTo: string | null;
    resolutionNotes: string | null;
    resolvedAt: string | null;
    createdAt: string;
    updatedAt: string;
    notes: TicketNoteItem[];
  };
  customer?: {
    id: string;
    name: string;
    email: string;
    phone?: string | null;
    riskTier: string;
    lifetimeValue: number;
    dncFlag: boolean;
  } | null;
  event?: EntityEventItem | null;
  workflowState?: string | null;
  auditEntries: AuditEntry[];
  notes?: TicketNoteItem[];
}

export interface TicketStats {
  openCount: number;
  writtenOffCount?: number;
  resolvedCount?: number;
  recoveredCount: number;
  totalAtRisk: number;
  totalRecovered: number;
}

export type PromiseStatus = "pending" | "reminder_sent" | "kept" | "broken" | "cancelled";

export interface PromiseToPayItem {
  id: string;
  entityId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  promisedAmount: number;
  currency: string;
  promisedDate: string;
  status: PromiseStatus;
  reminderSentAt?: string | null;
  gracePeriodUntil?: string | null;
  razorpayPaymentLinkId?: string | null;
  paymentLinkUrl?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  msRemaining?: number;
  isOverdue?: boolean;
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

export interface CreatePromiseInput {
  customerId: string;
  entityId?: string;
  amount: number;
  promisedDate: string;
  notes?: string;
  sendEmail?: boolean;
}

export interface CustomerLookupItem {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  riskTier?: string;
  dncFlag?: boolean;
}


