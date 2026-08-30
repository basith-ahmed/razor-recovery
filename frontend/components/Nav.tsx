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
  const [openTicketCount, setOpenTicketCount] = useState<number>(0);

  useEffect(() => {
    getMetricsSummary("all")
      .then((data) => setInitialMetrics(data))
      .catch((err) => console.error("Nav failed to fetch initial metrics:", err));

    import("../lib/api").then(({ getTicketStats }) => {
      getTicketStats()
        .then((stats) => setOpenTicketCount(stats.openCount))
        .catch((err) => console.error("Nav failed to fetch ticket stats:", err));
    });
  }, [pathname]);

  const recoveredAmount = socketMetrics?.amountRecovered ?? initialMetrics?.amountRecovered ?? 0;

  const links = [
    { href: "/", label: "Overview" },
    { href: "/entities", label: "Entities" },
    { href: "/tickets", label: "Escalations", badge: openTicketCount },
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
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-semibold"
                      : "text-slate-400 hover:text-slate-800 hover:bg-slate-100/50"
                  }`}
                >
                  <span>{link.label}</span>
                  {typeof link.badge === "number" && link.badge > 0 && (
                    <span className="bg-amber-100 text-amber-800 text-xs px-1.5 py-0.5 rounded-full font-mono font-bold">
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {/* Recovered Counter */}
          <div className="bg-emerald-50/80 border border-emerald-200/50 text-emerald-700 px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm font-mono font-semibold">
            <span className="text-emerald-600 text-xs">RECOVERED:</span>
            <span>₹{recoveredAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>

          {/* System Status Pill — the pipeline is always live; there is no
              idle/running/complete state for a continuous stream */}
          <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 px-3 py-1.5 rounded-lg text-xs font-medium">
            <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-500"}`} />
            <span className={isConnected ? "text-emerald-700 font-semibold uppercase" : "text-slate-400"}>
              {isConnected ? "Live" : "Connecting..."}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
