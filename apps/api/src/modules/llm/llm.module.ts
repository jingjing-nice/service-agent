import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { MessagesModule } from '../messages/messages.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';

@Module({
  controllers: [LlmController],
  providers: [LlmService],
  // 导入后，LlmController 才能注入 MessagesService。
  imports: [MessagesModule, KnowledgeModule],
})
export class LlmModule { }
