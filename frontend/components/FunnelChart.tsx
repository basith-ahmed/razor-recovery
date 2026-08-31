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
  DETECTED: "#615d59",
  DIAGNOSED: "#2a9d99",
  CONTACTED: "#0075de",
  RETRYING: "#62aef0",
  COOLING_DOWN: "#dd5b00",
  ESCALATED: "#391c57",
  RECOVERED: "#1aae39",
  WRITTEN_OFF: "#793400",
};

export function FunnelChart({ data = [] }: FunnelChartProps) {
  const chartData = data.map((item) => ({
    stage: item.stage,
    count: item.count,
    color: STAGE_COLORS[item.stage.toUpperCase()] || "#0075de",
  }));

  return (
    <div className="bg-white border border-hairline rounded-[12px] p-5 h-full shadow-notion-soft">
      <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-0.5">Recovery Conversion Funnel</h3>
      <p className="text-xs text-ink-muted mb-4">Volume of revenue entities passing through workflow stages</p>

      <div className="h-64 w-full">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ink-muted text-xs">
            No funnel data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <XAxis
                dataKey="stage"
                stroke="#e6e6e6"
                tick={{ fill: "#615d59", fontSize: 10, fontWeight: 500 }}
                interval={0}
              />
              <YAxis stroke="#e6e6e6" tick={{ fill: "#615d59", fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#ffffff",
                  borderColor: "#e6e6e6",
                  color: "#000000",
                  borderRadius: "8px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.02), 0 6px 16px rgba(0,0,0,0.03)",
                  fontSize: "12px",
                }}
                itemStyle={{ color: "#0075de", fontWeight: "600" }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
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
