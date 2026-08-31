import { Response } from "express";
import { DomainError } from "../domain/types";

/**
 * Standard error response handler for Express route controllers.
 * Translates typed DomainErrors into appropriate 404/400 status codes
 * and catches unexpected errors into clean 500 status envelopes.
 */
export function handleRouteError(
  res: Response,
  error: unknown,
  fallbackMessage: string = "Internal server error",
): Response {
  if (error instanceof DomainError) {
    if (error.code.includes("NOT_FOUND")) {
      return res.status(404).json({ error: error.message, code: error.code });
    }
    return res.status(400).json({ error: error.message, code: error.code });
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  console.error(`[API Error] ${fallbackMessage}:`, error);
  return res.status(500).json({ error: message });
}
