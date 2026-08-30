"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { formatCauseLabel, formatCurrency } from "../lib/formatters";

interface CauseChannelChartsProps {
  byCause?: { cause: string; recovered: number; atRisk: number }[];
  byChannel?: {
    channel: string;
    count: number;
    recoveredCount?: number;
    recoveredAmount: number;
  }[];
}

const COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#ec4899"];

export function CauseChannelCharts({ byCause = [], byChannel = [] }: CauseChannelChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div className="bg-white border border-slate-200 rounded p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Failure Cause Distribution</h3>
        <p className="text-xs text-slate-500 mb-4">Breakdown of failure reasons for current window</p>

        <div className="h-64 w-full">
          {byCause.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs">
              No cause data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byCause}
                  dataKey="atRisk"
                  nameKey="cause"
                  cx="50%"
                  cy="50%"
                  outerRadius={85}
                  innerRadius={45}
                  paddingAngle={2}
                  label={(entry: { cause?: string; name?: string; percent?: number }) =>
                    `${formatCauseLabel(entry.cause || entry.name || "")} (${((entry.percent || 0) * 100).toFixed(0)}%)`
                  }
                >
                  {byCause.map((entry, index) => (
                    <Cell key={`cause-cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc" }}
                  formatter={(value: unknown) => [
                    formatCurrency(Number(value ?? 0)),
                    "Amount at Risk",
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Recovery Channel Efficiency</h3>
        <p className="text-xs text-slate-500 mb-4">Total events attempted vs successfully recovered events per channel</p>

        <div className="h-64 w-full">
          {byChannel.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs">
              No channel data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byChannel.map((item) => ({
                  ...item,
                  recoveredEvents: item.recoveredCount ?? 0,
                  channelLabel:
                    item.channel === "razorpay"
                      ? "Razorpay"
                      : item.channel === "email"
                        ? "Email"
                        : "Human / Escalation",
                }))}
                margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
              >
                <XAxis
                  dataKey="channelLabel"
                  stroke="#94a3b8"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc" }}
                  formatter={(value: unknown, name: string | number | undefined) => [
                    `${Number(value ?? 0).toLocaleString("en-IN")} events`,
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                <Bar dataKey="count" name="Total Events" fill="#64748b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="recoveredEvents" name="Recovered Events" fill="#22c55e" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
