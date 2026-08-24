"use client";

import { useState, useEffect } from "react";
import { useLiveStream } from "../lib/socket";
import { getMetricsSummary } from "../lib/api";
import { MetricsSummary, MetricsWindow } from "../types";
import { StreamInjectorPanel } from "../components/StreamInjectorPanel";
import { WindowSelector } from "../components/WindowSelector";
import { IncomingEventFeed } from "../components/IncomingEventFeed";
import { HeroMetrics } from "../components/HeroMetrics";
import { LiveActivityFeed } from "../components/LiveActivityFeed";
import { FunnelChart } from "../components/FunnelChart";
import { CauseChannelCharts } from "../components/CauseChannelCharts";
import { ComplianceStrip } from "../components/ComplianceStrip";

export default function OverviewPage() {
  const [window, setWindow] = useState<MetricsWindow>("24h");
  const [initialMetrics, setInitialMetrics] = useState<MetricsSummary | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // Live global channel: activity feed always shows the latest events,
  // regardless of the selected metrics window.
  const { activityFeed, incomingEvents, metrics: socketMetrics } = useLiveStream();

  // Fetch windowed summary on mount and whenever the window changes
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

  // Prefer live WS updates only when they match the selected window
  const effectiveMetrics =
    socketMetrics?.window === window ? socketMetrics : initialMetrics;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Overview & Operations Center</h1>
          <p className="text-sm text-slate-400">
            Monitor real-time revenue failure detection, AI diagnosis, and autonomous dunning workflows.
          </p>
        </div>
        <WindowSelector value={window} onChange={setWindow} />
      </div>

      <StreamInjectorPanel />

      <IncomingEventFeed items={incomingEvents} />

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
