import { randomUUID } from "crypto";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { logError } from "../config/logger";
import { getRuleForCause } from "../domain/policy";
import { isTerminal, WorkflowState } from "../domain/stateMachine";
import { RawRevenueEvent } from "../domain/types";
import { publish } from "../kafka/producer";
import { TOPICS } from "../kafka/topics";
import * as emailIntegration from "../integrations/emailIntegration";
import { buildPromiseReminderEmail } from "../domain/emailTemplates";
import { emitLiveUpdate } from "../api/websocket";

const SCAN_INTERVAL_MS = 30_000;
const FOLLOWUP_DEDUP_PREFIX = "razorrecovery:followup";
const COOLDOWN_DEDUP_TTL = 86_400;
const NO_RESPONSE_DEDUP_TTL = 604_800;

export type FollowUpType = "cooldown_expired" | "no_response_timeout";

export interface DueFollowUp {
  entityId: string;
  causeLabel: string;
  type: FollowUpType;
}

export function selectDueFollowUps(
  openArcs: Array<{
    entityId: string;
    state: string;
    attemptCount?: number;
    lastContactedAt?: Date | null;
    cooldownUntil?: Date | null;
  }>,
  causeStates: Array<{
    entityId: string;
    causeLabel: string;
    attemptCount: number;
    lastContactedAt: Date | null;
    cooldownUntil: Date | null;
  }>,
  now: Date,
): DueFollowUp[] {
  const openArcMap = new Map(
    openArcs
      .filter((a) => !isTerminal(a.state as WorkflowState))
      .map((a) => [a.entityId, a]),
  );
  const escalated = new Set(
    openArcs.filter((a) => a.state === "ESCALATED").map((a) => a.entityId),
  );

  const causeStatesByEntity = new Map<string, typeof causeStates>();
  for (const cs of causeStates) {
    const list = causeStatesByEntity.get(cs.entityId) ?? [];
    list.push(cs);
    causeStatesByEntity.set(cs.entityId, list);
  }

  const due: DueFollowUp[] = [];

  for (const [entityId, arc] of openArcMap.entries()) {
    if (escalated.has(entityId)) continue;
    const rows = causeStatesByEntity.get(entityId) ?? [];

    for (const cs of rows) {
      const rule = getRuleForCause(cs.causeLabel);
      if (!rule) continue;
      const stopping = rule.stopping;

      const effectiveAttempts = arc.attemptCount ?? cs.attemptCount;
      const effectiveCooldown = arc.cooldownUntil ?? cs.cooldownUntil;
      const effectiveLastContact = arc.lastContactedAt ?? cs.lastContactedAt;

      if (
        typeof stopping.maxAttempts === "number" &&
        effectiveAttempts < stopping.maxAttempts &&
        effectiveCooldown !== null &&
        effectiveCooldown !== undefined &&
        effectiveCooldown <= now
      ) {
        due.push({ entityId, causeLabel: cs.causeLabel, type: "cooldown_expired" });
        continue;
      }

      if (
        stopping.noResponseWithinHours !== undefined &&
        effectiveLastContact !== null &&
        effectiveLastContact !== undefined &&
        now.getTime() - effectiveLastContact.getTime() >=
          stopping.noResponseWithinHours * 3_600_000
      ) {
        due.push({ entityId, causeLabel: cs.causeLabel, type: "no_response_timeout" });
      }
    }
  }

  return due;
}

function dedupKey(followUp: DueFollowUp): string {
  return `${FOLLOWUP_DEDUP_PREFIX}:${followUp.entityId}:${followUp.causeLabel}:${followUp.type}`;
}

export function suppressPendingScheduledRetries(
  due: DueFollowUp[],
  pendingScheduled: Array<{ entityId: string; causeLabel: string | null }>,
): DueFollowUp[] {
  const pending = new Set(
    pendingScheduled
      .filter((p) => p.causeLabel !== null)
      .map((p) => `${p.entityId}|${p.causeLabel}`),
  );
  return due.filter(
    (f) =>
      !(f.type === "cooldown_expired" && pending.has(`${f.entityId}|${f.causeLabel}`)),
  );
}

async function buildSyntheticEvent(
  entityId: string,
  followUpMarker: Record<string, unknown>,
): Promise<RawRevenueEvent | null> {
  const latest = await prisma.revenueEvent.findFirst({
    where: { entityId },
    orderBy: { occurredAt: "desc" },
  });
  if (!latest) return null;

  return {
    id: randomUUID(),
    entityType: latest.entityType,
    entityId: latest.entityId,
    customerId: latest.customerId,
    eventType: latest.eventType,
    amount: latest.amount,
    currency: latest.currency,
    occurredAt: new Date().toISOString(),
    razorpayPaymentId: latest.razorpayPaymentId ?? undefined,
    razorpayOrderId: latest.razorpayOrderId ?? undefined,
    errorCode: latest.errorCode ?? undefined,
    errorReason: latest.errorReason ?? undefined,
    rawPayload: {
      ...(latest.rawPayload as Record<string, unknown>),
      synthesized: true,
      followUp: followUpMarker,
    },
  };
}

