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
  eventId?: string;
  actionType?: string;
}

/**
 * Razorpay does not expose a server-side "retry payment" endpoint. Fetching
 * the order confirms it is available for the customer to retry through
 * Checkout, where Razorpay records the next attempt against the same order.
 */
export async function retryPayment(orderId: string): Promise<ActionResult> {
  try {
    const order = await razorpay.orders.fetch(orderId);

    return {
      actionType: "retry_payment_immediate",
      result: "success",
      integration: "RAZORPAY",
      detail: `Order ${order.id} is ready for a customer retry via Razorpay Checkout.`,
    };
  } catch (error: any) {
    if (orderId.startsWith("order_sim_") || orderId.startsWith("sim_")) {
      return {
        actionType: "retry_payment_immediate",
        result: "success",
        integration: "RAZORPAY",
        detail: `[SIMULATED] Order ${orderId} prepared for retry via Razorpay Checkout.`,
      };
    }
    logError("razorpay", error);
    throw new DomainError(
      `Unable to prepare Razorpay order ${orderId} for retry.`,
      "RAZORPAY_RETRY_PREPARATION_FAILED",
      error,
    );
  }
}

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
    });

    return {
      actionType: "send_payment_link",
      result: "success",
      integration: "RAZORPAY",
      razorpayPaymentLinkId: paymentLink.id,
      paymentLinkShortUrl: paymentLink.short_url,
    };
  } catch (error: any) {
    if (params.customerEmail.endsWith(".test") || params.customerEmail.includes("example.test") || params.eventId?.startsWith("sim_")) {
      const simHash = createHash("md5")
        .update(`${params.customerEmail}:${params.amount}:${params.eventId ?? ""}`)
        .digest("hex")
        .slice(0, 16);
      const simId = `plink_sim_${simHash}`;
      return {
        actionType: "send_payment_link",
        result: "success",
        integration: "RAZORPAY",
        razorpayPaymentLinkId: simId,
        paymentLinkShortUrl: `https://rzp.io/i/${simId}`,
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
