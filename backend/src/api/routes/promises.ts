import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../config/prisma";
import * as razorpayIntegration from "../../integrations/razorpayIntegration";
import * as emailIntegration from "../../integrations/emailIntegration";
import {
  buildPromiseConfirmationEmail,
  buildPromiseReminderEmail,
} from "../../domain/emailTemplates";
import { listLookupCustomers } from "../../services/customerService";
import { writeLedgerEntry } from "../../services/ledgerService";
import { parsePagination, paginatedResponse } from "../../utils/pagination";
import { handleRouteError } from "../../utils/apiResponse";
import { emitLiveUpdate } from "../websocket";

export const promisesRouter = Router();

function formatPromiseToPay(p: {
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
}) {
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

promisesRouter.get("/stats", async (_req: Request, res: Response) => {
  try {
    const [allPromises, keptPromises] = await Promise.all([
      prisma.promiseToPay.findMany({
        select: { status: true, promisedAmount: true },
      }),
      prisma.promiseToPay.findMany({
        where: { status: "kept" },
        select: { promisedAmount: true },
      }),
    ]);

    const totalCount = allPromises.length;
    const pendingCount = allPromises.filter((p) => p.status === "pending").length;
    const reminderSentCount = allPromises.filter((p) => p.status === "reminder_sent").length;
    const keptCount = allPromises.filter((p) => p.status === "kept").length;
    const brokenCount = allPromises.filter((p) => p.status === "broken").length;
    const totalPromisedAmount = allPromises.reduce((sum, p) => sum + p.promisedAmount, 0);
    const totalRecoveredAmount = keptPromises.reduce((sum, p) => sum + p.promisedAmount, 0);

    return res.status(200).json({
      totalCount,
      pendingCount,
      reminderSentCount,
      keptCount,
      brokenCount,
      totalPromisedAmount,
      totalRecoveredAmount,
    });
  } catch (error) {
    return handleRouteError(res, error, "Failed to fetch promise statistics");
  }
});

promisesRouter.get("/customers", async (_req: Request, res: Response) => {
  try {
    const customers = await listLookupCustomers();
    return res.status(200).json(customers);
  } catch (error) {
    return handleRouteError(res, error, "Failed to fetch customers list");
  }
});

promisesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { status, customerId, entityId, search } = req.query;
    const pagination = parsePagination(req.query);
    const { skip, limit } = pagination;

    const where: any = {};

    if (status && typeof status === "string" && status !== "all") {
      where.status = status;
    }

    if (customerId && typeof customerId === "string") {
      where.customerId = customerId;
    }

    if (entityId && typeof entityId === "string") {
      where.entityId = entityId;
    }

    if (search && typeof search === "string") {
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

    const formatted = items.map(formatPromiseToPay);

    return res.status(200).json(paginatedResponse(formatted, total, pagination));
  } catch (error) {
    return handleRouteError(res, error, "Failed to list promises");
  }
});

promisesRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { customerId, entityId, amount, promisedDate, notes, sendEmail } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: "Customer ID is required." });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "A valid positive amount is required." });
    }

    if (!promisedDate) {
      return res.status(400).json({ error: "Promised due date is required." });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
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

      await prisma.entityWorkflowState.upsert({
        where: { entityId: resolvedEntityId },
        create: {
          entityId: resolvedEntityId,
          customerId: customer.id,
          state: "CONTACTED",
          attemptCount: 1,
          lastContactedAt: new Date(),
        },
        update: {
          state: "CONTACTED",
          lastContactedAt: new Date(),
        },
      });
    }

    let paymentLinkUrl: string | null = null;
    let paymentLinkId: string | null = null;

    try {
      const linkResult = await razorpayIntegration.createRecoveryPaymentLink({
        amount: numericAmount,
        currency: "INR",
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone ?? undefined,
        description: `Promise to Pay commitment — ${resolvedEntityId}`,
        notify: false,
        eventId: eventId ?? resolvedEntityId,
        actionType: "promise_to_pay_link",
      });
      paymentLinkUrl = linkResult.paymentLinkShortUrl ?? null;
      paymentLinkId = linkResult.razorpayPaymentLinkId ?? null;
    } catch (linkErr) {
      console.warn("[promisesRouter] Could not generate Razorpay payment link:", linkErr);
    }

    const dueDate = new Date(promisedDate);

    const record = await prisma.promiseToPay.create({
      data: {
        entityId: resolvedEntityId,
        customerId: customer.id,
        eventId: eventId ?? null,
        promisedAmount: numericAmount,
        currency: "INR",
        promisedDate: dueDate,
        status: "pending",
        razorpayPaymentLinkId: paymentLinkId,
        paymentLinkUrl: paymentLinkUrl,
        notes: notes || undefined,
      },
      include: {
        customer: true,
      },
    });

    if (sendEmail) {
      try {
        const { subject, html } = buildPromiseConfirmationEmail({
          customerName: customer.name,
          amount: numericAmount,
          promisedDate: dueDate,
          paymentUrl: paymentLinkUrl ?? undefined,
        });

        await emailIntegration.sendRecoveryEmail({
          to: customer.email,
          subject,
          html,
        });
        console.log(`[promisesRouter] Sent confirmation email to ${customer.email}`);
      } catch (emailErr) {
        console.error("[promisesRouter] Failed to send promise confirmation email:", emailErr);
      }
    }

    await emitLiveUpdate(resolvedEntityId);

    return res.status(201).json(formatPromiseToPay(record));
  } catch (error) {
    return handleRouteError(res, error, "Failed to create promise to pay");
  }
});

promisesRouter.post("/:id/send-reminder", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const promise = await prisma.promiseToPay.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!promise) {
      return res.status(404).json({ error: "Promise not found." });
    }

    const now = new Date();
    const gracePeriodUntil = new Date(now.getTime() + 24 * 3600 * 1000);

    const updated = await prisma.promiseToPay.update({
      where: { id },
      data: {
        status: "reminder_sent",
        reminderSentAt: now,
        gracePeriodUntil,
      },
      include: { customer: true },
    });

    const { subject, html } = buildPromiseReminderEmail({
      customerName: promise.customer.name,
      amount: promise.promisedAmount,
      promisedDate: promise.promisedDate,
      paymentUrl: promise.paymentLinkUrl ?? undefined,
    });

    await emailIntegration.sendRecoveryEmail({
      to: promise.customer.email,
      subject,
      html,
    });

    await emitLiveUpdate(promise.entityId);

    return res.status(200).json({
      message: "Reminder email sent successfully.",
      promise: formatPromiseToPay(updated),
    });
  } catch (error) {
    return handleRouteError(res, error, "Failed to send reminder email");
  }
});

promisesRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { status, notes, promisedDate } = req.body;

    const data: any = {};
    if (status) data.status = status;
    if (notes !== undefined) data.notes = notes;
    if (promisedDate) data.promisedDate = new Date(promisedDate);

    const updated = await prisma.promiseToPay.update({
      where: { id },
      data,
      include: { customer: true },
    });

    await emitLiveUpdate(updated.entityId);

    return res.status(200).json(formatPromiseToPay(updated));
  } catch (error) {
    return handleRouteError(res, error, "Failed to update promise");
  }
});
