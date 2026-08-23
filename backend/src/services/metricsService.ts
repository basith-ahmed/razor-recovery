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
