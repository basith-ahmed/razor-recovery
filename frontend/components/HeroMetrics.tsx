"use client";

import { MetricsSummary } from "../types";

interface HeroMetricsProps {
  metrics: MetricsSummary | null;
}

export function HeroMetrics({ metrics }: HeroMetricsProps) {
  const amountAtRisk = metrics?.amountAtRisk ?? 0;
  const amountRecovered = metrics?.amountRecovered ?? 0;
  const recoveryRate = (metrics?.recoveryRate ?? 0) * 100;
  const eventsProcessed = metrics?.eventsProcessed ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div className="bg-white border border-slate-200 rounded p-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Amount At Risk</p>
        <div className="text-2xl font-bold font-mono text-amber-700">
          ₹{amountAtRisk.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <p className="text-xs text-slate-400 mt-1">Total revenue value flagged</p>
      </div>

      <div className="bg-white border border-slate-200 rounded p-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Amount Recovered</p>
        <div className="text-2xl font-bold font-mono text-emerald-700">
          ₹{amountRecovered.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <p className="text-xs text-slate-400 mt-1">Successfully rescued funds</p>
      </div>

      <div className="bg-white border border-slate-200 rounded p-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Recovery Rate</p>
        <div className="text-2xl font-bold font-mono text-blue-700">
          {recoveryRate.toFixed(1)}%
        </div>
        <p className="text-xs text-slate-400 mt-1">Conversion efficiency</p>
      </div>

      <div className="bg-white border border-slate-200 rounded p-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Events Processed</p>
        <div className="text-2xl font-bold font-mono text-purple-700">
          {eventsProcessed.toLocaleString("en-IN")}
        </div>
        <p className="text-xs text-slate-400 mt-1">Audit pipeline throughput</p>
      </div>
    </div>
  );
}
