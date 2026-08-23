import { Router, Request, Response } from "express";
import { prisma } from "../../config/prisma";

export const batchesRouter = Router();

// GET /batches — list past batches with summaryJson
batchesRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const batches = await prisma.batch.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(batches);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to fetch batches";
    console.error("[batchesRouter] Error fetching batches:", error);
    return res.status(500).json({ error: errMessage });
  }
});

// GET /batches/:id — detail of single batch
batchesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const batchId = String(req.params.id);
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        events: {
          include: {
            customer: true,
            diagnosis: true,
            action: true,
          },
        },
      },
    });

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    return res.status(200).json(batch);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to fetch batch";
    console.error("[batchesRouter] Error fetching batch:", error);
    return res.status(500).json({ error: errMessage });
  }
});
