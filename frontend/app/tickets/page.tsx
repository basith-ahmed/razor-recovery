"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { listTickets, getTicketStats } from "../../lib/api";
import { TicketItem, TicketStats } from "../../types";
import { Badge } from "../../components/Badge";
import { PageHeader } from "../../components/PageHeader";
import { PaginationControl } from "../../components/PaginationControl";

export default function TicketsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("open");
  const [search, setSearch] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [statsData, ticketsData] = await Promise.all([
        getTicketStats(),
        listTickets({
          status: activeTab !== "all" ? activeTab : undefined,
          search: search || undefined,
          page,
          limit,
        }),
      ]);
      setStats(statsData);
      setTickets(ticketsData.items);
      setTotalPages(ticketsData.totalPages);
      setTotalItems(ticketsData.total);
    } catch (err) {
      console.error("Failed to load tickets:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [activeTab, search, page, limit]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="pb-8">
      <PageHeader
        title="Human Escalation Workspace"
        description="Manage escalated failure cases requiring agent intervention. Click any ticket to view full details."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">Open Escalations</div>
          <div className="text-2xl font-bold text-ink mt-1 tracking-heading-3">{stats?.openCount ?? 0}</div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">Amount Under Escalation</div>
          <div className="text-2xl font-bold text-ink mt-1 tracking-heading-3">
            {formatCurrency(stats?.totalAtRisk ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">Recovered by Agents</div>
          <div className="text-2xl font-bold text-accent-green mt-1 tracking-heading-3">
            {formatCurrency(stats?.totalRecovered ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">Written Off Cases</div>
          <div className="text-2xl font-bold text-accent-orange-deep mt-1 tracking-heading-3">
            {stats?.writtenOffCount ?? stats?.resolvedCount ?? 0}
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white border border-hairline rounded-[12px] shadow-notion-soft overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
          <div className="flex items-center gap-1.5">
            {[
              { id: "open", label: "Open" },
              { id: "recovered", label: "Recovered" },
              { id: "written_off", label: "Written Off" },
              { id: "all", label: "All" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setPage(1);
                }}
                className={`px-3.5 py-1 text-xs rounded-full font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-ink text-white font-semibold shadow-xs"
                    : "bg-canvas-soft text-ink-secondary border border-hairline hover:bg-hairline/40"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search by ID, reason, notes..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="bg-white border border-hairline-input rounded-[4px] px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all w-64"
            />
            <button
              type="submit"
              className="px-4 py-1.5 bg-primary hover:bg-primary-active active:scale-[0.98] text-white text-xs rounded-full font-medium transition-all shadow-sm"
            >
              Search
            </button>
          </form>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-canvas-soft text-ink-muted border-b border-hairline text-[11px] font-semibold uppercase tracking-eyebrow">
                <th className="py-2.5 px-3">Ticket ID</th>
                <th className="py-2.5 px-3">Entity ID</th>
                <th className="py-2.5 px-3">Reason</th>
                <th className="py-2.5 px-3">Priority</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Notes</th>
                <th className="py-2.5 px-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-white">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-muted">
                    Loading escalation tickets...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-muted">
                    No escalation tickets found.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => router.push(`/tickets/${t.id}`)}
                    className="hover:bg-canvas-soft cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-3 font-semibold text-primary">
                      {t.id.slice(0, 8)}...
                    </td>
                    <td className="py-2.5 px-3 text-ink-muted">
                      {t.entityId}
                    </td>
                    <td className="py-2.5 px-3 text-ink font-medium max-w-xs truncate">
                      {t.reason}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          t.priority === "high"
                            ? "bg-accent-orange/10 text-accent-orange-deep border border-accent-orange/25"
                            : t.priority === "medium"
                            ? "bg-accent-orange/10 text-accent-orange border border-accent-orange/25"
                            : "bg-canvas-soft text-ink-muted border border-hairline"
                        }`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge type="ticketStatus" value={t.status} />
                    </td>
                    <td className="py-2.5 px-3 text-ink-secondary">
                      {t.notesCount}
                    </td>
                    <td className="py-2.5 px-3 text-ink-muted">
                      {formatDateTime(t.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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
    </div>
  );
}
