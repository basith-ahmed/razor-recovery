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
      <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
        <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1.5">Amount At Risk</p>
        <div className="text-2xl font-bold text-accent-orange tracking-heading-3">
          ₹{amountAtRisk.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <p className="text-xs text-ink-muted mt-1.5">Total revenue value flagged</p>
      </div>

      <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
        <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1.5">Amount Recovered</p>
        <div className="text-2xl font-bold text-accent-green tracking-heading-3">
          ₹{amountRecovered.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <p className="text-xs text-ink-muted mt-1.5">Successfully rescued funds</p>
      </div>

      <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
        <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1.5">Recovery Rate</p>
        <div className="text-2xl font-bold text-primary tracking-heading-3">
          {recoveryRate.toFixed(1)}%
        </div>
        <p className="text-xs text-ink-muted mt-1.5">Conversion efficiency</p>
      </div>

      <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
        <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1.5">Events Processed</p>
        <div className="text-2xl font-bold text-accent-purple-deep tracking-heading-3">
          {eventsProcessed.toLocaleString("en-IN")}
        </div>
        <p className="text-xs text-ink-muted mt-1.5">Audit pipeline throughput</p>
      </div>
    </div>
  );
}
