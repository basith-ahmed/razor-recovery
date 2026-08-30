/**
 * Script: simulatePromisePayment.ts
 *
 * Simulates a successful customer payment on a Promise-to-Pay commitment.
 * - Looks up a specific promise by ID, or automatically picks the latest active promise.
 * - Constructs a cryptographically signed Razorpay `payment_link.paid` webhook event.
 * - Posts the payload to the running backend's `/webhooks/razorpay` endpoint.
 * - Verifies that the promise is marked as "kept" and the recovery workflow is resolved.
 *
 * Usage:
 *   npx tsx src/scripts/simulatePromisePayment.ts [promiseId]
 */

import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";

async function main() {
  console.log("==================================================");
  console.log("   Simulate Promise-to-Pay Payment Webhook");
  console.log("==================================================\n");

  const targetPromiseId = process.argv[2];

  let promise;
  if (targetPromiseId) {
    console.log(`Looking up specified promise ID: ${targetPromiseId}...`);
    promise = await prisma.promiseToPay.findUnique({
      where: { id: targetPromiseId },
      include: { customer: true, event: true },
    });
    if (!promise) {
      console.error(`❌ No Promise-to-Pay record found for ID: ${targetPromiseId}`);
      process.exit(1);
    }
  } else {
    console.log("Searching for a pending or active Promise-to-Pay in database...");
    promise = await prisma.promiseToPay.findFirst({
      where: {
        status: { in: ["pending", "reminder_sent"] },
      },
      include: { customer: true, event: true },
      orderBy: { createdAt: "desc" },
    });

    if (!promise) {
      console.log("No pending promise found. Checking latest promise record...");
      promise = await prisma.promiseToPay.findFirst({
        include: { customer: true, event: true },
        orderBy: { createdAt: "desc" },
      });
    }
  }

  if (!promise) {
    console.error("❌ No Promise-to-Pay records exist in the database.");
    console.error("   Create a Promise-to-Pay first via the UI (/promises) or API.");
    process.exit(1);
  }

  const { id, entityId, customer, promisedAmount, currency, razorpayPaymentLinkId } = promise;
  const paymentId = `pay_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const orderId = `order_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const effectivePaymentLinkId = razorpayPaymentLinkId || `plink_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  console.log("🎯 Target Promise-to-Pay:");
  console.log(`   - Promise ID:       ${id}`);
  console.log(`   - Entity ID:        ${entityId}`);
  console.log(`   - Customer:         ${customer.name} (${customer.email})`);
  console.log(`   - Promised Amount:  ₹${promisedAmount} ${currency}`);
  console.log(`   - Current Status:   ${promise.status.toUpperCase()}`);
  console.log(`   - Payment Link ID:  ${effectivePaymentLinkId}`);
  console.log(`   - Simulated Pay ID: ${paymentId}`);

  // Construct official Razorpay payment_link.paid webhook payload
  const payload = {
    entity: "event",
    account_id: "acc_sim_razorrecovery",
    event: "payment_link.paid",
    contains: ["payment", "payment_link"],
    payload: {
      payment: {
        entity: {
          id: paymentId,
          entity: "payment",
          amount: Math.round(promisedAmount * 100), // in paise
          currency: currency || "INR",
          status: "captured",
          order_id: orderId,
          payment_link_id: effectivePaymentLinkId,
          email: customer.email,
          contact: customer.phone || "+919876543210",
          notes: {
            entity_id: entityId,
            customer_id: customer.id,
            promise_id: id,
            simulator: "razorrecovery",
          },
          created_at: Math.floor(Date.now() / 1000),
        },
      },
      payment_link: {
        entity: {
          id: effectivePaymentLinkId,
          status: "paid",
          amount: Math.round(promisedAmount * 100),
          currency: currency || "INR",
          notes: {
            entity_id: entityId,
            customer_id: customer.id,
            promise_id: id,
          },
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const rawBody = JSON.stringify(payload);

  // Compute HMAC SHA256 Signature with RAZORPAY_WEBHOOK_SECRET
  const signature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const webhookUrl = `http://localhost:${env.PORT}/webhooks/razorpay`;
  console.log(`\n🚀 Dispatching payment_link.paid webhook to ${webhookUrl}...`);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": signature,
      },
      body: rawBody,
    });

    const responseBody = await res.json();
    console.log(`📥 Server Response: HTTP ${res.status}`, responseBody);

    if (res.status !== 200) {
      console.error("❌ Webhook failed with status:", res.status);
      process.exit(1);
    }

    // Wait briefly for asynchronous database transaction completion
    await new Promise((r) => setTimeout(r, 600));

    // Verify updated state in database
    const updatedPromise = await prisma.promiseToPay.findUnique({
      where: { id },
    });
    const entityState = await prisma.entityWorkflowState.findUnique({
      where: { entityId },
    });
    const latestAudit = await prisma.auditEntry.findFirst({
      where: { entityId },
      orderBy: { sequenceNumber: "desc" },
    });

    console.log("\n==================================================");
    console.log("   Verification Results:");
    console.log("==================================================");
    console.log(
      `   - Promise Status:   ${
        updatedPromise?.status === "kept"
          ? "✅ KEPT (Payment Received)"
          : "❌ " + updatedPromise?.status
      }`
    );
    console.log(
      `   - Workflow State:   ${
        entityState?.state === "RECOVERED"
          ? "✅ RECOVERED"
          : "❌ " + (entityState?.state ?? "N/A")
      }`
    );
    console.log(
      `   - Audit Outcome:    ${
        latestAudit?.outcome === "recovered"
          ? `✅ ${latestAudit.actor} → ${latestAudit.outcome}`
          : "❌ " + (latestAudit?.outcome ?? "N/A")
      }`
    );
    console.log("\n🎉 Promise payment settlement simulated successfully!");
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
