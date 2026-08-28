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
import { logError } from "../../config/logger";
import { redis } from "../../config/redis";
import { recordAuditEntry, recordFailureAuditEntry } from "../../services/auditService";
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
  /**
   * Optional dedup override. Publishers that legitimately send multiple
   * distinct messages for the same eventId (e.g. the scheduler executing a
   * deferred retry after the original action was already audited) must set
   * this, otherwise the eventId-based SETNX would swallow their message.
   */
  dedupToken?: string;
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

        // Idempotency: Redis SETNX dedup (dedupToken overrides eventId so
        // distinct messages for the same event are not conflated)
        const dedupKey = `razorrecovery:dedup:${payload.dedupToken ?? event.id}:${STAGE}`;
        const isNew = await redis.set(dedupKey, "1", "EX", DEDUP_TTL, "NX");
        if (!isNew) {
          console.log(`[audit] Skipping duplicate event ${event.id}`);
          return;
        }

        // Record the audit entry (also transitions workflow state and updates
        // per-cause attempt/cooldown state in EntityCauseState)
        const auditEntry = await recordAuditEntry({ event, diagnosis, decision, action });

        // Trigger live WebSocket updates for the activity feed and metrics counters
        await emitLiveUpdate(event.id);

        // Publish to AUDIT topic for metrics + WebSocket consumers
        await publish(TOPICS.AUDIT, event.id, { ...payload, auditEntryId: auditEntry.id });
        console.log(
          `[audit] Event ${event.id} → audit entry recorded, published to AUDIT`,
        );
      } catch (error) {
        logError("audit", error);
        // Attempt to write a failure audit entry as a last resort
        if (payload?.event) {
          try {
            await recordFailureAuditEntry(payload.event, {
              inputSnapshot: payload.event,
              diagnosisSnapshot: payload.diagnosis,
              decisionSnapshot: payload.decision,
              actionSnapshot: payload.action,
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
