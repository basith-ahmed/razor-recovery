"use client";

import { useRouter } from "next/navigation";
import { EntityItem, EntityFilters } from "../types";

interface EntityTableProps {
  entities: EntityItem[];
  filters: EntityFilters;
  pagination?: { total: number; page: number; limit: number; totalPages: number };
  onFilterChange: (newFilters: Partial<EntityFilters>) => void;
  loading: boolean;
}

const STATE_BADGES: Record<string, string> = {
  DETECTED: "bg-slate-100 text-slate-700 border-slate-300",
  CONTACTED: "bg-blue-50 text-blue-700 border-blue-200",
  RETRYING: "bg-blue-50 text-blue-700 border-blue-200",
  COOLING_DOWN: "bg-amber-50 text-amber-700 border-amber-200",
  ESCALATED: "bg-purple-50 text-purple-700 border-purple-200",
  RECOVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WRITTEN_OFF: "bg-red-50 text-red-700 border-red-200",
  DO_NOT_CONTACT: "bg-white text-slate-500 border-slate-300",
};

const STAGE_BADGES: Record<string, string> = {
  DETECTED: "bg-slate-100 text-slate-600 border-slate-300",
  DIAGNOSED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  DECIDED: "bg-cyan-50 text-cyan-700 border-cyan-200",
  EXECUTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const ACTION_RESULT_BADGES: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  scheduled: "bg-indigo-50 text-indigo-700 border-indigo-200",
  dispatched: "bg-cyan-50 text-cyan-700 border-cyan-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-300",
  skipped: "bg-slate-100 text-slate-500 border-slate-300",
  failed: "bg-red-50 text-red-700 border-red-200",
};

