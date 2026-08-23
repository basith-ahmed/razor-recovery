export interface MetricsSummary {
  batchId?: string;
  amountAtRisk: number;
  amountRecovered: number;
  recoveryRate: number;
  eventsProcessed: number;
  eventsTotal: number;
  funnel: { stage: string; count: number }[];
  byCause: { cause: string; recovered: number; atRisk: number }[];
  byChannel: { channel: string; count: number; recoveredAmount: number }[];
  medianTimeToRecoveryHours: number;
  compliance: { dncBlocked: number; autoEscalated: number; cooldownStopped: number };
}

export interface EntityItem {
  id: string;
  batchId: string;
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

export interface EntityFilters {
  state?: string;
  cause?: string;
  eventType?: string;
  minAmount?: string | number;
  maxAmount?: string | number;
  search?: string;
  sort?: string;
}

export interface AuditEntry {
  id: string;
  entityId: string;
  eventId: string;
  actor: string;
  outcome: string;
  inputSnapshot: Record<string, unknown>;
  decisionSnapshot: Record<string, unknown> | null;
  actionSnapshot: Record<string, unknown> | null;
  timestamp: string;
  workflowState?: string;
  event?: {
    id: string;
    entityId: string;
    eventType: string;
    amount: number;
    currency: string;
    customer?: {
      id: string;
      name: string;
      email: string;
      dncFlag: boolean;
    };
  };
}

export interface BatchItem {
  id: string;
  eventCount: number;
  status: string;
  amountAtRisk: number;
  amountRecovered: number;
  summaryJson: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityItem {
  entityId?: string;
  id?: string;
  timestamp: string;
  customerName: string;
  eventType: string;
  cause: string;
  action: string;
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
  dncList: { id: string; name?: string; email?: string }[];
  complianceLog: {
    entries: AuditEntry[];
    total: number;
    page: number;
    limit: number;
  };
}

export interface RunBatchParams {
  size: number;
  mix: {
    paymentFailed: number;
    checkoutAbandoned: number;
    invoiceOverdue: number;
    subscriptionFailed: number;
  };
}
