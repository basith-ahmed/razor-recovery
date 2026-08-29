"use client";

import { useState } from "react";
import { AuditEntry } from "../types";

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
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500 text-sm">
        No audit entries recorded for this entity yet.
      </div>
    );
  }

  // Sort entries newest first (reverse chronological order)
  const sortedEntries = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <div className="space-y-4">
      {sortedEntries.map((entry, idx) => {
        const isExpanded = expandedIndex === idx;

        // Scheduler-synthesized events carry a followUp marker in rawPayload
        const rawRawPayload = entry.inputSnapshot?.rawPayload as
          | { synthesized?: boolean; followUp?: { type?: string } }
          | undefined;
        const isSynthesized = rawRawPayload?.synthesized === true;
        const followUpType =
          typeof rawRawPayload?.followUp?.type === "string"
            ? (rawRawPayload.followUp.type as string)
            : null;

        // Extract diagnosis reasoning text safely (usually only present for
        // LLM-based diagnoses; RULE-based ones store null).
        const rawDiagnosisReasoning =
          entry.diagnosisSnapshot?.reasoning ?? entry.event?.diagnosis?.reasoning;
        const diagnosisReasoning: string | null =
          typeof rawDiagnosisReasoning === "string" && rawDiagnosisReasoning
            ? rawDiagnosisReasoning
            : null;

        // Extract decision reasoning text safely
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
            className="bg-white border border-slate-200 rounded-lg p-5 transition-colors"
          >
            {/* Header / Summary row */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-800 font-mono text-xs flex items-center justify-center font-bold">
                  {sortedEntries.length - idx}
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                    <span>Actor: {entry.actor}</span>
                    <span className="text-xs font-mono text-slate-400">→</span>
                    <span className="text-xs font-mono uppercase bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                      {entry.outcome}
                    </span>
                    {idx === 0 && sortedEntries.length > 1 && (
                      <span className="text-[10px] font-semibold uppercase bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono">
                        LATEST
                      </span>
                    )}
                    {isSynthesized && (
                      <span
                        className="text-[10px] font-semibold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded"
                        title="This event was synthesized by the follow-up scheduler, not a real payment failure"
                      >
                        ⟳ scheduler: {followUpType ?? "follow-up"}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    {new Date(entry.timestamp).toLocaleString("en-IN", {
                      dateStyle: "full",
                      timeStyle: "medium",
                    })}
                  </div>
                </div>
              </div>

              <button
                onClick={() => toggleExpand(idx)}
                className="text-xs font-medium text-blue-700 hover:text-blue-800 bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 rounded transition-colors"
              >
                {isExpanded ? "Hide Raw JSON ▲" : "View Raw Snapshots ▼"}
              </button>
            </div>

            {/* Webhook settlement vs AI Dunning Pipeline */}
            {entry.actor === "razorpay_webhook" ? (
              <div className="my-3 bg-emerald-50/70 border-l-4 border-emerald-500 p-4 rounded-r-lg">
                <div className="text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Payment Settlement Confirmed (Razorpay Webhook)
                </div>
                <p className="text-sm text-emerald-900 leading-relaxed">
                  Received verified webhook payment confirmation. Recovery workflow closed and entity marked as <span className="font-semibold text-emerald-950">RECOVERED</span>.
                </p>
                {entry.actionSnapshot && (
                  <div className="mt-2 text-xs font-mono text-emerald-800 bg-emerald-100/60 px-2.5 py-1.5 rounded inline-block">
                    Action: {String(entry.actionSnapshot.actionType ?? "webhook_capture")} · Result: {String(entry.actionSnapshot.result ?? "success")} · Integration: {String(entry.actionSnapshot.integration ?? "RAZORPAY")}
                    {Boolean(entry.actionSnapshot.paymentId) ? ` · Payment Ref: ${String(entry.actionSnapshot.paymentId)}` : ""}
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Pipeline summary: detection → diagnosis → decision → action */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-3 text-xs">
                  <div className="border border-slate-200 rounded p-2">
                    <div className="font-mono font-semibold text-slate-400 uppercase tracking-wide mb-1">
                      Detection
                    </div>
                    <div className="text-slate-700">
                      Risk:{" "}
                      {typeof entry.inputSnapshot?.riskScore === "number"
                        ? (entry.inputSnapshot.riskScore as number).toFixed(3)
                        : "N/A"}
                      {typeof entry.inputSnapshot?.urgency === "number" && (
                        <> · Urgency: {(entry.inputSnapshot.urgency as number).toFixed(2)}</>
                      )}
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded p-2">
                    <div className="font-mono font-semibold text-slate-400 uppercase tracking-wide mb-1">
                      Diagnosis
                    </div>
                    <div className="text-slate-700">
                      {entry.event?.diagnosis ? (
                        <>
                          <span className="font-mono">{entry.event.diagnosis.causeLabel}</span>{" "}
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

                  <div className="border border-slate-200 rounded p-2">
                    <div className="font-mono font-semibold text-slate-400 uppercase tracking-wide mb-1">
                      Decision
                    </div>
                    <div className="text-slate-700">
                      {typeof entry.decisionSnapshot?.chosenAction === "string"
                        ? `${entry.decisionSnapshot.chosenAction} (${(entry.decisionSnapshot.legalActions as string[])?.length ?? 0} legal)`
                        : "N/A"}
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded p-2">
                    <div className="font-mono font-semibold text-slate-400 uppercase tracking-wide mb-1">
                      Action
                    </div>
                    <div className="text-slate-700">
                      {entry.actionSnapshot ? (
                        <span className={entry.actionSnapshot.result === "failed" ? "text-red-700 font-medium" : ""}>
                          {String(entry.actionSnapshot.actionType ?? "")} · {String(entry.actionSnapshot.result ?? "")} · {String(entry.actionSnapshot.integration ?? "")}
                        </span>
                      ) : (
                        "Not executed"
                      )}
                    </div>
                  </div>
                </div>

                {/* PROMINENT REASONING CALLOUTS - Primary design requirement */}
                {entry.outcome === "failed" && (
                  <div className="my-3 bg-red-50/70 border-l-4 border-red-500 p-4 rounded-r-lg">
                    <div className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Action Execution Failed
                    </div>
                    <p className="text-sm text-red-900 leading-relaxed">
                      The chosen action{" "}
                      <code className="font-mono bg-red-100 text-red-800 px-1 py-0.5 rounded text-xs">
                        {typeof entry.decisionSnapshot?.chosenAction === "string"
                          ? entry.decisionSnapshot.chosenAction
                          : "action"}
                      </code>{" "}
                      failed during execution before completion. The failure has been immutably recorded in this audit trail.
                    </p>
                  </div>
                )}

                {diagnosisReasoning && (
                  <div className="my-3 bg-amber-50/60 border-l-4 border-amber-500 p-4 rounded-r-lg">
                    <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Diagnosis Reasoning
                    </div>
                    <p className="text-sm text-slate-800 italic font-serif leading-relaxed">
                      &quot;{diagnosisReasoning}&quot;
                    </p>
                  </div>
                )}

                {decisionReasoning && (
                  <div className="my-3 bg-blue-50/60 border-l-4 border-blue-500 p-4 rounded-r-lg">
                    <div className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Decision Reasoning
                    </div>
                    <p className="text-sm text-slate-800 italic font-serif leading-relaxed">
                      &quot;{decisionReasoning}&quot;
                    </p>
                  </div>
                )}
              </>
            )}

            {/* EXPANDABLE RAW JSON VIEWER */}
            {isExpanded && (
              <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                {entry.inputSnapshot && (
                  <div>
                    <h5 className="text-xs font-mono font-semibold text-slate-400 mb-1">inputSnapshot:</h5>
                    <pre className="bg-slate-50 p-3 rounded text-[11px] font-mono text-emerald-800 overflow-x-auto border border-slate-200">
                      {JSON.stringify(entry.inputSnapshot, null, 2)}
                    </pre>
                  </div>
                )}
                {entry.diagnosisSnapshot && (
                  <div>
                    <h5 className="text-xs font-mono font-semibold text-slate-400 mb-1">diagnosisSnapshot:</h5>
                    <pre className="bg-slate-50 p-3 rounded text-[11px] font-mono text-amber-800 overflow-x-auto border border-slate-200">
                      {JSON.stringify(entry.diagnosisSnapshot, null, 2)}
                    </pre>
                  </div>
                )}
                {entry.decisionSnapshot && (
                  <div>
                    <h5 className="text-xs font-mono font-semibold text-slate-400 mb-1">decisionSnapshot:</h5>
                    <pre className="bg-slate-50 p-3 rounded text-[11px] font-mono text-purple-800 overflow-x-auto border border-slate-200">
                      {JSON.stringify(entry.decisionSnapshot, null, 2)}
                    </pre>
                  </div>
                )}
                {entry.actionSnapshot && (
                  <div>
                    <h5 className="text-xs font-mono font-semibold text-slate-400 mb-1">actionSnapshot:</h5>
                    <pre className="bg-slate-50 p-3 rounded text-[11px] font-mono text-blue-800 overflow-x-auto border border-slate-200">
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
