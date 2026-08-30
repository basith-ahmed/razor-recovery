"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { useLiveStream } from "../lib/socket";
import { getMetricsSummary } from "../lib/api";

interface NavProps {
  onMenuToggle: () => void;
}

export function Nav({ onMenuToggle }: NavProps) {
  const { isConnected, metrics: socketMetrics } = useLiveStream();
  const [initialMetrics, setInitialMetrics] = useState<{ amountRecovered: number } | null>(null);

  useEffect(() => {
    getMetricsSummary("all")
      .then((data) => setInitialMetrics(data))
      .catch((err) => console.error("Nav failed to fetch initial metrics:", err));
  }, []);

  const recoveredAmount = socketMetrics?.amountRecovered ?? initialMetrics?.amountRecovered ?? 0;

  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-4">
      {/* Mobile menu toggle */}
      <button
        type="button"
        onClick={onMenuToggle}
        className="lg:hidden p-1.5 rounded text-slate-500 hover:bg-slate-100"
        aria-label="Toggle navigation"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Logo */}
      <Link
        href="/"
        className="font-bold text-lg tracking-tight text-slate-900 flex items-center shrink-0"
      >
        <span className="text-blue-600">
          Razor
        </span>
        <span>Recovery</span>
      </Link>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Recovered amount */}
      <div className="hidden sm:flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded text-xs font-mono font-semibold">
        <span className="text-emerald-500 text-[10px] uppercase tracking-wider">
          Recovered
        </span>
        <span>
          ₹
          {recoveredAmount.toLocaleString("en-IN", {
            maximumFractionDigits: 2,
          })}
        </span>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded text-xs font-medium">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isConnected ? "bg-emerald-500" : "bg-slate-400"
          }`}
        />
        <span
          className={
            isConnected ? "text-emerald-700 font-semibold" : "text-slate-500"
          }
        >
          {isConnected ? "Live" : "Connecting"}
        </span>
      </div>
    </header>
  );
}
