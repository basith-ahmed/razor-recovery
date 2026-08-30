"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";

interface FunnelChartProps {
  data?: { stage: string; count: number }[];
}

const STAGE_COLORS: Record<string, string> = {
  DETECTED: "#6b7280",
  DIAGNOSED: "#a855f7",
  CONTACTED: "#3b82f6",
  RETRYING: "#3b82f6",
  COOLING_DOWN: "#f59e0b",
  ESCALATED: "#8b5cf6",
  RECOVERED: "#22c55e",
  WRITTEN_OFF: "#ef4444",
};

export function FunnelChart({ data = [] }: FunnelChartProps) {
  const chartData = data.map((item) => ({
    stage: item.stage,
    count: item.count,
    color: STAGE_COLORS[item.stage.toUpperCase()] || "#3b82f6",
  }));

  return (
    <div className="bg-white border border-slate-200 rounded p-4 mb-6">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Recovery Conversion Funnel</h3>
      <p className="text-xs text-slate-500 mb-4">Volume of revenue entities passing through workflow stages</p>

      <div className="h-64 w-full">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-xs">
            No funnel data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <XAxis
                dataKey="stage"
                stroke="#94a3b8"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                interval={0}
              />
              <YAxis stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc" }}
                itemStyle={{ color: "#38bdf8" }}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
