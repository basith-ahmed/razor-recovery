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

        // Extract diagnosis/decision reasoning text safely
        const rawReasoning =
          entry.decisionSnapshot?.reasoning ??
          entry.inputSnapshot?.reasoning ??
          entry.actionSnapshot?.reasoning ??
          entry.decisionSnapshot?.causeExplanation;
        const reasoning: string | null = typeof rawReasoning === "string" ? rawReasoning : null;

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
                  <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <span>Actor: {entry.actor}</span>
                    <span className="text-xs font-mono text-slate-400">→</span>
                    <span className="text-xs font-mono uppercase bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                      {entry.outcome}
                    </span>
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

            {/* PROMINENT REASONING CALLOUT - Primary design requirement */}
            {reasoning && (
              <div className="my-3 bg-blue-50/60 border-l-4 border-blue-500 p-4 rounded-r-lg">
                <div className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  AI Diagnosis & Decision Reasoning
                </div>
                <p className="text-sm text-slate-800 italic font-serif leading-relaxed">
                  &quot;{reasoning}&quot;
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
