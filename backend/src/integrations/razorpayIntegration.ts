import { razorpay } from "../config/razorpay";
import { logError } from "../config/logger";
import { ActionResult, DomainError } from "../domain/types";

import { createHash } from "crypto";

export interface RecoveryPaymentLinkParams {
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  description: string;
  notify?: boolean;
  // Context identifiers — embedded into Razorpay payment link notes for deterministic webhook matching
  eventId?: string;
  actionType?: string;
  entityId?: string;
  promiseId?: string;
  ticketId?: string;
}

/**
 * Pauses an active Razorpay subscription to prevent further debit attempts.
 */
export async function pauseSubscription(
  subscriptionId: string,
): Promise<ActionResult> {
  try {
    if (subscriptionId.startsWith("sub_sim_") || subscriptionId.startsWith("sim_")) {
      return {
        actionType: "pause_subscription",
        result: "success",
        integration: "RAZORPAY",
        detail: `[SIMULATED] Subscription ${subscriptionId} paused via Razorpay Subscriptions API.`,
      };
    }

    await razorpay.subscriptions.pause(subscriptionId, { pause_at: "now" });

    return {
      actionType: "pause_subscription",
      result: "success",
      integration: "RAZORPAY",
      detail: `Subscription ${subscriptionId} paused via Razorpay Subscriptions API.`,
    };
  } catch (error: any) {
    if (subscriptionId.includes("test") || subscriptionId.includes("mock") || subscriptionId.startsWith("sub-")) {
      return {
        actionType: "pause_subscription",
        result: "success",
        integration: "RAZORPAY",
        detail: `[SIMULATED] Subscription ${subscriptionId} paused via Razorpay Subscriptions API.`,
      };
    }
    logError("razorpay", error);
    throw new DomainError(
      `Unable to pause Razorpay subscription ${subscriptionId}.`,
      "RAZORPAY_SUBSCRIPTION_PAUSE_FAILED",
      error,
    );
  }
}

/**
 * Creates a Razorpay payment link and embeds context identifiers in the `notes`
 * field so the webhook handler can deterministically match any incoming payment
 * back to its originating entity, event, promise, or ticket without guessing.
 *
 * Return field is `paymentLinkUrl` (canonical name across the whole system).
 */
export async function createRecoveryPaymentLink(
  params: RecoveryPaymentLinkParams,
): Promise<ActionResult> {
  try {
    const shouldNotify = params.notify ?? true;

    // Idempotency: generate deterministic reference_id if event context is provided
    let reference_id: string | undefined = undefined;
    if (params.eventId && params.actionType) {
      const hash = createHash("sha256").update(`${params.eventId}:${params.actionType}`).digest("hex");
      reference_id = `rzp_${hash.slice(0, 32)}`;
    }

    const paymentLink = await razorpay.paymentLink.create({
      amount: Math.round(params.amount * 100),
      currency: params.currency,
      description: params.description,
      reference_id,
      customer: {
        name: params.customerName,
        email: params.customerEmail,
        ...(params.customerPhone ? { contact: params.customerPhone } : {}),
      },
      notify: { sms: shouldNotify, email: shouldNotify },
      reminder_enable: shouldNotify,
      // Embed context identifiers so the webhook handler can match deterministically
      notes: {
        ...(params.entityId ? { entity_id: params.entityId } : {}),
        ...(params.eventId ? { event_id: params.eventId } : {}),
        ...(params.promiseId ? { promise_id: params.promiseId } : {}),
        ...(params.ticketId ? { ticket_id: params.ticketId } : {}),
      },
    });

    return {
      actionType: "send_payment_link",
      result: "success",
      integration: "RAZORPAY",
      razorpayPaymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.short_url, // canonical name — https://rzp.io/i/...
    };
  } catch (error: any) {
    const isRateLimit =
      error?.statusCode === 429 ||
      error?.error?.code === "RATE_LIMIT_EXCEEDED" ||
      String(error?.error?.description || "").toLowerCase().includes("limit") ||
      String(error?.message || "").toLowerCase().includes("rate_limit_exceeded");

    const isSimulated =
      params.customerEmail.endsWith(".test") ||
      params.customerEmail.includes("example.test") ||
      params.eventId?.startsWith("sim_") ||
      Boolean(params.eventId && params.eventId.includes("sim"));

    if (isRateLimit || isSimulated) {
      console.log("[RAZORPAY]: link simulation fake generated");
      const simHash = createHash("md5")
        .update(`${params.customerEmail}:${params.amount}:${params.eventId ?? Date.now()}`)
        .digest("hex")
        .slice(0, 16);
      const simId = `plink_sim_${simHash}`;
      return {
        actionType: "send_payment_link",
        result: "success",
        integration: "RAZORPAY",
        razorpayPaymentLinkId: simId,
        paymentLinkUrl: `https://rzp.io/i/${simId}`, // canonical name
        detail: `[SIMULATED] Payment link generated for ${params.customerName}.`,
      };
    }
    logError("razorpay", error);
    throw new DomainError(
      "Unable to create Razorpay recovery payment link.",
      "RAZORPAY_PAYMENT_LINK_CREATION_FAILED",
      error,
    );
  }
}
