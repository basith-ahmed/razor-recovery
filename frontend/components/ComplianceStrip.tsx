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
    <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft h-full flex flex-col justify-between gap-4">
      <div>
        <h4 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-0.5">Policy & Compliance Guardrails</h4>
        <p className="text-xs text-ink-muted">Autonomous stopping rules and customer protection status</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-canvas-soft border border-hairline px-3 py-1 rounded-full flex items-center gap-2 text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-ink-faint" />
          <span className="text-ink-muted">DNC Blocked:</span>
          <span className="text-ink font-bold">{dncBlocked}</span>
        </div>

        <div className="bg-accent-orange/10 border border-accent-orange/25 px-3 py-1 rounded-full flex items-center gap-2 text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-accent-orange" />
          <span className="text-accent-orange-deep">Auto-Escalated:</span>
          <span className="text-accent-orange font-bold">{autoEscalated}</span>
        </div>

        <div className="bg-accent-purple/30 border border-accent-purple/60 px-3 py-1 rounded-full flex items-center gap-2 text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-accent-purple-deep" />
          <span className="text-accent-purple-deep">Cooldown Stopped:</span>
          <span className="text-accent-purple-deep font-bold">{cooldownStopped}</span>
        </div>
      </div>
    </div>
  );
}
