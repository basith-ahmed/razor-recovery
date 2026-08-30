"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLiveStream } from "../../lib/socket";
import {
  listPromises,
  getPromiseStats,
  fetchPromiseCustomers,
  createPromise,
  sendPromiseReminder,
  updatePromise,
} from "../../lib/api";
import {
  PromiseToPayItem,
  PromiseStats,
  CustomerLookupItem,
  CreatePromiseInput,
} from "../../types";
import { formatCurrency, formatDate, formatDateTime } from "../../lib/formatters";
import { CountdownTimer } from "../../components/CountdownTimer";
import { CreatePromiseModal } from "../../components/CreatePromiseModal";
import { PromiseDetailsModal } from "../../components/PromiseDetailsModal";
import { PaginationControl } from "../../components/PaginationControl";

export default function PromisesPage() {
  const { activityFeed } = useLiveStream();
  const [promises, setPromises] = useState<PromiseToPayItem[]>([]);
  const [stats, setStats] = useState<PromiseStats | null>(null);
  const [customers, setCustomers] = useState<CustomerLookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPromiseForView, setSelectedPromiseForView] = useState<PromiseToPayItem | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      const [promiseRes, statsRes, custRes] = await Promise.all([
        listPromises({
          status: statusFilter !== "all" ? statusFilter : undefined,
          search: searchQuery || undefined,
          page,
          limit: 20,
        }),
        getPromiseStats(),
        fetchPromiseCustomers(),
      ]);
      setPromises(promiseRes.items);
      setTotalPages(promiseRes.totalPages);
      setTotalItems(promiseRes.total);
      setStats(statsRes);
      setCustomers(custRes);
    } catch (err) {
      console.error("Failed to load promise data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, searchQuery, page]);

  useEffect(() => {
    if (activityFeed && activityFeed.length > 0) {
      getPromiseStats()
        .then((s) => setStats(s))
        .catch((err) => console.error(err));
    }
  }, [activityFeed]);

  async function handleCreate(input: CreatePromiseInput) {
    const created = await createPromise(input);
    setPromises((prev) => [created, ...prev]);
    const statsRes = await getPromiseStats();
    setStats(statsRes);
  }

  async function handleSendReminder(id: string) {
    try {
      setActionLoadingId(id);
      const res = await sendPromiseReminder(id);
      setPromises((prev) => prev.map((p) => (p.id === id ? res.promise : p)));
      if (selectedPromiseForView?.id === id) {
        setSelectedPromiseForView(res.promise);
      }
    } catch (err) {
      console.error("Failed to send reminder:", err);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleMarkPaid(id: string) {
    try {
      setActionLoadingId(id);
      const updated = await updatePromise(id, { status: "kept" });
      setPromises((prev) => prev.map((p) => (p.id === id ? updated : p)));
      if (selectedPromiseForView?.id === id) {
        setSelectedPromiseForView(updated);
      }
      const statsRes = await getPromiseStats();
      setStats(statsRes);
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setActionLoadingId(null);
    }
  }

  function handleCopyLink(id: string, url?: string | null) {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Promise-to-Pay Tracker</h1>
          <p className="text-xs text-slate-500 mt-1">
            Track, schedule, and automate recovery commitments made by customers.
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          + Record Promise to Pay
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Active Commitments</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {(stats?.pendingCount ?? 0) + (stats?.reminderSentCount ?? 0)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {stats?.reminderSentCount ?? 0} in grace period
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Total Promised Volume</div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {formatCurrency(stats?.totalPromisedAmount ?? 0)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Across {stats?.totalCount ?? 0} total records</div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Recovered & Kept</div>
          <div className="text-2xl font-bold font-mono text-emerald-600 mt-1">
            {formatCurrency(stats?.totalRecoveredAmount ?? 0)}
          </div>
          <div className="text-[11px] text-emerald-700 mt-0.5">{stats?.keptCount ?? 0} paid commitments</div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Broken / Escalated</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{stats?.brokenCount ?? 0}</div>
          <div className="text-[11px] text-red-700 mt-0.5">Auto-escalated to support</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {["all", "pending", "reminder_sent", "kept", "broken"].map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                className={`px-3 py-1 text-xs rounded font-medium ${
                  statusFilter === s
                    ? "bg-blue-600 text-white"
                    : "bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200"
                }`}
              >
                {s === "all" ? "All" : s.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search customer, email, entity..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-900 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 w-64"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="text-slate-500 border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="py-2.5 px-3">Customer</th>
                <th className="py-2.5 px-3">Entity</th>
                <th className="py-2.5 px-3">Amount</th>
                <th className="py-2.5 px-3">Promised Due Date</th>
                <th className="py-2.5 px-3">Status & Timer</th>
                <th className="py-2.5 px-3">Payment Link</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">
                    Loading promises...
                  </td>
                </tr>
              ) : promises.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">
                    No promise-to-pay records found.
                  </td>
                </tr>
              ) : (
                promises.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">{p.customerName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{p.customerEmail}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">
                      <Link href={`/entities/${p.entityId}`} className="text-blue-600 hover:underline">
                        {p.entityId}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                      {formatCurrency(p.promisedAmount, p.currency)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-800">{formatDate(p.promisedDate)}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {formatDateTime(p.promisedDate).split(", ")[1]}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <CountdownTimer
                        promisedDate={p.promisedDate}
                        gracePeriodUntil={p.gracePeriodUntil}
                        status={p.status}
                      />
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {p.paymentLinkUrl ? (
                        <div className="flex items-center gap-1.5">
                          <a
                            href={p.paymentLinkUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline truncate max-w-[140px]"
                          >
                            {p.paymentLinkUrl.replace("https://", "")}
                          </a>
                          <button
                            type="button"
                            onClick={() => handleCopyLink(p.id, p.paymentLinkUrl)}
                            className="text-[10px] text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-1 py-0.5 bg-white"
                          >
                            {copiedId === p.id ? "✓" : "Copy"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedPromiseForView(p)}
                          className="px-2.5 py-1 text-[11px] font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded"
                        >
                          View
                        </button>
                        {p.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => handleSendReminder(p.id)}
                            disabled={actionLoadingId === p.id}
                            className="px-2.5 py-1 text-[11px] font-medium border border-amber-300 bg-amber-50 text-amber-800 rounded hover:bg-amber-100 disabled:opacity-50"
                          >
                            Remind
                          </button>
                        )}
                        {p.status !== "kept" && p.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => handleMarkPaid(p.id)}
                            disabled={actionLoadingId === p.id}
                            className="px-2.5 py-1 text-[11px] font-medium border border-emerald-300 bg-emerald-50 text-emerald-800 rounded hover:bg-emerald-100 disabled:opacity-50"
                          >
                            Mark Paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationControl
          page={page}
          totalPages={totalPages}
          total={totalItems}
          limit={20}
          onPageChange={setPage}
          disabled={loading}
        />
      </div>

      <CreatePromiseModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        customers={customers}
        onSubmit={handleCreate}
      />

      <PromiseDetailsModal
        promise={selectedPromiseForView}
        onClose={() => setSelectedPromiseForView(null)}
        onSendReminder={handleSendReminder}
        onMarkPaid={handleMarkPaid}
        actionLoadingId={actionLoadingId}
        copiedId={copiedId}
        onCopyLink={handleCopyLink}
      />
    </div>
  );
}
