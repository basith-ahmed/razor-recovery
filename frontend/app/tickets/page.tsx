"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { listTickets, getTicketStats } from "../../lib/api";
import { TicketItem, TicketStats } from "../../types";
import { Badge } from "../../components/Badge";
import { PageHeader } from "../../components/PageHeader";

export default function TicketsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("open");
  const [search, setSearch] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [statsData, ticketsData] = await Promise.all([
        getTicketStats(),
        listTickets({ status: activeTab, search: search || undefined }),
      ]);
      setStats(statsData);
      setTickets(ticketsData.items);
    } catch (err) {
      console.error("Failed to load tickets:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [activeTab, search]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
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
                onClick={() => setActiveTab(tab.id)}
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
              placeholder="Search customer, email, entity..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-900 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 w-64"
            />
            <button
              type="submit"
              className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded hover:bg-slate-700 font-medium"
            >
              Search
            </button>
          </form>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="text-slate-500 border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="py-2.5 px-3">Customer</th>
                <th className="py-2.5 px-3">Entity</th>
                <th className="py-2.5 px-3">Reason</th>
                <th className="py-2.5 px-3">Amount</th>
                <th className="py-2.5 px-3">Priority</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Notes</th>
                <th className="py-2.5 px-3">Escalated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Loading escalations...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No tickets found.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => router.push(`/tickets/${t.id}`)}
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">{t.customer?.name || "—"}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{t.customer?.email || "—"}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 text-[11px]">
                      {t.entityId}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 max-w-[180px] truncate">
                      {t.reason}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                      {formatCurrency(t.event?.amount ?? 0, t.event?.currency)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${
                        t.priority === "high"
                          ? "bg-red-50 border-red-200 text-red-700"
                          : t.priority === "medium"
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-slate-50 border-slate-200 text-slate-600"
                      }`}>
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
          <p className="text-xs text-slate-400">
            {loading ? "Loading..." : `${tickets.length} ticket${tickets.length !== 1 ? "s" : ""} shown`}
          </p>
        </div>
      </div>
    </div>
  );
}
