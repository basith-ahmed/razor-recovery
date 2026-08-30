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

  // Idempotency check: (eventId, type) guarantees we don't double-charge
  // or double-credit the ledger if a workflow step is replayed or if a 
  // webhook races with optimistic UI completion.
  const existing = await tx.ledgerEntry.findFirst({
    where: {
      eventId: params.eventId,
      type: params.type,
    },
  });

  if (existing) {
    return existing;
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
