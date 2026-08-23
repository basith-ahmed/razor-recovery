"use client";

import { PolicyRule } from "../types";

interface PolicyTableProps {
  rules: PolicyRule[];
}

export function PolicyTable({ rules }: PolicyTableProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-md font-semibold text-white">Config-Driven Recovery Policy Engine</h3>
          <p className="text-xs text-slate-400">
            Live policy rules fetched directly from <code className="text-blue-400">backend/src/domain/policy.json</code>
          </p>
        </div>
        <span className="text-xs font-mono bg-blue-950 border border-blue-800 text-blue-300 px-3 py-1 rounded-md">
          {rules.length} Active Policy Rules
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
              <th className="p-3 font-medium">Failure Cause</th>
              <th className="p-3 font-medium">Allowed Action Sequence</th>
              <th className="p-3 font-medium">Autonomous Stopping Rules</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rules.map((rule, idx) => (
              <tr key={idx} className="hover:bg-slate-800/40">
                <td className="p-3 font-semibold text-white font-mono">{rule.cause}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {rule.actions.length === 0 ? (
                      <span className="text-slate-500 text-[11px] italic">[No Actions / Skip]</span>
                    ) : (
                      rule.actions.map((act, aIdx) => (
                        <span
                          key={aIdx}
                          className="bg-slate-800 text-blue-300 border border-slate-700 px-2 py-0.5 rounded text-[11px] font-mono"
                        >
                          {act}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="p-3 font-mono text-[11px] text-amber-300">
                  <pre className="inline-block bg-slate-950 p-2 rounded border border-slate-800 text-slate-300">
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
