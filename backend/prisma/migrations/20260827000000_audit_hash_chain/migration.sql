-- CreateTable
CREATE TABLE "AuditChainHead" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditChainHead_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN "sequenceNumber" SERIAL NOT NULL;
ALTER TABLE "AuditEntry" ADD COLUMN "prevHash" TEXT NOT NULL DEFAULT 'd7c09e32ebdfa4ba13e9ef94a91b828552fe899d08ccd52969f4882651343b5d';
ALTER TABLE "AuditEntry" ADD COLUMN "hash" TEXT NOT NULL DEFAULT 'd7c09e32ebdfa4ba13e9ef94a91b828552fe899d08ccd52969f4882651343b5d';

-- AlterTable to remove default
ALTER TABLE "AuditEntry" ALTER COLUMN "prevHash" DROP DEFAULT;
ALTER TABLE "AuditEntry" ALTER COLUMN "hash" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "AuditEntry_sequenceNumber_key" ON "AuditEntry"("sequenceNumber");

-- Seed initial chain head
INSERT INTO "AuditChainHead" ("id", "hash", "updatedAt")
VALUES (1, 'd7c09e32ebdfa4ba13e9ef94a91b828552fe899d08ccd52969f4882651343b5d', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
