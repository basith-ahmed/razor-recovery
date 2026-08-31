"use client";

import { useState, useEffect } from "react";
import { getPolicy } from "../../lib/api";
import { PolicyResponse } from "../../types";
import { PolicyTable } from "../../components/PolicyTable";
import { AuditChainVerifier } from "../../components/AuditChainVerifier";
import { PageHeader } from "../../components/PageHeader";
import { PaginationControl } from "../../components/PaginationControl";

type PolicyTab = "rules" | "dnc" | "compliance";

export default function PolicyPage() {
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [logPage, setLogPage] = useState<number>(1);
  const [logLimit, setLogLimit] = useState<number>(15);
  const [dncPage, setDncPage] = useState<number>(1);
  const [dncLimit, setDncLimit] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<PolicyTab>("rules");

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

  const tabs: { id: PolicyTab; label: string; count?: number }[] = [
    {
      id: "rules",
      label: "Policy Rules",
      count: data?.policy.rules.length,
    },
    {
      id: "dnc",
      label: "DNC Register",
      count: data?.dncList.total,
    },
    {
      id: "compliance",
      label: "Compliance Log",
      count: data?.complianceLog.total,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Policy & Compliance Control"
        description="Inspect declarative recovery rules, active Do-Not-Contact registers, and compliance audit overrides."
      />

      {/* Audit integrity — always visible at the top, above tabs */}
      <div className="mb-5">
        <AuditChainVerifier />
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-0 border-b border-hairline mb-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-ink-muted hover:text-ink hover:border-hairline"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-canvas-soft text-ink-muted border border-hairline"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="bg-white border border-hairline rounded-[12px] p-8 text-center text-ink-muted text-sm shadow-notion-soft">
          Loading policy settings...
        </div>
      ) : data ? (
        <>
          {/* Tab: Policy Rules */}
          {activeTab === "rules" && (
            <PolicyTable rules={data.policy.rules} />
          )}

          {/* Tab: DNC Register */}
          {activeTab === "dnc" && (
            <div className="bg-white border border-hairline rounded-[12px] shadow-notion-soft overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
                <div>
                  <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px]">
                    Active Do-Not-Contact Customer List
                  </h3>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Entities registered in Redis / Database to halt dunning communications
                  </p>
                </div>
                <span className="text-xs bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep px-3 py-1 rounded-full font-semibold">
                  {data.dncList.total} DNC Customers
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-canvas-soft text-ink-muted border-b border-hairline text-[11px] font-semibold uppercase tracking-eyebrow">
                      <th className="p-3">Customer ID</th>
                      <th className="p-3">Name</th>
                      <th className="p-3">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline bg-white">
                    {data.dncList.entries.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-center py-6 text-ink-muted">
                          No active DNC records.
                        </td>
                      </tr>
                    ) : (
                      data.dncList.entries.map((c) => (
                        <tr key={c.id} className="hover:bg-canvas-soft transition-colors">
                          <td className="p-3 text-ink-faint">{c.id}</td>
                          <td className="p-3 font-semibold text-ink">{c.name || "N/A"}</td>
                          <td className="p-3 text-ink-secondary">{c.email || "N/A"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-hairline">
                <PaginationControl
                  page={dncPage}
                  totalPages={data.dncList.totalPages}
                  total={data.dncList.total}
                  limit={dncLimit}
                  onPageChange={setDncPage}
                  onLimitChange={(newLimit) => {
                    setDncLimit(newLimit);
                    setDncPage(1);
                  }}
                  limitOptions={[5, 10, 20, 50]}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          {/* Tab: Compliance Log */}
          {activeTab === "compliance" && (
            <div className="bg-white border border-hairline rounded-[12px] shadow-notion-soft overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
                <div>
                  <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px]">
                    Compliance Audit Log (Blocked / Escalated Actions)
                  </h3>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Audit entries stopped or escalated due to policy guardrails
                  </p>
                </div>
                <span className="text-xs bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep px-3 py-1 rounded-full font-semibold">
                  {data.complianceLog.total} Total Blocked Entries
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-canvas-soft text-ink-muted border-b border-hairline text-[11px] font-semibold uppercase tracking-eyebrow">
                      <th className="p-3">Timestamp</th>
                      <th className="p-3">Customer / Entity</th>
                      <th className="p-3">Action Attempted</th>
                      <th className="p-3">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline bg-white">
                    {data.complianceLog.entries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-6 text-ink-muted">
                          No policy-blocked audit entries found.
                        </td>
                      </tr>
                    ) : (
                      data.complianceLog.entries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-canvas-soft transition-colors">
                          <td className="p-3 text-ink-muted">
                            {new Date(entry.timestamp).toLocaleString("en-IN")}
                          </td>
                          <td className="p-3 font-semibold text-ink">
                            {entry.event?.customer?.name || entry.entityId}
                          </td>
                          <td className="p-3 text-accent-orange font-semibold">{entry.actor}</td>
                          <td className="p-3">
                            <span className="bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep px-2.5 py-0.5 rounded-full text-[10px] uppercase font-semibold">
                              {entry.outcome}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-hairline">
                <PaginationControl
                  page={logPage}
                  totalPages={data.complianceLog.totalPages}
                  total={data.complianceLog.total}
                  limit={logLimit}
                  onPageChange={setLogPage}
                  onLimitChange={(newLimit) => {
                    setLogLimit(newLimit);
                    setLogPage(1);
                  }}
                  limitOptions={[10, 15, 25, 50]}
                  disabled={loading}
                />
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
