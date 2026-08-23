"use client";

import { useState, useEffect } from "react";
import { getMetricsSummary, listBatches } from "../../lib/api";
import { MetricsSummary, BatchItem } from "../../types";

const CHANNEL_COST_MAP: Record<string, number> = {
  email: 0.5,
  sms: 1.5,
  whatsapp: 2.0,
  discount: 50.0,
  human: 200.0,
  razorpay_link: 1.0,
  default: 1.0,
};

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [causeSort, setCauseSort] = useState<"rate_desc" | "count_desc" | "recovered_desc">("rate_desc");

  useEffect(() => {
    let ignore = false;
    Promise.all([getMetricsSummary(), listBatches()])
      .then(([metricsData, batchesData]) => {
        if (!ignore) {
          setMetrics(metricsData);
          setBatches(batchesData);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to load metrics or batches:", err);
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

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
    csv += `Overview,Amount At Risk,${metrics.amountAtRisk}\n`;
    csv += `Overview,Amount Recovered,${metrics.amountRecovered}\n`;
    csv += `Overview,Recovery Rate %,${metrics.recoveryRate}\n`;
    csv += `Overview,Events Processed,${metrics.eventsProcessed}\n`;
    csv += `Overview,Events Total,${metrics.eventsTotal}\n\n`;

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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics & Performance Metrics</h1>
          <p className="text-sm text-slate-400">
            Deep recovery efficiency, financial unit economics, and past batch performance audit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportJSON}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded border border-slate-700 transition-colors"
          >
            Export JSON 📥
          </button>
          <button
            onClick={handleExportCSV}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-2 rounded transition-colors"
          >
            Export CSV 📥
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center text-slate-500">
          Loading metrics analysis...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Recovery Rate by Cause Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-semibold text-white">Recovery Performance by Failure Cause</h3>
              <select
                value={causeSort}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setCauseSort(e.target.value as "rate_desc" | "count_desc" | "recovered_desc")
                }
                className="bg-slate-950 border border-slate-700 text-xs text-slate-300 rounded px-2.5 py-1"
              >
                <option value="rate_desc">Sort by Recovery Rate ↓</option>
                <option value="count_desc">Sort by Volume ↓</option>
                <option value="recovered_desc">Sort by Amount Recovered ↓</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <th className="p-3 font-medium">Failure Cause</th>
                    <th className="p-3 font-medium">At Risk (₹)</th>
                    <th className="p-3 font-medium">Recovered (₹)</th>
                    <th className="p-3 font-medium">Recovery Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sortedCauses.map((c) => {
                    const rate = c.atRisk > 0 ? (c.recovered / c.atRisk) * 100 : 0;
                    return (
                      <tr key={c.cause} className="hover:bg-slate-800/40">
                        <td className="p-3 font-semibold text-white">{c.cause}</td>
                        <td className="p-3 font-mono text-amber-400">
                          ₹{c.atRisk.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 font-mono text-emerald-400">
                          ₹{c.recovered.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 font-mono font-bold">
                          <span className={rate > 50 ? "text-emerald-400" : rate > 20 ? "text-amber-400" : "text-slate-400"}>
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
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <h3 className="text-md font-semibold text-white mb-1">Channel Cost-Per-Recovery Unit Economics</h3>
            <p className="text-xs text-slate-400 mb-4">
              Estimated communication channel costs vs revenue yield (computed via presentation overlay model)
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <th className="p-3 font-medium">Channel</th>
                    <th className="p-3 font-medium">Unit Cost / Event</th>
                    <th className="p-3 font-medium">Total Events</th>
                    <th className="p-3 font-medium">Recovered Amount (₹)</th>
                    <th className="p-3 font-medium">Est. Total Cost</th>
                    <th className="p-3 font-medium">Cost per Event</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {metrics?.byChannel?.map((ch) => {
                    const unitCost = CHANNEL_COST_MAP[ch.channel.toLowerCase()] || CHANNEL_COST_MAP.default;
                    const totalCost = ch.count * unitCost;
                    const costPerEvent = ch.count > 0 ? totalCost / ch.count : 0;
                    return (
                      <tr key={ch.channel} className="hover:bg-slate-800/40">
                        <td className="p-3 font-semibold text-white uppercase font-mono">{ch.channel}</td>
                        <td className="p-3 font-mono text-slate-400">₹{unitCost.toFixed(2)}</td>
                        <td className="p-3 font-mono text-slate-300">{ch.count}</td>
                        <td className="p-3 font-mono text-emerald-400 font-semibold">
                          ₹{ch.recoveredAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 font-mono text-amber-400">₹{totalCost.toFixed(2)}</td>
                        <td className="p-3 font-mono font-bold text-blue-400">
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
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <h3 className="text-md font-semibold text-white mb-1">Time-to-Recovery Latency</h3>
            <p className="text-xs text-slate-400 mb-4">Median elapsed time between failure detection and recovery resolution</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-950 p-4 rounded border border-slate-800">
                <span className="text-xs text-slate-400 block mb-1">Median Time to Recovery</span>
                <span className="text-xl font-bold font-mono text-emerald-400">
                  {metrics?.medianTimeToRecoveryHours != null
                    ? `${metrics.medianTimeToRecoveryHours.toFixed(2)} hrs`
                    : "N/A"}
                </span>
              </div>
              <div className="bg-slate-950 p-4 rounded border border-slate-800">
                <span className="text-xs text-slate-400 block mb-1">Events Processed</span>
                <span className="text-xl font-bold font-mono text-blue-400">
                  {metrics?.eventsProcessed ?? 0}
                  <span className="text-slate-500 text-sm font-normal"> / {metrics?.eventsTotal ?? 0}</span>
                </span>
              </div>
              <div className="bg-slate-950 p-4 rounded border border-slate-800">
                <span className="text-xs text-slate-400 block mb-1">Overall Recovery Rate</span>
                <span className="text-xl font-bold font-mono text-amber-400">
                  {metrics ? (metrics.recoveryRate * 100).toFixed(1) : "0.0"}%
                </span>
              </div>
            </div>
          </div>

          {/* Past Batches Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <h3 className="text-md font-semibold text-white mb-1">Past Batch Simulation Audit</h3>
            <p className="text-xs text-slate-400 mb-4">Historical record of triggered batch runs</p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <th className="p-3 font-medium">Batch ID</th>
                    <th className="p-3 font-medium">Events</th>
                    <th className="p-3 font-medium">Created At</th>
                    <th className="p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {batches.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-slate-500">
                        No past batches found.
                      </td>
                    </tr>
                  ) : (
                    batches.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-800/40">
                        <td className="p-3 font-mono font-semibold text-blue-400">{b.id}</td>
                        <td className="p-3 font-mono text-slate-300">{b.eventCount}</td>
                        <td className="p-3 font-mono text-slate-400">
                          {new Date(b.createdAt).toLocaleString("en-IN")}
                        </td>
                        <td className="p-3 font-mono text-slate-400">
                          {b.status}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
