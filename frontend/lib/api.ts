import axios from "axios";
import {
  MetricsSummary,
  EntityItem,
  EntityFilters,
  AuditEntry,
  PolicyResponse,
  BatchItem,
  RunBatchParams,
} from "../types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export async function getMetricsSummary(batchId?: string): Promise<MetricsSummary> {
  const params = batchId ? { batchId } : {};
  const response = await apiClient.get<MetricsSummary>("/metrics/summary", { params });
  return response.data;
}

export async function listEntities(filters?: EntityFilters): Promise<EntityItem[]> {
  const response = await apiClient.get<EntityItem[]>("/entities", { params: filters });
  return response.data;
}

export async function getEntityAudit(id: string): Promise<AuditEntry[]> {
  const response = await apiClient.get<AuditEntry[]>(`/entities/${id}/audit`);
  return response.data;
}

export async function getPolicy(page: number = 1, limit: number = 20): Promise<PolicyResponse> {
  const response = await apiClient.get<PolicyResponse>("/policy", { params: { page, limit } });
  return response.data;
}

export async function listBatches(): Promise<BatchItem[]> {
  const response = await apiClient.get<BatchItem[]>("/batches");
  return response.data;
}

export async function runBatch(params: RunBatchParams): Promise<{ batchId: string }> {
  const response = await apiClient.post<{ batchId: string }>("/demo/run-batch", params);
  return response.data;
}
