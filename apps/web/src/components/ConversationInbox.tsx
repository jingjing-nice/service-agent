import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Tag,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import {
  conversationApi,
  type CreateConversationInput,
} from '../api/conversations';
import type { Conversation } from '../types/conversation';
import { useWorkbenchStore } from '../stores';

type ConversationInboxProps = {
  conversations: Conversation[];
};

export function ConversationInbox({ conversations }: ConversationInboxProps) {
  const [filter, setFilter] = useState('全部');
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<CreateConversationInput>();
  const queryClient = useQueryClient();
  const activeId = useWorkbenchStore((state) => state.activeId);
  const status = useWorkbenchStore((state) => state.status);
  const select = useWorkbenchStore((state) => state.select);

  /**
   * SSE 请求进行期间锁定会话选择。
   * 否则旧会话返回的流式片段可能显示到刚切换的新会话中。
   */
  const requestInProgress = status === 'sending' || status === 'streaming';

  /**
   * 创建成功后重新获取服务端列表，并立即选中新会话。
   * 新会话还没有历史消息，因此状态从 idle 开始。
   */
  const createConversation = useMutation({
    mutationFn: conversationApi.create,
    onSuccess: async (conversation) => {
      select(conversation.id, conversation.state);
      setCreateOpen(false);
      form.resetFields();

      // 等待列表刷新，使中间聊天区域能取得新会话的完整展示信息。
      await queryClient.invalidateQueries({
        queryKey: ['conversations'],
      });
    },
  });

  /** 校验表单后提交，空白客户名称不会发送到后端。 */
  async function submitNewConversation() {
    const values = await form.validateFields();
    createConversation.mutate(values);
  }

  const visible = useMemo(
    () =>
      conversations.filter(
        (item) =>
          item.name.includes(keyword) &&
          (filter === '全部' ||
            (filter === '待处理' && ['idle', 'streaming'].includes(item.state)) ||
            (filter === '人工中' && item.state === 'human_takeover')),
      ),
    [conversations, filter, keyword],
  );

  return (
    <aside className="inbox">
      <header>
        <div>
          <small>CUSTOMER CARE</small>
          <h1>客服工作台</h1>
        </div>
        <Button
          shape="circle"
          aria-label="新建会话"
          disabled={requestInProgress}
          onClick={() => {
            createConversation.reset();
            setCreateOpen(true);
          }}
        >
          ＋
        </Button>
      </header>
      <Input
        prefix={<SearchOutlined />}
        placeholder="搜索客户、订单或会话"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <Segmented
        block
        options={['全部', '待处理', '人工中']}
        value={filter}
        onChange={(value) => setFilter(String(value))}
      />
      <div className="queue-meta">
        <span>最新优先⌄</span>
        <span>
          <i />
          AI 接待中 12
        </span>
      </div>
      <div className="conversation-list">
        {visible.map((item) => (
          <button
            key={item.id}
            className={item.id === activeId ? 'selected' : ''}
            /**
             * 当前会话仍保持可点击样式；
             * 其他会话在生成期间禁用，避免跨会话污染流式状态。
             */
            disabled={requestInProgress && item.id !== activeId}
            onClick={() => select(item.id, item.state)}
          >
            <Avatar className={`channel channel-${item.channel}`}>
              {item.channel[0]}
            </Avatar>
            <div>
              <div className="row">
                <strong>{item.name}</strong>
                <time>{item.time}</time>
              </div>
              <div className="topic">
                <Tag bordered={false}>{item.topic}</Tag>
                {item.state === 'human_takeover' && <Tag color="orange">人工接管</Tag>}
              </div>
              <p>{item.preview}</p>
            </div>
            {item.unread && <Badge count={item.unread} />}
          </button>
        ))}
      </div>

      <Modal
        title="新建客户会话"
        open={createOpen}
        okText="创建会话"
        cancelText="取消"
        confirmLoading={createConversation.isPending}
        closable={!createConversation.isPending}
        maskClosable={!createConversation.isPending}
        onOk={() => void submitNewConversation()}
        onCancel={() => {
          if (createConversation.isPending) return;
          createConversation.reset();
          setCreateOpen(false);
          form.resetFields();
        }}
      >
        <Form<CreateConversationInput>
          form={form}
          layout="vertical"
          initialValues={{ channel: 'WEB' }}
          disabled={createConversation.isPending}
        >
          <Form.Item
            label="客户名称"
            name="customerName"
            rules={[
              { required: true, message: '请输入客户名称' },
              { whitespace: true, message: '客户名称不能只包含空格' },
              { max: 100, message: '客户名称最多 100 个字符' },
            ]}
          >
            <Input placeholder="例如：演示客户" autoFocus />
          </Form.Item>

          <Form.Item
            label="接入渠道"
            name="channel"
            rules={[{ required: true, message: '请选择接入渠道' }]}
          >
            <Select
              options={[
                { value: 'WEB', label: '网页' },
                { value: 'APP', label: 'App' },
                { value: 'WECHAT', label: '微信' },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="咨询主题"
            name="topic"
            rules={[{ max: 200, message: '咨询主题最多 200 个字符' }]}
          >
            <Input placeholder="例如：产品使用咨询（选填）" />
          </Form.Item>
        </Form>

        {createConversation.error && (
          <Alert
            type="error"
            showIcon
            message={
              createConversation.error instanceof Error
                ? createConversation.error.message
                : '创建会话失败'
            }
          />
        )}
      </Modal>
    </aside>
  );
}
