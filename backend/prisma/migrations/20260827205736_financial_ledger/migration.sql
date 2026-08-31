-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('AT_RISK', 'RECOVERED', 'WRITTEN_OFF', 'REVERSED');

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerEntry_entityId_idx" ON "LedgerEntry"("entityId");

-- CreateIndex
CREATE INDEX "LedgerEntry_type_idx" ON "LedgerEntry"("type");

-- CreateIndex
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_eventId_type_idx" ON "LedgerEntry"("eventId", "type");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RevenueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce append-only rules
CREATE RULE ledger_no_update AS ON UPDATE TO "LedgerEntry" DO INSTEAD NOTHING;
CREATE RULE ledger_no_delete AS ON DELETE TO "LedgerEntry" DO INSTEAD NOTHING;

