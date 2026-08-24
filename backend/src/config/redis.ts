import Redis from "ioredis";
import { env } from "./env";

/**
 * Redis key namespace documentation:
 *
 * razorrecovery:cooldown:{entityId}      -> string ISO timestamp, TTL matches cooldown window
 * razorrecovery:attempts:{entityId}      -> integer string, incremented per attempt
 * razorrecovery:dnc:set                  -> Redis SET of customerId
 * razorrecovery:dedup:{eventId}          -> SETNX flag, TTL 1h, prevents double-processing
 * razorrecovery:lastContact:{entityId}   -> string ISO timestamp
 * razorrecovery:metrics:{window}         -> cached JSON metrics snapshot, short TTL (a few seconds),
 *                                        refreshed on read-through; keeps the live dashboard snappy
 * razorrecovery:riskNorm:recentMaxAmount -> rolling max event amount, updated via MAX(current, amount)
 *                                        per event, TTL 24h (daily reset); risk-score normalization
 * razorrecovery:stream:{runId}:progress  -> Hash { sent, total } — DEMO TOOLING ONLY, written by the
 *                                        stream injector for its own progress indicator; the core
 *                                        pipeline never reads this key
 */

const redis = new Redis(env.REDIS_URL);

export { redis };
