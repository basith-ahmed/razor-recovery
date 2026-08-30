"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  listPromises,
  getPromiseStats,
  createPromise,
  sendPromiseReminder,
  updatePromise,
  fetchPromiseCustomers,
} from "../../lib/api";
import {
  PromiseToPayItem,
  PromiseStats,
  CustomerLookupItem,
  PromiseStatus,
} from "../../types";
import { useLiveStream } from "../../lib/socket";

function CountdownTimer({
  promisedDate,
  gracePeriodUntil,
  status,
}: {
  promisedDate: string;
  gracePeriodUntil?: string | null;
  status: PromiseStatus;
}) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isPast: boolean;
  }>({ days: 0, hours: 0, minutes: 0, seconds: 0, isPast: false });

  useEffect(() => {
    function calculate() {
      const targetTime =
        status === "reminder_sent" && gracePeriodUntil
          ? new Date(gracePeriodUntil).getTime()
          : new Date(promisedDate).getTime();

      const now = Date.now();
      const diff = targetTime - now;

      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, isPast: true });
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds, isPast: false });
    }

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [promisedDate, gracePeriodUntil, status]);

  if (status === "kept") {
    return <span className="text-xs text-green-700 font-semibold">Paid & Kept</span>;
  }

  if (status === "broken") {
    return <span className="text-xs text-red-700 font-semibold">Broken (Escalated)</span>;
  }

  if (status === "cancelled") {
    return <span className="text-xs text-slate-500">Cancelled</span>;
  }

  if (status === "reminder_sent") {
    return (
      <div className="text-xs">
        <span className="text-amber-800 font-semibold block">Reminder Sent (Grace Period)</span>
        <span className="text-slate-500 font-mono">
          {timeLeft.isPast
            ? "Grace period expired"
            : `${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s remaining`}
        </span>
      </div>
    );
  }

  // Pending
  return (
    <div className="text-xs font-mono">
      {timeLeft.isPast ? (
        <span className="text-red-700 font-semibold">Due Date Passed</span>
      ) : (
        <span className="text-slate-800 font-semibold">
          {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s left
        </span>
      )}
    </div>
  );
}

