import { Prisma, EventType, WorkflowState } from "@prisma/client";
import { prisma } from "../config/prisma";
import { eventWindowFilter } from "./metricsService";
import { Window, ListEntitiesFilters, ListEntitiesPagination, EntitySummaryItem, EntityAuditDetailsResponse, DomainError, EnrichedRevenueEvent } from "../domain/types";
import { deriveEventState } from "../domain/stateMachine";
import { formatPromiseToPay } from "./promiseService";
import { escalateToHuman } from "../integrations/ticketMock";
import { recordAuditEntry } from "./auditService";
import { emitLiveUpdate } from "../api/websocket";

export { ListEntitiesFilters, ListEntitiesPagination, EntitySummaryItem, EntityAuditDetailsResponse };

/**
 * Lists revenue recovery entities with comprehensive filtering, state derivation, and attempt aggregation.
 * Excludes synthetic standalone promise events from the core dunning entity monitor.
 */
export async function listEntities(
  filters: ListEntitiesFilters = {},
  pagination: ListEntitiesPagination = { page: 1, limit: 20, skip: 0 }
) {
  const { state, cause, eventType, minAmount, maxAmount, search, sort, window } = filters;
  const { skip, limit } = pagination;

  const where: Prisma.RevenueEventWhereInput = {
    ...(window ? eventWindowFilter(window) : {}),
    // Exclude synthetic promise-only events from polluting the recovery entities monitor without dropping NULL errorCode/errorReason rows
    AND: [
      {
        OR: [
          { errorCode: null },
          { errorCode: { notIn: ["PROMISE_CREATED", "PROMISE_PAYMENT"] } },
        ],
      },
      {
        OR: [
          { errorReason: null },
          { errorReason: { notIn: ["promise_to_pay", "promise_settlement"] } },
        ],
      },
    ],
  };

  if (eventType && typeof eventType === "string" && Object.values(EventType).includes(eventType as EventType)) {
    where.eventType = eventType as EventType;
  }

  if (minAmount !== undefined || maxAmount !== undefined) {
    const numMin = typeof minAmount === "string" ? parseFloat(minAmount) : minAmount;
    const numMax = typeof maxAmount === "string" ? parseFloat(maxAmount) : maxAmount;
    where.amount = {
      gte: numMin !== undefined && !isNaN(numMin) ? numMin : undefined,
      lte: numMax !== undefined && !isNaN(numMax) ? numMax : undefined,
    };
  }

  if (cause && typeof cause === "string") {
    where.diagnosis = { causeLabel: cause };
  }

  if (search && typeof search === "string") {
    const q = search.trim();
    where.OR = [
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
      { entityId: { contains: q, mode: "insensitive" } },
      { id: { contains: q, mode: "insensitive" } },
    ];
  }

  if (state && typeof state === "string" && Object.values(WorkflowState).includes(state.toUpperCase() as WorkflowState)) {
    const targetState = state.toUpperCase() as WorkflowState;
    if (targetState === "RECOVERED") {
      where.auditEntries = { some: { outcome: { in: ["recovered", "payment_confirmed"] } } };
    } else if (targetState === "WRITTEN_OFF") {
      where.auditEntries = { some: { outcome: { in: ["written_off", "hard_decline", "auto_cancel"] } } };
    } else if (targetState === "RETRYING") {
      where.auditEntries = { some: { outcome: "pending" } };
      where.action = { actionType: { in: ["retry_payment_immediate", "retry_payment_delayed"] } };
    } else if (targetState === "ESCALATED") {
      where.OR = [
        { auditEntries: { some: { outcome: "escalated" } } },
        { auditEntries: { some: { outcome: "pending" } }, action: { actionType: "escalate_to_human" } },
      ];
    } else if (targetState === "COOLING_DOWN") {
      where.auditEntries = { some: { outcome: "pending" } };
      where.action = { actionType: "pause_subscription" };
    } else if (targetState === "CONTACTED") {
      where.auditEntries = { some: { outcome: "pending" } };
      where.action = { actionType: { notIn: ["retry_payment_immediate", "retry_payment_delayed", "escalate_to_human", "pause_subscription"] } };
    } else if (targetState === "DO_NOT_CONTACT") {
      where.auditEntries = { some: { outcome: "skipped" } };
      where.action = { actionType: "none" };
    } else if (targetState === "DETECTED") {
      where.AND = [
        ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
        {
          OR: [
            { auditEntries: { none: { outcome: { in: ["recovered", "written_off", "pending", "escalated"] } } } },
            { auditEntries: { some: { outcome: { in: ["skipped", "failed"] } } }, action: { actionType: { not: "none" } } }
          ]
        }
      ];
    }
  }

  let orderBy: Prisma.RevenueEventOrderByWithRelationInput = { occurredAt: "desc" };

  if (sort === "amount_desc") {
    orderBy = { amount: "desc" };
  } else if (sort === "amount_asc") {
    orderBy = { amount: "asc" };
  } else if (sort === "occurredAt_asc") {
    orderBy = { occurredAt: "asc" };
  } else if (sort === "occurredAt_desc") {
    orderBy = { occurredAt: "desc" };
  } else if (sort === "riskScore_desc") {
    orderBy = { riskScore: "desc" };
  } else if (sort === "riskScore_asc") {
    orderBy = { riskScore: "asc" };
  }

  // Total distinct entities matching criteria
  const distinctEntityGroups = await prisma.revenueEvent.groupBy({
    by: ["entityId"],
    where,
  });
  const total = distinctEntityGroups.length;

  // Fetch the latest event for each distinct entity
  const events = await prisma.revenueEvent.findMany({
    where,
    distinct: ["entityId"],
    orderBy: [orderBy, { occurredAt: "desc" }, { id: "desc" }],
    skip,
    take: limit,
    include: {
      customer: true,
      diagnosis: true,
      decision: true,
      action: true,
      auditEntries: {
        orderBy: { sequenceNumber: "desc" },
        take: 1,
      },
    },
  });

  const entityIds = Array.from(new Set(events.map((e) => e.entityId)));

  // Fetch all successful actions, workflow states, and event counts for these entities
  const [allActions, workflowStates, eventCounts] = await Promise.all([
    prisma.action.findMany({
      where: {
        event: { entityId: { in: entityIds } },
        result: "success",
      },
      select: {
        eventId: true,
        executedAt: true,
        event: { select: { entityId: true } },
      },
      orderBy: { executedAt: "asc" },
    }),
    prisma.entityWorkflowState.findMany({
      where: { entityId: { in: entityIds } },
    }),
    prisma.revenueEvent.groupBy({
      by: ["entityId"],
      where: { entityId: { in: entityIds } },
      _count: { id: true },
    }),
  ]);

  const workflowMap = new Map(workflowStates.map((w) => [w.entityId, w]));
  const eventCountMap = new Map(eventCounts.map((g) => [g.entityId, g._count.id]));

  const entityActionsMap = new Map<string, typeof allActions>();
  for (const act of allActions) {
    const eid = act.event.entityId;
    if (!entityActionsMap.has(eid)) {
      entityActionsMap.set(eid, []);
    }
    entityActionsMap.get(eid)!.push(act);
  }

  const items = events.map((event) => {
    const latestAudit = event.auditEntries?.[0];
    const decisionReasoning =
      event.decision?.reasoning ??
      ((latestAudit?.decisionSnapshot as Record<string, unknown> | null)?.reasoning as string | undefined);

    const workflow = workflowMap.get(event.entityId);
    const entityActs = entityActionsMap.get(event.entityId) ?? [];
    const eventTimestamp = event.action?.executedAt ?? latestAudit?.timestamp ?? event.occurredAt;
    
    const priorOrCurrentActs = entityActs.filter((a) => a.executedAt <= eventTimestamp);

    const attemptCount = priorOrCurrentActs.length > 0
      ? priorOrCurrentActs.length
      : (workflow?.attemptCount ?? 0);
    const lastContactedAt = priorOrCurrentActs.length > 0
      ? priorOrCurrentActs[priorOrCurrentActs.length - 1].executedAt.toISOString()
      : (workflow?.lastContactedAt?.toISOString() ?? null);

    return {
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      customerId: event.customerId,
      customerName: event.customer?.name ?? "Unknown Customer",
      customerEmail: event.customer?.email ?? "N/A",
      eventType: event.eventType,
      amount: event.amount,
      currency: event.currency,
      occurredAt: event.occurredAt.toISOString(),
      riskScore: event.riskScore,
      state: workflow?.state ?? deriveEventState(latestAudit?.outcome, event.action?.actionType, decisionReasoning),
      stage: event.action ? "EXECUTED" : event.decision ? "DECIDED" : event.diagnosis ? "DIAGNOSED" : "DETECTED",
      causeLabel: event.diagnosis?.causeLabel ?? null,
      diagnosisMethod: event.diagnosis?.method ?? null,
      actionType: event.action?.actionType ?? null,
      actionResult: event.action?.result ?? null,
      actionIntegration: event.action?.integration ?? null,
      razorpayPaymentId: event.razorpayPaymentId ?? null,
      razorpayOrderId: event.razorpayOrderId ?? null,
      lastContactedAt,
      attemptCount,
      totalEventsCount: eventCountMap.get(event.entityId) ?? 1,
    };
  });

  return {
    total,
    items,
  };
}

