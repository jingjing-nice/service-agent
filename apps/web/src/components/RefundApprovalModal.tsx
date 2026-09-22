import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import { refundApi, type RefundApproval } from '../api/refunds';

type Props = { open: boolean; onClose: () => void };

const approvalStatusPresentation: Record<
  RefundApproval['status'],
  { label: string; color: string }
> = {
  PENDING_APPROVAL: { label: '等待人工审批', color: 'gold' },
  APPROVED: { label: '审批通过', color: 'blue' },
  REJECTED: { label: '已拒绝', color: 'red' },
  EXECUTING: { label: '退款处理中', color: 'processing' },
  EXECUTED: { label: '退款成功', color: 'success' },
  EXECUTION_FAILED: { label: '退款失败', color: 'error' },
};

export function RefundApprovalModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const approvals = useQuery({
    queryKey: ['refund-approvals'],
    queryFn: refundApi.listApprovals,
    enabled: open,
    refetchInterval: open ? 3_000 : false,
  });
  const decision = useMutation({
    mutationFn: (input: { item: RefundApproval; approved: boolean }) =>
      refundApi.decide({
        id: input.item.id,
        approved: input.approved,
        note: noteById[input.item.id]?.trim() || undefined,
      }),
    onSuccess: async (_result, variables) => {
      setNoteById((current) => {
        const next = { ...current };
        delete next[variables.item.id];
        return next;
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['refund-approvals'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
        queryClient.invalidateQueries({
          queryKey: ['messages', variables.item.id],
          exact: false,
        }),
        queryClient.invalidateQueries({ queryKey: ['messages'] }),
      ]);
    },
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      title="退款人工审批中心"
      className="refund-approval-modal"
    >
      <Typography.Paragraph type="secondary">
        Agent 已完成政策检索、订单验证和确定性规则判断；资金操作必须由人工确认。
      </Typography.Paragraph>
      {approvals.isLoading && <Spin />}
      {approvals.error && (
        <Alert
          type="error"
          showIcon
          message={(approvals.error as Error).message}
        />
      )}
      {!approvals.isLoading &&
        !approvals.error &&
        approvals.data?.length === 0 && (
          <Empty description="暂无退款审批记录" />
        )}
      <List
        dataSource={approvals.data ?? []}
        renderItem={(item) => {
          const isCurrentItemPending =
            decision.isPending && decision.variables?.item.id === item.id;
          const canDecide = item.status === 'PENDING_APPROVAL';
          const presentation = isCurrentItemPending
            ? { label: '审批处理中', color: 'processing' }
            : approvalStatusPresentation[item.status];

          return (
            <List.Item className="refund-approval-item">
              <div className="refund-approval-card">
                <div className="refund-approval-heading">
                  <div>
                    <Typography.Title level={5}>
                      {item.orderNo}
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      {item.conversation.customerName} ·{' '}
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </Typography.Text>
                  </div>
                  <Tag color={presentation.color}>{presentation.label}</Tag>
                </div>
                <div className="refund-approval-amount">
                  退款金额 <strong>¥{Number(item.amount).toFixed(2)}</strong>
                </div>
                <Typography.Paragraph>{item.reason}</Typography.Paragraph>
                <div className="refund-policy-evidence">
                  <FileSearchOutlined />
                  <span>
                    政策依据：
                    {item.policyCitations.length > 0
                      ? item.policyCitations
                          .map(
                            (citation) =>
                              `[${citation.index}] ${citation.title}`,
                          )
                          .join('、')
                      : '无'}
                  </span>
                </div>
                <div>
                  <Typography.Text strong>审批备注（选填）</Typography.Text>
                  <Input.TextArea
                    rows={2}
                    maxLength={500}
                    showCount
                    placeholder="请填写审批依据或处理说明"
                    disabled={isCurrentItemPending || !canDecide}
                    value={
                      canDecide
                        ? (noteById[item.id] ?? '')
                        : (item.reviewNote ?? '')
                    }
                    onChange={(event) =>
                      setNoteById((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                </div>
                {canDecide && (
                  <Space>
                    <Popconfirm
                      title="确认批准并执行模拟退款？"
                      okText="确认批准"
                      cancelText="取消"
                      onConfirm={() =>
                        decision.mutate({ item, approved: true })
                      }
                      disabled={isCurrentItemPending}
                    >
                      <Button
                        type="primary"
                        icon={<CheckOutlined />}
                        loading={isCurrentItemPending}
                        disabled={isCurrentItemPending}
                      >
                        批准退款
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="确认拒绝该退款申请？"
                      okText="确认拒绝"
                      cancelText="取消"
                      onConfirm={() =>
                        decision.mutate({ item, approved: false })
                      }
                      disabled={isCurrentItemPending}
                    >
                      <Button
                        danger
                        icon={<CloseOutlined />}
                        disabled={isCurrentItemPending}
                      >
                        拒绝
                      </Button>
                    </Popconfirm>
                  </Space>
                )}
                {decision.isError &&
                  decision.variables?.item.id === item.id && (
                    <Alert
                      type="error"
                      showIcon
                      message={decision.error.message}
                    />
                  )}
              </div>
            </List.Item>
          );
        }}
      />
    </Modal>
  );
}
