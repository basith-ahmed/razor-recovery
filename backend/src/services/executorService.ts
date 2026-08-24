/**
 * Executor Service — maps a DecisionResult to the appropriate integration call,
 * persists the Action record, and returns the ActionResult.
 *
 * Contains draftRecoveryEmail(), the third AI touchpoint (alongside diagnosis
 * and decision), which asks Gemini for email copy in a billing-recovery tone.
 */

import { requestJson } from "../config/openai";
import { prisma } from "../config/prisma";
import * as razorpayIntegration from "../integrations/razorpayIntegration";
import * as emailIntegration from "../integrations/emailIntegration";
import * as ticketMock from "../integrations/ticketMock";
import {
  ActionResult,
  DecisionResult,
  DomainError,
  EnrichedRevenueEvent,
} from "../domain/types";

const RETRY_ACTIONS = new Set([
  "retry_payment",
  "retry_payment_immediate",
  "retry_payment_delayed",
]);

const PAYMENT_LINK_ACTIONS = new Set(["send_payment_link", "send_sms_reminder"]);

const EMAIL_ACTIONS = new Set([
  "send_reminder_email",
  "send_soft_chase_email",
  "send_dunning_email_1",
  "send_dunning_email_2",
  "send_dunning_email_3",
  "send_reminder",
  "send_winback_offer",
]);

const EMAIL_DRAFT_SYSTEM_PROMPT = `You are RazorRecovery's email copywriter. Write a short, friendly billing-recovery email. Return JSON only with "subject" and "html" fields. The html should be a complete email body with proper HTML formatting. Keep the tone empathetic, professional, and action-oriented. Do not include unsubscribe links or legal disclaimers.`;

const emailDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "html"],
  properties: {
    subject: { type: "string" },
    html: { type: "string" },
  },
};

/**
 * AI Touchpoint #3: Drafts recovery email copy using Gemini.
 * Kept as a separate, clearly-labeled function for easy identification.
 */
export async function draftRecoveryEmail(
  customerName: string,
  cause: string,
  amount: number,
): Promise<{ subject: string; html: string }> {
  try {
    const input = JSON.stringify({
      customerName,
      cause,
      amount,
      currency: "INR",
    });
    const raw = await requestJson({
      instructions: EMAIL_DRAFT_SYSTEM_PROMPT,
      input,
      schemaName: "recovery_email_draft",
      schema: emailDraftSchema,
    });

    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as Record<string, unknown>).subject === "string" &&
        typeof (parsed as Record<string, unknown>).html === "string"
      ) {
        return {
          subject: (parsed as { subject: string; html: string }).subject,
          html: (parsed as { subject: string; html: string }).html,
        };
      }
    } catch {
      // Regex extraction fallback if JSON.parse fails on unescaped control chars/quotes
      const matchSubject = /"subject"\s*:\s*"([^"]*)"/.exec(cleaned);
      const matchHtml = /"html"\s*:\s*"([\s\S]*?)"\s*\}/.exec(cleaned);
      if (matchSubject && matchHtml) {
        return {
          subject: matchSubject[1],
          html: matchHtml[1].replace(/\\"/g, '"'),
        };
      }
    }

    console.warn(`[executor] Gemini returned non-standard email JSON. Using clean fallback email copy.`);
    return fallbackEmail(customerName, amount);
  } catch (error) {
    console.warn(`[executor] Gemini request unavailable; using fallback email copy.`);
    return fallbackEmail(customerName, amount);
  }
}

function fallbackEmail(
  customerName: string,
  amount: number,
): { subject: string; html: string } {
  return {
    subject: `Action required: pending payment of \u20b9${amount}`,
    html: `<p>Hi ${customerName},</p><p>We noticed a pending payment of \u20b9${amount}. Please update your payment method at your earliest convenience.</p><p>Best regards,<br/>Billing Team</p>`,
  };
}

/**
 * Look up customer details needed for integration calls.
 */
async function lookupCustomer(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });
  if (!customer) {
    throw new DomainError(
      `Customer ${customerId} not found.`,
      "CUSTOMER_NOT_FOUND",
    );
  }
  return customer;
}

/**
 * Executes the chosen action from a DecisionResult by dispatching to the
 * appropriate integration, persists the Action row, and returns the result.
 */
export async function executeAction(
  decision: DecisionResult,
  event: EnrichedRevenueEvent,
): Promise<ActionResult> {
  const { chosenAction } = decision;
  let actionResult: ActionResult;

  if (chosenAction === "none") {
    actionResult = {
      actionType: "none",
      result: "skipped",
      integration: "MOCK",
    };
  } else if (RETRY_ACTIONS.has(chosenAction)) {
    if (!event.razorpayOrderId) {
      throw new DomainError(
        `Cannot retry payment: event ${event.id} has no razorpayOrderId.`,
        "MISSING_ORDER_ID",
      );
    }
    actionResult = await razorpayIntegration.retryPayment(
      event.razorpayOrderId,
    );
    actionResult = { ...actionResult, actionType: chosenAction };
  } else if (PAYMENT_LINK_ACTIONS.has(chosenAction)) {
    const customer = await lookupCustomer(event.customerId);
    actionResult = await razorpayIntegration.createRecoveryPaymentLink({
      amount: event.amount,
      currency: event.currency,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone ?? undefined,
      description: `Recovery payment for ${event.eventType} — ${event.entityId}`,
    });
    actionResult = { ...actionResult, actionType: chosenAction };
  } else if (EMAIL_ACTIONS.has(chosenAction)) {
    const customer = await lookupCustomer(event.customerId);
    const { subject, html } = await draftRecoveryEmail(
      customer.name,
      event.errorReason ?? "payment issue",
      event.amount,
    );
    actionResult = await emailIntegration.sendRecoveryEmail({
      to: customer.email,
      subject,
      html,
    });
    actionResult = { ...actionResult, actionType: chosenAction };
  } else if (chosenAction === "escalate_to_human") {
    actionResult = await ticketMock.escalateToHuman(
      event.entityId,
      decision.reasoning,
    );
  } else if (
    chosenAction === "pause_subscription" ||
    chosenAction === "auto_cancel" ||
    chosenAction === "hard_decline" ||
    chosenAction === "start_promise_to_pay_tracking"
  ) {
    actionResult = {
      actionType: chosenAction,
      result: "success",
      integration: "MOCK",
      detail: `Executed ${chosenAction} for entity ${event.entityId}.`,
    };
  } else {
    throw new DomainError(
      `Unrecognized action "${chosenAction}" — no integration mapping exists. This is a correctness guard; every action in policy.json must be mapped.`,
      "UNMAPPED_ACTION",
    );
  }

  // Persist the Action row
  await prisma.action.create({
    data: {
      eventId: event.id,
      actionType: actionResult.actionType,
      result: actionResult.result,
      integration: actionResult.integration,
      razorpayPaymentLinkId: actionResult.razorpayPaymentLinkId ?? null,
      emailMessageId: actionResult.emailMessageId ?? null,
    },
  });

  return actionResult;
}
