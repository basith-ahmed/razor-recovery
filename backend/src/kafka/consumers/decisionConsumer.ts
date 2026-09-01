import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { logError } from "../../config/logger";
import { decide } from "../../services/decisionService";
import {
  DiagnosisResult,
  DecisionResult,
  EnrichedRevenueEvent,
} from "../../domain/types";
import { FilterContext } from "../../domain/stoppingRules";
import { cooldownTtlSeconds } from "../../domain/policy";
import { publish } from "../producer";
import { TOPICS } from "../topics";
import { recordFailureAuditEntry } from "../../services/auditService";
import {
  checkAndSetDedup,
  getEntityCooldown,
  setEntityCooldown,
  isEntityRecovered,
} from "../../utils/redisUtils";
import { countCustomerPriorFailures } from "../../services/customerService";
import { revenueEventExists } from "../../services/revenueEventService";

const CONSUMER_GROUP = "decision-service";
const STAGE = "decision";

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

        const isNew = await checkAndSetDedup(event.id, STAGE);
        if (!isNew) {
          console.log(`[decision] Skipping duplicate event ${event.id}`);
          return;
        }

        const [customer, workflowState, causeState, activePromise] = await Promise.all([
          prisma.customer.findUnique({
            where: { id: event.customerId },
            select: { dncFlag: true, lifetimeValue: true },
          }),
          prisma.entityWorkflowState.findUnique({
            where: { entityId: event.entityId },
          }),
          prisma.entityCauseState.findUnique({
            where: {
              entityId_causeLabel: {
                entityId: event.entityId,
                causeLabel: diagnosis.causeLabel,
              },
            },
          }),
          prisma.promiseToPay.findFirst({
            where: {
              entityId: event.entityId,
              status: { in: ["pending", "reminder_sent"] },
            },
            orderBy: { createdAt: "desc" },
          }),
        ]);

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

        const hasActivePromise =
          activePromise !== null &&
          activePromise.status === "pending" &&
          activePromise.promisedDate > now &&
          diagnosis.causeLabel !== "promise_broken";

        const isRecoveredInRedis = await isEntityRecovered(event.entityId);
        const isRecovered = isRecoveredInRedis || workflowState?.state === "RECOVERED";

        const openTicket = await prisma.ticket.findFirst({
          where: {
            entityId: event.entityId,
            status: { in: ["open", "in_progress"] },
          },
          select: { id: true },
        });
        const isEscalated = workflowState?.state === "ESCALATED" || Boolean(openTicket);

        const redisCooldownUntil = await getEntityCooldown(event.entityId);

        const cooldownUntil = redisCooldownUntil ?? workflowState?.cooldownUntil ?? causeState?.cooldownUntil;
        const isInCooldown = cooldownUntil ? cooldownUntil > now : false;
        const attemptCount = workflowState?.attemptCount ?? causeState?.attemptCount ?? 0;
        const lastContactedAt = workflowState?.lastContactedAt ?? causeState?.lastContactedAt;

        let hoursSinceLastContact: number | undefined;
        if (lastContactedAt) {
          const elapsedMs = now.getTime() - lastContactedAt.getTime();
          if (!Number.isNaN(elapsedMs)) {
            hoursSinceLastContact = Math.max(0, elapsedMs / (1000 * 60 * 60));
          }
        }
        const daysSinceLastContact =
          hoursSinceLastContact !== undefined
            ? Math.floor(hoursSinceLastContact / 24)
            : 0;

        const rawPayload = event.rawPayload as Record<string, unknown>;
        const daysOverdue =
          typeof rawPayload.daysOverdue === "number"
            ? rawPayload.daysOverdue
            : undefined;

        const followUpMarker = rawPayload.followUp as { type?: string } | undefined;
        const isDueScheduledRetry = followUpMarker?.type === "scheduled_retry_due";

        const filterCtx: FilterContext = {
          causeLabel: diagnosis.causeLabel,
          customerId: event.customerId,
          isDnc,
          isDisputed,
          isRecovered,
          isEscalated,
          hasActivePromise,
          attemptCount,
          isInCooldown,
          daysOverdue,
          daysSinceLastContact,
          ...(hoursSinceLastContact !== undefined
            ? { hoursSinceLastContact }
            : {}),
        };

        const priorFailures = await countCustomerPriorFailures(event.customerId, event.id);

        const decision: DecisionResult = await decide(diagnosis, filterCtx, {
          attemptCount,
          customerLtv: customer?.lifetimeValue ?? 0,
          priorFailures,
          daysSinceLastContact,
          dueScheduledRetry: isDueScheduledRetry,
        }, {
          entityType: event.entityType,
          amount: event.amount,
        });

        if (
          decision.chosenAction !== "none" &&
          decision.chosenAction !== "escalate_to_human"
        ) {
          const ttlSec = cooldownTtlSeconds(diagnosis.causeLabel);
          await setEntityCooldown(event.entityId, ttlSec);
        }

        const eventExists = await revenueEventExists(event.id);
        if (!eventExists) {
          console.warn(
            `[decision] Cannot persist Decision for event ${event.id}: RevenueEvent does not exist in DB. Skipping.`,
          );
          return;
        }

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
            await recordFailureAuditEntry(payload.event, {
              inputSnapshot: payload.event,
              diagnosisSnapshot: payload.diagnosis,
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
