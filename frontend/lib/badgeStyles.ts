/**
 * Centralized badge styling mappings for workflow states, stages, results, and risk tiers.
 * Single source of truth for UI indicators across tables, timelines, and detail cards.
 */

export const STATE_BADGE_STYLES: Record<string, string> = {
  DETECTED: "bg-canvas-soft text-ink-muted border-hairline",
  CONTACTED: "bg-primary/10 text-primary border-primary/20",
  RETRYING: "bg-accent-sky/15 text-primary border-accent-sky/30",
  COOLING_DOWN: "bg-accent-orange/10 text-accent-orange-deep border-accent-orange/25",
  ESCALATED: "bg-accent-purple/30 text-accent-purple-deep border-accent-purple/60",
  RECOVERED: "bg-accent-green/10 text-accent-green border-accent-green/25",
  WRITTEN_OFF: "bg-accent-orange/15 text-accent-orange-deep border-accent-orange/30",
  DO_NOT_CONTACT: "bg-canvas-soft text-ink-muted border-hairline",
};

export const STAGE_BADGE_STYLES: Record<string, string> = {
  DETECTED: "bg-canvas-soft text-ink-muted border-hairline",
  DIAGNOSED: "bg-accent-purple/30 text-accent-purple-deep border-accent-purple/60",
  DECIDED: "bg-accent-teal/15 text-accent-teal border-accent-teal/30",
  EXECUTED: "bg-accent-green/10 text-accent-green border-accent-green/25",
};

export const ACTION_RESULT_BADGE_STYLES: Record<string, string> = {
  success: "bg-accent-green/10 text-accent-green border-accent-green/25",
  scheduled: "bg-accent-purple/20 text-accent-purple-deep border-accent-purple/40",
  dispatched: "bg-primary/10 text-primary border-primary/20",
  cancelled: "bg-canvas-soft text-ink-muted border-hairline",
  skipped: "bg-canvas-soft text-ink-muted border-hairline",
  failed: "bg-accent-orange/15 text-accent-orange-deep border-accent-orange/30",
};

export const RISK_TIER_BADGE_STYLES: Record<string, string> = {
  HIGH: "bg-accent-orange/15 text-accent-orange-deep border-accent-orange/30",
  MEDIUM: "bg-accent-orange/10 text-accent-orange border-accent-orange/20",
  STANDARD: "bg-accent-sky/15 text-primary border-accent-sky/30",
  LOW: "bg-accent-green/10 text-accent-green border-accent-green/25",
};

export const PROMISE_STATUS_BADGE_STYLES: Record<string, string> = {
  pending: "bg-accent-orange/10 text-accent-orange border-accent-orange/20",
  reminder_sent: "bg-accent-sky/15 text-primary border-accent-sky/30",
  kept: "bg-accent-green/10 text-accent-green border-accent-green/25",
  broken: "bg-accent-orange/15 text-accent-orange-deep border-accent-orange/30",
  cancelled: "bg-canvas-soft text-ink-muted border-hairline",
};

export const TICKET_STATUS_BADGE_STYLES: Record<string, string> = {
  open: "bg-accent-purple/30 text-accent-purple-deep border-accent-purple/60",
  resolved: "bg-primary/10 text-primary border-primary/20",
  recovered: "bg-accent-green/10 text-accent-green border-accent-green/25",
  written_off: "bg-accent-orange/15 text-accent-orange-deep border-accent-orange/30",
};

export function getStateBadgeStyle(state?: string | null): string {
  if (!state) return "bg-canvas-soft text-ink-muted border-hairline";
  return STATE_BADGE_STYLES[state.toUpperCase()] || "bg-canvas-soft text-ink-muted border-hairline";
}

export function getStageBadgeStyle(stage?: string | null): string {
  if (!stage) return "bg-canvas-soft text-ink-muted border-hairline";
  return STAGE_BADGE_STYLES[stage.toUpperCase()] || "bg-canvas-soft text-ink-muted border-hairline";
}

export function getActionResultBadgeStyle(result?: string | null): string {
  if (!result) return "bg-canvas-soft text-ink-muted border-hairline";
  return ACTION_RESULT_BADGE_STYLES[result.toLowerCase()] || "bg-canvas-soft text-ink-muted border-hairline";
}

export function getRiskTierBadgeStyle(tier?: string | null): string {
  if (!tier) return "bg-canvas-soft text-ink-muted border-hairline";
  return RISK_TIER_BADGE_STYLES[tier.toUpperCase()] || "bg-canvas-soft text-ink-muted border-hairline";
}

export function getPromiseStatusBadgeStyle(status?: string | null): string {
  if (!status) return "bg-canvas-soft text-ink-muted border-hairline";
  return PROMISE_STATUS_BADGE_STYLES[status.toLowerCase()] || "bg-canvas-soft text-ink-muted border-hairline";
}

export function getTicketStatusBadgeStyle(status?: string | null): string {
  if (!status) return "bg-canvas-soft text-ink-muted border-hairline";
  return TICKET_STATUS_BADGE_STYLES[status.toLowerCase()] || "bg-canvas-soft text-ink-muted border-hairline";
}
