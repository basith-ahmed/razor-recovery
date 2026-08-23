"use client";

import { useState, useEffect } from "react";
import { getPolicy } from "../../lib/api";
import { PolicyResponse } from "../../types";
import { PolicyTable } from "../../components/PolicyTable";

export default function PolicyPage() {
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let ignore = false;
    getPolicy(page, 15)
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
  }, [page]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Policy & Compliance Control</h1>
        <p className="text-sm text-slate-400">
          Inspect declarative recovery rules, active Do-Not-Contact (DNC) registers, and compliance audit overrides.
        </p>
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
                {data.dncList.length} DNC Customers
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
                  {data.dncList.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center py-6 text-slate-500">
                        No active DNC records.
                      </td>
                    </tr>
                  ) : (
                    data.dncList.map((c) => (
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

            {/* Pagination controls */}
            {data.complianceLog.total > 15 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200">
                <span className="text-xs text-slate-400 font-mono">
                  Page {data.complianceLog.page} of {Math.ceil(data.complianceLog.total / 15)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs px-3 py-1 rounded transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    disabled={page >= Math.ceil(data.complianceLog.total / 15)}
                    onClick={() => setPage((p) => p + 1)}
                    className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs px-3 py-1 rounded transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
