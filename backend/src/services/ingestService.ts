import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { publish } from "../kafka/producer";
import { TOPICS } from "../kafka/topics";
import {
  CartEnvelope,
  EnvelopeValidationResult,
  EventEnvelope,
  InvoiceEnvelope,
  SubscriptionEnvelope,
  validateEnvelope,
} from "../domain/eventEnvelope";
import { DomainError, EventType, EntityType, RawRevenueEvent } from "../domain/types";

const INGEST_DEDUP_PREFIX = "razorrecovery:ingest:";
const INGEST_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface IngestResult {
  eventId: string;
  entityId: string;
  customerId: string;
  eventType: EventType;
  deduped: boolean;
}

interface IngestFingerprint {
  type: string;
  entityRef: string;
  amount: number;
  customerEmail: string;
}

export class IngestError extends DomainError {}

const EVENT_TYPE_BY_ENVELOPE: Record<EventEnvelope["type"], EventType> = {
  cart: "CHECKOUT_ABANDONED",
  invoice: "INVOICE_OVERDUE",
  subscription: "SUBSCRIPTION_MANDATE_CANCELLED",
};

const ENTITY_TYPE_BY_ENVELOPE: Record<EventEnvelope["type"], EntityType> = {
  cart: "CART",
  invoice: "INVOICE",
  subscription: "SUBSCRIPTION",
};

function fingerprintOf(envelope: EventEnvelope, customerEmail: string): IngestFingerprint {
  const ref =
    envelope.type === "cart"
      ? envelope.cart.ref
      : envelope.type === "invoice"
        ? envelope.invoice.ref
        : envelope.subscription.ref;
  const amount =
    envelope.type === "cart"
      ? envelope.cart.amount
      : envelope.type === "invoice"
        ? envelope.invoice.amount
        : envelope.subscription.amount;
  return { type: envelope.type, entityRef: ref, amount, customerEmail };
}

function fingerprintMatches(
  stored: IngestFingerprint,
  incoming: IngestFingerprint,
): boolean {
  return (
    stored.type === incoming.type &&
    stored.entityRef === incoming.entityRef &&
    stored.amount === incoming.amount &&
    stored.customerEmail.toLowerCase() === incoming.customerEmail.toLowerCase()
  );
}

function hoursSince(fromIso: string, untilIso: string): number {
  const elapsedMs = new Date(untilIso).getTime() - new Date(fromIso).getTime();
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) return 0;
  return Math.floor(elapsedMs / (1000 * 60 * 60));
}

function daysOverdue(dueDateIso: string, occurredAtIso: string): number {
  const elapsedMs = new Date(occurredAtIso).getTime() - new Date(dueDateIso).getTime();
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) return 0;
  return Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
}

function buildRawPayload(envelope: EventEnvelope): Record<string, unknown> {
  const base = { source: "partner_ingest" };
  if (envelope.type === "cart") {
    const cart: CartEnvelope = envelope.cart;
    return {
      ...base,
      hoursSinceAbandon: hoursSince(cart.abandonedAt, envelope.occurredAt),
      abandonedAt: cart.abandonedAt,
      itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      items: cart.items,
    };
  }
  if (envelope.type === "invoice") {
    const invoice: InvoiceEnvelope = envelope.invoice;
    return {
      ...base,
      daysOverdue: daysOverdue(invoice.dueDate, envelope.occurredAt),
      dueDate: invoice.dueDate,
      disputeFlag: invoice.disputeFlag,
    };
  }
  const subscription: SubscriptionEnvelope = envelope.subscription;
  return {
    ...base,
    subscription_status: "halted",
    mandate_status: subscription.mandateStatus,
    mandate_ref: subscription.mandateRef,
    next_bill_date: subscription.nextBillDate,
  };
}

function toRawRevenueEvent(
  envelope: EventEnvelope,
  customerId: string,
  entityId: string,
): RawRevenueEvent {
  return {
    id: envelope.idempotencyKey,
    entityType: ENTITY_TYPE_BY_ENVELOPE[envelope.type],
    entityId,
    customerId,
    eventType: EVENT_TYPE_BY_ENVELOPE[envelope.type],
    amount:
      envelope.type === "cart"
        ? envelope.cart.amount
        : envelope.type === "invoice"
          ? envelope.invoice.amount
          : envelope.subscription.amount,
    currency:
      envelope.type === "cart"
        ? envelope.cart.currency
        : envelope.type === "invoice"
          ? envelope.invoice.currency
          : envelope.subscription.currency,
    occurredAt: envelope.occurredAt,
    rawPayload: buildRawPayload(envelope),
  };
}

async function upsertCustomer(envelope: EventEnvelope) {
  return prisma.customer.upsert({
    where: { email: envelope.customer.email },
    update: {
      name: envelope.customer.name,
      ...(envelope.customer.phone ? { phone: envelope.customer.phone } : {}),
    },
    create: {
      name: envelope.customer.name,
      email: envelope.customer.email,
      phone: envelope.customer.phone ?? null,
    },
  });
}

