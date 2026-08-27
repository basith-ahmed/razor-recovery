/**
 * Executor Service — maps a DecisionResult to the appropriate integration call,
 * persists the Action record, and returns the ActionResult.
 *
 * Contains draftRecoveryEmail(), the third AI touchpoint (alongside diagnosis
 * and decision), which asks the LLM for email copy in a billing-recovery tone.
 */

import { requestJson } from "../config/openai";
import { logWarn } from "../config/logger";
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

const RETRY_ACTIONS = new Set(["retry_payment", "retry_payment_immediate"]);

const PAYMENT_LINK_ACTIONS = new Set(["send_payment_link"]);

const EMAIL_ACTIONS = new Set([
  "send_reminder_email",
  "send_soft_chase_email",
  "send_dunning_email_1",
  "send_dunning_email_2",
  "send_dunning_email_3",
  "send_reminder",
  "send_winback_offer",
]);

const EMAIL_DRAFT_SYSTEM_PROMPT = `You are RazorRecovery's email copywriter. Write a short, highly personalized, friendly billing-recovery email.
Return JSON only with "subject" and "body_paragraphs" fields. 
The "body_paragraphs" should be an array of simple text strings. Do not include HTML tags.

CRITICAL INSTRUCTIONS FOR PERSONALIZATION:
- Analyze the "eventType" (e.g., PAYMENT_FAILED, SUBSCRIPTION_FAILED, INVOICE_OVERDUE).
- Analyze the "errorReason" and "errorCode" (e.g., insufficient_balance, card_expired). Mention this specifically but politely in the email (e.g., "It looks like your card might have expired" or "It seems the payment failed due to insufficient funds").
- Provide context (e.g., "your recent subscription renewal", "your pending invoice").
- Include the "entityId" if it helps identify the transaction (e.g., "Order/Invoice #${`{entityId}`.slice(-6)}").
Keep the tone empathetic, professional, and action-oriented. Do not include unsubscribe links or legal disclaimers.`;

const emailDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body_paragraphs"],
  properties: {
    subject: { type: "string" },
    body_paragraphs: { 
      type: "array", 
      items: { type: "string" } 
    },
  },
};

