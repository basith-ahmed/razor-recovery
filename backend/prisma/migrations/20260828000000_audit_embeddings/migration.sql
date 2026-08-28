CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "AuditEmbedding" (
    "id" TEXT NOT NULL,
    "auditEntryId" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEmbedding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditEmbedding_auditEntryId_key" UNIQUE ("auditEntryId"),
    CONSTRAINT "AuditEmbedding_auditEntryId_fkey" FOREIGN KEY ("auditEntryId") REFERENCES "AuditEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AuditEmbedding_embedding_cosine_idx"
ON "AuditEmbedding" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
