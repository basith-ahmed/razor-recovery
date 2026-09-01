import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { env } from "../config/env";
import { writeLedgerEntry } from "./ledgerService";
import { writeChainedAuditEntry, announceAuditEntry } from "./auditService";
import { emitLiveUpdate } from "../api/websocket";
import { DomainError } from "../domain/types";

/**
 * Validates HMAC SHA256 signature from Razorpay webhook headers.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string = env.RAZORPAY_WEBHOOK_SECRET
): boolean {
  if (!signature) return false;
  try {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Processes an authentic Razorpay payment webhook payload, settling promises and recovering workflow states.
 */
export async function processRazorpayPaymentWebhook(payload: Record<string, any>) {
  const eventName = payload.event as string | undefined;

  if (eventName !== "payment.captured" && eventName !== "payment_link.paid") {
    return { status: "ignored", eventName };
  }

  const paymentEntity = payload.payload?.payment?.entity;
  const linkEntity = payload.payload?.payment_link?.entity;

  const paymentId = paymentEntity?.id as string | undefined;
  const orderId = paymentEntity?.order_id as string | undefined;
  const paymentLinkId = (linkEntity?.id || paymentEntity?.payment_link_id) as string | undefined;
  const notes = (paymentEntity?.notes || linkEntity?.notes || {}) as Record<string, unknown>;
  const notesEntityId = (notes.entity_id || notes.entityId) as string | undefined;
  const notesEventId = (notes.event_id || notes.eventId) as string | undefined;
  const notesPromiseId = (notes.promise_id || notes.promiseId) as string | undefined;
  const notesTicketId = (notes.ticket_id || notes.ticketId) as string | undefined;

  // Step 1 — Match via Action record (razorpayPaymentLinkId, paymentId, or orderId)
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

  // Step 2 — Match via Ticket.razorpayPaymentLinkId (indexed — O(1) lookup)
  // This covers human escalation emails where agent sent a link tied to the ticket.
  if (!event && (paymentLinkId || notesTicketId)) {
    const matchedTicket = await prisma.ticket.findFirst({
      where: {
        OR: [
          ...(paymentLinkId ? [{ razorpayPaymentLinkId: paymentLinkId }] : []),
          ...(notesTicketId ? [{ id: notesTicketId }] : []),
        ],
        status: { not: "recovered" },
      },
    });
    if (matchedTicket?.entityId) {
      event = (await prisma.revenueEvent.findFirst({
        where: { entityId: matchedTicket.entityId },
        orderBy: { occurredAt: "desc" },
      })) ?? undefined;
    }
  }

  // Step 3 — Match via RevenueEvent directly, or resolve via PromiseToPay link
  if (!event && (paymentId || orderId || notesEventId || notesEntityId || paymentLinkId || notesPromiseId)) {
    const eventConds: Prisma.RevenueEventWhereInput[] = [];
    if (paymentId) eventConds.push({ razorpayPaymentId: paymentId });
    if (orderId) eventConds.push({ razorpayOrderId: orderId });
    if (notesEventId) eventConds.push({ id: notesEventId });
    if (notesEntityId) eventConds.push({ entityId: notesEntityId });

    if (paymentLinkId || notesPromiseId) {
      const promiseWithLink = await prisma.promiseToPay.findFirst({
        where: {
          OR: [
            ...(paymentLinkId ? [{ razorpayPaymentLinkId: paymentLinkId }] : []),
            ...(notesPromiseId ? [{ id: notesPromiseId }] : []),
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
    // Check if the entity is already RECOVERED
    const currentWorkflow = await prisma.entityWorkflowState.findUnique({
      where: { entityId: event.entityId },
    });

    if (currentWorkflow?.state === "RECOVERED") {
      console.log(`[webhook] Entity ${event.entityId} is already RECOVERED; skipping duplicate settlement.`);
      return { status: "already_recovered", entityId: event.entityId };
    }

    const recoveryAuditEntry = await prisma.$transaction(async (tx) => {
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
            ...(notesPromiseId ? [{ id: notesPromiseId, status: { in: ["pending", "reminder_sent"] } }] : []),
          ],
        },
        data: {
          status: "kept",
        },
      });

      // Auto-resolve any open tickets for this entity or specified ticketId
      const openTickets = await tx.ticket.findMany({
        where: {
          OR: [
            { entityId: event.entityId, status: "open" },
            ...(notesTicketId ? [{ id: notesTicketId, status: "open" }] : []),
          ],
        },
      });

      for (const t of openTickets) {
        await tx.ticket.update({
          where: { id: t.id },
          data: {
            status: "recovered",
            resolvedAt: new Date(),
            resolutionNotes: `Auto-resolved by Razorpay payment webhook (${paymentId || "captured"}).`,
          },
        });

        await tx.ticketNote.create({
          data: {
            ticketId: t.id,
            author: "System / Webhook",
            content: `Payment received of ₹${event.amount}. Ticket automatically marked RECOVERED.`,
            type: "status_change",
          },
        });
      }

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

    await announceAuditEntry(recoveryAuditEntry, {
      eventId: event.id,
      entityId: event.entityId,
    });
    console.log(`[webhookService] Entity ${event.entityId} marked RECOVERED via payment webhook.`);
    return { status: "recovered", entityId: event.entityId };
  } else {
    // 3. Fallback: match standalone promises directly
    const matchingPromises = await prisma.promiseToPay.findMany({
      where: {
        OR: [
          ...(paymentLinkId ? [{ razorpayPaymentLinkId: paymentLinkId }] : []),
          ...(notesEntityId ? [{ entityId: notesEntityId }] : []),
          ...(notesPromiseId ? [{ id: notesPromiseId }] : []),
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
            eventId,
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
      console.log(`[webhookService] Settled ${matchingPromises.length} standalone promise(s) to 'kept'.`);
      return { status: "settled_promises", count: matchingPromises.length };
    }
  }

  return { status: "unmatched" };
}
