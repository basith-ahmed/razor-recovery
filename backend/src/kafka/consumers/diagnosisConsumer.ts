import { Prisma } from "@prisma/client";
import { kafka } from "../../config/kafka";
import { prisma } from "../../config/prisma";
import { logError } from "../../config/logger";
import { diagnose } from "../../services/diagnosisService";
import { DiagnosisResult, EnrichedRevenueEvent } from "../../domain/types";
import { publish } from "../producer";
import { TOPICS } from "../topics";
import { recordFailureAuditEntry } from "../../services/auditService";
import { checkAndSetDedup } from "../../utils/redisUtils";
import { countCustomerPriorFailures, calculateCustomerTenureDays } from "../../services/customerService";
import { revenueEventExists } from "../../services/revenueEventService";

const CONSUMER_GROUP = "diagnosis-service";
const STAGE = "diagnosis";

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

        const isNew = await checkAndSetDedup(event.id, STAGE);
        if (!isNew) {
          console.log(`[diagnosis] Skipping duplicate event ${event.id}`);
          return;
        }

        const priorFailures = await countCustomerPriorFailures(event.customerId, event.id);

        const customer = await prisma.customer.findUnique({
          where: { id: event.customerId },
        });

        const tenureDays = calculateCustomerTenureDays(customer?.createdAt);

        const diagnosis: DiagnosisResult = await diagnose(event, {
          priorFailures,
          lifetimeValue: customer?.lifetimeValue ?? 0,
          tenureDays,
        });

        const eventExists = await revenueEventExists(event.id);
        if (!eventExists) {
          console.warn(
            `[diagnosis] Cannot persist Diagnosis for event ${event.id}: RevenueEvent does not exist in DB. Skipping.`,
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
