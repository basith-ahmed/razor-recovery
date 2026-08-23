/**
 * Audit Service — records the full audit trail for a processed event,
 * updates entity workflow state via the state machine, and maintains
 * Redis counters (attempts, cooldown, lastContact).
 */

import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { getRuleForCause } from "../domain/policy";
import { nextState, WorkflowState } from "../domain/stateMachine";
import {
  ActionResult,
  DecisionResult,
  DiagnosisResult,
  EnrichedRevenueEvent,
} from "../domain/types";

const REDIS_PREFIX = "razorrecovery";

/**
 * Derive outcome from the action result for audit purposes.
 * recovered | pending | escalated | skipped | failed
 */
function deriveOutcome(action: ActionResult): string {
  if (action.result === "skipped") return "skipped";
  if (action.result === "failed") return "failed";
  if (action.actionType === "escalate_to_human") return "escalated";
  // Email sent, payment link sent, retry initiated — not yet confirmed recovered
  return "pending";
}

/**
 * Map (actionType, result) to the state machine's action outcome string.
 * Returns null if no state transition should occur (e.g. failed action).
 */
function toStateMachineOutcome(action: ActionResult): string | null {
  if (action.result === "failed") return null;

  // Skipped with actionType 'none' means DNC or policy-blocked
  if (action.result === "skipped" && action.actionType === "none") {
    return "dnc_skip";
  }

  // Skipped discount — no state transition
  if (action.result === "skipped") return null;

  // Successful actions
  switch (action.actionType) {
    case "retry_payment":
    case "retry_payment_immediate":
    case "retry_payment_delayed":
      return "retry_initiated";
    case "send_reminder_email":
    case "send_soft_chase_email":
    case "send_dunning_email_1":
    case "send_dunning_email_2":
    case "send_dunning_email_3":
    case "send_reminder":
      return "email_sent";
    case "send_payment_link":
    case "send_sms_reminder":
      return "payment_link_sent";
    case "escalate_to_human":
      return "escalation_triggered";
    case "send_discount_offer":
      return "discount_sent";
    default:
      return null;
  }
}

/**
 * Compute cooldown TTL in seconds from the policy rule's stopping config.
 * Falls back to 1 hour if no window is configured.
 */
function cooldownTtlSeconds(causeLabel: string): number {
  const rule = getRuleForCause(causeLabel);
  if (!rule) return 3600; // 1h default

  const stopping = rule.stopping;
  if (stopping.windowHours !== undefined) {
    return stopping.windowHours * 3600;
  }
  if (stopping.windowDays !== undefined) {
    return stopping.windowDays * 86400;
  }
  return 3600; // 1h default
}

/**
 * Records the full audit entry for a processed event.
 *
 * Also transitions the EntityWorkflowState and updates Redis counters
 * (attempts, cooldown, lastContact).
 */
export async function recordAuditEntry(params: {
  event: EnrichedRevenueEvent;
  diagnosis: DiagnosisResult;
  decision: DecisionResult;
  action: ActionResult;
}): Promise<void> {
  const { event, diagnosis, decision, action } = params;
  const outcome = deriveOutcome(action);
  const now = new Date();

  // 1. Write AuditEntry row
  await prisma.auditEntry.create({
    data: {
      eventId: event.id,
      entityId: event.entityId,
      actor: "system",
      inputSnapshot: event as unknown as Record<string, unknown>,
      decisionSnapshot: decision as unknown as Record<string, unknown>,
      actionSnapshot: action as unknown as Record<string, unknown>,
      outcome,
      timestamp: now,
    },
  });

  // 2. Update EntityWorkflowState via state machine
  const smOutcome = toStateMachineOutcome(action);
  if (smOutcome) {
    const existing = await prisma.entityWorkflowState.findUnique({
      where: { entityId: event.entityId },
    });

    const currentState = (existing?.state ?? "DETECTED") as WorkflowState;
    const newState = nextState(currentState, smOutcome);

    await prisma.entityWorkflowState.upsert({
      where: { entityId: event.entityId },
      create: {
        entityId: event.entityId,
        customerId: event.customerId,
        state: newState,
        attemptCount: 1,
        lastContactedAt: now,
      },
      update: {
        state: newState,
        attemptCount: { increment: 1 },
        lastContactedAt: now,
      },
    });
  }

  // 3. Update Redis counters
  const entityId = event.entityId;
  await redis.incr(`${REDIS_PREFIX}:attempts:${entityId}`);

  const ttl = cooldownTtlSeconds(diagnosis.causeLabel);
  await redis.set(
    `${REDIS_PREFIX}:cooldown:${entityId}`,
    now.toISOString(),
    "EX",
    ttl,
  );

  await redis.set(
    `${REDIS_PREFIX}:lastContact:${entityId}`,
    now.toISOString(),
  );
}
