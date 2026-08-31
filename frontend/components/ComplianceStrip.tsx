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

  const items = [
    {
      label: "DNC Blocked",
      value: dncBlocked,
      dotColor: "bg-ink-faint",
    },
    {
      label: "Auto-Escalated",
      value: autoEscalated,
      dotColor: "bg-accent-orange",
    },
    {
      label: "Cooldown Stopped",
      value: cooldownStopped,
      dotColor: "bg-accent-purple-deep",
    },
  ];

  return (
    <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft h-full flex flex-col gap-4">
      <div>
        <h4 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-0.5">Policy & Compliance Guardrails</h4>
        <p className="text-xs text-ink-muted">Autonomous stopping rules and customer protection status</p>
      </div>

      <ul className="divide-y divide-hairline">
        {items.map((item) => (
          <li key={item.label} className="py-2.5 flex items-center justify-between text-xs first:pt-0 last:pb-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${item.dotColor} shrink-0`} />
              <span className="text-ink-secondary font-medium">{item.label}</span>
            </div>
            <span className="text-ink font-semibold">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
