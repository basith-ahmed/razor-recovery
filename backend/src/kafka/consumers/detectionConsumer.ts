import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { logError } from "../../config/logger";
import { redis } from "../../config/redis";
import { computeRiskScore } from "../../domain/riskScoring";
import { EnrichedRevenueEvent, RawRevenueEvent } from "../../domain/types";
import { publish } from "../producer";
import { TOPICS } from "../topics";
import { emitIncomingEvent } from "../../api/websocket";
import { recordFailureAuditEntry } from "../../services/auditService";
import { writeLedgerEntry } from "../../services/ledgerService";
import { checkAndSetDedup } from "../../utils/redisUtils";
import { countCustomerPriorFailures, calculateCustomerTenureDays } from "../../services/customerService";

const CONSUMER_GROUP = "detection-service";
const STAGE = "detection";
const RISK_NORM_KEY = "razorrecovery:riskNorm:recentMaxAmount";
const RISK_NORM_TTL = 86400;

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

        const isNew = await checkAndSetDedup(event.id, STAGE);
        if (!isNew) {
          console.log(`[detection] Skipping duplicate event ${event.id}`);
          return;
        }

        const customer = await prisma.customer.findUnique({
          where: { id: event.customerId },
        });
        if (!customer) {
          console.error(`[detection] Customer ${event.customerId} not found for event ${event.id}`);
          return;
        }

        const priorFailures = await countCustomerPriorFailures(event.customerId, event.id);

        const recentMaxRaw = await redis.get(RISK_NORM_KEY);
        const recentMaxAmount = recentMaxRaw
          ? Number(recentMaxRaw)
          : event.amount;

        const payload = event.rawPayload as Record<string, unknown>;
        const daysOverdue =
          typeof payload.daysOverdue === "number"
            ? payload.daysOverdue
            : undefined;
        const hoursSinceAbandon =
          typeof payload.hoursSinceAbandon === "number"
            ? payload.hoursSinceAbandon
            : undefined;

        const tenureDays = calculateCustomerTenureDays(customer.createdAt);

        const { riskScore, urgency } = computeRiskScore(
          event,
          {
            priorFailures,
            lifetimeValue: customer.lifetimeValue,
            tenureDays,
          },
          recentMaxAmount,
          daysOverdue,
          hoursSinceAbandon,
        );

        await redis.set(
          RISK_NORM_KEY,
          String(Math.max(Number(recentMaxRaw ?? 0), event.amount)),
          "EX",
          RISK_NORM_TTL,
        );

        await prisma.$transaction(async (tx) => {
          await tx.revenueEvent.upsert({
            where: { id: event!.id },
            update: {
              riskScore,
              urgency,
            },
            create: {
              id: event!.id,
              entityType: event!.entityType,
              entityId: event!.entityId,
              customerId: event!.customerId,
              eventType: event!.eventType,
              amount: event!.amount,
              currency: event!.currency,
              occurredAt: new Date(event!.occurredAt),
              razorpayPaymentId: event!.razorpayPaymentId ?? null,
              razorpayOrderId: event!.razorpayOrderId ?? null,
              errorCode: event!.errorCode ?? null,
              errorReason: event!.errorReason ?? null,
              rawPayload: event!.rawPayload as Prisma.InputJsonValue,
              riskScore,
              urgency,
            },
          });

          await writeLedgerEntry(tx, {
            entityId: event!.entityId,
            eventId: event!.id,
            type: "AT_RISK",
            amount: event!.amount,
            currency: event!.currency,
          });
        });

        const enrichedEvent: EnrichedRevenueEvent = {
          ...event,
          riskScore,
          urgency,
        };

        await publish(TOPICS.EVENTS_ENRICHED, event.id, enrichedEvent);

        const followUpMarker = payload.followUp as { type?: string } | undefined;
        emitIncomingEvent({
          eventId: event.id,
          entityId: event.entityId,
          customerId: event.customerId,
          customerName: customer.name,
          eventType: event.eventType,
          amount: event.amount,
          currency: event.currency,
          occurredAt: new Date().toISOString(),
          riskScore,
          synthesized: payload.synthesized === true,
          followUpType:
            typeof followUpMarker?.type === "string" ? followUpMarker.type : undefined,
        });

        console.log(
          `[detection] Enriched event ${event.id} → riskScore=${riskScore}, urgency=${urgency}`,
        );
      } catch (error) {
        logError("detection", error);
        if (event) {
          try {
            await recordFailureAuditEntry(event, { inputSnapshot: event });
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
