import Redis from "ioredis";
import { env } from "./env";

/**
 * Redis key namespace documentation:
 *
 * razorrecovery:cooldown:{entityId}      -> string ISO timestamp, TTL matches cooldown window
 * razorrecovery:dedup:{eventId}          -> SETNX flag, TTL 1h, prevents double-processing
 * razorrecovery:lastContact:{entityId}   -> string ISO timestamp (deleted on confirmed recovery)
 * razorrecovery:metrics:{window}         -> cached JSON metrics snapshot, short TTL (a few seconds),
 *                                        refreshed on read-through; keeps the live dashboard snappy
 * razorrecovery:riskNorm:recentMaxAmount -> rolling max event amount, updated via MAX(current, amount)
 *                                        per event, TTL 24h (daily reset); risk-score normalization
 *
 * Note: attemptCount lives in Postgres (EntityWorkflowState) — the single
 * source of truth, incremented per executed contact and reset to 0 on
 * confirmed recovery. It is deliberately NOT mirrored in Redis.
 */

const redis = new Redis(env.REDIS_URL);

export { redis };
