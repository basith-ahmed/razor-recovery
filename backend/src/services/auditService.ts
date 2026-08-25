/**
 * Audit Service — records the full audit trail for a processed event,
 * updates entity workflow state via the state machine, and maintains
 * per-cause attempt/cooldown/last-contact state (EntityCauseState).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logError } from "../config/logger";
import { getRuleForCause } from "../domain/policy";
import { isTerminal, nextState, WorkflowState } from "../domain/stateMachine";
import {
  ActionResult,
  DecisionResult,
  DiagnosisResult,
  EnrichedRevenueEvent,
} from "../domain/types";

/**
 * Derive outcome from the action result for audit purposes.
 * recovered | pending | escalated | skipped | failed
 */
function deriveOutcome(action: ActionResult): string {
  if (action.result === "skipped") return "skipped";
  if (action.result === "failed") return "failed";
  if (action.actionType === "escalate_to_human") return "escalated";
  // Terminal write-off actions close the arc — they are not merely "pending".
  if (
    action.actionType === "hard_decline" ||
    action.actionType === "auto_cancel"
  ) {
    return "written_off";
  }
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
    // Terminal write-off actions — the state machine maps these to WRITTEN_OFF
    case "hard_decline":
      return "hard_decline";
    case "auto_cancel":
      return "auto_cancel";
    // Subscription lifecycle actions
    case "pause_subscription":
      return "subscription_paused";
    case "send_winback_offer":
      return "winback_sent";
    case "start_promise_to_pay_tracking":
      return "reminder_sent";
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
 * Also transitions the EntityWorkflowState and updates per-cause
 * attempt/cooldown/last-contact state in EntityCauseState.
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
      inputSnapshot: event as unknown as Prisma.InputJsonValue,
      diagnosisSnapshot: diagnosis as unknown as Prisma.InputJsonValue,
      decisionSnapshot: decision as unknown as Prisma.InputJsonValue,
      actionSnapshot: action as unknown as Prisma.InputJsonValue,
      outcome,
      timestamp: now,
    },
  });

  // 2. Update EntityWorkflowState via state machine.
  // A new event on a terminal-state entity (e.g. RECOVERED subscription from a
  // previous billing cycle) starts a FRESH arc: it is transitioned as if the
  // entity were at DETECTED again.
  const smOutcome = toStateMachineOutcome(action);
  let newState: WorkflowState | null = null;

  if (smOutcome) {
    try {
      const existing = await prisma.entityWorkflowState.findUnique({
        where: { entityId: event.entityId },
      });

      const currentState = (existing?.state ?? "DETECTED") as WorkflowState;
      const effectiveCurrent = isTerminal(currentState) ? "DETECTED" : currentState;
      newState = nextState(effectiveCurrent, smOutcome);

      await prisma.entityWorkflowState.upsert({
        where: { entityId: event.entityId },
        create: {
          entityId: event.entityId,
          customerId: event.customerId,
          state: newState,
        },
        update: {
          state: newState,
        },
      });

      // Closing the arc for this entity wipes ALL of its per-cause
      // attempt/cooldown history, not just the cause that just resolved — a
      // fresh arc should start with a genuinely clean slate across every
      // cause, matching the intent documented on isTerminal()/nextState().
      if (isTerminal(newState)) {
        await prisma.entityCauseState.deleteMany({
          where: { entityId: event.entityId },
        });
      }
    } catch (err) {
      // Never mask a recorded audit entry behind a state-transition problem;
      // log and continue so consumers don't write spurious duplicate failures.
      logError("audit", err);
    }
  }

  // 3. Per-cause attempt/cooldown tracking — only while this cause's arc is
  // still open. If the action above just closed the arc (newState is terminal),
  // EntityCauseState rows for this entity were already wiped, so don't recreate
  // one in the same tick.
  //
  // Only successful actions consume attempt budget or trigger cooldowns;
  // skipped (DNC/policy-blocked) and failed actions are not recovery attempts.
  if (smOutcome && !isTerminal(newState ?? "DETECTED")) {
    const countsAsAttempt = action.result === "success";
    const cooldownUntil = countsAsAttempt
      ? new Date(now.getTime() + cooldownTtlSeconds(diagnosis.causeLabel) * 1000)
      : undefined;

    await prisma.entityCauseState.upsert({
      where: {
        entityId_causeLabel: {
          entityId: event.entityId,
          causeLabel: diagnosis.causeLabel,
        },
      },
      create: {
        entityId: event.entityId,
        causeLabel: diagnosis.causeLabel,
        attemptCount: countsAsAttempt ? 1 : 0,
        lastContactedAt: now,
        cooldownUntil,
      },
      update: {
        ...(countsAsAttempt ? { attemptCount: { increment: 1 } } : {}),
        lastContactedAt: now,
        ...(cooldownUntil ? { cooldownUntil } : {}),
      },
    });
  }
}
