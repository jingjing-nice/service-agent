CREATE TYPE "RefundRequestStatus" AS ENUM (
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTED'
);

CREATE TABLE "refund_requests" (
  "id" UUID NOT NULL,
  "tenant_id" VARCHAR(100) NOT NULL,
  "conversation_id" UUID NOT NULL,
  "customer_id" VARCHAR(100) NOT NULL,
  "order_no" VARCHAR(64) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(8) NOT NULL DEFAULT 'CNY',
  "reason" VARCHAR(500) NOT NULL,
  "status" "RefundRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "idempotency_key" VARCHAR(200) NOT NULL,
  "policy_citations" JSONB NOT NULL,
  "trace_id" VARCHAR(100) NOT NULL,
  "reviewed_by" VARCHAR(100),
  "review_note" VARCHAR(500),
  "reviewed_at" TIMESTAMP(3),
  "executed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_requests_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "refund_requests_tenant_id_idempotency_key_key"
ON "refund_requests"("tenant_id", "idempotency_key");

CREATE INDEX "refund_requests_tenant_id_status_created_at_idx"
ON "refund_requests"("tenant_id", "status", "created_at");

CREATE INDEX "refund_requests_tenant_id_conversation_id_idx"
ON "refund_requests"("tenant_id", "conversation_id");
