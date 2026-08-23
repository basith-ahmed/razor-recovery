"use client";

import { useState } from "react";
import { BatchControlPanel } from "../../components/BatchControlPanel";
import { LiveActivityFeed } from "../../components/LiveActivityFeed";
import { useLiveBatch } from "../../lib/socket";

export default function DemoPage() {
  const [activeBatchId, setActiveBatchId] = useState<string | undefined>(undefined);
  const { activityFeed } = useLiveBatch(activeBatchId);

  const handleBatchRun = (batchId: string) => {
    setActiveBatchId(batchId);
  };

  const handleReset = () => {
    setActiveBatchId(undefined);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Demo Simulator</h1>
        <p className="text-sm text-slate-400">
          Trigger synthetic event batches to test and demonstrate autonomous recovery workflows in real-time.
        </p>
      </div>

      <BatchControlPanel
        onBatchRun={handleBatchRun}
        onReset={handleReset}
        activeBatchId={activeBatchId}
      />

      <LiveActivityFeed items={activityFeed} />
    </div>
  );
}
