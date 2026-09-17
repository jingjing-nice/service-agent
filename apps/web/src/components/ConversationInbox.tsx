import { useMemo, useState } from 'react';
import { Avatar, Badge, Button, Input, Segmented, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { Conversation } from '../types/conversation';
import { useWorkbenchStore } from '../stores';

type ConversationInboxProps = {
  conversations: Conversation[];
};

export function ConversationInbox({ conversations }: ConversationInboxProps) {
  const [filter, setFilter] = useState('全部');
  const [keyword, setKeyword] = useState('');
  const activeId = useWorkbenchStore((state) => state.activeId);
  const select = useWorkbenchStore((state) => state.select);

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
        <Button shape="circle">＋</Button>
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
    </aside>
  );
}
