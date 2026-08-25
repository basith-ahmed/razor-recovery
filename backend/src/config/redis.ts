import Redis from "ioredis";
import { env } from "./env";

/**
 * Redis key namespace documentation:
 *
 * razorrecovery:dedup:{eventId}          -> SETNX flag, TTL 1h, prevents double-processing
 * razorrecovery:metrics:{window}         -> cached JSON metrics snapshot, short TTL (a few seconds),
 *                                        refreshed on read-through; keeps the live dashboard snappy
 * razorrecovery:riskNorm:recentMaxAmount -> rolling max event amount, updated via MAX(current, amount)
 *                                        per event, TTL 24h (daily reset); risk-score normalization
 *
 * Note: attempt counts, cooldowns, and last-contact timestamps are all scoped
 * per (entityId, causeLabel) and live entirely in Postgres — EntityCauseState.
 * Overall entity lifecycle status lives in EntityWorkflowState.state. Neither
 * is mirrored in Redis.
 */

const redis = new Redis(env.REDIS_URL);

export { redis };
