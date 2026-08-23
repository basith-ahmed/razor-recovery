import { razorpay } from "../config/razorpay";
import { ActionResult, DomainError } from "../domain/types";

export interface RecoveryPaymentLinkParams {
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  description: string;
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
      actionType: "retry_payment",
      result: "success",
      integration: "RAZORPAY",
      detail: `Order ${order.id} is ready for a customer retry via Razorpay Checkout.`,
    };
  } catch (error: any) {
    if (orderId.startsWith("order_sim_") || orderId.startsWith("sim_")) {
      return {
        actionType: "retry_payment",
        result: "success",
        integration: "RAZORPAY",
        detail: `[SIMULATED] Order ${orderId} prepared for retry via Razorpay Checkout.`,
      };
    }
    console.error("Razorpay order retry preparation failed:", error);
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
    const paymentLink = await razorpay.paymentLink.create({
      amount: Math.round(params.amount * 100),
      currency: params.currency,
      description: params.description,
      customer: {
        name: params.customerName,
        email: params.customerEmail,
        ...(params.customerPhone ? { contact: params.customerPhone } : {}),
      },
      notify: { sms: true, email: true },
      reminder_enable: true,
    });

    return {
      actionType: "send_payment_link",
      result: "success",
      integration: "RAZORPAY",
      razorpayPaymentLinkId: paymentLink.id,
      paymentLinkShortUrl: paymentLink.short_url,
    };
  } catch (error: unknown) {
    console.error("Razorpay recovery payment-link creation failed:", error);
    throw new DomainError(
      "Unable to create Razorpay recovery payment link.",
      "RAZORPAY_PAYMENT_LINK_CREATION_FAILED",
      error,
    );
  }
}
