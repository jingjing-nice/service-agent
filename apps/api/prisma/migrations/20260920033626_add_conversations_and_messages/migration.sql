-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('IDLE', 'SENDING', 'STREAMING', 'WAITING_APPROVAL', 'HUMAN_TAKEOVER', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('CUSTOMER', 'AGENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "customer_id" VARCHAR(100) NOT NULL,
    "customer_name" VARCHAR(100) NOT NULL,
    "channel" VARCHAR(50) NOT NULL DEFAULT 'WEB',
    "topic" VARCHAR(200),
    "status" "ConversationStatus" NOT NULL DEFAULT 'IDLE',
    "last_message" VARCHAR(500),
    "last_message_at" TIMESTAMP(3),
    "agent_version" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "trace_id" VARCHAR(100),
    "request_id" VARCHAR(150),
    "model_name" VARCHAR(100),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_customer_id_idx" ON "conversations"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_created_at_idx" ON "messages"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_trace_id_idx" ON "messages"("trace_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_request_id_key" ON "messages"("conversation_id", "request_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
