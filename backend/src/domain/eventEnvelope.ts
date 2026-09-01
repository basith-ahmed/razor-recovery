/**
 * Partner ingestion envelope — the single, versioned contract through which
 * every connected system (cart service, invoice service, subscription service)
 * reports revenue leakage to the recovery engine.
 *
 * Pure types + pure validation. No I/O — the ingest service owns persistence
 * and publishing; the API route owns HTTP semantics and auth.
 */

export const ENVELOPE_API_VERSION = "1";

export type PartnerEntityType = "cart" | "invoice" | "subscription";

export interface PartnerCustomer {
  ref?: string;
  name: string;
  email: string;
  phone?: string;
}

export interface CartEnvelope {
  ref: string;
  amount: number;
  currency: string;
  abandonedAt: string;
  items: PartnerCartItem[];
}

export interface PartnerCartItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceEnvelope {
  ref: string;
  amount: number;
  currency: string;
  dueDate: string;
  disputeFlag: boolean;
}

export const MANDATE_STATUSES = [
  "cancelled",
  "halted",
  "revoked",
  "expired",
  "paused",
] as const;

export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export interface SubscriptionEnvelope {
  ref: string;
  amount: number;
  currency: string;
  mandateStatus: MandateStatus;
  mandateRef: string;
  nextBillDate: string;
}

export type EventEnvelope =
  | (EnvelopeBase & { type: "cart"; cart: CartEnvelope })
  | (EnvelopeBase & { type: "invoice"; invoice: InvoiceEnvelope })
  | (EnvelopeBase & { type: "subscription"; subscription: SubscriptionEnvelope });

export interface EnvelopeBase {
  apiVersion: string;
  type: PartnerEntityType;
  idempotencyKey: string;
  occurredAt: string;
  customer: PartnerCustomer;
}

export interface EnvelopeFieldError {
  field: string;
  message: string;
}

export type EnvelopeValidationResult =
  | { valid: true; envelope: EventEnvelope }
  | { valid: false; errors: EnvelopeFieldError[] };

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const REF_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
/** UMN-style mandate references legitimately contain "@" (e.g. rzp.XXXX@bankpsp). */
const MANDATE_REF_PATTERN = /^[A-Za-z0-9_.:@-]{1,128}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AMOUNT = 100_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function isPositiveAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_AMOUNT
  );
}

