/**
 * Executor Consumer — group `executor-service`
 *
 * Subscribes to DECISIONS. For each message:
 * 1. Dedup via Redis SETNX
 * 2. Calls executeAction() from Phase 6 (which already persists the Action row)
 * 3. Publishes { event, diagnosis, decision, action } to ACTIONS
 */

import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { logError } from "../../config/logger";
import { redis } from "../../config/redis";
import { executeAction } from "../../services/executorService";
import {
  ActionResult,
  DecisionResult,
  DiagnosisResult,
  EnrichedRevenueEvent,
} from "../../domain/types";
import { publish } from "../producer";
import { TOPICS } from "../topics";

const CONSUMER_GROUP = "executor-service";
const STAGE = "executor";
const DEDUP_TTL = 3600; // 1 hour

const consumer = kafka.consumer({
  groupId: CONSUMER_GROUP,
  sessionTimeout: 60000,
  heartbeatInterval: 3000,
});

interface DecisionPayload {
  event: EnrichedRevenueEvent;
  diagnosis: DiagnosisResult;
  decision: DecisionResult;
}

export async function startExecutorConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({
    topic: TOPICS.DECISIONS,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      let payload: DecisionPayload | undefined;
      try {
        if (!message.value) return;
        payload = JSON.parse(message.value.toString()) as DecisionPayload;
        const { event, diagnosis, decision } = payload;

        // Idempotency: Redis SETNX dedup
        const dedupKey = `razorrecovery:dedup:${event.id}:${STAGE}`;
        const isNew = await redis.set(dedupKey, "1", "EX", DEDUP_TTL, "NX");
        if (!isNew) {
          console.log(`[executor] Skipping duplicate event ${event.id}`);
          return;
        }

        // executeAction() already persists the Action row
        const action: ActionResult = await executeAction(decision, event);

        // Publish to ACTIONS
        await publish(TOPICS.ACTIONS, event.id, {
          event,
          diagnosis,
          decision,
          action,
        });
        console.log(
          `[executor] Event ${event.id} → ${action.actionType} (${action.result})`,
        );
      } catch (error) {
        logError("executor", error);
        if (payload?.event) {
          try {
            await prisma.auditEntry.create({
              data: {
                eventId: payload.event.id,
                entityId: payload.event.entityId,
                actor: "system",
                inputSnapshot: payload.event as unknown as Prisma.InputJsonValue,
                // The decision was made before execution failed — keep it in
                // the trail so the entity page shows the full context.
                diagnosisSnapshot: payload.diagnosis as unknown as Prisma.InputJsonValue,
                decisionSnapshot: payload.decision as unknown as Prisma.InputJsonValue,
                outcome: "failed",
                timestamp: new Date(),
              },
            });
          } catch (auditErr) {
            console.error("[executor] Failed to write failure audit entry:", auditErr);
          }
        }
      }
    },
  });

  console.log(`Executor consumer (${CONSUMER_GROUP}) started.`);
}

export async function stopExecutorConsumer(): Promise<void> {
  await consumer.disconnect();
}
