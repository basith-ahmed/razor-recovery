-- Revenue-leakage ingestion v2: partner-owned business objects only.
-- Gateway-era payment-failure event types are removed; the subscription
-- mandate-cancellation event type replaces SUBSCRIPTION_FAILED.
-- Customer.email becomes the unique natural key for partner ingestion upserts.

ALTER TYPE "EventType" RENAME VALUE 'SUBSCRIPTION_FAILED' TO 'SUBSCRIPTION_MANDATE_CANCELLED';

-- Narrow the enum: rebuild the type, convert the column through text, drop the old type.
CREATE TYPE "EventType_new" AS ENUM ('CHECKOUT_ABANDONED', 'INVOICE_OVERDUE', 'SUBSCRIPTION_MANDATE_CANCELLED');
ALTER TABLE "RevenueEvent" ALTER COLUMN "eventType" TYPE "EventType_new" USING "eventType"::text::"EventType_new";
DROP TYPE "EventType";
ALTER TYPE "EventType_new" RENAME TO "EventType";

CREATE TYPE "EntityType_new" AS ENUM ('CART', 'INVOICE', 'SUBSCRIPTION');
ALTER TABLE "RevenueEvent" ALTER COLUMN "entityType" TYPE "EntityType_new" USING "entityType"::text::"EntityType_new";
DROP TYPE "EntityType";
ALTER TYPE "EntityType_new" RENAME TO "EntityType";

CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");
