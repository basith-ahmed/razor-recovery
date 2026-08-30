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
    <div className="pb-24">
      <PageHeader
        title="Human Escalation Workspace"
        description="Manage escalated failure cases requiring agent intervention. Click any ticket to view full details."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Open Escalations</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{stats?.openCount ?? 0}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Amount Under Escalation</div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {formatCurrency(stats?.totalAtRisk ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Recovered by Agents</div>
          <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
            {formatCurrency(stats?.totalRecovered ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Written Off Cases</div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {stats?.writtenOffCount ?? stats?.resolvedCount ?? 0}
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white border border-slate-200 rounded">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
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
                className={`px-3 py-1 text-xs rounded font-medium ${
                  activeTab === tab.id
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
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
              className="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 w-64"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded font-medium"
            >
              Search
            </button>
          </form>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <th className="py-2.5 px-3 font-medium">Ticket ID</th>
                <th className="py-2.5 px-3 font-medium">Entity ID</th>
                <th className="py-2.5 px-3 font-medium">Reason</th>
                <th className="py-2.5 px-3 font-medium">Priority</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Notes</th>
                <th className="py-2.5 px-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Loading escalation tickets...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No escalation tickets found.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => router.push(`/tickets/${t.id}`)}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="py-2.5 px-3 font-mono font-semibold text-blue-700">
                      {t.id.slice(0, 8)}...
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">
                      {t.entityId}
                    </td>
                    <td className="py-2.5 px-3 text-slate-800 font-medium max-w-xs truncate">
                      {t.reason}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          t.priority === "high"
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : t.priority === "medium"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge type="ticketStatus" value={t.status} />
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 font-mono">
                      {t.notesCount}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 font-mono">
                      {formatDateTime(t.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
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
