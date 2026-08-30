import { Prisma, LedgerEntry } from "@prisma/client";
import { DomainError, WriteLedgerEntryParams } from "../domain/types";

export { WriteLedgerEntryParams };

/**
 * Writes an append-only LedgerEntry within the provided transaction.
 * Idempotent: If an entry for (eventId, type) already exists, it returns
 * the existing entry and does not throw or insert a duplicate.
 */
export async function writeLedgerEntry(
  tx: Prisma.TransactionClient,
  params: WriteLedgerEntryParams,
): Promise<LedgerEntry> {
  if (params.amount <= 0 && params.type !== "WRITTEN_OFF") {
    // Write-offs might occasionally happen for $0 balances or purely for
    // state completion, but positive ledger movements (AT_RISK, RECOVERED,
    // REVERSED) must have a positive amount.
    throw new DomainError(
      "Ledger entry amount must be greater than 0 for monetary movements.",
      "INVALID_LEDGER_AMOUNT",
    );
  }

  // 1. Exact match idempotency check: (eventId, type) guarantees we don't double-charge
  // or double-credit the ledger if a workflow step is replayed.
  const existing = await tx.ledgerEntry.findFirst({
    where: {
      eventId: params.eventId,
      type: params.type,
    },
  });

  if (existing) {
    return existing;
  }

  // 2. Entity-level lifecycle idempotency check:
  // An entity has a single at-risk exposure for its active recovery lifecycle.
  // Multiple retry events, follow-ups, or webhook failures for the SAME entity must not
  // multiply the at-risk amount in the financial ledger.
  if (params.type === "AT_RISK") {
    if (typeof tx.ledgerEntry.findMany === "function") {
      const entityEntries = await tx.ledgerEntry.findMany({
        where: { entityId: params.entityId },
      });

      const atRiskTotal = entityEntries
        .filter((e) => e.type === "AT_RISK")
        .reduce((sum, e) => sum + e.amount, 0);
      const closedTotal = entityEntries
        .filter((e) => e.type === "RECOVERED" || e.type === "WRITTEN_OFF")
        .reduce((sum, e) => sum + e.amount, 0);

      // If the entity is already actively at risk (atRiskTotal > closedTotal),
      // return the existing AT_RISK entry without creating a duplicate.
      if (atRiskTotal > closedTotal) {
        const existingAtRisk = entityEntries.find((e) => e.type === "AT_RISK");
        if (existingAtRisk) {
          return existingAtRisk;
        }
      }
    } else {
      const existingAtRisk = await tx.ledgerEntry.findFirst({
        where: { entityId: params.entityId, type: "AT_RISK" },
      });
      if (existingAtRisk) {
        return existingAtRisk;
      }
    }
  }

  if (params.type === "RECOVERED") {
    if (typeof tx.ledgerEntry.findMany === "function") {
      const entityEntries = await tx.ledgerEntry.findMany({
        where: { entityId: params.entityId },
      });

      const recoveredTotal = entityEntries
        .filter((e) => e.type === "RECOVERED")
        .reduce((sum, e) => sum + e.amount, 0);
      const atRiskTotal = entityEntries
        .filter((e) => e.type === "AT_RISK")
        .reduce((sum, e) => sum + e.amount, 0);

      if (atRiskTotal > 0 && recoveredTotal >= atRiskTotal) {
        const existingRecovered = entityEntries.find((e) => e.type === "RECOVERED");
        if (existingRecovered) {
          return existingRecovered;
        }
      }
    }
  }

  if (params.type === "WRITTEN_OFF") {
    const existingWrittenOff = await tx.ledgerEntry.findFirst({
      where: {
        entityId: params.entityId,
        type: "WRITTEN_OFF",
      },
    });
    if (existingWrittenOff) {
      return existingWrittenOff;
    }
  }

  return await tx.ledgerEntry.create({
    data: {
      entityId: params.entityId,
      eventId: params.eventId,
      type: params.type,
      amount: params.amount,
      currency: params.currency ?? "INR",
      referenceId: params.referenceId,
    },
  });
}
