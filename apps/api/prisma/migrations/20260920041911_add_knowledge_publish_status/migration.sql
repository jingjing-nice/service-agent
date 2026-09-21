-- CreateEnum
CREATE TYPE "KnowledgePublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "index_version" VARCHAR(150),
ADD COLUMN     "publish_status" "KnowledgePublishStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "published_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_knowledge_base_id_publish_sta_idx" ON "knowledge_documents"("tenant_id", "knowledge_base_id", "publish_status");
