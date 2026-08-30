import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { logError } from "../config/logger";
import {
  DomainError,
  ListTicketsParams,
  TicketSummaryDto,
  TicketStatsDto,
  TicketNoteItem,
  TicketDetailResponse,
} from "../domain/types";
import { writeLedgerEntry } from "./ledgerService";
import { createRecoveryPaymentLink } from "../integrations/razorpayIntegration";
import { sendRecoveryEmail } from "../integrations/emailIntegration";
import { buildTicketOutreachEmail } from "../domain/emailTemplates";
import { parsePagination } from "../utils/pagination";

export {
  ListTicketsParams,
  TicketSummaryDto,
  TicketStatsDto,
  TicketNoteItem,
  TicketDetailResponse,
};

export async function listTickets(params: ListTicketsParams = {}) {
  const { page, limit, skip } = parsePagination(params as Record<string, unknown>);

  const where: any = {};
  if (params.status && params.status !== "all") {
    where.status = params.status;
  }

  const [tickets, totalCount] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        _count: {
          select: { notes: true },
        },
      },
    }),
    prisma.ticket.count({ where }),
  ]);

  const entityIds = tickets.map((t) => t.entityId);

  const revenueEvents = await prisma.revenueEvent.findMany({
    where: { entityId: { in: entityIds } },
    orderBy: { occurredAt: "desc" },
    include: {
      customer: true,
      diagnosis: true,
    },
  });

  const eventByEntity = new Map<string, (typeof revenueEvents)[0]>();
  for (const ev of revenueEvents) {
    if (!eventByEntity.has(ev.entityId)) {
      eventByEntity.set(ev.entityId, ev);
    }
  }

  let items: TicketSummaryDto[] = tickets.map((t) => {
    const ev = eventByEntity.get(t.entityId);
    return {
      id: t.id,
      entityId: t.entityId,
      reason: t.reason,
      status: t.status,
      priority: t.priority,
      assignedTo: t.assignedTo,
      resolutionNotes: t.resolutionNotes,
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      customer: ev?.customer
        ? {
            id: ev.customer.id,
            name: ev.customer.name,
            email: ev.customer.email,
            phone: ev.customer.phone,
            riskTier: ev.customer.riskTier,
            lifetimeValue: ev.customer.lifetimeValue,
            dncFlag: ev.customer.dncFlag,
          }
        : null,
      event: ev
        ? {
            id: ev.id,
            eventType: ev.eventType,
            entityType: ev.entityType,
            amount: ev.amount,
            currency: ev.currency,
            errorReason: ev.errorReason,
            causeLabel: ev.diagnosis?.causeLabel ?? null,
            riskScore: ev.riskScore,
            occurredAt: ev.occurredAt.toISOString(),
          }
        : null,
      notesCount: t._count.notes,
    };
  });

  if (params.search) {
    const q = params.search.toLowerCase();
    items = items.filter(
      (item) =>
        item.customer?.name.toLowerCase().includes(q) ||
        item.customer?.email.toLowerCase().includes(q) ||
        item.entityId.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q),
    );
  }

  return {
    items,
    pagination: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
}

export async function getTicketStats(): Promise<TicketStatsDto> {
  const [openTickets, writtenOffTickets, recoveredTickets] = await Promise.all([
    prisma.ticket.findMany({ where: { status: "open" }, select: { entityId: true } }),
    prisma.ticket.count({ where: { status: { in: ["written_off", "resolved"] } } }),
    prisma.ticket.findMany({ where: { status: "recovered" }, select: { entityId: true } }),
  ]);

  const openEntityIds = openTickets.map((t) => t.entityId);
  const recoveredEntityIds = recoveredTickets.map((t) => t.entityId);

  const [openEvents, recoveredLedgerEntries] = await Promise.all([
    prisma.revenueEvent.findMany({
      where: { entityId: { in: openEntityIds } },
      select: { entityId: true, amount: true },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.ledgerEntry.findMany({
      where: { entityId: { in: recoveredEntityIds }, type: "RECOVERED" },
      select: { amount: true },
    }),
  ]);

  const seenOpen = new Set<string>();
  let totalAtRisk = 0;
  for (const ev of openEvents) {
    if (!seenOpen.has(ev.entityId)) {
      seenOpen.add(ev.entityId);
      totalAtRisk += ev.amount;
    }
  }

  const totalRecovered = recoveredLedgerEntries.reduce((acc, curr) => acc + curr.amount, 0);

  return {
    openCount: openTickets.length,
    writtenOffCount: writtenOffTickets,
    recoveredCount: recoveredTickets.length,
    totalAtRisk,
    totalRecovered,
  };
}

export async function getTicketById(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      notes: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!ticket) {
    throw new DomainError(`Ticket ${ticketId} not found.`, "TICKET_NOT_FOUND");
  }

  const [latestEvent, auditEntries, workflowState] = await Promise.all([
    prisma.revenueEvent.findFirst({
      where: { entityId: ticket.entityId },
      orderBy: { occurredAt: "desc" },
      include: {
        customer: true,
        diagnosis: true,
        decision: true,
        action: true,
      },
    }),
    prisma.auditEntry.findMany({
      where: { entityId: ticket.entityId },
      orderBy: { timestamp: "asc" },
    }),
    prisma.entityWorkflowState.findUnique({
      where: { entityId: ticket.entityId },
    }),
  ]);

  return {
    ticket: {
      ...ticket,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      notes: ticket.notes.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      })),
    },
    customer: latestEvent?.customer ?? null,
    event: latestEvent ?? null,
    workflowState: workflowState?.state ?? null,
    auditEntries,
  };
}

