/**
 * Stopping rules — deterministic filter that turns (cause, entity state, counters)
 * into a legal action list. Step 1 of the Decision Engine.
 * Pure function: no Redis, no Prisma, no network calls.
 */

import { getRuleForCause, PolicyRule, StoppingConfig } from "./policy";

/**
 * Identifies which policy rule determined the outcome when the outcome is not
 * simply the cause's default action list. This is the single source of truth
 * for block causes; downstream layers must map it to presentation (e.g. audit
 * reasoning text) instead of re-deriving it from FilterContext flags.
 */
export type BlockReason =
  | "recovered"
  | "escalated"
  | "dnc"
  | "disputed"
  | "promise_broken"
  | "active_promise"
  | "cooldown"
  | "max_attempts"
  | "hard_stop"
  | "no_response"
  | "unknown_cause";

export interface LegalActionsResult {
  actions: string[];
  /** Present whenever a blocking/restricting rule — not the cause's default action list — determined the outcome. */
  blockedBy?: BlockReason;
}

export interface FilterContext {
  causeLabel: string;
  customerId: string;
  isDnc: boolean;
  isDisputed: boolean;
  isRecovered?: boolean;
  isEscalated?: boolean;
  hasActivePromise?: boolean;
  attemptCount: number;
  isInCooldown: boolean;
  daysOverdue?: number;
  daysSinceLastContact?: number;
  /** Precise elapsed hours since last contact; preferred over days when present. */
  hoursSinceLastContact?: number;
}

export function evaluateLegalActions(ctx: FilterContext): LegalActionsResult {
  // 0. Recovered entities are closed — no further recovery action is legal → return []
  if (ctx.isRecovered) {
    return { actions: [], blockedBy: "recovered" };
  }

  // 0b. Escalated entities are under active human review — pause automated recovery → return []
  if (ctx.isEscalated) {
    return { actions: [], blockedBy: "escalated" };
  }

  // 1. DNC always checked first → return []
  if (ctx.isDnc || ctx.causeLabel === "dnc") {
    return { actions: [], blockedBy: "dnc" };
  }

  // 2. Dispute flag or broken promise always overrides standard actions → return ["escalate_to_human"] only
  if (ctx.isDisputed || ctx.causeLabel === "invoice_disputed") {
    return { actions: ["escalate_to_human"], blockedBy: "disputed" };
  }
  if (ctx.causeLabel === "promise_broken") {
    return { actions: ["escalate_to_human"], blockedBy: "promise_broken" };
  }

  // 3. If customer has an active unbroken Promise-to-Pay, pause all automated outreach
  if (ctx.hasActivePromise) {
    return { actions: [], blockedBy: "active_promise" };
  }

  // 4. Look up the policy rule for ctx.causeLabel
  const rule = getRuleForCause(ctx.causeLabel);
  if (!rule) {
    // Unknown cause — no legal actions
    return { actions: [], blockedBy: "unknown_cause" };
  }

  // 5. Apply stopping conditions to prune the action list.
  return applyStoppingConditions(rule, ctx);
}

/**
 * Backward-compatible view over evaluateLegalActions: returns only the legal
 * action list, dropping the structured block reason.
 */
export function filterLegalActions(ctx: FilterContext): string[] {
  return evaluateLegalActions(ctx).actions;
}

function applyStoppingConditions(
  rule: PolicyRule,
  ctx: FilterContext
): LegalActionsResult {
  const stopping = rule.stopping;
  const actions = [...rule.actions];

  // If in cooldown, no actions are legal right now
  if (ctx.isInCooldown) {
    return { actions: [], blockedBy: "cooldown" };
  }

  // maxAttempts: if attemptCount >= maxAttempts, only the onMaxAction is legal (if specified)
  if (
    stopping.maxAttempts !== undefined &&
    ctx.attemptCount >= stopping.maxAttempts
  ) {
    if (stopping.onMaxAction) {
      return { actions: [stopping.onMaxAction], blockedBy: "max_attempts" };
    }
    return { actions: [], blockedBy: "max_attempts" };
  }

  // hardStopDays: if daysOverdue >= hardStopDays, only the onHardStopAction is legal
  if (
    stopping.hardStopDays !== undefined &&
    ctx.daysOverdue !== undefined &&
    ctx.daysOverdue >= stopping.hardStopDays
  ) {
    if (stopping.onHardStopAction) {
      return { actions: [stopping.onHardStopAction], blockedBy: "hard_stop" };
    }
    return { actions: [], blockedBy: "hard_stop" };
  }

  // noResponseWithinHours: if time since last contact exceeds the threshold, apply the timeout action
  if (stopping.noResponseWithinHours !== undefined) {
    const hoursThreshold = stopping.noResponseWithinHours;
    const hoursSinceLastContact =
      ctx.hoursSinceLastContact ??
      (ctx.daysSinceLastContact ?? 0) * 24;
    if (hoursSinceLastContact >= hoursThreshold) {
      if (stopping.onTimeoutAction) {
        return { actions: [stopping.onTimeoutAction], blockedBy: "no_response" };
      }
      return { actions: [], blockedBy: "no_response" };
    }
  }

  return { actions };
}
