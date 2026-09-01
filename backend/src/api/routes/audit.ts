import { Router, Request, Response } from "express";
import { verifyChain } from "../../services/auditService";
import { handleRouteError } from "../../utils/apiResponse";

export const auditRouter = Router();

// GET /audit/verify — validate the audit chain for a sequence range.
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
    return handleRouteError(res, error, "Failed to verify audit chain");
  }
});
