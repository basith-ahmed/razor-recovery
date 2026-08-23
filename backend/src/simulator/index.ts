import { prisma } from "../config/prisma";
import { injectFailure, SyntheticFailureType } from "./injectFailure";
import { seedEntities } from "./seedEntities";
import { connectProducer, publish } from "../kafka/producer";
import { TOPICS } from "../kafka/topics";

export interface ReplayBatchConfig {
  size: number;
  mix: {
    paymentFailed: number;
    checkoutAbandoned: number;
    invoiceOverdue: number;
    subscriptionFailed: number;
  };
}

const MIX_TYPES: Array<[keyof ReplayBatchConfig["mix"], SyntheticFailureType]> =
  [
    ["paymentFailed", "payment_failed"],
    ["checkoutAbandoned", "checkout_abandoned"],
    ["invoiceOverdue", "invoice_overdue"],
    ["subscriptionFailed", "subscription_failed"],
  ];

function eventPlan(config: ReplayBatchConfig): SyntheticFailureType[] {
  if (!Number.isInteger(config.size) || config.size < 1)
    throw new Error("Batch size must be a positive integer.");
  const total = Object.values(config.mix).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (
    Object.values(config.mix).some((value) => value < 0) ||
    Math.abs(total - 1) > 0.000001
  ) {
    throw new Error("Batch mix proportions must be non-negative and sum to 1.");
  }
  const allocations = MIX_TYPES.map(([key, type]) => ({
    type,
    raw: config.mix[key] * config.size,
  }));
  const planned = allocations.flatMap(
    ({ type, raw }) =>
      Array(Math.floor(raw)).fill(type) as SyntheticFailureType[],
  );
  const remaining = config.size - planned.length;
  allocations
    .sort((a, b) => (b.raw % 1) - (a.raw % 1))
    .slice(0, remaining)
    .forEach(({ type }) => planned.push(type));
  return planned.sort(() => Math.random() - 0.5);
}

export async function replayBatch(
  config: ReplayBatchConfig,
): Promise<{ batchId: string }> {
  const plannedEvents = eventPlan(config);
  if ((await prisma.customer.count()) === 0)
    await seedEntities({ customers: Math.max(50, config.size) });

  // Ensure the shared producer is connected before publishing
  await connectProducer();

  const batch = await prisma.batch.create({
    data: { eventCount: config.size, amountAtRisk: 0 },
  });
  let amountAtRisk = 0;

  for (const type of plannedEvents) {
    const eligibleCustomers = await prisma.customer.findMany({
      where:
        type === "subscription_failed"
          ? { subscriptions: { some: { status: "active" } } }
          : type === "checkout_abandoned"
            ? { carts: { some: {} } }
            : type === "invoice_overdue"
              ? { invoices: { some: { status: "open" } } }
              : {
                  OR: [
                    { invoices: { some: { status: "open" } } },
                    { carts: { some: {} } },
                  ],
                },
      select: { id: true },
    });
    if (eligibleCustomers.length === 0)
      throw new Error(`No eligible customer is available for ${type}.`);
    const customer =
      eligibleCustomers[Math.floor(Math.random() * eligibleCustomers.length)];
    const event = await injectFailure(batch.id, type, customer.id);
    amountAtRisk += event.amount;

    // Publish to Kafka for the pipeline consumers to pick up
    await publish(TOPICS.EVENTS_RAW, event.id, event);
  }
  await prisma.batch.update({
    where: { id: batch.id },
    data: {
      amountAtRisk: Number(amountAtRisk.toFixed(2)),
      status: "completed",
    },
  });
  return { batchId: batch.id };
}
