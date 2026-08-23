"use client";

import { useState } from "react";
import { runBatch } from "../lib/api";

interface BatchControlPanelProps {
  onBatchRun: (batchId: string) => void;
  onReset: () => void;
  activeBatchId?: string | null;
}

export function BatchControlPanel({ onBatchRun, onReset, activeBatchId }: BatchControlPanelProps) {
  const [size, setSize] = useState<number>(10);
  const [paymentFailed, setPaymentFailed] = useState<number>(0.4);
  const [checkoutAbandoned, setCheckoutAbandoned] = useState<number>(0.3);
  const [invoiceOverdue, setInvoiceOverdue] = useState<number>(0.2);
  const [subscriptionFailed, setSubscriptionFailed] = useState<number>(0.1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const sum = paymentFailed + checkoutAbandoned + invoiceOverdue + subscriptionFailed;
      if (Math.abs(sum - 1.0) > 0.01) {
        setError(`Mix proportions must sum to 1.0 (current sum: ${sum.toFixed(2)})`);
        setLoading(false);
        return;
      }

      const res = await runBatch({
        size,
        mix: {
          paymentFailed,
          checkoutAbandoned,
          invoiceOverdue,
          subscriptionFailed,
        },
      });

      if (res.batchId) {
        onBatchRun(res.batchId);
      }
    } catch (err: unknown) {
      let msg = "Failed to run batch";
      if (err && typeof err === "object" && "response" in err) {
        const resp = (err as { response?: { data?: { error?: string } } }).response;
        if (resp?.data?.error) {
          msg = resp.data.error;
        } else if ("message" in err && typeof (err as { message: string }).message === "string") {
          msg = (err as { message: string }).message;
        }
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Batch Simulation Control</h2>
          <p className="text-xs text-slate-400">Configure event mix and trigger an autonomous recovery batch run</p>
        </div>
        {activeBatchId && (
          <div className="text-xs font-mono bg-blue-50 border border-blue-200 text-blue-800 px-3 py-1 rounded-md">
            Active Batch: {activeBatchId}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-xs p-3 rounded-md">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Batch Size</label>
          <input
            type="number"
            min={1}
            max={500}
            value={size}
            onChange={(e) => setSize(parseInt(e.target.value, 10) || 1)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Payment Failed</label>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={paymentFailed}
            onChange={(e) => setPaymentFailed(parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Checkout Abandoned</label>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={checkoutAbandoned}
            onChange={(e) => setCheckoutAbandoned(parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Invoice Overdue</label>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={invoiceOverdue}
            onChange={(e) => setInvoiceOverdue(parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Sub Renew Failed</label>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={subscriptionFailed}
            onChange={(e) => setSubscriptionFailed(parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm py-1.5 px-4 rounded transition-colors disabled:opacity-50"
          >
            {loading ? "Running..." : "Run Batch"}
          </button>
          <button
            type="button"
            onClick={() => {
              onReset();
              setError(null);
            }}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm py-1.5 px-3 rounded transition-colors"
          >
            Reset
          </button>
        </div>
      </form>
    </div>
  );
}
