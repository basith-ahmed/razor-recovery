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
  let style = "bg-canvas-soft text-ink-muted border-hairline";

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
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border uppercase tracking-eyebrow ${style} ${className}`}
    >
      {children || value || "—"}
    </span>
  );
}
