import { Router, Request, Response } from "express";
import { Prisma, EventType, WorkflowState } from "@prisma/client";
import { prisma } from "../../config/prisma";

export const entitiesRouter = Router();

// GET /entities?state=&cause=&eventType=&minAmount=&maxAmount=&search=&sort=&page=&limit=
entitiesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { state, cause, eventType, minAmount, maxAmount, search, sort } = req.query;

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.RevenueEventWhereInput = {};

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
      const matchingStates = await prisma.entityWorkflowState.findMany({
        where: { state: state.toUpperCase() as WorkflowState },
        select: { entityId: true },
      });
      const matchingEntityIds = matchingStates.map((s) => s.entityId);
      where.entityId = { in: matchingEntityIds };
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
        },
      }),
    ]);

    const entityIds = Array.from(new Set(events.map((e) => e.entityId)));
    const workflowStates = await prisma.entityWorkflowState.findMany({
      where: { entityId: { in: entityIds } },
    });
    const stateMap = new Map(workflowStates.map((s) => [s.entityId, s]));

    const result = events.map((event) => {
      const stateRow = stateMap.get(event.entityId);
      return {
        id: event.id,
        batchId: event.batchId,
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
        state: stateRow?.state ?? "DETECTED",
        causeLabel: event.diagnosis?.causeLabel ?? null,
        diagnosisMethod: event.diagnosis?.method ?? null,
        actionType: event.action?.actionType ?? null,
        actionResult: event.action?.result ?? null,
        actionIntegration: event.action?.integration ?? null,
        razorpayPaymentId: event.razorpayPaymentId ?? null,
        razorpayOrderId: event.razorpayOrderId ?? null,
        lastContactedAt: stateRow?.lastContactedAt?.toISOString() ?? null,
        attemptCount: stateRow?.attemptCount ?? 0,
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
          include: { customer: true },
        },
      },
    });

    const targetEntityIds = Array.from(new Set(auditEntries.map((a) => a.entityId)));
    const states = await prisma.entityWorkflowState.findMany({
      where: { entityId: { in: targetEntityIds } },
    });
    const stateMap = new Map(states.map((s) => [s.entityId, s.state]));

    const result = auditEntries.map((entry) => ({
      ...entry,
      workflowState: stateMap.get(entry.entityId) ?? "DETECTED",
    }));

    return res.status(200).json(result);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to fetch audit entries";
    console.error("[entitiesRouter] Error fetching audit entries:", error);
    return res.status(500).json({ error: errMessage });
  }
});