async function scanAndPublish(): Promise<void> {
  const now = new Date();

  const arcs = await prisma.entityWorkflowState.findMany({
    select: {
      entityId: true,
      state: true,
      attemptCount: true,
      cooldownUntil: true,
      lastContactedAt: true,
    },
  });
  const openArcs = arcs.filter((a) => !isTerminal(a.state as WorkflowState));
  if (openArcs.length === 0) return;

  const entityIds = openArcs.map((a) => a.entityId);
  const causeStates = await prisma.entityCauseState.findMany({
    where: { entityId: { in: entityIds } },
  });

  const due = selectDueFollowUps(
    openArcs.map((a) => ({ entityId: a.entityId, state: a.state })),
    causeStates,
    now,
  );

  const pendingScheduled = await prisma.action.findMany({
    where: { result: "scheduled", actionType: "retry_payment_delayed" },
    select: {
      event: { select: { entityId: true, diagnosis: { select: { causeLabel: true } } } },
    },
  });
  const filtered = suppressPendingScheduledRetries(
    due,
    pendingScheduled.map((a) => ({
      entityId: a.event.entityId,
      causeLabel: a.event.diagnosis?.causeLabel ?? null,
    })),
  );
  if (filtered.length === 0) return;

  for (const followUp of filtered) {
    const isNew = await redis.set(
      dedupKey(followUp),
      "1",
      "EX",
      followUp.type === "cooldown_expired" ? COOLDOWN_DEDUP_TTL : NO_RESPONSE_DEDUP_TTL,
      "NX",
    );
    if (!isNew) continue;

    const event = await buildSyntheticEvent(followUp.entityId, {
      type: followUp.type,
      causeLabel: followUp.causeLabel,
    });
    if (!event) {
      console.warn(
        `[scheduler] No prior event found for entity ${followUp.entityId}; skipping follow-up.`,
      );
      continue;
    }

    await publish(TOPICS.EVENTS_RAW, event.id, event);
    console.log(
      `[scheduler] Published ${followUp.type} follow-up for entity ${followUp.entityId} (cause=${followUp.causeLabel}) → event ${event.id}`,
    );
  }
}

let scanTimer: NodeJS.Timeout | null = null;

export type ScheduledRetryDecision =
  | { actionId: string; verdict: "dispatch" }
  | { actionId: string; verdict: "cancel"; reason: "arc_closed" | "escalated" };

export function decideScheduledRetries(
  actions: Array<{ id: string; entityId: string; cooldownUntil: Date | null }>,
  arcStateByEntity: Record<string, string>,
  now: Date,
): ScheduledRetryDecision[] {
  const decisions: ScheduledRetryDecision[] = [];
  for (const action of actions) {
    const state = arcStateByEntity[action.entityId];
    if (!state || isTerminal(state as WorkflowState)) {
      decisions.push({ actionId: action.id, verdict: "cancel", reason: "arc_closed" });
      continue;
    }
    if (state === "ESCALATED") {
      decisions.push({ actionId: action.id, verdict: "cancel", reason: "escalated" });
      continue;
    }
    if (action.cooldownUntil !== null && action.cooldownUntil <= now) {
      decisions.push({ actionId: action.id, verdict: "dispatch" });
    }
  }
  return decisions;
}

async function dispatchDueScheduledRetries(now: Date): Promise<void> {
  const scheduled = await prisma.action.findMany({
    where: { result: "scheduled", actionType: "retry_payment_delayed" },
    include: {
      event: {
        select: {
          entityId: true,
          diagnosis: { select: { causeLabel: true } },
        },
      },
    },
  });
  if (scheduled.length === 0) return;

  const entityIds = [...new Set(scheduled.map((a) => a.event.entityId))];
  const arcs = await prisma.entityWorkflowState.findMany({
    where: { entityId: { in: entityIds } },
    select: { entityId: true, state: true },
  });
  const arcStateByEntity: Record<string, string> = {};
  for (const arc of arcs) arcStateByEntity[arc.entityId] = arc.state;

  const causeStates = await prisma.entityCauseState.findMany({
    where: { entityId: { in: entityIds } },
  });
  const cooldownByKey = new Map(
    causeStates.map((cs) => [`${cs.entityId}|${cs.causeLabel}`, cs.cooldownUntil]),
  );

  const decisions = decideScheduledRetries(
    scheduled.map((a) => ({
      id: a.id,
      entityId: a.event.entityId,
      cooldownUntil:
        cooldownByKey.get(`${a.event.entityId}|${a.event.diagnosis?.causeLabel}`) ?? null,
    })),
    arcStateByEntity,
    now,
  );

  for (const decision of decisions) {
    const actionRow = scheduled.find((a) => a.id === decision.actionId);
    if (!actionRow) continue;
    const entityId = actionRow.event.entityId;
    const causeLabel = actionRow.event.diagnosis?.causeLabel;

    if (decision.verdict === "cancel") {
      await prisma.action.update({
        where: { id: decision.actionId },
        data: { result: "cancelled" },
      });
      console.log(
        `[scheduler] Scheduled retry ${decision.actionId} cancelled (${decision.reason}).`,
      );
      continue;
    }

    const isNew = await redis.set(
      `razorrecovery:scheduledretry:${decision.actionId}`,
      "1",
      "EX",
      COOLDOWN_DEDUP_TTL,
      "NX",
    );
    if (!isNew) continue;

    await prisma.action.update({
      where: { id: decision.actionId },
      data: { result: "dispatched" },
    });

    const event = await buildSyntheticEvent(entityId, {
      type: "scheduled_retry_due",
      actionId: decision.actionId,
      causeLabel,
    });
    if (!event) {
      console.warn(
        `[scheduler] No prior event found for entity ${entityId}; cannot dispatch scheduled retry.`,
      );
      continue;
    }

    await publish(TOPICS.EVENTS_RAW, event.id, event);
    console.log(
      `[scheduler] Dispatched due scheduled retry ${decision.actionId} for entity ${entityId} → event ${event.id}`,
    );
  }
}

