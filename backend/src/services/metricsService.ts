/**
 * Metrics Service — read-only aggregation queries for batch summaries
 * and recovery funnel metrics.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { BatchSummary, FunnelStage } from "../domain/types";

/**
 * Compute the median of an array of numbers.
 * Returns null for empty arrays.
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Computes a full batch summary including amount at risk, recovered totals,
 * breakdowns by cause and channel, and median time-to-recovery.
 *
 * Updates Batch.amountRecovered and Batch.summaryJson for API-layer caching.
 */
export async function computeBatchSummary(
  batchId: string,
): Promise<BatchSummary> {
  const events = await prisma.revenueEvent.findMany({
    where: { batchId },
    include: {
      diagnosis: true,
      action: true,
      auditEntries: true,
    },
  });

  let totalAmountAtRisk = 0;
  let totalRecovered = 0;
  const byCause: Record<
    string,
    { count: number; amountAtRisk: number; amountRecovered: number }
  > = {};
  const byChannel: Record<
    string,
    { count: number; amountRecovered: number }
  > = {};
  const recoveryTimesMs: number[] = [];

  for (const event of events) {
    totalAmountAtRisk += event.amount;

    const causeLabel = event.diagnosis?.causeLabel ?? "unknown";
    if (!byCause[causeLabel]) {
      byCause[causeLabel] = { count: 0, amountAtRisk: 0, amountRecovered: 0 };
    }
    byCause[causeLabel].count += 1;
    byCause[causeLabel].amountAtRisk += event.amount;

    const channel = event.action?.integration ?? "NONE";
    if (!byChannel[channel]) {
      byChannel[channel] = { count: 0, amountRecovered: 0 };
    }
    byChannel[channel].count += 1;

    // Check if this event was recovered via audit trail
    const latestAudit = event.auditEntries.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    )[0];

    if (latestAudit?.outcome === "recovered") {
      totalRecovered += event.amount;
      byCause[causeLabel].amountRecovered += event.amount;
      byChannel[channel].amountRecovered += event.amount;

      // Time-to-recovery: Action.executedAt - RevenueEvent.occurredAt
      if (event.action?.executedAt) {
        const timeToRecovery =
          event.action.executedAt.getTime() - event.occurredAt.getTime();
        recoveryTimesMs.push(timeToRecovery);
      }
    }
  }

  const recoveryRate =
    totalAmountAtRisk > 0 ? totalRecovered / totalAmountAtRisk : 0;

  const summary: BatchSummary = {
    batchId,
    totalAmountAtRisk,
    totalRecovered,
    recoveryRate: Number(recoveryRate.toFixed(4)),
    byCause,
    byChannel,
    medianTimeToRecoveryMs: median(recoveryTimesMs),
  };

  // Cache the summary on the Batch row
  await prisma.batch.update({
    where: { id: batchId },
    data: {
      amountRecovered: totalRecovered,
      summaryJson: summary as unknown as Prisma.InputJsonValue,
    },
  });

  return summary;
}

/**
 * Returns funnel stage counts for the given batch:
 * detected → diagnosed → contacted → recovered
 */
