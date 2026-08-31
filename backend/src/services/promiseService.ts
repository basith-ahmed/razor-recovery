import crypto from "crypto";
import { prisma } from "../config/prisma";
import * as razorpayIntegration from "../integrations/razorpayIntegration";
import * as emailIntegration from "../integrations/emailIntegration";
import {
  buildPromiseConfirmationEmail,
  buildPromiseReminderEmail,
} from "../domain/emailTemplates";
import { writeLedgerEntry } from "./ledgerService";
import { writeChainedAuditEntry } from "./auditService";
import { getOrCreatePaymentLink } from "./paymentLinkService";
import {
  DomainError,
  FormattedPromiseToPay,
  PromiseStats,
  ListPromisesParams,
  CreatePromiseInput,
} from "../domain/types";
import { emitLiveUpdate } from "../api/websocket";

export { FormattedPromiseToPay, PromiseStats, ListPromisesParams, CreatePromiseInput };

export function formatPromiseToPay(p: {
  id: string;
  entityId: string;
  customerId: string;
  promisedAmount: number;
  currency: string;
  promisedDate: Date | string;
  status: string;
  reminderSentAt?: Date | string | null;
  gracePeriodUntil?: Date | string | null;
  razorpayPaymentLinkId?: string | null;
  paymentLinkUrl?: string | null;
  notes?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
}): FormattedPromiseToPay {
  const promisedDateObj = p.promisedDate instanceof Date ? p.promisedDate : new Date(p.promisedDate);
  const targetDateObj =
    p.status === "reminder_sent" && p.gracePeriodUntil
      ? p.gracePeriodUntil instanceof Date
        ? p.gracePeriodUntil
        : new Date(p.gracePeriodUntil)
      : promisedDateObj;
  const msRemaining = targetDateObj.getTime() - Date.now();

  return {
    id: p.id,
    entityId: p.entityId,
    customerId: p.customerId,
    customerName: p.customer?.name ?? "",
    customerEmail: p.customer?.email ?? "",
    customerPhone: p.customer?.phone ?? null,
    promisedAmount: p.promisedAmount,
    currency: p.currency,
    promisedDate: promisedDateObj.toISOString(),
    status: p.status,
    reminderSentAt: p.reminderSentAt
      ? (p.reminderSentAt instanceof Date ? p.reminderSentAt.toISOString() : new Date(p.reminderSentAt).toISOString())
      : null,
    gracePeriodUntil: p.gracePeriodUntil
      ? (p.gracePeriodUntil instanceof Date ? p.gracePeriodUntil.toISOString() : new Date(p.gracePeriodUntil).toISOString())
      : null,
    razorpayPaymentLinkId: p.razorpayPaymentLinkId ?? null,
    paymentLinkUrl: p.paymentLinkUrl ?? null,
    notes: p.notes ?? null,
    createdAt: (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)).toISOString(),
    updatedAt: (p.updatedAt instanceof Date ? p.updatedAt : new Date(p.updatedAt)).toISOString(),
    msRemaining,
    isOverdue: msRemaining < 0 && (p.status === "pending" || p.status === "reminder_sent"),
  };
}

export async function getPromise(id: string): Promise<FormattedPromiseToPay> {
  const promise = await prisma.promiseToPay.findUnique({
    where: { id },
    include: {
      customer: true,
      event: {
        select: {
          id: true,
          eventType: true,
          amount: true,
          occurredAt: true,
        },
      },
    },
  });

  if (!promise) {
    throw new DomainError("Promise-to-Pay record not found.", "PROMISE_NOT_FOUND");
  }

  return formatPromiseToPay(promise);
}

export async function getPromiseStats(): Promise<PromiseStats> {
  const [allPromises, keptPromises] = await Promise.all([
    prisma.promiseToPay.findMany({
      select: { status: true, promisedAmount: true },
    }),
    prisma.promiseToPay.findMany({
      where: { status: "kept" },
      select: { promisedAmount: true },
    }),
  ]);

  return {
    totalCount: allPromises.length,
    pendingCount: allPromises.filter((p) => p.status === "pending").length,
    reminderSentCount: allPromises.filter((p) => p.status === "reminder_sent").length,
    keptCount: allPromises.filter((p) => p.status === "kept").length,
    brokenCount: allPromises.filter((p) => p.status === "broken").length,
    totalPromisedAmount: allPromises.reduce((sum, p) => sum + p.promisedAmount, 0),
    totalRecoveredAmount: keptPromises.reduce((sum, p) => sum + p.promisedAmount, 0),
  };
}

