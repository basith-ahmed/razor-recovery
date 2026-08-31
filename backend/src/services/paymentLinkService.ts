/**
 * paymentLinkService.ts
 *
 * Single source of truth for resolving or creating a Razorpay payment link for any context.
 *
 * Design contract:
 *  - One entity/event → one Razorpay payment link, reused across ALL pipeline stages:
 *    automated executor actions, Promise-to-Pay tracking, escalation ticket emails, follow-up reminders.
 *  - Callers never call createRecoveryPaymentLink() directly. They call getOrCreatePaymentLink().
 *  - The resolved link is persisted back to whichever record first owns it
 *    (Action → PromiseToPay → Ticket in that priority order).
 */

import { prisma } from "../config/prisma";
import { createRecoveryPaymentLink } from "../integrations/razorpayIntegration";
import { DomainError } from "../domain/types";

export interface PaymentLinkContext {
  // Required — must provide at least one of these to resolve the entity
  entityId: string;
  eventId?: string;
  promiseId?: string;
  ticketId?: string;

  // Required for creating a new link
  amount: number;
  currency: string;
  customer: {
    name: string;
    email: string;
    phone?: string | null;
  };
  description: string;
  actionType: string;
  notify?: boolean;
}

export interface ResolvedPaymentLink {
  razorpayPaymentLinkId: string;
  paymentLinkUrl: string;
  source: "action" | "promise" | "ticket" | "created";
}

/**
 * Returns the existing active Razorpay payment link for the entity/event/promise/ticket,
 * or creates a new one and persists it. Ensures one entity always has one canonical link.
 */
export async function getOrCreatePaymentLink(
  ctx: PaymentLinkContext,
): Promise<ResolvedPaymentLink> {
  // ── Priority 1: Check Action record by eventId ──────────────────────────────
  if (ctx.eventId) {
    const action = await prisma.action.findFirst({
      where: {
        eventId: ctx.eventId,
        razorpayPaymentLinkId: { not: null },
      },
      orderBy: { executedAt: "desc" },
    });
    if (action?.razorpayPaymentLinkId && action.paymentLinkUrl) {
      return {
        razorpayPaymentLinkId: action.razorpayPaymentLinkId,
        paymentLinkUrl: action.paymentLinkUrl,
        source: "action",
      };
    }
  }

  // ── Priority 2: Check PromiseToPay by promiseId or entityId ─────────────────
  if (ctx.promiseId || ctx.entityId) {
    const promise = await prisma.promiseToPay.findFirst({
      where: {
        AND: [
          { razorpayPaymentLinkId: { not: null } },
          {
            OR: [
              ...(ctx.promiseId ? [{ id: ctx.promiseId }] : []),
              { entityId: ctx.entityId, status: { in: ["pending", "reminder_sent"] } },
            ],
          },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (promise?.razorpayPaymentLinkId && promise.paymentLinkUrl) {
      return {
        razorpayPaymentLinkId: promise.razorpayPaymentLinkId,
        paymentLinkUrl: promise.paymentLinkUrl,
        source: "promise",
      };
    }
  }

  // ── Priority 3: Check Ticket by ticketId or entityId ────────────────────────
  if (ctx.ticketId || ctx.entityId) {
    const ticket = await prisma.ticket.findFirst({
      where: {
        AND: [
          { razorpayPaymentLinkId: { not: null } },
          {
            OR: [
              ...(ctx.ticketId ? [{ id: ctx.ticketId }] : []),
              { entityId: ctx.entityId, status: "open" },
            ],
          },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (ticket?.razorpayPaymentLinkId && ticket.paymentLinkUrl) {
      return {
        razorpayPaymentLinkId: ticket.razorpayPaymentLinkId,
        paymentLinkUrl: ticket.paymentLinkUrl,
        source: "ticket",
      };
    }
  }

  // ── No existing link found → create a new one ───────────────────────────────
  const linkResult = await createRecoveryPaymentLink({
    amount: ctx.amount,
    currency: ctx.currency,
    customerName: ctx.customer.name,
    customerEmail: ctx.customer.email,
    customerPhone: ctx.customer.phone ?? undefined,
    description: ctx.description,
    notify: ctx.notify,
    actionType: ctx.actionType,
    entityId: ctx.entityId,
    eventId: ctx.eventId,
    promiseId: ctx.promiseId,
    ticketId: ctx.ticketId,
  });

  if (!linkResult.razorpayPaymentLinkId || !linkResult.paymentLinkUrl) {
    throw new DomainError(
      "Payment link creation returned no ID or URL.",
      "PAYMENT_LINK_CREATION_INCOMPLETE",
    );
  }

  return {
    razorpayPaymentLinkId: linkResult.razorpayPaymentLinkId,
    paymentLinkUrl: linkResult.paymentLinkUrl,
    source: "created",
  };
}
