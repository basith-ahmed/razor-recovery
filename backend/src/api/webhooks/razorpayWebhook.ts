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
      if (!event && (paymentId || orderId || notesEventId || notesEntityId || paymentLinkId || (notes as any)?.promise_id)) {
        const eventConds: Prisma.RevenueEventWhereInput[] = [];
        if (paymentId) eventConds.push({ razorpayPaymentId: paymentId });
        if (orderId) eventConds.push({ razorpayOrderId: orderId });
        if (notesEventId) eventConds.push({ id: notesEventId });
        if (notesEntityId) eventConds.push({ entityId: notesEntityId });

        if (paymentLinkId || (notes as any)?.promise_id) {
          const promiseWithLink = await prisma.promiseToPay.findFirst({
            where: {
              OR: [
                ...(paymentLinkId ? [{ razorpayPaymentLinkId: paymentLinkId }] : []),
                ...((notes as any)?.promise_id ? [{ id: (notes as any).promise_id }] : []),
              ],
            },
          });
          if (promiseWithLink?.eventId) {
            eventConds.push({ id: promiseWithLink.eventId });
          }
          if (promiseWithLink?.entityId) {
            eventConds.push({ entityId: promiseWithLink.entityId });
          }
        }

        if (eventConds.length > 0) {
          event =
            (await prisma.revenueEvent.findFirst({
              where: { OR: eventConds },
              orderBy: { occurredAt: "desc" },
            })) ?? undefined;
        }
      }

      if (event) {
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

          await tx.promiseToPay.updateMany({
            where: {
              OR: [
                { entityId: event.entityId, status: { in: ["pending", "reminder_sent"] } },
                ...(paymentLinkId ? [{ razorpayPaymentLinkId: paymentLinkId, status: { in: ["pending", "reminder_sent"] } }] : []),
                ...((notes as any)?.promise_id ? [{ id: (notes as any).promise_id, status: { in: ["pending", "reminder_sent"] } }] : []),
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

          const matchingPromise = await tx.promiseToPay.findFirst({
            where: {
              OR: [
                { entityId: event.entityId },
                ...(paymentLinkId ? [{ razorpayPaymentLinkId: paymentLinkId }] : []),
              ],
            },
          });
          const recoveredAmount = matchingPromise?.promisedAmount ?? event.amount;

          await writeLedgerEntry(tx, {
            entityId: event.entityId,
            eventId: event.id,
            type: "RECOVERED",
            amount: recoveredAmount,
            currency: event.currency,
            referenceId: paymentId || orderId || paymentLinkId,
          });
          return auditEntry;
        });

        try {
          await publish(TOPICS.AUDIT, event.id, {
            auditEntryId: recoveryAuditEntry.id,
            event: { id: event.id, entityId: event.entityId },
          });
        } catch (publishError) {
          console.error("[razorpayWebhook] Failed to publish recovery for embedding:", publishError);
        }

        await emitLiveUpdate(event.id);
        console.log(`[razorpayWebhook] Entity ${event.entityId} marked RECOVERED via payment webhook.`);
      } else {
        const matchingPromises = await prisma.promiseToPay.findMany({
          where: {
            OR: [
              ...(paymentLinkId ? [{ razorpayPaymentLinkId: paymentLinkId }] : []),
              ...(notesEntityId ? [{ entityId: notesEntityId }] : []),
              ...((notes as any)?.promise_id ? [{ id: (notes as any).promise_id }] : []),
              ...(paymentEntity?.email ? [{ customer: { email: paymentEntity.email } }] : []),
            ],
            status: { in: ["pending", "reminder_sent"] },
          },
        });

        if (matchingPromises.length > 0) {
          await prisma.$transaction(async (tx) => {
            for (const p of matchingPromises) {
              await tx.promiseToPay.update({
                where: { id: p.id },
                data: { status: "kept" },
              });
              let eventId = p.eventId;
              if (!eventId) {
                const fallbackEv = await tx.revenueEvent.create({
                  data: {
                    entityId: p.entityId,
                    entityType: "INVOICE",
                    eventType: "INVOICE_OVERDUE",
                    customerId: p.customerId,
                    amount: p.promisedAmount,
                    currency: p.currency,
                    occurredAt: p.createdAt,
                    errorCode: "PROMISE_PAYMENT",
                    errorReason: "promise_settlement",
                    rawPayload: { promise: true },
                  },
                });
                eventId = fallbackEv.id;
                await tx.promiseToPay.update({
                  where: { id: p.id },
                  data: { eventId: fallbackEv.id },
                });
                await writeLedgerEntry(tx, {
                  entityId: p.entityId,
                  eventId: fallbackEv.id,
                  type: "AT_RISK",
                  amount: p.promisedAmount,
                  currency: p.currency,
                  referenceId: p.entityId,
                });
              }

              await writeLedgerEntry(tx, {
                entityId: p.entityId,
                eventId: eventId,
                type: "RECOVERED",
                amount: p.promisedAmount,
                currency: p.currency,
                referenceId: paymentId || paymentLinkId || p.id,
              });

              await tx.entityWorkflowState.upsert({
                where: { entityId: p.entityId },
                create: {
                  entityId: p.entityId,
                  customerId: p.customerId,
                  state: "RECOVERED",
                  attemptCount: 0,
                },
                update: {
                  state: "RECOVERED",
                  attemptCount: 0,
                },
              });
            }
          });
          await emitLiveUpdate(matchingPromises[0].entityId);
          console.log(`[razorpayWebhook] Settled ${matchingPromises.length} standalone promise(s) to 'kept'.`);
        } else {
          console.log("[razorpayWebhook] No matching event or promise found for payment webhook payload.");
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