export async function scanAndProcessPromises(now: Date): Promise<void> {
  const overduePromises = await prisma.promiseToPay.findMany({
    where: {
      status: "pending",
      promisedDate: { lte: now },
    },
    include: {
      customer: true,
    },
  });

  for (const promise of overduePromises) {
    const isNew = await redis.set(
      `razorrecovery:promise:reminder:${promise.id}`,
      "1",
      "EX",
      86400 * 7,
      "NX",
    );
    if (!isNew) continue;

    const gracePeriodUntil = new Date(now.getTime() + 24 * 3600 * 1000);
    await prisma.promiseToPay.update({
      where: { id: promise.id },
      data: {
        status: "reminder_sent",
        reminderSentAt: now,
        gracePeriodUntil,
      },
    });

    const { subject, html } = buildPromiseReminderEmail({
      customerName: promise.customer.name,
      amount: promise.promisedAmount,
      promisedDate: promise.promisedDate,
      paymentUrl: promise.paymentLinkUrl ?? undefined,
    });

    try {
      await emailIntegration.sendRecoveryEmail({
        to: promise.customer.email,
        subject,
        html,
      });
      console.log(`[scheduler] Sent promise reminder email to ${promise.customer.email} for promise ${promise.id}`);
    } catch (err) {
      console.error(`[scheduler] Failed to send promise reminder email for ${promise.id}:`, err);
    }

    try {
      await emitLiveUpdate(promise.eventId || promise.entityId);
    } catch (err) {
      // ignore
    }
  }

  const brokenPromises = await prisma.promiseToPay.findMany({
    where: {
      status: "reminder_sent",
      gracePeriodUntil: { lte: now },
    },
    include: {
      customer: true,
    },
  });

  for (const promise of brokenPromises) {
    const isNew = await redis.set(
      `razorrecovery:promise:broken:${promise.id}`,
      "1",
      "EX",
      86400 * 7,
      "NX",
    );
    if (!isNew) continue;

    await prisma.promiseToPay.update({
      where: { id: promise.id },
      data: {
        status: "broken",
      },
    });

    let event = await buildSyntheticEvent(promise.entityId, {
      type: "promise_broken",
      promiseId: promise.id,
      causeLabel: "promise_broken",
    });

    if (!event) {
      event = {
        id: randomUUID(),
        entityType: "INVOICE",
        entityId: promise.entityId,
        customerId: promise.customerId,
        eventType: "INVOICE_OVERDUE",
        amount: promise.promisedAmount,
        currency: promise.currency,
        occurredAt: now.toISOString(),
        errorCode: "PROMISE_BROKEN",
        errorReason: "promise_broken",
        rawPayload: {
          synthesized: true,
          followUp: { type: "promise_broken", promiseId: promise.id },
          promiseId: promise.id,
          daysOverdue: 7,
        },
      };
    } else {
      event.errorReason = "promise_broken";
      event.errorCode = "PROMISE_BROKEN";
      event.rawPayload = {
        ...(event.rawPayload as Record<string, unknown>),
        synthesized: true,
        followUp: { type: "promise_broken", promiseId: promise.id },
      };
    }

    await publish(TOPICS.EVENTS_RAW, event.id, event);
    console.log(
      `[scheduler] Promise ${promise.id} broken for entity ${promise.entityId} → synthesized promise_broken event ${event.id}`,
    );

    try {
      await emitLiveUpdate(event.id);
    } catch (err) {
      // ignore
    }
  }
}

export async function startFollowUpScheduler(): Promise<void> {
  if (scanTimer) return;
  scanTimer = setInterval(() => {
    const now = new Date();
    scanAndPublish()
      .then(() => dispatchDueScheduledRetries(now))
      .then(() => scanAndProcessPromises(now))
      .catch((err) => logError("scheduler", err));
  }, SCAN_INTERVAL_MS);
  scanTimer.unref();
  console.log(
    `Follow-up scheduler started (scanning every ${SCAN_INTERVAL_MS / 1000}s).`,
  );
}

export async function stopFollowUpScheduler(): Promise<void> {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
    console.log("Follow-up scheduler stopped.");
  }
}
