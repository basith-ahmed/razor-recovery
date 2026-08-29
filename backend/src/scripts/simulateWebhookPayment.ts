/**
 * Script: simulateWebhookPayment.ts
 *
 * Simulates an incoming Razorpay webhook event (payment.captured) for an active/pending entity.
 * Generates the valid HMAC-SHA256 signature using RAZORPAY_WEBHOOK_SECRET and posts
 * directly to the running backend server's /webhooks/razorpay endpoint.
 *
 * Usage:
 *   npx tsx src/scripts/simulateWebhookPayment.ts [entityId]
 *   npm run test:webhook [entityId]
 */

import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";

async function main() {
  console.log("==================================================");
  console.log("   Razorpay Webhook Simulation Test");
  console.log("==================================================\n");

  const targetEntityId = process.argv[2];

  let event;
  if (targetEntityId) {
    console.log(`Looking up specified entity: ${targetEntityId}...`);
    event = await prisma.revenueEvent.findFirst({
      where: { entityId: targetEntityId },
      include: { customer: true, action: true },
      orderBy: { occurredAt: "desc" },
    });
    if (!event) {
      console.error(`❌ No revenue event found for entityId: ${targetEntityId}`);
      process.exit(1);
    }
  } else {
    console.log("Finding an unrecovered entity from the database...");
    // Find an entity not yet RECOVERED
    const activeWorkflow = await prisma.entityWorkflowState.findFirst({
      where: {
        state: { not: "RECOVERED" },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (activeWorkflow) {
      event = await prisma.revenueEvent.findFirst({
        where: { entityId: activeWorkflow.entityId },
        include: { customer: true, action: true },
        orderBy: { occurredAt: "desc" },
      });
    }

    if (!event) {
      // Fallback to any recent revenue event
      event = await prisma.revenueEvent.findFirst({
        include: { customer: true, action: true },
        orderBy: { occurredAt: "desc" },
      });
    }
  }

  if (!event) {
    console.error("❌ No revenue events found in database. Seed or inject demo events first.");
    process.exit(1);
  }

  const entityId = event.entityId;
  const customer = event.customer;
  const paymentId = event.razorpayPaymentId || `pay_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const orderId = event.razorpayOrderId || `order_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const paymentLinkId = event.action?.razorpayPaymentLinkId || undefined;

  console.log("🎯 Target Entity Selected:");
  console.log(`   - Entity ID:      ${entityId}`);
  console.log(`   - Customer:       ${customer.name} (${customer.email})`);
  console.log(`   - Event Type:     ${event.eventType}`);
  console.log(`   - Amount:         ₹${event.amount} ${event.currency}`);
  console.log(`   - Payment ID:     ${paymentId}`);
  console.log(`   - Order ID:       ${orderId}`);
  if (paymentLinkId) console.log(`   - Payment Link ID: ${paymentLinkId}`);

  // Fetch current state before webhook
  const stateBefore = await prisma.entityWorkflowState.findUnique({
    where: { entityId },
  });
  console.log(`\n📊 State Before Webhook: ${stateBefore?.state || "UNKNOWN"}`);

  // Build authentic Razorpay webhook payload
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
          amount: Math.round(event.amount * 100), // Razorpay amount in paise
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

  // Compute HMAC SHA256 Signature
  const signature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const webhookUrl = `http://localhost:${env.PORT}/webhooks/razorpay`;
  console.log(`\n🚀 Sending ${payload.event} webhook to ${webhookUrl}...`);
  console.log(`   X-Razorpay-Signature: ${signature.slice(0, 16)}...`);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": signature,
      },
      body: rawBody,
    });

    const data = await res.json();
    console.log(`\n📥 Webhook Response: HTTP ${res.status}`, data);

    if (res.status !== 200) {
      console.error("❌ Webhook failed with status:", res.status);
      process.exit(1);
    }

    // Wait a brief moment for async database transactions to finish
    await new Promise((r) => setTimeout(r, 500));

    // Verify State & Audit Entries After Webhook
    const stateAfter = await prisma.entityWorkflowState.findUnique({
      where: { entityId },
    });
    const latestAudit = await prisma.auditEntry.findFirst({
      where: { entityId },
      orderBy: { sequenceNumber: "desc" },
    });
    const latestLedger = await prisma.ledgerEntry.findFirst({
      where: { entityId, type: "RECOVERED" },
      orderBy: { createdAt: "desc" },
    });

    console.log("\n==================================================");
    console.log("   Verification Results:");
    console.log("==================================================");
    console.log(`   - Entity State:     ${stateAfter?.state === "RECOVERED" ? "✅ RECOVERED" : "❌ " + stateAfter?.state}`);
    console.log(`   - Latest Audit:     ${latestAudit?.outcome === "recovered" ? `✅ ${latestAudit.actor} → ${latestAudit.outcome}` : "❌ " + latestAudit?.outcome}`);
    console.log(`   - Ledger Entry:     ${latestLedger ? `✅ RECOVERED ₹${latestLedger.amount} (${latestLedger.referenceId})` : "❌ None logged"}`);
    console.log("\n🎉 Webhook simulation completed successfully!");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Failed to connect to backend server at ${webhookUrl}.`);
    console.error("   Ensure the backend is running (`npm run dev` in backend/).");
    console.error("   Error detail:", msg);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
