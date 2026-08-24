import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { injectFailure, SyntheticFailureType } from "./injectFailure";
import { seedEntities } from "./seedEntities";
import { connectProducer, publish } from "../kafka/producer";
import { TOPICS } from "../kafka/topics";
import { emitStreamProgress } from "../api/websocket";

export interface StreamInjectionConfig {
  count: number;
  mix: {
    paymentFailed: number;
    checkoutAbandoned: number;
    invoiceOverdue: number;
    subscriptionFailed: number;
  };
  /** Delay between events; keeps the live feed visibly streaming. */
  intervalMs?: number;
}

const MIX_TYPES: Array<
  [keyof StreamInjectionConfig["mix"], SyntheticFailureType]
> = [
  ["paymentFailed", "payment_failed"],
  ["checkoutAbandoned", "checkout_abandoned"],
  ["invoiceOverdue", "invoice_overdue"],
  ["subscriptionFailed", "subscription_failed"],
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eventPlan(config: StreamInjectionConfig): SyntheticFailureType[] {
  if (!Number.isInteger(config.count) || config.count < 1)
    throw new Error("Count must be a positive integer.");
  const total = Object.values(config.mix).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (
    Object.values(config.mix).some((value) => value < 0) ||
    Math.abs(total - 1) > 0.000001
  ) {
    throw new Error("Mix proportions must be non-negative and sum to 1.");
  }
  const allocations = MIX_TYPES.map(([key, type]) => ({
    type,
    raw: config.mix[key] * config.count,
  }));
  const planned = allocations.flatMap(
    ({ type, raw }) =>
      Array(Math.floor(raw)).fill(type) as SyntheticFailureType[],
  );
  const remaining = config.count - planned.length;
  allocations
    .sort((a, b) => (b.raw % 1) - (a.raw % 1))
    .slice(0, remaining)
    .forEach(({ type }) => planned.push(type));
  return planned.sort(() => Math.random() - 0.5);
}

/**
 * Demo tooling that plays the role a real payment gateway / checkout service /
 * invoicing system would play in production — not part of the core pipeline.
 * Publishes a paced sequence of synthetic events onto revenue.events.raw.
 */
export async function startStreamInjection(
  config: StreamInjectionConfig,
): Promise<{ runId: string }> {
  const plannedEvents = eventPlan(config);
  const intervalMs = config.intervalMs ?? randomInteger(300, 800);

  if ((await prisma.customer.count()) === 0)
    await seedEntities({ customers: Math.max(50, config.count) });

  // Ensure the shared producer is connected before publishing
  await connectProducer();

  const runId = crypto.randomUUID();
  const total = plannedEvents.length;
  await redis.hset(`razorrecovery:stream:${runId}:progress`, {
    sent: 0,
    total,
  });

  void (async () => {
    let sent = 0;
    try {
      for (const type of plannedEvents) {
        await sleep(intervalMs);
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
          eligibleCustomers[
            Math.floor(Math.random() * eligibleCustomers.length)
          ];
        const event = await injectFailure(type, customer.id, runId);

        await publish(TOPICS.EVENTS_RAW, event.id, event);
        sent += 1;
        await redis.hset(`razorrecovery:stream:${runId}:progress`, {
          sent,
          total,
        });
        emitStreamProgress(runId, sent, total);
      }
    } catch (err) {
      console.error(
        `[streamInjector] Stream injection ${runId} failed after ${sent}/${total} events:`,
        err,
      );
    }
  })();

  return { runId };
}

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
