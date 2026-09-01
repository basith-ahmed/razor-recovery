import { Router } from "express";
import {
  listTickets,
  getTicketStats,
  getTicketById,
  addTicketNote,
  sendTicketEmail,
  resolveTicket,
} from "../../services/ticketService";
import { handleRouteError } from "../../utils/apiResponse";
import { parsePagination } from "../../utils/pagination";

export const ticketsRouter = Router();

// GET /tickets/stats — return ticket totals and recovery KPIs for the dashboard.
ticketsRouter.get("/stats", async (_req, res) => {
  try {
    const stats = await getTicketStats();
    return res.status(200).json(stats);
  } catch (error) {
    return handleRouteError(res, error, "Failed to fetch ticket stats");
  }
});

// GET /tickets — list tickets with optional filters and pagination.
ticketsRouter.get("/", async (req, res) => {
  try {
    const { status, search } = req.query;
    const pagination = parsePagination(req.query as Record<string, unknown>, 20);
    const result = await listTickets({
      status: typeof status === "string" ? status : undefined,
      search: typeof search === "string" ? search : undefined,
      page: pagination.page,
      limit: pagination.limit,
    });
    return res.status(200).json(result);
  } catch (error) {
    return handleRouteError(res, error, "Failed to list tickets");
  }
});

// GET /tickets/:id — fetch one ticket with notes and audit history.
ticketsRouter.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const ticketData = await getTicketById(id);
    return res.status(200).json(ticketData);
  } catch (error) {
    return handleRouteError(res, error, "Failed to get ticket");
  }
});

// POST /tickets/:id/notes — add an internal note to the ticket.
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
    return handleRouteError(res, error, "Failed to add ticket note");
  }
});

// POST /tickets/:id/send-email — send a direct customer email from the ticket.
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
    return handleRouteError(res, error, "Failed to send outreach email");
  }
});

// POST /tickets/:id/resolve — update the ticket outcome and resolution status.
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
    return handleRouteError(res, error, "Failed to resolve ticket");
  }
});
