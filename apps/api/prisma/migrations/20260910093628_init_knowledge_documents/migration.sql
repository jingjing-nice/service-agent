-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('UPLOADED', 'PARSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "error_code" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_object_key_key" ON "knowledge_documents"("object_key");

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_status_idx" ON "knowledge_documents"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_tenant_id_sha256_key" ON "knowledge_documents"("tenant_id", "sha256");
