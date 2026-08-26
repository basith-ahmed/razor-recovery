/**
 * Decision Consumer — group `decision-service`
 *
 * Subscribes to DIAGNOSES. For each message:
 * 1. Dedup via Redis SETNX
 * 2. Builds FilterContext (queries Postgres: EntityCauseState for
 *    per-cause attempt/cooldown/last-contact, Customer DNC flag, dispute flag)
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

        // Build FilterContext from Postgres.
        // Attempt/cooldown/last-contact state is scoped per
        // (entityId, causeLabel) in EntityCauseState — each cause gets its own
        // independent budget per policy.json. Overall lifecycle status lives
        // separately in EntityWorkflowState.state.
        const [customer, causeState] = await Promise.all([
          prisma.customer.findUnique({
            where: { id: event.customerId },
            select: { dncFlag: true, lifetimeValue: true },
          }),
          prisma.entityCauseState.findUnique({
            where: {
              entityId_causeLabel: {
                entityId: event.entityId,
                causeLabel: diagnosis.causeLabel,
              },
            },
          }),
        ]);

        // Check dispute flag on the entity (Invoice-specific)
        let isDisputed = false;
        if (event.entityType === "INVOICE") {
          const invoice = await prisma.invoice.findUnique({
            where: { id: event.entityId },
            select: { disputeFlag: true },
          });
          isDisputed = invoice?.disputeFlag ?? false;
        }

        const now = new Date();
        const isDnc = customer?.dncFlag ?? false;
        const isInCooldown = causeState?.cooldownUntil
          ? causeState.cooldownUntil > now
          : false;
        const attemptCount = causeState?.attemptCount ?? 0;

        // Elapsed time since last real contact for THIS cause, in hours
        // (precise) and whole days (for LLM context readability)
        let hoursSinceLastContact: number | undefined;
        if (causeState?.lastContactedAt) {
          const elapsedMs = now.getTime() - causeState.lastContactedAt.getTime();
          if (!Number.isNaN(elapsedMs)) {
            hoursSinceLastContact = Math.max(0, elapsedMs / (1000 * 60 * 60));
          }
        }
        const daysSinceLastContact =
          hoursSinceLastContact !== undefined
            ? Math.floor(hoursSinceLastContact / 24)
            : 0;

        // Extract daysOverdue from rawPayload if present
        const rawPayload = event.rawPayload as Record<string, unknown>;
        const daysOverdue =
          typeof rawPayload.daysOverdue === "number"
            ? rawPayload.daysOverdue
            : undefined;

        // The scheduler dispatches due deferred retries as synthesized events;
        // when this IS one, the decision stage must honor the commitment and
        // execute the retry now instead of re-asking the LLM.
        const followUpMarker = rawPayload.followUp as { type?: string } | undefined;
        const isDueScheduledRetry = followUpMarker?.type === "scheduled_retry_due";

        const filterCtx: FilterContext = {
          causeLabel: diagnosis.causeLabel,
          customerId: event.customerId,
          isDnc,
          isDisputed,
          attemptCount,
          isInCooldown,
          daysOverdue,
          daysSinceLastContact,
          ...(hoursSinceLastContact !== undefined
            ? { hoursSinceLastContact }
            : {}),
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
          dueScheduledRetry: isDueScheduledRetry,
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
                diagnosisSnapshot: payload.diagnosis as unknown as Prisma.InputJsonValue,
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
