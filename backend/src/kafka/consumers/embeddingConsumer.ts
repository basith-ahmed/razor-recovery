import { kafka } from "../../config/kafka";
import { logError } from "../../config/logger";
import { redis } from "../../config/redis";
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

export async function startEmbeddingConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.AUDIT, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      let payload: AuditPayload | undefined;
      try {
        if (!message.value) return;
        payload = JSON.parse(message.value.toString()) as AuditPayload;
        if (!payload.auditEntryId) {
          return;
        }
        const dedupKey = `razorrecovery:dedup:${payload.auditEntryId}:${STAGE}`;
        const isNew = await redis.set(dedupKey, "1", "EX", DEDUP_TTL, "NX");
        if (!isNew) return;
        await indexAuditEntry(payload.auditEntryId);
      } catch (error) {
        logError("embedding", error);
      }
    },
  });
  console.log(`Embedding consumer (${CONSUMER_GROUP}) started.`);
}

export async function stopEmbeddingConsumer(): Promise<void> {
  await consumer.disconnect();
}
