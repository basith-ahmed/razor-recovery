"use client";

import React, { useState } from "react";
import Link from "next/link";
import { askAuditQuery } from "../lib/api";

export interface AuditQueryPanelProps {
  entityId?: string;
  title?: string;
  description?: string;
  placeholder?: string;
}

export function AuditQueryPanel({
  entityId,
  title,
  description,
  placeholder,
}: AuditQueryPanelProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<{
    answer: string;
    citedEntityIds: string[];
  } | null>(null);

  const sampleQuestions = entityId
    ? [
        "Why was this customer escalated?",
        "What was the diagnosed cause for this event?",
        "What actions were attempted before the final outcome?",
      ]
    : [
        "Why do timeout payments get retried immediately?",
        "What actions are taken when a customer is marked DNC?",
        "How are high-value enterprise invoice disputes handled?",
      ];

  const handleAsk = async (queryText?: string) => {
    const q = (queryText ?? question).trim();
    if (!q) return;

    setLoading(true);
    setError(null);

    try {
      const res = await askAuditQuery(q, entityId);
      setResponse(res);
      if (queryText) {
        setQuestion(queryText);
      }
    } catch (err: unknown) {
      console.error("Audit query error:", err);
      const msg = err instanceof Error ? err.message : "Failed to query audit assistant.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAsk();
  };

  return (
    <div className="bg-white border border-slate-300 rounded p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {title || (entityId ? "Ask AI About This Entity's History" : "Natural-Language Audit Trail Assistant")}
        </h3>
        <p className="text-xs text-slate-500">
          {description ||
            (entityId
              ? "Answers are strictly grounded in this entity's immutable audit records."
              : "Query recovery decisions, diagnosis patterns, and policy compliance across the system.")}
        </p>
      </div>

      {/* Suggested Quick Questions */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-slate-500">Suggestions:</span>
        {sampleQuestions.map((sq, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleAsk(sq)}
            disabled={loading}
            className="text-xs bg-slate-100 text-slate-700 border border-slate-300 px-2 py-1 rounded"
          >
            &quot;{sq}&quot;
          </button>
        ))}
      </div>

      {/* Form Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            placeholder ||
            (entityId
              ? "Ask a question about this entity's audit sequence..."
              : "Ask anything about past recovery actions, causes, or policies...")
          }
          className="flex-1 text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-900 placeholder-slate-400"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="bg-blue-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded"
        >
          {loading ? "Analyzing..." : "Ask"}
        </button>
      </form>

      {/* Error display */}
      {error && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
          {error}
        </div>
      )}

      {/* Response Display */}
      {response && (
        <div className="mt-4 pt-3 border-t border-slate-200 space-y-2">
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Assistant Answer:
            </div>
            <p className="text-xs text-slate-800 whitespace-pre-wrap">
              {response.answer}
            </p>
          </div>

          {/* Citations section */}
          {response.citedEntityIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-500">
                Cited Audit Entities:
              </span>
              {response.citedEntityIds.map((cid) => (
                <Link
                  key={cid}
                  href={`/entities/${cid}`}
                  className="text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded"
                >
                  [entity:{cid.slice(0, 8)}...]
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
