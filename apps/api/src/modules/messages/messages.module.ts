import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
  // 允许其他模块使用同一个 MessagesService 实例。
  exports: [MessagesService],
})
export class MessagesModule {}
