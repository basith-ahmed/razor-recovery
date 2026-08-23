import { Router, Request, Response } from "express";
import { replayBatch, ReplayBatchConfig } from "../../simulator";

export const demoRouter = Router();

const DEFAULT_MIX = {
  paymentFailed: 0.4,
  checkoutAbandoned: 0.3,
  invoiceOverdue: 0.2,
  subscriptionFailed: 0.1,
};

demoRouter.post("/run-batch", async (req: Request, res: Response) => {
  try {
    const size = typeof req.body?.size === "number" ? req.body.size : 10;
    const mix = req.body?.mix && typeof req.body.mix === "object" ? req.body.mix : DEFAULT_MIX;

    if (!Number.isInteger(size) || size < 1) {
      return res.status(400).json({ error: "Batch size must be a positive integer." });
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
      return res.status(400).json({ error: "Batch mix proportions must be non-negative and sum to 1.0." });
    }

    const config: ReplayBatchConfig = {
      size,
      mix: {
        paymentFailed,
        checkoutAbandoned,
        invoiceOverdue,
        subscriptionFailed,
      },
    };

    // replayBatch generates synthetic raw events and publishes to Kafka asynchronously
    const { batchId } = await replayBatch(config);

    return res.status(200).json({ batchId });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to run demo batch";
    console.error("[demoRouter] Error running batch:", error);
    return res.status(500).json({ error: errMessage });
  }
});
