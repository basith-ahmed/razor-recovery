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
            className={`p-3 rounded-[8px] border text-xs ${
              statusMsg.type === "success"
                ? "bg-accent-green/10 text-accent-green border-accent-green/25"
                : "bg-accent-orange/10 text-accent-orange-deep border-accent-orange/25"
            }`}
          >
            {statusMsg.text}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-ink mb-1 font-semibold">To:</label>
            <input
              type="text"
              disabled
              value={`${customerName || "Customer"} <${customerEmail || ""}>`}
              className="w-full px-3 py-2 bg-canvas-soft border border-hairline-input rounded-[4px] text-ink-muted text-xs font-medium"
            />
          </div>

          <div>
            <label className="block text-ink mb-1 font-semibold">Subject:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              className="w-full px-3 py-2 border border-hairline-input rounded-[4px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all text-xs"
              required
            />
          </div>

          <div>
            <label className="block text-ink mb-1 font-semibold">Message:</label>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              className="w-full p-3 border border-hairline-input rounded-[4px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all text-xs"
              required
            />
          </div>

          <div className="flex items-center gap-2 border border-hairline p-2.5 rounded-[6px] bg-canvas-soft">
            <input
              type="checkbox"
              id="includePaymentLinkTicket"
              checked={includePaymentLink}
              onChange={(e) => onIncludePaymentLinkChange(e.target.checked)}
              className="w-4 h-4 accent-primary rounded-[4px] border-hairline-input cursor-pointer"
            />
            <label htmlFor="includePaymentLinkTicket" className="text-ink-secondary cursor-pointer">
              Attach Razorpay recovery payment link ({formatCurrency(amount ?? 0)})
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-hairline">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-3.5 py-1.5 border border-hairline rounded-[8px] text-ink hover:bg-canvas-soft bg-white transition-colors text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="px-4 py-1.5 bg-primary text-white rounded-full hover:bg-primary-active active:scale-[0.98] disabled:opacity-50 font-medium transition-all shadow-sm text-xs"
            >
              {sending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
