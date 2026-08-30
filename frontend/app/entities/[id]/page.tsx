"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { getEntityAudit } from "../../../lib/api";
import { AuditEntry, EntityAuditResponse, EntityEventItem } from "../../../types";
import { AuditTimeline } from "../../../components/AuditTimeline";
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

  const customerName = customer?.name || "Revenue Entity";

  return (
    <div className="pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
        <Link href="/entities" className="hover:text-slate-700">
          Entities
        </Link>
        <span>/</span>
        <span className="text-slate-700 font-medium truncate max-w-xs">
          {loading ? "Loading..." : customerName}
        </span>
      </nav>

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
          {/* Entity header */}
          <div className="bg-white border border-slate-200 rounded p-5 mb-5">
            <div className="flex flex-wrap items-start justify-between gap-6">

              {/* Left: Identity */}
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                  <h1 className="text-xl font-bold text-slate-900">{customerName}</h1>
                  <Badge type="state" value={currentState} />
                  {customer?.dncFlag && (
                    <span className="bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                      DNC
                    </span>
                  )}
                  {events.length > 0 && (
                    <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2 py-0.5 rounded font-mono font-semibold">
                      {events.length} {events.length === 1 ? "Event" : "Events"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono space-y-0.5">
                  <div>{customer?.email || "No email"}</div>
                  <div className="text-slate-400">Entity: {actualEntityId}</div>
                  {latestEvent?.id && (
                    <div className="text-slate-400">Latest Event: {latestEvent.id}</div>
                  )}
                </div>
              </div>

              {/* Right: Financial summary */}
              <div className="flex items-start gap-8 shrink-0">
                <div className="text-right">
                  <div className="text-xs text-slate-500 mb-0.5">Amount at Risk</div>
                  <div className="text-2xl font-bold font-mono text-emerald-700">
                    {formatCurrency(totalAmount, currency)}
                  </div>
                </div>

                <div className="text-right text-xs font-mono space-y-1 pt-0.5">
                  <div>
                    <span className="text-slate-500">Attempts: </span>
                    <span className="font-semibold text-slate-800">{attemptCount}</span>
                  </div>
                  {cooldownUntil && (
                    <div className="text-amber-700">
                      Cooldown until {formatDateTime(cooldownUntil)}
                    </div>
                  )}
                  {lastContactedAt && (
                    <div className="text-slate-500">
                      Last contact: {formatDateTime(lastContactedAt)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Promises section — only shown when promises exist */}
          {data?.promises && data.promises.length > 0 && (
            <div className="mb-5 border border-slate-200 rounded bg-slate-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Promise-to-Pay Commitments
                  <span className="ml-2 text-xs font-mono bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded">
                    {data.promises.length}
                  </span>
                </h3>
                <Link
                  href="/promises"
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  Manage →
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

                    <div className="text-slate-600">Due: {formatDate(p.promisedDate)}</div>

                    {p.notes && <div className="text-slate-500 truncate">{p.notes}</div>}

                    {p.paymentLinkUrl && (
                      <div className="pt-1 border-t border-slate-200">
                        <a
                          href={p.paymentLinkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-xs font-medium"
                        >
                          Open Payment Link
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit Trail Sequence (Full Width & Clean) */}
          <div className="mb-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 mb-1">
                  Audit Trail & Decision Sequence
                </h2>
                <p className="text-xs text-slate-500">
                  Immutable step-by-step cryptographic hash chain of detection, diagnosis, AI reasoning, and executed actions.
                </p>
              </div>
              <span className="text-xs font-mono bg-white border border-slate-200 text-slate-600 px-2.5 py-1 rounded">
                {entries.length} Audit Entries
              </span>
            </div>

            <AuditTimeline entries={entries} />
          </div>
        </div>
      )}
    </div>
  );
}
