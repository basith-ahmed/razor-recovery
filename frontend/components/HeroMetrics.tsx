"use client";

import { useEffect, useState, useRef } from "react";
import { MetricsSummary } from "../types";

interface HeroMetricsProps {
  metrics: MetricsSummary | null;
}

function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 0 }: { value: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValRef = useRef(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const duration = 600;
    const startVal = prevValRef.current;
    const endVal = value;

    if (startVal === endVal) return;

    let animId: number;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const current = startVal + (endVal - startVal) * progress;
      setDisplayValue(current);
      if (progress < 1) {
        animId = requestAnimationFrame(step);
      } else {
        prevValRef.current = endVal;
      }
    };

    animId = requestAnimationFrame(step);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [value]);

  return (
    <span>
      {prefix}
      {displayValue.toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

export function HeroMetrics({ metrics }: HeroMetricsProps) {
  const amountAtRisk = metrics?.amountAtRisk ?? 0;
  const amountRecovered = metrics?.amountRecovered ?? 0;
  const recoveryRate = (metrics?.recoveryRate ?? 0) * 100;
  const eventsProcessed = metrics?.eventsProcessed ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. Amount At Risk */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Amount At Risk</p>
        <div className="text-2xl font-bold font-mono text-amber-700">
          <AnimatedNumber value={amountAtRisk} prefix="₹" decimals={2} />
        </div>
        <p className="text-xs text-slate-500 mt-1">Total revenue value flagged</p>
      </div>

      {/* 2. Amount Recovered */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Amount Recovered</p>
        <div className="text-2xl font-bold font-mono text-emerald-700">
          <AnimatedNumber value={amountRecovered} prefix="₹" decimals={2} />
        </div>
        <p className="text-xs text-slate-500 mt-1">Successfully rescued funds</p>
      </div>

      {/* 3. Recovery Rate */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Recovery Rate</p>
        <div className="text-2xl font-bold font-mono text-blue-700">
          <AnimatedNumber value={recoveryRate} suffix="%" decimals={1} />
        </div>
        <p className="text-xs text-slate-500 mt-1">Conversion efficiency</p>
      </div>

      {/* 4. Events Processed — no fixed total exists in a continuous stream */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Events Processed</p>
        <div className="text-2xl font-bold font-mono text-purple-700">
          <AnimatedNumber value={eventsProcessed} decimals={0} />
        </div>
        <p className="text-xs text-slate-500 mt-1">Audit pipeline throughput</p>
      </div>
    </div>
  );
}
