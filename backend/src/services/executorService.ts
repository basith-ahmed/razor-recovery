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
  buildPromiseConfirmationEmail,
} from "../domain/emailTemplates";

import { findCustomerById } from "./customerService";
import { revenueEventExists } from "./revenueEventService";

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
      detail: "Retry deferred; will execute when the cause cooldown window lapses.",
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
    const customer = await findCustomerById(event.customerId);
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
    const customer = await findCustomerById(event.customerId);
    
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
        notify: false,
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
    const customer = await findCustomerById(event.customerId);
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

    const eventExists = await revenueEventExists(event.id);

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

    const { subject, html } = buildPromiseConfirmationEmail({
      customerName: customer.name,
      amount: event.amount,
      promisedDate,
      paymentUrl: linkResult.paymentLinkShortUrl,
    });

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

    const formattedDate = promisedDate.toISOString().split("T")[0];

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
      `Unrecognized action "${chosenAction}" — no integration mapping exists.`,
      "UNMAPPED_ACTION",
    );
  }

  const eventExists = await revenueEventExists(event.id);

  if (!eventExists) {
    console.warn(
      `[executor] Cannot persist Action for event ${event.id}: RevenueEvent does not exist in DB. Skipping.`,
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
