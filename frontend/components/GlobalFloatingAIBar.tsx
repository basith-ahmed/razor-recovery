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
  // 1. Entity detail page: /entities/[id]
  const entityMatch = pathname.match(/^\/entities\/([^/]+)$/);
  if (entityMatch && entityMatch[1]) {
    return {
      title: "Entity Audit Copilot",
      entityId: entityMatch[1],
      sampleQuestions: [
        "Why was this customer escalated?",
        "What was the diagnosed cause for this event?",
        "What actions were attempted before the final outcome?",
        "How was the recovery policy and cooldown determined?",
        "Why did the autonomous dunning rule trigger?",
      ],
    };
  }

  // 2. Promise detail page: /promises/[id]
  const promiseMatch = pathname.match(/^\/promises\/([^/]+)$/);
  if (promiseMatch && promiseMatch[1]) {
    return {
      title: "Promise Commitment Copilot",
      entityId: promiseMatch[1],
      scope: "promises",
      sampleQuestions: [
        "What is the status and history of this payment commitment?",
        "When was the payment link created and has the customer opened it?",
        "What happens when this promise reaches its grace period?",
        "Has a reminder email been scheduled for this customer?",
        "What was the previous transaction failure reason for this customer?",
      ],
    };
  }

  // 3. Ticket detail page: /tickets/[id]
  const ticketMatch = pathname.match(/^\/tickets\/([^/]+)$/);
  if (ticketMatch && ticketMatch[1]) {
    return {
      title: "Escalation Case Copilot",
      entityId: ticketMatch[1],
      scope: "escalations",
      sampleQuestions: [
        "What were the automated actions attempted before escalation?",
        "What is the diagnosed cause and policy reasoning for this case?",
        "What are the internal notes logged by previous agents?",
        "How can I send a custom recovery payment link to this customer?",
        "What is the risk score and lifetime value of this customer?",
      ],
    };
  }

  // 4. Entities list page: /entities
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

  // 5. Promises list page: /promises
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

  // 6. Escalations list page: /tickets
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

  // 7. Metrics page: /metrics
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

  // 8. Policy page: /policy
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

  // 9. Overview page: /
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
