"use client";

import { MetricsWindow } from "../types";

interface WindowSelectorProps {
  value: MetricsWindow;
  onChange: (window: MetricsWindow) => void;
}

const OPTIONS: Array<{ value: MetricsWindow; label: string }> = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All time" },
];

export function WindowSelector({ value, onChange }: WindowSelectorProps) {
  return (
    <div className="flex items-center gap-1 bg-white border border-slate-300 rounded p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-3 py-1.5 rounded font-medium ${
            value === opt.value
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
