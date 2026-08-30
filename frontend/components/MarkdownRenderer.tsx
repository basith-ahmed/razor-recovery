"use client";

import React from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Replaces [entity:id] tokens inside text with interactive Next.js Link badges
function formatTextWithEntityLinks(text: string): React.ReactNode {
  const tokenRegex = /(\[entity:[^\]\s]+\])/g;
  const parts = text.split(tokenRegex);

  if (parts.length === 1) return text;

  return parts.map((part, index) => {
    if (part.startsWith("[entity:") && part.endsWith("]")) {
      const entityId = part.slice(8, -1);
      return (
        <Link
          key={index}
          href={`/entities/${entityId}`}
          className="inline-flex items-center text-[11px] font-semibold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full hover:bg-primary/20 hover:underline mx-0.5 align-baseline"
        >
          [entity:{entityId.length > 12 ? entityId.slice(0, 8) + "..." : entityId}]
        </Link>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function processChildren(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") {
    return formatTextWithEntityLinks(children);
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => (
      <React.Fragment key={idx}>{processChildren(child)}</React.Fragment>
    ));
  }
  return children;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  if (!content) return null;

  return (
    <div className={`text-xs text-ink-secondary leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 leading-relaxed">{processChildren(children)}</p>,
          h1: ({ children }) => <h1 className="font-bold text-ink text-sm mt-3 mb-1.5">{processChildren(children)}</h1>,
          h2: ({ children }) => <h2 className="font-bold text-ink text-sm mt-2.5 mb-1">{processChildren(children)}</h2>,
          h3: ({ children }) => <h3 className="font-semibold text-ink text-xs mt-2 mb-1">{processChildren(children)}</h3>,
          h4: ({ children }) => <h4 className="font-semibold text-ink text-xs mt-1.5 mb-0.5">{processChildren(children)}</h4>,
          ul: ({ children }) => <ul className="my-1.5 list-disc list-inside space-y-1 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal list-inside space-y-1 pl-1">{children}</ol>,
          li: ({ children }) => <li className="text-xs leading-relaxed">{processChildren(children)}</li>,
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            return isBlock ? (
              <pre className="my-2 p-2.5 bg-ink text-white rounded-[6px] font-mono text-[11px] overflow-x-auto border border-hairline">
                <code>{children}</code>
              </pre>
            ) : (
              <code className="font-mono text-[11px] bg-canvas-soft border border-hairline text-ink px-1.5 py-0.5 rounded-[4px]">
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 border border-hairline rounded-[8px]">
              <table className="w-full text-left text-xs border-collapse divide-y divide-hairline">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-canvas-soft text-ink-muted text-[11px] font-semibold uppercase tracking-eyebrow">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-hairline bg-white">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-canvas-soft transition-colors">{children}</tr>,
          th: ({ children }) => <th className="p-2.5 text-xs font-semibold">{children}</th>,
          td: ({ children }) => <td className="p-2.5 text-xs">{processChildren(children)}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary pl-2.5 my-1.5 italic text-ink-muted bg-primary/5 py-1 rounded-r-[4px]">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
