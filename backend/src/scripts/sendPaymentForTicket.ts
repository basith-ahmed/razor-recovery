/**
 * Script: sendPaymentForTicket.ts
 *
 * Sends a simulated Razorpay payment captured webhook event for a specific Escalation Ticket ID.
 * Recovers the ticket, updates the entity workflow state to RECOVERED, logs a financial ledger
 * recovery entry, updates audit logs, and emits live WebSocket notifications.
 *
 * Usage:
 *   npx tsx src/scripts/sendPaymentForTicket.ts <ticketId>
 *   npm run pay:ticket <ticketId>
 */

import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { processRazorpayPaymentWebhook } from "../services/webhookService";

async function main() {
  console.log("==================================================");
  console.log("   RazorRecovery: Send Payment Event for Ticket   ");
  console.log("==================================================\n");

  const inputId = process.argv[2]?.trim();

  let ticket;

  if (inputId) {
    console.log(`🔍 Looking up ticket by ID / prefix: "${inputId}"...`);
    ticket = await prisma.ticket.findFirst({
      where: {
        OR: [
          { id: inputId },
          { id: { startsWith: inputId } },
          { entityId: inputId },
          { entityId: { startsWith: inputId } },
        ],
      },
      include: {
        notes: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!ticket) {
      console.error(`❌ No ticket found matching ID or Entity ID "${inputId}".\n`);
      const recentTickets = await prisma.ticket.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
      });
      if (recentTickets.length > 0) {
        console.log("📋 Available Tickets in Database:");
        for (const t of recentTickets) {
          console.log(`   - ID: ${t.id} | Status: ${t.status} | Entity: ${t.entityId}`);
        }
      }
      process.exit(1);
    }
  } else {
    console.log("⚠️ No ticketId argument provided. Looking for the latest active ticket...");
    ticket = await prisma.ticket.findFirst({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      include: {
        notes: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!ticket) {
      ticket = await prisma.ticket.findFirst({
        orderBy: { createdAt: "desc" },
        include: {
          notes: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
    }

    if (!ticket) {
      console.error("❌ No tickets exist in the database. Please create or escalate a ticket first.");
      process.exit(1);
    }

    console.log(`ℹ️ Selected latest ticket: ${ticket.id} (status: ${ticket.status})`);
  }

  // Retrieve associated revenue event and customer
  const event = await prisma.revenueEvent.findFirst({
    where: { entityId: ticket.entityId },
    include: { customer: true, action: true },
    orderBy: { occurredAt: "desc" },
  });

  const workflowState = await prisma.entityWorkflowState.findUnique({
    where: { entityId: ticket.entityId },
  });

  const customer = event?.customer || (await prisma.customer.findFirst());
  const amount = event?.amount ?? 5000.0;
  const currency = event?.currency ?? "INR";
  const paymentId = `pay_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const orderId = event?.razorpayOrderId ?? `order_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const paymentLinkId = event?.action?.razorpayPaymentLinkId ?? undefined;

  console.log("\n🎯 Target Ticket & Entity Details:");
  console.log(`   - Ticket ID:      ${ticket.id}`);
  console.log(`   - Ticket Status:  ${ticket.status}`);
  console.log(`   - Entity ID:      ${ticket.entityId}`);
  console.log(`   - Customer:       ${customer?.name || "Unknown"} (${customer?.email || "No email"})`);
  console.log(`   - Amount:         ₹${amount.toLocaleString("en-IN")} ${currency}`);
  console.log(`   - Simulated Pay:  ${paymentId}`);
  console.log(`   - Workflow State: ${workflowState?.state || "DETECTED"}`);

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
          amount: Math.round(amount * 100), // in paise
          currency,
          status: "captured",
          order_id: orderId,
          invoice_id: null,
          payment_link_id: paymentLinkId,
          email: customer?.email || "customer@example.test",
          contact: customer?.phone || "+919876543210",
          notes: {
            ticketId: ticket.id,
            ticket_id: ticket.id,
            entityId: ticket.entityId,
            entity_id: ticket.entityId,
            customerId: customer?.id,
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
                amount: Math.round(amount * 100),
                currency,
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
  console.log(`\n🚀 Dispatching payment webhook for Ticket ${ticket.id}...`);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": signature,
      },
      body: rawBody,
    });

    if (res.status === 200) {
      console.log(`📥 Webhook accepted by server (HTTP ${res.status}).`);
    } else {
      console.warn(`⚠️ Webhook server responded with HTTP ${res.status}, falling back to direct service processing...`);
      await processRazorpayPaymentWebhook(payload);
    }
  } catch (_fetchErr) {
    console.log("ℹ️ Server HTTP endpoint unreachable. Processing directly through webhook service layer...");
    await processRazorpayPaymentWebhook(payload);
  }

  // Allow database writes to settle
  await new Promise((r) => setTimeout(r, 600));

  // Verify resulting records
  const updatedTicket = await prisma.ticket.findUnique({
    where: { id: ticket.id },
    include: { notes: { orderBy: { createdAt: "desc" }, take: 2 } },
  });
  const updatedWorkflow = await prisma.entityWorkflowState.findUnique({
    where: { entityId: ticket.entityId },
  });
  const latestAudit = await prisma.auditEntry.findFirst({
    where: { entityId: ticket.entityId },
    orderBy: { sequenceNumber: "desc" },
  });
  const latestLedger = await prisma.ledgerEntry.findFirst({
    where: { entityId: ticket.entityId, type: "RECOVERED" },
    orderBy: { createdAt: "desc" },
  });

  console.log("\n==================================================");
  console.log("   Verification Results:");
  console.log("==================================================");
  console.log(`   - Ticket Status:   ${updatedTicket?.status === "recovered" ? "✅ RECOVERED" : "ℹ️ " + updatedTicket?.status}`);
  console.log(`   - Entity State:    ${updatedWorkflow?.state === "RECOVERED" ? "✅ RECOVERED" : "ℹ️ " + updatedWorkflow?.state}`);
  console.log(`   - Ledger Entry:    ${latestLedger ? `✅ RECOVERED ₹${latestLedger.amount.toLocaleString("en-IN")} (${latestLedger.referenceId})` : "❌ None logged"}`);
  console.log(`   - Audit Trail:     ${latestAudit ? `✅ #${latestAudit.sequenceNumber} [${latestAudit.outcome}] (hash: ${latestAudit.hash.slice(0, 12)}...)` : "❌ None"}`);

  if (updatedTicket?.notes && updatedTicket.notes.length > 0) {
    console.log(`   - Latest Note:     "${updatedTicket.notes[0].content}"`);
  }

  console.log("\n🎉 Payment event successfully applied to Ticket!");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ Fatal error executing script:", err);
  await prisma.$disconnect();
  process.exit(1);
});
