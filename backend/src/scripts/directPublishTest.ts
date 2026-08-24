/**
 * Throwaway verification: publishes a raw event DIRECTLY onto
 * revenue.events.raw (bypassing the stream injector entirely) to prove the
 * pipeline has no dependency on the injector or on sourceRunId.
 */
import { kafka } from "../config/kafka";
import { prisma } from "../config/prisma";
import { TOPICS } from "../kafka/topics";

async function main() {
  const customer = await prisma.customer.findFirst({
    where: { invoices: { some: { status: "open" } } },
  });
  if (!customer) throw new Error("No eligible customer in DB");

  const id = crypto.randomUUID();
  const occurredAt = new Date();
  const event = {
    id,
    entityType: "INVOICE" as const,
    entityId: crypto.randomUUID(),
    customerId: customer.id,
    eventType: "PAYMENT_FAILED" as const,
    amount: 1234.5,
    currency: "INR",
    occurredAt: occurredAt.toISOString(),
    razorpayPaymentId: `pay_direct_${id.slice(0, 8)}`,
    razorpayOrderId: `order_direct_${id.slice(0, 8)}`,
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "card_expired",
    rawPayload: { event: "payment.failed", direct: true },
    // NOTE: no sourceRunId at all — real production events have none
  };

  await prisma.revenueEvent.create({
    data: {
      id,
      entityType: event.entityType,
      entityId: event.entityId,
      customerId: event.customerId,
      eventType: event.eventType,
      amount: event.amount,
      currency: event.currency,
      occurredAt,
      razorpayPaymentId: event.razorpayPaymentId,
      razorpayOrderId: event.razorpayOrderId,
      errorCode: event.errorCode,
      errorReason: event.errorReason,
      rawPayload: event.rawPayload as any,
    },
  });

  const producer = kafka.producer();
  await producer.connect();
  await producer.send({
    topic: TOPICS.EVENTS_RAW,
    messages: [{ key: event.id, value: JSON.stringify(event) }],
  });
  await producer.disconnect();
  console.log(`DIRECT_PUBLISH_OK eventId=${event.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
