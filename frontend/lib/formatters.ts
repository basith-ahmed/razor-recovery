/**
 * Shared formatting utilities for numbers, currency, dates, and entity references.
 * Ensures consistent rendering across all dashboard views.
 */

export function formatCurrency(
  amount: number | null | undefined,
  currency: string = "INR",
): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return "₹0";
  }
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${amount.toLocaleString("en-IN")}`;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(d);
}

export function formatEntityRef(type?: string | null, id?: string | null): string {
  if (!id) return "—";
  const shortId = id.length > 8 ? id.slice(-8) : id;
  const prefix = type ? `${type} #` : "Ref #";
  return `${prefix}${shortId}`;
}

export const CAUSE_DISPLAY_NAMES: Record<string, string> = {
  expired_card: "Expired Card",
  insufficient_funds: "Insufficient Funds",
  gateway_timeout: "Gateway Timeout",
  price_friction: "Price Friction",
  no_reason_signal: "No Reason Signal",
  mandate_execution_failed_retryable: "Mandate: Retryable Failure",
  mandate_requires_reauthorization: "Mandate: Re-auth Required",
  invoice_overdue: "Invoice Overdue",
  invoice_disputed: "Invoice Disputed",
  dnc: "DNC / Consent Block",
};

export function formatCauseLabel(cause?: string | null): string {
  if (!cause) return "—";
  return CAUSE_DISPLAY_NAMES[cause] ?? cause.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export function formatPercentage(value: number, decimals: number = 1): string {
  if (isNaN(value)) return "0%";
  return `${(value * 100).toFixed(decimals)}%`;
}

export function calculateTimeRemaining(targetDate: string | Date): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isPast: boolean;
  totalSeconds: number;
} {
  const targetTime = typeof targetDate === "string" ? new Date(targetDate).getTime() : targetDate.getTime();
  const now = Date.now();
  const diff = targetTime - now;

  if (diff <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isPast: true,
      totalSeconds: 0,
    };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return {
    days,
    hours,
    minutes,
    seconds,
    isPast: false,
    totalSeconds: Math.floor(diff / 1000),
  };
}
