/**
 * Stopping rules — deterministic filter that turns (cause, entity state, counters)
 * into a legal action list. Step 1 of the Decision Engine.
 * Pure function: no Redis, no Prisma, no network calls.
 */

import { getRuleForCause, PolicyRule, StoppingConfig } from "./policy";

export interface FilterContext {
  causeLabel: string;
  customerId: string;
  isDnc: boolean;
  isDisputed: boolean;
  attemptCount: number;
  isInCooldown: boolean;
  daysOverdue?: number;
  daysSinceLastContact?: number;
}

export function filterLegalActions(ctx: FilterContext): string[] {
  // 1. DNC always checked first → return []
  if (ctx.isDnc) {
    return [];
  }

  // 2. Dispute flag always overrides everything else → return ["escalate_to_human"] only
  if (ctx.isDisputed) {
    return ["escalate_to_human"];
  }

  // 3. Look up the policy rule for ctx.causeLabel
  const rule = getRuleForCause(ctx.causeLabel);
  if (!rule) {
    // Unknown cause — no legal actions
    return [];
  }

  // 4. Apply stopping conditions to prune the action list
  return applyStoppingConditions(rule, ctx);
}

function applyStoppingConditions(
  rule: PolicyRule,
  ctx: FilterContext
): string[] {
  const stopping = rule.stopping;
  let actions = [...rule.actions];

  // If in cooldown, no actions are legal right now
  if (ctx.isInCooldown) {
    return [];
  }

  // maxAttempts: if attemptCount >= maxAttempts, only escalation is legal (if onMaxEscalate)
  // or the onMaxAction if specified
  if (
    stopping.maxAttempts !== undefined &&
    ctx.attemptCount >= stopping.maxAttempts
  ) {
    if (stopping.onMaxEscalate) {
      return ["escalate_to_human"];
    }
    if (stopping.onMaxAction) {
      return [stopping.onMaxAction];
    }
    return [];
  }

  // hardStopDays: if daysOverdue >= hardStopDays, only the onHardStopAction is legal
  if (
    stopping.hardStopDays !== undefined &&
    ctx.daysOverdue !== undefined &&
    ctx.daysOverdue >= stopping.hardStopDays
  ) {
    if (stopping.onHardStopAction) {
      return [stopping.onHardStopAction];
    }
    return [];
  }

  // escalateAtDays: if daysOverdue >= escalateAtDays, ensure escalation is included
  if (
    stopping.escalateAtDays !== undefined &&
    ctx.daysOverdue !== undefined &&
    ctx.daysOverdue >= stopping.escalateAtDays
  ) {
    if (!actions.includes("escalate_to_human")) {
      actions.push("escalate_to_human");
    }
  }

  // noResponseWithinHours: if daysSinceLastContact exceeds the threshold,
  // apply the timeout action
  if (stopping.noResponseWithinHours !== undefined) {
    const hoursThreshold = stopping.noResponseWithinHours;
    const hoursSinceLastContact =
      (ctx.daysSinceLastContact ?? 0) * 24;
    if (hoursSinceLastContact >= hoursThreshold) {
      if (stopping.onTimeoutAction === "stop") {
        return [];
      }
      if (stopping.onTimeoutAction) {
        return [stopping.onTimeoutAction];
      }
    }
  }

  // freezeWorkflow: only escalation allowed
  if (stopping.freezeWorkflow) {
    return actions.filter((a) => a === "escalate_to_human");
  }

  // skipAndLog: no actions — just log
  if (stopping.skipAndLog) {
    return [];
  }

  return actions;
}
