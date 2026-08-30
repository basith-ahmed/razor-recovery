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
    <div className="bg-white border border-slate-200 rounded p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
          Incoming Events
        </h3>
        <span className="text-xs text-slate-400 font-mono">
          {items.length} events received
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
        {items.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs">
            No incoming events yet. Start a stream injection to watch events arrive live.
          </div>
        ) : (
          items.map((item, idx) => (
            <div
              key={`${item.eventId}-${idx}`}
              onClick={() => handleRowClick(item)}
              className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded p-2.5 text-xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-slate-500 text-[11px] whitespace-nowrap">
                  {new Date(item.occurredAt).toLocaleTimeString()}
                </span>
                <span className="font-semibold text-slate-800 truncate">
                  {item.customerName}
                </span>
                <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono text-[10px] uppercase border border-slate-200">
                  {item.eventType}
                </span>
                {item.synthesized && (
                  <span
                    className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase"
                    title={`Scheduler-generated follow-up (${item.followUpType ?? "unknown"})`}
                  >
                    ⟳ {item.followUpType ?? "follow-up"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {item.riskScore != null && (
                  <span className="text-slate-400 hidden md:inline">
                    Risk:{" "}
                    <strong className="text-slate-700 font-normal">
                      {item.riskScore.toFixed(3)}
                    </strong>
                  </span>
                )}
                <span className="font-mono text-amber-700 font-semibold">
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
