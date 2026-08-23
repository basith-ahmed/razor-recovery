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
        return "bg-emerald-950 text-emerald-400 border-emerald-800";
      case "written_off":
      case "failed":
        return "bg-red-950 text-red-400 border-red-800";
      case "contacted":
      case "retrying":
        return "bg-blue-950 text-blue-400 border-blue-800";
      case "cooling_down":
        return "bg-amber-950 text-amber-400 border-amber-800";
      case "escalated":
        return "bg-purple-950 text-purple-400 border-purple-800";
      case "skipped":
      case "do_not_contact":
        return "bg-slate-800 text-slate-400 border-slate-700";
      default:
        return "bg-slate-800 text-slate-300 border-slate-700";
    }
  };

  const handleRowClick = (item: ActivityItem) => {
    const id = item.entityId || item.id;
    if (id) {
      router.push(`/entities/${id}`);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-md font-semibold text-white flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Live Activity Feed
        </h3>
        <span className="text-xs text-slate-400 font-mono">{items.length} events logged</span>
      </div>

      <div className="max-h-72 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {items.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            No live events yet. Trigger a batch above to stream events live.
          </div>
        ) : (
          items.map((item, idx) => (
            <div
              key={idx}
              onClick={() => handleRowClick(item)}
              className="bg-slate-950 hover:bg-slate-800/80 transition-colors border border-slate-800/80 rounded p-3 text-xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 cursor-pointer group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-slate-500 text-[11px] whitespace-nowrap">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
                <span className="font-semibold text-slate-200 truncate group-hover:text-blue-400 transition-colors">
                  {item.customerName}
                </span>
                <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono text-[10px] uppercase">
                  {item.eventType}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-400">
                  Cause: <strong className="text-slate-300 font-normal">{item.cause}</strong>
                </span>
                <span className="text-slate-400 hidden md:inline">|</span>
                <span className="text-slate-400 hidden md:inline">
                  Action: <strong className="text-slate-300 font-normal">{item.action}</strong>
                </span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${getOutcomeBadgeClass(item.outcome)}`}>
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
