/*
  Warnings:

  - You are about to drop the column `batchId` on the `RevenueEvent` table. All the data in the column will be lost.
  - You are about to drop the `Batch` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "RevenueEvent" DROP CONSTRAINT "RevenueEvent_batchId_fkey";

-- AlterTable
ALTER TABLE "RevenueEvent" DROP COLUMN "batchId",
ADD COLUMN     "sourceRunId" TEXT;

-- DropTable
DROP TABLE "Batch";

-- CreateIndex
CREATE INDEX "RevenueEvent_sourceRunId_idx" ON "RevenueEvent"("sourceRunId");
