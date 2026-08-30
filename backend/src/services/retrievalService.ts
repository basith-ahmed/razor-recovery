import { prisma } from "../config/prisma";
import { embed } from "../config/voyage";
import { env } from "../config/env";
import { buildCaseSummaryText } from "./embeddingService";

export interface SimilarCase {
  causeLabel: string;
  chosenAction: string;
  outcome: string;
  daysToRecover: number | null;
}

interface EmbeddingRow {
  diagnosisSnapshot: unknown;
  decisionSnapshot: unknown;
  outcome: string;
  daysToRecover: number | null;
}

function valueFromSnapshot(snapshot: unknown, key: string, fallback: string): string {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return fallback;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Retrieves completed historical cases using cosine distance in pgvector. */
export async function findSimilarCases(
  cause: string,
  entityType: string,
  amount: number,
  k = 3,
): Promise<SimilarCase[]> {
  if (!Number.isInteger(k) || k < 1 || !env.VOYAGE_API_KEY) return [];
  try {
    const query = buildCaseSummaryText({
      causeLabel: cause,
      entityType,
      amount,
      chosenAction: "",
      outcome: "",
      daysToRecover: null,
    });
    const vector = await embed(query, "query");
    const vectorLiteral = `[${vector.join(",")}]`;
    const rows = await prisma.$queryRawUnsafe<EmbeddingRow[]>(
      `SELECT a."diagnosisSnapshot", a."decisionSnapshot", a.outcome,
         CASE WHEN a.outcome = 'recovered'
           THEN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (a.timestamp - r."occurredAt")) / 86400))::int
           ELSE NULL END AS "daysToRecover"
       FROM "AuditEmbedding" e
       JOIN "AuditEntry" a ON a.id = e."auditEntryId"
       JOIN "RevenueEvent" r ON r.id = a."eventId"
       ORDER BY e.embedding <=> $1::vector
       LIMIT $2`,
      vectorLiteral,
      Math.min(k, 20),
    );

    return rows.map((row) => ({
      causeLabel: valueFromSnapshot(row.diagnosisSnapshot, "causeLabel", "unknown"),
      chosenAction: valueFromSnapshot(row.decisionSnapshot, "chosenAction", "unknown"),
      outcome: row.outcome,
      daysToRecover: row.daysToRecover,
    }));
  } catch (error) {
    console.warn("[retrievalService] findSimilarCases fallback:", error);
    return [];
  }
}
