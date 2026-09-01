"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { getEntityAudit, escalateEntity } from "../../../lib/api";
import { AuditEntry, EntityAuditResponse, EntityEventItem } from "../../../types";
import { AuditTimeline } from "../../../components/AuditTimeline";
import { FloatingAuditAIBar } from "../../../components/FloatingAuditAIBar";
import { useLiveStream } from "../../../lib/socket";
import { formatCurrency, formatDateTime, formatDate } from "../../../lib/formatters";
import { Badge } from "../../../components/Badge";
import { ArrowRight, ShieldAlert, UserCheck, CheckCircle2, Loader2, Calendar, CalendarCheck, Copy, Check } from "lucide-react";

interface EntityDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function EntityDetailPage({ params }: EntityDetailPageProps) {
  const { id } = use(params);
  const [data, setData] = useState<EntityAuditResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [escalating, setEscalating] = useState<boolean>(false);
  const [escalationSuccess, setEscalationSuccess] = useState<{ ticketId?: string } | null>(null);
  const [escalationError, setEscalationError] = useState<string | null>(null);
  const [copiedPromiseLink, setCopiedPromiseLink] = useState(false);

  function handleCopyPromiseLink(url: string) {
    navigator.clipboard.writeText(url);
    setCopiedPromiseLink(true);
    setTimeout(() => setCopiedPromiseLink(false), 2000);
  }

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

  const activePromise = data?.promises?.find((p) => p.status === "pending" || p.status === "reminder_sent");

  const currentState = workflowState?.state || latestEvent?.state || latestEntry?.state || "DETECTED";
  const actualEntityId = data?.entityId || latestEvent?.entityId || latestEntry?.entityId || id;
  const attemptCount = workflowState?.attemptCount ?? latestEntry?.event?.attemptCount ?? 0;
  const cooldownUntil = workflowState?.cooldownUntil || latestEntry?.event?.cooldownUntil;
  const lastContactedAt = workflowState?.lastContactedAt || latestEntry?.event?.lastContactedAt;
  const totalAmount = latestEvent?.amount ?? latestEntry?.event?.amount ?? 0;
  const currency = latestEvent?.currency ?? latestEntry?.event?.currency ?? "INR";

  const customerName = customer?.name || "Revenue Entity";

  const handleEscalate = async () => {
    if (escalating) return;
    setEscalating(true);
    setEscalationError(null);
    setEscalationSuccess(null);
    try {
      const res = await escalateEntity(actualEntityId, {
        reason: "Manual operator escalation, moving DNC customer entity to human escalation review",
        agentName: "Operator",
      });
      setEscalationSuccess({ ticketId: res.ticketId });
      // Refresh entity audit trail
      const updated = await getEntityAudit(id);
      setData(updated);
    } catch (err: any) {
      console.error("Failed to escalate entity:", err);
      setEscalationError(err?.response?.data?.error || err?.message || "Failed to escalate entity");
    } finally {
      setEscalating(false);
    }
  };

  return (
    <div className="pb-8">
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
                  {activePromise && (
                    <span className="bg-blue-50 border border-blue-200 text-blue-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase flex items-center gap-1 shadow-2xs">
                      <Calendar className="w-3 h-3 text-blue-600" />
                      Promise-to-Pay Active
                    </span>
                  )}
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
              <div className="flex flex-col items-end gap-8 shrink-0">
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
                      {activePromise && " (Promise Due)"}
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

          {/* Promise to Pay Active Conversion Banner */}
          {activePromise && (
            <div className="bg-blue-50/90 border border-blue-200 rounded-[12px] p-4 mb-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 max-w-2xl">
                <CalendarCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-blue-950 flex items-center gap-2">
                    <span>Converted to Promise-to-Pay Commitment</span>
                    <Badge type="promiseStatus" value={activePromise.status}>
                      {activePromise.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="text-xs text-blue-800 mt-1 leading-relaxed">
                    Customer committed to settle <strong>{formatCurrency(activePromise.promisedAmount, activePromise.currency)}</strong> by <strong>{formatDate(activePromise.promisedDate)}</strong>. Automated dunning outreach is currently paused in cooldown until the commitment due date.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activePromise.paymentLinkUrl && (
                  <button
                    type="button"
                    onClick={() => handleCopyPromiseLink(activePromise.paymentLinkUrl!)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-[8px] text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedPromiseLink ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied Link</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Payment Link</span>
                      </>
                    )}
                  </button>
                )}
                <Link
                  href={`/promises/${activePromise.id}`}
                  className="px-3.5 py-1.5 bg-white border border-blue-300 text-blue-700 hover:bg-blue-100 rounded-[8px] text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  <span>Manage Promise</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          )}

          {/* DNC Escalation Action Banner / Status */}
          {customer?.dncFlag && currentState !== "ESCALATED" && currentState !== "RECOVERED" && currentState !== "WRITTEN_OFF" && (
            <div className="bg-amber-50 border border-amber-200 rounded-[12px] p-4 mb-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 max-w-2xl">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-amber-900">
                    Do-Not-Contact (DNC) Guardrail Active
                  </div>
                  <div className="text-xs text-amber-700 mt-0.5">
                    Automated outreach is suppressed by compliance policy. You can manually move this entity to human agent escalations for white-glove follow-up.
                  </div>
                </div>
              </div>
              <button
                onClick={handleEscalate}
                disabled={escalating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-[8px] text-xs font-semibold shadow-xs flex items-center gap-2 transition-colors shrink-0 cursor-pointer"
              >
                {escalating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Escalating...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Move to Escalations</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Escalation Success Alert */}
          {escalationSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-[12px] p-4 mb-5 shadow-xs flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 text-xs text-emerald-900 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Entity successfully escalated to human agents. Open ticket created.</span>
              </div>
              {escalationSuccess.ticketId && (
                <Link
                  href={`/tickets/${escalationSuccess.ticketId}`}
                  className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1 shrink-0"
                >
                  <span>Open Ticket</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
          )}

          {/* Escalation Error Alert */}
          {escalationError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-[12px] p-4 mb-5 text-xs font-medium">
              {escalationError}
            </div>
          )}

          {/* Already Escalated Banner for DNC */}
          {currentState === "ESCALATED" && (
            <div className="bg-purple-50 border border-purple-200 rounded-[12px] p-4 mb-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 text-xs text-purple-900 font-medium">
                <UserCheck className="w-4 h-4 text-purple-600 shrink-0" />
                <span>This entity is under active human agent review in the Escalations queue.</span>
              </div>
              <Link
                href="/tickets"
                className="px-3.5 py-1.5 bg-white border border-purple-300 text-purple-700 hover:bg-purple-100 rounded-[8px] text-xs font-medium flex items-center gap-1.5 shrink-0 transition-colors shadow-xs"
              >
                <span>View Escalations Queue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
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

      <FloatingAuditAIBar
        key={actualEntityId}
        entityId={actualEntityId}
        title="Entity Audit Copilot"
        sampleQuestions={[
          "Why was this customer escalated?",
          "What was the diagnosed cause for this event?",
          "What actions were attempted before the final outcome?",
          "How was the recovery policy and cooldown determined?",
          "Why did the autonomous dunning rule trigger?",
        ]}
      />
    </div>
  );
}
