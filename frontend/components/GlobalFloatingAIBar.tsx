"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { FloatingAuditAIBar } from "./FloatingAuditAIBar";

interface RouteAIConfig {
  title: string;
  scope?: string;
  entityId?: string;
  sampleQuestions: string[];
}

function getRouteAIConfig(pathname: string): RouteAIConfig | null {
  // Detail pages (/entities/[id], /promises/[id], /tickets/[id]) render their
  // own FloatingAuditAIBar with the resolved entity ID — the URL parameter on
  // those routes is a ticket/promise/event ID, not an entity ID, and must not
  // be sent to the audit query API as an entity ID.

  // 1. Entities list page: /entities
  if (pathname === "/entities") {
    return {
      title: "Entities AI Assistant",
      scope: "entities",
      sampleQuestions: [
        "How many entities are currently in active recovery workflows?",
        "What are the most common payment failure causes diagnosed?",
        "Which entities have reached maximum retry attempts?",
        "How does the cooldown period work for high-risk entities?",
        "Why are certain entities placed in DO_NOT_CONTACT state?",
      ],
    };
  }

  // 2. Promises list page: /promises
  if (pathname === "/promises") {
    return {
      title: "Promises AI Assistant",
      scope: "promises",
      sampleQuestions: [
        "How many active promises to pay are in grace period?",
        "What is the total promised amount vs recovered volume?",
        "What happens when a customer misses their promised due date?",
        "How are automated reminder emails scheduled for promises?",
        "Which failure causes have the highest promise-to-pay recovery rate?",
      ],
    };
  }

  // 3. Escalations list page: /tickets
  if (pathname === "/tickets") {
    return {
      title: "Escalations AI Assistant",
      scope: "escalations",
      sampleQuestions: [
        "What are the primary reasons cases get escalated to human support?",
        "How does an agent mark an escalation as recovered or written off?",
        "Can support agents send payment links directly from the escalation workspace?",
        "What is the total revenue currently under human escalation?",
        "How are high priority escalation tickets assigned?",
      ],
    };
  }

  // 4. Metrics page: /metrics
  if (pathname === "/metrics") {
    return {
      title: "Metrics AI Assistant",
      scope: "metrics",
      sampleQuestions: [
        "What is the overall recovery rate across all channels?",
        "Which failure cause accounts for the highest recovered revenue?",
        "What is the median time to recovery across recent events?",
        "Which communication channel provides the highest recovery yield?",
        "How do human support costs compare to automated email dunning?",
      ],
    };
  }

  // 5. Policy page: /policy
  if (pathname === "/policy") {
    return {
      title: "Policy & Compliance Assistant",
      scope: "policy",
      sampleQuestions: [
        "How is the max retry attempt limit configured per failure cause?",
        "What happens when a customer is placed on the DO_NOT_CONTACT list?",
        "How is the cooling-down window calculated for retry actions?",
        "What compliance guardrails prevent spamming customer channels?",
        "How does the system enforce cryptographic audit immutability?",
      ],
    };
  }

  // 6. Overview page: /
  if (pathname === "/") {
    return {
      title: "Overview AI Copilot",
      scope: "general",
      sampleQuestions: [
        "What is the overall recovery rate and total revenue at risk?",
        "Why do timeout payments get retried immediately?",
        "What triggers an escalation ticket for support agents?",
        "How are high-value enterprise invoice disputes handled?",
        "What actions are taken when a customer is marked DNC?",
      ],
    };
  }

  return null;
}

export function GlobalFloatingAIBar() {
  const pathname = usePathname();
  const config = getRouteAIConfig(pathname);

  if (!config) return null;

  return (
    <FloatingAuditAIBar
      key={pathname}
      title={config.title}
      scope={config.scope}
      entityId={config.entityId}
      sampleQuestions={config.sampleQuestions}
    />
  );
}
