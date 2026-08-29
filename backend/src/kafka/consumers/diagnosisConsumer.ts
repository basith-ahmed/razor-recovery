/**
 * Diagnosis Consumer — group `diagnosis-service`
 *
 * Subscribes to EVENTS_ENRICHED. For each message:
 * 1. Dedup via Redis SETNX
 * 2. Calls diagnose() from Phase 5
 * 3. Persists the Diagnosis row
 * 4. Publishes { event, diagnosis } to DIAGNOSES
 */

import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { logError } from "../../config/logger";
import { redis } from "../../config/redis";
import { diagnose } from "../../services/diagnosisService";
import { DiagnosisResult, EnrichedRevenueEvent } from "../../domain/types";
import { publish } from "../producer";
import { TOPICS } from "../topics";
import { recordFailureAuditEntry } from "../../services/auditService";

const CONSUMER_GROUP = "diagnosis-service";
const STAGE = "diagnosis";
const DEDUP_TTL = 3600; // 1 hour

const consumer = kafka.consumer({
  groupId: CONSUMER_GROUP,
  sessionTimeout: 60000,
  heartbeatInterval: 3000,
});

export async function startDiagnosisConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({
    topic: TOPICS.EVENTS_ENRICHED,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      let event: EnrichedRevenueEvent | undefined;
      try {
        if (!message.value) return;
        event = JSON.parse(
          message.value.toString(),
        ) as EnrichedRevenueEvent;

        // Idempotency: Redis SETNX dedup
        const dedupKey = `razorrecovery:dedup:${event.id}:${STAGE}`;
        const isNew = await redis.set(dedupKey, "1", "EX", DEDUP_TTL, "NX");
        if (!isNew) {
          console.log(`[diagnosis] Skipping duplicate event ${event.id}`);
          return;
        }

        // Load customer history for the diagnosis LLM call
        const priorFailures = await prisma.revenueEvent.count({
          where: {
            customerId: event.customerId,
            id: { not: event.id },
          },
        });

        const customer = await prisma.customer.findUnique({
          where: { id: event.customerId },
        });

        const tenureDays = customer
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - new Date(customer.createdAt).getTime()) /
                  (1000 * 60 * 60 * 24),
              ),
            )
          : 0;

        const diagnosis: DiagnosisResult = await diagnose(event, {
          priorFailures,
          lifetimeValue: customer?.lifetimeValue ?? 0,
          tenureDays,
        });

        // Persist Diagnosis row.
        // Upsert: Kafka is at-least-once, so replays after a consumer restart
        // or rebalance must not fail on the eventId unique constraint.
        const eventExists = await prisma.revenueEvent.findUnique({
          where: { id: event.id },
          select: { id: true },
        });
        if (!eventExists) {
          console.warn(
            `[diagnosis] Cannot persist Diagnosis for event ${event.id}: RevenueEvent does not exist in DB (orphaned Kafka message). Skipping.`,
          );
          return;
        }

        await prisma.diagnosis.upsert({
          where: { eventId: event.id },
          update: {
            causeLabel: diagnosis.causeLabel,
            confidence: diagnosis.confidence,
            method: diagnosis.method,
            reasoning: diagnosis.reasoning ?? null,
          },
          create: {
            eventId: event.id,
            causeLabel: diagnosis.causeLabel,
            confidence: diagnosis.confidence,
            method: diagnosis.method,
            reasoning: diagnosis.reasoning ?? null,
          },
        });

        // Publish to DIAGNOSES
        await publish(TOPICS.DIAGNOSES, event.id, { event, diagnosis });
        console.log(
          `[diagnosis] Event ${event.id} → cause=${diagnosis.causeLabel}, method=${diagnosis.method}`,
        );
      } catch (error) {
        logError("diagnosis", error);
        if (event) {
          try {
            await recordFailureAuditEntry(event, { inputSnapshot: event });
          } catch (auditErr) {
            console.error("[diagnosis] Failed to write failure audit entry:", auditErr);
          }
        }
      }
    },
  });

  console.log(`Diagnosis consumer (${CONSUMER_GROUP}) started.`);
}

export async function stopDiagnosisConsumer(): Promise<void> {
  await consumer.disconnect();
}
