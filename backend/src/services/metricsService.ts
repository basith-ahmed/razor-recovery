/**
 * Metrics Service — read-only aggregation queries over rolling time windows.
 * Metrics are computed over a window ('1h' | '24h' | '7d' | 'all') across all
 * events in the system, and cached briefly in Redis so dashboard polling stays
 * snappy. There is no run/batch scoping anywhere.
 */

import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import {
  MetricsSummary,
  FunnelStage,
  TrendPoint,
  Window,
} from "../domain/types";

const CACHE_TTL_SECONDS = 5;

/**
 * Median of an array of numbers. Returns null for empty arrays.
 */
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

/**
 * Returns funnel stage counts within the given time window:
 * detected → diagnosed → contacted → recovered
 */
export async function recoveryFunnel(window: Window): Promise<FunnelStage[]> {
  const eventFilter = eventWindowFilter(window);

  // detected = total events in the window
  const detected = await prisma.revenueEvent.count({ where: eventFilter });

  // diagnosed = events that have a Diagnosis row
  const diagnosed = await prisma.diagnosis.count({
    where: { event: eventFilter },
  });

  // contacted = events that have an Action row with result != 'skipped'
  const contacted = await prisma.action.count({
    where: {
      event: eventFilter,
      result: { not: "skipped" },
    },
  });

  // recovered = events where an audit entry has outcome 'recovered'
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

async function computeLiveMetricsUncached(
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
  const causeMap: Record<
    string,
    { count: number; amountAtRisk: number; amountRecovered: number }
  > = {};
  const recoveryTimesMs: number[] = [];

  for (const event of events) {
    amountAtRisk += event.amount;

    const causeLabel = event.diagnosis?.causeLabel ?? "unknown";
    if (!causeMap[causeLabel]) {
      causeMap[causeLabel] = {
        count: 0,
        amountAtRisk: 0,
        amountRecovered: 0,
      };
    }
    causeMap[causeLabel].count += 1;
    causeMap[causeLabel].amountAtRisk += event.amount;

    // Check if this event was recovered via audit trail
    const latestAudit = event.auditEntries.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    )[0];

    if (latestAudit?.outcome === "recovered") {
      amountRecovered += event.amount;
      causeMap[causeLabel].amountRecovered += event.amount;

      // Time-to-recovery: Action.executedAt - RevenueEvent.occurredAt
      if (event.action?.executedAt) {
        recoveryTimesMs.push(
          event.action.executedAt.getTime() - event.occurredAt.getTime(),
        );
      }
    }
  }

  const channelMap: Record<
    "razorpay" | "email" | "human",
    { count: number; recoveredAmount: number }
  > = {
    razorpay: { count: 0, recoveredAmount: 0 },
    email: { count: 0, recoveredAmount: 0 },
    human: { count: 0, recoveredAmount: 0 },
  };

  for (const event of events) {
    const integration = event.action?.integration;
    if (!integration) continue;
    const keyLower = integration.toLowerCase();
    const normKey: "razorpay" | "email" | "human" =
      keyLower === "razorpay"
        ? "razorpay"
        : keyLower === "email"
          ? "email"
          : "human";
    channelMap[normKey].count += 1;
    const latestAudit = event.auditEntries.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    )[0];
    if (latestAudit?.outcome === "recovered") {
      channelMap[normKey].recoveredAmount += event.amount;
    }
  }

  // Compliance counters over the audit trail in this window
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

  const medianMs = median(recoveryTimesMs);
  const medianTimeToRecoveryHours = medianMs
    ? Number((medianMs / (1000 * 60 * 60)).toFixed(2))
    : 0;

  return {
    window,
    amountAtRisk: totalAtRiskRounded,
    amountRecovered: totalRecoveredRounded,
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
      recoveredAmount: Number(
        channelMap[channel].recoveredAmount.toFixed(2),
      ),
    })),
    medianTimeToRecoveryHours,
    compliance: { dncBlocked, autoEscalated, cooldownStopped },
  };
}

/**
 * Full live metrics summary for the given rolling window, cached briefly in
 * Redis so dashboard polling stays responsive.
 */
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

/**
 * Buckets the same aggregation over time for the Metrics page trend chart.
 */
export async function metricsTrend(
  window: Window,
  bucket: "hour" | "day",
): Promise<TrendPoint[]> {
  const eventFilter = eventWindowFilter(window);

  const events = await prisma.revenueEvent.findMany({
    where: eventFilter,
    select: {
      occurredAt: true,
      amount: true,
      auditEntries: { select: { outcome: true } },
    },
    orderBy: { occurredAt: "asc" },
  });

  const buckets = new Map<number, TrendPoint>();
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
    }
    const point = buckets.get(key)!;
    point.eventsProcessed += 1;
    if (event.auditEntries.some((a) => a.outcome === "recovered")) {
      point.amountRecovered += event.amount;
    }
  }

  return [...buckets.values()].sort((a, b) =>
    a.bucketStart.localeCompare(b.bucketStart),
  );
}
