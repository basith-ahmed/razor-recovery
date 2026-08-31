/*
  Warnings:

  - Added the required column `updatedAt` to the `Ticket` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "AuditEmbedding_embedding_cosine_idx";

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "paymentLinkUrl" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "assignedTo" TEXT,
ADD COLUMN     "paymentLinkUrl" TEXT,
ADD COLUMN     "razorpayPaymentLinkId" TEXT,
ADD COLUMN     "resolutionNotes" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "TicketNote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'Human Agent',
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'note',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromiseToPay" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "eventId" TEXT,
    "promisedAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "promisedDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reminderSentAt" TIMESTAMP(3),
    "gracePeriodUntil" TIMESTAMP(3),
    "razorpayPaymentLinkId" TEXT,
    "paymentLinkUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromiseToPay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketNote_ticketId_idx" ON "TicketNote"("ticketId");

-- CreateIndex
CREATE INDEX "TicketNote_createdAt_idx" ON "TicketNote"("createdAt");

-- CreateIndex
CREATE INDEX "PromiseToPay_entityId_idx" ON "PromiseToPay"("entityId");

-- CreateIndex
CREATE INDEX "PromiseToPay_customerId_idx" ON "PromiseToPay"("customerId");

-- CreateIndex
CREATE INDEX "PromiseToPay_status_idx" ON "PromiseToPay"("status");

-- CreateIndex
CREATE INDEX "PromiseToPay_promisedDate_idx" ON "PromiseToPay"("promisedDate");

-- CreateIndex
CREATE INDEX "PromiseToPay_razorpayPaymentLinkId_idx" ON "PromiseToPay"("razorpayPaymentLinkId");

-- CreateIndex
CREATE INDEX "Action_razorpayPaymentLinkId_idx" ON "Action"("razorpayPaymentLinkId");

-- CreateIndex
CREATE INDEX "Ticket_entityId_idx" ON "Ticket"("entityId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");

-- CreateIndex
CREATE INDEX "Ticket_razorpayPaymentLinkId_idx" ON "Ticket"("razorpayPaymentLinkId");

-- AddForeignKey
ALTER TABLE "TicketNote" ADD CONSTRAINT "TicketNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RevenueEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
