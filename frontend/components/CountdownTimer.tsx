import { useEffect, useState } from "react";
import { PromiseStatus } from "../types";
import { calculateTimeRemaining } from "../lib/formatters";

interface CountdownTimerProps {
  promisedDate: string;
  gracePeriodUntil?: string | null;
  status: PromiseStatus;
}

export function CountdownTimer({
  promisedDate,
  gracePeriodUntil,
  status,
}: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState(() => {
    const target =
      status === "reminder_sent" && gracePeriodUntil ? gracePeriodUntil : promisedDate;
    return calculateTimeRemaining(target);
  });

  useEffect(() => {
    function update() {
      const target =
        status === "reminder_sent" && gracePeriodUntil ? gracePeriodUntil : promisedDate;
      setTimeLeft(calculateTimeRemaining(target));
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [promisedDate, gracePeriodUntil, status]);

  if (status === "kept") {
    return <span className="text-xs text-accent-green font-semibold">Paid & Kept</span>;
  }

  if (status === "broken") {
    return <span className="text-xs text-accent-orange-deep font-semibold">Broken (Escalated)</span>;
  }

  if (status === "cancelled") {
    return <span className="text-xs text-ink-faint">Cancelled</span>;
  }

  if (status === "reminder_sent") {
    return (
      <div className="text-xs">
        <span className="text-accent-orange-deep font-semibold block">Reminder Sent (Grace Period)</span>
        <span className="text-ink-muted">
          {timeLeft.isPast
            ? "Grace period expired"
            : `${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s remaining`}
        </span>
      </div>
    );
  }

  // Pending
  return (
    <div className="text-xs">
      {timeLeft.isPast ? (
        <span className="text-accent-orange-deep font-semibold">Due Date Passed</span>
      ) : (
        <span className="text-ink font-semibold">
          {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s left
        </span>
      )}
    </div>
  );
}
