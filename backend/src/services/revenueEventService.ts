import { prisma } from "../config/prisma";
import { RevenueEvent } from "@prisma/client";
import { DomainError } from "../domain/types";

/**
 * Checks if a revenue event exists in the database.
 */
export async function revenueEventExists(eventId: string): Promise<boolean> {
  const event = await prisma.revenueEvent.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  return event !== null;
}

/**
 * Finds a revenue event by ID or throws DomainError if not found.
 */
export async function findRevenueEventById(eventId: string): Promise<RevenueEvent> {
  const event = await prisma.revenueEvent.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    throw new DomainError(
      `Revenue event ${eventId} not found.`,
      "EVENT_NOT_FOUND",
    );
  }

  return event;
}
