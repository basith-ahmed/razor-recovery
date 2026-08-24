/**
 * Audit Consumer — group `audit-service`
 *
 * Subscribes to ACTIONS. For each message:
 * 1. Dedup via Redis SETNX
 * 2. Calls recordAuditEntry() from Phase 6
 * 3. Publishes the same payload to AUDIT topic
 *    (for metrics consumer and WebSocket live-feed relay to
 *     pick up independently — audit and metrics are independent
 *     consumers off the same stream, not chained through each other)
 */

import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { recordAuditEntry } from "../../services/auditService";
import {
  ActionResult,
  DecisionResult,
  DiagnosisResult,
  EnrichedRevenueEvent,
} from "../../domain/types";
import { publish } from "../producer";
import { TOPICS } from "../topics";
import { emitLiveUpdate } from "../../api/websocket";

const CONSUMER_GROUP = "audit-service";
const STAGE = "audit";
const DEDUP_TTL = 3600; // 1 hour

const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });

interface ActionPayload {
  event: EnrichedRevenueEvent;
  diagnosis: DiagnosisResult;
  decision: DecisionResult;
  action: ActionResult;
}

export async function startAuditConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({
    topic: TOPICS.ACTIONS,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      let payload: ActionPayload | undefined;
      try {
        if (!message.value) return;
        payload = JSON.parse(message.value.toString()) as ActionPayload;
        const { event, diagnosis, decision, action } = payload;

        // Idempotency: Redis SETNX dedup
        const dedupKey = `razorrecovery:dedup:${event.id}:${STAGE}`;
        const isNew = await redis.set(dedupKey, "1", "EX", DEDUP_TTL, "NX");
        if (!isNew) {
          console.log(`[audit] Skipping duplicate event ${event.id}`);
          return;
        }

        // Record the audit entry (also transitions workflow state + Redis counters)
        await recordAuditEntry({ event, diagnosis, decision, action });

        // Trigger live WebSocket updates for progress, activity feed, and metrics counters
        await emitLiveUpdate(event.batchId, event.id);

        // Publish to AUDIT topic for metrics + WebSocket consumers
        await publish(TOPICS.AUDIT, event.id, payload);
        console.log(
          `[audit] Event ${event.id} → audit entry recorded, published to AUDIT`,
        );
      } catch (error) {
        console.error(
          `[audit] Failed to process event ${payload?.event?.id ?? "unknown"}:`,
          error,
        );
        // Attempt to write a failure audit entry as a last resort
        if (payload?.event) {
          try {
            await prisma.auditEntry.create({
              data: {
                eventId: payload.event.id,
                entityId: payload.event.entityId,
                actor: "system",
                inputSnapshot: payload.event as unknown as Prisma.InputJsonValue,
                outcome: "failed",
                timestamp: new Date(),
              },
            });
          } catch (auditErr) {
            console.error("[audit] Failed to write failure audit entry:", auditErr);
          }
        }
      }
    },
  });

  console.log(`Audit consumer (${CONSUMER_GROUP}) started.`);
}

export async function stopAuditConsumer(): Promise<void> {
  await consumer.disconnect();
}
