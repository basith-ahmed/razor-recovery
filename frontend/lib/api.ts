import axios from "axios";
import {
  MetricsSummary,
  MetricsWindow,
  TrendPoint,
  EntityItem,
  EntityFilters,
  AuditEntry,
  EntityAuditResponse,
  PolicyResponse,
  PaginatedResponse,
  AuditVerifyResult,
  AuditQueryResponse,
} from "../types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export async function getMetricsSummary(
  window: MetricsWindow = "24h",
): Promise<MetricsSummary> {
  const params: Record<string, string> = { window };
  const response = await apiClient.get<MetricsSummary>("/metrics/summary", { params });
  return response.data;
}

export async function getMetricsTrend(
  window: MetricsWindow = "24h",
  bucket: "hour" | "day" = "hour",
): Promise<TrendPoint[]> {
  const response = await apiClient.get<TrendPoint[]>("/metrics/trend", {
    params: { window, bucket },
  });
  return response.data;
}

export async function listEntities(filters?: EntityFilters): Promise<PaginatedResponse<EntityItem>> {
  const response = await apiClient.get<PaginatedResponse<EntityItem>>("/entities", { params: filters });
  return response.data;
}

export async function getEntityAudit(id: string): Promise<EntityAuditResponse> {
  const response = await apiClient.get<EntityAuditResponse | AuditEntry[]>(`/entities/${id}/audit`);
  if (Array.isArray(response.data)) {
    return {
      entityId: id,
      events: [],
      auditEntries: response.data,
      workflowState: null,
    };
  }
  return response.data;
}

export async function escalateEntity(
  id: string,
  data?: { reason?: string; agentName?: string }
): Promise<{ success: boolean; entityId: string; ticketId?: string; state: string; auditEntryId?: string }> {
  const response = await apiClient.post(`/entities/${id}/escalate`, data || {});
  return response.data;
}

export async function getPolicy(
  page: number = 1,
  limit: number = 20,
  dncPage: number = 1,
  dncLimit: number = 10
): Promise<PolicyResponse> {
  const response = await apiClient.get<PolicyResponse>("/policy", {
    params: { page, limit, dncPage, dncLimit },
  });
  return response.data;
}

export async function verifyAuditChain(
  fromSequence?: number,
  toSequence?: number
): Promise<AuditVerifyResult> {
  const params: Record<string, number> = {};
  if (fromSequence !== undefined) params.fromSequence = fromSequence;
  if (toSequence !== undefined) params.toSequence = toSequence;
  const response = await apiClient.get<AuditVerifyResult>("/audit/verify", { params });
  return response.data;
}

export async function askAuditQuery(
  question: string,
  entityId?: string,
  scope?: string
): Promise<AuditQueryResponse> {
  const response = await apiClient.post<AuditQueryResponse>("/query", {
    question,
    entityId,
    scope,
  });
  return response.data;
}

export async function listTickets(params?: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<import("../types").TicketItem>> {
  const response = await apiClient.get<PaginatedResponse<import("../types").TicketItem>>("/tickets", {
    params,
  });
  return response.data;
}

export async function getTicketStats(): Promise<import("../types").TicketStats> {
  const response = await apiClient.get<import("../types").TicketStats>("/tickets/stats");
  return response.data;
}

export async function getTicket(id: string): Promise<import("../types").TicketDetailResponse> {
  const response = await apiClient.get<import("../types").TicketDetailResponse>(`/tickets/${id}`);
  return response.data;
}

export async function addTicketNote(
  ticketId: string,
  data: { author?: string; content: string; type?: string }
): Promise<import("../types").TicketNoteItem> {
  const response = await apiClient.post<import("../types").TicketNoteItem>(`/tickets/${ticketId}/notes`, data);
  return response.data;
}

export async function sendTicketEmail(
  ticketId: string,
  data: {
    subject: string;
    message: string;
    includePaymentLink?: boolean;
    agentName?: string;
  }
): Promise<{ success: boolean; paymentUrl?: string }> {
  const response = await apiClient.post<{ success: boolean; paymentUrl?: string }>(
    `/tickets/${ticketId}/send-email`,
    data
  );
  return response.data;
}

export async function resolveTicket(
  ticketId: string,
  data: {
    status: "recovered" | "written_off" | "resolved" | "open";
    resolutionNotes?: string;
    agentName?: string;
    recoveredAmount?: number;
  }
): Promise<any> {
  const response = await apiClient.post(`/tickets/${ticketId}/resolve`, data);
  return response.data;
}

export async function getPromiseStats(): Promise<import("../types").PromiseStats> {
  const response = await apiClient.get<import("../types").PromiseStats>("/promises/stats");
  return response.data;
}

export async function fetchPromiseCustomers(): Promise<import("../types").CustomerLookupItem[]> {
  const response = await apiClient.get<import("../types").CustomerLookupItem[]>("/promises/customers");
  return response.data;
}

export async function fetchCustomerEntities(
  customerId: string
): Promise<import("../types").CustomerEntityLookupItem[]> {
  const response = await apiClient.get<import("../types").CustomerEntityLookupItem[]>(
    `/promises/customers/${customerId}/entities`
  );
  return response.data;
}

export async function getPromise(id: string): Promise<import("../types").PromiseToPayItem> {
  const response = await apiClient.get<import("../types").PromiseToPayItem>(`/promises/${id}`);
  return response.data;
}

export async function listPromises(params?: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<import("../types").PromiseToPayItem>> {
  const response = await apiClient.get<PaginatedResponse<import("../types").PromiseToPayItem>>("/promises", {
    params,
  });
  return response.data;
}

export async function createPromise(
  data: import("../types").CreatePromiseInput
): Promise<import("../types").PromiseToPayItem> {
  const response = await apiClient.post<import("../types").PromiseToPayItem>("/promises", data);
  return response.data;
}

export async function sendPromiseReminder(
  id: string
): Promise<{ message: string; promise: import("../types").PromiseToPayItem }> {
  const response = await apiClient.post<{ message: string; promise: import("../types").PromiseToPayItem }>(
    `/promises/${id}/send-reminder`
  );
  return response.data;
}

export async function updatePromise(
  id: string,
  data: { status?: string; notes?: string; promisedDate?: string }
): Promise<import("../types").PromiseToPayItem> {
  const response = await apiClient.patch<import("../types").PromiseToPayItem>(`/promises/${id}`, data);
  return response.data;
}


