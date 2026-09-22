import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefundWorkflowService } from './refund-workflow.service.js';

@Controller('api/refunds')
export class RefundController {
  constructor(
    private readonly refunds: RefundWorkflowService,
    private readonly config: ConfigService,
  ) {}

  @Get('approvals')
  listApprovals() {
    return this.refunds.listApprovals(this.getTenantId());
  }

  /** 审批退款申请，并由持久化状态机完成执行和结果通知。 */
  @Post('approvals/:id/decision')
  async decide(
    @Param('id', new ParseUUIDPipe({ version: '4' })) refundRequestId: string,
    @Body() body: { approved?: unknown; reviewerId?: unknown; note?: unknown },
  ) {
    if (typeof body.approved !== 'boolean')
      throw new BadRequestException('approved must be boolean');
    if (typeof body.reviewerId !== 'string' || !body.reviewerId.trim()) {
      throw new BadRequestException('reviewerId is required');
    }
    if (body.note !== undefined && typeof body.note !== 'string') {
      throw new BadRequestException('审批备注必须是字符串');
    }
    if (typeof body.note === 'string' && body.note.trim().length > 500) {
      throw new BadRequestException('审批备注不能超过 500 个字符');
    }

    const tenantId = this.getTenantId();
    const decision = {
      approved: body.approved,
      reviewerId: body.reviewerId.trim(),
      note:
        typeof body.note === 'string'
          ? body.note.trim() || undefined
          : undefined,
    };

    // 审批后的确定性状态机只依赖 PostgreSQL，因此服务重启后仍可继续。
    // LangGraph 负责在申请阶段 interrupt，资金执行不依赖进程内检查点。
    return this.refunds.decide({
      tenantId,
      refundRequestId,
      ...decision,
    });
  }

  private getTenantId() {
    return this.config.get<string>('DEFAULT_TENANT_ID') ?? 'tenant-local-dev';
  }
}
