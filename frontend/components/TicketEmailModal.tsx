import React from "react";
import { Modal } from "./Modal";
import { formatCurrency } from "../lib/formatters";

interface TicketEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName?: string;
  customerEmail?: string;
  amount?: number;
  subject: string;
  onSubjectChange: (s: string) => void;
  message: string;
  onMessageChange: (m: string) => void;
  includePaymentLink: boolean;
  onIncludePaymentLinkChange: (b: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  sending: boolean;
  statusMsg: { text: string; type: "success" | "error" } | null;
}

export function TicketEmailModal({
  isOpen,
  onClose,
  customerName,
  customerEmail,
  amount,
  subject,
  onSubjectChange,
  message,
  onMessageChange,
  includePaymentLink,
  onIncludePaymentLinkChange,
  onSubmit,
  sending,
  statusMsg,
}: TicketEmailModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Send Direct Support Outreach"
      subtitle="Send a personalized resolution email with optional recovery payment link."
      maxWidth="md"
    >
      <div className="space-y-3 text-xs">
        {statusMsg && (
          <div
            className={`p-2 rounded border text-xs ${
              statusMsg.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            {statusMsg.text}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-slate-600 mb-1 font-medium">To:</label>
            <input
              type="text"
              disabled
              value={`${customerName || "Customer"} <${customerEmail || ""}>`}
              className="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded text-slate-600 font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1 font-medium">Subject:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-slate-900 focus:outline-hidden focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1 font-medium">Message:</label>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              className="w-full p-3 border border-slate-300 rounded text-slate-900 focus:outline-hidden focus:border-blue-500"
              required
            />
          </div>

          <div className="flex items-center gap-2 border border-slate-200 p-2 rounded bg-slate-50">
            <input
              type="checkbox"
              id="includePaymentLinkTicket"
              checked={includePaymentLink}
              onChange={(e) => onIncludePaymentLinkChange(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-slate-300"
            />
            <label htmlFor="includePaymentLinkTicket" className="text-slate-700 cursor-pointer">
              Attach Razorpay recovery payment link ({formatCurrency(amount ?? 0)})
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 bg-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {sending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
