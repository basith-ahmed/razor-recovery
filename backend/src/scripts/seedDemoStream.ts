/**
 * Curated demo stream script.
 *
 * Not random: constructs an explicit sequence of ~8 events injected through
 * the live pipeline path (injectFailure → publish to revenue.events.raw) at
 * demo pacing. The events are plain production-shaped payloads — the pipeline
 * treats them exactly like real gateway traffic.
 *
 * Narrative beats covered:
 *  - 2 payment failures expected to recover via Razorpay retry
 *  - 1 checkout abandonment recovered via email
 *  - 1 DNC-skip
 *  - 1 dispute-escalation
 *  - 1 hard write-off (max attempts already exhausted)
 *
 * Simulated clock: select events carry crafted payload values (e.g. 35 days
 * overdue) so entities appear time-worn immediately without waiting.
 *
 * The backend must be running: its boot-started consumers process everything
 * published here in real time.
 *
 * Usage: npm run seedDemoStream
 */

import { prisma } from "../config/prisma";
import { connectProducer, disconnectProducer, publish } from "../kafka/producer";
import { TOPICS } from "../kafka/topics";
import { injectFailure } from "../simulator/injectFailure";
import { RawRevenueEvent } from "../domain/types";

const INTERVAL_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    `[seedDemoStream] ${event.eventType} → ${event.customerId} (${event.errorReason ?? "n/a"})`,
  );
}

async function main() {
  console.log("=== Curated Demo Stream ===");

  await connectProducer();

  // Beat 1 & 2: two payment failures on ordinary customers → Razorpay retry recovery
  for (let i = 0; i < 2; i++) {
    const customer = await pickCustomer({
      where: {
        dncFlag: false,
        invoices: { some: { status: "open", disputeFlag: false } },
      },
    });
    const event = await injectFailure("payment_failed", customer.id);
    await emit(await craftPayload(event, {}));
    await sleep(INTERVAL_MS);
  }

  // Beat 3: checkout abandonment → email recovery (47h since abandon = high urgency)
  const cartCustomer = await pickCustomer({
    where: { dncFlag: false, carts: { some: {} } },
  });
  const abandoned = await injectFailure("checkout_abandoned", cartCustomer.id);
  await emit(await craftPayload(abandoned, { hoursSinceAbandon: 1 }));
  await sleep(INTERVAL_MS);

  // Beat 4: invoice overdue with simulated clock — "already 35 days overdue"
  const overdueCustomer = await pickCustomer({
    where: {
      dncFlag: false,
      invoices: { some: { status: "open", disputeFlag: false } },
    },
  });
  const overdue = await injectFailure("invoice_overdue", overdueCustomer.id);
  await emit(await craftPayload(overdue, { daysOverdue: 35 }));
  await sleep(INTERVAL_MS);

  // Beat 5: DNC-skip — deliberately flagged customer produces zero actions
  const dncCustomer = await pickCustomer({
    where: { dncFlag: true },
  });
  const dncEvent = await injectFailure("payment_failed", dncCustomer.id).catch(
    async () => {
      // A DNC fixture may lack open invoices/carts; fall back to subscription or craft minimal event
      return injectFailure("checkout_abandoned", dncCustomer.id);
    },
  );
  await emit(dncEvent);
  await sleep(INTERVAL_MS);

  // Beat 6: dispute-escalation — disputed-invoice fixture freezes the workflow
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
  await sleep(INTERVAL_MS);

  // Beat 7: hard write-off — entity has already burned its per-cause attempt
  // budgets (see EntityCauseState / policy.json). injectFailure picks a random
  // Razorpay error reason, so EVERY cause a payment failure can diagnose as is
  // Beat 7: another payment failure
  const writeOffCustomer = await pickCustomer({
    where: {
      dncFlag: false,
      invoices: { some: { status: "open", disputeFlag: false } },
    },
  });
  const writeOff = await injectFailure("payment_failed", writeOffCustomer.id);
  await emit(writeOff);
  await sleep(INTERVAL_MS);

  // Beat 8: mandate_halted — UPI Autopay mandate cancelled/exhausted → mandate_requires_reauthorization
  // Expects subscription_status: "halted" in rawPayload, action: send_payment_link (no gateway retry)
  const mandateHaltedCustomer = await pickCustomer({
    where: { dncFlag: false, subscriptions: { some: { status: "active" } } },
  }).catch(() => null);
  if (mandateHaltedCustomer) {
    const mandateHalted = await injectFailure("mandate_halted", mandateHaltedCustomer.id);
    await emit(mandateHalted);
    await sleep(INTERVAL_MS);
  }

  // Beat 9: mandate_retryable_failure — transient bank error on active mandate → mandate_execution_failed_retryable
  // Expects subscription_status: "pending", action: retry_payment_delayed
  const mandateRetryCustomer = await pickCustomer({
    where: {
      dncFlag: false,
      subscriptions: { some: { status: "active" } },
      NOT: mandateHaltedCustomer ? { id: mandateHaltedCustomer.id } : undefined,
    },
  }).catch(() => null);
  if (mandateRetryCustomer) {
    const mandateRetry = await injectFailure("mandate_retryable_failure", mandateRetryCustomer.id);
    await emit(mandateRetry);
    await sleep(INTERVAL_MS);
  }

  console.log("Done — all beats published onto revenue.events.raw.");
  await disconnectProducer();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("seedDemoStream failed:", err);
  process.exit(1);
});
