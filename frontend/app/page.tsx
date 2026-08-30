"use client";

import { useState, useEffect } from "react";
import { useLiveStream } from "../lib/socket";
import { getMetricsSummary } from "../lib/api";
import { MetricsSummary, MetricsWindow } from "../types";
import { WindowSelector } from "../components/WindowSelector";
import { IncomingEventFeed } from "../components/IncomingEventFeed";
import { HeroMetrics } from "../components/HeroMetrics";
import { LiveActivityFeed } from "../components/LiveActivityFeed";
import { FunnelChart } from "../components/FunnelChart";
import { CauseChannelCharts } from "../components/CauseChannelCharts";
import { ComplianceStrip } from "../components/ComplianceStrip";
import { PageHeader } from "../components/PageHeader";

export default function OverviewPage() {
  const [window, setWindow] = useState<MetricsWindow>("24h");
  const [initialMetrics, setInitialMetrics] = useState<MetricsSummary | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const { activityFeed, incomingEvents, metrics: socketMetrics } = useLiveStream();

  useEffect(() => {
    let ignore = false;
    getMetricsSummary(window)
      .then((data) => {
        if (!ignore) {
          setInitialMetrics(data);
          setInitialLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to load initial metrics summary:", err);
          setInitialLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [window]);

  const effectiveMetrics =
    socketMetrics?.window === window ? socketMetrics : initialMetrics;

  return (
    <div>
      {/* Page header with window selector as action */}
      <PageHeader
        title="Overview & Operations Center"
        description="Monitor real-time revenue failure detection, AI diagnosis, and autonomous dunning workflows."
        actions={<WindowSelector value={window} onChange={setWindow} />}
      />

      {/* Row 1: Key metrics — always full width, highest priority */}
      <HeroMetrics metrics={effectiveMetrics} />

      {/* Row 2: Live feeds — side by side so operators see both streams simultaneously */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <IncomingEventFeed items={incomingEvents} />
        <LiveActivityFeed items={activityFeed} />
      </div>

      {/* Row 3: Conversion funnel (2/3) + Compliance guardrails (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2">
          <FunnelChart data={effectiveMetrics?.funnel} />
        </div>
        <div className="lg:col-span-1">
          <ComplianceStrip compliance={effectiveMetrics?.compliance} />
        </div>
      </div>

      {/* Row 4: Cause & channel breakdown — already a 2-col grid internally */}
      <CauseChannelCharts
        byCause={effectiveMetrics?.byCause}
        byChannel={effectiveMetrics?.byChannel}
      />
    </div>
  );
}
