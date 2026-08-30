import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../config/prisma";
import * as razorpayIntegration from "../../integrations/razorpayIntegration";
import * as emailIntegration from "../../integrations/emailIntegration";
import { buildEmailTemplate } from "../../services/executorService";
import { emitLiveUpdate } from "../websocket";

export const promisesRouter = Router();

// GET /promises/stats — summary metrics for Promise-to-Pay dashboard
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
    console.error("[promisesRouter] Failed to fetch promise stats:", error);
    return res.status(500).json({ error: "Failed to fetch promise statistics" });
  }
});

// GET /promises/customers — helper list of customers for creation dropdown
promisesRouter.get("/customers", async (_req: Request, res: Response) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        riskTier: true,
        dncFlag: true,
      },
    });

    return res.status(200).json(customers);
  } catch (error) {
    console.error("[promisesRouter] Failed to fetch customers list:", error);
    return res.status(500).json({ error: "Failed to fetch customers list" });
  }
});

// GET /promises — list promises with filters & pagination
promisesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { status, customerId, entityId, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

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

    const formatted = items.map((p) => {
      const now = Date.now();
      const promisedTime = new Date(p.promisedDate).getTime();
      const msRemaining = promisedTime - now;

      return {
        id: p.id,
        entityId: p.entityId,
        customerId: p.customerId,
        customerName: p.customer.name,
        customerEmail: p.customer.email,
        customerPhone: p.customer.phone,
        promisedAmount: p.promisedAmount,
        currency: p.currency,
        promisedDate: p.promisedDate.toISOString(),
        status: p.status,
        reminderSentAt: p.reminderSentAt?.toISOString() ?? null,
        gracePeriodUntil: p.gracePeriodUntil?.toISOString() ?? null,
        razorpayPaymentLinkId: p.razorpayPaymentLinkId,
        paymentLinkUrl: p.paymentLinkUrl,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        msRemaining,
        isOverdue: msRemaining < 0 && (p.status === "pending" || p.status === "reminder_sent"),
      };
    });

    return res.status(200).json({
      items: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error("[promisesRouter] Failed to list promises:", error);
    return res.status(500).json({ error: "Failed to list promises" });
  }
});

// POST /promises — create new Promise to Pay commitment
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
      return res.status(400).json({ error: "Promised date is required." });
    }

    const parsedDate = new Date(promisedDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: "Invalid promised date format." });
    }

    if (notes && typeof notes === "string" && notes.length > 500) {
      return res.status(400).json({ error: "Notes cannot exceed 500 characters." });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    // Resolve or generate independent Promise-to-Pay entityId
    const resolvedEntityId = entityId || `ptp_${crypto.randomUUID().slice(0, 12)}`;

    // Generate recovery payment link via razorpayIntegration
    let paymentLinkUrl: string | undefined;
    let razorpayPaymentLinkId: string | undefined;

    try {
      const linkResult = await razorpayIntegration.createRecoveryPaymentLink({
        amount: numericAmount,
        currency: "INR",
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone ?? undefined,
        description: `Promise-to-Pay for Invoice #${resolvedEntityId.slice(-6)}`,
        notify: false, // We send our own styled email
      });
      paymentLinkUrl = linkResult.paymentLinkShortUrl;
      razorpayPaymentLinkId = linkResult.razorpayPaymentLinkId;
    } catch (err) {
      console.warn("[promisesRouter] Razorpay link creation warning, continuing:", err);
    }

    // Save PromiseToPay in database
    const record = await prisma.promiseToPay.create({
      data: {
        entityId: resolvedEntityId,
        customerId: customer.id,
        promisedAmount: numericAmount,
        currency: "INR",
        promisedDate: parsedDate,
        status: "pending",
        razorpayPaymentLinkId,
        paymentLinkUrl,
        notes: notes || `Promise-to-Pay registered for ₹${numericAmount} due by ${parsedDate.toISOString().split("T")[0]}.`,
      },
      include: {
        customer: true,
      },
    });

    // Send confirmation email
    if (sendEmail !== false) {
      const formattedDate = parsedDate.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      const subject = `Promise-to-Pay Commitment Confirmation: ₹${numericAmount} due by ${formattedDate}`;
      const html = buildEmailTemplate([
        `Hi ${customer.name},`,
        `Thank you for confirming your commitment to pay. We have recorded your promise to settle ₹${numericAmount} on or before <strong>${formattedDate}</strong>.`,
        `You can complete your payment securely anytime before the due date using the button below:`,
        `If you have any questions or require an adjustment to your schedule, please feel free to reply to this email.`,
      ], numericAmount, paymentLinkUrl);

      try {
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

    return res.status(201).json(record);
  } catch (error) {
    console.error("[promisesRouter] Failed to create promise:", error);
    return res.status(500).json({ error: "Failed to create promise to pay" });
  }
});

// POST /promises/:id/send-reminder — manually trigger follow-up reminder email
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

    const formattedDate = promise.promisedDate.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const subject = `Urgent Follow-Up: Pending Promise-to-Pay for ₹${promise.promisedAmount}`;
    const html = buildEmailTemplate([
      `Hi ${promise.customer.name},`,
      `This is a follow-up regarding your agreed Promise-to-Pay commitment of ₹${promise.promisedAmount}, which was due on <strong>${formattedDate}</strong>.`,
      `Our records show that this payment has not yet been completed. Please use the button below to settle the outstanding balance immediately:`,
      `If you need assistance or have already made this payment, please contact us right away.`,
    ], promise.promisedAmount, promise.paymentLinkUrl ?? undefined);

    await emailIntegration.sendRecoveryEmail({
      to: promise.customer.email,
      subject,
      html,
    });

    await emitLiveUpdate(promise.entityId);

    return res.status(200).json({
      message: "Reminder email sent successfully.",
      promise: updated,
    });
  } catch (error) {
    console.error("[promisesRouter] Failed to send reminder email:", error);
    return res.status(500).json({ error: "Failed to send reminder email" });
  }
});

// PATCH /promises/:id — update notes or status
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

    return res.status(200).json(updated);
  } catch (error) {
    console.error("[promisesRouter] Failed to update promise:", error);
    return res.status(500).json({ error: "Failed to update promise" });
  }
});
