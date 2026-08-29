import { prisma } from "../config/prisma";
import { requestText } from "../config/openai";
import { embed } from "../config/voyage";
import { DomainError } from "../domain/types";

export interface AuditQueryParams {
  question: string;
  entityId?: string;
}

export interface AuditQueryResponse {
  answer: string;
  citedEntityIds: string[];
}

export function extractCitations(text: string): string[] {
  const matches = text.matchAll(/\[entity:([^\]\s]+)\]/g);
  const ids: string[] = [];
  for (const match of matches) {
    if (match[1] && !ids.includes(match[1])) {
      ids.push(match[1]);
    }
  }
  return ids;
}

function formatAuditEntry(entry: {
  id: string;
  entityId: string;
  eventId: string;
  actor: string;
  outcome: string;
  timestamp: Date;
  inputSnapshot: unknown;
  diagnosisSnapshot: unknown;
  decisionSnapshot: unknown;
  actionSnapshot: unknown;
  event?: {
    eventType?: string;
    amount?: number;
    currency?: string;
    diagnosis?: { causeLabel?: string; reasoning?: string | null; method?: string; confidence?: number } | null;
    decision?: { chosenAction?: string; reasoning?: string } | null;
  } | null;
}): string {
  const input = entry.inputSnapshot as Record<string, unknown> | null;
  const diagnosis = entry.diagnosisSnapshot as Record<string, unknown> | null;
  const decision = entry.decisionSnapshot as Record<string, unknown> | null;
  const action = entry.actionSnapshot as Record<string, unknown> | null;

  const eventType = (input?.eventType as string) ?? entry.event?.eventType ?? "unknown";
  const amount = (input?.amount as number) ?? entry.event?.amount ?? 0;
  const currency = (input?.currency as string) ?? entry.event?.currency ?? "INR";
  const cause = (diagnosis?.causeLabel as string) ?? entry.event?.diagnosis?.causeLabel ?? "unknown";
  const method = (diagnosis?.method as string) ?? entry.event?.diagnosis?.method ?? "RULE";
  const confidence = (diagnosis?.confidence as number) ?? entry.event?.diagnosis?.confidence ?? 1;
  const diagReasoning =
    (diagnosis?.reasoning as string) ??
    entry.event?.diagnosis?.reasoning ??
    (method === "RULE" ? "Deterministic rule-based diagnosis from event error signals" : "No additional diagnostic notes");
  const chosenAction = (decision?.chosenAction as string) ?? entry.event?.decision?.chosenAction ?? "none";
  const decReasoning = (decision?.reasoning as string) ?? entry.event?.decision?.reasoning ?? "Policy-guided action selection";
  const actionType = (action?.actionType as string) ?? "none";
  const actionResult = (action?.result as string) ?? "none";

  return [
    `[entity:${entry.entityId}]`,
    `Event: ${eventType}`,
    `Amount: ₹${amount} ${currency}`,
    `Time: ${entry.timestamp.toISOString()}`,
    `Actor: ${entry.actor}`,
    `Diagnosis: ${cause} (Method: ${method}, Confidence: ${Math.round(confidence * 100)}%)`,
    `Diagnosis Reasoning: ${diagReasoning}`,
    `Decision: ${chosenAction}`,
    `Decision Reasoning: ${decReasoning}`,
    `Action: ${actionType} (${actionResult})`,
    `Outcome: ${entry.outcome}`,
  ].join(" | ");
}

export async function queryAuditTrail(params: AuditQueryParams): Promise<AuditQueryResponse> {
  const question = params.question.trim();
  if (!question) {
    return {
      answer: "Please provide a question to query the audit trail.",
      citedEntityIds: [],
    };
  }

  let formattedRecords = "";

  if (params.entityId) {
    const targetId = params.entityId.trim();
    const entries = await prisma.auditEntry.findMany({
      where: {
        OR: [{ entityId: targetId }, { eventId: targetId }],
      },
      orderBy: { timestamp: "asc" },
      include: {
        event: {
          include: { customer: true, diagnosis: true, decision: true, action: true },
        },
      },
    });

    if (entries.length === 0) {
      formattedRecords = `No audit records found in the system for entity/event ID "${targetId}".`;
    } else {
      formattedRecords = entries.map(formatAuditEntry).join("\n");
    }
  } else {
    // Cross-entity query: use vector search via Voyage AI + pgvector
    try {
      const vector = await embed(question, "query");
      const vectorLiteral = `[${vector.join(",")}]`;

      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          entityId: string;
          eventId: string;
          actor: string;
          outcome: string;
          timestamp: Date;
          inputSnapshot: unknown;
          diagnosisSnapshot: unknown;
          decisionSnapshot: unknown;
          actionSnapshot: unknown;
        }>
      >(
        `SELECT a.id, a."entityId", a."eventId", a.actor, a.outcome, a.timestamp,
                a."inputSnapshot", a."diagnosisSnapshot", a."decisionSnapshot", a."actionSnapshot"
         FROM "AuditEmbedding" e
         JOIN "AuditEntry" a ON a.id = e."auditEntryId"
         ORDER BY e.embedding <=> $1::vector
         LIMIT 6`,
        vectorLiteral,
      );

      if (rows.length > 0) {
        formattedRecords = rows.map((r) => formatAuditEntry({ ...r, timestamp: new Date(r.timestamp) })).join("\n");
      }
    } catch (embeddingError) {
      console.warn("[queryService] Vector retrieval failed, falling back to recent audit entries:", embeddingError);
    }

    // If vector search returned nothing or embeddings aren't populated yet, fallback to recent entries
    if (!formattedRecords) {
      const recent = await prisma.auditEntry.findMany({
        orderBy: { timestamp: "desc" },
        take: 8,
        include: {
          event: {
            include: { customer: true, diagnosis: true, decision: true, action: true },
          },
        },
      });
      formattedRecords = recent.map(formatAuditEntry).join("\n");
    }
  }

  const systemInstructions = `You are an audit-trail assistant for a payment-recovery system. Answer the
user's question using ONLY the audit records provided below. For every
factual claim, cite the entity ID it came from in the form [entity:{id}].
If the provided records do not contain enough information to answer, say so
explicitly — do not guess, infer beyond what's written, or draw on any
outside knowledge about payments or this company.

Audit records:
${formattedRecords}

Respond in plain prose, 2-4 sentences unless the question specifically asks
for a list.`;

  let rawAnswer: string;
  try {
    rawAnswer = await requestText({
      instructions: systemInstructions,
      input: `Question: ${question}`,
    });
  } catch (error) {
    throw new DomainError("Failed to query audit assistant LLM.", "LLM_QUERY_FAILED", error);
  }

  const citedEntityIds = extractCitations(rawAnswer);

  return {
    answer: rawAnswer,
    citedEntityIds,
  };
}
