/**
 * Centralized badge styling mappings for workflow states, stages, results, and risk tiers.
 * Single source of truth for UI indicators across tables, timelines, and detail cards.
 */

export const STATE_BADGE_STYLES: Record<string, string> = {
  DETECTED: "bg-slate-100 text-slate-700 border-slate-300",
  CONTACTED: "bg-blue-50 text-blue-700 border-blue-200",
  RETRYING: "bg-blue-50 text-blue-700 border-blue-200",
  COOLING_DOWN: "bg-amber-50 text-amber-700 border-amber-200",
  ESCALATED: "bg-purple-50 text-purple-700 border-purple-200",
  RECOVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WRITTEN_OFF: "bg-red-50 text-red-700 border-red-200",
  DO_NOT_CONTACT: "bg-white text-slate-500 border-slate-300",
};

export const STAGE_BADGE_STYLES: Record<string, string> = {
  DETECTED: "bg-slate-100 text-slate-600 border-slate-300",
  DIAGNOSED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  DECIDED: "bg-cyan-50 text-cyan-700 border-cyan-200",
  EXECUTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export const ACTION_RESULT_BADGE_STYLES: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  scheduled: "bg-indigo-50 text-indigo-700 border-indigo-200",
  dispatched: "bg-cyan-50 text-cyan-700 border-cyan-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-300",
  skipped: "bg-slate-100 text-slate-500 border-slate-300",
  failed: "bg-red-50 text-red-700 border-red-200",
};

export const RISK_TIER_BADGE_STYLES: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700 border-red-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export const PROMISE_STATUS_BADGE_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  reminder_sent: "bg-orange-50 text-orange-700 border-orange-200",
  kept: "bg-emerald-50 text-emerald-700 border-emerald-200",
  broken: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-300",
};

export const TICKET_STATUS_BADGE_STYLES: Record<string, string> = {
  open: "bg-purple-50 text-purple-700 border-purple-200",
  resolved: "bg-blue-50 text-blue-700 border-blue-200",
  recovered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  written_off: "bg-red-50 text-red-700 border-red-200",
};

export function getStateBadgeStyle(state?: string | null): string {
  if (!state) return "bg-slate-100 text-slate-600 border-slate-300";
  return STATE_BADGE_STYLES[state.toUpperCase()] || "bg-slate-100 text-slate-600 border-slate-300";
}

export function getStageBadgeStyle(stage?: string | null): string {
  if (!stage) return "bg-slate-100 text-slate-600 border-slate-300";
  return STAGE_BADGE_STYLES[stage.toUpperCase()] || "bg-slate-100 text-slate-600 border-slate-300";
}

export function getActionResultBadgeStyle(result?: string | null): string {
  if (!result) return "bg-slate-100 text-slate-500 border-slate-300";
  return ACTION_RESULT_BADGE_STYLES[result.toLowerCase()] || "bg-slate-100 text-slate-500 border-slate-300";
}

export function getRiskTierBadgeStyle(tier?: string | null): string {
  if (!tier) return "bg-slate-100 text-slate-600 border-slate-300";
  return RISK_TIER_BADGE_STYLES[tier.toUpperCase()] || "bg-slate-100 text-slate-600 border-slate-300";
}

export function getPromiseStatusBadgeStyle(status?: string | null): string {
  if (!status) return "bg-slate-100 text-slate-500 border-slate-300";
  return PROMISE_STATUS_BADGE_STYLES[status.toLowerCase()] || "bg-slate-100 text-slate-500 border-slate-300";
}

export function getTicketStatusBadgeStyle(status?: string | null): string {
  if (!status) return "bg-slate-100 text-slate-500 border-slate-300";
  return TICKET_STATUS_BADGE_STYLES[status.toLowerCase()] || "bg-slate-100 text-slate-500 border-slate-300";
}
