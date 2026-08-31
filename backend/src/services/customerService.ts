import { prisma } from "../config/prisma";
import { DomainError, CustomerLookupItem } from "../domain/types";
import { Customer } from "@prisma/client";

export { CustomerLookupItem };

/**
 * Finds a customer by ID or throws a typed DomainError if not found.
 */
export async function findCustomerById(customerId: string): Promise<Customer> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new DomainError(
      `Customer ${customerId} not found.`,
      "CUSTOMER_NOT_FOUND",
    );
  }

  return customer;
}

/**
 * Counts prior failure events recorded for a given customer.
 */
export async function countCustomerPriorFailures(
  customerId: string,
  excludeEventId?: string,
): Promise<number> {
  return prisma.revenueEvent.count({
    where: {
      customerId,
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
    },
  });
}

/**
 * Helper to list all active customers ordered by name for UI lookups.
 */
export async function listLookupCustomers(): Promise<CustomerLookupItem[]> {
  return prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      riskTier: true,
      dncFlag: true,
    },
  });
}

/**
 * Calculates customer tenure in whole days from their account creation date.
 */
export function calculateCustomerTenureDays(
  createdAt: Date | string | null | undefined,
): number {
  if (!createdAt) return 0;
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Lists all active, non-recovered payment failure entities (events)
 * strictly associated with a specific customer for Promise-to-Pay creation.
 */
export async function listCustomerEntities(
  customerId: string,
): Promise<import("../domain/types").CustomerEntityLookupItem[]> {
  if (!customerId) return [];

  // 1. Fetch from RevenueEvent for this customer (grouped by entityId, latest event)
  const events = await prisma.revenueEvent.findMany({
    where: {
      customerId,
      AND: [
        {
          OR: [
            { errorCode: null },
            { errorCode: { notIn: ["PROMISE_CREATED", "PROMISE_PAYMENT"] } },
          ],
        },
        {
          OR: [
            { errorReason: null },
            { errorReason: { notIn: ["promise_to_pay", "promise_settlement"] } },
          ],
        },
      ],
    },
    orderBy: { occurredAt: "desc" },
  });

  const workflows = await prisma.entityWorkflowState.findMany({
    where: { customerId },
  });
  const workflowMap = new Map(workflows.map((w) => [w.entityId, w.state]));

  const entityMap = new Map<string, import("../domain/types").CustomerEntityLookupItem>();

  for (const e of events) {
    if (!entityMap.has(e.entityId)) {
      const currentState = workflowMap.get(e.entityId) ?? "DETECTED";
      const s = currentState.toUpperCase();
      if (s !== "RECOVERED" && s !== "WRITTEN_OFF") {
        entityMap.set(e.entityId, {
          entityId: e.entityId,
          entityType: e.entityType,
          amount: e.amount,
          currency: e.currency,
          eventType: e.eventType,
          state: currentState,
          occurredAt: e.occurredAt.toISOString(),
          errorReason: e.errorReason,
        });
      }
    }
  }

  return Array.from(entityMap.values());
}



