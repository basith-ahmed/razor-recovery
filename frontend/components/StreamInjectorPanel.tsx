"use client";

import { useState } from "react";
import { injectStream } from "../lib/api";
import { useLiveStream } from "../lib/socket";

/**
 * Demo Tools panel — stands in for the real production event sources
 * (payment gateway, checkout service, invoicing system) that publish events
 * to revenue.events.raw in production. Not part of the core product.
 */
export function StreamInjectorPanel() {
  const [count, setCount] = useState(10);
  const [rate, setRate] = useState(2); // events per second
  const [mix, setMix] = useState({
    paymentFailed: 0.4,
    checkoutAbandoned: 0.3,
    invoiceOverdue: 0.2,
    subscriptionFailed: 0.1,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const { injectionProgress } = useLiveStream();

  const handleInject = async () => {
    setLoading(true);
    setError(null);
    try {
      const intervalMs = rate > 0 ? Math.round(1000 / rate) : undefined;
      const res = await injectStream({ count, intervalMs, mix });
      setActiveRunId(res.runId);
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? String((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? "Failed to start stream injection")
          : "Failed to start stream injection";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const setMixValue = (key: keyof typeof mix, value: number) => {
    setMix((prev) => ({ ...prev, [key]: value }));
  };

  const progressForActiveRun =
    activeRunId && injectionProgress?.runId === activeRunId ? injectionProgress : null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-5 mb-6">
      <div className="mb-3">
        <h3 className="text-md font-semibold text-slate-900">Demo Tools — Stream Injector</h3>
        <p className="text-xs text-slate-500">
          Stands in for real production event sources (payment gateway, checkout,
          invoicing). Publishes synthetic events onto the same live pipeline topic.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 text-slate-900">
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">Event Count</span>
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value, 10))}
            className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">Injection Rate (events/sec)</span>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(mix) as Array<keyof typeof mix>).map((key) => (
            <label key={key} className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1 capitalize">
                {key.replace(/([A-Z])/g, " $1").toLowerCase()}
              </span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={mix[key]}
                onChange={(e) => setMixValue(key, parseFloat(e.target.value) || 0)}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs"
              />
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={handleInject}
        disabled={loading || count < 1}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded"
      >
        {loading ? "Starting..." : "Start Injecting"}
      </button>

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}

      {progressForActiveRun && (
        <p className="mt-3 text-xs font-mono text-slate-700">
          Injecting: {progressForActiveRun.sent} of {progressForActiveRun.total} sent
          (run {activeRunId!.slice(0, 8)})
        </p>
      )}
    </div>
  );
}
