import React, { useState, useEffect } from "react";
import { CustomerLookupItem, CustomerEntityLookupItem, CreatePromiseInput } from "../types";
import { Modal } from "./Modal";
import { CustomerSearchCombobox } from "./CustomerSearchCombobox";
import { EntitySearchCombobox } from "./EntitySearchCombobox";
import { fetchCustomerEntities } from "../lib/api";

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
  const [customerEntities, setCustomerEntities] = useState<CustomerEntityLookupItem[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load customer's associated entities whenever selected customer changes
  useEffect(() => {
    if (!formData.customerId) {
      setCustomerEntities([]);
      setFormData((prev) => ({ ...prev, entityId: "", amount: "" }));
      return;
    }

    let ignore = false;
    setLoadingEntities(true);
    fetchCustomerEntities(formData.customerId)
      .then((list) => {
        if (!ignore) {
          setCustomerEntities(list);
          setLoadingEntities(false);
          // If customer has exactly 1 entity, auto-select it and populate amount
          if (list.length === 1) {
            setFormData((prev) => ({
              ...prev,
              entityId: list[0].entityId,
              amount: String(list[0].amount),
            }));
          }
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to load customer entities:", err);
          setCustomerEntities([]);
          setLoadingEntities(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [formData.customerId]);

  function handleSelectEntity(entityIdVal: string) {
    if (!entityIdVal) {
      setFormData((prev) => ({ ...prev, entityId: "" }));
      return;
    }

    const matched = customerEntities.find((e) => e.entityId === entityIdVal);
    if (matched) {
      setFormData((prev) => ({
        ...prev,
        entityId: matched.entityId,
        amount: String(matched.amount),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        entityId: entityIdVal,
      }));
    }
  }

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
          <div className="p-3 bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep text-xs rounded-[8px]">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
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
          <label className="block text-xs font-semibold text-ink mb-1">
            Associated Entity / Reference ID (Optional)
          </label>
          <EntitySearchCombobox
            entities={customerEntities}
            selectedEntityId={formData.entityId}
            onSelectEntity={handleSelectEntity}
            disabled={submitting}
            loading={loadingEntities}
            hasCustomerSelected={Boolean(formData.customerId)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Promised Amount (₹) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="e.g. 5000"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              className="w-full text-xs border border-hairline-input rounded-[4px] px-3 py-2 text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all font-medium"
              required
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Promised Due Date *
            </label>
            <input
              type="date"
              value={formData.promisedDate}
              onChange={(e) => setFormData({ ...formData, promisedDate: e.target.value })}
              className="w-full text-xs border border-hairline-input rounded-[4px] px-3 py-2 text-ink focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
              required
              disabled={submitting}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">Quick presets:</span>
          {[3, 7, 14, 30].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => handlePresetDays(days)}
              disabled={submitting}
              className="px-2.5 py-0.5 text-xs rounded-full border border-hairline bg-canvas-soft hover:bg-hairline/40 text-ink transition-colors font-medium"
            >
              +{days} Days
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-ink">
              Notes / Agreement Context
            </label>
            <span className="text-xs text-ink-faint">
              {formData.notes.length}/500
            </span>
          </div>
          <textarea
            placeholder="e.g. Customer promised on phone call to clear balance by Friday..."
            rows={3}
            maxLength={500}
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full text-xs border border-hairline-input rounded-[4px] px-3 py-2 text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
            disabled={submitting}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="sendEmailCheckbox"
            checked={formData.sendEmail}
            onChange={(e) => setFormData({ ...formData, sendEmail: e.target.checked })}
            className="w-4 h-4 accent-primary rounded-[4px] border-hairline-input cursor-pointer"
            disabled={submitting}
          />
          <label htmlFor="sendEmailCheckbox" className="text-xs text-ink-secondary cursor-pointer">
            Send instant confirmation email with secure Razorpay payment link
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3.5 py-1.5 text-xs font-medium text-ink hover:bg-canvas-soft rounded-[8px] border border-hairline bg-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-xs font-medium bg-primary hover:bg-primary-active active:scale-[0.98] text-white rounded-full transition-all shadow-sm disabled:opacity-50"
          >
            {submitting ? "Saving Commitment..." : "Save Commitment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