export async function listPromises(params: ListPromisesParams) {
  const { status, customerId, entityId, search, skip = 0, limit = 20 } = params;

  const where: any = {};

  if (status && status !== "all") {
    where.status = status;
  }
  if (customerId) {
    where.customerId = customerId;
  }
  if (entityId) {
    where.entityId = entityId;
  }
  if (search) {
    const q = search.trim();
    where.OR = [
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
      { entityId: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.promiseToPay.count({ where }),
    prisma.promiseToPay.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        customer: true,
        event: {
          select: {
            id: true,
            eventType: true,
            amount: true,
            occurredAt: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    items: items.map(formatPromiseToPay),
  };
}

export async function createPromise(input: CreatePromiseInput): Promise<FormattedPromiseToPay> {
  const { customerId, entityId, amount, promisedDate, notes, sendEmail } = input;

  if (!customerId) {
    throw new DomainError("Customer ID is required.", "MISSING_CUSTOMER_ID");
  }

  const numericAmount = typeof amount === "number" ? amount : parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new DomainError("A valid positive amount is required.", "INVALID_AMOUNT");
  }

  if (!promisedDate) {
    throw new DomainError("Promised due date is required.", "MISSING_PROMISED_DATE");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new DomainError("Customer not found.", "CUSTOMER_NOT_FOUND");
  }

  let resolvedEntityId = entityId;
  let eventId: string | null = null;

  if (resolvedEntityId) {
    const existingEvent = await prisma.revenueEvent.findFirst({
      where: { entityId: resolvedEntityId },
      orderBy: { occurredAt: "desc" },
    });
    if (existingEvent) {
      eventId = existingEvent.id;
    }
  } else {
    resolvedEntityId = `ptp_${crypto.randomUUID().slice(0, 8)}`;
  }

  const dueDate = new Date(promisedDate);

  if (!eventId) {
    const newEvent = await prisma.revenueEvent.create({
      data: {
        entityId: resolvedEntityId,
        entityType: "INVOICE",
        eventType: "INVOICE_OVERDUE",
        customerId: customer.id,
        amount: numericAmount,
        currency: "INR",
        occurredAt: new Date(),
        errorCode: "PROMISE_CREATED",
        errorReason: "promise_to_pay",
        rawPayload: {
          promise: true,
          notes: notes || undefined,
          promisedDate,
        },
      },
    });
    eventId = newEvent.id;

    await writeLedgerEntry(prisma, {
      entityId: resolvedEntityId,
      eventId: newEvent.id,
      type: "AT_RISK",
      amount: numericAmount,
      currency: "INR",
      referenceId: resolvedEntityId,
    });
  }

  // Set entity workflow state into COOLING_DOWN until the promised payment date
  await prisma.entityWorkflowState.upsert({
    where: { entityId: resolvedEntityId },
    create: {
      entityId: resolvedEntityId,
      customerId: customer.id,
      state: "COOLING_DOWN",
      attemptCount: 1,
      lastContactedAt: new Date(),
      cooldownUntil: dueDate,
    },
    update: {
      state: "COOLING_DOWN",
      lastContactedAt: new Date(),
      cooldownUntil: dueDate,
    },
  });

  // Also set cause-level cooldowns to match promise due date
  await prisma.entityCauseState.updateMany({
    where: { entityId: resolvedEntityId },
    data: {
      cooldownUntil: dueDate,
      lastContactedAt: new Date(),
    },
  });

  // Record cryptographic audit entry for promise-to-pay conversion & cooldown
  if (eventId) {
    try {
      await prisma.$transaction(async (tx) => {
        await writeChainedAuditEntry(tx, {
          eventId: eventId!,
          entityId: resolvedEntityId,
          actor: "promise_service",
          inputSnapshot: {
            promiseToPay: true,
            promisedAmount: numericAmount,
            promisedDate: dueDate.toISOString(),
            notes: notes || undefined,
          },
          actionSnapshot: {
            actionType: "promise_to_pay_created",
            result: "success",
            detail: `Entity converted to Promise-to-Pay for ₹${numericAmount.toLocaleString("en-IN")} due by ${dueDate.toISOString().split("T")[0]}. Automated outreach in cooldown until promise date.`,
          },
          outcome: "pending",
          timestamp: new Date(),
        });
      });
    } catch (auditErr) {
      console.warn("[promiseService] Could not write chained audit entry for promise:", auditErr);
    }
  }

  let paymentLinkUrl: string | null = null;
  let paymentLinkId: string | null = null;

  // Create PtP record
  const record = await prisma.promiseToPay.create({
    data: {
      entityId: resolvedEntityId,
      customerId: customer.id,
      eventId: eventId ?? null,
      promisedAmount: numericAmount,
      currency: "INR",
      promisedDate: dueDate,
      status: "pending",
      notes: notes || undefined,
    },
    include: { customer: true },
  });

  try {
    const link = await getOrCreatePaymentLink({
      entityId: resolvedEntityId,
      eventId: eventId ?? undefined,
      promiseId: record.id,
      amount: numericAmount,
      currency: "INR",
      customer: { name: customer.name, email: customer.email, phone: customer.phone },
      description: `Promise to Pay commitment — ${resolvedEntityId}`,
      notify: false,
      actionType: "promise_to_pay_link",
    });
    paymentLinkUrl = link.paymentLinkUrl;
    paymentLinkId = link.razorpayPaymentLinkId;

    // Persist link back to the record
    await prisma.promiseToPay.update({
      where: { id: record.id },
      data: {
        razorpayPaymentLinkId: paymentLinkId,
        paymentLinkUrl,
      },
    });
  } catch (linkErr) {
    console.warn("[promiseService] Could not generate Razorpay payment link:", linkErr);
  }

  if (sendEmail) {
    try {
      const { subject, html } = buildPromiseConfirmationEmail({
        customerName: customer.name,
        amount: numericAmount,
        promisedDate: dueDate,
        paymentLinkUrl: paymentLinkUrl ?? undefined,
      });

      await emailIntegration.sendRecoveryEmail({
        to: customer.email,
        subject,
        html,
      });
    } catch (emailErr) {
      console.warn("[promiseService] Failed to send promise confirmation email:", emailErr);
    }
  }

  await emitLiveUpdate(resolvedEntityId);

  return formatPromiseToPay(record);
}

export async function sendPromiseReminderEmail(id: string): Promise<FormattedPromiseToPay> {
  const promise = await prisma.promiseToPay.findUnique({
    where: { id },
    include: { customer: true },
  });

  if (!promise) {
    throw new DomainError("Promise-to-Pay record not found.", "PROMISE_NOT_FOUND");
  }

  const { subject, html } = buildPromiseReminderEmail({
    customerName: promise.customer.name,
    amount: promise.promisedAmount,
    promisedDate: promise.promisedDate,
    paymentLinkUrl: promise.paymentLinkUrl ?? undefined,
  });

  await emailIntegration.sendRecoveryEmail({
    to: promise.customer.email,
    subject,
    html,
  });

  const updated = await prisma.promiseToPay.update({
    where: { id },
    data: {
      status: "reminder_sent",
      reminderSentAt: new Date(),
      gracePeriodUntil: new Date(Date.now() + 24 * 3600 * 1000),
    },
    include: { customer: true },
  });

  await emitLiveUpdate(promise.entityId);

  return formatPromiseToPay(updated);
}

export async function updatePromise(
  id: string,
  data: { status?: string; notes?: string; promisedDate?: string }
): Promise<FormattedPromiseToPay> {
  const existing = await prisma.promiseToPay.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new DomainError("Promise not found.", "PROMISE_NOT_FOUND");
  }

  const updateData: any = {};
  if (data.status) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.promisedDate) updateData.promisedDate = new Date(data.promisedDate);

  const updated = await prisma.promiseToPay.update({
    where: { id },
    data: updateData,
    include: { customer: true },
  });

  await emitLiveUpdate(existing.entityId);

  return formatPromiseToPay(updated);
}
