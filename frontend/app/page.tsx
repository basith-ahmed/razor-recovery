"use client";

import { useState, useEffect } from "react";
import { useLiveBatch } from "../lib/socket";
import { getMetricsSummary } from "../lib/api";
import { MetricsSummary } from "../types";
import { BatchControlPanel } from "../components/BatchControlPanel";
import { HeroMetrics } from "../components/HeroMetrics";
import { LiveActivityFeed } from "../components/LiveActivityFeed";
import { FunnelChart } from "../components/FunnelChart";
import { CauseChannelCharts } from "../components/CauseChannelCharts";
import { ComplianceStrip } from "../components/ComplianceStrip";

export default function OverviewPage() {
  const [activeBatchId, setActiveBatchId] = useState<string | undefined>(undefined);
  const [initialMetrics, setInitialMetrics] = useState<MetricsSummary | null>(null);

  const { activityFeed, metrics: socketMetrics } = useLiveBatch(activeBatchId);

  // Fetch initial summary on mount
  useEffect(() => {
    getMetricsSummary(activeBatchId)
      .then((data) => setInitialMetrics(data))
      .catch((err) => console.error("Failed to load initial metrics summary:", err));
  }, [activeBatchId]);

  const effectiveMetrics = socketMetrics || initialMetrics;

  const handleBatchRun = (batchId: string) => {
    setActiveBatchId(batchId);
  };

  const handleReset = () => {
    setActiveBatchId(undefined);
    getMetricsSummary()
      .then((data) => setInitialMetrics(data))
      .catch((err) => console.error("Failed to reset metrics:", err));
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Overview & Operations Center</h1>
        <p className="text-sm text-slate-400">
          Monitor real-time revenue failure detection, AI diagnosis, and autonomous dunning workflows.
        </p>
      </div>

      <BatchControlPanel
        onBatchRun={handleBatchRun}
        onReset={handleReset}
        activeBatchId={activeBatchId}
      />

      <HeroMetrics metrics={effectiveMetrics} />

      <LiveActivityFeed items={activityFeed} />

      <FunnelChart data={effectiveMetrics?.funnel} />

      <CauseChannelCharts
        byCause={effectiveMetrics?.byCause}
        byChannel={effectiveMetrics?.byChannel}
      />

      <ComplianceStrip compliance={effectiveMetrics?.compliance} />
    </div>
  );
}