export async function addTicketNote(
  ticketId: string,
  params: { author?: string; content: string; type?: string },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new DomainError(`Ticket ${ticketId} not found.`, "TICKET_NOT_FOUND");

  return await prisma.ticketNote.create({
    data: {
      ticketId,
      author: params.author || "Human Agent",
      content: params.content,
      type: params.type || "note",
    },
  });
}

export async function sendTicketEmail(
  ticketId: string,
  params: {
    subject: string;
    message: string;
    includePaymentLink?: boolean;
    agentName?: string;
  },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new DomainError(`Ticket ${ticketId} not found.`, "TICKET_NOT_FOUND");

  const latestEvent = await prisma.revenueEvent.findFirst({
    where: { entityId: ticket.entityId },
    orderBy: { occurredAt: "desc" },
    include: { customer: true },
  });

  if (!latestEvent || !latestEvent.customer) {
    throw new DomainError(
      `No customer associated with ticket entity ${ticket.entityId}.`,
      "CUSTOMER_NOT_FOUND",
    );
  }

  const customer = latestEvent.customer;
  let paymentUrl: string | undefined;

  if (params.includePaymentLink) {
    try {
      const linkResult = await createRecoveryPaymentLink({
        amount: latestEvent.amount,
        currency: latestEvent.currency,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone ?? undefined,
        description: `Human Escalation Recovery for ${latestEvent.entityId}`,
        eventId: latestEvent.id,
        actionType: "human_email_outreach",
      });
      paymentUrl = linkResult.paymentLinkShortUrl;
    } catch (err) {
      logError("ticketService", err);
    }
  }

  const { subject, html: fullHtml } = buildTicketOutreachEmail({
    customerName: customer.name,
    message: params.message,
    amount: latestEvent.amount,
    paymentUrl,
  });

  await sendRecoveryEmail({
    to: customer.email,
    subject: params.subject || subject,
    html: fullHtml,
  });

  const noteContent = `[Email Sent] To: ${customer.email}\nSubject: ${params.subject}\n\n${params.message}${paymentUrl ? `\n\nPayment Link: ${paymentUrl}` : ""}`;
  await prisma.ticketNote.create({
    data: {
      ticketId,
      author: params.agentName || "Human Agent",
      content: noteContent,
      type: "email_sent",
    },
  });

  return { success: true, paymentUrl };
}

export async function resolveTicket(
  ticketId: string,
  params: {
    status: "recovered" | "written_off" | "resolved" | "open";
    resolutionNotes?: string;
    agentName?: string;
    recoveredAmount?: number;
  },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new DomainError(`Ticket ${ticketId} not found.`, "TICKET_NOT_FOUND");

  const latestEvent = await prisma.revenueEvent.findFirst({
    where: { entityId: ticket.entityId },
    orderBy: { occurredAt: "desc" },
  });

  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    const updatedTicket = await tx.ticket.update({
      where: { id: ticketId },
      data: {
        status: params.status,
        resolutionNotes: params.resolutionNotes ?? null,
        resolvedAt: params.status === "open" ? null : now,
      },
    });

    await tx.ticketNote.create({
      data: {
        ticketId,
        author: params.agentName || "Human Agent",
        content: `Status updated to ${params.status.toUpperCase()}${params.resolutionNotes ? `: ${params.resolutionNotes}` : ""}`,
        type: "status_change",
      },
    });

    if (params.status === "recovered" && latestEvent) {
      const amount = params.recoveredAmount ?? latestEvent.amount;

      await tx.entityWorkflowState.upsert({
        where: { entityId: ticket.entityId },
        create: {
          entityId: ticket.entityId,
          customerId: latestEvent.customerId,
          state: "RECOVERED",
          attemptCount: 0,
        },
        update: {
          state: "RECOVERED",
          attemptCount: 0,
          cooldownUntil: null,
        },
      });

      await tx.entityCauseState.deleteMany({
        where: { entityId: ticket.entityId },
      });

      await writeLedgerEntry(tx, {
        entityId: ticket.entityId,
        eventId: latestEvent.id,
        type: "RECOVERED",
        amount,
        currency: latestEvent.currency,
        referenceId: `human_recovery_${ticketId}`,
      });

      await redis.set(`razorrecovery:recovered:${ticket.entityId}`, "true", "EX", 86400 * 30);
    } else if ((params.status === "written_off" || params.status === "resolved") && latestEvent) {
      await tx.entityWorkflowState.upsert({
        where: { entityId: ticket.entityId },
        create: {
          entityId: ticket.entityId,
          customerId: latestEvent.customerId,
          state: "WRITTEN_OFF",
        },
        update: {
          state: "WRITTEN_OFF",
        },
      });

      await writeLedgerEntry(tx, {
        entityId: ticket.entityId,
        eventId: latestEvent.id,
        type: "WRITTEN_OFF",
        amount: latestEvent.amount,
        currency: latestEvent.currency,
        referenceId: `human_written_off_${ticketId}`,
      });
    }

    return updatedTicket;
  });
}
