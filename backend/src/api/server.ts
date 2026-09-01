import http from "http";
import express from "express";
import cors from "cors";
import { env } from "../config/env";
import { initWebSocket } from "./websocket";
import { entitiesRouter } from "./routes/entities";
import { metricsRouter } from "./routes/metrics";
import { policyRouter } from "./routes/policy";
import { auditRouter } from "./routes/audit";
import { queryRouter } from "./routes/query";
import { ticketsRouter } from "./routes/tickets";
import { promisesRouter } from "./routes/promises";
import { razorpayWebhookRouter } from "./webhooks/razorpayWebhook";

export const app = express();

// Allow the frontend to call the API.
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);

// Parse JSON and keep the raw payload for Razorpay signature validation.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Health check for uptime and deployment monitoring.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "razorrecovery-backend" });
});

// Register API modules.
app.use("/entities", entitiesRouter);
app.use("/metrics", metricsRouter);
app.use("/policy", policyRouter);
app.use("/audit", auditRouter);
app.use("/query", queryRouter);
app.use("/tickets", ticketsRouter);
app.use("/promises", promisesRouter);
app.use("/api/promises", promisesRouter);
app.use("/webhooks/razorpay", razorpayWebhookRouter);

// Start the HTTP server and live dashboard stream.
export const server = http.createServer(app);
export const io = initWebSocket(server);
