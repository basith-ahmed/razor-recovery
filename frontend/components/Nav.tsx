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
    <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-white border-b border-hairline flex items-center px-4 sm:px-6 gap-4">
      {/* Mobile menu toggle */}
      <button
        type="button"
        onClick={onMenuToggle}
        className="lg:hidden p-1.5 rounded-[8px] text-ink-muted hover:text-ink hover:bg-canvas-soft transition-colors"
        aria-label="Toggle navigation"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Logo */}
      <Link
        href="/"
        className="font-bold text-lg tracking-[-0.25px] text-ink flex items-center shrink-0"
      >
        <span className="text-primary">
          Razor
        </span>
        <span>Recovery</span>
      </Link>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Recovered amount */}
      <div className="hidden sm:flex items-center gap-1.5 bg-accent-green/10 border border-accent-green/25 text-accent-green px-3 py-1 rounded-full text-xs font-semibold">
        <span className="text-accent-green text-[10px] uppercase tracking-eyebrow">
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
      <div className="flex items-center gap-2 bg-canvas-soft border border-hairline px-3 py-1 rounded-full text-xs font-medium">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isConnected ? "bg-accent-green animate-pulse" : "bg-ink-faint"
          }`}
        />
        <span
          className={
            isConnected ? "text-accent-green font-semibold" : "text-ink-muted"
          }
        >
          {isConnected ? "Connected" : "Connecting"}
        </span>
      </div>
    </header>
  );
}
