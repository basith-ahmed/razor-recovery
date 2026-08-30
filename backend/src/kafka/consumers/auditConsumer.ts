import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { logError } from "../../config/logger";
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
import { checkAndSetDedup } from "../../utils/redisUtils";
import { revenueEventExists } from "../../services/revenueEventService";

const CONSUMER_GROUP = "audit-service";
const STAGE = "audit";

const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });

interface ActionPayload {
  event: EnrichedRevenueEvent;
  diagnosis: DiagnosisResult;
  decision: DecisionResult;
  action: ActionResult;
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

        const isNew = await checkAndSetDedup(payload.dedupToken ?? event.id, STAGE);
        if (!isNew) {
          console.log(`[audit] Skipping duplicate event ${event.id}`);
          return;
        }

        const eventExists = await revenueEventExists(event.id);
        if (!eventExists) {
          console.warn(
            `[audit] Cannot record AuditEntry for event ${event.id}: RevenueEvent does not exist in DB. Skipping.`,
          );
          return;
        }

        const auditEntry = await recordAuditEntry({ event, diagnosis, decision, action });

        await emitLiveUpdate(event.id);

        await publish(TOPICS.AUDIT, event.id, { ...payload, auditEntryId: auditEntry.id });
        console.log(
          `[audit] Event ${event.id} → audit entry recorded, published to AUDIT`,
        );
      } catch (error) {
        logError("audit", error);
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
