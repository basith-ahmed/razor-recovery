"use client";

import { useRouter } from "next/navigation";
import { IncomingEventItem } from "../types";

interface IncomingEventFeedProps {
  items: IncomingEventItem[];
}

/**
 * Live ingestion feed — shows each raw event the moment it enters the
 * pipeline (detection stage), before diagnosis/decision/audit complete.
 */
export function IncomingEventFeed({ items }: IncomingEventFeedProps) {
  const router = useRouter();

  const handleRowClick = (item: IncomingEventItem) => {
    router.push(`/entities/${item.entityId}`);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-md font-semibold text-slate-900 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          Incoming Events
        </h3>
        <span className="text-xs text-slate-400 font-mono">
          {items.length} events received — processing in progress below
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {items.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            No incoming events yet. Start a stream injection to watch events arrive live.
          </div>
        ) : (
          items.map((item, idx) => (
            <div
              key={`${item.eventId}-${idx}`}
              onClick={() => handleRowClick(item)}
              className="bg-slate-50 hover:bg-slate-100/80 transition-colors border border-slate-200/80 rounded p-3 text-xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 cursor-pointer group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-slate-500 text-[11px] whitespace-nowrap">
                  {new Date(item.occurredAt).toLocaleTimeString()}
                </span>
                <span className="font-semibold text-slate-800 truncate group-hover:text-blue-700 transition-colors">
                  {item.customerName}
                </span>
                <span className="bg-slate-100 text-slate-400 px-2 py-0.5 rounded font-mono text-[10px] uppercase">
                  {item.eventType}
                </span>
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
