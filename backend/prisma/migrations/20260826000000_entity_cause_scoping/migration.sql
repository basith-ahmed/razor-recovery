-- AlterTable
ALTER TABLE "EntityWorkflowState" DROP COLUMN "attemptCount",
DROP COLUMN "cooldownUntil",
DROP COLUMN "lastContactedAt";

-- CreateTable
CREATE TABLE "EntityCauseState" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "causeLabel" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastContactedAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityCauseState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityCauseState_entityId_idx" ON "EntityCauseState"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityCauseState_entityId_causeLabel_key" ON "EntityCauseState"("entityId", "causeLabel");