export async function recoveryFunnel(
  batchId: string,
): Promise<FunnelStage[]> {
  // detected = total events in the batch
  const detected = await prisma.revenueEvent.count({
    where: { batchId },
  });

  // diagnosed = events that have a Diagnosis row
  const diagnosed = await prisma.diagnosis.count({
    where: { event: { batchId } },
  });

  // contacted = events that have an Action row with result != 'skipped'
  const contacted = await prisma.action.count({
    where: {
      event: { batchId },
      result: { not: "skipped" },
    },
  });

  // recovered = events where an audit entry has outcome 'recovered'
  const recoveredAudits = await prisma.auditEntry.findMany({
    where: {
      event: { batchId },
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

export interface FullMetricsSummaryResponse {
  batchId: string;
  amountAtRisk: number;
  amountRecovered: number;
  recoveryRate: number; // 0..1
  eventsProcessed: number;
  eventsTotal: number;
  funnel: { stage: "detected" | "diagnosed" | "contacted" | "recovered"; count: number }[];
  byCause: { cause: string; recovered: number; atRisk: number }[];
  byChannel: { channel: "razorpay" | "email" | "human"; count: number; recoveredAmount: number }[];
  medianTimeToRecoveryHours: number;
  compliance: { dncBlocked: number; autoEscalated: number; cooldownStopped: number };
}

/**
 * Returns the exact full metrics/summary shape required by §8.4 for the frontend.
 */
export async function getFullMetricsSummary(
  batchId?: string,
): Promise<FullMetricsSummaryResponse> {
  let targetBatchId = batchId;
  if (!targetBatchId) {
    const latestBatch = await prisma.batch.findFirst({
      orderBy: { createdAt: "desc" },
    });
    targetBatchId = latestBatch?.id;
  }

  if (!targetBatchId) {
    return {
      batchId: "",
      amountAtRisk: 0,
      amountRecovered: 0,
      recoveryRate: 0,
      eventsProcessed: 0,
      eventsTotal: 0,
      funnel: [
        { stage: "detected", count: 0 },
        { stage: "diagnosed", count: 0 },
        { stage: "contacted", count: 0 },
        { stage: "recovered", count: 0 },
      ],
      byCause: [],
      byChannel: [
        { channel: "razorpay", count: 0, recoveredAmount: 0 },
        { channel: "email", count: 0, recoveredAmount: 0 },
        { channel: "human", count: 0, recoveredAmount: 0 },
      ],
      medianTimeToRecoveryHours: 0,
      compliance: { dncBlocked: 0, autoEscalated: 0, cooldownStopped: 0 },
    };
  }

  const summary = await computeBatchSummary(targetBatchId);
  const funnel = await recoveryFunnel(targetBatchId);

  const eventsTotal = funnel.find((f) => f.stage === "detected")?.count ?? 0;

  const processedAudits = await prisma.auditEntry.findMany({
    where: { event: { batchId: targetBatchId } },
    select: { eventId: true, outcome: true, decisionSnapshot: true },
    distinct: ["eventId"],
  });
  const eventsProcessed = processedAudits.length;

  const byCauseArray = Object.entries(summary.byCause).map(([cause, data]) => ({
    cause,
    recovered: Number(data.amountRecovered.toFixed(2)),
    atRisk: Number(data.amountAtRisk.toFixed(2)),
  }));

  const channelMap: Record<"razorpay" | "email" | "human", { count: number; recoveredAmount: number }> = {
    razorpay: { count: 0, recoveredAmount: 0 },
    email: { count: 0, recoveredAmount: 0 },
    human: { count: 0, recoveredAmount: 0 },
  };

  for (const [integrationKey, data] of Object.entries(summary.byChannel)) {
    const keyLower = integrationKey.toLowerCase();
    let normKey: "razorpay" | "email" | "human" = "email";
    if (keyLower === "razorpay") normKey = "razorpay";
    else if (keyLower === "email") normKey = "email";
    else normKey = "human";

    channelMap[normKey].count += data.count;
    channelMap[normKey].recoveredAmount += data.amountRecovered;
  }

  const byChannelArray = (["razorpay", "email", "human"] as const).map((channel) => ({
    channel,
    count: channelMap[channel].count,
    recoveredAmount: Number(channelMap[channel].recoveredAmount.toFixed(2)),
  }));

  const allAuditsForBatch = await prisma.auditEntry.findMany({
    where: { event: { batchId: targetBatchId } },
    select: { outcome: true, decisionSnapshot: true },
  });

  let dncBlocked = 0;
  let autoEscalated = 0;
  let cooldownStopped = 0;

  for (const entry of allAuditsForBatch) {
    if (entry.outcome === "escalated") {
      autoEscalated++;
    } else if (entry.outcome === "skipped") {
      const reasoning = String((entry.decisionSnapshot as Record<string, unknown> | null)?.reasoning ?? "");
      if (reasoning.toLowerCase().includes("cooldown")) {
        cooldownStopped++;
      } else {
        dncBlocked++;
      }
    }
  }

  const medianHours = summary.medianTimeToRecoveryMs
    ? Number((summary.medianTimeToRecoveryMs / (1000 * 60 * 60)).toFixed(2))
    : 0;

  return {
    batchId: targetBatchId,
    amountAtRisk: summary.totalAmountAtRisk,
    amountRecovered: summary.totalRecovered,
    recoveryRate: summary.recoveryRate,
    eventsProcessed,
    eventsTotal,
    funnel,
    byCause: byCauseArray,
    byChannel: byChannelArray,
    medianTimeToRecoveryHours: medianHours,
    compliance: { dncBlocked, autoEscalated, cooldownStopped },
  };
}

