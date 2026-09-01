"use client";

import { useState, useEffect } from "react";
import { getMetricsSummary, getMetricsTrend } from "../../lib/api";
import { MetricsSummary, MetricsWindow, TrendPoint } from "../../types";
import { WindowSelector } from "../../components/WindowSelector";
import { PageHeader } from "../../components/PageHeader";

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
    csv += `Overview,Amount Written Off,${metrics.amountWrittenOff}\n`;
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
    <div className="pb-8">
      <PageHeader
        title="Analytics & Performance Metrics"
        description="Deep recovery efficiency and financial unit economics over the live event stream."
        actions={
          <div className="flex items-center gap-2">
            <WindowSelector value={window} onChange={setWindow} />
            <button
              onClick={handleExportJSON}
              className="bg-white hover:bg-canvas-soft text-ink text-xs font-medium px-3.5 py-1.5 rounded-[8px] border border-hairline shadow-xs transition-colors"
            >
              Export JSON
            </button>
            <button
              onClick={handleExportCSV}
              className="bg-primary hover:bg-primary-active active:scale-[0.98] text-white text-xs font-medium px-4 py-1.5 rounded-full transition-all shadow-sm"
            >
              Export CSV
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="bg-white border border-hairline rounded-[12px] p-8 text-center text-ink-muted text-sm shadow-notion-soft">
          Loading metrics analysis...
        </div>
      ) : (
        <div className="space-y-5">

          {/* Row 1: Key summary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
              <span className="text-xs text-ink-muted block mb-1 font-medium">Median Time to Recovery</span>
              <span className="text-2xl font-bold text-accent-green tracking-heading-3">
                {metrics?.amountRecovered && metrics.amountRecovered > 0 && metrics?.medianTimeToRecoveryHours != null
                  ? `${metrics.medianTimeToRecoveryHours < 0.01 ? "< 0.01" : metrics.medianTimeToRecoveryHours.toFixed(2)} hrs`
                  : "N/A"}
              </span>
            </div>
            <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
              <span className="text-xs text-ink-muted block mb-1 font-medium">Events Processed</span>
              <span className="text-2xl font-bold text-ink tracking-heading-3">
                {metrics?.eventsProcessed ?? 0}
              </span>
            </div>
            <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
              <span className="text-xs text-ink-muted block mb-1 font-medium">Overall Recovery Rate</span>
              <span className="text-2xl font-bold text-accent-orange tracking-heading-3">
                {metrics ? (metrics.recoveryRate * 100).toFixed(1) : "0.0"}%
              </span>
            </div>
            <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
              <span className="text-xs text-ink-muted block mb-1 font-medium">Amount Written Off</span>
              <span className="text-2xl font-bold text-ink tracking-heading-3">
                ₹{(metrics?.amountWrittenOff ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Row 2: Trend chart — full width */}
          <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
            <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-0.5">Stream Throughput Trend</h3>
            <p className="text-xs text-ink-muted mb-4">
              Events processed per hour across the live stream (recovered amount in ₹)
            </p>

            {trend.length === 0 ? (
              <p className="text-xs text-ink-muted py-4 text-center">No events in this window yet.</p>
            ) : (
              <div className="space-y-1.5">
                {trend.map((point) => (
                  <div key={point.bucketStart} className="flex items-center gap-3 text-xs">
                    <span className="w-36 shrink-0 text-ink-muted text-[11px]">
                      {new Date(point.bucketStart).toLocaleString("en-IN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="flex-1 bg-canvas-soft border border-hairline rounded-full overflow-hidden h-3.5">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${(point.eventsProcessed / maxTrendEvents) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-ink font-semibold">{point.eventsProcessed}</span>
                    <span className="w-28 text-right text-accent-green font-semibold">
                      ₹{point.amountRecovered.toLocaleString("en-IN", { maximumFractionDigits: 0 })} rec.
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Row 3: Recovery by cause — full width */}
          <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px]">Recovery Performance by Failure Cause</h3>
                <p className="text-xs text-ink-muted mt-0.5">Comparative recovery success rates across identified root causes</p>
              </div>
              <select
                value={causeSort}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setCauseSort(e.target.value as "rate_desc" | "count_desc" | "recovered_desc")
                }
                className="bg-white border border-hairline-input text-xs text-ink rounded-[4px] px-2.5 py-1 focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
              >
                <option value="rate_desc">Sort by Recovery Rate ↓</option>
                <option value="count_desc">Sort by Volume ↓</option>
                <option value="recovered_desc">Sort by Amount Recovered ↓</option>
              </select>
            </div>

            <div className="overflow-x-auto border border-hairline rounded-[8px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-canvas-soft text-ink-muted border-b border-hairline text-[11px] font-semibold uppercase tracking-eyebrow">
                    <th className="p-3">Failure Cause</th>
                    <th className="p-3">At Risk (₹)</th>
                    <th className="p-3">Recovered (₹)</th>
                    <th className="p-3">Recovery Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline bg-white">
                  {sortedCauses.map((c) => {
                    const rate = c.atRisk > 0 ? (c.recovered / c.atRisk) * 100 : 0;
                    return (
                      <tr key={c.cause} className="hover:bg-canvas-soft transition-colors">
                        <td className="p-3 font-semibold text-ink">{c.cause}</td>
                        <td className="p-3 text-ink">
                          ₹{c.atRisk.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-accent-green font-semibold">
                          ₹{c.recovered.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 font-bold">
                          <span className={rate > 50 ? "text-accent-green" : rate > 20 ? "text-accent-orange" : "text-ink-muted"}>
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

          {/* Row 4: Channel economics — full width */}
          <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
            <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-0.5">Channel Cost-Per-Recovery Unit Economics</h3>
            <p className="text-xs text-ink-muted mb-4">
              Estimated communication channel costs vs revenue yield (computed via presentation overlay model)
            </p>

            <div className="overflow-x-auto border border-hairline rounded-[8px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-canvas-soft text-ink-muted border-b border-hairline text-[11px] font-semibold uppercase tracking-eyebrow">
                    <th className="p-3">Channel</th>
                    <th className="p-3">Unit Cost / Event</th>
                    <th className="p-3">Total Events</th>
                    <th className="p-3">Recovered Amount (₹)</th>
                    <th className="p-3">Est. Total Cost</th>
                    <th className="p-3">Cost per Event</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline bg-white">
                  {metrics?.byChannel?.map((ch) => {
                    const unitCost = CHANNEL_COST_MAP[ch.channel.toLowerCase()] || CHANNEL_COST_MAP.default;
                    const totalCost = ch.count * unitCost;
                    const costPerEvent = ch.count > 0 ? totalCost / ch.count : 0;
                    return (
                      <tr key={ch.channel} className="hover:bg-canvas-soft transition-colors">
                        <td className="p-3 font-semibold text-ink uppercase">{ch.channel}</td>
                        <td className="p-3 text-ink-muted">₹{unitCost.toFixed(2)}</td>
                        <td className="p-3 text-ink">{ch.count}</td>
                        <td className="p-3 text-accent-green font-semibold">
                          ₹{ch.recoveredAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-ink-secondary">₹{totalCost.toFixed(2)}</td>
                        <td className="p-3 font-bold text-primary">
                          ₹{costPerEvent.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
