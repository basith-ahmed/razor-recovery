import { kafka } from "../../config/kafka";
import { logError } from "../../config/logger";
import { redis } from "../../config/redis";
import { recordFailureAuditEntry } from "../../services/auditService";
import { indexAuditEntry } from "../../services/embeddingService";
import { TOPICS } from "../topics";

const CONSUMER_GROUP = "embedding-service";
const STAGE = "embedding";
const DEDUP_TTL = 3600;
const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });

interface AuditPayload {
  auditEntryId?: string;
  event?: { id: string; entityId: string };
}

/** Independently indexes terminal AuditEntry records published on the audit stream. */
export async function startEmbeddingConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.AUDIT, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      let payload: AuditPayload | undefined;
      let dedupKey: string | undefined;
      try {
        if (!message.value) return;
        payload = JSON.parse(message.value.toString()) as AuditPayload;
        if (!payload.auditEntryId) {
          throw new Error("Audit message is missing auditEntryId.");
        }
        dedupKey = `razorrecovery:dedup:${payload.auditEntryId}:${STAGE}`;
        const isNew = await redis.set(dedupKey, "1", "EX", DEDUP_TTL, "NX");
        if (!isNew) return;
        await indexAuditEntry(payload.auditEntryId);
      } catch (error) {
        logError("embedding", error);
        if (payload?.event) {
          try {
            await recordFailureAuditEntry(payload.event, { inputSnapshot: payload });
          } catch (auditError) {
            console.error("[embedding] Failed to record embedding failure audit entry:", auditError);
          }
        }
        // Do not acknowledge a failed embedding attempt. Clear the claim and
        // rethrow so Kafka retries the record instead of permanently losing a
        // terminal case after a transient Voyage/DB failure.
        if (dedupKey) {
          try {
            await redis.del(dedupKey);
          } catch (dedupError) {
            console.error("[embedding] Failed to clear retry dedup key:", dedupError);
          }
        }
        throw error;
      }
    },
  });
  console.log(`Embedding consumer (${CONSUMER_GROUP}) started.`);
}

export async function stopEmbeddingConsumer(): Promise<void> {
  await consumer.disconnect();
}
