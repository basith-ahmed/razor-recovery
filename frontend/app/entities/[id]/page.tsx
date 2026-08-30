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
      <nav className="flex items-center gap-1.5 text-xs text-ink-faint mb-4">
        <Link href="/entities" className="hover:text-ink transition-colors">
          Entities
        </Link>
        <span>/</span>
        <span className="text-ink font-semibold truncate max-w-xs">
          {loading ? "Loading..." : customerName}
        </span>
      </nav>

      {loading ? (
        <div className="bg-white border border-hairline rounded-[12px] p-8 text-center text-ink-muted text-sm shadow-notion-soft">
          Loading entity and audit trail...
        </div>
      ) : error ? (
        <div className="bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep p-4 rounded-[12px] text-xs">
          {error}
        </div>
      ) : (
        <div>
          {/* Entity header */}
          <div className="bg-white border border-hairline rounded-[12px] p-6 mb-5 shadow-notion-soft">
            <div className="flex flex-wrap items-start justify-between gap-6">

              {/* Left: Identity */}
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                  <h1 className="text-[26px] font-bold text-ink tracking-heading-2">{customerName}</h1>
                  <Badge type="state" value={currentState} />
                  {customer?.dncFlag && (
                    <span className="bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase">
                      DNC
                    </span>
                  )}
                  {events.length > 0 && (
                    <span className="bg-accent-purple/30 text-accent-purple-deep border border-accent-purple/60 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                      {events.length} {events.length === 1 ? "Event" : "Events"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-muted space-y-0.5">
                  <div>{customer?.email || "No email"}</div>
                  <div className="text-ink-faint">Entity: {actualEntityId}</div>
                  {latestEvent?.id && (
                    <div className="text-ink-faint">Latest Event: {latestEvent.id}</div>
                  )}
                </div>
              </div>

              {/* Right: Financial summary */}
              <div className="flex items-start gap-8 shrink-0">
                <div className="text-right">
                  <div className="text-xs text-ink-muted mb-0.5 font-medium">Amount at Risk</div>
                  <div className="text-2xl font-bold text-ink tracking-heading-3">
                    {formatCurrency(totalAmount, currency)}
                  </div>
                </div>

                <div className="text-right text-xs space-y-1 pt-0.5">
                  <div>
                    <span className="text-ink-muted">Attempts: </span>
                    <span className="font-semibold text-ink">{attemptCount}</span>
                  </div>
                  {cooldownUntil && (
                    <div className="text-accent-orange font-medium">
                      Cooldown until {formatDateTime(cooldownUntil)}
                    </div>
                  )}
                  {lastContactedAt && (
                    <div className="text-ink-muted">
                      Last contact: {formatDateTime(lastContactedAt)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Promises section — only shown when promises exist */}
          {data?.promises && data.promises.length > 0 && (
            <div className="mb-5 border border-hairline rounded-[12px] bg-canvas-soft p-5 shadow-notion-soft">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px]">
                  Promise-to-Pay Commitments
                  <span className="ml-2 text-xs bg-white border border-hairline text-ink-muted px-2.5 py-0.5 rounded-full shadow-xs font-semibold">
                    {data.promises.length}
                  </span>
                </h3>
                <Link
                  href="/promises"
                  className="text-xs text-primary hover:text-primary-active font-medium"
                >
                  Manage →
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.promises.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white p-4 rounded-[8px] border border-hairline space-y-2 text-xs shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink text-sm">
                        {formatCurrency(p.promisedAmount, p.currency)}
                      </span>
                      <Badge type="promiseStatus" value={p.status}>
                        {p.status.replace("_", " ")}
                      </Badge>
                    </div>

                    <div className="text-ink-secondary">Due: {formatDate(p.promisedDate)}</div>

                    {p.notes && <div className="text-ink-muted truncate">{p.notes}</div>}

                    {p.paymentLinkUrl && (
                      <div className="pt-1.5 border-t border-hairline">
                        <a
                          href={p.paymentLinkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-xs font-medium"
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
                <h2 className="text-[18px] font-bold text-ink tracking-[-0.25px] mb-0.5">
                  Audit Trail & Decision Sequence
                </h2>
                <p className="text-xs text-ink-muted">
                  Immutable step-by-step cryptographic hash chain of detection, diagnosis, AI reasoning, and executed actions.
                </p>
              </div>
              <span className="text-xs bg-white border border-hairline text-ink-muted px-3 py-1 rounded-full font-semibold shadow-xs">
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
