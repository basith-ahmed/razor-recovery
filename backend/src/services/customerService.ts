import { prisma } from "../config/prisma";
import { DomainError } from "../domain/types";
import { Customer } from "@prisma/client";

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
export async function listLookupCustomers() {
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



