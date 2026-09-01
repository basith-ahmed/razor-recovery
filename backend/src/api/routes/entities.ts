import { Router, Request, Response } from "express";
import { parseWindow } from "../../domain/types";
import { parsePagination, paginatedResponse } from "../../utils/pagination";
import { handleRouteError } from "../../utils/apiResponse";
import { listEntities, getEntityAuditDetails, escalateEntityToHuman } from "../../services/entityService";

export const entitiesRouter = Router();

// GET /entities — list entities with filters, sorting, and pagination.
entitiesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { state, cause, eventType, minAmount, maxAmount, search, sort } = req.query;
    const window = req.query.window ? parseWindow(req.query.window) : undefined;
    const pagination = parsePagination(req.query);

    const { total, items } = await listEntities(
      {
        state: typeof state === "string" ? state : undefined,
        cause: typeof cause === "string" ? cause : undefined,
        eventType: typeof eventType === "string" ? eventType : undefined,
        minAmount: minAmount !== undefined ? String(minAmount) : undefined,
        maxAmount: maxAmount !== undefined ? String(maxAmount) : undefined,
        search: typeof search === "string" ? search : undefined,
        sort: typeof sort === "string" ? sort : undefined,
        window,
      },
      pagination
    );

    return res.status(200).json(paginatedResponse(items, total, pagination));
  } catch (error: unknown) {
    return handleRouteError(res, error, "Failed to query entities");
  }
});

// GET /entities/:id/audit — return the full audit trail for one entity or event.
entitiesRouter.get("/:id/audit", async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.id);
    const details = await getEntityAuditDetails(targetId);
    return res.status(200).json(details);
  } catch (error: unknown) {
    return handleRouteError(res, error, "Failed to fetch audit entries");
  }
});

// POST /entities/:id/escalate — move the entity into human review with a reason.
entitiesRouter.post("/:id/escalate", async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.id);
    const { reason, agentName } = req.body || {};
    const result = await escalateEntityToHuman(targetId, { reason, agentName });
    return res.status(200).json(result);
  } catch (error: unknown) {
    return handleRouteError(res, error, "Failed to escalate entity to human review");
  }
});
