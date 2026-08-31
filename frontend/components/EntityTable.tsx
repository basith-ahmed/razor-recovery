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
    onFilterChange({ sort: newSort, page: 1 });
  };

  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 20;
  const totalPages = pagination?.totalPages ?? 1;
  const total = pagination?.total ?? entities.length;

  return (
    <div className="bg-white border border-hairline rounded-[12px] shadow-notion-soft overflow-hidden">
      {/* Dropdown Selectors & Search Toolbar */}
      <div className="p-4 border-b border-hairline bg-white">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1">
              Search
            </label>
            <input
              type="text"
              placeholder="Name, email, ID..."
              value={filters.search || ""}
              onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
              className="w-full bg-white border border-hairline-input rounded-[4px] px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1">
              State
            </label>
            <select
              value={filters.state || ""}
              onChange={(e) => onFilterChange({ state: e.target.value || undefined, page: 1 })}
              className="w-full bg-white border border-hairline-input rounded-[4px] px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
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
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1">
              Cause
            </label>
            <select
              value={filters.cause || ""}
              onChange={(e) => onFilterChange({ cause: e.target.value || undefined, page: 1 })}
              className="w-full bg-white border border-hairline-input rounded-[4px] px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
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
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1">
              Event Type
            </label>
            <select
              value={filters.eventType || ""}
              onChange={(e) => onFilterChange({ eventType: e.target.value || undefined, page: 1 })}
              className="w-full bg-white border border-hairline-input rounded-[4px] px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
            >
              <option value="">All Event Types</option>
              <option value="PAYMENT_FAILED">PAYMENT_FAILED</option>
              <option value="SUBSCRIPTION_FAILED">SUBSCRIPTION_FAILED</option>
              <option value="INVOICE_OVERDUE">INVOICE_OVERDUE</option>
              <option value="CHECKOUT_ABANDONED">CHECKOUT_ABANDONED</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1">
              Min Amount (₹)
            </label>
            <input
              type="number"
              placeholder="0"
              value={filters.minAmount || ""}
              onChange={(e) =>
                onFilterChange({
                  minAmount: e.target.value ? Number(e.target.value) : undefined,
                  page: 1,
                })
              }
              className="w-full bg-white border border-hairline-input rounded-[4px] px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow mb-1">
              Max Amount (₹)
            </label>
            <input
              type="number"
              placeholder="100000"
              value={filters.maxAmount || ""}
              onChange={(e) =>
                onFilterChange({
                  maxAmount: e.target.value ? Number(e.target.value) : undefined,
                  page: 1,
                })
              }
              className="w-full bg-white border border-hairline-input rounded-[4px] px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-canvas-soft text-ink-muted border-b border-hairline text-[11px] font-semibold uppercase tracking-eyebrow">
              <th className="py-2.5 px-3">Customer / Entity</th>
              <th
                className="py-2.5 px-3 cursor-pointer hover:text-ink transition-colors"
                onClick={() => handleSortToggle("amount")}
              >
                Amount{" "}
                {filters.sort?.startsWith("amount")
                  ? filters.sort.endsWith("desc")
                    ? "↓"
                    : "↑"
                  : ""}
              </th>
              <th className="py-2.5 px-3">Event Type</th>
              <th className="py-2.5 px-3">Last Event State</th>
              {/* <th className="py-2.5 px-3">Stage</th> */}
              <th
                className="py-2.5 px-3 cursor-pointer hover:text-ink transition-colors"
                onClick={() => handleSortToggle("riskScore")}
              >
                Risk Score{" "}
                {filters.sort?.startsWith("riskScore")
                  ? filters.sort.endsWith("desc")
                    ? "↓"
                    : "↑"
                  : ""}
              </th>
              <th className="py-2.5 px-3">Attempts</th>
              {/* <th className="py-2.5 px-3">Action</th> */}
              <th
                className="py-2.5 px-3 cursor-pointer hover:text-ink transition-colors"
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
          <tbody className="divide-y divide-hairline bg-white">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-muted">
                  Loading entities...
                </td>
              </tr>
            ) : entities.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-muted">
                  No revenue entities found matching filters.
                </td>
              </tr>
            ) : (
              entities.map((item) => (
                <tr
                  key={item.entityId || item.id}
                  className="cursor-pointer hover:bg-canvas-soft transition-colors"
                  onClick={() => router.push(`/entities/${item.entityId || item.id}`)}
                >
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-ink">{item.customerName}</div>
                    <div className="text-[11px] text-ink-muted">{item.customerEmail}</div>
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-ink">
                    {formatCurrency(item.amount)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="bg-canvas-soft text-ink-muted px-1.5 py-0.5 rounded-[4px] text-[10px] border border-hairline uppercase font-medium">
                      {item.eventType}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <Badge type="state" value={item.state} />
                  </td>
                  {/* <td className="py-2.5 px-3">
                    <Badge type="stage" value={item.stage} />
                  </td> */}
                  <td className="py-2.5 px-3 font-semibold">
                    {item.riskScore !== null ? (
                      <span
                        className={
                          item.riskScore > 0.7
                            ? "text-accent-orange-deep"
                            : item.riskScore > 0.4
                              ? "text-accent-orange"
                              : "text-accent-green"
                        }
                      >
                        {(item.riskScore * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-ink-secondary font-medium">
                    {item.attemptCount}
                  </td>
                  {/* <td className="py-2.5 px-3">
                    {item.actionResult ? (
                      <Badge type="actionResult" value={item.actionResult} />
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td> */}
                  <td className="py-2.5 px-3 text-ink-muted">
                    {formatDateTime(item.occurredAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-3 border-t border-hairline">
        <PaginationControl
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={(newPage) => onFilterChange({ page: newPage })}
          onLimitChange={(newLimit) => onFilterChange({ limit: newLimit, page: 1 })}
          disabled={loading}
        />
      </div>
    </div>
  );
}
