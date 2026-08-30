"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { getEntityAudit } from "../../../lib/api";
import { AuditEntry, EntityAuditResponse, EntityEventItem } from "../../../types";
import { AuditTimeline } from "../../../components/AuditTimeline";
import { AuditQueryPanel } from "../../../components/AuditQueryPanel";
import { useLiveStream } from "../../../lib/socket";
import { formatCurrency, formatDateTime, formatDate } from "../../../lib/formatters";
import { Badge } from "../../../components/Badge";

interface EntityDetailPageProps {
  params: Promise<{ id: string }>;
}

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
      <div className="mb-4">
        <Link
          href="/entities"
          className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
        >
          Back to Entities List
        </Link>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded p-8 text-center text-slate-500 text-sm">
          Loading entity and audit trail...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded text-xs">
          {error}
        </div>
      ) : (
        <div>
          <div className="bg-white border border-slate-200 rounded p-4 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-slate-900">
                    {customer?.name || "Revenue Entity"}
                  </h1>
                  <Badge type="state" value={currentState} />
                  {events.length > 0 && (
                    <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2 py-0.5 rounded font-mono font-semibold">
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
                  <span className="text-xs text-slate-500 block mb-0.5">Amount at Risk</span>
                  <span className="text-xl font-bold font-mono text-emerald-700">
                    {formatCurrency(totalAmount, currency)}
                  </span>
                </div>
                <div className="text-right text-xs text-slate-500 font-mono mt-1 space-y-0.5">
                  <div>Total Attempts: <span className="font-semibold text-slate-800">{attemptCount}</span></div>
                  {cooldownUntil && (
                    <div className="text-amber-700 font-medium">Cooldown Until: {formatDateTime(cooldownUntil)}</div>
                  )}
                  {lastContactedAt && (
                    <div>Last Contact: {formatDateTime(lastContactedAt)}</div>
                  )}
                </div>

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
                        {formatCurrency(p.promisedAmount, p.currency)}
                      </span>
                      <Badge type="promiseStatus" value={p.status}>
                        {p.status.replace("_", " ")}
                      </Badge>
                    </div>

                    <div className="text-slate-600">
                      Due: {formatDate(p.promisedDate)}
                    </div>

                    {p.notes && <div className="text-slate-500 truncate">{p.notes}</div>}

                    {p.paymentLinkUrl && (
                      <div className="pt-1 border-t border-slate-200">
                        <a
                          href={p.paymentLinkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-xs font-medium"
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Audit Trail & Decision Sequence</h2>
                <p className="text-xs text-slate-500">
                  Immutable step-by-step cryptographic hash chain of detection, diagnosis, AI reasoning, and executed actions.
                </p>
              </div>
              <AuditTimeline entries={entries} />
            </div>

            <div className="lg:col-span-1 lg:sticky lg:top-6">
              <AuditQueryPanel entityId={actualEntityId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
