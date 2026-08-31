import { Router, Request, Response } from "express";
import { listLookupCustomers, listCustomerEntities } from "../../services/customerService";
import {
  getPromise,
  getPromiseStats,
  listPromises,
  createPromise,
  sendPromiseReminderEmail,
  updatePromise,
} from "../../services/promiseService";
import { parsePagination, paginatedResponse } from "../../utils/pagination";
import { handleRouteError } from "../../utils/apiResponse";

export const promisesRouter = Router();

// GET /promises/stats
promisesRouter.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getPromiseStats();
    return res.status(200).json(stats);
  } catch (error) {
    return handleRouteError(res, error, "Failed to fetch promise statistics");
  }
});

// GET /promises/customers
promisesRouter.get("/customers", async (_req: Request, res: Response) => {
  try {
    const customers = await listLookupCustomers();
    return res.status(200).json(customers);
  } catch (error) {
    return handleRouteError(res, error, "Failed to fetch customers list");
  }
});

// GET /promises/customers/:customerId/entities
promisesRouter.get("/customers/:customerId/entities", async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId);
    const entities = await listCustomerEntities(customerId);
    return res.status(200).json(entities);
  } catch (error) {
    return handleRouteError(res, error, "Failed to fetch customer entities");
  }
});

// GET /promises/:id
promisesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const promise = await getPromise(id);
    return res.status(200).json(promise);
  } catch (error) {
    return handleRouteError(res, error, "Failed to fetch promise to pay");
  }
});

// GET /promises
promisesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { status, customerId, entityId, search } = req.query;
    const pagination = parsePagination(req.query);

    const { total, items } = await listPromises({
      status: typeof status === "string" ? status : undefined,
      customerId: typeof customerId === "string" ? customerId : undefined,
      entityId: typeof entityId === "string" ? entityId : undefined,
      search: typeof search === "string" ? search : undefined,
      skip: pagination.skip,
      limit: pagination.limit,
    });

    return res.status(200).json(paginatedResponse(items, total, pagination));
  } catch (error) {
    return handleRouteError(res, error, "Failed to list promises");
  }
});

// POST /promises
promisesRouter.post("/", async (req: Request, res: Response) => {
  try {
    const promise = await createPromise(req.body);
    return res.status(201).json(promise);
  } catch (error) {
    return handleRouteError(res, error, "Failed to create promise to pay");
  }
});

// POST /promises/:id/send-reminder
promisesRouter.post("/:id/send-reminder", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const updated = await sendPromiseReminderEmail(id);
    return res.status(200).json({
      message: "Reminder email sent successfully.",
      promise: updated,
    });
  } catch (error) {
    return handleRouteError(res, error, "Failed to send promise reminder email");
  }
});

// PATCH /promises/:id
promisesRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const updated = await updatePromise(id, req.body);
    return res.status(200).json(updated);
  } catch (error) {
    return handleRouteError(res, error, "Failed to update promise to pay");
  }
});
