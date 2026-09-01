import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import {
  MetricsSummary,
  FunnelStage,
  TrendPoint,
  Window,
} from "../domain/types";

const CACHE_TTL_SECONDS = 5;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function windowStartDate(window: Window): Date | null {
  const now = Date.now();
  switch (window) {
    case "1h":
      return new Date(now - 60 * 60 * 1000);
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
  }
}

export function eventWindowFilter(window: Window) {
  const occurredAt = windowStartDate(window);
  return {
    ...(occurredAt ? { occurredAt: { gte: occurredAt } } : {}),
  };
}

export async function recoveryFunnel(window: Window): Promise<FunnelStage[]> {
  const eventFilter = eventWindowFilter(window);

  const detected = await prisma.revenueEvent.count({ where: eventFilter });

  const diagnosed = await prisma.diagnosis.count({
    where: { event: eventFilter },
  });

  const contacted = await prisma.action.count({
    where: {
      event: eventFilter,
      result: { not: "skipped" },
    },
  });

  const recoveredAudits = await prisma.auditEntry.findMany({
    where: {
      event: eventFilter,
      outcome: "recovered",
    },
    select: { eventId: true },
    distinct: ["eventId"],
  });
  const recovered = recoveredAudits.length;

  return [
    { stage: "detected", count: detected },
    { stage: "diagnosed", count: diagnosed },
    { stage: "contacted", count: contacted },
    { stage: "recovered", count: recovered },
  ];
}

