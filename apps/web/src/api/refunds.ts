import { readApiError } from './http';

export type RefundApproval = {
  id: string;
  orderNo: string;
  amount: string | number;
  currency: string;
  reason: string;
  status:
    | 'PENDING_APPROVAL'
    | 'APPROVED'
    | 'REJECTED'
    | 'EXECUTING'
    | 'EXECUTED'
    | 'EXECUTION_FAILED';
  createdAt: string;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  policyCitations: Array<{
    index: number;
    title: string;
    source: string;
    chunkId?: string;
  }>;
  conversation: { customerName: string };
};

async function listApprovals(): Promise<RefundApproval[]> {
  const response = await fetch('/api/refunds/approvals');
  if (!response.ok) throw await readApiError(response, '加载退款审批失败');
  return (await response.json()) as RefundApproval[];
}

async function decide(input: {
  id: string;
  approved: boolean;
  note?: string;
}): Promise<RefundApproval> {
  const response = await fetch(
    `/api/refunds/approvals/${encodeURIComponent(input.id)}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approved: input.approved,
        reviewerId: 'demo-reviewer',
        note: input.note,
      }),
    },
  );
  if (!response.ok) throw await readApiError(response, '提交审批失败');
  return (await response.json()) as RefundApproval;
}

export const refundApi = { listApprovals, decide };
