import React from "react";
import { PromiseToPayItem } from "../types";
import { formatCurrency, formatDateTime } from "../lib/formatters";
import { CountdownTimer } from "./CountdownTimer";
import { Modal } from "./Modal";
import { Badge } from "./Badge";

interface PromiseDetailsModalProps {
  promise: PromiseToPayItem | null;
  onClose: () => void;
  onSendReminder: (id: string) => void;
  onMarkPaid: (id: string) => void;
  actionLoadingId: string | null;
  copiedId: string | null;
  onCopyLink: (id: string, url?: string | null) => void;
}

export function PromiseDetailsModal({
  promise,
  onClose,
  onSendReminder,
  onMarkPaid,
  actionLoadingId,
  copiedId,
  onCopyLink,
}: PromiseDetailsModalProps) {
  if (!promise) return null;

  return (
    <Modal
      isOpen={!!promise}
      onClose={onClose}
      title="Promise to Pay Details"
      subtitle={`Commitment ID: ${promise.id}`}
      maxWidth="lg"
    >
      <div className="space-y-4 text-xs">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
          <div className="text-sm font-bold text-slate-900">{promise.customerName}</div>
          <div className="text-slate-600 font-mono">Email: {promise.customerEmail}</div>
          {promise.customerPhone && (
            <div className="text-slate-600 font-mono">Phone: {promise.customerPhone}</div>
          )}
          <div className="text-slate-600 font-mono">Entity ID: {promise.entityId}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 border border-slate-200 rounded">
            <div className="text-[11px] text-slate-500 font-medium mb-1">Status</div>
            <Badge type="promiseStatus" value={promise.status}>
              {promise.status.replace("_", " ")}
            </Badge>
          </div>
          <div className="p-3 border border-slate-200 rounded">
            <div className="text-[11px] text-slate-500 font-medium">Promised Amount</div>
            <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
              {formatCurrency(promise.promisedAmount, promise.currency)}
            </div>
          </div>
        </div>

        <div className="p-3 border border-slate-200 rounded space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-500">Created At:</span>
            <span className="text-slate-800 font-medium">{formatDateTime(promise.createdAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Promised Due Date:</span>
            <span className="text-slate-800 font-semibold">{formatDateTime(promise.promisedDate)}</span>
          </div>
          <div className="pt-1 border-t border-slate-100">
            <span className="text-slate-500 block mb-1">Live Countdown:</span>
            <CountdownTimer
              promisedDate={promise.promisedDate}
              gracePeriodUntil={promise.gracePeriodUntil}
              status={promise.status}
            />
          </div>
          {promise.reminderSentAt && (
            <div className="flex justify-between text-slate-600">
              <span>Reminder Sent:</span>
              <span>{formatDateTime(promise.reminderSentAt)}</span>
            </div>
          )}
          {promise.gracePeriodUntil && (
            <div className="flex justify-between text-slate-600">
              <span>Grace Period Until:</span>
              <span>{formatDateTime(promise.gracePeriodUntil)}</span>
            </div>
          )}
        </div>

        {promise.paymentLinkUrl && (
          <div className="p-3 border border-slate-200 rounded space-y-2">
            <div className="text-[11px] uppercase font-semibold text-slate-500">Payment Link</div>
            <div className="font-mono text-[11px] text-slate-700 break-all bg-slate-50 p-2 border border-slate-200 rounded">
              {promise.paymentLinkUrl}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <a
                href={promise.paymentLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
              >
                Open Payment Link →
              </a>
              <button
                type="button"
                onClick={() => onCopyLink(promise.id, promise.paymentLinkUrl)}
                className="px-3 py-1 text-xs border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-50"
              >
                {copiedId === promise.id ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>
        )}

        <div className="p-3 border border-slate-200 rounded space-y-1">
          <div className="text-[11px] uppercase font-semibold text-slate-500">
            Notes & Agreement Context
          </div>
          <div className="text-slate-800 whitespace-pre-wrap leading-relaxed">
            {promise.notes || "No notes recorded for this commitment."}
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <div className="flex items-center gap-2">
            {promise.status === "pending" && (
              <button
                type="button"
                onClick={() => onSendReminder(promise.id)}
                disabled={actionLoadingId === promise.id}
                className="px-3 py-1.5 text-xs border border-amber-300 bg-amber-50 text-amber-800 rounded hover:bg-amber-100 disabled:opacity-50 font-medium"
              >
                {actionLoadingId === promise.id ? "Sending..." : "Send Reminder Email"}
              </button>
            )}
            {promise.status !== "kept" && promise.status !== "cancelled" && (
              <button
                type="button"
                onClick={() => onMarkPaid(promise.id)}
                disabled={actionLoadingId === promise.id}
                className="px-3 py-1.5 text-xs border border-green-300 bg-green-50 text-green-800 rounded hover:bg-green-100 disabled:opacity-50 font-medium"
              >
                Mark as Paid
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 rounded"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
