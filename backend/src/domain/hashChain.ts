import { createHash } from "crypto";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export const GENESIS_HASH = sha256("razorrecovery-genesis");

/**
 * Deterministic JSON stringification: object keys sorted recursively so
 * identical logical content always hashes identically regardless of
 * insertion order. Arrays preserve order (order is semantically meaningful
 * there); only object keys are sorted.
 */
export function canonicalize(obj: unknown): string {
  if (obj === undefined) {
    return "null";
  }
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalize((obj as Record<string, unknown>)[k]),
  );
  return "{" + entries.join(",") + "}";
}

export interface HashableEntry {
  eventId: string;
  entityId: string;
  actor: string;
  inputSnapshot: unknown;
  diagnosisSnapshot?: unknown;
  decisionSnapshot?: unknown;
  actionSnapshot?: unknown;
  outcome: string;
  timestamp: string; 
}

export function computeEntryHash(prevHash: string, entry: HashableEntry): string {
  return sha256(prevHash + canonicalize(entry));
}