function currencyIsValid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function validateEnvelopeBase(
  body: Record<string, unknown>,
  errors: EnvelopeFieldError[],
): void {
  if (body.apiVersion !== ENVELOPE_API_VERSION) {
    errors.push({
      field: "apiVersion",
      message: `Unsupported apiVersion. Expected "${ENVELOPE_API_VERSION}".`,
    });
  }
  if (!isNonEmptyString(body.idempotencyKey)) {
    errors.push({ field: "idempotencyKey", message: "A non-empty idempotencyKey is required." });
  } else if (body.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    errors.push({
      field: "idempotencyKey",
      message: `idempotencyKey must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
    });
  } else if (!REF_PATTERN.test(body.idempotencyKey)) {
    errors.push({
      field: "idempotencyKey",
      message: "idempotencyKey may only contain letters, digits and _ . : - characters.",
    });
  }
  if (!isIsoDateString(body.occurredAt)) {
    errors.push({ field: "occurredAt", message: "occurredAt must be an ISO 8601 timestamp." });
  }

  const customer = body.customer;
  if (!isRecord(customer)) {
    errors.push({ field: "customer", message: "A customer object is required." });
    return;
  }
  if (!isNonEmptyString(customer.name)) {
    errors.push({ field: "customer.name", message: "customer.name is required." });
  }
  if (!isNonEmptyString(customer.email) || !EMAIL_PATTERN.test(customer.email)) {
    errors.push({ field: "customer.email", message: "A valid customer.email is required." });
  }
  if (customer.phone !== undefined && !isNonEmptyString(customer.phone)) {
    errors.push({ field: "customer.phone", message: "customer.phone must be a non-empty string." });
  }
  if (customer.ref !== undefined && !isNonEmptyString(customer.ref)) {
    errors.push({ field: "customer.ref", message: "customer.ref must be a non-empty string." });
  }
}

function validateRef(value: unknown, field: string, errors: EnvelopeFieldError[]): value is string {
  if (!isNonEmptyString(value) || !REF_PATTERN.test(value)) {
    errors.push({
      field,
      message: "ref is required and may only contain letters, digits and _ . : - characters.",
    });
    return false;
  }
  return true;
}

function validateCart(cart: unknown, errors: EnvelopeFieldError[]): CartEnvelope | undefined {
  if (!isRecord(cart)) {
    errors.push({ field: "cart", message: "A cart object is required when type is \"cart\"." });
    return undefined;
  }
  if (!validateRef(cart.ref, "cart.ref", errors)) return undefined;
  if (!isPositiveAmount(cart.amount)) {
    errors.push({ field: "cart.amount", message: "cart.amount must be a positive number." });
  }
  if (!currencyIsValid(cart.currency)) {
    errors.push({ field: "cart.currency", message: "cart.currency must be a 3-letter ISO code (e.g. INR)." });
  }
  if (!isIsoDateString(cart.abandonedAt)) {
    errors.push({ field: "cart.abandonedAt", message: "cart.abandonedAt must be an ISO 8601 timestamp." });
  }
  const items = cart.items;
  if (!Array.isArray(items) || items.length === 0) {
    errors.push({ field: "cart.items", message: "cart.items must be a non-empty array." });
    return undefined;
  }
  const validatedItems: PartnerCartItem[] = [];
  items.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push({ field: `cart.items[${index}]`, message: "Each item must be an object." });
      return;
    }
    if (!isNonEmptyString(item.sku) || !REF_PATTERN.test(item.sku)) {
      errors.push({ field: `cart.items[${index}].sku`, message: "item.sku is required and must be a valid ref." });
    }
    if (!isNonEmptyString(item.name)) {
      errors.push({ field: `cart.items[${index}].name`, message: "item.name is required." });
    }
    if (
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      errors.push({ field: `cart.items[${index}].quantity`, message: "item.quantity must be a positive integer." });
    }
    if (!isPositiveAmount(item.unitPrice)) {
      errors.push({ field: `cart.items[${index}].unitPrice`, message: "item.unitPrice must be a positive number." });
    }
    validatedItems.push(item as unknown as PartnerCartItem);
  });
  if (errors.length > 0) return undefined;

  return {
    ref: cart.ref as string,
    amount: cart.amount as number,
    currency: cart.currency as string,
    abandonedAt: cart.abandonedAt as string,
    items: validatedItems,
  };
}

function validateInvoice(
  invoice: unknown,
  errors: EnvelopeFieldError[],
): InvoiceEnvelope | undefined {
  if (!isRecord(invoice)) {
    errors.push({ field: "invoice", message: "An invoice object is required when type is \"invoice\"." });
    return undefined;
  }
  if (!validateRef(invoice.ref, "invoice.ref", errors)) return undefined;
  if (!isPositiveAmount(invoice.amount)) {
    errors.push({ field: "invoice.amount", message: "invoice.amount must be a positive number." });
  }
  if (!currencyIsValid(invoice.currency)) {
    errors.push({ field: "invoice.currency", message: "invoice.currency must be a 3-letter ISO code (e.g. INR)." });
  }
  if (!isIsoDateString(invoice.dueDate)) {
    errors.push({ field: "invoice.dueDate", message: "invoice.dueDate must be an ISO 8601 timestamp." });
  }
  if (typeof invoice.disputeFlag !== "boolean") {
    errors.push({ field: "invoice.disputeFlag", message: "invoice.disputeFlag must be a boolean." });
  }
  if (errors.length > 0) return undefined;

  return {
    ref: invoice.ref as string,
    amount: invoice.amount as number,
    currency: invoice.currency as string,
    dueDate: invoice.dueDate as string,
    disputeFlag: invoice.disputeFlag as boolean,
  };
}

function validateSubscription(
  subscription: unknown,
  errors: EnvelopeFieldError[],
): SubscriptionEnvelope | undefined {
  if (!isRecord(subscription)) {
    errors.push({
      field: "subscription",
      message: "A subscription object is required when type is \"subscription\".",
    });
    return undefined;
  }
  if (!validateRef(subscription.ref, "subscription.ref", errors)) return undefined;
  if (!isPositiveAmount(subscription.amount)) {
    errors.push({ field: "subscription.amount", message: "subscription.amount must be a positive number." });
  }
  if (!currencyIsValid(subscription.currency)) {
    errors.push({
      field: "subscription.currency",
      message: "subscription.currency must be a 3-letter ISO code (e.g. INR).",
    });
  }
  if (!isNonEmptyString(subscription.mandateStatus) || !MANDATE_STATUSES.includes(subscription.mandateStatus as MandateStatus)) {
    errors.push({
      field: "subscription.mandateStatus",
      message: `subscription.mandateStatus must be one of: ${MANDATE_STATUSES.join(", ")}.`,
    });
  }
  if (!isNonEmptyString(subscription.mandateRef) || !MANDATE_REF_PATTERN.test(subscription.mandateRef)) {
    errors.push({
      field: "subscription.mandateRef",
      message: "mandateRef is required and must be a valid mandate reference.",
    });
    return undefined;
  }
  if (!isIsoDateString(subscription.nextBillDate)) {
    errors.push({
      field: "subscription.nextBillDate",
      message: "subscription.nextBillDate must be an ISO 8601 timestamp.",
    });
  }
  if (errors.length > 0) return undefined;

  return {
    ref: subscription.ref as string,
    amount: subscription.amount as number,
    currency: subscription.currency as string,
    mandateStatus: subscription.mandateStatus as MandateStatus,
    mandateRef: subscription.mandateRef as string,
    nextBillDate: subscription.nextBillDate as string,
  };
}

/**
 * Validates an untyped request body against the envelope contract.
 * Pure: returns either the typed envelope or precise field-level errors.
 */
export function validateEnvelope(body: unknown): EnvelopeValidationResult {
  const errors: EnvelopeFieldError[] = [];
  if (!isRecord(body)) {
    return { valid: false, errors: [{ field: "body", message: "Request body must be a JSON object." }] };
  }

  validateEnvelopeBase(body, errors);

  if (body.type !== "cart" && body.type !== "invoice" && body.type !== "subscription") {
    errors.push({
      field: "type",
      message: 'type must be one of: "cart", "invoice", "subscription".',
    });
    return { valid: false, errors };
  }

  if (body.type === "cart") {
    const cart = validateCart(body.cart, errors);
    if (errors.length > 0 || !cart) return { valid: false, errors };
    return {
      valid: true,
      envelope: {
        apiVersion: body.apiVersion as string,
        type: "cart",
        idempotencyKey: body.idempotencyKey as string,
        occurredAt: body.occurredAt as string,
        customer: body.customer as unknown as PartnerCustomer,
        cart,
      },
    };
  }

  if (body.type === "invoice") {
    const invoice = validateInvoice(body.invoice, errors);
    if (errors.length > 0 || !invoice) return { valid: false, errors };
    return {
      valid: true,
      envelope: {
        apiVersion: body.apiVersion as string,
        type: "invoice",
        idempotencyKey: body.idempotencyKey as string,
        occurredAt: body.occurredAt as string,
        customer: body.customer as unknown as PartnerCustomer,
        invoice,
      },
    };
  }

  const subscription = validateSubscription(body.subscription, errors);
  if (errors.length > 0 || !subscription) return { valid: false, errors };
  return {
    valid: true,
    envelope: {
      apiVersion: body.apiVersion as string,
      type: "subscription",
      idempotencyKey: body.idempotencyKey as string,
      occurredAt: body.occurredAt as string,
      customer: body.customer as unknown as PartnerCustomer,
      subscription,
    },
  };
}
