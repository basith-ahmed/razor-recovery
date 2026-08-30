import { Router } from "express";
import {
  listTickets,
  getTicketStats,
  getTicketById,
  addTicketNote,
  sendTicketEmail,
  resolveTicket,
} from "../../services/ticketService";
import { DomainError } from "../../domain/types";

export const ticketsRouter = Router();

// GET /tickets/stats — summary counts & financial totals for tickets dashboard
ticketsRouter.get("/stats", async (_req, res) => {
  try {
    const stats = await getTicketStats();
    return res.status(200).json(stats);
  } catch (error) {
    console.error("[ticketsRouter] Failed to fetch ticket stats:", error);
    return res.status(500).json({ error: "Failed to fetch ticket stats" });
  }
});

// GET /tickets — list tickets with filters & pagination
ticketsRouter.get("/", async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    const result = await listTickets({
      status: typeof status === "string" ? status : undefined,
      search: typeof search === "string" ? search : undefined,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 20,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("[ticketsRouter] Failed to list tickets:", error);
    return res.status(500).json({ error: "Failed to list tickets" });
  }
});

// GET /tickets/:id — get ticket details, notes, and audit history
ticketsRouter.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const ticketData = await getTicketById(id);
    return res.status(200).json(ticketData);
  } catch (error) {
    if (error instanceof DomainError && error.code === "TICKET_NOT_FOUND") {
      return res.status(404).json({ error: error.message });
    }
    console.error("[ticketsRouter] Failed to get ticket:", error);
    return res.status(500).json({ error: "Failed to get ticket" });
  }
});

// POST /tickets/:id/notes — add internal note
ticketsRouter.post("/:id/notes", async (req, res) => {
  try {
    const { id } = req.params;
    const { content, author, type } = req.body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Note content is required." });
    }

    const note = await addTicketNote(id, { content, author, type });
    return res.status(201).json(note);
  } catch (error) {
    if (error instanceof DomainError && error.code === "TICKET_NOT_FOUND") {
      return res.status(404).json({ error: error.message });
    }
    console.error("[ticketsRouter] Failed to add ticket note:", error);
    return res.status(500).json({ error: "Failed to add ticket note" });
  }
});

// POST /tickets/:id/send-email — dispatch direct email to customer
ticketsRouter.post("/:id/send-email", async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, message, includePaymentLink, agentName } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ error: "Subject and message are required." });
    }

    const result = await sendTicketEmail(id, {
      subject,
      message,
      includePaymentLink: Boolean(includePaymentLink),
      agentName,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof DomainError && error.code === "TICKET_NOT_FOUND") {
      return res.status(404).json({ error: error.message });
    }
    console.error("[ticketsRouter] Failed to send ticket email:", error);
    return res.status(500).json({ error: "Failed to send outreach email" });
  }
});

// POST /tickets/:id/resolve — resolve or recover ticket
ticketsRouter.post("/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolutionNotes, agentName, recoveredAmount } = req.body;

    if (!status || !["recovered", "written_off", "resolved", "open"].includes(status)) {
      return res.status(400).json({
        error: "Valid status ('recovered', 'written_off', 'open') is required.",
      });
    }

    const result = await resolveTicket(id, {
      status,
      resolutionNotes,
      agentName,
      recoveredAmount: recoveredAmount ? parseFloat(recoveredAmount) : undefined,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof DomainError && error.code === "TICKET_NOT_FOUND") {
      return res.status(404).json({ error: error.message });
    }
    console.error("[ticketsRouter] Failed to resolve ticket:", error);
    return res.status(500).json({ error: "Failed to resolve ticket" });
  }
});
