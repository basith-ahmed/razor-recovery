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

  return (
    <div className="space-y-4">
      {entries.map((entry, idx) => {
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

        // Extract payment link safely
        const rawShortUrl = entry.actionSnapshot?.shortUrl ?? entry.actionSnapshot?.paymentLinkShortUrl ?? entry.actionSnapshot?.paymentLink;
        const rawLinkId = entry.actionSnapshot?.razorpayPaymentLinkId;

        let paymentLinkUrl: string | null = null;
        if (typeof rawShortUrl === "string" && rawShortUrl) {
          paymentLinkUrl = rawShortUrl;
        } else if (typeof rawLinkId === "string" && rawLinkId) {
          paymentLinkUrl = rawLinkId.startsWith("http")
            ? rawLinkId
            : `https://razorpay.com/pay/${rawLinkId}`;
        }

        return (
          <div
            key={entry.id}
            className="bg-white border border-slate-200 rounded-lg p-5 transition-colors"
          >
            {/* Header / Summary row */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-800 font-mono text-xs flex items-center justify-center font-bold">
                  {idx + 1}
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                    <span>Actor: {entry.actor}</span>
                    <span className="text-xs font-mono text-slate-400">→</span>
                    <span className="text-xs font-mono uppercase bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                      {entry.outcome}
                    </span>
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
                  AI Diagnosis Reasoning
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
                  AI Decision Reasoning
                </div>
                <p className="text-sm text-slate-800 italic font-serif leading-relaxed">
                  &quot;{decisionReasoning}&quot;
                </p>
              </div>
            )}

            {/* Razorpay Payment Link if generated */}
            {paymentLinkUrl && (
              <div className="my-3 bg-emerald-50/70 border border-emerald-200/80 p-3 rounded-lg flex items-center justify-between">
                <div className="text-xs text-emerald-800 flex items-center gap-2">
                  <span className="font-semibold">Razorpay Payment Link Generated:</span>
                  <span className="font-mono text-emerald-700 truncate max-w-xs">{paymentLinkUrl}</span>
                </div>
                <a
                  href={paymentLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-emerald-600 hover:bg-emerald-500 text-slate-900 text-xs font-medium px-3 py-1 rounded transition-colors"
                >
                  Open Link 
                </a>
              </div>
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
