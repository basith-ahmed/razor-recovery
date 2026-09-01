/**
 * Partner event simulation — builds realistic, partner-shaped ingestion
 * envelopes and pushes them through the real ingestion path
 * (ingestPartnerEvent → revenue.events.raw), exactly like a connected
 * company's cart / invoice / subscription service would.
 *
 * The engine's scope is revenue leakage, not payment failures: partners own
 * their gateways and only report carts left unchecked out, invoices gone
 * overdue, and subscription mandates cancelled or halted.
 */

import { Customer } from "@prisma/client";
import {
  CartEnvelope,
  EnvelopeBase,
  EventEnvelope,
  InvoiceEnvelope,
  MandateStatus,
  PartnerCartItem,
  SubscriptionEnvelope,
} from "../domain/eventEnvelope";
import { IngestResult, ingestPartnerEvent } from "../services/ingestService";

export type SimulationEntityType = "cart" | "invoice" | "subscription";

export interface SimulationOverrides {
  amount?: number;
  /** Invoice: days past the due date. Cart: hours since abandonment. */
  age?: number;
  disputeFlag?: boolean;
  mandateStatus?: MandateStatus;
  /**
   * Fixed partner entity ref. Providing the same ref across calls simulates
   * the partner re-reporting the SAME business object (a new occurrence of an
   * ongoing leak) instead of a fresh one.
   */
  ref?: string;
}

function randomFrom<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

