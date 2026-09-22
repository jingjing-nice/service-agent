import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { MessagesModule } from '../messages/messages.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { RefundModule } from '../refunds/refund.module.js';

@Module({
  controllers: [LlmController],
  providers: [LlmService],
  // 导入后，LlmController 才能注入 MessagesService。
  imports: [MessagesModule, KnowledgeModule, RefundModule],
})
export class LlmModule { }
