import React, { useState } from "react";
import { CustomerLookupItem, CreatePromiseInput } from "../types";
import { Modal } from "./Modal";
import { CustomerSearchCombobox } from "./CustomerSearchCombobox";

interface CreatePromiseModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: CustomerLookupItem[];
  onSubmit: (input: CreatePromiseInput) => Promise<void>;
}

export function CreatePromiseModal({
  isOpen,
  onClose,
  customers,
  onSubmit,
}: CreatePromiseModalProps) {
  const [formData, setFormData] = useState({
    customerId: "",
    entityId: "",
    amount: "",
    promisedDate: "",
    notes: "",
    sendEmail: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePresetDays(days: number) {
    const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const str = target.toISOString().split("T")[0];
    setFormData((prev) => ({ ...prev, promisedDate: str }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!formData.customerId) {
      setError("Please select a customer.");
      return;
    }
    const amt = parseFloat(formData.amount);
    if (isNaN(amt) || amt <= 0) {
      setError("Promised amount must be greater than ₹0.");
      return;
    }
    if (!formData.promisedDate) {
      setError("Please select a promised due date.");
      return;
    }
    if (formData.notes && formData.notes.length > 500) {
      setError("Notes cannot exceed 500 characters.");
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit({
        customerId: formData.customerId,
        entityId: formData.entityId || undefined,
        amount: amt,
        promisedDate: new Date(formData.promisedDate).toISOString(),
        notes: formData.notes || undefined,
        sendEmail: formData.sendEmail,
      });
      setFormData({
        customerId: "",
        entityId: "",
        amount: "",
        promisedDate: "",
        notes: "",
        sendEmail: true,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || "Failed to create promise.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Promise to Pay"
      subtitle="Track customer repayment commitments and automate payment link delivery."
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Customer *
          </label>
          <CustomerSearchCombobox
            customers={customers}
            selectedCustomerId={formData.customerId}
            onSelectCustomer={(id) => setFormData((prev) => ({ ...prev, customerId: id }))}
            disabled={submitting}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Associated Entity / Reference ID (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. inv_001, sub_002, cart_003"
            value={formData.entityId}
            onChange={(e) => setFormData({ ...formData, entityId: e.target.value })}
            className="w-full text-sm border border-slate-300 rounded px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 font-mono"
            disabled={submitting}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Promised Amount (₹) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="e.g. 5000"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              className="w-full text-sm border border-slate-300 rounded px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 font-mono"
              required
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Promised Due Date *
            </label>
            <input
              type="date"
              value={formData.promisedDate}
              onChange={(e) => setFormData({ ...formData, promisedDate: e.target.value })}
              className="w-full text-sm border border-slate-300 rounded px-3 py-2 text-slate-900 focus:outline-hidden focus:border-blue-500 font-mono"
              required
              disabled={submitting}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Quick presets:</span>
          {[3, 7, 14, 30].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => handlePresetDays(days)}
              disabled={submitting}
              className="px-2 py-0.5 text-xs rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700"
            >
              +{days} Days
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-slate-700">
              Notes / Agreement Context
            </label>
            <span className="text-xs text-slate-400">
              {formData.notes.length}/500
            </span>
          </div>
          <textarea
            placeholder="e.g. Customer promised on phone call to clear balance by Friday..."
            rows={3}
            maxLength={500}
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full text-sm border border-slate-300 rounded px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-hidden focus:border-blue-500"
            disabled={submitting}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="sendEmailCheckbox"
            checked={formData.sendEmail}
            onChange={(e) => setFormData({ ...formData, sendEmail: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded border-slate-300"
            disabled={submitting}
          />
          <label htmlFor="sendEmailCheckbox" className="text-xs text-slate-700">
            Send instant confirmation email with secure Razorpay payment link
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded border border-slate-300 bg-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            {submitting ? "Saving Commitment..." : "Save Commitment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
