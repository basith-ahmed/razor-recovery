import { Router, Request, Response } from "express";
import { queryAuditTrail } from "../../services/queryService";

export const queryRouter = Router();

// POST /query — natural-language audit query with citation grounding
queryRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { question, entityId } = req.body;

    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "Field 'question' is required and must be a non-empty string." });
    }

    if (entityId !== undefined && (typeof entityId !== "string" || !entityId.trim())) {
      return res.status(400).json({ error: "Field 'entityId', if provided, must be a non-empty string." });
    }

    const result = await queryAuditTrail({
      question: question.trim(),
      entityId: entityId?.trim(),
    });

    return res.status(200).json(result);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to process audit query";
    console.error("[queryRouter] Error executing audit query:", error);
    return res.status(500).json({ error: errMessage });
  }
});
