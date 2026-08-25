/**
 * Decision Consumer — group `decision-service`
 *
 * Subscribes to DIAGNOSES. For each message:
 * 1. Dedup via Redis SETNX
 * 2. Builds FilterContext (queries Redis for DNC/cooldown/attempts,
 *    queries Postgres for dispute flag)
 * 3. Calls decide() from Phase 5
 * 4. Persists the Decision row
 * 5. Publishes { event, diagnosis, decision } to DECISIONS
 */

import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { logError } from "../../config/logger";
import { redis } from "../../config/redis";
import { decide } from "../../services/decisionService";
import {
  DiagnosisResult,
  DecisionResult,
  EnrichedRevenueEvent,
} from "../../domain/types";
import { FilterContext } from "../../domain/stoppingRules";
import { publish } from "../producer";
import { TOPICS } from "../topics";

const CONSUMER_GROUP = "decision-service";
const STAGE = "decision";
const DEDUP_TTL = 3600; // 1 hour
const REDIS_PREFIX = "razorrecovery";

const consumer = kafka.consumer({
  groupId: CONSUMER_GROUP,
  sessionTimeout: 60000,
  heartbeatInterval: 3000,
});

interface DiagnosisPayload {
  event: EnrichedRevenueEvent;
  diagnosis: DiagnosisResult;
}

export async function startDecisionConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({
    topic: TOPICS.DIAGNOSES,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      let payload: DiagnosisPayload | undefined;
      try {
        if (!message.value) return;
        payload = JSON.parse(message.value.toString()) as DiagnosisPayload;
        const { event, diagnosis } = payload;

        // Idempotency: Redis SETNX dedup
        const dedupKey = `${REDIS_PREFIX}:dedup:${event.id}:${STAGE}`;
        const isNew = await redis.set(dedupKey, "1", "EX", DEDUP_TTL, "NX");
        if (!isNew) {
          console.log(`[decision] Skipping duplicate event ${event.id}`);
          return;
        }

        // Build FilterContext from Redis + Postgres
        const [isDncMember, cooldownVal, attemptsStr, lastContactVal] =
          await Promise.all([
            redis.sismember(`${REDIS_PREFIX}:dnc:set`, event.customerId),
            redis.get(`${REDIS_PREFIX}:cooldown:${event.entityId}`),
            redis.get(`${REDIS_PREFIX}:attempts:${event.entityId}`),
            redis.get(`${REDIS_PREFIX}:lastContact:${event.entityId}`),
          ]);

        // Also check Postgres DNC flag on Customer
        const customer = await prisma.customer.findUnique({
          where: { id: event.customerId },
          select: { dncFlag: true, lifetimeValue: true },
        });

        // Check dispute flag on the entity (Invoice-specific)
        let isDisputed = false;
        if (event.entityType === "INVOICE") {
          const invoice = await prisma.invoice.findUnique({
            where: { id: event.entityId },
            select: { disputeFlag: true },
          });
          isDisputed = invoice?.disputeFlag ?? false;
        }

        const isDnc = isDncMember === 1 || (customer?.dncFlag ?? false);
        const isInCooldown = cooldownVal !== null;
        const attemptCount = attemptsStr ? parseInt(attemptsStr, 10) : 0;

        // Compute daysSinceLastContact
        let daysSinceLastContact = 0;
        if (lastContactVal) {
          const lastContactDate = new Date(lastContactVal);
          daysSinceLastContact = Math.floor(
            (Date.now() - lastContactDate.getTime()) / (1000 * 60 * 60 * 24),
          );
        }

        // Extract daysOverdue from rawPayload if present
        const rawPayload = event.rawPayload as Record<string, unknown>;
        const daysOverdue =
          typeof rawPayload.daysOverdue === "number"
            ? rawPayload.daysOverdue
            : undefined;

        const filterCtx: FilterContext = {
          causeLabel: diagnosis.causeLabel,
          customerId: event.customerId,
          isDnc,
          isDisputed,
          attemptCount,
          isInCooldown,
          daysOverdue,
          daysSinceLastContact,
        };

        // Count prior failures for entity context
        const priorFailures = await prisma.revenueEvent.count({
          where: {
            customerId: event.customerId,
            id: { not: event.id },
          },
        });

        const decision: DecisionResult = await decide(diagnosis, filterCtx, {
          attemptCount,
          customerLtv: customer?.lifetimeValue ?? 0,
          priorFailures,
          daysSinceLastContact,
        });

        // Persist Decision row.
        // Upsert: Kafka is at-least-once, so replays after a consumer restart
        // or rebalance must not fail on the eventId unique constraint.
        await prisma.decision.upsert({
          where: { eventId: event.id },
          update: {
            legalActions: decision.legalActions,
            chosenAction: decision.chosenAction,
            reasoning: decision.reasoning,
            policyVersion: decision.policyVersion,
          },
          create: {
            eventId: event.id,
            legalActions: decision.legalActions,
            chosenAction: decision.chosenAction,
            reasoning: decision.reasoning,
            policyVersion: decision.policyVersion,
          },
        });

        // Publish to DECISIONS
        await publish(TOPICS.DECISIONS, event.id, {
          event,
          diagnosis,
          decision,
        });
        console.log(
          `[decision] Event ${event.id} → action=${decision.chosenAction}`,
        );
      } catch (error) {
        logError("decision", error);
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
            console.error("[decision] Failed to write failure audit entry:", auditErr);
          }
        }
      }
    },
  });

  console.log(`Decision consumer (${CONSUMER_GROUP}) started.`);
}

export async function stopDecisionConsumer(): Promise<void> {
  await consumer.disconnect();
}
