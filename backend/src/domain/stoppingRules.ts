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
  isRecovered?: boolean;
  hasActivePromise?: boolean;
  attemptCount: number;
  isInCooldown: boolean;
  daysOverdue?: number;
  daysSinceLastContact?: number;
  /** Precise elapsed hours since last contact; preferred over days when present. */
  hoursSinceLastContact?: number;
}

export function filterLegalActions(ctx: FilterContext): string[] {
  // 0. Recovered entities are closed — no further recovery action is legal → return []
  if (ctx.isRecovered) {
    return [];
  }

  // 1. DNC always checked first → return []
  if (ctx.isDnc || ctx.causeLabel === "dnc") {
    return [];
  }

  // 2. Dispute flag or broken promise always overrides standard actions → return ["escalate_to_human"] only
  if (ctx.isDisputed || ctx.causeLabel === "invoice_disputed" || ctx.causeLabel === "promise_broken") {
    return ["escalate_to_human"];
  }

  // 3. If customer has an active unbroken Promise-to-Pay, pause all automated outreach
  if (ctx.hasActivePromise) {
    return [];
  }

  // 4. Look up the policy rule for ctx.causeLabel
  const rule = getRuleForCause(ctx.causeLabel);
  if (!rule) {
    // Unknown cause — no legal actions
    return [];
  }

  // 4. Apply stopping conditions to prune the action list.
  //
  // NOTE: mandate_requires_reauthorization enforcement works purely through
  // policy.json — retry_payment_immediate and retry_payment_delayed are simply
  // absent from that rule's actions array. No special-case code is needed here.
  // "Policy is data" — the omission IS the hard gate.
  return applyStoppingConditions(rule, ctx);
}

function applyStoppingConditions(
  rule: PolicyRule,
  ctx: FilterContext
): string[] {
  const stopping = rule.stopping;
  const actions = [...rule.actions];

  // If in cooldown, no actions are legal right now
  if (ctx.isInCooldown) {
    return [];
  }

  // maxAttempts: if attemptCount >= maxAttempts, only the onMaxAction is legal (if specified)
  if (
    stopping.maxAttempts !== undefined &&
    ctx.attemptCount >= stopping.maxAttempts
  ) {
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

  // noResponseWithinHours: if time since last contact exceeds the threshold, apply the timeout action
  if (stopping.noResponseWithinHours !== undefined) {
    const hoursThreshold = stopping.noResponseWithinHours;
    const hoursSinceLastContact =
      ctx.hoursSinceLastContact ??
      (ctx.daysSinceLastContact ?? 0) * 24;
    if (hoursSinceLastContact >= hoursThreshold) {
      if (stopping.onTimeoutAction) {
        return [stopping.onTimeoutAction];
      }
      return [];
    }
  }

  return actions;
}
