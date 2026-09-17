-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_bases_tenant_id_name_key" ON "knowledge_bases"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_bases_id_tenant_id_key" ON "knowledge_bases"("id", "tenant_id");
