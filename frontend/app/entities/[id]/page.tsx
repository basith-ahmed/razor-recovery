"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { getEntityAudit } from "../../../lib/api";
import { AuditEntry } from "../../../types";
import { AuditTimeline } from "../../../components/AuditTimeline";
import { useLiveStream } from "../../../lib/socket";

interface EntityDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function EntityDetailPage({ params }: EntityDetailPageProps) {
  const { id } = use(params);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  const { activityFeed } = useLiveStream();

  useEffect(() => {
    let ignore = false;
    const load = () => {
      getEntityAudit(id)
        .then((data) => {
          if (!ignore) {
            setEntries(data);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            console.error("Failed to load entity audit trail:", err);
            setError("Failed to load audit trail for entity " + id);
            setLoading(false);
          }
        });
    };
    
    load();
    return () => {
      ignore = true;
    };
  }, [id, activityFeed]);

  const latestEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const event = latestEntry?.event;
  const customer = event?.customer;
  const currentState = latestEntry?.state || "DETECTED";

  const STATE_BADGE_STYLES: Record<string, string> = {
    DETECTED: "bg-gray-800 text-gray-300 border-gray-700",
    CONTACTED: "bg-blue-50 text-blue-700 border-blue-200",
    RETRYING: "bg-blue-50 text-blue-700 border-blue-200",
    COOLING_DOWN: "bg-amber-50 text-amber-700 border-amber-200",
    ESCALATED: "bg-purple-50 text-purple-700 border-purple-200",
    RECOVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    WRITTEN_OFF: "bg-red-50 text-red-700 border-red-200",
    DO_NOT_CONTACT: "bg-white text-slate-500 border-slate-300",
  };

  return (
    <div>
      {/* Back button */}
      <div className="mb-4">
        <Link
          href="/entities"
          className="text-xs text-slate-400 hover:text-slate-900 flex items-center gap-1 transition-colors"
        >
          ← Back to Entities List
        </Link>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500">
          Loading audit trail...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-6 rounded-lg text-sm">
          {error}
        </div>
      ) : (
        <div>
          {/* Header Block with Customer Info & Flags */}
          <div className="bg-white border border-slate-200 rounded-lg p-6 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-slate-900">
                    {customer?.name || "Customer Entity"}
                  </h1>
                  <span className={`text-xs px-2.5 py-1 rounded font-mono font-semibold border ${STATE_BADGE_STYLES[currentState.toUpperCase()] || STATE_BADGE_STYLES.DETECTED}`}>
                    {currentState}
                  </span>
                  <span className="bg-slate-100 text-slate-700 text-xs px-2.5 py-1 rounded font-mono">
                    {event?.eventType || "EVENT"}
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono space-x-4">
                  <span>Email: {customer?.email || "N/A"}</span>
                  <span>•</span>
                  <span>Entity ID: {id}</span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="text-right">
                  <span className="text-xs text-slate-400 block mb-0.5">Amount at Risk</span>
                  <span className="text-xl font-bold font-mono text-emerald-700">
                    ₹{event?.amount ? event.amount.toLocaleString("en-IN") : "0"} {event?.currency || "INR"}
                  </span>
                </div>

                {/* DNC & Dispute Flags */}
                <div className="flex items-center gap-2 mt-1">
                  {customer?.dncFlag && (
                    <span className="bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                       Do Not Contact (DNC)
                    </span>
                  )}

                </div>
              </div>
            </div>
          </div>

          {/* Audit Timeline Section */}
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Audit Trail & Decision Sequence</h2>
            <p className="text-xs text-slate-400 mb-4">
              Immutable step-by-step history of detection, diagnosis, AI reasoning, and executed dunning actions.
            </p>
            <AuditTimeline entries={entries} />
          </div>
        </div>
      )}
    </div>
  );
}
