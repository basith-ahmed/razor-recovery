"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, Info, ArrowRight } from "lucide-react";
import { AuditEntry } from "../types";
import { formatDateTime } from "../lib/formatters";

interface AuditTimelineProps {
  entries: AuditEntry[];
}

export function AuditTimeline({ entries }: AuditTimelineProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  if (entries.length === 0) {
    return (
      <div className="bg-white border border-hairline rounded-[12px] p-6 text-center text-ink-muted text-xs shadow-notion-soft">
        No audit entries recorded for this entity yet.
      </div>
    );
  }

  const sortedEntries = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <div className="space-y-3">
      {sortedEntries.map((entry, idx) => {
        const isExpanded = expandedIndex === idx;

        const rawRawPayload = entry.inputSnapshot?.rawPayload as
          | { synthesized?: boolean; followUp?: { type?: string } }
          | undefined;
        const isSynthesized = rawRawPayload?.synthesized === true;
        const followUpType =
          typeof rawRawPayload?.followUp?.type === "string"
            ? (rawRawPayload.followUp.type as string)
            : null;

        const rawDiagnosisReasoning =
          entry.diagnosisSnapshot?.reasoning ?? entry.event?.diagnosis?.reasoning;
        const diagnosisReasoning: string | null =
          typeof rawDiagnosisReasoning === "string" && rawDiagnosisReasoning
            ? rawDiagnosisReasoning
            : null;

        const rawDecisionReasoning =
          entry.decisionSnapshot?.reasoning ??
          entry.inputSnapshot?.reasoning ??
          entry.actionSnapshot?.reasoning ??
          entry.decisionSnapshot?.causeExplanation;
        const decisionReasoning: string | null =
          typeof rawDecisionReasoning === "string" ? rawDecisionReasoning : null;

        return (
          <div
            key={entry.id}
            className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs flex items-center justify-center font-bold">
                  {sortedEntries.length - idx}
                </span>
                <div>
                  <div className="text-sm font-semibold text-ink flex items-center gap-2 flex-wrap">
                    <span>Actor: {entry.actor}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-ink-faint inline-block" />
                    <span className="text-xs uppercase bg-canvas-soft border border-hairline px-2 py-0.5 rounded-full text-ink-muted font-medium">
                      {entry.outcome}
                    </span>
                    {idx === 0 && sortedEntries.length > 1 && (
                      <span className="text-[10px] font-semibold uppercase bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">
                        LATEST
                      </span>
                    )}
                    {isSynthesized && (
                      <span
                        className="text-[10px] font-semibold uppercase bg-accent-purple/30 text-accent-purple-deep border border-accent-purple/60 px-2 py-0.5 rounded-full"
                        title="This event was synthesized by the follow-up scheduler, not a real payment failure"
                      >
                        ⟳ scheduler: {followUpType ?? "follow-up"}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-faint mt-0.5">
                    {formatDateTime(entry.timestamp)}
                  </div>
                </div>
              </div>

              <button
                onClick={() => toggleExpand(idx)}
                className="text-xs font-medium text-ink hover:bg-canvas-soft bg-white border border-hairline px-3 py-1 rounded-[8px] transition-colors shadow-xs"
              >
                {isExpanded ? "Hide Raw JSON ▲" : "View Raw Snapshots ▼"}
              </button>
            </div>

            {entry.actor === "razorpay_webhook" ? (
              <div className="my-3 bg-accent-green/10 p-3.5 rounded-[8px]">
                <div className="text-xs font-semibold text-accent-green uppercase tracking-eyebrow mb-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-accent-green" />
                  Payment Settlement Confirmed (Razorpay Webhook)
                </div>
                <p className="text-xs text-ink-secondary">
                  Received verified webhook payment confirmation. Recovery workflow closed and entity marked as <span className="font-semibold text-accent-green">RECOVERED</span>.
                </p>
                {entry.actionSnapshot && (
                  <div className="mt-2 text-xs text-accent-green bg-white border border-accent-green/30 px-2.5 py-1 rounded-full inline-block font-medium">
                    Action: {String(entry.actionSnapshot.actionType ?? "webhook_capture")} · Result: {String(entry.actionSnapshot.result ?? "success")} · Integration: {String(entry.actionSnapshot.integration ?? "RAZORPAY")}
                    {Boolean(entry.actionSnapshot.paymentId) ? ` · Payment Ref: ${String(entry.actionSnapshot.paymentId)}` : ""}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 my-3 text-xs">
                  <div className="border border-hairline rounded-[6px] p-2.5 bg-canvas-soft/30">
                    <div className="font-semibold text-ink-muted uppercase tracking-eyebrow text-[11px] mb-1">
                      Detection
                    </div>
                    <div className="text-ink-secondary">
                      Risk:{" "}
                      {typeof entry.inputSnapshot?.riskScore === "number"
                        ? (entry.inputSnapshot.riskScore as number).toFixed(3)
                        : "N/A"}
                      {typeof entry.inputSnapshot?.urgency === "number" && (
                        <> · Urgency: {(entry.inputSnapshot.urgency as number).toFixed(2)}</>
                      )}
                    </div>
                  </div>

                  <div className="border border-hairline rounded-[6px] p-2.5 bg-canvas-soft/30">
                    <div className="font-semibold text-ink-muted uppercase tracking-eyebrow text-[11px] mb-1">
                      Diagnosis
                    </div>
                    <div className="text-ink-secondary">
                      {entry.event?.diagnosis ? (
                        <>
                          <span className="font-semibold text-ink">{entry.event.diagnosis.causeLabel}</span>{" "}
                          ({entry.event.diagnosis.method}
                          {typeof entry.event.diagnosis.confidence === "number" &&
                            `, ${(entry.event.diagnosis.confidence * 100).toFixed(0)}%`}
                          )
                        </>
                      ) : (
                        "N/A"
                      )}
                    </div>
                  </div>

                  <div className="border border-hairline rounded-[6px] p-2.5 bg-canvas-soft/30">
                    <div className="font-semibold text-ink-muted uppercase tracking-eyebrow text-[11px] mb-1">
                      Decision
                    </div>
                    <div className="text-ink-secondary">
                      {typeof entry.decisionSnapshot?.chosenAction === "string"
                        ? `${entry.decisionSnapshot.chosenAction} (${(entry.decisionSnapshot.legalActions as string[])?.length ?? 0} legal)`
                        : "N/A"}
                    </div>
                  </div>

                  <div className="border border-hairline rounded-[6px] p-2.5 bg-canvas-soft/30">
                    <div className="font-semibold text-ink-muted uppercase tracking-eyebrow text-[11px] mb-1">
                      Action
                    </div>
                    <div className="text-ink-secondary">
                      {entry.actionSnapshot ? (
                        <span className={entry.actionSnapshot.result === "failed" ? "text-accent-orange-deep font-semibold" : "font-medium"}>
                          {String(entry.actionSnapshot.actionType ?? "")} · {String(entry.actionSnapshot.result ?? "")} · {String(entry.actionSnapshot.integration ?? "")}
                        </span>
                      ) : (
                        "Not executed"
                      )}
                    </div>
                  </div>
                </div>

                {entry.outcome === "failed" && (
                  <div className="my-3 bg-accent-orange/10 p-3.5 rounded-[8px]">
                    <div className="text-xs font-semibold text-accent-orange-deep uppercase tracking-eyebrow mb-1 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-accent-orange" />
                      Action Execution Failed
                    </div>
                    <p className="text-xs text-ink-secondary">
                      The chosen action{" "}
                      <code className="bg-white border border-accent-orange/30 text-accent-orange-deep px-1.5 py-0.5 rounded text-xs font-semibold">
                        {typeof entry.decisionSnapshot?.chosenAction === "string"
                          ? entry.decisionSnapshot.chosenAction
                          : "action"}
                      </code>{" "}
                      failed during execution before completion. The failure has been immutably recorded in this audit trail.
                    </p>
                  </div>
                )}

                {diagnosisReasoning && (
                  <div className="my-3 bg-canvas-soft p-3.5 rounded-[8px]">
                    <div className="text-xs font-semibold text-accent-purple-deep uppercase tracking-eyebrow mb-1 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-accent-purple-deep" />
                      Diagnosis Reasoning
                    </div>
                    <p className="text-xs text-ink-secondary italic">
                      &quot;{diagnosisReasoning}&quot;
                    </p>
                  </div>
                )}

                {decisionReasoning && (
                  <div className="my-3 bg-primary/5 p-3.5 rounded-[8px]">
                    <div className="text-xs font-semibold text-primary uppercase tracking-eyebrow mb-1 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-primary" />
                      Decision Reasoning
                    </div>
                    <p className="text-xs text-ink-secondary italic">
                      &quot;{decisionReasoning}&quot;
                    </p>
                  </div>
                )}
              </>
            )}

            {isExpanded && (
              <div className="mt-3 pt-3 border-t border-hairline space-y-2.5">
                {entry.inputSnapshot && (
                  <div>
                    <h5 className="text-xs font-semibold text-ink-muted mb-1">inputSnapshot:</h5>
                    <pre className="bg-canvas-soft p-3 rounded-[6px] text-[11px] text-ink-secondary overflow-x-auto border border-hairline">
                      {JSON.stringify(entry.inputSnapshot, null, 2)}
                    </pre>
                  </div>
                )}
                {entry.diagnosisSnapshot && (
                  <div>
                    <h5 className="text-xs font-semibold text-ink-muted mb-1">diagnosisSnapshot:</h5>
                    <pre className="bg-canvas-soft p-3 rounded-[6px] text-[11px] text-ink-secondary overflow-x-auto border border-hairline">
                      {JSON.stringify(entry.diagnosisSnapshot, null, 2)}
                    </pre>
                  </div>
                )}
                {entry.decisionSnapshot && (
                  <div>
                    <h5 className="text-xs font-semibold text-ink-muted mb-1">decisionSnapshot:</h5>
                    <pre className="bg-canvas-soft p-3 rounded-[6px] text-[11px] text-ink-secondary overflow-x-auto border border-hairline">
                      {JSON.stringify(entry.decisionSnapshot, null, 2)}
                    </pre>
                  </div>
                )}
                {entry.actionSnapshot && (
                  <div>
                    <h5 className="text-xs font-semibold text-ink-muted mb-1">actionSnapshot:</h5>
                    <pre className="bg-canvas-soft p-3 rounded-[6px] text-[11px] text-ink-secondary overflow-x-auto border border-hairline">
                      {JSON.stringify(entry.actionSnapshot, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
