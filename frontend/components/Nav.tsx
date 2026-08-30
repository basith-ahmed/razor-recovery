"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveStream } from "../lib/socket";
import { getMetricsSummary } from "../lib/api";

export function Nav() {
  const pathname = usePathname();
  const { isConnected, metrics: socketMetrics } = useLiveStream();
  const [initialMetrics, setInitialMetrics] = useState<{ amountRecovered: number } | null>(null);

  useEffect(() => {
    getMetricsSummary("all")
      .then((data) => setInitialMetrics(data))
      .catch((err) => console.error("Nav failed to fetch initial metrics:", err));
  }, [pathname]);

  const recoveredAmount = socketMetrics?.amountRecovered ?? initialMetrics?.amountRecovered ?? 0;

  const links = [
    { href: "/", label: "Overview" },
    { href: "/entities", label: "Entities" },
    { href: "/promises", label: "Promises to Pay" },
    { href: "/tickets", label: "Escalations" },
    { href: "/metrics", label: "Metrics" },
    { href: "/policy", label: "Policy & Compliance" },
  ];

  return (
    <header className="bg-white border-b border-slate-200 text-slate-900 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-bold text-xl tracking-tight text-slate-900 flex items-center gap-2">
            <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded font-mono uppercase">Razor</span>
            <span>Recovery</span>
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded text-sm font-medium ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-semibold"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded flex items-center gap-2 text-sm font-mono font-semibold">
            <span className="text-emerald-600 text-xs">RECOVERED:</span>
            <span>₹{recoveredAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 px-3 py-1.5 rounded text-xs font-medium">
            <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-slate-400"}`} />
            <span className={isConnected ? "text-emerald-700 font-semibold uppercase" : "text-slate-500"}>
              {isConnected ? "Live" : "Connecting..."}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
