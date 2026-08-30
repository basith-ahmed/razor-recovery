"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getPromise, sendPromiseReminder, updatePromise } from "../../../lib/api";
import { PromiseToPayItem } from "../../../types";
import { formatCurrency, formatDateTime, formatDate } from "../../../lib/formatters";
import { Badge } from "../../../components/Badge";
import { CountdownTimer } from "../../../components/CountdownTimer";
import { PageHeader } from "../../../components/PageHeader";

interface PromiseDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function PromiseDetailPage({ params }: PromiseDetailPageProps) {
  const { id } = use(params);
  const [promise, setPromise] = useState<PromiseToPayItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const loadPromise = useCallback(() => {
    setLoading(true);
    getPromise(id)
      .then((data) => {
        setPromise(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load promise:", err);
        setError("Failed to load promise commitment " + id);
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    loadPromise();
  }, [loadPromise]);

  const handleSendReminder = async () => {
    if (!promise) return;
    try {
      setActionLoading(true);
      const res = await sendPromiseReminder(promise.id);
      setPromise(res.promise);
    } catch (err) {
      console.error("Failed to send reminder:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!promise) return;
    try {
      setActionLoading(true);
      const updated = await updatePromise(promise.id, { status: "kept" });
      setPromise(updated);
    } catch (err) {
      console.error("Failed to mark paid:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!promise?.paymentLinkUrl) return;
    navigator.clipboard.writeText(promise.paymentLinkUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-ink-faint mb-4">
        <Link href="/promises" className="hover:text-ink transition-colors">
          Promises to Pay
        </Link>
        <span>/</span>
        <span className="text-ink font-semibold truncate max-w-xs">
          {loading ? "Loading..." : promise?.customerName ?? id}
        </span>
      </nav>

      {loading ? (
        <div className="bg-white border border-hairline rounded-[12px] p-8 text-center text-ink-muted text-xs shadow-notion-soft">
          Loading promise details...
        </div>
      ) : error ? (
        <div className="bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep p-4 rounded-[8px] text-xs">
          {error}
        </div>
      ) : promise ? (
        <div>
          {/* Header card */}
          <div className="bg-white border border-hairline rounded-[12px] p-5 mb-5 shadow-notion-soft">
            <div className="flex flex-wrap items-start justify-between gap-6">
              {/* Left: identity */}
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                  <h1 className="text-xl font-bold text-ink tracking-[-0.625px]">{promise.customerName}</h1>
                  <Badge type="promiseStatus" value={promise.status}>
                    {promise.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-xs text-ink-muted space-y-0.5">
                  <div className="text-ink font-medium">{promise.customerEmail}</div>
                  {promise.customerPhone && <div>{promise.customerPhone}</div>}
                  <div className="text-ink-faint">
                    Entity:{" "}
                    <Link href={`/entities/${promise.entityId}`} className="text-primary hover:underline font-medium">
                      {promise.entityId}
                    </Link>
                  </div>
                  <div className="text-ink-faint">Promise ID: {promise.id}</div>
                </div>
              </div>

              {/* Right: amount + actions */}
              <div className="flex flex-col items-end gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-xs text-ink-muted mb-0.5">Promised Amount</div>
                  <div className="text-2xl font-bold text-ink tracking-heading-3">
                    {formatCurrency(promise.promisedAmount, promise.currency)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {promise.status === "pending" && (
                    <button
                      type="button"
                      onClick={handleSendReminder}
                      disabled={actionLoading}
                      className="px-4 py-1.5 text-xs font-semibold border border-accent-orange/30 bg-accent-orange/10 text-accent-orange-deep rounded-full hover:bg-accent-orange/20 disabled:opacity-50 transition-colors"
                    >
                      {actionLoading ? "Sending..." : "Send Reminder"}
                    </button>
                  )}
                  {promise.status !== "kept" && promise.status !== "cancelled" && (
                    <button
                      type="button"
                      onClick={handleMarkPaid}
                      disabled={actionLoading}
                      className="px-4 py-1.5 text-xs font-semibold border border-accent-green/30 bg-accent-green/10 text-accent-green rounded-full hover:bg-accent-green/20 disabled:opacity-50 transition-colors"
                    >
                      {actionLoading ? "Updating..." : "Mark as Paid"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main 2-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left: Timeline & dates */}
            <div className="lg:col-span-2 space-y-4">

              {/* Countdown + dates */}
              <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5">Commitment Timeline</h2>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between items-center py-2 border-b border-hairline">
                    <span className="text-ink-muted">Created</span>
                    <span className="text-ink-secondary">{formatDateTime(promise.createdAt)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-hairline">
                    <span className="text-ink-muted">Promised Due Date</span>
                    <span className="font-bold text-ink">{formatDate(promise.promisedDate)}</span>
                  </div>
                  {promise.reminderSentAt && (
                    <div className="flex justify-between items-center py-2 border-b border-hairline">
                      <span className="text-ink-muted">Reminder Sent</span>
                      <span className="text-ink-secondary">{formatDateTime(promise.reminderSentAt)}</span>
                    </div>
                  )}
                  {promise.gracePeriodUntil && (
                    <div className="flex justify-between items-center py-2 border-b border-hairline">
                      <span className="text-ink-muted">Grace Period Until</span>
                      <span className="text-accent-orange font-semibold">{formatDateTime(promise.gracePeriodUntil)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-b border-hairline">
                    <span className="text-ink-muted">Last Updated</span>
                    <span className="text-ink-secondary">{formatDateTime(promise.updatedAt)}</span>
                  </div>

                  {/* Live countdown */}
                  {(promise.status === "pending" || promise.status === "reminder_sent") && (
                    <div className="pt-2">
                      <span className="text-ink-muted font-medium block mb-1.5">Live Countdown</span>
                      <CountdownTimer
                        promisedDate={promise.promisedDate}
                        gracePeriodUntil={promise.gracePeriodUntil}
                        status={promise.status}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Payment link */}
              {promise.paymentLinkUrl && (
                <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                  <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5">Payment Link</h2>
                  <div className="text-xs text-ink-secondary break-all bg-canvas-soft p-3 border border-hairline rounded-[6px] mb-3.5 font-medium">
                    {promise.paymentLinkUrl}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <a
                      href={promise.paymentLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 text-xs bg-primary hover:bg-primary-active active:scale-[0.98] text-white rounded-full font-medium transition-all shadow-sm"
                    >
                      Open Payment Link
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="px-3.5 py-2 text-xs border border-hairline rounded-[8px] bg-white text-ink hover:bg-canvas-soft font-medium transition-colors"
                    >
                      {copiedLink ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5">Notes & Agreement Context</h2>
                <div className="text-xs text-ink-secondary whitespace-pre-wrap leading-relaxed bg-canvas-soft border border-hairline rounded-[6px] p-3.5 min-h-16">
                  {promise.notes || <span className="text-ink-faint italic">No notes recorded for this commitment.</span>}
                </div>
              </div>
            </div>

            {/* Right: Summary panel */}
            <div className="space-y-4">
              <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5">Summary</h2>
                <div className="space-y-3.5 text-xs">
                  <div>
                    <span className="text-ink-muted block mb-1">Status</span>
                    <Badge type="promiseStatus" value={promise.status}>
                      {promise.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-ink-muted block mb-1">Promised Amount</span>
                    <span className="font-bold text-ink text-base">
                      {formatCurrency(promise.promisedAmount, promise.currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-muted block mb-1">Currency</span>
                    <span className="text-ink font-semibold">{promise.currency}</span>
                  </div>
                  {promise.razorpayPaymentLinkId && (
                    <div>
                      <span className="text-ink-muted block mb-1">Razorpay Link ID</span>
                      <span className="text-ink-muted text-[11px] break-all font-medium">
                        {promise.razorpayPaymentLinkId}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5">Customer</h2>
                <div className="space-y-2.5 text-xs">
                  <div className="font-semibold text-ink">{promise.customerName}</div>
                  <div className="text-ink-muted">{promise.customerEmail}</div>
                  {promise.customerPhone && (
                    <div className="text-ink-muted">{promise.customerPhone}</div>
                  )}
                  <div className="pt-2.5 border-t border-hairline">
                    <Link
                      href={`/entities/${promise.entityId}`}
                      className="text-primary hover:underline font-semibold"
                    >
                      View Entity Audit Trail →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
