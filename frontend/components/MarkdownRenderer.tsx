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
          className="inline-flex items-center font-mono text-[11px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded hover:bg-blue-100 hover:underline mx-0.5 align-baseline"
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
    <div className={`text-xs text-slate-800 leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 leading-relaxed">{processChildren(children)}</p>,
          h1: ({ children }) => <h1 className="font-bold text-slate-900 text-sm mt-3 mb-1.5">{processChildren(children)}</h1>,
          h2: ({ children }) => <h2 className="font-bold text-slate-900 text-sm mt-2.5 mb-1">{processChildren(children)}</h2>,
          h3: ({ children }) => <h3 className="font-semibold text-slate-900 text-xs mt-2 mb-1">{processChildren(children)}</h3>,
          h4: ({ children }) => <h4 className="font-semibold text-slate-900 text-xs mt-1.5 mb-0.5">{processChildren(children)}</h4>,
          ul: ({ children }) => <ul className="my-1.5 list-disc list-inside space-y-1 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal list-inside space-y-1 pl-1">{children}</ol>,
          li: ({ children }) => <li className="text-xs leading-relaxed">{processChildren(children)}</li>,
          strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            return isBlock ? (
              <pre className="my-2 p-2.5 bg-slate-900 text-slate-100 rounded font-mono text-[11px] overflow-x-auto">
                <code>{children}</code>
              </pre>
            ) : (
              <code className="font-mono text-[11px] bg-slate-200/80 text-slate-800 px-1 py-0.5 rounded">
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 border border-slate-200 rounded">
              <table className="w-full text-left text-xs border-collapse divide-y divide-slate-200">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-50 text-slate-600 font-medium">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-slate-200 bg-white">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-slate-50">{children}</tr>,
          th: ({ children }) => <th className="p-2 text-xs font-semibold">{children}</th>,
          td: ({ children }) => <td className="p-2 text-xs">{processChildren(children)}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-slate-300 pl-2.5 my-1.5 italic text-slate-600">
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