export function EntityTable({ entities, filters, pagination, onFilterChange, loading }: EntityTableProps) {
  const router = useRouter();
  const handleSortToggle = (field: string) => {
    let newSort = `${field}_desc`;
    if (filters.sort === `${field}_desc`) {
      newSort = `${field}_asc`;
    } else if (filters.sort === `${field}_asc`) {
      newSort = "";
    }
    onFilterChange({ sort: newSort });
  };

  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 20;
  const totalPages = pagination?.totalPages ?? 1;
  const total = pagination?.total ?? entities.length;
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        {/* Search */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Search</label>
          <input
            type="text"
            placeholder="Name, email, ID..."
            value={filters.search || ""}
            onChange={(e) => onFilterChange({ search: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* State */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">State</label>
          <select
            value={filters.state || ""}
            onChange={(e) => onFilterChange({ state: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          >
            <option value="">All States</option>
            <option value="DETECTED">DETECTED</option>
            <option value="CONTACTED">CONTACTED</option>
            <option value="RETRYING">RETRYING</option>
            <option value="COOLING_DOWN">COOLING_DOWN</option>
            <option value="ESCALATED">ESCALATED</option>
            <option value="RECOVERED">RECOVERED</option>
            <option value="WRITTEN_OFF">WRITTEN_OFF</option>
            <option value="DO_NOT_CONTACT">DO_NOT_CONTACT</option>
          </select>
        </div>

        {/* Cause */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Cause</label>
          <select
            value={filters.cause || ""}
            onChange={(e) => onFilterChange({ cause: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Causes</option>
            <option value="expired_card">Expired Card</option>
            <option value="insufficient_funds">Insufficient Funds</option>
            <option value="gateway_timeout">Gateway Timeout</option>
            <option value="price_friction">Price Friction</option>
            <option value="no_reason_signal">No Reason Signal</option>
            <option value="subscription_renewal_failed">Sub Renewal Failed</option>
            <option value="invoice_overdue">Invoice Overdue</option>
            <option value="invoice_disputed">Invoice Disputed</option>
            <option value="dnc">Do Not Contact</option>
          </select>
        </div>

        {/* Event Type */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Event Type</label>
          <select
            value={filters.eventType || ""}
            onChange={(e) => onFilterChange({ eventType: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Event Types</option>
            <option value="PAYMENT_FAILED">PAYMENT_FAILED</option>
            <option value="SUBSCRIPTION_FAILED">SUBSCRIPTION_FAILED</option>
            <option value="INVOICE_OVERDUE">INVOICE_OVERDUE</option>
            <option value="CHECKOUT_ABANDONED">CHECKOUT_ABANDONED</option>
          </select>
        </div>

        {/* Min Amount */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Min Amount (₹)</label>
          <input
            type="number"
            placeholder="0"
            value={filters.minAmount || ""}
            onChange={(e) => onFilterChange({ minAmount: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Max Amount */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Max Amount (₹)</label>
          <input
            type="number"
            placeholder="100000"
            value={filters.maxAmount || ""}
            onChange={(e) => onFilterChange({ maxAmount: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-400 border-b border-slate-200">
              <th className="p-3 font-medium">Customer / Entity</th>
              <th className="p-3 font-medium">Event Type</th>
              <th
                className="p-3 font-medium cursor-pointer hover:text-slate-900"
                onClick={() => handleSortToggle("amount")}
              >
                Amount {filters.sort?.startsWith("amount") ? (filters.sort.endsWith("desc") ? "↓" : "↑") : ""}
              </th>
              <th className="p-3 font-medium">State</th>
              <th className="p-3 font-medium">Stage</th>
              <th
                className="p-3 font-medium cursor-pointer hover:text-slate-900"
                onClick={() => handleSortToggle("riskScore")}
              >
                Risk Score {filters.sort?.startsWith("riskScore") ? (filters.sort.endsWith("desc") ? "↓" : "↑") : ""}
              </th>
              <th className="p-3 font-medium">Attempts</th>
              <th className="p-3 font-medium">Action</th>
              <th
                className="p-3 font-medium cursor-pointer hover:text-slate-900"
                onClick={() => handleSortToggle("occurredAt")}
              >
                Occurred At {filters.sort?.startsWith("occurredAt") ? (filters.sort.endsWith("desc") ? "↓" : "↑") : ""}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60">
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
                  Loading entities...
                </td>
              </tr>
            ) : entities.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
                  No revenue entities found matching filters.
                </td>
              </tr>
            ) : (
              entities.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer hover:bg-slate-100/50 transition-colors"
                  onClick={() => router.push(`/entities/${item.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      router.push(`/entities/${item.id}`);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open audit trail for ${item.customerName}`}
                >
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{item.customerName}</div>
                    <div className="text-slate-400 text-[11px] font-mono">{item.customerEmail}</div>
                  </td>
                  <td className="p-3">
                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono text-[10px]">
                      {item.eventType}
                    </span>
                  </td>
                  <td className="p-3 font-mono font-semibold text-emerald-700">
                    ₹{item.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${STATE_BADGES[item.state] || STATE_BADGES.DETECTED}`}>
                      {item.state}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Hide the stage echo when it adds nothing beyond the
                          lifecycle state (both DETECTED) */}
                      {!(item.stage === "DETECTED" && item.state === "DETECTED") && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            STAGE_BADGES[item.stage] || STAGE_BADGES.DETECTED
                          }`}
                        >
                          {item.stage}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 font-mono">
                    {item.riskScore !== null ? (
                      <span className={item.riskScore > 0.7 ? "text-red-700" : item.riskScore > 0.4 ? "text-amber-700" : "text-emerald-700"}>
                        {(item.riskScore * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-slate-500">N/A</span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-slate-700">{item.attemptCount}</td>
                  <td className="p-3">
                    {item.actionResult ? (
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          ACTION_RESULT_BADGES[item.actionResult] ??
                          "bg-slate-100 text-slate-600 border-slate-300"
                        }`}
                        title={item.actionType ?? undefined}
                      >
                        {item.actionResult}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-400 font-mono">
                    {new Date(item.occurredAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-200">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>
            Showing <strong className="text-slate-700">{startItem}</strong>–<strong className="text-slate-700">{endItem}</strong> of <strong className="text-slate-700">{total}</strong> items
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            <span>Per page:</span>
            <select
              value={limit}
              onChange={(e) => onFilterChange({ limit: parseInt(e.target.value, 10), page: 1 })}
              className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono mr-1">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page <= 1 || loading}
            onClick={() => onFilterChange({ page: Math.max(1, page - 1) })}
            className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs px-3 py-1 rounded transition-colors font-medium"
          >
            Previous
          </button>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => onFilterChange({ page: page + 1 })}
            className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs px-3 py-1 rounded transition-colors font-medium"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
