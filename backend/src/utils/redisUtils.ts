import { redis } from "../config/redis";

const REDIS_PREFIX = "razorrecovery";
const DEFAULT_DEDUP_TTL = 3600; // 1 hour
const DEFAULT_RECOVERED_TTL = 86400 * 30; // 30 days

/**
 * Checks and sets an idempotency dedup lock via Redis SETNX.
 * Returns `true` if this is a new event (proceed), or `false` if duplicate (skip).
 */
export async function checkAndSetDedup(
  keyOrId: string,
  stage: string,
  ttlSeconds: number = DEFAULT_DEDUP_TTL,
): Promise<boolean> {
  const dedupKey = `${REDIS_PREFIX}:dedup:${keyOrId}:${stage}`;
  const isNew = await redis.set(dedupKey, "1", "EX", ttlSeconds, "NX");
  return isNew === "OK" || isNew === 1 || Boolean(isNew);
}

/**
 * Sets an entity cooldown timestamp lock in Redis.
 */
export async function setEntityCooldown(
  entityId: string,
  ttlSeconds: number,
): Promise<Date> {
  const now = Date.now();
  const cooldownEnd = new Date(now + ttlSeconds * 1000);
  const key = `${REDIS_PREFIX}:cooldown:${entityId}`;
  await redis.set(key, cooldownEnd.toISOString(), "EX", ttlSeconds);
  return cooldownEnd;
}

/**
 * Retrieves the active cooldown expiration for an entity from Redis, if set.
 */
export async function getEntityCooldown(entityId: string): Promise<Date | null> {
  const key = `${REDIS_PREFIX}:cooldown:${entityId}`;
  const val = await redis.get(key);
  if (!val) return null;

  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Checks if an entity is currently within an active Redis cooldown.
 */
export async function isEntityInCooldown(entityId: string): Promise<boolean> {
  const cooldown = await getEntityCooldown(entityId);
  return cooldown !== null && cooldown.getTime() > Date.now();
}

/**
 * Marks an entity as successfully recovered in Redis for instant fast-path checks.
 */
export async function markEntityRecovered(
  entityId: string,
  ttlSeconds: number = DEFAULT_RECOVERED_TTL,
): Promise<void> {
  const key = `${REDIS_PREFIX}:recovered:${entityId}`;
  await redis.set(key, "true", "EX", ttlSeconds);
}

/**
 * Checks if an entity is marked as recovered in Redis.
 */
export async function isEntityRecovered(entityId: string): Promise<boolean> {
  const key = `${REDIS_PREFIX}:recovered:${entityId}`;
  const val = await redis.get(key);
  return val === "true";
}
