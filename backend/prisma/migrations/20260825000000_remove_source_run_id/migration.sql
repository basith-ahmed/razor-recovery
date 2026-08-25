/*
  Warnings:

  - You are about to drop the column `sourceRunId` on the `RevenueEvent` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "RevenueEvent_sourceRunId_idx";

-- AlterTable
ALTER TABLE "RevenueEvent" DROP COLUMN "sourceRunId";