async function upsertEntity(
  envelope: EventEnvelope,
  customerId: string,
): Promise<string> {
  if (envelope.type === "cart") {
    const cart: CartEnvelope = envelope.cart;
    const row = await prisma.cart.upsert({
      where: { id: cart.ref },
      update: { amount: cart.amount, abandonedAt: new Date(cart.abandonedAt) },
      create: {
        id: cart.ref,
        customerId,
        amount: cart.amount,
        abandonedAt: new Date(cart.abandonedAt),
        items: cart.items as unknown as Prisma.InputJsonValue,
      },
    });
    return row.id;
  }
  if (envelope.type === "invoice") {
    const invoice: InvoiceEnvelope = envelope.invoice;
    const row = await prisma.invoice.upsert({
      where: { id: invoice.ref },
      update: {
        amount: invoice.amount,
        dueDate: new Date(invoice.dueDate),
        disputeFlag: invoice.disputeFlag,
      },
      create: {
        id: invoice.ref,
        customerId,
        amount: invoice.amount,
        dueDate: new Date(invoice.dueDate),
        disputeFlag: invoice.disputeFlag,
        status: "open",
      },
    });
    return row.id;
  }
  const subscription: SubscriptionEnvelope = envelope.subscription;
  const row = await prisma.subscription.upsert({
    where: { id: subscription.ref },
    update: { mrr: subscription.amount, nextBillDate: new Date(subscription.nextBillDate) },
    create: {
      id: subscription.ref,
      customerId,
      mrr: subscription.amount,
      nextBillDate: new Date(subscription.nextBillDate),
      status: "active",
    },
  });
  return row.id;
}

/**
 * Unified ingestion point for all partner revenue-leakage events.
 *
 * Contract, in order:
 *  1. Validate the envelope (typed field-level errors on failure).
 *  2. Idempotency: a replayed idempotencyKey with an identical core fingerprint
 *     returns the original outcome (safe partner retry); with a different
 *     fingerprint it is a key-reuse bug and rejected.
 *  3. Upsert the customer (by email) and the entity (partner ref as row ID).
 *  4. Publish the normalized RawRevenueEvent onto revenue.events.raw — the
 *     downstream pipeline (enrich → diagnose → decide → execute → audit) is
 *     unchanged and type-agnostic.
 */
export async function ingestPartnerEvent(body: unknown): Promise<IngestResult> {
  const validation: EnvelopeValidationResult = validateEnvelope(body);
  if (!validation.valid) {
    throw new IngestError(
      "Event envelope failed validation.",
      "INVALID_ENVELOPE",
      validation.errors,
    );
  }
  const envelope = validation.envelope;

  const provisionalCustomer = envelope.customer;
  const incomingFingerprint: IngestFingerprint = {
    type: envelope.type,
    entityRef:
      envelope.type === "cart"
        ? envelope.cart.ref
        : envelope.type === "invoice"
          ? envelope.invoice.ref
          : envelope.subscription.ref,
    amount:
      envelope.type === "cart"
        ? envelope.cart.amount
        : envelope.type === "invoice"
          ? envelope.invoice.amount
          : envelope.subscription.amount,
    customerEmail: provisionalCustomer.email,
  };

  let replayed: { fingerprint: IngestFingerprint; result: IngestResult } | null = null;
  try {
    const stored = await redis.get(`${INGEST_DEDUP_PREFIX}${envelope.idempotencyKey}`);
    if (stored) {
      replayed = JSON.parse(stored);
    }
  } catch (err) {
    console.error("[ingest] Redis idempotency check failed; continuing without it:", err);
  }

  if (replayed) {
    if (!fingerprintMatches(replayed.fingerprint, incomingFingerprint)) {
      throw new IngestError(
        `Idempotency key "${envelope.idempotencyKey}" was already used for a different event.`,
        "DUPLICATE_EVENT_CONFLICT",
      );
    }
    return { ...replayed.result, deduped: true };
  }

  const customer = await upsertCustomer(envelope);
  const entityId = await upsertEntity(envelope, customer.id);
  const rawEvent = toRawRevenueEvent(envelope, customer.id, entityId);
  const eventType = rawEvent.eventType;

  const ingestResult: IngestResult = {
    eventId: rawEvent.id,
    entityId,
    customerId: customer.id,
    eventType,
    deduped: false,
  };

  const marker = {
    fingerprint: incomingFingerprint,
    result: ingestResult,
  };
  try {
    await redis.set(
      `${INGEST_DEDUP_PREFIX}${envelope.idempotencyKey}`,
      JSON.stringify(marker),
      "EX",
      INGEST_DEDUP_TTL_SECONDS,
      "NX",
    );
  } catch (err) {
    console.error("[ingest] Failed to persist idempotency marker:", err);
  }

  try {
    await publish(TOPICS.EVENTS_RAW, rawEvent.id, rawEvent);
  } catch (publishError) {
    console.error(
      `[ingest] Failed to publish event ${rawEvent.id} to ${TOPICS.EVENTS_RAW}:`,
      publishError,
    );
    throw new IngestError(
      "Event was ingested but could not be queued for processing.",
      "INGEST_PUBLISH_FAILED",
      publishError,
    );
  }

  return ingestResult;
}
