import { Router, Request, Response } from "express";
import {
  computeLiveMetrics,
  metricsTrend,
} from "../../services/metricsService";
import { Window } from "../../domain/types";

export const metricsRouter = Router();

const WINDOWS: Window[] = ["1h", "24h", "7d", "all"];

function parseWindow(raw: unknown): Window {
  return WINDOWS.includes(raw as Window) ? (raw as Window) : "24h";
}

// GET /metrics/summary?window=1h|24h|7d|all
metricsRouter.get("/summary", async (req: Request, res: Response) => {
  try {
    const window = parseWindow(req.query.window);
    const summary = await computeLiveMetrics(window);
    return res.status(200).json(summary);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to compute metrics summary";
    console.error("[metricsRouter] Error fetching metrics summary:", error);
    return res.status(500).json({ error: errMessage });
  }
});

// GET /metrics/trend?window=&bucket=hour|day
metricsRouter.get("/trend", async (req: Request, res: Response) => {
  try {
    const window = parseWindow(req.query.window);
    const bucket = req.query.bucket === "day" ? "day" : "hour";
    const trend = await metricsTrend(window, bucket);
    return res.status(200).json(trend);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to compute metrics trend";
    console.error("[metricsRouter] Error fetching metrics trend:", error);
    return res.status(500).json({ error: errMessage });
  }
});
