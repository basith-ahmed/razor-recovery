"use client";

import { useState, useEffect } from "react";
import { getMetricsSummary, getMetricsTrend } from "../../lib/api";
import { MetricsSummary, MetricsWindow, TrendPoint } from "../../types";
import { WindowSelector } from "../../components/WindowSelector";
import { AuditQueryPanel } from "../../components/AuditQueryPanel";

const CHANNEL_COST_MAP: Record<string, number> = {
  email: 0.5,
  sms: 1.5,
  human: 200.0,
  razorpay_link: 1.0,
  default: 1.0,
};

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [window, setWindow] = useState<MetricsWindow>("24h");
  const [loading, setLoading] = useState<boolean>(true);
  const [causeSort, setCauseSort] = useState<"rate_desc" | "count_desc" | "recovered_desc">("rate_desc");

  useEffect(() => {
    let ignore = false;
    Promise.all([getMetricsSummary(window), getMetricsTrend(window, "hour")])
      .then(([metricsData, trendData]) => {
        if (!ignore) {
          setMetrics(metricsData);
          setTrend(trendData);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to load metrics or trend:", err);
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [window]);

  const handleExportJSON = () => {
    if (!metrics) return;
    const blob = new Blob([JSON.stringify(metrics, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `metrics-summary-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    if (!metrics) return;
    let csv = "Category,Metric,Value\n";
    csv += `Overview,Window,${metrics.window}\n`;
    csv += `Overview,Amount At Risk,${metrics.amountAtRisk}\n`;
    csv += `Overview,Amount Recovered,${metrics.amountRecovered}\n`;
    csv += `Overview,Recovery Rate %,${metrics.recoveryRate}\n`;
    csv += `Overview,Events Processed,${metrics.eventsProcessed}\n\n`;

    csv += "Cause,At Risk,Recovered,Recovery Rate %\n";
    metrics.byCause.forEach((c) => {
      const rate = c.atRisk > 0 ? ((c.recovered / c.atRisk) * 100).toFixed(1) : "0";
      csv += `"${c.cause}",${c.atRisk},${c.recovered},${rate}%\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `metrics-summary-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sortedCauses = metrics?.byCause ? [...metrics.byCause].sort((a, b) => {
    const rateA = a.atRisk > 0 ? a.recovered / a.atRisk : 0;
    const rateB = b.atRisk > 0 ? b.recovered / b.atRisk : 0;
    if (causeSort === "rate_desc") return rateB - rateA;
    if (causeSort === "count_desc") return b.atRisk - a.atRisk;
    if (causeSort === "recovered_desc") return b.recovered - a.recovered;
    return 0;
  }) : [];

  const maxTrendEvents = Math.max(1, ...trend.map((t) => t.eventsProcessed));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics & Performance Metrics</h1>
          <p className="text-sm text-slate-400">
            Deep recovery efficiency and financial unit economics over the live event stream.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <WindowSelector value={window} onChange={setWindow} />
          <button
            onClick={handleExportJSON}
            className="bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-3 py-2 rounded border border-slate-300 transition-colors"
          >
            Export JSON
          </button>
          <button
            onClick={handleExportCSV}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-2 rounded transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500">
          Loading metrics analysis...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stream Throughput Trend */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="text-md font-semibold text-slate-900 mb-1">Stream Throughput Trend</h3>
            <p className="text-xs text-slate-400 mb-4">
              Events processed per hour across the live stream (recovered amount in ₹)
            </p>

            {trend.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No events in this window yet.</p>
            ) : (
              <div className="space-y-1">
                {trend.map((point) => (
                  <div key={point.bucketStart} className="flex items-center gap-3 text-xs">
                    <span className="w-36 shrink-0 font-mono text-slate-500">
                      {new Date(point.bucketStart).toLocaleString("en-IN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="flex-1 bg-slate-100 rounded overflow-hidden h-4">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${(point.eventsProcessed / maxTrendEvents) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-slate-700">{point.eventsProcessed}</span>
                    <span className="w-28 text-right font-mono text-emerald-700">
                      ₹{point.amountRecovered.toLocaleString("en-IN", { maximumFractionDigits: 0 })} rec.
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recovery Rate by Cause Table */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-semibold text-slate-900">Recovery Performance by Failure Cause</h3>
              <select
                value={causeSort}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setCauseSort(e.target.value as "rate_desc" | "count_desc" | "recovered_desc")
                }
                className="bg-slate-50 border border-slate-300 text-xs text-slate-700 rounded px-2.5 py-1"
              >
                <option value="rate_desc">Sort by Recovery Rate ↓</option>
                <option value="count_desc">Sort by Volume ↓</option>
                <option value="recovered_desc">Sort by Amount Recovered ↓</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 border-b border-slate-200">
                    <th className="p-3 font-medium">Failure Cause</th>
                    <th className="p-3 font-medium">At Risk (₹)</th>
                    <th className="p-3 font-medium">Recovered (₹)</th>
                    <th className="p-3 font-medium">Recovery Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {sortedCauses.map((c) => {
                    const rate = c.atRisk > 0 ? (c.recovered / c.atRisk) * 100 : 0;
                    return (
                      <tr key={c.cause} className="hover:bg-slate-100/40">
                        <td className="p-3 font-semibold text-slate-900">{c.cause}</td>
                        <td className="p-3 font-mono text-amber-700">
                          ₹{c.atRisk.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 font-mono text-emerald-700">
                          ₹{c.recovered.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 font-mono font-bold">
                          <span className={rate > 50 ? "text-emerald-700" : rate > 20 ? "text-amber-700" : "text-slate-400"}>
                            {rate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Channel Cost-per-Recovery Unit Economics */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="text-md font-semibold text-slate-900 mb-1">Channel Cost-Per-Recovery Unit Economics</h3>
            <p className="text-xs text-slate-400 mb-4">
              Estimated communication channel costs vs revenue yield (computed via presentation overlay model)
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 border-b border-slate-200">
                    <th className="p-3 font-medium">Channel</th>
                    <th className="p-3 font-medium">Unit Cost / Event</th>
                    <th className="p-3 font-medium">Total Events</th>
                    <th className="p-3 font-medium">Recovered Amount (₹)</th>
                    <th className="p-3 font-medium">Est. Total Cost</th>
                    <th className="p-3 font-medium">Cost per Event</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {metrics?.byChannel?.map((ch) => {
                    const unitCost = CHANNEL_COST_MAP[ch.channel.toLowerCase()] || CHANNEL_COST_MAP.default;
                    const totalCost = ch.count * unitCost;
                    const costPerEvent = ch.count > 0 ? totalCost / ch.count : 0;
                    return (
                      <tr key={ch.channel} className="hover:bg-slate-100/40">
                        <td className="p-3 font-semibold text-slate-900 uppercase font-mono">{ch.channel}</td>
                        <td className="p-3 font-mono text-slate-400">₹{unitCost.toFixed(2)}</td>
                        <td className="p-3 font-mono text-slate-700">{ch.count}</td>
                        <td className="p-3 font-mono text-emerald-700 font-semibold">
                          ₹{ch.recoveredAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 font-mono text-amber-700">₹{totalCost.toFixed(2)}</td>
                        <td className="p-3 font-mono font-bold text-blue-700">
                          ₹{costPerEvent.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Time to Recovery — Median Latency (from backend) */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="text-md font-semibold text-slate-900 mb-1">Time-to-Recovery Latency</h3>
            <p className="text-xs text-slate-400 mb-4">Median elapsed time between failure detection and recovery resolution</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-50 p-4 rounded border border-slate-200">
                <span className="text-xs text-slate-400 block mb-1">Median Time to Recovery</span>
                <span className="text-xl font-bold font-mono text-emerald-700">
                  {metrics?.amountRecovered && metrics.amountRecovered > 0 && metrics?.medianTimeToRecoveryHours != null
                    ? `${metrics.medianTimeToRecoveryHours < 0.01 ? "< 0.01" : metrics.medianTimeToRecoveryHours.toFixed(2)} hrs`
                    : "N/A"}
                </span>
              </div>
              <div className="bg-slate-50 p-4 rounded border border-slate-200">
                <span className="text-xs text-slate-400 block mb-1">Events Processed</span>
                <span className="text-xl font-bold font-mono text-blue-700">
                  {metrics?.eventsProcessed ?? 0}
                </span>
              </div>
              <div className="bg-slate-50 p-4 rounded border border-slate-200">
                <span className="text-xs text-slate-400 block mb-1">Overall Recovery Rate</span>
                <span className="text-xl font-bold font-mono text-amber-700">
                  {metrics ? (metrics.recoveryRate * 100).toFixed(1) : "0.0"}%
                </span>
              </div>
            </div>
          </div>

          {/* Cross-Entity Natural Language Audit Query Assistant */}
          <div className="mt-6">
            <AuditQueryPanel
              title="System-Wide Audit Intelligence"
              description="Ask natural-language questions across historical decisions, recovery patterns, and policy compliance."
            />
          </div>
        </div>
      )}
    </div>
  );
}
