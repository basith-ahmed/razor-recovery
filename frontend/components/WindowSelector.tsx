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
    <div className="flex items-center gap-1 bg-white border border-hairline rounded-[8px] p-1 shadow-notion-soft">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-3 py-1.5 rounded-[6px] font-medium transition-all ${
            value === opt.value
              ? "bg-ink text-white font-semibold shadow-sm"
              : "text-ink-muted hover:text-ink hover:bg-canvas-soft"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
