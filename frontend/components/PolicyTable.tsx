"use client";

import { PolicyRule } from "../types";

interface PolicyTableProps {
  rules: PolicyRule[];
}

export function PolicyTable({ rules }: PolicyTableProps) {
  return (
    <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px]">Config-Driven Recovery Policy Engine</h3>
          <p className="text-xs text-ink-muted mt-0.5">
            Live policy rules fetched directly from <code className="text-primary bg-primary/5 px-1 py-0.5 rounded-[4px] font-semibold">backend/src/domain/policy.json</code>
          </p>
        </div>
        <span className="text-xs bg-primary/10 border border-primary/20 text-primary px-3 py-1 rounded-full font-semibold">
          {rules.length} Active Policy Rules
        </span>
      </div>

      <div className="overflow-x-auto border border-hairline rounded-[8px]">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-canvas-soft text-ink-muted border-b border-hairline text-[11px] font-semibold uppercase tracking-eyebrow">
              <th className="p-3.5">Failure Cause</th>
              <th className="p-3.5">Allowed Action Sequence</th>
              <th className="p-3.5">Autonomous Stopping Rules</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline bg-white">
            {rules.map((rule, idx) => (
              <tr key={idx} className="hover:bg-canvas-soft transition-colors">
                <td className="p-3.5 font-bold text-ink">{rule.cause}</td>
                <td className="p-3.5">
                  <div className="flex flex-wrap gap-1.5">
                    {rule.actions.length === 0 ? (
                      <span className="text-ink-faint text-[11px] italic">[No Actions / Skip]</span>
                    ) : (
                      rule.actions.map((act, aIdx) => (
                        <span
                          key={aIdx}
                          className="bg-primary/10 text-primary border border-primary/30 px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                        >
                          {act}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="p-3.5 text-[11px]">
                  <pre className="inline-block bg-canvas-soft p-2.5 rounded-[6px] border border-hairline text-ink-secondary">
                    {JSON.stringify(rule.stopping, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
