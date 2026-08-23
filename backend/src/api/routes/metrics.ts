import { Router, Request, Response } from "express";
import { getFullMetricsSummary } from "../../services/metricsService";

export const metricsRouter = Router();

// GET /metrics/summary?batchId=
metricsRouter.get("/summary", async (req: Request, res: Response) => {
  try {
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;
    const summary = await getFullMetricsSummary(batchId);
    return res.status(200).json(summary);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to compute metrics summary";
    console.error("[metricsRouter] Error fetching metrics summary:", error);
    return res.status(500).json({ error: errMessage });
  }
});
