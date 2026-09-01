import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { env } from "../../config/env";
import { DomainError } from "../../domain/types";
import { ingestPartnerEvent } from "../../services/ingestService";
import { handleRouteError } from "../../utils/apiResponse";

export const ingestRouter = Router();

function unauthorized(res: Response, message: string): Response {
  return res.status(401).json({ error: message, code: "INVALID_API_KEY" });
}

/**
 * Shared API key authentication for partner ingestion.
 * Digest comparison avoids leaking key length through timing.
  */
function requirePartnerKey(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-api-key");
  if (!provided) {
    return unauthorized(res, "Missing x-api-key header.");
  }
  const providedDigest = crypto.createHash("sha256").update(provided).digest();
  const expectedDigest = crypto.createHash("sha256").update(env.PARTNER_API_KEY).digest();
  if (!crypto.timingSafeEqual(providedDigest, expectedDigest)) {
    return unauthorized(res, "Invalid API key.");
  }
  return next();
}

// POST /api/v1/events — the single ingestion point for all partner revenue-leakage events.
// Auth is scoped to this route only: the router is mounted at the /api/v1 prefix,
// and router-level middleware would otherwise intercept unrelated paths too.
ingestRouter.post("/events", requirePartnerKey, async (req: Request, res: Response) => {
  try {
    const result = await ingestPartnerEvent(req.body);
    return res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      if (error.code === "INVALID_ENVELOPE") {
        return res.status(400).json({
          error: error.message,
          code: error.code,
          fields: error.cause,
        });
      }
      if (error.code === "DUPLICATE_EVENT_CONFLICT") {
        return res.status(409).json({ error: error.message, code: error.code });
      }
    }
    return handleRouteError(res, error, "Failed to ingest event");
  }
});
