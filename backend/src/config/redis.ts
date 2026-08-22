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
 * razorrecovery:batch:{batchId}:progress -> Hash { processed, total }
 */

const redis = new Redis(env.REDIS_URL);

export { redis };
