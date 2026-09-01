import { Router, Request, Response } from "express";
import { queryAuditTrail } from "../../services/queryService";
import { handleRouteError } from "../../utils/apiResponse";

export const queryRouter = Router();

// POST /query — answer a natural-language audit question using grounded evidence.
queryRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { question, entityId, scope } = req.body;

    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "Field 'question' is required and must be a non-empty string." });
    }

    if (entityId !== undefined && (typeof entityId !== "string" || !entityId.trim())) {
      return res.status(400).json({ error: "Field 'entityId', if provided, must be a non-empty string." });
    }

    const result = await queryAuditTrail({
      question: question.trim(),
      entityId: entityId?.trim(),
      scope: typeof scope === "string" ? scope.trim() : undefined,
    });

    return res.status(200).json(result);
  } catch (error: unknown) {
    return handleRouteError(res, error, "Failed to process audit query");
  }
});
