/**
 * Script: simulateWebhookPayment.ts
 *
 * Simulates an incoming Razorpay webhook (payment.captured / payment_link.paid)
 * for an entity: builds the authentic payload, signs it with
 * RAZORPAY_WEBHOOK_SECRET, and posts it to the running backend's
 * /webhooks/razorpay endpoint — the same wire path a real gateway would use.
 *
 * Usage:
 *   npx tsx src/scripts/simulateWebhookPayment.ts [entityId]
 *   npm run test:webhook [entityId]
 */

import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";

export interface WebhookSimulationResult {
  ok: boolean;
  entityId: string;
  eventName: string;
  stateBefore: string | null;
  stateAfter: string | null;
  latestAuditOutcome: string | null;
  ledgerReferenceId: string | null;
  httpStatus: number;
}

/**
 * Signs and posts a realistic payment webhook for the given entity's latest
 * event, then verifies the resulting workflow state, audit outcome, and
 * ledger entry.
 */
export async function simulatePaymentForEntity(entityId: string): Promise<WebhookSimulationResult> {
  const event = await prisma.revenueEvent.findFirst({
    where: { entityId },
    include: { customer: true, action: true },
    orderBy: { occurredAt: "desc" },
  });
  if (!event) {
    throw new Error(`No revenue event found for entityId: ${entityId}`);
  }

  const customer = event.customer;
  const paymentId = event.razorpayPaymentId || `pay_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const orderId = event.razorpayOrderId || `order_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const paymentLinkId = event.action?.razorpayPaymentLinkId || undefined;

  const stateBefore = (await prisma.entityWorkflowState.findUnique({
    where: { entityId },
  }))?.state ?? null;

  const payload = {
    entity: "event",
    account_id: "acc_sim_razorrecovery",
    event: paymentLinkId ? "payment_link.paid" : "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: paymentId,
          entity: "payment",
          amount: Math.round(event.amount * 100),
          currency: event.currency || "INR",
          status: "captured",
          order_id: orderId,
          invoice_id: null,
          payment_link_id: paymentLinkId,
          email: customer.email,
          contact: customer.phone || "+919876543210",
          notes: {
            entity_id: entityId,
            customer_id: customer.id,
            simulator: "razorrecovery",
          },
          created_at: Math.floor(Date.now() / 1000),
        },
      },
      ...(paymentLinkId
        ? {
            payment_link: {
              entity: {
                id: paymentLinkId,
                status: "paid",
                amount: Math.round(event.amount * 100),
                currency: event.currency || "INR",
              },
            },
          }
        : {}),
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const webhookUrl = `http://localhost:${env.PORT}/webhooks/razorpay`;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Razorpay-Signature": signature,
    },
    body: rawBody,
  });
  await res.json().catch(() => null);

  if (res.status !== 200) {
    return {
      ok: false,
      entityId,
      eventName: payload.event,
      stateBefore,
      stateAfter: stateBefore,
      latestAuditOutcome: null,
      ledgerReferenceId: null,
      httpStatus: res.status,
    };
  }

  // Allow the async recovery transaction (audit + ledger + websocket) to land.
  await new Promise((r) => setTimeout(r, 500));

  const stateAfter = (await prisma.entityWorkflowState.findUnique({
    where: { entityId },
  }))?.state ?? null;
  const latestAudit = await prisma.auditEntry.findFirst({
    where: { entityId },
    orderBy: { sequenceNumber: "desc" },
  });
  const latestLedger = await prisma.ledgerEntry.findFirst({
    where: { entityId, type: "RECOVERED" },
    orderBy: { createdAt: "desc" },
  });

  return {
    ok: stateAfter === "RECOVERED",
    entityId,
    eventName: payload.event,
    stateBefore,
    stateAfter,
    latestAuditOutcome: latestAudit?.outcome ?? null,
    ledgerReferenceId: latestLedger?.referenceId ?? null,
    httpStatus: res.status,
  };
}

async function main(): Promise<void> {
  console.log("==================================================");
  console.log("   Razorpay Webhook Simulation");
  console.log("==================================================\n");

  const targetEntityId = process.argv[2];
  let entityId: string | undefined = targetEntityId;

  if (!entityId) {
    console.log("Finding an unrecovered entity from the database...");
    const activeWorkflow = await prisma.entityWorkflowState.findFirst({
      where: { state: { not: "RECOVERED" } },
      orderBy: { updatedAt: "desc" },
    });
    entityId = activeWorkflow?.entityId ?? undefined;
    if (!entityId) {
      const anyEvent = await prisma.revenueEvent.findFirst({ orderBy: { occurredAt: "desc" } });
      entityId = anyEvent?.entityId;
    }
    if (!entityId) {
      console.error("❌ No revenue events found in database. Run the demo stream first.");
      process.exit(1);
    }
    console.log(`Auto-selected entity: ${entityId}`);
  }

  try {
    const result = await simulatePaymentForEntity(entityId);
    console.log(`\n🚀 Sent ${result.eventName} webhook (HTTP ${result.httpStatus}).`);
    console.log(`   - State:  ${result.stateBefore ?? "?"} → ${result.stateAfter ?? "?"}`);
    console.log(`   - Audit:  ${result.latestAuditOutcome ?? "none"}`);
    console.log(
      result.ok
        ? `\n✅ Entity ${result.entityId} is RECOVERED (ledger ref: ${result.ledgerReferenceId ?? "n/a"}).`
        : `\n❌ Webhook simulation failed for ${result.entityId}.`
    );
    if (!result.ok) process.exit(1);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Payment simulation failed: ${msg}`);
    console.error("   Ensure the backend is running (`npm run dev` in backend/).");
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = process.argv[1]?.includes("simulateWebhookPayment");
if (invokedDirectly) {
  main();
}
