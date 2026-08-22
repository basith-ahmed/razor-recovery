import { EntityType, EventType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { RawRevenueEvent } from "../domain/types";
import { randomRazorpayErrorReason } from "./razorpayErrorReasons";

export type SyntheticFailureType =
  | "payment_failed"
  | "checkout_abandoned"
  | "invoice_overdue"
  | "subscription_failed";

export class SimulatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulatorError";
  }
}

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function toRawEvent(event: {
  id: string;
  batchId: string;
  entityType: EntityType;
  entityId: string;
  customerId: string;
  eventType: EventType;
  amount: number;
  currency: string;
  occurredAt: Date;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  errorCode: string | null;
  errorReason: string | null;
  rawPayload: Prisma.JsonValue;
}): RawRevenueEvent {
  return {
    ...event,
    occurredAt: event.occurredAt.toISOString(),
    razorpayPaymentId: event.razorpayPaymentId ?? undefined,
    razorpayOrderId: event.razorpayOrderId ?? undefined,
    errorCode: event.errorCode ?? undefined,
    errorReason: event.errorReason ?? undefined,
    rawPayload: event.rawPayload as Record<string, unknown>,
  };
}

/** Persists one offline, webhook-shaped revenue event. It never calls Razorpay. */
export async function injectFailure(
  batchId: string,
  type: SyntheticFailureType,
  customerId: string,
): Promise<RawRevenueEvent> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });
  if (!customer)
    throw new SimulatorError(`Customer ${customerId} does not exist.`);

  const id = crypto.randomUUID();
  const occurredAt = new Date();
  let entityType: EntityType;
  let entityId: string;
  let amount: number;
  let eventType: EventType;
  let payload: Record<string, unknown>;
  let razorpayPaymentId: string | undefined;
  let razorpayOrderId: string | undefined;
  let errorCode: string | undefined;
  let errorReason: string | undefined;

  if (type === "payment_failed") {
    const [invoice, cart] = await Promise.all([
      prisma.invoice.findFirst({
        where: { customerId, status: "open" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.cart.findFirst({
        where: { customerId },
        orderBy: { abandonedAt: "desc" },
      }),
    ]);
    const source = Math.random() < 0.5 ? (invoice ?? cart) : (cart ?? invoice);
    if (!source)
      throw new SimulatorError(
        `Customer ${customerId} has no open invoice or cart for a payment failure.`,
      );
    const reason = randomRazorpayErrorReason();
    entityType = "dueDate" in source ? "INVOICE" : "CART";
    entityId = source.id;
    amount = source.amount;
    eventType = "PAYMENT_FAILED";
    razorpayPaymentId = `pay_sim_${crypto.randomUUID().replace(/-/g, "")}`;
    razorpayOrderId = `order_sim_${crypto.randomUUID().replace(/-/g, "")}`;
    errorCode = reason.errorCode;
    errorReason = reason.errorReason;
    const payment = {
      id: razorpayPaymentId,
      entity: "payment",
      amount: Math.round(amount * 100),
      currency: "INR",
      status: "failed",
      order_id: razorpayOrderId,
      invoice_id: entityType === "INVOICE" ? `inv_sim_${entityId}` : null,
      method: "card",
      amount_refunded: 0,
      captured: false,
      email: customer.email,
      contact: customer.phone,
      notes: {
        simulator: "razorrecovery",
        customer_id: customerId,
        entity_id: entityId,
      },
      fee: null,
      tax: null,
      error_code: reason.errorCode,
      error_description: reason.errorDescription,
      error_source: reason.errorSource,
      error_step: reason.errorStep,
      error_reason: reason.errorReason,
      created_at: Math.floor(occurredAt.getTime() / 1000),
    };
    payload = {
      entity: "event",
      account_id: "acc_sim_razorrecovery",
      event: "payment.failed",
      contains: ["payment"],
      payload: { payment },
      created_at: payment.created_at,
    };
  } else if (type === "checkout_abandoned") {
    const cart = await prisma.cart.findFirst({
      where: { customerId },
      orderBy: { abandonedAt: "desc" },
    });
    if (!cart)
      throw new SimulatorError(
        `Customer ${customerId} has no cart to abandon.`,
      );
    entityType = "CART";
    entityId = cart.id;
    amount = cart.amount;
    eventType = "CHECKOUT_ABANDONED";
    payload = {
      simulator: true,
      event: "checkout.abandoned",
      cart_id: cart.id,
      hoursSinceAbandon: randomInteger(1, 96),
      abandoned_at: cart.abandonedAt.toISOString(),
    };
  } else if (type === "invoice_overdue") {
    const invoice = await prisma.invoice.findFirst({
      where: { customerId, status: "open" },
      orderBy: { dueDate: "asc" },
    });
    if (!invoice)
      throw new SimulatorError(`Customer ${customerId} has no open invoice.`);
    entityType = "INVOICE";
    entityId = invoice.id;
    amount = invoice.amount;
    eventType = "INVOICE_OVERDUE";
    payload = {
      simulator: true,
      event: "invoice.overdue",
      invoice_id: invoice.id,
      daysOverdue: randomInteger(1, 60),
      due_date: invoice.dueDate.toISOString(),
      dispute_flag: invoice.disputeFlag,
    };
  } else {
    const subscription = await prisma.subscription.findFirst({
      where: { customerId, status: "active" },
      orderBy: { nextBillDate: "asc" },
    });
    if (!subscription)
      throw new SimulatorError(
        `Customer ${customerId} has no active subscription.`,
      );
    entityType = "SUBSCRIPTION";
    entityId = subscription.id;
    amount = subscription.mrr;
    eventType = "SUBSCRIPTION_FAILED";
    payload = {
      simulator: true,
      event: "subscription.payment_failed",
      subscription_id: subscription.id,
      razorpay_subscription_id: subscription.razorpaySubscriptionId,
      next_bill_date: subscription.nextBillDate.toISOString(),
    };
  }

  const saved = await prisma.revenueEvent.create({
    data: {
      id,
      batchId,
      entityType,
      entityId,
      customerId,
      eventType,
      amount,
      currency: "INR",
      occurredAt,
      razorpayPaymentId,
      razorpayOrderId,
      errorCode,
      errorReason,
      rawPayload: payload as Prisma.InputJsonValue,
    },
  });
  return toRawEvent(saved);
}
