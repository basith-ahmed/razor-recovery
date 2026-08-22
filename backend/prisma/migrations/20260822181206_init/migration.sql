-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('CUSTOMER', 'CART', 'INVOICE', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('PAYMENT_FAILED', 'CHECKOUT_ABANDONED', 'INVOICE_OVERDUE', 'SUBSCRIPTION_FAILED');

-- CreateEnum
CREATE TYPE "WorkflowState" AS ENUM ('DETECTED', 'CONTACTED', 'RETRYING', 'COOLING_DOWN', 'ESCALATED', 'RECOVERED', 'WRITTEN_OFF', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "DiagnosisMethod" AS ENUM ('RULE', 'LLM');

-- CreateEnum
CREATE TYPE "ActionIntegration" AS ENUM ('RAZORPAY', 'EMAIL', 'MOCK');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "dncFlag" BOOLEAN NOT NULL DEFAULT false,
    "riskTier" TEXT NOT NULL DEFAULT 'standard',
    "lifetimeValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "disputeFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "abandonedAt" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "razorpaySubscriptionId" TEXT,
    "mrr" DOUBLE PRECISION NOT NULL,
    "nextBillDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueEvent" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "razorpayPaymentId" TEXT,
    "razorpayOrderId" TEXT,
    "errorCode" TEXT,
    "errorReason" TEXT,
    "rawPayload" JSONB NOT NULL,
    "riskScore" DOUBLE PRECISION,
    "urgency" DOUBLE PRECISION,

    CONSTRAINT "RevenueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "causeLabel" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "method" "DiagnosisMethod" NOT NULL,
    "reasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "legalActions" JSONB NOT NULL,
    "chosenAction" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL,
    "integration" "ActionIntegration" NOT NULL,
    "razorpayPaymentLinkId" TEXT,
    "emailMessageId" TEXT,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "decisionSnapshot" JSONB,
    "actionSnapshot" JSONB,
    "outcome" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityWorkflowState" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT,
    "state" "WorkflowState" NOT NULL DEFAULT 'DETECTED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastContactedAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityWorkflowState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'running',
    "eventCount" INTEGER NOT NULL,
    "amountAtRisk" DOUBLE PRECISION NOT NULL,
    "amountRecovered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "summaryJson" JSONB,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Diagnosis_eventId_key" ON "Diagnosis"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_eventId_key" ON "Decision"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Action_eventId_key" ON "Action"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityWorkflowState_entityId_key" ON "EntityWorkflowState"("entityId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RevenueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RevenueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RevenueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RevenueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityWorkflowState" ADD CONSTRAINT "EntityWorkflowState_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
