"use client";

import { useRouter } from "next/navigation";
import { EntityItem, EntityFilters } from "../types";
import { formatCurrency, formatDateTime } from "../lib/formatters";
import { Badge } from "./Badge";
import { PaginationControl } from "./PaginationControl";

interface EntityTableProps {
  entities: EntityItem[];
  filters: EntityFilters;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  onFilterChange: (newFilters: Partial<EntityFilters>) => void;
  loading: boolean;
}

export function EntityTable({
  entities,
  filters,
  pagination,
  onFilterChange,
  loading,
}: EntityTableProps) {
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
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Search</label>
          <input
            type="text"
            placeholder="Name, email, ID..."
            value={filters.search || ""}
            onChange={(e) => onFilterChange({ search: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">State</label>
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

        <div>
          <label className="block text-xs text-slate-500 mb-1">Cause</label>
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
            <option value="mandate_execution_failed_retryable">
              Mandate: Retryable Failure
            </option>
            <option value="mandate_requires_reauthorization">
              Mandate: Re-auth Required
            </option>
            <option value="invoice_overdue">Invoice Overdue</option>
            <option value="invoice_disputed">Invoice Disputed</option>
            <option value="dnc">Do Not Contact</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">
            Event Type
          </label>
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

        <div>
          <label className="block text-xs text-slate-500 mb-1">
            Min Amount (₹)
          </label>
          <input
            type="number"
            placeholder="0"
            value={filters.minAmount || ""}
            onChange={(e) => onFilterChange({ minAmount: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">
            Max Amount (₹)
          </label>
          <input
            type="number"
            placeholder="100000"
            value={filters.maxAmount || ""}
            onChange={(e) => onFilterChange({ maxAmount: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <th className="p-3 font-medium">Customer / Entity</th>
              <th className="p-3 font-medium">Event Type</th>
              <th
                className="p-3 font-medium cursor-pointer hover:text-slate-900"
                onClick={() => handleSortToggle("amount")}
              >
                Amount{" "}
                {filters.sort?.startsWith("amount")
                  ? filters.sort.endsWith("desc")
                    ? "↓"
                    : "↑"
                  : ""}
              </th>
              <th className="p-3 font-medium">State</th>
              <th className="p-3 font-medium">Stage</th>
              <th
                className="p-3 font-medium cursor-pointer hover:text-slate-900"
                onClick={() => handleSortToggle("riskScore")}
              >
                Risk Score{" "}
                {filters.sort?.startsWith("riskScore")
                  ? filters.sort.endsWith("desc")
                    ? "↓"
                    : "↑"
                  : ""}
              </th>
              <th className="p-3 font-medium">Attempts</th>
              <th className="p-3 font-medium">Action</th>
              <th
                className="p-3 font-medium cursor-pointer hover:text-slate-900"
                onClick={() => handleSortToggle("occurredAt")}
              >
                Occurred At{" "}
                {filters.sort?.startsWith("occurredAt")
                  ? filters.sort.endsWith("desc")
                    ? "↓"
                    : "↑"
                  : ""}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center py-6 text-slate-500">
                  Loading entities...
                </td>
              </tr>
            ) : entities.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-6 text-slate-500">
                  No revenue entities found matching filters.
                </td>
              </tr>
            ) : (
              entities.map((item) => (
                <tr
                  key={item.entityId || item.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => router.push(`/entities/${item.entityId || item.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      router.push(`/entities/${item.entityId || item.id}`);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open audit trail for ${item.customerName}`}
                >
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">
                      {item.customerName}
                    </div>
                    <div className="text-slate-500 text-[11px] font-mono">
                      {item.customerEmail}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] border border-slate-200">
                        {item.eventType}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 font-mono font-semibold text-emerald-700">
                    {formatCurrency(item.amount)}
                  </td>
                  <td className="p-3">
                    <Badge type="state" value={item.state} />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {!(item.stage === "DETECTED" && item.state === "DETECTED") && (
                        <Badge type="stage" value={item.stage} />
                      )}
                    </div>
                  </td>
                  <td className="p-3 font-mono">
                    {item.riskScore !== null ? (
                      <span
                        className={
                          item.riskScore > 0.7
                            ? "text-red-700 font-semibold"
                            : item.riskScore > 0.4
                              ? "text-amber-700 font-semibold"
                              : "text-emerald-700 font-semibold"
                        }
                      >
                        {(item.riskScore * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-slate-500">N/A</span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-slate-700">
                    {item.attemptCount}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.actionResult ? (
                        <Badge type="actionResult" value={item.actionResult} />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-slate-500 font-mono">
                    {formatDateTime(item.occurredAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-200">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span>Per page:</span>
            <select
              value={limit}
              onChange={(e) =>
                onFilterChange({ limit: parseInt(e.target.value, 10), page: 1 })
              }
              className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <div className="w-full sm:w-auto">
          <PaginationControl
            page={page}
            totalPages={totalPages}
            total={total}
            limit={limit}
            onPageChange={(newPage) => onFilterChange({ page: newPage })}
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
}
