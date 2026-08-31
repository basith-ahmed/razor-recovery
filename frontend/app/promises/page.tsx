"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLiveStream } from "../../lib/socket";
import {
  listPromises,
  getPromiseStats,
  fetchPromiseCustomers,
  createPromise,
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
import { PaginationControl } from "../../components/PaginationControl";
import { PageHeader } from "../../components/PageHeader";
import { Badge } from "../../components/Badge";
import { Plus } from "lucide-react";

export default function PromisesPage() {
  const router = useRouter();
  const { activityFeed } = useLiveStream();
  const [promises, setPromises] = useState<PromiseToPayItem[]>([]);
  const [stats, setStats] = useState<PromiseStats | null>(null);
  const [customers, setCustomers] = useState<CustomerLookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      const [promiseRes, statsRes, custRes] = await Promise.all([
        listPromises({
          status: statusFilter !== "all" ? statusFilter : undefined,
          search: searchQuery || undefined,
          page,
          limit,
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
  }, [statusFilter, searchQuery, page, limit]);

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
    // Navigate to the new promise detail page
    router.push(`/promises/${created.id}`);
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Promise-to-Pay Tracker"
        description="Track, schedule, and automate recovery commitments made by customers."
        actions={
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-1.5 text-xs font-medium bg-primary hover:bg-primary-active active:scale-[0.98] text-white rounded-full transition-all shadow-sm flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Record Promise to Pay
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">
            Active Commitments
          </div>
          <div className="text-2xl font-bold text-ink mt-1 tracking-heading-3">
            {(stats?.pendingCount ?? 0) + (stats?.reminderSentCount ?? 0)}
          </div>
          <div className="text-[11px] text-ink-faint mt-0.5">
            {stats?.reminderSentCount ?? 0} in grace period
          </div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">
            Total Promised Volume
          </div>
          <div className="text-2xl font-bold text-ink mt-1 tracking-heading-3">
            {formatCurrency(stats?.totalPromisedAmount ?? 0)}
          </div>
          <div className="text-[11px] text-ink-faint mt-0.5">
            {stats?.totalCount ?? 0} total records
          </div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">
            Recovered & Kept
          </div>
          <div className="text-2xl font-bold text-accent-green mt-1 tracking-heading-3">
            {formatCurrency(stats?.totalRecoveredAmount ?? 0)}
          </div>
          <div className="text-[11px] text-accent-green mt-0.5">
            {stats?.keptCount ?? 0} paid commitments
          </div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">
            Broken / Escalated
          </div>
          <div className="text-2xl font-bold text-accent-orange-deep mt-1 tracking-heading-3">
            {stats?.brokenCount ?? 0}
          </div>
          <div className="text-[11px] text-accent-orange-deep mt-0.5">
            Auto-escalated to support
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white border border-hairline rounded-[12px] shadow-notion-soft overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
          <div className="flex items-center gap-1.5">
            {["all", "pending", "reminder_sent", "kept", "broken"].map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-ink text-white font-semibold shadow-xs"
                    : "bg-canvas-soft hover:bg-hairline/40 text-ink-secondary border border-hairline"
                }`}
              >
                {s === "all"
                  ? "All"
                  : s
                      .replace("_", " ")
                      .replace(/\b\w/g, (l) => l.toUpperCase())}
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
            className="text-xs border border-hairline-input rounded-[4px] px-3 py-1.5 text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all w-64"
          />
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="text-ink-muted border-b border-hairline bg-canvas-soft text-[11px] font-semibold uppercase tracking-eyebrow">
              <tr>
                <th className="py-2.5 px-3">Customer</th>
                <th className="py-2.5 px-3">Amount</th>
                <th className="py-2.5 px-3">Promised Due Date</th>
                <th className="py-2.5 px-3">Status & Timer</th>
                <th className="py-2.5 px-3">Payment Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-white">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-ink-muted">
                    Loading promises...
                  </td>
                </tr>
              ) : promises.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-ink-muted">
                    No promise-to-pay records found.
                  </td>
                </tr>
              ) : (
                promises.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-canvas-soft cursor-pointer transition-colors"
                    onClick={() => router.push(`/promises/${p.id}`)}
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-ink">
                        {p.customerName}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {p.customerEmail}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-ink">
                      {formatCurrency(p.promisedAmount, p.currency)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-ink">
                        {formatDate(p.promisedDate)}
                      </div>
                      <div className="text-[10px] text-ink-faint">
                        {formatDateTime(p.promisedDate).split(", ")[1]}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="mb-1">
                        <Badge type="promiseStatus" value={p.status}>
                          {p.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <CountdownTimer
                        promisedDate={p.promisedDate}
                        gracePeriodUntil={p.gracePeriodUntil}
                        status={p.status}
                      />
                    </td>
                    <td className="py-2.5 px-3 text-[11px]">
                      {p.paymentLinkUrl ? (
                        <a
                          href={p.paymentLinkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-primary hover:underline truncate max-w-[160px] block"
                        >
                          {p.paymentLinkUrl.replace("https://", "")}
                        </a>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-hairline">
          <PaginationControl
            page={page}
            totalPages={totalPages}
            total={totalItems}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(newLimit) => {
              setLimit(newLimit);
              setPage(1);
            }}
            disabled={loading}
          />
        </div>
      </div>

      <CreatePromiseModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        customers={customers}
        onSubmit={handleCreate}
      />
    </div>
  );
}
