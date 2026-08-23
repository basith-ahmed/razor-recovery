import { Router, Request, Response } from "express";
import { prisma } from "../../config/prisma";

export const batchesRouter = Router();

// GET /batches?page=&limit= — list past batches with summaryJson
batchesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const [total, batches] = await Promise.all([
      prisma.batch.count(),
      prisma.batch.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return res.status(200).json({
      items: batches,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
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
