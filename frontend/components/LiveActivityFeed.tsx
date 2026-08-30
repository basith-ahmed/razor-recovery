"use client";

import { useRouter } from "next/navigation";
import { ActivityItem } from "../types";

interface LiveActivityFeedProps {
  items: ActivityItem[];
}

export function LiveActivityFeed({ items }: LiveActivityFeedProps) {
  const router = useRouter();

  const getOutcomeBadgeClass = (outcome: string) => {
    switch (outcome.toLowerCase()) {
      case "recovered":
      case "success":
        return "bg-accent-green/10 text-accent-green border-accent-green/25";
      case "written_off":
      case "failed":
        return "bg-accent-orange/15 text-accent-orange-deep border-accent-orange/30";
      case "contacted":
      case "retrying":
        return "bg-primary/10 text-primary border-primary/20";
      case "cooling_down":
        return "bg-accent-orange/10 text-accent-orange-deep border-accent-orange/25";
      case "escalated":
        return "bg-accent-purple/30 text-accent-purple-deep border-accent-purple/60";
      case "skipped":
      case "do_not_contact":
        return "bg-canvas-soft text-ink-muted border-hairline";
      default:
        return "bg-canvas-soft text-ink-muted border-hairline";
    }
  };

  const handleRowClick = (item: ActivityItem) => {
    const id = item.entityId || item.id;
    if (id) {
      router.push(`/entities/${id}`);
    }
  };

  return (
    <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px] flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-accent-green animate-pulse" />
          Live Activity Feed
        </h3>
        <span className="text-xs text-ink-faint">{items.length} events logged</span>
      </div>

      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
        {items.length === 0 ? (
          <div className="text-center py-6 text-ink-muted text-xs">
            No live events yet. Start a stream injection to watch events flow through live.
          </div>
        ) : (
          items.map((item, idx) => (
            <div
              key={idx}
              onClick={() => handleRowClick(item)}
              className="bg-canvas-soft hover:bg-hairline/40 border border-hairline rounded-[6px] p-2.5 text-xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-ink-muted text-[11px] whitespace-nowrap">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
                <span className="font-semibold text-ink truncate">
                  {item.customerName}
                </span>
                <span className="bg-white text-ink-muted px-1.5 py-0.5 rounded-[4px] text-[10px] uppercase border border-hairline font-medium">
                  {item.eventType}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-ink-faint">
                  Cause: <strong className="text-ink-secondary font-normal">{item.cause}</strong>
                </span>
                <span className="text-ink-faint hidden md:inline">|</span>
                <span className="text-ink-faint hidden md:inline">
                  Action: <strong className="text-ink-secondary font-normal">{item.action}</strong>
                </span>
                {item.actionResult && item.actionResult !== "success" && (
                  <span className="bg-white text-ink-muted px-1.5 py-0.5 rounded-[4px] text-[10px] uppercase border border-hairline font-medium">
                    {item.actionResult}
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-eyebrow border ${getOutcomeBadgeClass(item.outcome)}`}>
                  {item.outcome}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
