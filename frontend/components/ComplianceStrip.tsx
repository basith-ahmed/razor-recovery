"use client";

interface ComplianceStripProps {
  compliance?: {
    dncBlocked: number;
    autoEscalated: number;
    cooldownStopped: number;
  };
}

export function ComplianceStrip({ compliance }: ComplianceStripProps) {
  const dncBlocked = compliance?.dncBlocked ?? 0;
  const autoEscalated = compliance?.autoEscalated ?? 0;
  const cooldownStopped = compliance?.cooldownStopped ?? 0;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">Policy & Compliance Guardrails</h4>
        <p className="text-xs text-slate-400">Autonomous stopping rules and customer protection status</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* DNC Blocked Badge */}
        <div className="bg-slate-50 border border-slate-300 px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-slate-400" />
          <span className="text-slate-400">DNC Blocked:</span>
          <span className="text-slate-900 font-bold">{dncBlocked}</span>
        </div>

        {/* Auto-Escalated Badge */}
        <div className="bg-slate-50 border border-amber-200/50 px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-amber-700">Auto-Escalated:</span>
          <span className="text-amber-800 font-bold">{autoEscalated}</span>
        </div>

        {/* Cooldown Stopped Badge */}
        <div className="bg-slate-50 border border-purple-200/50 px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-purple-500" />
          <span className="text-purple-700">Cooldown Stopped:</span>
          <span className="text-purple-800 font-bold">{cooldownStopped}</span>
        </div>
      </div>
    </div>
  );
}
