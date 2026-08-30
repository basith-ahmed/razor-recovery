"use client";

import { PolicyRule } from "../types";

interface PolicyTableProps {
  rules: PolicyRule[];
}

export function PolicyTable({ rules }: PolicyTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Config-Driven Recovery Policy Engine</h3>
          <p className="text-xs text-slate-500">
            Live policy rules fetched directly from <code className="text-blue-700 font-mono">backend/src/domain/policy.json</code>
          </p>
        </div>
        <span className="text-xs font-mono bg-blue-50 border border-blue-200 text-blue-800 px-2.5 py-1 rounded">
          {rules.length} Active Policy Rules
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <th className="p-3 font-medium">Failure Cause</th>
              <th className="p-3 font-medium">Allowed Action Sequence</th>
              <th className="p-3 font-medium">Autonomous Stopping Rules</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rules.map((rule, idx) => (
              <tr key={idx} className="hover:bg-slate-50">
                <td className="p-3 font-semibold text-slate-900 font-mono">{rule.cause}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {rule.actions.length === 0 ? (
                      <span className="text-slate-500 text-[11px] italic">[No Actions / Skip]</span>
                    ) : (
                      rule.actions.map((act, aIdx) => (
                        <span
                          key={aIdx}
                          className="bg-slate-100 text-blue-800 border border-slate-300 px-2 py-0.5 rounded text-[11px] font-mono"
                        >
                          {act}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="p-3 font-mono text-[11px]">
                  <pre className="inline-block bg-slate-50 p-2 rounded border border-slate-200 text-slate-700">
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
