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
import { getOrCreatePaymentLink } from "./paymentLinkService";
import { sendRecoveryEmail } from "../integrations/emailIntegration";
import { buildTicketOutreachEmail } from "../domain/emailTemplates";
import { parsePagination, paginatedResponse } from "../utils/pagination";

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

  const [revenueEvents, workflowStates] = await Promise.all([
    prisma.revenueEvent.findMany({
      where: { entityId: { in: entityIds } },
      orderBy: { occurredAt: "desc" },
      include: {
        customer: true,
        diagnosis: true,
      },
    }),
    prisma.entityWorkflowState.findMany({
      where: { entityId: { in: entityIds } },
      include: { customer: true },
    }),
  ]);

  const eventByEntity = new Map<string, (typeof revenueEvents)[0]>();
  for (const ev of revenueEvents) {
    if (!eventByEntity.has(ev.entityId)) {
      eventByEntity.set(ev.entityId, ev);
    }
  }

  const workflowByEntity = new Map<string, (typeof workflowStates)[0]>();
  for (const ws of workflowStates) {
    if (!workflowByEntity.has(ws.entityId)) {
      workflowByEntity.set(ws.entityId, ws);
    }
  }

  let items: TicketSummaryDto[] = tickets.map((t) => {
    const ev = eventByEntity.get(t.entityId);
    const ws = workflowByEntity.get(t.entityId);
    const cust = ev?.customer || ws?.customer;
    return {
      id: t.id,
      entityId: t.entityId,
      reason: t.reason,
      status: t.status,
      assignedTo: t.assignedTo,
      resolutionNotes: t.resolutionNotes,
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      customer: cust
        ? {
            id: cust.id,
            name: cust.name,
            email: cust.email,
            phone: cust.phone,
            riskTier: cust.riskTier,
            lifetimeValue: cust.lifetimeValue,
            dncFlag: cust.dncFlag,
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

  return paginatedResponse(items, totalCount, { page, limit, skip });
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
    event: latestEvent
      ? {
          id: latestEvent.id,
          entityId: latestEvent.entityId,
          entityType: latestEvent.entityType,
          customerId: latestEvent.customerId,
          customerName: latestEvent.customer?.name ?? "Unknown",
          customerEmail: latestEvent.customer?.email ?? "Unknown",
          eventType: latestEvent.eventType,
          amount: latestEvent.amount,
          currency: latestEvent.currency,
          errorReason: latestEvent.errorReason,
          errorCode: latestEvent.errorCode,
          causeLabel: latestEvent.diagnosis?.causeLabel ?? null,
          diagnosis: latestEvent.diagnosis,
          decision: latestEvent.decision,
          action: latestEvent.action,
          riskScore: latestEvent.riskScore,
          urgency: latestEvent.urgency,
          state: workflowState?.state ?? "ESCALATED",
          stage: "EXECUTED",
          occurredAt: latestEvent.occurredAt.toISOString(),
        }
      : null,
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
  let paymentLinkUrl: string | undefined;

  if (params.includePaymentLink) {
    try {
      const link = await getOrCreatePaymentLink({
        entityId: ticket.entityId,
        eventId: latestEvent.id,
        ticketId,
        amount: latestEvent.amount,
        currency: latestEvent.currency,
        customer: { name: customer.name, email: customer.email, phone: customer.phone },
        description: `Human Escalation Recovery for ${latestEvent.entityId}`,
        actionType: "human_email_outreach",
      });
      paymentLinkUrl = link.paymentLinkUrl;

      // Persist payment link to Ticket so webhook can match deterministically
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          razorpayPaymentLinkId: link.razorpayPaymentLinkId,
          paymentLinkUrl: link.paymentLinkUrl,
        },
      });
    } catch (err) {
      logError("ticketService", err);
    }
  }

  const { subject, html: fullHtml } = buildTicketOutreachEmail({
    customerName: customer.name,
    message: params.message,
    amount: latestEvent.amount,
    paymentLinkUrl,
  });

  await sendRecoveryEmail({
    to: customer.email,
    subject: params.subject || subject,
    html: fullHtml,
  });

  const noteContent = `[Email Sent] To: ${customer.email}\nSubject: ${params.subject}\n\n${params.message}${paymentLinkUrl ? `\n\nPayment Link: ${paymentLinkUrl}` : ""}`;
  await prisma.ticketNote.create({
    data: {
      ticketId,
      author: params.agentName || "Human Agent",
      content: noteContent,
      type: "email_sent",
    },
  });

  return { success: true, paymentLinkUrl, paymentUrl: paymentLinkUrl };
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
