import { Router, Request, Response } from "express";
import { Prisma, EventType, WorkflowState } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { eventWindowFilter } from "../../services/metricsService";
import { Window } from "../../domain/types";

export const entitiesRouter = Router();

const WINDOWS: Window[] = ["1h", "24h", "7d", "all"];

const RETRY_ACTION_TYPES = new Set(["retry_payment_immediate", "retry_payment_delayed"]);
const ESCALATE_ACTION_TYPES = new Set(["escalate_to_human"]);
const COOLDOWN_ACTION_TYPES = new Set(["pause_subscription"]);

export function deriveEventState(
  outcome?: string | null,
  actionType?: string | null,
  reasoning?: string | null,
): string {
  if (!outcome) return "DETECTED";
  if (outcome === "recovered" || outcome === "payment_confirmed") return "RECOVERED";
  if (outcome === "written_off" || outcome === "hard_decline" || outcome === "auto_cancel") return "WRITTEN_OFF";
  if (outcome === "reversed") return "REVERSED";
  if (outcome === "escalated" || (actionType && ESCALATE_ACTION_TYPES.has(actionType))) return "ESCALATED";
  if (actionType && RETRY_ACTION_TYPES.has(actionType)) return "RETRYING";
  if (actionType && COOLDOWN_ACTION_TYPES.has(actionType)) return "COOLING_DOWN";
  if (outcome === "pending") return "CONTACTED";
  if (outcome === "skipped") {
    if (reasoning?.includes("cooldown")) return "COOLING_DOWN";
    if (reasoning?.includes("DNC") || actionType === "dnc") return "DO_NOT_CONTACT";
    return "DO_NOT_CONTACT";
  }
  if (outcome === "failed") return "DETECTED";
  return "DETECTED";
}

// GET /entities?state=&cause=&eventType=&minAmount=&maxAmount=&search=&sort=&window=&page=&limit=
entitiesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { state, cause, eventType, minAmount, maxAmount, search, sort } = req.query;

    // Optional time-window filter; defaults to no time filter (show everything)
    let window: Window | undefined;
    if (typeof req.query.window === "string" && WINDOWS.includes(req.query.window as Window)) {
      window = req.query.window as Window;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.RevenueEventWhereInput = {
      ...(window ? eventWindowFilter(window) : {}),
    };

    if (eventType && typeof eventType === "string" && Object.values(EventType).includes(eventType as EventType)) {
      where.eventType = eventType as EventType;
    }

    if (minAmount || maxAmount) {
      where.amount = {
        gte: minAmount ? parseFloat(minAmount as string) : undefined,
        lte: maxAmount ? parseFloat(maxAmount as string) : undefined,
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

    const [total, events] = await Promise.all([
      prisma.revenueEvent.count({ where }),
      prisma.revenueEvent.findMany({
        where,
        orderBy,
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
      }),
    ]);

    const entityIds = Array.from(new Set(events.map((e) => e.entityId)));

    // Fetch all successful actions and workflow states for these entities to compute chronological attempt sequence
    const [allActions, workflowStates] = await Promise.all([
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
    ]);

    const workflowMap = new Map(workflowStates.map((w) => [w.entityId, w]));

    const entityActionsMap = new Map<string, typeof allActions>();
    for (const act of allActions) {
      const eid = act.event.entityId;
      if (!entityActionsMap.has(eid)) {
        entityActionsMap.set(eid, []);
      }
      entityActionsMap.get(eid)!.push(act);
    }

    const result = events.map((event) => {
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
        state: deriveEventState(latestAudit?.outcome, event.action?.actionType, decisionReasoning),
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
      };
    });

    return res.status(200).json({
      items: result,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to query entities";
    console.error("[entitiesRouter] Error fetching entities:", error);
    return res.status(500).json({ error: errMessage });
  }
});

// GET /entities/:id/audit — full ordered audit entries for an entity or event
entitiesRouter.get("/:id/audit", async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.id);
    const auditEntries = await prisma.auditEntry.findMany({
      where: {
        OR: [{ entityId: targetId }, { eventId: targetId }],
      },
      orderBy: { timestamp: "asc" },
      include: {
        event: {
          include: { customer: true, diagnosis: true },
        },
      },
    });

    // Fetch entity workflow states for the entities in the audit trail
    const entityIds = Array.from(new Set(auditEntries.map(e => e.entityId)));
    const workflowStates = await prisma.entityWorkflowState.findMany({
      where: { entityId: { in: entityIds } },
    });
    const workflowMap = new Map(workflowStates.map((w) => [w.entityId, w]));

    let runningAttempts = 0;
    let latestContactDate: Date | null = null;

    const result = auditEntries.map((entry) => {
      const actionType = (entry.actionSnapshot as Record<string, unknown> | null)?.actionType as string | undefined;
      const reasoning = (entry.decisionSnapshot as Record<string, unknown> | null)?.reasoning as string | undefined;
      const actionResult = (entry.actionSnapshot as Record<string, unknown> | null)?.result as string | undefined;
      const workflow = workflowMap.get(entry.entityId);
      
      const isSuccessfulAttempt = actionResult === "success";
      if (isSuccessfulAttempt) {
        runningAttempts += 1;
        latestContactDate = entry.timestamp;
      }
      
      let eventPayload = entry.event;
      if (eventPayload) {
        eventPayload = {
          ...eventPayload,
          attemptCount: runningAttempts > 0 ? runningAttempts : (workflow?.attemptCount ?? 0),
          cooldownUntil: workflow?.cooldownUntil,
          lastContactedAt: latestContactDate ? latestContactDate.toISOString() : (workflow?.lastContactedAt?.toISOString() ?? null),
        } as any;
      }
      
      return {
        ...entry,
        event: eventPayload,
        state: deriveEventState(entry.outcome, actionType, reasoning),
      };
    });

    return res.status(200).json(result);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to fetch audit entries";
    console.error("[entitiesRouter] Error fetching audit entries:", error);
    return res.status(500).json({ error: errMessage });
  }
});