export default function PromisesPage() {
  const { activityFeed } = useLiveStream();
  const [promises, setPromises] = useState<PromiseToPayItem[]>([]);
  const [stats, setStats] = useState<PromiseStats | null>(null);
  const [customers, setCustomers] = useState<CustomerLookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPromiseForView, setSelectedPromiseForView] = useState<PromiseToPayItem | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    customerId: "",
    entityId: "",
    amount: "",
    promisedDate: "",
    notes: "",
    sendEmail: true,
  });
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      const [promiseRes, statsRes, custRes] = await Promise.all([
        listPromises({
          status: statusFilter !== "all" ? statusFilter : undefined,
          search: searchQuery || undefined,
          limit: 50,
        }),
        getPromiseStats(),
        fetchPromiseCustomers(),
      ]);
      setPromises(promiseRes.items);
      setStats(statsRes);
      setCustomers(custRes);
    } catch (err) {
      console.error("Failed to load promises data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    loadData();
  }, [activityFeed]);

  function handlePresetDays(days: number) {
    const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const str = target.toISOString().split("T")[0];
    setFormData((prev) => ({ ...prev, promisedDate: str }));
  }

  function handleSelectCustomer(custId: string) {
    setFormData((prev) => ({ ...prev, customerId: custId }));
    setCustomerSearchQuery("");
    setIsCustomerDropdownOpen(false);
  }

  function handleClearCustomer() {
    setFormData((prev) => ({ ...prev, customerId: "" }));
    setCustomerSearchQuery("");
    setIsCustomerDropdownOpen(false);
  }

  const filteredCustomers = useMemo(() => {
    if (!customerSearchQuery.trim()) return customers;
    const q = customerSearchQuery.toLowerCase();
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [customers, customerSearchQuery]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === formData.customerId);
  }, [customers, formData.customerId]);

  async function handleCreatePromise(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!formData.customerId) {
      setFormError("Please select a customer.");
      return;
    }
    const amt = parseFloat(formData.amount);
    if (isNaN(amt) || amt <= 0) {
      setFormError("Promised amount must be greater than ₹0.");
      return;
    }
    if (!formData.promisedDate) {
      setFormError("Please select a promised date.");
      return;
    }
    if (formData.notes && formData.notes.length > 500) {
      setFormError("Notes cannot exceed 500 characters.");
      return;
    }

    try {
      setFormSubmitting(true);
      await createPromise({
        customerId: formData.customerId,
        entityId: formData.entityId || undefined,
        amount: amt,
        promisedDate: new Date(formData.promisedDate).toISOString(),
        notes: formData.notes || undefined,
        sendEmail: formData.sendEmail,
      });

      setIsModalOpen(false);
      setFormData({
        customerId: "",
        entityId: "",
        amount: "",
        promisedDate: "",
        notes: "",
        sendEmail: true,
      });
      setCustomerSearchQuery("");
      await loadData();
    } catch (err: any) {
      console.error("Failed to create promise:", err);
      setFormError(err.response?.data?.error || "Failed to create promise to pay.");
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleSendReminder(id: string) {
    try {
      setActionLoadingId(id);
      const res = await sendPromiseReminder(id);
      if (selectedPromiseForView && selectedPromiseForView.id === id) {
        setSelectedPromiseForView(res.promise);
      }
      await loadData();
    } catch (err) {
      console.error("Failed to send reminder:", err);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleUpdateStatus(id: string, status: string) {
    try {
      setActionLoadingId(id);
      const updated = await updatePromise(id, { status });
      if (selectedPromiseForView && selectedPromiseForView.id === id) {
        setSelectedPromiseForView(updated);
      }
      await loadData();
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setActionLoadingId(null);
    }
  }

  function copyToClipboard(id: string, url?: string | null) {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Promise to Pay Tracker</h1>
          <p className="text-sm text-slate-500">
            Record customer payment commitments, track due dates, and monitor follow-up escalations.
          </p>
        </div>
        <button
          onClick={() => {
            setIsModalOpen(true);
            if (!formData.promisedDate) handlePresetDays(7);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded"
        >
          Record Promise to Pay
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white p-3 border border-slate-200 rounded">
          <div className="text-xs text-slate-500 font-medium">Total Commitments</div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {stats ? stats.totalCount : "—"}
          </div>
          <div className="text-xs text-slate-500 font-mono mt-0.5">
            ₹{stats ? stats.totalPromisedAmount.toLocaleString("en-IN") : "0"}
          </div>
        </div>

        <div className="bg-white p-3 border border-slate-200 rounded">
          <div className="text-xs text-amber-700 font-medium">Active Pending</div>
          <div className="text-xl font-bold text-amber-900 mt-1">
            {stats ? stats.pendingCount : "—"}
          </div>
          <div className="text-xs text-amber-700 mt-0.5">Timer Active</div>
        </div>

        <div className="bg-white p-3 border border-slate-200 rounded">
          <div className="text-xs text-orange-700 font-medium">Reminders Sent</div>
          <div className="text-xl font-bold text-orange-900 mt-1">
            {stats ? stats.reminderSentCount : "—"}
          </div>
          <div className="text-xs text-orange-700 mt-0.5">24h Grace Window</div>
        </div>

        <div className="bg-white p-3 border border-slate-200 rounded">
          <div className="text-xs text-green-700 font-medium">Honored (Kept)</div>
          <div className="text-xl font-bold text-green-900 mt-1">
            {stats ? stats.keptCount : "—"}
          </div>
          <div className="text-xs text-green-700 font-mono mt-0.5">
            ₹{stats ? stats.totalRecoveredAmount.toLocaleString("en-IN") : "0"} Paid
          </div>
        </div>

        <div className="bg-white p-3 border border-slate-200 rounded">
          <div className="text-xs text-red-700 font-medium">Broken (Escalated)</div>
          <div className="text-xl font-bold text-red-900 mt-1">
            {stats ? stats.brokenCount : "—"}
          </div>
          <div className="text-xs text-red-700 mt-0.5">Escalated to Agent</div>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 border border-slate-200 rounded">
        <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
          {[
            { id: "all", label: "All" },
            { id: "pending", label: "Pending" },
            { id: "reminder_sent", label: "Reminder Sent" },
            { id: "kept", label: "Kept (Paid)" },
            { id: "broken", label: "Broken" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1 text-xs rounded font-medium ${
                statusFilter === tab.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search customer, invoice, notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-64 px-3 py-1 text-xs border border-slate-300 rounded text-slate-900"
        />
      </div>

      {/* Commitments Table */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading promises...</div>
        ) : promises.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No Promise-to-Pay commitments found.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="p-3">Customer & Entity</th>
                <th className="p-3">Promised Amount</th>
                <th className="p-3">Promised Due Date</th>
                <th className="p-3">Status & Timer</th>
                <th className="p-3">Payment Link</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {promises.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{item.customerName}</div>
                    <div className="text-slate-500 font-mono text-[11px]">{item.customerEmail}</div>
                    <Link
                      href={`/entities/${item.entityId}`}
                      className="text-blue-600 hover:underline font-mono text-[11px]"
                    >
                      Entity #{item.entityId.slice(-6)}
                    </Link>
                  </td>

                  <td className="p-3 font-mono font-semibold text-slate-900">
                    ₹{item.promisedAmount.toLocaleString("en-IN")}
                  </td>

                  <td className="p-3 text-slate-900 font-medium whitespace-nowrap">
                    {new Date(item.promisedDate).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>

                  <td className="p-3">
                    <CountdownTimer
                      promisedDate={item.promisedDate}
                      gracePeriodUntil={item.gracePeriodUntil}
                      status={item.status}
                    />
                  </td>

                  <td className="p-3">
                    {item.paymentLinkUrl ? (
                      <div className="flex items-center gap-2">
                        <a
                          href={item.paymentLinkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Open Link
                        </a>
                        <button
                          onClick={() => copyToClipboard(item.id, item.paymentLinkUrl)}
                          className="text-slate-500 hover:text-slate-700 text-xs cursor-pointer"
                        >
                          {copiedId === item.id ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedPromiseForView(item)}
                        className="px-2 py-1 text-xs border border-slate-300 bg-white text-slate-700 rounded hover:bg-slate-100 font-medium"
                      >
                        View
                      </button>

                      {item.status === "pending" && (
                        <button
                          onClick={() => handleSendReminder(item.id)}
                          disabled={actionLoadingId === item.id}
                          className="px-2 py-1 text-xs border border-amber-300 bg-amber-50 text-amber-800 rounded hover:bg-amber-100 disabled:opacity-50"
                        >
                          {actionLoadingId === item.id ? "Sending..." : "Reminder"}
                        </button>
                      )}

                      {item.status !== "kept" && item.status !== "cancelled" && (
                        <button
                          onClick={() => handleUpdateStatus(item.id, "kept")}
                          disabled={actionLoadingId === item.id}
                          className="px-2 py-1 text-xs border border-green-300 bg-green-50 text-green-800 rounded hover:bg-green-100 disabled:opacity-50"
                        >
                          Mark Paid
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Promise Details Modal */}
      {selectedPromiseForView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded border border-slate-200 max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Promise-to-Pay Details</h2>
                <span className="text-xs text-slate-500 font-mono">
                  ID: {selectedPromiseForView.id}
                </span>
              </div>
              <button
                onClick={() => setSelectedPromiseForView(null)}
                className="text-slate-500 hover:text-slate-800 text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Customer Info */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
                <div className="text-[11px] uppercase font-semibold text-slate-500">Customer</div>
                <div className="text-sm font-bold text-slate-900">
                  {selectedPromiseForView.customerName}
                </div>
                <div className="text-slate-600 font-mono">
                  Email: {selectedPromiseForView.customerEmail}
                </div>
                {selectedPromiseForView.customerPhone && (
                  <div className="text-slate-600 font-mono">
                    Phone: {selectedPromiseForView.customerPhone}
                  </div>
                )}
                <div className="text-slate-600 font-mono">
                  Entity ID: {selectedPromiseForView.entityId}
                </div>
              </div>

              {/* Status & Amount */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 border border-slate-200 rounded">
                  <div className="text-[11px] text-slate-500 font-medium">Status</div>
                  <div className="text-sm font-bold text-slate-900 mt-1 capitalize">
                    {selectedPromiseForView.status.replace("_", " ")}
                  </div>
                </div>
                <div className="p-3 border border-slate-200 rounded">
                  <div className="text-[11px] text-slate-500 font-medium">Promised Amount</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-1">
                    ₹{selectedPromiseForView.promisedAmount.toLocaleString("en-IN")} {selectedPromiseForView.currency}
                  </div>
                </div>
              </div>

              {/* Dates & Countdown */}
              <div className="p-3 border border-slate-200 rounded space-y-2">
                <div>
                  <span className="text-slate-500">Created At: </span>
                  <span className="text-slate-800 font-medium">
                    {new Date(selectedPromiseForView.createdAt).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Promised Due Date: </span>
                  <span className="text-slate-800 font-semibold">
                    {new Date(selectedPromiseForView.promisedDate).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">Live Countdown:</span>
                  <CountdownTimer
                    promisedDate={selectedPromiseForView.promisedDate}
                    gracePeriodUntil={selectedPromiseForView.gracePeriodUntil}
                    status={selectedPromiseForView.status}
                  />
                </div>
                {selectedPromiseForView.reminderSentAt && (
                  <div>
                    <span className="text-slate-500">Reminder Sent: </span>
                    <span className="text-slate-800">
                      {new Date(selectedPromiseForView.reminderSentAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {selectedPromiseForView.gracePeriodUntil && (
                  <div>
                    <span className="text-slate-500">Grace Period Until: </span>
                    <span className="text-slate-800">
                      {new Date(selectedPromiseForView.gracePeriodUntil).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Payment Link */}
              {selectedPromiseForView.paymentLinkUrl && (
                <div className="p-3 border border-slate-200 rounded space-y-1.5">
                  <div className="text-[11px] uppercase font-semibold text-slate-500">
                    Payment Link
                  </div>
                  <div className="font-mono text-[11px] text-slate-700 break-all bg-white p-2 border border-slate-200 rounded">
                    {selectedPromiseForView.paymentLinkUrl}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={selectedPromiseForView.paymentLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
                    >
                      Open Payment Link →
                    </a>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedPromiseForView.id, selectedPromiseForView.paymentLinkUrl)}
                      className="px-2.5 py-1 text-xs border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-100"
                    >
                      {copiedId === selectedPromiseForView.id ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                </div>
              )}

              {/* Full Unabridged Notes */}
              <div className="p-3 border border-slate-200 rounded space-y-1">
                <div className="text-[11px] uppercase font-semibold text-slate-500">Notes & Agreement Context</div>
                <div className="text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selectedPromiseForView.notes || "No notes recorded for this commitment."}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2">
                {selectedPromiseForView.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => handleSendReminder(selectedPromiseForView.id)}
                    disabled={actionLoadingId === selectedPromiseForView.id}
                    className="px-3 py-1.5 text-xs border border-amber-300 bg-amber-50 text-amber-800 rounded hover:bg-amber-100 disabled:opacity-50 font-medium"
                  >
                    {actionLoadingId === selectedPromiseForView.id ? "Sending..." : "Send Reminder Email"}
                  </button>
                )}
                {selectedPromiseForView.status !== "kept" && selectedPromiseForView.status !== "cancelled" && (
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(selectedPromiseForView.id, "kept")}
                    disabled={actionLoadingId === selectedPromiseForView.id}
                    className="px-3 py-1.5 text-xs border border-green-300 bg-green-50 text-green-800 rounded hover:bg-green-100 disabled:opacity-50 font-medium"
                  >
                    Mark as Paid
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedPromiseForView(null)}
                className="px-3 py-1.5 text-xs border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Promise Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Record Promise to Pay</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-500 hover:text-slate-800 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePromise} className="space-y-3">
              {formError && (
                <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
                  {formError}
                </div>
              )}

              {/* Searchable Customer Combobox */}
              <div className="relative">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer *
                </label>

                {selectedCustomer ? (
                  <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-300 rounded text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">{selectedCustomer.name}</div>
                      <div className="text-slate-500 font-mono text-[11px]">{selectedCustomer.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearCustomer}
                      className="px-2 py-1 text-[11px] border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-100 font-medium"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="Type customer name or email to search..."
                      value={customerSearchQuery}
                      onChange={(e) => {
                        setCustomerSearchQuery(e.target.value);
                        setIsCustomerDropdownOpen(true);
                      }}
                      onFocus={() => setIsCustomerDropdownOpen(true)}
                      className="w-full text-xs border border-slate-300 rounded p-2 text-slate-900"
                    />

                    {isCustomerDropdownOpen && (
                      <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-300 rounded shadow-md divide-y divide-slate-100">
                        {filteredCustomers.length === 0 ? (
                          <div className="p-2.5 text-xs text-slate-500 text-center">
                            No customers match &quot;{customerSearchQuery}&quot;
                          </div>
                        ) : (
                          filteredCustomers.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => handleSelectCustomer(c.id)}
                              className="w-full text-left p-2.5 hover:bg-slate-50 text-xs block"
                            >
                              <div className="font-semibold text-slate-900">{c.name}</div>
                              <div className="text-slate-500 font-mono text-[11px]">{c.email}</div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Promised Amount */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Promised Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Enter amount (e.g. 5000)"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full text-xs border border-slate-300 rounded p-2 text-slate-900 font-mono"
                  required
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
                  className="w-full text-xs border border-slate-300 rounded p-2 text-slate-900 font-mono"
                  required
                />
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] text-slate-500">Quick presets:</span>
                  {[3, 7, 14, 30].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => handlePresetDays(days)}
                      className="px-2 py-0.5 text-[11px] rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                    >
                      +{days} Days
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Notes / Agreement Details
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {formData.notes.length}/500
                  </span>
                </div>
                <textarea
                  placeholder="e.g. Customer promised on call to clear balance by Friday..."
                  rows={3}
                  maxLength={500}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full text-xs border border-slate-300 rounded p-2 text-slate-900"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="sendEmail"
                  checked={formData.sendEmail}
                  onChange={(e) => setFormData({ ...formData, sendEmail: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="sendEmail" className="text-xs text-slate-700">
                  Send confirmation email with Razorpay payment link
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50"
                >
                  {formSubmitting ? "Creating..." : "Save Commitment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
