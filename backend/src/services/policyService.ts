import policyJson from "../domain/policy.json";
import { redis } from "../config/redis";
import { prisma } from "../config/prisma";

import { PolicyQueryParams, PolicyConfigurationResponse } from "../domain/types";

export { PolicyQueryParams, PolicyConfigurationResponse };

/**
 * Retrieves live policy configuration, DNC consent block list, and compliance audit log.
 */
export async function getPolicyConfiguration(
  params: PolicyQueryParams = {}
): Promise<PolicyConfigurationResponse> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(100, params.limit || 20));
  const skip = (page - 1) * limit;

  const dncPage = Math.max(1, params.dncPage || 1);
  const dncLimit = Math.max(1, Math.min(100, params.dncLimit || 10));
  const dncSkip = (dncPage - 1) * dncLimit;

  // 1. Fetch DNC list from Redis
  let redisDncIds: string[] = [];
  try {
    redisDncIds = await redis.smembers("razorrecovery:dnc:set");
  } catch (err) {
    console.warn("[policyService] Redis DNC set lookup warning:", err);
  }

  // 2. Fetch DNC customers from Postgres
  const dbDncCustomers = await prisma.customer.findMany({
    where: { dncFlag: true },
    select: { id: true, name: true, email: true },
  });

  // 3. Deduplicate DNC entries across storage layers
  const dncSet = new Map<string, { id: string; name?: string; email?: string }>();
  for (const c of dbDncCustomers) {
    dncSet.set(c.id, c);
  }
  for (const id of redisDncIds) {
    if (!dncSet.has(id)) {
      dncSet.set(id, { id });
    }
  }
  const dncList = Array.from(dncSet.values());
  const dncTotal = dncList.length;
  const paginatedDncList = dncList.slice(dncSkip, dncSkip + dncLimit);

  // 4. Fetch policy-blocked compliance audit entries
  const [total, entries] = await Promise.all([
    prisma.auditEntry.count({
      where: { outcome: { in: ["skipped", "escalated"] } },
    }),
    prisma.auditEntry.findMany({
      where: { outcome: { in: ["skipped", "escalated"] } },
      orderBy: { timestamp: "desc" },
      skip,
      take: limit,
      include: {
        event: {
          include: { customer: true },
        },
      },
    }),
  ]);

  return {
    policy: policyJson,
    dncList: {
      entries: paginatedDncList,
      total: dncTotal,
      page: dncPage,
      limit: dncLimit,
      totalPages: Math.ceil(dncTotal / dncLimit) || 1,
    },
    complianceLog: {
      entries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}
