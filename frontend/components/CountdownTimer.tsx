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
    return <span className="text-xs text-green-700 font-semibold">Paid & Kept</span>;
  }

  if (status === "broken") {
    return <span className="text-xs text-red-700 font-semibold">Broken (Escalated)</span>;
  }

  if (status === "cancelled") {
    return <span className="text-xs text-slate-500">Cancelled</span>;
  }

  if (status === "reminder_sent") {
    return (
      <div className="text-xs">
        <span className="text-amber-800 font-semibold block">Reminder Sent (Grace Period)</span>
        <span className="text-slate-500 font-mono">
          {timeLeft.isPast
            ? "Grace period expired"
            : `${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s remaining`}
        </span>
      </div>
    );
  }

  // Pending
  return (
    <div className="text-xs font-mono">
      {timeLeft.isPast ? (
        <span className="text-red-700 font-semibold">Due Date Passed</span>
      ) : (
        <span className="text-slate-800 font-semibold">
          {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s left
        </span>
      )}
    </div>
  );
}
