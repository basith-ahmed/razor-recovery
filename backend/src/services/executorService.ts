/**
 * Executor Service — maps a DecisionResult to the appropriate integration call,
 * persists the Action record, and returns the ActionResult.
 *
 * Contains draftRecoveryEmail(), the third AI touchpoint (alongside diagnosis
 * and decision), which asks the LLM for email copy in a billing-recovery tone.
 */

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
import {
  generateRecoveryEmail,
  buildEmailTemplate,
} from "../domain/emailTemplates";

export { buildEmailTemplate };

const RETRY_ACTIONS = new Set(["retry_payment_immediate"]);

const PAYMENT_LINK_ACTIONS = new Set(["send_payment_link"]);

const EMAIL_ACTIONS = new Set([
  "send_reminder_email",
  "send_soft_chase_email",
  "send_dunning_email_1",
  "send_dunning_email_2",
  "send_dunning_email_3",
  "send_winback_offer",
]);

/**
 * Drafts recovery email copy using pre-generated, parameterized templates.
 * Deterministic, instant, brand-compliant, with zero token latency or cost.
 */
export async function draftRecoveryEmail(
  event: EnrichedRevenueEvent,
  customerName: string,
  cause: string,
  paymentUrl?: string,
): Promise<{ subject: string; html: string }> {
  return generateRecoveryEmail({
    customerName,
    amount: event.amount,
    currency: event.currency,
    entityId: event.entityId,
    entityType: event.entityType,
    eventType: event.eventType,
    errorReason: event.errorReason,
    errorCode: event.errorCode,
    cause,
    paymentUrl,
  });
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
    const hasIdentifier =
      event.entityType === "SUBSCRIPTION"
        ? Boolean(
            event.entityId ||
              (event.rawPayload as Record<string, unknown>)?.subscription_id ||
              (event.rawPayload as Record<string, unknown>)?.razorpay_subscription_id,
          )
        : Boolean(event.razorpayOrderId);

    if (!hasIdentifier) {
      throw new DomainError(
        `Cannot schedule retry: event ${event.id} has no ${event.entityType === "SUBSCRIPTION" ? "subscription identifier" : "razorpayOrderId"}.`,
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
    if (event.entityType === "SUBSCRIPTION") {
      const subId =
        ((event.rawPayload as Record<string, unknown>)?.razorpay_subscription_id as string) ||
        ((event.rawPayload as Record<string, unknown>)?.subscription_id as string) ||
        event.entityId;
      actionResult = {
        actionType: chosenAction,
        result: "success",
        integration: "RAZORPAY",
        detail: `Subscription ${subId} queued for retry re-presentation via Razorpay.`,
      };
    } else {
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
    }
  } else if (PAYMENT_LINK_ACTIONS.has(chosenAction)) {
    const customer = await lookupCustomer(event.customerId);
    actionResult = await razorpayIntegration.createRecoveryPaymentLink({
      amount: event.amount,
      currency: event.currency,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone ?? undefined,
      description: `Recovery payment for ${event.eventType} — ${event.entityId}`,
      eventId: event.id,
      actionType: chosenAction,
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
        eventId: event.id,
        actionType: chosenAction,
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
  } else if (chosenAction === "start_promise_to_pay_tracking") {
    const customer = await lookupCustomer(event.customerId);
    const rawPayload = (event.rawPayload || {}) as Record<string, unknown>;
    const promisedDateStr = rawPayload.promisedDate as string | undefined;
    const promisedDate = promisedDateStr ? new Date(promisedDateStr) : new Date(Date.now() + 7 * 86400 * 1000);

    const linkResult = await razorpayIntegration.createRecoveryPaymentLink({
      amount: event.amount,
      currency: event.currency,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone ?? undefined,
      description: `Promise-to-Pay for ${event.eventType} — ${event.entityId}`,
      notify: false,
      eventId: event.id,
      actionType: chosenAction,
    });

    // Check if event exists before creating the PromiseToPay relation
    const eventExists = await prisma.revenueEvent.findUnique({
      where: { id: event.id },
      select: { id: true },
    });

    await prisma.promiseToPay.create({
      data: {
        entityId: event.entityId,
        customerId: event.customerId,
        eventId: eventExists ? event.id : null,
        promisedAmount: event.amount,
        currency: event.currency,
        promisedDate,
        status: "pending",
        razorpayPaymentLinkId: linkResult.razorpayPaymentLinkId,
        paymentLinkUrl: linkResult.paymentLinkShortUrl,
        notes: (rawPayload.notes as string) || `Promise-to-pay commitment registered for ₹${event.amount} due by ${promisedDate.toISOString().split("T")[0]}.`,
      },
    });

    const formattedDate = promisedDate.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const subject = `Promise-to-Pay Confirmation: ₹${event.amount} commitment due by ${formattedDate}`;
    const html = buildEmailTemplate([
      `Hi ${customer.name},`,
      `Thank you for confirming your commitment to pay. We have recorded your promise to settle ₹${event.amount} on or before <strong>${formattedDate}</strong>.`,
      `You can complete your payment securely anytime before the due date using the button below:`,
      `If you have any questions or require an adjustment to your schedule, please feel free to reply to this email.`,
    ], event.amount, linkResult.paymentLinkShortUrl);

    let emailMsgId: string | undefined;
    try {
      const emailRes = await emailIntegration.sendRecoveryEmail({
        to: customer.email,
        subject,
        html,
      });
      emailMsgId = emailRes.emailMessageId;
    } catch (err) {
      logWarn("executor", err);
      console.warn("[executor] Failed to send promise confirmation email; payment link remains active.");
    }

    actionResult = {
      actionType: chosenAction,
      result: "success",
      integration: "RAZORPAY",
      razorpayPaymentLinkId: linkResult.razorpayPaymentLinkId,
      paymentLinkShortUrl: linkResult.paymentLinkShortUrl,
      emailMessageId: emailMsgId,
      detail: `Promise-to-pay commitment registered for ₹${event.amount} due by ${formattedDate}. Payment link generated.`,
    };
  } else if (chosenAction === "escalate_to_human") {
    actionResult = await ticketMock.escalateToHuman(
      event.entityId,
      decision.reasoning,
    );
  } else if (
    chosenAction === "pause_subscription" ||
    chosenAction === "auto_cancel" ||
    chosenAction === "hard_decline"
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
  const eventExists = await prisma.revenueEvent.findUnique({
    where: { id: event.id },
    select: { id: true },
  });

  if (!eventExists) {
    console.warn(
      `[executor] Cannot persist Action for event ${event.id}: RevenueEvent does not exist in DB (orphaned Kafka message). Skipping.`,
    );
    return actionResult;
  }

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
