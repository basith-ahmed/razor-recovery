/**
 * Detection Consumer — group `detection-service`
 *
 * Subscribes to EVENTS_RAW. For each message:
 * 1. Dedup via Redis SETNX
 * 2. Loads customer history from Postgres
 * 3. Calls computeRiskScore
 * 4. Publishes EnrichedRevenueEvent to EVENTS_ENRICHED
 * 5. Writes riskScore/urgency back onto the RevenueEvent row
 */

import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { computeRiskScore } from "../../domain/riskScoring";
import { EnrichedRevenueEvent, RawRevenueEvent } from "../../domain/types";
import { publish } from "../producer";
import { TOPICS } from "../topics";

const CONSUMER_GROUP = "detection-service";
const STAGE = "detection";
const DEDUP_TTL = 3600; // 1 hour

const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });

export async function startDetectionConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.EVENTS_RAW, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      let event: RawRevenueEvent | undefined;
      try {
        if (!message.value) return;
        event = JSON.parse(message.value.toString()) as RawRevenueEvent;

        // Idempotency: Redis SETNX dedup
        const dedupKey = `razorrecovery:dedup:${event.id}:${STAGE}`;
        const isNew = await redis.set(dedupKey, "1", "EX", DEDUP_TTL, "NX");
        if (!isNew) {
          console.log(`[detection] Skipping duplicate event ${event.id}`);
          return;
        }

        // Load customer history from Postgres
        const customer = await prisma.customer.findUnique({
          where: { id: event.customerId },
        });
        if (!customer) {
          console.error(`[detection] Customer ${event.customerId} not found for event ${event.id}`);
          return;
        }

        // Count prior failures for this customer
        const priorFailures = await prisma.revenueEvent.count({
          where: {
            customerId: event.customerId,
            id: { not: event.id },
          },
        });

        // Compute the batch max amount for normalisation
        const batchAgg = await prisma.revenueEvent.aggregate({
          where: { batchId: event.batchId },
          _max: { amount: true },
        });
        const batchMaxAmount = batchAgg._max.amount ?? event.amount;

        // Extract urgency-related data from rawPayload
        const payload = event.rawPayload as Record<string, unknown>;
        const daysOverdue =
          typeof payload.daysOverdue === "number"
            ? payload.daysOverdue
            : undefined;
        const hoursSinceAbandon =
          typeof payload.hoursSinceAbandon === "number"
            ? payload.hoursSinceAbandon
            : undefined;

        const tenureDays = Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(customer.createdAt).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        );

        const { riskScore, urgency } = computeRiskScore(
          event,
          {
            priorFailures,
            lifetimeValue: customer.lifetimeValue,
            tenureDays,
          },
          batchMaxAmount,
          daysOverdue,
          hoursSinceAbandon,
        );

        // Write riskScore + urgency back onto the RevenueEvent row
        await prisma.revenueEvent.update({
          where: { id: event.id },
          data: { riskScore, urgency },
        });

        // Build enriched event and publish
        const enrichedEvent: EnrichedRevenueEvent = {
          ...event,
          riskScore,
          urgency,
        };

        await publish(TOPICS.EVENTS_ENRICHED, event.id, enrichedEvent);
        console.log(
          `[detection] Enriched event ${event.id} → riskScore=${riskScore}, urgency=${urgency}`,
        );
      } catch (error) {
        console.error(
          `[detection] Failed to process event ${event?.id ?? "unknown"}:`,
          error,
        );
        // Write a failed audit entry so the failure is visible
        if (event) {
          try {
            await prisma.auditEntry.create({
              data: {
                eventId: event.id,
                entityId: event.entityId,
                actor: "system",
                inputSnapshot: event as unknown as Prisma.InputJsonValue,
                outcome: "failed",
                timestamp: new Date(),
              },
            });
          } catch (auditErr) {
            console.error("[detection] Failed to write failure audit entry:", auditErr);
          }
        }
      }
    },
  });

  console.log(`Detection consumer (${CONSUMER_GROUP}) started.`);
}

export async function stopDetectionConsumer(): Promise<void> {
  await consumer.disconnect();
}
