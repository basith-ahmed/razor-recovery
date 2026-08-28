import { randomUUID } from "crypto";
import { prisma } from "../config/prisma";
import { embed } from "../config/voyage";

export const TERMINAL_AUDIT_OUTCOMES = new Set(["recovered", "written_off", "escalated"]);

export function bucketAmount(amount: number): string {
  if (amount < 500) return "under_500";
  if (amount < 2000) return "500_to_2000";
  if (amount < 10000) return "2000_to_10000";
  return "over_10000";
}

export interface CaseSummaryParams {
  causeLabel: string;
  entityType: string;
  amount: number;
  chosenAction: string;
  outcome: string;
  daysToRecover: number | null;
}

export function buildCaseSummaryText(params: CaseSummaryParams): string {
  return [
    `cause=${params.causeLabel}`,
    `entity_type=${params.entityType}`,
    `amount_bucket=${bucketAmount(params.amount)}`,
    `action=${params.chosenAction}`,
    `outcome=${params.outcome}`,
    params.daysToRecover === null ? "days_to_recover=n/a" : `days_to_recover=${params.daysToRecover}`,
  ].join(", ");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Index one completed recovery case. The unique auditEntryId makes retries idempotent. */
export async function indexAuditEntry(entryId: string): Promise<void> {
  const entry = await prisma.auditEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: { event: { include: { diagnosis: true, decision: true } } },
  });
  if (!TERMINAL_AUDIT_OUTCOMES.has(entry.outcome)) return;

  // Webhook recovery entries deliberately preserve their webhook input, while
  // the authoritative diagnosis/decision live on RevenueEvent. Merge both so
  // every terminal case remains useful, including records written before the
  // webhook began carrying complete snapshots.
  const diagnosis = {
    ...objectValue(entry.event.diagnosis),
    ...objectValue(entry.diagnosisSnapshot),
  };
  const decision = {
    ...objectValue(entry.event.decision),
    ...objectValue(entry.decisionSnapshot),
  };
  const daysToRecover =
    entry.outcome === "recovered"
      ? Math.max(0, Math.ceil((entry.timestamp.getTime() - entry.event.occurredAt.getTime()) / 86_400_000))
      : null;
  const summary = buildCaseSummaryText({
    causeLabel: stringValue(diagnosis.causeLabel, "unknown"),
    entityType: entry.event.entityType,
    amount: entry.event.amount,
    chosenAction: stringValue(decision.chosenAction, "unknown"),
    outcome: entry.outcome,
    daysToRecover,
  });
  const vector = await embed(summary, "document");
  const vectorLiteral = `[${vector.join(",")}]`;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "AuditEmbedding" (id, "auditEntryId", embedding)
     VALUES ($1, $2, $3::vector)
     ON CONFLICT ("auditEntryId") DO NOTHING`,
    randomUUID(),
    entry.id,
    vectorLiteral,
  );
}
