"use client";

import { StreamInjectorPanel } from "../../components/StreamInjectorPanel";
import { LiveActivityFeed } from "../../components/LiveActivityFeed";
import { useLiveStream } from "../../lib/socket";

export default function DemoPage() {
  const { activityFeed } = useLiveStream();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Demo Simulator</h1>
        <p className="text-sm text-slate-400">
          Inject a paced stream of synthetic events to test and demonstrate autonomous recovery workflows in real-time.
        </p>
      </div>

      <StreamInjectorPanel />

      <LiveActivityFeed items={activityFeed} />
    </div>
  );
}