export async function computeLiveMetricsUncached(
  window: Window,
): Promise<MetricsSummary> {
  const eventFilter = eventWindowFilter(window);

  const events = await prisma.revenueEvent.findMany({
    where: eventFilter,
    include: {
      diagnosis: true,
      action: true,
      auditEntries: true,
    },
  });

  const funnel = await recoveryFunnel(window);

  let amountAtRisk = 0;
  let amountRecovered = 0;

  const [allLedgerEntries, recoveredLedgerEntries] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: eventFilter.occurredAt ? { createdAt: eventFilter.occurredAt } : {},
      select: { entityId: true, type: true, amount: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        type: "RECOVERED",
        ...(eventFilter.occurredAt ? { createdAt: eventFilter.occurredAt } : {}),
      },
      select: { entityId: true, eventId: true, createdAt: true },
    }),
  ]);

  // Aggregate distinct entity amounts to guarantee zero double counting
  const distinctAtRisk = new Map<string, number>();
  const distinctRecovered = new Map<string, number>();
  const distinctWrittenOff = new Map<string, number>();
  let reversedSum = 0;

  if (allLedgerEntries && allLedgerEntries.length > 0) {
    for (const entry of allLedgerEntries) {
      if (entry.type === "AT_RISK") {
        if (!distinctAtRisk.has(entry.entityId)) {
          distinctAtRisk.set(entry.entityId, entry.amount);
        }
      } else if (entry.type === "RECOVERED") {
        if (!distinctRecovered.has(entry.entityId)) {
          distinctRecovered.set(entry.entityId, entry.amount);
        }
      } else if (entry.type === "WRITTEN_OFF") {
        if (!distinctWrittenOff.has(entry.entityId)) {
          distinctWrittenOff.set(entry.entityId, entry.amount);
        }
      } else if (entry.type === "REVERSED") {
        reversedSum += entry.amount;
      }
    }
  } else {
    for (const ev of events) {
      const k = ev.entityId || ev.id;
      if (!distinctAtRisk.has(k)) {
        distinctAtRisk.set(k, ev.amount);
      }
      if (ev.auditEntries.some((a) => a.outcome === "recovered") && !distinctRecovered.has(k)) {
        distinctRecovered.set(k, ev.amount);
      }
    }
  }

  const atRiskSum = Array.from(distinctAtRisk.values()).reduce((a, b) => a + b, 0);
  const recoveredSum = Array.from(distinctRecovered.values()).reduce((a, b) => a + b, 0);
  const writtenOffSum = Array.from(distinctWrittenOff.values()).reduce((a, b) => a + b, 0);

  amountAtRisk = atRiskSum;
  amountRecovered = Math.max(0, recoveredSum - reversedSum);
  const amountWrittenOff = Number(writtenOffSum.toFixed(2));

  const recoveredEntityIds = new Set<string>(
    recoveredLedgerEntries.map((l) => l.entityId),
  );
  const recoveredEventIds = new Set<string>(
    recoveredLedgerEntries.map((l) => l.eventId),
  );

  const recoveryTimestampMap = new Map<string, Date>();
  for (const l of recoveredLedgerEntries) {
    recoveryTimestampMap.set(l.entityId, l.createdAt);
  }

  const causeMap: Record<
    string,
    { count: number; amountAtRisk: number; amountRecovered: number }
  > = {};
  const recoveryTimesMs: number[] = [];
  const accountedAtRiskEntities = new Set<string>();
  const accountedRecoveredEntities = new Set<string>();

  for (const event of events) {
    const entityKey = event.entityId || event.id;
    const causeLabel = event.diagnosis?.causeLabel ?? "unknown";
    if (!causeMap[causeLabel]) {
      causeMap[causeLabel] = {
        count: 0,
        amountAtRisk: 0,
        amountRecovered: 0,
      };
    }
    causeMap[causeLabel].count += 1;

    // Attribute at-risk amount once per entity
    if (!accountedAtRiskEntities.has(entityKey)) {
      accountedAtRiskEntities.add(entityKey);
      causeMap[causeLabel].amountAtRisk += event.amount;
    }

    const isRecovered =
      recoveredEventIds.has(event.id) ||
      recoveredEntityIds.has(entityKey) ||
      event.auditEntries.some((a) => a.outcome === "recovered");

    if (isRecovered) {
      if (!accountedRecoveredEntities.has(entityKey)) {
        accountedRecoveredEntities.add(entityKey);
        causeMap[causeLabel].amountRecovered += event.amount;
      }

      const recoveryTime =
        recoveryTimestampMap.get(entityKey) ??
        event.auditEntries.find((a) => a.outcome === "recovered")?.timestamp ??
        event.action?.executedAt;

      if (recoveryTime) {
        const elapsedMs = Math.max(0, recoveryTime.getTime() - event.occurredAt.getTime());
        recoveryTimesMs.push(elapsedMs);
      }
    }
  }

  const channelMap: Record<
    "razorpay" | "email" | "human",
    { count: number; recoveredCount: number; recoveredAmount: number }
  > = {
    razorpay: { count: 0, recoveredCount: 0, recoveredAmount: 0 },
    email: { count: 0, recoveredCount: 0, recoveredAmount: 0 },
    human: { count: 0, recoveredCount: 0, recoveredAmount: 0 },
  };

  const accountedChannelRecovered = new Set<string>();

  for (const event of events) {
    const entityKey = event.entityId || event.id;
    const action = event.action;
    if (!action || action.result === "skipped") continue;

    let normKey: "razorpay" | "email" | "human" | null = null;
    if (action.integration === "RAZORPAY") {
      normKey = "razorpay";
    } else if (action.integration === "EMAIL") {
      normKey = "email";
    } else if (action.actionType === "escalate_to_human") {
      normKey = "human";
    }

    if (!normKey) continue;

    channelMap[normKey].count += 1;

    const isRecovered =
      recoveredEventIds.has(event.id) ||
      recoveredEntityIds.has(entityKey) ||
      event.auditEntries.some((a) => a.outcome === "recovered");

    if (isRecovered && !accountedChannelRecovered.has(entityKey)) {
      accountedChannelRecovered.add(entityKey);
      channelMap[normKey].recoveredCount += 1;
      channelMap[normKey].recoveredAmount += event.amount;
    }
  }

  const audits = await prisma.auditEntry.findMany({
    where: { event: eventFilter },
    select: { outcome: true, decisionSnapshot: true },
  });

  let dncBlocked = 0;
  let autoEscalated = 0;
  let cooldownStopped = 0;

  for (const entry of audits) {
    if (entry.outcome === "escalated") {
      autoEscalated++;
    } else if (entry.outcome === "skipped") {
      const reasoning = String(
        (entry.decisionSnapshot as Record<string, unknown> | null)?.reasoning ??
          "",
      );
      if (reasoning.toLowerCase().includes("cooldown")) {
        cooldownStopped++;
      } else {
        dncBlocked++;
      }
    }
  }

  const processedAudits = await prisma.auditEntry.findMany({
    where: { event: eventFilter },
    select: { eventId: true },
    distinct: ["eventId"],
  });
  const eventsProcessed = processedAudits.length;

  const totalRecoveredRounded = Number(amountRecovered.toFixed(2));
  const totalAtRiskRounded = Number(amountAtRisk.toFixed(2));
  const recoveryRate =
    totalAtRiskRounded > 0
      ? Number((totalRecoveredRounded / totalAtRiskRounded).toFixed(4))
      : 0;

  const medianMs = recoveryTimesMs.length > 0 ? median(recoveryTimesMs) : null;
  const medianTimeToRecoveryHours =
    medianMs !== null && totalRecoveredRounded > 0
      ? Number((medianMs / (1000 * 60 * 60)).toFixed(2))
      : null;

  return {
    window,
    amountAtRisk: totalAtRiskRounded,
    amountRecovered: totalRecoveredRounded,
    amountWrittenOff,
    recoveryRate,
    eventsProcessed,
    funnel,
    byCause: Object.entries(causeMap)
      .map(([cause, data]) => ({
        cause,
        recovered: Number(data.amountRecovered.toFixed(2)),
        atRisk: Number(data.amountAtRisk.toFixed(2)),
      }))
      .sort((a, b) => b.atRisk - a.atRisk),
    byChannel: (["razorpay", "email", "human"] as const).map((channel) => ({
      channel,
      count: channelMap[channel].count,
      recoveredCount: channelMap[channel].recoveredCount,
      recoveredAmount: Number(
        channelMap[channel].recoveredAmount.toFixed(2),
      ),
    })),
    medianTimeToRecoveryHours,
    compliance: { dncBlocked, autoEscalated, cooldownStopped },
  };
}

