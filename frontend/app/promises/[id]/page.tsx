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
      <nav className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
        <Link href="/promises" className="hover:text-slate-700">
          Promises to Pay
        </Link>
        <span>/</span>
        <span className="text-slate-700 font-medium truncate max-w-xs">
          {loading ? "Loading..." : promise?.customerName ?? id}
        </span>
      </nav>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded p-8 text-center text-slate-500 text-sm">
          Loading promise details...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded text-sm">
          {error}
        </div>
      ) : promise ? (
        <div>
          {/* Header card */}
          <div className="bg-white border border-slate-200 rounded p-5 mb-5">
            <div className="flex flex-wrap items-start justify-between gap-6">
              {/* Left: identity */}
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                  <h1 className="text-xl font-bold text-slate-900">{promise.customerName}</h1>
                  <Badge type="promiseStatus" value={promise.status}>
                    {promise.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-xs text-slate-500 font-mono space-y-0.5">
                  <div>{promise.customerEmail}</div>
                  {promise.customerPhone && <div>{promise.customerPhone}</div>}
                  <div className="text-slate-400">
                    Entity:{" "}
                    <Link href={`/entities/${promise.entityId}`} className="text-blue-600 hover:underline">
                      {promise.entityId}
                    </Link>
                  </div>
                  <div className="text-slate-400">Promise ID: {promise.id}</div>
                </div>
              </div>

              {/* Right: amount + actions */}
              <div className="flex flex-col items-end gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-xs text-slate-500 mb-0.5">Promised Amount</div>
                  <div className="text-2xl font-bold font-mono text-slate-900">
                    {formatCurrency(promise.promisedAmount, promise.currency)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {promise.status === "pending" && (
                    <button
                      type="button"
                      onClick={handleSendReminder}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-xs font-medium border border-amber-300 bg-amber-50 text-amber-800 rounded hover:bg-amber-100 disabled:opacity-50"
                    >
                      {actionLoading ? "Sending..." : "Send Reminder"}
                    </button>
                  )}
                  {promise.status !== "kept" && promise.status !== "cancelled" && (
                    <button
                      type="button"
                      onClick={handleMarkPaid}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-xs font-medium border border-emerald-300 bg-emerald-50 text-emerald-800 rounded hover:bg-emerald-100 disabled:opacity-50"
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
              <div className="bg-white border border-slate-200 rounded p-4">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">Commitment Timeline</h2>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-slate-500">Created</span>
                    <span className="font-mono text-slate-800">{formatDateTime(promise.createdAt)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-slate-500">Promised Due Date</span>
                    <span className="font-mono font-semibold text-slate-900">{formatDate(promise.promisedDate)}</span>
                  </div>
                  {promise.reminderSentAt && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-slate-500">Reminder Sent</span>
                      <span className="font-mono text-slate-700">{formatDateTime(promise.reminderSentAt)}</span>
                    </div>
                  )}
                  {promise.gracePeriodUntil && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-slate-500">Grace Period Until</span>
                      <span className="font-mono text-amber-700">{formatDateTime(promise.gracePeriodUntil)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-slate-500">Last Updated</span>
                    <span className="font-mono text-slate-700">{formatDateTime(promise.updatedAt)}</span>
                  </div>

                  {/* Live countdown */}
                  {(promise.status === "pending" || promise.status === "reminder_sent") && (
                    <div className="pt-1">
                      <span className="text-slate-500 block mb-1">Live Countdown</span>
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
                <div className="bg-white border border-slate-200 rounded p-4">
                  <h2 className="text-sm font-semibold text-slate-900 mb-3">Payment Link</h2>
                  <div className="font-mono text-xs text-slate-700 break-all bg-slate-50 p-3 border border-slate-200 rounded mb-3">
                    {promise.paymentLinkUrl}
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={promise.paymentLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
                    >
                      Open Payment Link
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-50"
                    >
                      {copiedLink ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="bg-white border border-slate-200 rounded p-4">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">Notes & Agreement Context</h2>
                <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 border border-slate-200 rounded p-3 min-h-16">
                  {promise.notes || <span className="text-slate-400 italic">No notes recorded for this commitment.</span>}
                </div>
              </div>
            </div>

            {/* Right: Summary panel */}
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded p-4">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">Summary</h2>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-slate-500 block mb-0.5">Status</span>
                    <Badge type="promiseStatus" value={promise.status}>
                      {promise.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Promised Amount</span>
                    <span className="font-mono font-bold text-slate-900 text-base">
                      {formatCurrency(promise.promisedAmount, promise.currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Currency</span>
                    <span className="font-mono text-slate-800">{promise.currency}</span>
                  </div>
                  {promise.razorpayPaymentLinkId && (
                    <div>
                      <span className="text-slate-500 block mb-0.5">Razorpay Link ID</span>
                      <span className="font-mono text-slate-700 text-[11px] break-all">
                        {promise.razorpayPaymentLinkId}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded p-4">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">Customer</h2>
                <div className="space-y-2 text-xs">
                  <div className="font-semibold text-slate-900">{promise.customerName}</div>
                  <div className="font-mono text-slate-600">{promise.customerEmail}</div>
                  {promise.customerPhone && (
                    <div className="font-mono text-slate-600">{promise.customerPhone}</div>
                  )}
                  <div className="pt-2 border-t border-slate-100">
                    <Link
                      href={`/entities/${promise.entityId}`}
                      className="text-blue-600 hover:underline font-medium"
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
