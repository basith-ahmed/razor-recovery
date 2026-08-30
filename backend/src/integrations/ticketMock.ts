import { prisma } from "../config/prisma";
import { logError } from "../config/logger";
import { ActionResult, DomainError } from "../domain/types";

export async function escalateToHuman(
  entityId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    // Check if an open ticket already exists for this entity
    let ticket = await prisma.ticket.findFirst({
      where: { entityId, status: "open" },
    });

    if (!ticket) {
      ticket = await prisma.ticket.create({
        data: {
          entityId,
          reason,
          status: "open",
          notes: {
            create: {
              author: "System / Pipeline",
              content: `Automated escalation triggered: ${reason}`,
              type: "status_change",
            },
          },
        },
      });
    } else {
      // Append a note on the existing open ticket
      await prisma.ticketNote.create({
        data: {
          ticketId: ticket.id,
          author: "System / Pipeline",
          content: `Escalation event re-triggered: ${reason}`,
          type: "status_change",
        },
      });
    }

    return {
      actionType: "escalate_to_human",
      result: "success",
      integration: "MOCK",
      detail: ticket.id,
    };
  } catch (error: unknown) {
    logError("ticket", error);
    throw new DomainError(
      `Unable to create a human-escalation ticket for entity ${entityId}.`,
      "TICKET_CREATION_FAILED",
      error,
    );
  }
}
