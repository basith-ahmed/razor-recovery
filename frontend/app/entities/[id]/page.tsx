"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { getEntityAudit } from "../../../lib/api";
import { AuditEntry, EntityAuditResponse, EntityEventItem } from "../../../types";
import { AuditTimeline } from "../../../components/AuditTimeline";
import { AuditQueryPanel } from "../../../components/AuditQueryPanel";
import { useLiveStream } from "../../../lib/socket";

interface EntityDetailPageProps {
  params: Promise<{ id: string }>;
}

const STATE_BADGE_STYLES: Record<string, string> = {
  DETECTED: "bg-slate-100 text-slate-700 border-slate-300",
  CONTACTED: "bg-blue-50 text-blue-700 border-blue-200",
  RETRYING: "bg-blue-50 text-blue-700 border-blue-200",
  COOLING_DOWN: "bg-amber-50 text-amber-700 border-amber-200",
  ESCALATED: "bg-purple-50 text-purple-700 border-purple-200",
  RECOVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WRITTEN_OFF: "bg-red-50 text-red-700 border-red-200",
  DO_NOT_CONTACT: "bg-white text-slate-500 border-slate-300",
};

export default function EntityDetailPage({ params }: EntityDetailPageProps) {
  const { id } = use(params);
  const [data, setData] = useState<EntityAuditResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  const { activityFeed } = useLiveStream();

  useEffect(() => {
    let ignore = false;
    const load = () => {
      getEntityAudit(id)
        .then((res) => {
          if (!ignore) {
            setData(res);
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

  const entries: AuditEntry[] = data?.auditEntries ?? [];
  const events: EntityEventItem[] = data?.events ?? [];
  const latestEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const latestEvent = events.length > 0 ? events[0] : null;
  const customer = data?.customer || latestEntry?.event?.customer || (latestEvent ? { id: latestEvent.customerId, name: latestEvent.customerName, email: latestEvent.customerEmail, dncFlag: false } : null);
  const workflowState = data?.workflowState;

  const currentState = workflowState?.state || latestEvent?.state || latestEntry?.state || "DETECTED";
  const actualEntityId = data?.entityId || latestEvent?.entityId || latestEntry?.entityId || id;
  const attemptCount = workflowState?.attemptCount ?? latestEntry?.event?.attemptCount ?? 0;
  const cooldownUntil = workflowState?.cooldownUntil || latestEntry?.event?.cooldownUntil;
  const lastContactedAt = workflowState?.lastContactedAt || latestEntry?.event?.lastContactedAt;
  const totalAmount = latestEvent?.amount ?? latestEntry?.event?.amount ?? 0;
  const currency = latestEvent?.currency ?? latestEntry?.event?.currency ?? "INR";

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
          Loading entity and audit trail...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-6 rounded-lg text-sm">
          {error}
        </div>
      ) : (
        <div>
          {/* Header Block with Entity Info, Status, & Counters */}
          <div className="bg-white border border-slate-200 rounded-lg p-6 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-slate-900">
                    {customer?.name || "Revenue Entity"}
                  </h1>
                  <span className={`text-xs px-2.5 py-1 rounded font-mono font-semibold border ${STATE_BADGE_STYLES[currentState.toUpperCase()] || STATE_BADGE_STYLES.DETECTED}`}>
                    {currentState}
                  </span>
                  {events.length > 0 && (
                    <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2.5 py-1 rounded font-mono font-semibold">
                      {events.length} {events.length === 1 ? "Event" : "Events"}
                    </span>
                  )}
                </div>
                <div className="text-left text-xs text-slate-500 font-mono mt-2 space-y-0.5">
                  <div>Email: {customer?.email || "N/A"}</div>
                  <div>Entity ID: {actualEntityId}</div>
                  {latestEvent?.id && (
                    <div>Latest Event ID: {latestEvent.id}</div>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="text-right">
                  <span className="text-xs text-slate-400 block mb-0.5">Amount at Risk</span>
                  <span className="text-xl font-bold font-mono text-emerald-700">
                    ₹{totalAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {latestEvent?.currency || "INR"}
                  </span>
                </div>
                <div className="text-right text-xs text-slate-500 font-mono mt-1 space-y-0.5">
                  <div>Total Attempts: <span className="font-semibold text-slate-800">{attemptCount}</span></div>
                  {cooldownUntil && (
                    <div className="text-amber-700 font-medium">Cooldown Until: {new Date(cooldownUntil).toLocaleString()}</div>
                  )}
                  {lastContactedAt && (
                    <div>Last Contact: {new Date(lastContactedAt).toLocaleString()}</div>
                  )}
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

          {/* Promise-to-Pay Commitment Section (if any commitments exist) */}
          {data?.promises && data.promises.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Promise-to-Pay Commitments ({data.promises.length})
                </h3>
                <Link
                  href="/promises"
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  Manage in Portal →
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.promises.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white p-3 rounded border border-slate-200 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 font-mono">
                        ₹{p.promisedAmount.toLocaleString("en-IN")}
                      </span>
                      <span className="text-xs font-semibold text-slate-700">
                        {p.status.replace("_", " ")}
                      </span>
                    </div>

                    <div className="text-slate-600">
                      Due: {new Date(p.promisedDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>

                    {p.notes && <div className="text-slate-500 truncate">{p.notes}</div>}

                    {p.paymentLinkUrl && (
                      <div className="pt-1 border-t border-slate-100">
                        <a
                          href={p.paymentLinkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Open Payment Link →
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2-Column Layout: Left (Audit Timeline), Right (AI Assistant) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Left 2 Columns: Audit Timeline */}
            <div className="lg:col-span-2">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Audit Trail & Decision Sequence</h2>
                <p className="text-xs text-slate-400">
                  Immutable step-by-step cryptographic hash chain of detection, diagnosis, AI reasoning, and executed actions.
                </p>
              </div>
              <AuditTimeline entries={entries} />
            </div>

            {/* Right Column: Permanent AI Audit Assistant Sidebar */}
            <div className="lg:col-span-1 lg:sticky lg:top-6">
              <AuditQueryPanel entityId={actualEntityId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
