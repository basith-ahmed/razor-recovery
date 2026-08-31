import { Router, Request, Response } from "express";
import { getPolicyConfiguration } from "../../services/policyService";
import { handleRouteError } from "../../utils/apiResponse";

export const policyRouter = Router();

// GET /policy — live policy.json, DNC list from Redis/DB, and compliance log
policyRouter.get("/", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10);
    const limit = parseInt(req.query.limit as string, 10);
    const dncPage = parseInt(req.query.dncPage as string, 10);
    const dncLimit = parseInt(req.query.dncLimit as string, 10);

    const config = await getPolicyConfiguration({
      page: isNaN(page) ? undefined : page,
      limit: isNaN(limit) ? undefined : limit,
      dncPage: isNaN(dncPage) ? undefined : dncPage,
      dncLimit: isNaN(dncLimit) ? undefined : dncLimit,
    });

    return res.status(200).json(config);
  } catch (error: unknown) {
    return handleRouteError(res, error, "Failed to fetch policy configuration");
  }
});
