import { Router, Request, Response } from "express";
import {
  computeLiveMetrics,
  metricsTrend,
} from "../../services/metricsService";
import { parseWindow } from "../../domain/types";
import { handleRouteError } from "../../utils/apiResponse";

export const metricsRouter = Router();

// GET /metrics/summary — return the latest operational totals for the selected window.
metricsRouter.get("/summary", async (req: Request, res: Response) => {
  try {
    const window = parseWindow(req.query.window);
    const summary = await computeLiveMetrics(window);
    return res.status(200).json(summary);
  } catch (error: unknown) {
    return handleRouteError(res, error, "Failed to compute metrics summary");
  }
});

// GET /metrics/trend — return time-series data grouped by hour or day.
metricsRouter.get("/trend", async (req: Request, res: Response) => {
  try {
    const window = parseWindow(req.query.window);
    const bucket = req.query.bucket === "day" ? "day" : "hour";
    const trend = await metricsTrend(window, bucket);
    return res.status(200).json(trend);
  } catch (error: unknown) {
    return handleRouteError(res, error, "Failed to compute metrics trend");
  }
});
