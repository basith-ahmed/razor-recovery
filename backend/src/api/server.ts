import http from "http";
import express from "express";
import cors from "cors";
import { env } from "../config/env";
import { initWebSocket } from "./websocket";
import { demoRouter } from "./routes/demo";
import { entitiesRouter } from "./routes/entities";
import { metricsRouter } from "./routes/metrics";
import { policyRouter } from "./routes/policy";
import { razorpayWebhookRouter } from "./webhooks/razorpayWebhook";

export const app = express();

// Configure CORS
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);

// JSON body parser with rawBody buffer retention for webhook signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Healthcheck endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "razorrecovery-backend" });
});

// Mount route modules
app.use("/demo", demoRouter);
app.use("/entities", entitiesRouter);
app.use("/metrics", metricsRouter);
app.use("/policy", policyRouter);
app.use("/webhooks/razorpay", razorpayWebhookRouter);

// HTTP Server wrapping Express and Socket.io
export const server = http.createServer(app);
export const io = initWebSocket(server);
