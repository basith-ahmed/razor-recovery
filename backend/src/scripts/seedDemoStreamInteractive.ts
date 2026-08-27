/**
 * Curated demo stream script (Interactive Version).
 *
 * Usage: npm run seedDemoStreamInteractive
 */

import { prisma } from "../config/prisma";
import { connectProducer, disconnectProducer, publish } from "../kafka/producer";
import { TOPICS } from "../kafka/topics";
import { injectFailure } from "../simulator/injectFailure";
import { RawRevenueEvent } from "../domain/types";
import * as readline from "readline";

function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("\nPress [Enter] to send the next event...", () => {
      rl.close();
      resolve();
    });
  });
}

async function pickCustomer(where: Parameters<typeof prisma.customer.findFirst>[0]) {
  const customer = await prisma.customer.findFirst({ ...where });
  if (!customer)
    throw new Error(`No customer matching fixture criteria: ${JSON.stringify(where)}`);
  return customer;
}

/** Override fields inside the rawPayload to simulate elapsed time. */
function craftPayload(event: RawRevenueEvent, patch: Record<string, unknown>): RawRevenueEvent {
  return {
    ...event,
    rawPayload: { ...(event.rawPayload as Record<string, unknown>), ...patch },
  };
}

async function emit(event: RawRevenueEvent) {
  await publish(TOPICS.EVENTS_RAW, event.id, event);
  console.log(
    `[seedDemoStreamInteractive] ${event.eventType} → ${event.customerId} (${event.errorReason ?? "n/a"})`,
  );
}

async function main() {
  console.log("=== Curated Demo Stream (Interactive) ===");

  await connectProducer();

  // Beat 1: Payment failure -> Razorpay retry
  await waitForEnter();
  const customer1 = await pickCustomer({
    where: {
      dncFlag: false,
      invoices: { some: { status: "open", disputeFlag: false } },
    },
  });
  const event1 = await injectFailure("payment_failed", customer1.id);
  await emit(await craftPayload(event1, {}));

  // Beat 2: Payment failure -> Razorpay retry
  await waitForEnter();
  const customer2 = await pickCustomer({
    where: {
      dncFlag: false,
      invoices: { some: { status: "open", disputeFlag: false } },
    },
  });
  const event2 = await injectFailure("payment_failed", customer2.id);
  await emit(await craftPayload(event2, {}));

  // Beat 3: checkout abandonment → email recovery
  await waitForEnter();
  const cartCustomer = await pickCustomer({
    where: { dncFlag: false, carts: { some: {} } },
  });
  const abandoned = await injectFailure("checkout_abandoned", cartCustomer.id);
  await emit(await craftPayload(abandoned, { hoursSinceAbandon: 1 }));

  // Beat 4: invoice overdue with simulated clock
  await waitForEnter();
  const overdueCustomer = await pickCustomer({
    where: {
      dncFlag: false,
      invoices: { some: { status: "open", disputeFlag: false } },
    },
  });
  const overdue = await injectFailure("invoice_overdue", overdueCustomer.id);
  await emit(await craftPayload(overdue, { daysOverdue: 35 }));

  // Beat 5: DNC-skip
  await waitForEnter();
  const dncCustomer = await pickCustomer({
    where: { dncFlag: true },
  });
  const dncEvent = await injectFailure("payment_failed", dncCustomer.id).catch(
    async () => {
      return injectFailure("checkout_abandoned", dncCustomer.id);
    },
  );
  await emit(dncEvent);

  // Beat 6: dispute-escalation
  await waitForEnter();
  const disputedInvoice = await prisma.invoice.findFirst({
    where: { disputeFlag: true, status: "open" },
    include: { customer: true },
  });
  if (!disputedInvoice) throw new Error("No disputed-invoice fixture found.");
  const disputeEvent = await injectFailure(
    "payment_failed",
    disputedInvoice.customerId,
  );
  await emit(disputeEvent);

  // Beat 7: another payment failure
  await waitForEnter();
  const writeOffCustomer = await pickCustomer({
    where: {
      dncFlag: false,
      invoices: { some: { status: "open", disputeFlag: false } },
    },
  });
  const writeOff = await injectFailure("payment_failed", writeOffCustomer.id);
  await emit(writeOff);

  console.log("\nDone — all beats published onto revenue.events.raw.");
  await disconnectProducer();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("seedDemoStreamInteractive failed:", err);
  process.exit(1);
});
