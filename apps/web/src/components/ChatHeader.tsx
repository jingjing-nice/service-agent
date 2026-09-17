import { Avatar, Button, Modal, Tag, message as toast } from 'antd';
import { EllipsisOutlined, MenuOutlined, SearchOutlined, UserSwitchOutlined } from '@ant-design/icons';
import type { Conversation, ConversationStatus } from '../types/conversation';
import { useWorkbenchStore } from '../stores';

const stateLabel: Record<ConversationStatus, string> = {
  idle: '待处理',
  sending: '发送中',
  streaming: 'AI 服务中',
  waiting_approval: '等待审批',
  human_takeover: '人工接管',
  failed: '处理失败',
  completed: '已解决',
  cancelled: '已停止',
};

export function ChatHeader({ active }: { active?: Conversation }) {
  const status = useWorkbenchStore((state) => state.status);
  const setStatus = useWorkbenchStore((state) => state.setStatus);
  const toggleDetail = useWorkbenchStore((state) => state.toggleDetail);

  const takeover = () => {
    if (status === 'human_takeover') {
      setStatus('streaming');
      toast.success('会话已交还 AI');
    } else {
      Modal.confirm({
        title: '确认接管当前会话？',
        content: '接管后 Agent 将暂停自动回复，你发送的内容会直接送达客户。',
        okText: '确认接管',
        cancelText: '取消',
        onOk: () => setStatus('human_takeover'),
      });
    }
  };

  return (
    <header>
      <Button className="mobile-menu" icon={<MenuOutlined />} />
      <div className="person">
        <Avatar size={42}>{active?.name[0]}</Avatar>
        <div>
          <h2>
            {active?.name}
            <Tag color={status === 'human_takeover' ? 'orange' : 'green'}>
              {stateLabel[status]}
            </Tag>
          </h2>
          <p>{active?.channel} · 会话已持续 8 分钟</p>
        </div>
      </div>
      <div>
        <Button icon={<SearchOutlined />}>会话轨迹</Button>
        <Button type="primary" icon={<UserSwitchOutlined />} onClick={takeover}>
          {status === 'human_takeover' ? '交还 AI' : '接管会话'}
        </Button>
        <Button icon={<EllipsisOutlined />} onClick={toggleDetail} />
      </div>
    </header>
  );
}
