"use client";

import { useRouter } from "next/navigation";
import { IncomingEventItem } from "../types";

interface IncomingEventFeedProps {
  items: IncomingEventItem[];
}

export function IncomingEventFeed({ items }: IncomingEventFeedProps) {
  const router = useRouter();

  const handleRowClick = (item: IncomingEventItem) => {
    router.push(`/entities/${item.entityId}`);
  };

  return (
    <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px] flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-primary" />
          Incoming Events
        </h3>
        <span className="text-xs text-ink-faint">
          {items.length} events received
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
        {items.length === 0 ? (
          <div className="text-center py-6 text-ink-muted text-xs">
            No incoming events yet. Start a stream injection to watch events arrive live.
          </div>
        ) : (
          items.map((item, idx) => (
            <div
              key={`${item.eventId}-${idx}`}
              onClick={() => handleRowClick(item)}
              className="bg-canvas-soft hover:bg-hairline/40 border border-hairline rounded-[6px] p-2.5 text-xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-ink-muted text-[11px] whitespace-nowrap">
                  {new Date(item.occurredAt).toLocaleTimeString()}
                </span>
                <span className="font-semibold text-ink truncate">
                  {item.customerName}
                </span>
                <span className="bg-white text-ink-muted px-1.5 py-0.5 rounded-[4px] text-[10px] uppercase border border-hairline font-medium">
                  {item.eventType}
                </span>
                {item.synthesized && (
                  <span
                    className="bg-accent-purple/30 text-accent-purple-deep border border-accent-purple/60 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-eyebrow"
                    title={`Scheduler-generated follow-up (${item.followUpType ?? "unknown"})`}
                  >
                    ⟳ {item.followUpType ?? "follow-up"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {item.riskScore != null && (
                  <span className="text-ink-faint hidden md:inline">
                    Risk:{" "}
                    <strong className="text-ink-secondary font-normal">
                      {item.riskScore.toFixed(3)}
                    </strong>
                  </span>
                )}
                <span className="text-accent-orange font-semibold">
                  ₹{item.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
