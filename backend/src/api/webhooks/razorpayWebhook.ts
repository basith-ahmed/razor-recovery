import express, { Router, Request, Response } from "express";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { publish } from "../../kafka/producer";
import { TOPICS } from "../../kafka/topics";
import { writeChainedAuditEntry, recordFailureAuditEntry } from "../../services/auditService";
import { writeLedgerEntry } from "../../services/ledgerService";
import { emitLiveUpdate } from "../websocket";
import { env } from "../../config/env";
import { redis } from "../../config/redis";

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

export async function handleRazorpayWebhook(req: Request, res: Response) {
  const signature = (req.headers["x-razorpay-signature"] || req.headers["X-Razorpay-Signature"]) as string | undefined;
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

  const isValid = verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  if (!isValid) {
    console.warn("[razorpayWebhook] Invalid or missing Razorpay webhook signature.");
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eventName = payload.event as string | undefined;

    if (eventName === "payment.captured" || eventName === "payment_link.paid") {
      const paymentEntity = payload.payload?.payment?.entity;
      const linkEntity = payload.payload?.payment_link?.entity;

      const paymentId = paymentEntity?.id as string | undefined;
      const orderId = paymentEntity?.order_id as string | undefined;
      const paymentLinkId = (linkEntity?.id || paymentEntity?.payment_link_id) as string | undefined;
      const notes = ((paymentEntity?.notes || linkEntity?.notes || {}) as Record<string, unknown>);
      const notesEntityId = (notes.entity_id || notes.entityId) as string | undefined;
      const notesEventId = (notes.event_id || notes.eventId) as string | undefined;

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
      if (!event && (paymentId || orderId || notesEventId || notesEntityId)) {
        const eventConds: Prisma.RevenueEventWhereInput[] = [];
        if (paymentId) eventConds.push({ razorpayPaymentId: paymentId });
        if (orderId) eventConds.push({ razorpayOrderId: orderId });
        if (notesEventId) eventConds.push({ id: notesEventId });
        if (notesEntityId) eventConds.push({ entityId: notesEntityId });
        if (eventConds.length > 0) {
          event =
            (await prisma.revenueEvent.findFirst({
              where: { OR: eventConds },
              orderBy: { occurredAt: "desc" },
            })) ?? undefined;
        }
      }

      if (event) {
        // Recovery closes this recovery ARC: wipe per-cause attempt/cooldown
        // memory so the next event on this entity — a genuinely new billing
        // cycle, or an unrelated cause arriving while this one just resolved —
        // starts with a clean budget, not stale state from whatever cause just
        // recovered.
        const recoveryAuditEntry = await prisma.$transaction(async (tx) => {
          const [diagnosis, decision] = await Promise.all([
            tx.diagnosis.findUnique({ where: { eventId: event.id } }),
            tx.decision.findUnique({ where: { eventId: event.id } }),
          ]);
          await tx.entityCauseState.deleteMany({
            where: { entityId: event.entityId },
          });

          await tx.entityWorkflowState.upsert({
            where: { entityId: event.entityId },
            create: {
              entityId: event.entityId,
              customerId: event.customerId,
              state: "RECOVERED",
              attemptCount: 0,
              lastContactedAt: null,
              cooldownUntil: null,
            },
            update: {
              state: "RECOVERED",
              attemptCount: 0,
              lastContactedAt: null,
              cooldownUntil: null,
            },
          });

          await redis.set(`razorrecovery:recovered:${event.entityId}`, "true", "EX", 86400 * 30);

          // Update any active Promise-to-Pay commitments for this entity to 'kept'
          await tx.promiseToPay.updateMany({
            where: {
              OR: [
                { entityId: event.entityId, status: { in: ["pending", "reminder_sent"] } },
                ...(paymentLinkId ? [{ razorpayPaymentLinkId: paymentLinkId, status: { in: ["pending", "reminder_sent"] } }] : []),
              ],
            },
            data: {
              status: "kept",
            },
          });

          const recoveryAction = {
            actionType: "webhook_capture",
            result: "success",
            integration: "RAZORPAY",
            detail: "Payment captured via Razorpay webhook.",
            paymentId: paymentId || orderId || paymentLinkId,
          };

          // Record AuditEntry for recovery settlement from the incoming webhook
          const auditEntry = await writeChainedAuditEntry(tx, {
            eventId: event.id,
            entityId: event.entityId,
            actor: "razorpay_webhook",
            inputSnapshot: payload,
            diagnosisSnapshot: undefined,
            decisionSnapshot: undefined,
            actionSnapshot: recoveryAction,
            outcome: "recovered",
            timestamp: new Date(),
          });
          await writeLedgerEntry(tx, {
            entityId: event.entityId,
            eventId: event.id,
            type: "RECOVERED",
            amount: event.amount,
            currency: event.currency,
            referenceId: paymentId || orderId || paymentLinkId,
          });
          return auditEntry;
        });

        // Keep RAG indexing decoupled from the webhook write: the embedding
        // consumer independently reacts to the finalized audit record.
        try {
          await publish(TOPICS.AUDIT, event.id, {
            auditEntryId: recoveryAuditEntry.id,
            event: { id: event.id, entityId: event.entityId },
          });
        } catch (publishError) {
          // A webhook acknowledgement must not be rolled back after its
          // recovery transaction commits. Startup connects the producer in
          // production; this makes a disconnected producer visible in logs
          // while preserving Razorpay's successful recovery acknowledgement.
          console.error("[razorpayWebhook] Failed to publish recovery for embedding:", publishError);
          try {
            await recordFailureAuditEntry(
              { id: event.id, entityId: event.entityId },
              { inputSnapshot: { stage: "embedding_publish", payload } },
            );
          } catch (auditError) {
            console.error("[razorpayWebhook] Failed to record publish failure audit entry:", auditError);
          }
        }

        // Trigger real-time WebSocket update on the global live channel
        await emitLiveUpdate(event.id);

        console.log(`[razorpayWebhook] Entity ${event.entityId} marked RECOVERED via payment webhook.`);
      } else {
        console.log("[razorpayWebhook] No matching action found for payment webhook payload.");
      }
    } else if (eventName === "refund.processed" || eventName === "payment.refunded") {
      const refundEntity = payload.payload?.refund?.entity;
      const paymentId = refundEntity?.payment_id as string | undefined;
      const refundId = refundEntity?.id as string | undefined;
      const refundedAmount = refundEntity?.amount ? refundEntity.amount / 100 : undefined; // Amount is typically in paise, convert to major unit if needed, assuming our events use major units.
      
      if (paymentId) {
        const recoveredLedger = await prisma.ledgerEntry.findFirst({
          where: {
            type: "RECOVERED",
            referenceId: paymentId,
          },
          include: { event: true },
        });

        if (recoveredLedger) {
          const event = recoveredLedger.event;
          await prisma.$transaction(async (tx) => {
            await writeLedgerEntry(tx, {
              entityId: event.entityId,
              eventId: event.id,
              type: "REVERSED",
              amount: refundedAmount || event.amount, // fallback to full amount
              currency: event.currency,
              referenceId: refundId || paymentId,
            });
          });
          
          await emitLiveUpdate(event.id);
          console.log(`[razorpayWebhook] Refund processed for entity ${event.entityId}. Logged REVERSED ledger entry.`);
        } else {
          console.log(`[razorpayWebhook] No matching RECOVERED ledger entry found for refunded payment ${paymentId}.`);
        }
      }
    }

    return res.status(200).json({ status: "ok", processed: true });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Error processing webhook";
    console.error("[razorpayWebhook] Internal error processing webhook:", error);
    return res.status(500).json({ error: errMessage });
  }
}

razorpayWebhookRouter.post("/", handleRazorpayWebhook);

