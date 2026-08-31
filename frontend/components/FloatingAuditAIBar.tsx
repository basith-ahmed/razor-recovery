"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { askAuditQuery } from "../lib/api";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface FloatingAuditAIBarProps {
  entityId?: string;
  scope?: string;
  title?: string;
  sampleQuestions?: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citedEntityIds?: string[];
  timestamp: string;
}

const DEFAULT_ENTITY_QUESTIONS = [
  "Why was this customer escalated?",
  "What was the diagnosed cause for this event?",
  "What actions were attempted before the final outcome?",
  "How was the recovery policy and cooldown determined?",
  "Why did the autonomous dunning rule trigger?",
];

const DEFAULT_GLOBAL_QUESTIONS = [
  "Why do timeout payments get retried immediately?",
  "What actions are taken when a customer is marked DNC?",
  "How are high-value enterprise invoice disputes handled?",
  "What triggers an escalation ticket for support agents?",
  "How does the promise-to-pay grace period work?",
];

export function FloatingAuditAIBar({
  entityId,
  scope,
  title,
  sampleQuestions,
}: FloatingAuditAIBarProps) {
  const questionsList =
    sampleQuestions && sampleQuestions.length > 0
      ? sampleQuestions
      : entityId
      ? DEFAULT_ENTITY_QUESTIONS
      : DEFAULT_GLOBAL_QUESTIONS;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Rotate sample placeholder questions every 10s when input is not focused and not typing
  useEffect(() => {
    if (isFocused || question.trim().length > 0) return;
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % questionsList.length);
    }, 10000);
    return () => clearInterval(interval);
  }, [isFocused, question, questionsList.length]);

  // Auto-scroll to the bottom when new messages arrive or when drawer opens
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, isOpen]);

  const currentPlaceholder = questionsList[placeholderIndex % questionsList.length];

  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      inputRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  const handleAsk = async (queryToAsk?: string) => {
    const q = (queryToAsk ?? (question.trim() || currentPlaceholder)).trim();
    if (!q || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setLoading(true);
    setError(null);
    setIsOpen(true);

    try {
      const res = await askAuditQuery(q, entityId, scope);
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.answer,
        citedEntityIds: res.citedEntityIds,
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      console.error("Audit query error:", err);
      const msg = err instanceof Error ? err.message : "Failed to query audit assistant.";
      setError(msg);
    } finally {
      setLoading(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAsk();
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-2xl">
      {/* Response / Conversation Drawer */}
      {isOpen && (
        <div className="mb-2.5 bg-white border border-hairline rounded-[12px] shadow-notion-elevated overflow-hidden flex flex-col max-h-[60vh]">
          {/* Header */}
          <div className="px-4 py-2.5 bg-canvas-soft border-b border-hairline flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ink tracking-[-0.125px]">
                {title || (entityId ? "AI Audit Assistant" : "AI Recovery Copilot")}
              </span>
              <span className="text-xs text-ink-muted">
                ({messages.length} message{messages.length !== 1 ? "s" : ""})
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-ink-muted hover:text-ink text-xs px-2.5 py-1 border border-hairline rounded-[8px] bg-white hover:bg-canvas-soft transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-ink-muted hover:text-ink text-xs px-2.5 py-1 border border-hairline rounded-[8px] bg-white hover:bg-canvas-soft transition-colors"
              >
                Close
              </button>
            </div>
          </div>

          {/* Messages History List */}
          <div className="p-4 overflow-y-auto space-y-3 text-xs flex-1">
            {messages.length === 0 && !loading && (
              <div className="py-6 text-center text-ink-muted text-xs">
                No questions asked yet. Type a question below or click Ask AI.
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div className="text-[10px] text-ink-faint mb-1 px-1">
                  {m.role === "user" ? "You" : "Audit Assistant"} · {m.timestamp}
                </div>

                <div
                  className={`p-3.5 text-xs leading-relaxed ${
                    m.role === "user"
                      ? "max-w-[85%] rounded-[12px] rounded-br-[2px] bg-primary text-white font-medium shadow-xs"
                      : "max-w-[90%] rounded-[12px] rounded-bl-[2px] bg-canvas-soft border border-hairline text-ink shadow-xs"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <MarkdownRenderer content={m.content} />
                  ) : (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  )}

                  {m.citedEntityIds && m.citedEntityIds.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-hairline flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-ink-muted">
                        Cited Records:
                      </span>
                      {m.citedEntityIds.map((cid) => (
                        <Link
                          key={cid}
                          href={`/entities/${cid}`}
                          className="text-[11px] text-primary bg-white border border-primary/20 px-2 py-0.5 rounded-full hover:bg-primary/10 hover:underline transition-colors font-medium"
                        >
                          {cid}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex flex-col items-start">
                <div className="text-[10px] text-ink-faint mb-1 px-1">
                  {title || "AI Assistant"} · Thinking...
                </div>
                <div className="bg-canvas-soft border border-hairline rounded-[12px] rounded-bl-[2px] p-3 text-xs text-ink-muted">
                  Generating response...
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep rounded-[8px] text-xs">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Floating Bottom Bar (Seamless Pill Style) */}
      <form
        onSubmit={handleSubmit}
        className="bg-white/55 backdrop-blur-[8px] border-2 border-hairline rounded-full p-1.5 pl-3 shadow-notion-elevated flex items-center gap-2.5 transition-all focus-within:border-primary/40 focus-within:shadow-md text-xs"
      >

        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={currentPlaceholder}
          className="flex-1 bg-transparent border-0 outline-none text-ink placeholder:text-ink-faint focus:outline-none focus:ring-0 px-1 py-1"
          disabled={loading}
        />

        <button
          type="submit"
          disabled={loading}
          className="bg-primary hover:bg-primary-active active:scale-[0.98] disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-full shrink-0 shadow-sm transition-all h-9"
        >
          {loading ? "Thinking..." : "Ask AI"}
        </button>
      </form>
    </div>
  );
}