function buildEmailTemplate(paragraphs: string[], amount: number, paymentUrl?: string): string {
  const contentHtml = paragraphs.map(p => `<p style="margin-bottom: 16px;">${p}</p>`).join("");
  const buttonHtml = paymentUrl 
    ? `<div style="text-align: center; margin: 32px 0;">
         <a href="${paymentUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Pay \u20b9${amount} Now</a>
       </div>`
    : "";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333; background-color: #ffffff; border-radius: 8px; border: 1px solid #eaeaea;">
      <h2 style="color: #4f46e5; margin-top: 0; margin-bottom: 24px;">RazorRecovery</h2>
      ${contentHtml}
      ${buttonHtml}
      <hr style="border: none; border-top: 1px solid #eaeaea; margin: 32px 0;" />
      <p style="font-size: 12px; color: #888; margin: 0;">
        This is an automated message regarding a pending payment of \u20b9${amount}. If you've already resolved this, please ignore this email.
      </p>
    </div>
  `;
}

function parseEmailDraftJson(raw: string): { subject: string; paragraphs: string[] } | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.subject === "string" && Array.isArray(parsed.body_paragraphs)) {
      return { subject: parsed.subject, paragraphs: parsed.body_paragraphs };
    }
  } catch (err) {
    // Basic repair: if LLM returned unescaped newlines inside strings, remove them
    let repaired = cleaned.replace(/\n/g, " ").replace(/\r/g, "");
    try {
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed.subject === "string" && Array.isArray(parsed.body_paragraphs)) {
        return { subject: parsed.subject, paragraphs: parsed.body_paragraphs };
      }
    } catch (err2) {
      return null;
    }
  }
  return null;
}

/**
 * AI Touchpoint #3: Drafts recovery email copy using the LLM.
 * Kept as a separate, clearly-labeled function for easy identification.
 */
export async function draftRecoveryEmail(
  event: EnrichedRevenueEvent,
  customerName: string,
  cause: string,
  paymentUrl?: string,
): Promise<{ subject: string; html: string }> {
  try {
    const input = JSON.stringify({
      customerName,
      cause,
      amount: event.amount,
      currency: event.currency,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      errorCode: event.errorCode,
      errorReason: event.errorReason,
      hasPaymentLinkIncluded: !!paymentUrl,
    });
    const raw = await requestJson({
      instructions: EMAIL_DRAFT_SYSTEM_PROMPT,
      input,
      schemaName: "recovery_email_draft",
      schema: emailDraftSchema,
    });

    const parsed = parseEmailDraftJson(raw);
    if (parsed) {
      const html = buildEmailTemplate(parsed.paragraphs, event.amount, paymentUrl);
      return { subject: parsed.subject, html };
    }

    console.warn(`[executor] LLM returned unrepairable non-standard email JSON. Using fallback.`);
    return fallbackEmail(customerName, event.amount, paymentUrl);
  } catch (error) {
    console.warn(`[executor] LLM request unavailable; using fallback email copy.`);
    return fallbackEmail(customerName, event.amount, paymentUrl);
  }
}

function fallbackEmail(
  customerName: string,
  amount: number,
  paymentUrl?: string,
): { subject: string; html: string } {
  return {
    subject: `Action required: pending payment of \u20b9${amount}`,
    html: buildEmailTemplate([
      `Hi ${customerName},`,
      `We noticed a pending payment of \u20b9${amount}. Please update your payment method at your earliest convenience.`,
      `Best regards,<br/>The RazorRecovery Team`
    ], amount, paymentUrl),
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
  } else if (chosenAction === "retry_payment_delayed") {
    // Honest delayed retry: do NOT hit Razorpay now. Persist the intent as
    // "scheduled"; the follow-up scheduler executes the real retry once this
    // cause's cooldown window lapses. The scheduled action still starts the
    // cooldown clock (see auditService) so nothing else contacts meanwhile.
    if (!event.razorpayOrderId) {
      throw new DomainError(
        `Cannot schedule retry: event ${event.id} has no razorpayOrderId.`,
        "MISSING_ORDER_ID",
      );
    }
    actionResult = {
      actionType: chosenAction,
      result: "scheduled",
      integration: "RAZORPAY",
      detail:
        "Retry deferred; will execute when the cause cooldown window lapses.",
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
    
    let paymentUrl: string | undefined;
    let paymentLinkId: string | undefined;

    try {
      const linkResult = await razorpayIntegration.createRecoveryPaymentLink({
        amount: event.amount,
        currency: event.currency,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone ?? undefined,
        description: `Recovery payment for ${event.eventType} — ${event.entityId}`,
        notify: false, // Do not let Razorpay send its default email/SMS
      });
      paymentUrl = linkResult.paymentLinkShortUrl;
      paymentLinkId = linkResult.razorpayPaymentLinkId;
    } catch (err) {
      logWarn("executor", err);
      console.warn("[executor] Proceeding without payment-link button in email.");
    }

    const { subject, html } = await draftRecoveryEmail(
      event,
      customer.name,
      event.errorReason ?? "payment issue",
      paymentUrl
    );
    actionResult = await emailIntegration.sendRecoveryEmail({
      to: customer.email,
      subject,
      html,
    });
    
    actionResult = { 
      ...actionResult, 
      actionType: chosenAction,
      razorpayPaymentLinkId: paymentLinkId,
      paymentLinkShortUrl: paymentUrl
    };
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

  // Persist the Action row.
  // Upsert: Kafka is at-least-once, so replays after a consumer restart or
  // rebalance must not fail on the eventId unique constraint. External side
  // effects above remain at-least-once; the stage dedup key is the first line
  // of defense against re-execution.
  await prisma.action.upsert({
    where: { eventId: event.id },
    update: {
      actionType: actionResult.actionType,
      result: actionResult.result,
      integration: actionResult.integration,
      razorpayPaymentLinkId: actionResult.razorpayPaymentLinkId ?? null,
      emailMessageId: actionResult.emailMessageId ?? null,
    },
    create: {
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
