-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "knowledge_base_id" UUID;

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_knowledge_base_id_idx" ON "knowledge_documents"("tenant_id", "knowledge_base_id");

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_knowledge_base_id_tenant_id_fkey" FOREIGN KEY ("knowledge_base_id", "tenant_id") REFERENCES "knowledge_bases"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