export async function computeLiveMetrics(
  window: Window,
): Promise<MetricsSummary> {
  const cacheKey = `razorrecovery:metrics:${window}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as MetricsSummary;
  } catch (err) {
    console.error("[metricsService] Redis cache read failed:", err);
  }

  const summary = await computeLiveMetricsUncached(window);

  try {
    await redis.set(
      cacheKey,
      JSON.stringify(summary),
      "EX",
      CACHE_TTL_SECONDS,
    );
  } catch (err) {
    console.error("[metricsService] Redis cache write failed:", err);
  }

  return summary;
}

export async function metricsTrend(
  window: Window,
  bucket: "hour" | "day",
): Promise<TrendPoint[]> {
  const eventFilter = eventWindowFilter(window);

  const events = await prisma.revenueEvent.findMany({
    where: eventFilter,
    select: {
      entityId: true,
      occurredAt: true,
      amount: true,
      auditEntries: { select: { outcome: true } },
    },
    orderBy: { occurredAt: "asc" },
  });

  const buckets = new Map<number, TrendPoint>();
  const recoveredInBucket = new Map<number, Set<string>>();

  for (const event of events) {
    const date = new Date(event.occurredAt);
    if (bucket === "hour") {
      date.setUTCMinutes(0, 0, 0);
    } else {
      date.setUTCHours(0, 0, 0, 0);
    }
    const key = date.getTime();
    if (!buckets.has(key)) {
      buckets.set(key, {
        bucketStart: date.toISOString(),
        eventsProcessed: 0,
        amountRecovered: 0,
      });
      recoveredInBucket.set(key, new Set<string>());
    }
    const point = buckets.get(key)!;
    point.eventsProcessed += 1;
    if (event.auditEntries.some((a) => a.outcome === "recovered")) {
      const recSet = recoveredInBucket.get(key)!;
      if (!recSet.has(event.entityId)) {
        recSet.add(event.entityId);
        point.amountRecovered += event.amount;
      }
    }
  }

  return [...buckets.values()].sort((a, b) =>
    a.bucketStart.localeCompare(b.bucketStart),
  );
}
