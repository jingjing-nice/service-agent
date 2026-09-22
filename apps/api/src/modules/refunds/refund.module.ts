import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { RefundController } from './refund.controller.js';
import { RefundWorkflowService } from './refund-workflow.service.js';
import { RefundWorkflowGraphService } from './refund-workflow-graph.service.js';
import { SimulatedOrderService } from './simulated-order.service.js';
import { SimulatedRefundGatewayService } from './simulated-refund-gateway.service.js';
import { RefundPolicyRulesService } from './refund-policy-rules.service.js';

@Module({
  imports: [MessagesModule, KnowledgeModule],
  controllers: [RefundController],
  providers: [
    RefundWorkflowService,
    RefundWorkflowGraphService,
    SimulatedOrderService,
    SimulatedRefundGatewayService,
    RefundPolicyRulesService,
  ],
  exports: [RefundWorkflowService, RefundWorkflowGraphService],
})
export class RefundModule {}
