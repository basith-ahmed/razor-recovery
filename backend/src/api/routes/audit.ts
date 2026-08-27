import { Router, Request, Response } from "express";
import { verifyChain } from "../../services/auditService";

export const auditRouter = Router();

// GET /audit/verify?fromSequence=&toSequence=
auditRouter.get("/verify", async (req: Request, res: Response) => {
  try {
    const fromSequence = req.query.fromSequence
      ? parseInt(req.query.fromSequence as string, 10)
      : 1;
    const toSequence = req.query.toSequence
      ? parseInt(req.query.toSequence as string, 10)
      : undefined;

    if (isNaN(fromSequence) || (toSequence !== undefined && isNaN(toSequence))) {
      return res.status(400).json({ error: "Invalid sequence number parameter" });
    }

    const result = await verifyChain(fromSequence, toSequence);
    return res.status(200).json(result);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to verify audit chain";
    console.error("[auditRouter] Error verifying audit chain:", error);
    return res.status(500).json({ error: errMessage });
  }
});
