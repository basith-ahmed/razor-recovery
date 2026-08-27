"use client";

import { useState, useEffect } from "react";
import { getPolicy } from "../../lib/api";
import { PolicyResponse } from "../../types";
import { PolicyTable } from "../../components/PolicyTable";
import { AuditChainVerifier } from "../../components/AuditChainVerifier";

export default function PolicyPage() {
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [logPage, setLogPage] = useState<number>(1);
  const [logLimit, setLogLimit] = useState<number>(15);
  const [dncPage, setDncPage] = useState<number>(1);
  const [dncLimit, setDncLimit] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let ignore = false;
    getPolicy(logPage, logLimit, dncPage, dncLimit)
      .then((res) => {
        if (!ignore) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to fetch policy configuration:", err);
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [logPage, logLimit, dncPage, dncLimit]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Policy & Compliance Control</h1>
        <p className="text-sm text-slate-400">
          Inspect declarative recovery rules, active Do-Not-Contact (DNC) registers, and compliance audit overrides.
        </p>
      </div>

      <div className="mb-6">
        <AuditChainVerifier />
      </div>

      {loading && !data ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500">
          Loading policy settings...
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Policy Table */}
          <PolicyTable rules={data.policy.rules} />

          {/* DNC List */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-md font-semibold text-slate-900">Active Do-Not-Contact (DNC) Customer List</h3>
                <p className="text-xs text-slate-400">Entities registered in Redis / Database to halt dunning communications</p>
              </div>
              <span className="text-xs font-mono bg-red-50 border border-red-200 text-red-800 px-3 py-1 rounded-md">
                {data.dncList.total} DNC Customers
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 border-b border-slate-200">
                    <th className="p-3 font-medium">Customer ID</th>
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {data.dncList.entries.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center py-6 text-slate-500">
                        No active DNC records.
                      </td>
                    </tr>
                  ) : (
                    data.dncList.entries.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-100/40">
                        <td className="p-3 font-mono text-slate-400">{c.id}</td>
                        <td className="p-3 font-semibold text-slate-900">{c.name || "N/A"}</td>
                        <td className="p-3 font-mono text-slate-700">{c.email || "N/A"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* DNC Pagination Controls */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Per page:</span>
                <select
                  value={dncLimit}
                  onChange={(e) => {
                    setDncLimit(parseInt(e.target.value, 10));
                    setDncPage(1);
                  }}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono">
                  Page {data.dncList.page} of {data.dncList.totalPages}
                </span>
                <button
                  disabled={dncPage <= 1}
                  onClick={() => setDncPage((p) => Math.max(1, p - 1))}
                  className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs px-3 py-1 rounded transition-colors font-medium"
                >
                  Previous
                </button>
                <button
                  disabled={dncPage >= data.dncList.totalPages}
                  onClick={() => setDncPage((p) => p + 1)}
                  className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs px-3 py-1 rounded transition-colors font-medium"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Compliance Log (Policy-blocked entries) */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-md font-semibold text-slate-900">Compliance Audit Log (Blocked / Escalated Actions)</h3>
                <p className="text-xs text-slate-400">Audit entries stopped or escalated due to policy guardrails</p>
              </div>
              <span className="text-xs font-mono bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1 rounded-md">
                {data.complianceLog.total} Total Blocked Entries
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 border-b border-slate-200">
                    <th className="p-3 font-medium">Timestamp</th>
                    <th className="p-3 font-medium">Customer / Entity</th>
                    <th className="p-3 font-medium">Action Attempted</th>
                    <th className="p-3 font-medium">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {data.complianceLog.entries.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-slate-500">
                        No policy-blocked audit entries found.
                      </td>
                    </tr>
                  ) : (
                    data.complianceLog.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-100/40">
                        <td className="p-3 font-mono text-slate-400">
                          {new Date(entry.timestamp).toLocaleString("en-IN")}
                        </td>
                        <td className="p-3 font-semibold text-slate-900">
                          {entry.event?.customer?.name || entry.entityId}
                        </td>
                        <td className="p-3 font-mono text-amber-800">{entry.actor}</td>
                        <td className="p-3">
                          <span className="bg-red-50 border border-red-200 text-red-800 px-2 py-0.5 rounded font-mono text-[10px] uppercase">
                            {entry.outcome}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Compliance Log Pagination controls */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Per page:</span>
                <select
                  value={logLimit}
                  onChange={(e) => {
                    setLogLimit(parseInt(e.target.value, 10));
                    setLogPage(1);
                  }}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                >
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono">
                  Page {data.complianceLog.page} of {data.complianceLog.totalPages}
                </span>
                <button
                  disabled={logPage <= 1}
                  onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                  className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs px-3 py-1 rounded transition-colors font-medium"
                >
                  Previous
                </button>
                <button
                  disabled={logPage >= data.complianceLog.totalPages}
                  onClick={() => setLogPage((p) => p + 1)}
                  className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs px-3 py-1 rounded transition-colors font-medium"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
