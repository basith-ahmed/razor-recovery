import crypto from "crypto";
import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { emitLiveUpdate } from "../websocket";

export const razorpayWebhookRouter = Router();

export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const expectedBuf = Buffer.from(expectedSignature, "utf8");
    const signatureBuf = Buffer.from(signature, "utf8");

    if (expectedBuf.length !== signatureBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  } catch (err) {
    console.error("[razorpayWebhook] Error verifying webhook signature:", err);
    return false;
  }
}

// POST /webhooks/razorpay
razorpayWebhookRouter.post("/", async (req: Request, res: Response) => {
  const signature = (req.headers["x-razorpay-signature"] || req.headers["X-Razorpay-Signature"]) as string | undefined;

  // Retrieve raw body buffer if captured by body-parser verify hook, or stringify req.body
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

  const isValid = verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  if (!isValid) {
    console.warn("[razorpayWebhook] Invalid or missing Razorpay webhook signature.");
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eventName = payload.event as string | undefined;

    console.log(`[razorpayWebhook] Received valid webhook event: ${eventName}`);

    if (eventName === "payment.captured" || eventName === "payment_link.paid") {
      const paymentEntity = payload.payload?.payment?.entity;
      const linkEntity = payload.payload?.payment_link?.entity;

      const paymentId = paymentEntity?.id as string | undefined;
      const orderId = paymentEntity?.order_id as string | undefined;
      const paymentLinkId = (linkEntity?.id || paymentEntity?.payment_link_id) as string | undefined;

      const conds: Prisma.ActionWhereInput[] = [];
      if (paymentLinkId) conds.push({ razorpayPaymentLinkId: paymentLinkId });
      if (paymentId) conds.push({ event: { razorpayPaymentId: paymentId } });
      if (orderId) conds.push({ event: { razorpayOrderId: orderId } });

      const action =
        conds.length > 0
          ? await prisma.action.findFirst({
              where: { OR: conds },
              include: { event: true },
            })
          : null;

      let event = action?.event;
      if (!event && (paymentId || orderId)) {
        const eventConds: Prisma.RevenueEventWhereInput[] = [];
        if (paymentId) eventConds.push({ razorpayPaymentId: paymentId });
        if (orderId) eventConds.push({ razorpayOrderId: orderId });
        if (eventConds.length > 0) {
          event =
            (await prisma.revenueEvent.findFirst({
              where: { OR: eventConds },
            })) ?? undefined;
        }
      }

      if (event) {
        // Recovery closes this recovery ARC: reset per-entity memory so the
        // next billing cycle (or a new failure on the same entity) starts
        // fresh instead of inheriting stale attempt counts. The cooldown key
        // is left to expire naturally.
        await redis.del(
          `razorrecovery:attempts:${event.entityId}`,
          `razorrecovery:lastContact:${event.entityId}`,
        );

        // Transition EntityWorkflowState to RECOVERED with a clean attempt count
        await prisma.entityWorkflowState.upsert({
          where: { entityId: event.entityId },
          create: {
            entityId: event.entityId,
            customerId: event.customerId,
            state: "RECOVERED",
            attemptCount: 0,
            lastContactedAt: new Date(),
          },
          update: {
            state: "RECOVERED",
            attemptCount: 0,
          },
        });

        // Record AuditEntry for recovery
        await prisma.auditEntry.create({
          data: {
            eventId: event.id,
            entityId: event.entityId,
            actor: "razorpay_webhook",
            inputSnapshot: payload,
            outcome: "recovered",
            timestamp: new Date(),
          },
        });

        // Trigger real-time WebSocket update on the global live channel
        await emitLiveUpdate(event.id);

        console.log(`[razorpayWebhook] Entity ${event.entityId} marked RECOVERED via payment webhook.`);
      } else {
        console.log("[razorpayWebhook] No matching action found for payment webhook payload.");
      }
    }

    return res.status(200).json({ status: "ok", processed: true });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Error processing webhook";
    console.error("[razorpayWebhook] Internal error processing webhook:", error);
    return res.status(500).json({ error: errMessage });
  }
});
