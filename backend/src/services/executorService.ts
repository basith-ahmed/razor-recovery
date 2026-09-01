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
import { getOrCreatePaymentLink } from "./paymentLinkService";
import { getRuleForCause } from "../domain/policy";

export { buildEmailTemplate };

const EMAIL_ACTIONS = new Set([
  "send_reminder_email",
  "send_soft_chase_email",
  "send_winback_offer",
]);

export async function draftRecoveryEmail(
  event: EnrichedRevenueEvent,
  customerName: string,
  cause: string,
  paymentLinkUrl?: string,
  winbackDiscountPercent?: number,
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
    paymentLinkUrl,
    winbackDiscountPercent,
  });
}

export async function executeAction(
  decision: DecisionResult,
  event: EnrichedRevenueEvent,
  causeLabel?: string,
): Promise<ActionResult> {
  const { chosenAction } = decision;
  let actionResult: ActionResult;

  if (chosenAction === "none") {
    actionResult = {
      actionType: "none",
      result: "skipped",
      integration: "NONE",
    };
  } else if (EMAIL_ACTIONS.has(chosenAction)) {
    const customer = await findCustomerById(event.customerId);

    let paymentLinkUrl: string | undefined;
    let paymentLinkId: string | undefined;

    try {
      const link = await getOrCreatePaymentLink({
        entityId: event.entityId,
        eventId: event.id,
        amount: event.amount,
        currency: event.currency,
        customer: { name: customer.name, email: customer.email, phone: customer.phone },
        description: `Recovery payment for ${event.eventType} — ${event.entityId}`,
        notify: false,
        actionType: chosenAction,
      });
      paymentLinkUrl = link.paymentLinkUrl;
      paymentLinkId = link.razorpayPaymentLinkId;
    } catch (err) {
      logWarn("executor", err);
      console.warn("[executor] Proceeding without payment-link button in email.");
    }

    const { subject, html } = await draftRecoveryEmail(
      event,
      customer.name,
      event.errorReason ?? "payment issue",
      paymentLinkUrl,
      causeLabel ? getRuleForCause(causeLabel)?.winback?.discountPercent : undefined,
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
      paymentLinkUrl,
    };
  } else if (chosenAction === "start_promise_to_pay_tracking") {
    const customer = await findCustomerById(event.customerId);
    const rawPayload = (event.rawPayload || {}) as Record<string, unknown>;
    const promisedDateStr = rawPayload.promisedDate as string | undefined;
    const promisedDate = promisedDateStr ? new Date(promisedDateStr) : new Date(Date.now() + 7 * 86400 * 1000);

    // Create PtP first (no link yet) so we have an id to embed in link notes
    const eventExists = await revenueEventExists(event.id);
    const ptp = await prisma.promiseToPay.create({
      data: {
        entityId: event.entityId,
        customerId: event.customerId,
        eventId: eventExists ? event.id : null,
        promisedAmount: event.amount,
        currency: event.currency,
        promisedDate,
        status: "pending",
        notes: (rawPayload.notes as string) || `Promise-to-pay commitment registered for ₹${event.amount} due by ${promisedDate.toISOString().split("T")[0]}.`,
      },
    });

    const link = await getOrCreatePaymentLink({
      entityId: event.entityId,
      eventId: event.id,
      promiseId: ptp.id,
      amount: event.amount,
      currency: event.currency,
      customer: { name: customer.name, email: customer.email, phone: customer.phone },
      description: `Promise-to-Pay for ${event.eventType} — ${event.entityId}`,
      notify: false,
      actionType: chosenAction,
    });

    // Persist link back to the PtP record
    await prisma.promiseToPay.update({
      where: { id: ptp.id },
      data: {
        razorpayPaymentLinkId: link.razorpayPaymentLinkId,
        paymentLinkUrl: link.paymentLinkUrl,
      },
    });

    const { subject, html } = buildPromiseConfirmationEmail({
      customerName: customer.name,
      amount: event.amount,
      promisedDate,
      paymentLinkUrl: link.paymentLinkUrl,
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
      integration: "PROMISE",
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      paymentLinkUrl: link.paymentLinkUrl,
      emailMessageId: emailMsgId,
      detail: `Promise-to-pay commitment registered for ₹${event.amount} due by ${formattedDate}. Payment link generated.`,
    };
  } else if (chosenAction === "escalate_to_human") {
    actionResult = await ticketMock.escalateToHuman(
      event.entityId,
      decision.reasoning,
    );
  } else if (chosenAction === "pause_subscription") {
    const rawPayload = (event.rawPayload || {}) as Record<string, unknown>;
    const subId =
      (rawPayload.subscription_id as string) ||
      (rawPayload.razorpay_subscription_id as string) ||
      event.entityId;

    actionResult = await razorpayIntegration.pauseSubscription(subId);
  } else {
    throw new DomainError(
      `Unrecognized action "${chosenAction}" — no integration mapping exists.`,
      "UNMAPPED_ACTION",
    );
  }

  const eventExistsCheck = await revenueEventExists(event.id);

  if (!eventExistsCheck) {
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
      paymentLinkUrl: actionResult.paymentLinkUrl ?? null,
      emailMessageId: actionResult.emailMessageId ?? null,
    },
    create: {
      eventId: event.id,
      actionType: actionResult.actionType,
      result: actionResult.result,
      integration: actionResult.integration,
      razorpayPaymentLinkId: actionResult.razorpayPaymentLinkId ?? null,
      paymentLinkUrl: actionResult.paymentLinkUrl ?? null,
      emailMessageId: actionResult.emailMessageId ?? null,
    },
  });

  return actionResult;
}
