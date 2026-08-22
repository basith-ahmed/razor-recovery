import { prisma } from "../config/prisma";
import { ActionResult, DomainError } from "../domain/types";

export async function escalateToHuman(
  entityId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const ticket = await prisma.ticket.create({
      data: { entityId, reason },
    });

    return {
      actionType: "escalate_to_human",
      result: "success",
      integration: "MOCK",
      detail: ticket.id,
    };
  } catch (error: unknown) {
    console.error("Human escalation ticket creation failed:", error);
    throw new DomainError(
      `Unable to create a human-escalation ticket for entity ${entityId}.`,
      "TICKET_CREATION_FAILED",
      error,
    );
  }
}
