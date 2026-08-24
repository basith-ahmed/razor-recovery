import { Router, Request, Response } from "express";
import {
  startStreamInjection,
  StreamInjectionConfig,
} from "../../simulator/streamInjector";

export const demoRouter = Router();

const DEFAULT_MIX = {
  paymentFailed: 0.4,
  checkoutAbandoned: 0.3,
  invoiceOverdue: 0.2,
  subscriptionFailed: 0.1,
};

// POST /demo/inject-stream
//
// DEMO/DEV TOOLING, not a core product endpoint: it stands in for the real
// upstream systems (payment gateway, checkout service, invoicing) that would
// publish events to revenue.events.raw in production. A real deployment has
// no equivalent route.
demoRouter.post("/inject-stream", async (req: Request, res: Response) => {
  try {
    const count = typeof req.body?.count === "number" ? req.body.count : 10;
    const mix = req.body?.mix && typeof req.body.mix === "object" ? req.body.mix : DEFAULT_MIX;
    const intervalMs =
      typeof req.body?.intervalMs === "number" ? req.body.intervalMs : undefined;

    if (!Number.isInteger(count) || count < 1) {
      return res.status(400).json({ error: "Count must be a positive integer." });
    }

    const {
      paymentFailed = 0,
      checkoutAbandoned = 0,
      invoiceOverdue = 0,
      subscriptionFailed = 0,
    } = mix;

    const total = paymentFailed + checkoutAbandoned + invoiceOverdue + subscriptionFailed;
    if (
      paymentFailed < 0 ||
      checkoutAbandoned < 0 ||
      invoiceOverdue < 0 ||
      subscriptionFailed < 0 ||
      Math.abs(total - 1.0) > 0.01
    ) {
      return res.status(400).json({ error: "Mix proportions must be non-negative and sum to 1.0." });
    }

    if (intervalMs !== undefined && (!Number.isFinite(intervalMs) || intervalMs < 0)) {
      return res.status(400).json({ error: "intervalMs must be a non-negative number." });
    }

    const config: StreamInjectionConfig = {
      count,
      mix: {
        paymentFailed,
        checkoutAbandoned,
        invoiceOverdue,
        subscriptionFailed,
      },
      ...(intervalMs !== undefined ? { intervalMs } : {}),
    };

    // Injection continues asynchronously at the configured pace; the frontend
    // follows progress via the demo-only stream:progress WebSocket event.
    const { runId } = await startStreamInjection(config);

    return res.status(200).json({ runId });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to start stream injection";
    console.error("[demoRouter] Error starting stream injection:", error);
    return res.status(500).json({ error: errMessage });
  }
});