/**
 * Retrieves full cryptographic audit trail, event timeline, customer info, and promise commitments for an entity.
 */
export async function getEntityAuditDetails(targetId: string) {
  const auditEntries = await prisma.auditEntry.findMany({
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

  const targetEntityId = auditEntries[0]?.entityId ?? targetId;

  const [workflowState, entityEvents, promises] = await Promise.all([
    prisma.entityWorkflowState.findUnique({
      where: { entityId: targetEntityId },
    }),
    prisma.revenueEvent.findMany({
      where: { entityId: targetEntityId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      include: {
        customer: true,
        diagnosis: true,
        decision: true,
        action: true,
        auditEntries: {
          orderBy: { sequenceNumber: "desc" },
          take: 1,
        },
      },
    }),
    prisma.promiseToPay.findMany({
      where: { entityId: targetEntityId },
      orderBy: { createdAt: "desc" },
      include: { customer: true },
    }),
  ]);

  let runningAttempts = 0;
  let latestContactDate: Date | null = null;

  const formattedAuditEntries = auditEntries.map((entry) => {
    const actionType = (entry.actionSnapshot as Record<string, unknown> | null)?.actionType as string | undefined;
    const reasoning = (entry.decisionSnapshot as Record<string, unknown> | null)?.reasoning as string | undefined;
    const actionResult = (entry.actionSnapshot as Record<string, unknown> | null)?.result as string | undefined;
    
    const isSuccessfulAttempt = actionResult === "success";
    if (isSuccessfulAttempt) {
      runningAttempts += 1;
      latestContactDate = entry.timestamp;
    }
    
    let eventPayload = entry.event;
    if (eventPayload) {
      eventPayload = {
        ...eventPayload,
        attemptCount: runningAttempts > 0 ? runningAttempts : (workflowState?.attemptCount ?? 0),
        cooldownUntil: workflowState?.cooldownUntil,
        lastContactedAt: latestContactDate ? latestContactDate.toISOString() : (workflowState?.lastContactedAt?.toISOString() ?? null),
      } as any;
    }
    
    return {
      ...entry,
      event: eventPayload,
      state: deriveEventState(entry.outcome, actionType, reasoning),
    };
  });

  const formattedEvents = entityEvents.map((ev) => {
    const latestAudit = ev.auditEntries?.[0];
    const decisionReasoning =
      ev.decision?.reasoning ??
      ((latestAudit?.decisionSnapshot as Record<string, unknown> | null)?.reasoning as string | undefined);

    return {
      id: ev.id,
      entityType: ev.entityType,
      entityId: ev.entityId,
      customerId: ev.customerId,
      customerName: ev.customer?.name ?? "Unknown Customer",
      customerEmail: ev.customer?.email ?? "N/A",
      eventType: ev.eventType,
      amount: ev.amount,
      currency: ev.currency,
      occurredAt: ev.occurredAt.toISOString(),
      riskScore: ev.riskScore,
      urgency: ev.urgency,
      state: deriveEventState(latestAudit?.outcome, ev.action?.actionType, decisionReasoning),
      stage: ev.action ? "EXECUTED" : ev.decision ? "DECIDED" : ev.diagnosis ? "DIAGNOSED" : "DETECTED",
      causeLabel: ev.diagnosis?.causeLabel ?? null,
      diagnosisMethod: ev.diagnosis?.method ?? null,
      diagnosisConfidence: ev.diagnosis?.confidence ?? null,
      diagnosisReasoning: ev.diagnosis?.reasoning ?? null,
      actionType: ev.action?.actionType ?? null,
      actionResult: ev.action?.result ?? null,
      actionIntegration: ev.action?.integration ?? null,
      decisionReasoning: decisionReasoning ?? null,
      chosenAction: ev.decision?.chosenAction ?? null,
      legalActions: ev.decision?.legalActions ?? [],
    };
  });

  return {
    entityId: targetEntityId,
    customer: entityEvents[0]?.customer ?? auditEntries[0]?.event?.customer ?? null,
    workflowState: workflowState ?? null,
    events: formattedEvents,
    promises: promises.map(formatPromiseToPay),
    auditEntries: formattedAuditEntries,
  };
}

/**
 * Manually escalates an active entity (e.g. DNC customer entities) to human review / tickets.
 * Updates workflow state, creates or appends to a ticket, and records a hash-chained audit entry.
 */
export async function escalateEntityToHuman(
  targetId: string,
  options: { reason?: string; agentName?: string } = {}
) {
  const latestEvent = await prisma.revenueEvent.findFirst({
    where: {
      OR: [{ entityId: targetId }, { id: targetId }],
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    include: {
      customer: true,
      diagnosis: true,
      decision: true,
      action: true,
    },
  });

  if (!latestEvent) {
    throw new DomainError(`Entity ${targetId} not found.`, "ENTITY_NOT_FOUND");
  }

  const entityId = latestEvent.entityId;
  const reason =
    options.reason ||
    (latestEvent.customer?.dncFlag
      ? "Manual operator escalation, customer is on DNC list and requires specialized human handling."
      : "Manual operator escalation to human agent review.");

  // 1. Create / update ticket
  const actionResult = await escalateToHuman(entityId, reason);

  if (options.agentName && actionResult.detail) {
    await prisma.ticketNote.create({
      data: {
        ticketId: actionResult.detail,
        author: options.agentName,
        content: `Transferred to human escalations by operator ${options.agentName}. Reason: ${reason}`,
        type: "internal",
      },
    });
  }

  // 2. Persist / update action
  await prisma.action.upsert({
    where: { eventId: latestEvent.id },
    create: {
      eventId: latestEvent.id,
      actionType: "escalate_to_human",
      result: "success",
      integration: "MOCK",
    },
    update: {
      actionType: "escalate_to_human",
      result: "success",
      integration: "MOCK",
    },
  });

  // 3. Update entity workflow state to ESCALATED
  await prisma.entityWorkflowState.upsert({
    where: { entityId },
    create: {
      entityId,
      customerId: latestEvent.customerId,
      state: "ESCALATED",
      lastContactedAt: new Date(),
    },
    update: {
      state: "ESCALATED",
      lastContactedAt: new Date(),
    },
  });

  // 4. Record cryptographic audit entry
  const enrichedEvent: EnrichedRevenueEvent = {
    id: latestEvent.id,
    entityType: latestEvent.entityType,
    entityId: latestEvent.entityId,
    customerId: latestEvent.customerId,
    eventType: latestEvent.eventType,
    amount: latestEvent.amount,
    currency: latestEvent.currency,
    occurredAt: latestEvent.occurredAt.toISOString(),
    razorpayPaymentId: latestEvent.razorpayPaymentId ?? undefined,
    razorpayOrderId: latestEvent.razorpayOrderId ?? undefined,
    errorCode: latestEvent.errorCode ?? undefined,
    errorReason: latestEvent.errorReason ?? undefined,
    rawPayload: (latestEvent.rawPayload as Record<string, unknown>) ?? {},
    riskScore: latestEvent.riskScore ?? 0.5,
    urgency: latestEvent.urgency ?? 0.5,
  };

  const auditEntry = await recordAuditEntry({
    event: enrichedEvent,
    diagnosis: {
      causeLabel: latestEvent.diagnosis?.causeLabel ?? "dnc_manual_override",
      confidence: latestEvent.diagnosis?.confidence ?? 1.0,
      method: latestEvent.diagnosis?.method ?? "RULE",
      reasoning: latestEvent.customer?.dncFlag
        ? "Customer is marked Do-Not-Contact (DNC). Manual operator intervention escalated entity for human review."
        : "Manual operator escalation.",
    },
    decision: {
      legalActions: ["escalate_to_human"],
      chosenAction: "escalate_to_human",
      reasoning: reason,
      policyVersion: "1.0.0",
    },
    action: actionResult,
  });

  // 5. Emit live WebSocket update
  try {
    await emitLiveUpdate(latestEvent.id);
  } catch (err) {
    console.error("[entityService] Failed to emit live update on escalation:", err);
  }

  return {
    success: true,
    entityId,
    ticketId: actionResult.detail,
    state: "ESCALATED",
    auditEntryId: auditEntry.id,
  };
}