/** Weighted pick: value-weighted ranges for realistic amount distributions. */
function weightedAmount(ranges: Array<{ min: number; max: number; weight: number }>): number {
  const total = ranges.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const range of ranges) {
    roll -= range.weight;
    if (roll <= 0) {
      return Number((range.min + Math.random() * (range.max - range.min)).toFixed(2));
    }
  }
  const last = ranges[ranges.length - 1];
  return Number((last.min + Math.random() * (last.max - last.min)).toFixed(2));
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function shortRef(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function envelopeBase(customer: Customer, type: SimulationEntityType): EnvelopeBase {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return {
    apiVersion: "1",
    type,
    idempotencyKey: `sim_${type}_${id}`,
    occurredAt: new Date().toISOString(),
    customer: {
      ref: customer.id,
      name: customer.name,
      email: customer.email,
      ...(customer.phone ? { phone: customer.phone } : {}),
    },
  };
}

/**
 * Real cart values are heavily skewed small with occasional high-value
 * orders; ~5% of carts cross the policy escalation threshold naturally.
 */
function cartAmount(): number {
  return weightedAmount([
    { min: 350, max: 2500, weight: 65 },
    { min: 2500, max: 6000, weight: 20 },
    { min: 6000, max: 12000, weight: 10 },
    { min: 12000, max: 38000, weight: 5 },
  ]);
}

/** Most carts are abandoned recently; abandonment age decays. */
function abandonedHoursAgo(): number {
  return weightedAmount([
    { min: 2, max: 24, weight: 60 },
    { min: 24, max: 72, weight: 30 },
    { min: 72, max: 120, weight: 10 },
  ]);
}

/**
 * Builds 1-4 cart items whose combined value matches the cart total, so the
 * payload reads like real commerce data instead of a lone placeholder row.
 */
function cartItemsFor(total: number): PartnerCartItem[] {
  const catalog = [
    { sku: "pro-plan-annual", name: "Pro Plan (Annual)", unitPrice: 2499 },
    { sku: "analytics-addon", name: "Analytics Add-on", unitPrice: 899 },
    { sku: "team-seats-5", name: "Team Seats (5)", unitPrice: 1999 },
    { sku: "priority-support", name: "Priority Support", unitPrice: 499 },
    { sku: "data-migration", name: "Data Migration Service", unitPrice: 3500 },
    { sku: "onboarding-consult", name: "Onboarding Consultation", unitPrice: 1200 },
  ];
  const itemCount = Math.min(1 + Math.floor(Math.random() * 4), catalog.length);
  const picks = [...catalog].sort(() => Math.random() - 0.5).slice(0, itemCount);
  const unitTotal = picks.reduce((sum, item) => sum + item.unitPrice, 0);
  if (unitTotal === 0) return picks.map((item) => ({ ...item, quantity: 1 }));

  const items: PartnerCartItem[] = [];
  let assigned = 0;
  picks.forEach((item, index) => {
    const isLast = index === picks.length - 1;
    const share = isLast ? total - assigned : Math.round((total * item.unitPrice) / unitTotal);
    const quantity = Math.max(1, Math.round(share / item.unitPrice));
    assigned += quantity * item.unitPrice;
    items.push({ sku: item.sku, name: item.name, quantity, unitPrice: item.unitPrice });
  });
  return items;
}

export function buildCartEnvelope(
  customer: Customer,
  overrides: SimulationOverrides = {},
): EventEnvelope {
  const amount = overrides.amount ?? cartAmount();
  const abandonedAt = hoursAgo(overrides.age ?? abandonedHoursAgo());
  const cart: CartEnvelope = {
    ref: overrides.ref ?? shortRef("cart_sim"),
    amount,
    currency: "INR",
    abandonedAt: toIso(abandonedAt),
    items: cartItemsFor(amount),
  };
  return { ...envelopeBase(customer, "cart"), type: "cart", cart };
}

/**
 * B2B invoices skew larger than carts; overdue age is weighted so most are
 * recently due with a long tail of aged receivables.
 */
export function buildInvoiceEnvelope(
  customer: Customer,
  overrides: SimulationOverrides = {},
): EventEnvelope {
  const amount =
    overrides.amount ??
    weightedAmount([
      { min: 4500, max: 25000, weight: 55 },
      { min: 25000, max: 75000, weight: 30 },
      { min: 75000, max: 200000, weight: 15 },
    ]);
  const overdueDays = overrides.age ?? weightedAmount([
    { min: 1, max: 7, weight: 50 },
    { min: 8, max: 20, weight: 30 },
    { min: 21, max: 45, weight: 15 },
    { min: 46, max: 90, weight: 5 },
  ]);
  const disputeFlag = overrides.disputeFlag ?? Math.random() < 0.05;
  const invoice: InvoiceEnvelope = {
    ref: overrides.ref ?? shortRef("inv_sim"),
    amount,
    currency: "INR",
    dueDate: toIso(daysAgo(overdueDays)),
    disputeFlag,
  };
  return { ...envelopeBase(customer, "invoice"), type: "invoice", invoice };
}

/**
 * Subscription plans cluster at common price points; cancellations are
 * mostly recent with a smaller aged tail.
 */
export function buildSubscriptionEnvelope(
  customer: Customer,
  overrides: SimulationOverrides = {},
): EventEnvelope {
  const amount =
    overrides.amount ??
    randomFrom([199, 299, 499, 699, 999, 1499, 1999, 2999, 4999, 9999, 14999, 24999]);
  const mandateStatus: MandateStatus =
    overrides.mandateStatus ??
    (randomFrom(["cancelled", "cancelled", "cancelled", "revoked", "expired", "paused", "halted"]) as MandateStatus);
  const subscription: SubscriptionEnvelope = {
    ref: overrides.ref ?? shortRef("sub_sim"),
    amount,
    currency: "INR",
    mandateStatus,
    mandateRef: `rzp.${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}@bankpsp`,
    nextBillDate: toIso(daysAgo(-Math.floor(Math.random() * 20) + 1)),
  };
  return { ...envelopeBase(customer, "subscription"), type: "subscription", subscription };
}

/**
 * Simulates one partner event through the real ingestion path and returns the
 * ingest result (event/entity/customer identifiers) for narrative scripts.
 */
export async function simulatePartnerEvent(
  type: SimulationEntityType,
  customer: Customer,
  overrides: SimulationOverrides = {},
): Promise<IngestResult> {
  const envelope =
    type === "cart"
      ? buildCartEnvelope(customer, overrides)
      : type === "invoice"
        ? buildInvoiceEnvelope(customer, overrides)
        : buildSubscriptionEnvelope(customer, overrides);
  return ingestPartnerEvent(envelope);
}
