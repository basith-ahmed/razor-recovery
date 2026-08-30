import { prisma } from "../config/prisma";
import { requestText } from "../config/openai";
import { embed } from "../config/voyage";
import { DomainError } from "../domain/types";

export type QueryScope = "escalations" | "promises" | "entities" | "metrics" | "policy" | "general";

export interface AuditQueryParams {
  question: string;
  entityId?: string;
  scope?: QueryScope | string;
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
      answer: "Please provide a question.",
      citedEntityIds: [],
    };
  }

  const scope = params.scope || "general";

  // CASE 1: Scoped to a specific entity (on detail pages)
  if (params.entityId) {
    const targetId = params.entityId.trim();
    const [entries, specificTicket, specificPromise, specificWorkflow] = await Promise.all([
      prisma.auditEntry.findMany({
        where: {
          OR: [{ entityId: targetId }, { eventId: targetId }],
        },
        orderBy: { timestamp: "asc" },
        include: {
          event: {
            include: { customer: true, diagnosis: true, decision: true, action: true },
          },
        },
      }),
      prisma.ticket.findFirst({
        where: { entityId: targetId },
        include: { notes: true },
      }),
      prisma.promiseToPay.findFirst({
        where: { entityId: targetId },
        include: { customer: true },
      }),
      prisma.entityWorkflowState.findUnique({
        where: { entityId: targetId },
        include: { customer: true },
      }),
    ]);

    const entityContextParts: string[] = [];
    if (specificWorkflow) {
      entityContextParts.push(
        `Entity Status: ${specificWorkflow.state}, Attempts: ${specificWorkflow.attemptCount}, Customer: ${specificWorkflow.customer?.name || "N/A"} (${specificWorkflow.customer?.email || "N/A"}), Cooldown: ${specificWorkflow.cooldownUntil?.toISOString() || "none"}`
      );
    }
    if (specificTicket) {
      entityContextParts.push(
        `Associated Ticket: ID ${specificTicket.id}, Status: ${specificTicket.status}, Priority: ${specificTicket.priority}, Reason: ${specificTicket.reason}`
      );
    }
    if (specificPromise) {
      entityContextParts.push(
        `Associated Promise: ID ${specificPromise.id}, Amount: ₹${specificPromise.promisedAmount}, Status: ${specificPromise.status}, Due: ${specificPromise.promisedDate.toISOString()}`
      );
    }

    const formattedRecords = [
      ...entityContextParts,
      ...entries.map(formatAuditEntry),
    ].join("\n") || `No records found for entity "${targetId}".`;

    const systemInstructions = `You are the AI Assistant for RazorRecovery evaluating record [entity:${targetId}].
Answer the user's question using the specific entity status, customer details, tickets, promises, and cryptographic audit sequence provided below.
Always cite the entity ID in the form [entity:${targetId}].

## Entity Records:
${formattedRecords}

Respond concisely (2-4 sentences).`;

    const rawAnswer = await requestText({
      instructions: systemInstructions,
      input: `Question: ${question}`,
    });

    return {
      answer: rawAnswer,
      citedEntityIds: extractCitations(rawAnswer),
    };
  }

  // CASE 2: Escalations page context (/tickets)
  if (scope === "escalations") {
    const [openCount, recoveredCount, writtenOffCount, recentTickets] = await Promise.all([
      prisma.ticket.count({ where: { status: "open" } }),
      prisma.ticket.count({ where: { status: "recovered" } }),
      prisma.ticket.count({ where: { status: "written_off" } }),
      prisma.ticket.findMany({
        orderBy: { createdAt: "desc" },
        take: 15,
        include: { notes: true },
      }),
    ]);

    const ticketsData = recentTickets
      .map(
        (t) =>
          `[entity:${t.entityId}] Ticket ID: ${t.id}, Status: ${t.status}, Priority: ${t.priority}, Reason: ${t.reason}, Notes Count: ${t.notes.length}, Created: ${t.createdAt.toISOString()}`
      )
      .join("\n");

    const systemInstructions = `You are the AI Assistant on the Human Escalation Workspace page.
Answer the user's question with direct context of current escalation tickets.
- Total Open/Active Escalations: ${openCount}
- Total Recovered by Agents: ${recoveredCount}
- Total Written Off: ${writtenOffCount}

Recent Escalation Records:
${ticketsData}

If the user asks "how many active", "active cases", or "open tickets", directly state that there are currently ${openCount} open escalation tickets. Cite entities as [entity:{id}] when referencing specific tickets.`;

    const rawAnswer = await requestText({
      instructions: systemInstructions,
      input: `Question: ${question}`,
    });

    return {
      answer: rawAnswer,
      citedEntityIds: extractCitations(rawAnswer),
    };
  }

  // CASE 3: Promises to Pay page context (/promises)
  if (scope === "promises") {
    const [allPromises, keptPromises] = await Promise.all([
      prisma.promiseToPay.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { customer: true },
      }),
      prisma.promiseToPay.findMany({
        where: { status: "kept" },
        select: { promisedAmount: true },
      }),
    ]);

    const pendingCount = allPromises.filter((p) => p.status === "pending").length;
    const reminderSentCount = allPromises.filter((p) => p.status === "reminder_sent").length;
    const activeCount = pendingCount + reminderSentCount;
    const keptCount = allPromises.filter((p) => p.status === "kept").length;
    const brokenCount = allPromises.filter((p) => p.status === "broken").length;
    const totalPromised = allPromises.reduce((sum, p) => sum + p.promisedAmount, 0);
    const totalRecovered = keptPromises.reduce((sum, p) => sum + p.promisedAmount, 0);

    const promisesData = allPromises
      .map(
        (p) =>
          `[entity:${p.entityId}] Promise ID: ${p.id}, Customer: ${p.customer?.name ?? p.customerId}, Amount: ₹${p.promisedAmount}, Status: ${p.status}, Due Date: ${p.promisedDate.toISOString()}`
      )
      .join("\n");

    const systemInstructions = `You are the AI Assistant on the Promise-to-Pay Tracker page.
Answer the user's question with direct context of customer payment commitments.
- Active Commitments: ${activeCount} (${pendingCount} pending, ${reminderSentCount} in grace period)
- Total Kept/Recovered: ${keptCount} (₹${totalRecovered.toLocaleString("en-IN")})
- Broken / Escalated: ${brokenCount}
- Total Promised Volume: ₹${totalPromised.toLocaleString("en-IN")} across ${allPromises.length} records

Recent Commitments:
${promisesData}

If the user asks "how many active", directly state that there are ${activeCount} active promises (${pendingCount} pending, ${reminderSentCount} in grace period). Cite entities as [entity:{id}] when referencing specific records.`;

    const rawAnswer = await requestText({
      instructions: systemInstructions,
      input: `Question: ${question}`,
    });

    return {
      answer: rawAnswer,
      citedEntityIds: extractCitations(rawAnswer),
    };
  }

  // CASE 4: Metrics / Analytics page context (/metrics)
  if (scope === "metrics") {
    const [atRiskLedgers, recoveredLedgers, eventsCount, causes] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        where: { type: "AT_RISK" },
        _sum: { amount: true },
      }),
      prisma.ledgerEntry.aggregate({
        where: { type: "RECOVERED" },
        _sum: { amount: true },
      }),
      prisma.revenueEvent.count(),
      prisma.diagnosis.groupBy({
        by: ["causeLabel"],
        _count: { _all: true },
      }),
    ]);

    const atRisk = atRiskLedgers._sum.amount ?? 0;
    const recovered = recoveredLedgers._sum.amount ?? 0;
    const rate = atRisk > 0 ? (recovered / atRisk) * 100 : 0;
    const causesSummary = causes.map((c) => `${c.causeLabel}: ${c._count._all} events`).join(", ");

    const systemInstructions = `You are the Performance Analytics AI Assistant on the Analytics & Metrics page.
Answer the user's question with direct context of current financial recovery metrics:
- Total Events Processed: ${eventsCount}
- Total Amount at Risk: ₹${atRisk.toLocaleString("en-IN")}
- Total Amount Recovered: ₹${recovered.toLocaleString("en-IN")}
- Overall Recovery Rate: ${rate.toFixed(1)}%
- Diagnosed Failure Causes: ${causesSummary}
- Communication Channels: Email (unit cost ~₹0.50), SMS (unit cost ~₹1.50), Razorpay Links (unit cost ~₹1.00), Human Agent (unit cost ~₹200.00)

Answer the user's question directly with concise, accurate financial analytics. When citing entities, use [entity:{id}].`;

    const rawAnswer = await requestText({
      instructions: systemInstructions,
      input: `Question: ${question}`,
    });

    return {
      answer: rawAnswer,
      citedEntityIds: extractCitations(rawAnswer),
    };
  }

  // CASE 5: Entities page context (/entities)
  if (scope === "entities") {
    const [workflowStates, recentEvents, topCauses] = await Promise.all([
      prisma.entityWorkflowState.findMany({
        include: { customer: true },
        take: 50,
      }),
      prisma.revenueEvent.findMany({
        orderBy: { occurredAt: "desc" },
        take: 15,
        include: { customer: true, diagnosis: true, decision: true, action: true },
      }),
      prisma.diagnosis.groupBy({
        by: ["causeLabel"],
        _count: { _all: true },
      }),
    ]);

    const stateCounts: Record<string, number> = {};
    for (const ws of workflowStates) {
      stateCounts[ws.state] = (stateCounts[ws.state] || 0) + 1;
    }
    const activeEntitiesCount =
      (stateCounts["DETECTED"] || 0) +
      (stateCounts["CONTACTED"] || 0) +
      (stateCounts["RETRYING"] || 0) +
      (stateCounts["COOLING_DOWN"] || 0) +
      (stateCounts["ESCALATED"] || 0);

    const entitiesData = recentEvents
      .map((ev) => {
        const diag = ev.diagnosis?.causeLabel || "unknown";
        const dec = ev.decision?.chosenAction || "none";
        const act = ev.action ? `${ev.action.actionType} (${ev.action.result})` : "none";
        return `[entity:${ev.entityId}] Type: ${ev.eventType}, Amount: ₹${ev.amount}, Customer: ${ev.customer?.name || ev.customerId}, Cause: ${diag}, Decision: ${dec}, Action: ${act}`;
      })
      .join("\n");

    const causesSummary = topCauses.map((c) => `${c.causeLabel}: ${c._count._all}`).join(", ");

    const systemInstructions = `You are the Revenue Entities AI Assistant on the Failed Payment & Recovery Entities page.
Answer the user's question with direct context of tracked entities and recovery state machines:
- Active Entities in Workflow: ${activeEntitiesCount} (Total Tracked: ${workflowStates.length})
- State Distribution: ${JSON.stringify(stateCounts)}
- Diagnosed Failure Causes: ${causesSummary}

Recent Entity Activity:
${entitiesData}

If asked about active entities, state that there are ${activeEntitiesCount} active entities undergoing recovery workflows. Cite entities as [entity:{id}] when referencing specific records.`;

    const rawAnswer = await requestText({
      instructions: systemInstructions,
      input: `Question: ${question}`,
    });

    return {
      answer: rawAnswer,
      citedEntityIds: extractCitations(rawAnswer),
    };
  }

  // CASE 6: Policy & Compliance page context (/policy)
  if (scope === "policy") {
    const dncCount = await prisma.customer.count({ where: { dncFlag: true } });

    const systemInstructions = `You are the Policy & Compliance AI Assistant on the Policy & Compliance Configuration page.
Answer the user's question with direct context of the RazorRecovery policy engine, DNC guardrails, and cryptographic audit chains:
- Customers on DO_NOT_CONTACT (DNC) list: ${dncCount}
- Failure Causes Governed: CARD_DECLINED (max 3 retries, 4h cooldown), INSUFFICIENT_FUNDS (max 2 retries, 24h cooldown), AUTH_EXPIRED (max 1 retry, 48h cooldown), BANK_DOWNTIME (max 4 retries, 2h cooldown), DISPUTED (0 retries, immediate human escalation)
- Compliance Rules: Any customer with dncFlag=true is legally blocked from automated outbound emails/SMS and marked DO_NOT_CONTACT.
- Audit Security: Every state transition and decision is hashed with SHA-256 in an immutable hash chain with pgvector embeddings for verifiable audit integrity.

Answer the user's question accurately regarding rules, compliance limits, and verification.`;

    const rawAnswer = await requestText({
      instructions: systemInstructions,
      input: `Question: ${question}`,
    });

    return {
      answer: rawAnswer,
      citedEntityIds: extractCitations(rawAnswer),
    };
  }

  // CASE 7: General system overview & vector search
  const [workflowStates, openTicketsCount, activePromisesCount] = await Promise.all([
    prisma.entityWorkflowState.findMany({ select: { state: true } }),
    prisma.ticket.count({ where: { status: "open" } }),
    prisma.promiseToPay.count({ where: { status: { in: ["pending", "reminder_sent"] } } }),
  ]);

  const stateCounts: Record<string, number> = {};
  for (const ws of workflowStates) {
    stateCounts[ws.state] = (stateCounts[ws.state] || 0) + 1;
  }
  const activeEntitiesCount =
    (stateCounts["DETECTED"] || 0) +
    (stateCounts["CONTACTED"] || 0) +
    (stateCounts["RETRYING"] || 0) +
    (stateCounts["COOLING_DOWN"] || 0) +
    (stateCounts["ESCALATED"] || 0);

  let formattedRecords = "";
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
      vectorLiteral
    );
    if (rows.length > 0) {
      formattedRecords = rows.map((r) => formatAuditEntry({ ...r, timestamp: new Date(r.timestamp) })).join("\n");
    }
  } catch {
    // fallback to recent
  }

  if (!formattedRecords) {
    const recent = await prisma.auditEntry.findMany({
      orderBy: { timestamp: "desc" },
      take: 8,
      include: { event: { include: { customer: true, diagnosis: true, decision: true, action: true } } },
    });
    formattedRecords = recent.map(formatAuditEntry).join("\n");
  }

  const systemInstructions = `You are the AI Assistant for RazorRecovery revenue recovery system.
Current System Overview:
- Active entities in recovery workflows: ${activeEntitiesCount} (Total: ${workflowStates.length}, State Breakdown: ${JSON.stringify(stateCounts)})
- Open Escalation Tickets: ${openTicketsCount}
- Active Promises to Pay: ${activePromisesCount}

Relevant Audit Records:
${formattedRecords}

Answer the user's question directly and concisely. When citing entities, use [entity:{id}].`;

  const rawAnswer = await requestText({
    instructions: systemInstructions,
    input: `Question: ${question}`,
  });

  return {
    answer: rawAnswer,
    citedEntityIds: extractCitations(rawAnswer),
  };
}
