import React from "react";
import {
  getStateBadgeStyle,
  getStageBadgeStyle,
  getActionResultBadgeStyle,
  getRiskTierBadgeStyle,
  getPromiseStatusBadgeStyle,
  getTicketStatusBadgeStyle,
} from "../lib/badgeStyles";

export type BadgeType =
  | "state"
  | "stage"
  | "actionResult"
  | "riskTier"
  | "promiseStatus"
  | "ticketStatus"
  | "custom";

interface BadgeProps {
  type?: BadgeType;
  value?: string | null;
  className?: string;
  children?: React.ReactNode;
}

export function Badge({ type = "custom", value, className = "", children }: BadgeProps) {
  let style = "bg-slate-100 text-slate-600 border-slate-300";

  if (type === "state") {
    style = getStateBadgeStyle(value);
  } else if (type === "stage") {
    style = getStageBadgeStyle(value);
  } else if (type === "actionResult") {
    style = getActionResultBadgeStyle(value);
  } else if (type === "riskTier") {
    style = getRiskTierBadgeStyle(value);
  } else if (type === "promiseStatus") {
    style = getPromiseStatusBadgeStyle(value);
  } else if (type === "ticketStatus") {
    style = getTicketStatusBadgeStyle(value);
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${style} ${className}`}
    >
      {children || value || "—"}
    </span>
  );
}
