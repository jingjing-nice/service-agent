import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Button,
  Input,
  Modal,
  Segmented,
  Tag,
  Tooltip,
  message as toast,
} from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CustomerServiceOutlined,
  EllipsisOutlined,
  MenuOutlined,
  PaperClipOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UserSwitchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { conversationApi } from '../api/conversations';
import type { ConversationStatus, LocalMessage } from '../types/conversation';
import { useLlmStream } from '../hooks';
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

export function WorkbenchPage() {
  // 只控制中间消息区域的滚动，不影响左右两侧面板。
  const messagesRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState('全部');
  const [keyword, setKeyword] = useState('');
  const [input, setInput] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const {
    activeId,
    status,
    detailOpen,
    streamingText,
    streamError,
    select,
    setStatus,
    toggleDetail,
    localMessages,
    addUserMessage,
  } = useWorkbenchStore();

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: conversationApi.list,
  });

  // 历史消息是数组，与当前正在生成的 streamingText 分开保存。
  const { data: messages = [] } = useQuery({
    queryKey: ['messages', activeId],
    queryFn: () => conversationApi.messages(activeId),
  });

  /**
 * 后端消息放在前面，当前临时消息放在后面。
 * 后端刷新完成后 localMessages 会被清空，
 * 因此最后只保留后端正式消息。
 */
  const displayedMessages = [
    ...messages,
    ...localMessages,
  ];

  const active =
    conversations.find((item) => item.id === activeId) ?? conversations[0];

  const visible = useMemo(
    () =>
      conversations.filter(
        (item) =>
          item.name.includes(keyword) &&
          (filter === '全部' ||
            (filter === '待处理' &&
              ['idle', 'streaming'].includes(item.state)) ||
            (filter === '人工中' && item.state === 'human_takeover')),
      ),
    [conversations, filter, keyword],
  );

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

  // 历史消息加载完成或 AI 返回新内容时，自动保持在消息列表底部。
  useEffect(() => {
    const messagesElement = messagesRef.current;

    if (!messagesElement) {
      return;
    }

    messagesElement.scrollTo({
      top: messagesElement.scrollHeight,
      behavior: status === 'streaming' ? 'auto' : 'smooth',
    });
  }, [displayedMessages.length, status, streamingText]);

  // useLlmStream 负责处理 SSE 流式返回的 AI 回复内容。
  const { startNewStream, stopStream } = useLlmStream();

  const send = () => {
    const question = input.trim();

    if (!question || status === 'streaming') {
      return;
    }
    // 先让用户消息立即显示在页面中。
    addUserMessage(question);
    // 清空输入框。
    setInput('');

    // 再请求 AI 回答。
    startNewStream(activeId, question);
  };
  return (
    <div className={`workbench ${detailOpen ? '' : 'detail-hidden'}`}>
      <aside className="rail">
        <div className="logo">Z</div>
        <nav>
          <Tooltip title="工作台" placement="right">
            <Button
              type="text"
              className="active"
              icon={<CustomerServiceOutlined />}
            />
          </Tooltip>
          <Tooltip title="知识库" placement="right">
            <Button type="text" icon={<BookOutlined />} />
          </Tooltip>
          <Tooltip title="审批中心" placement="right">
            <Badge dot>
              <Button type="text" icon={<CheckCircleOutlined />} />
            </Badge>
          </Tooltip>
          <Tooltip title="应用" placement="right">
            <Button type="text" icon={<AppstoreOutlined />} />
          </Tooltip>
        </nav>
        <div>
          <Button type="text" icon={<SettingOutlined />} />
          <Avatar size={34}>林</Avatar>
        </div>
      </aside>
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
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Segmented
          block
          options={['全部', '待处理', '人工中']}
          value={filter}
          onChange={(v) => setFilter(String(v))}
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
                  {item.state === 'human_takeover' && (
                    <Tag color="orange">人工接管</Tag>
                  )}
                </div>
                <p>{item.preview}</p>
              </div>
              {item.unread && <Badge count={item.unread} />}
            </button>
          ))}
        </div>
      </aside>
      <main className="chat">
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
            <Button
              type="primary"
              icon={<UserSwitchOutlined />}
              onClick={takeover}
            >
              {status === 'human_takeover' ? '交还 AI' : '接管会话'}
            </Button>
            <Button icon={<EllipsisOutlined />} onClick={toggleDetail} />
          </div>
        </header>
        <div className="agent-notice">
          <ThunderboltOutlined />
          <div>
            <strong>Agent 已识别意图：退款进度查询</strong>
            <p>将调用订单与退款查询工具，当前无需人工审批</p>
          </div>
        </div>
        <section className="messages" ref={messagesRef}>
          {/* <div className="day">
            <span>今天 10:34</span>
          </div> */}
          {/* 渲染本次打开页面后新增的用户消息和已经完成的 AI 回复。 */}
          {displayedMessages.map((item: LocalMessage) => (
            <article key={item.id} className={item.role}>
              <div className="sender">
                {item.role === 'agent' && (
                  <>
                    <span className="agent-icon">✦</span>
                    <b>智能客服 Agent</b>
                    <Tag>AI</Tag>
                  </>
                )}
              </div>
              {item.id === 'm4' && (
                <div className="tool-card">
                  <div>
                    <CheckCircleOutlined />
                    <span>
                      <b>已完成 2 项业务查询</b>
                      <small>订单状态 · 退款进度 · 耗时 1.8 秒</small>
                    </span>
                  </div>
                </div>
              )}
              <div className="bubble">
                {item.content}
                {item.citations?.map((c) => (
                  <button
                    className="citation"
                    key={c.title}
                    onClick={() => setSourceOpen(true)}
                  >
                    <BookOutlined />
                    <span>
                      <b>{c.title}</b>
                      <small>{c.source}</small>
                    </span>
                    <em>查看</em>
                  </button>
                ))}
              </div>
              <time>{item.time} · 已送达</time>
            </article>
          ))}
          {streamingText && (
            // AI 生成期间单独渲染 streamingText，实现文字逐步出现的效果。
            <article className="agent">
              <div className="sender">
                <span className="agent-icon">✦</span>
                <b>智能客服 Agent</b>
                <Tag>AI</Tag>
              </div>
              <div className="bubble">
                {streamingText}
                {status === 'streaming' && <span className="stream-cursor" />}
              </div>
              {status === 'completed' && <time>刚刚 · 已完成</time>}
            </article>
          )}
          {status === 'streaming' && !streamingText && (
            <div className="streaming">
              <span />
              <span />
              <span /> Agent 正在生成回复
            </div>
          )}
          {status === 'failed' && streamError && (
            <div className="stream-error">AI 回复失败：{streamError}</div>
          )}
        </section>
        <footer>
          {status === 'human_takeover' && (
            <div className="takeover">
              <i />
              你正在人工接管此会话
            </div>
          )}
          <div className="composer">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder="回复客户，按 Enter 发送…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div>
              <span>
                <Button type="text" icon={<PaperClipOutlined />} />
                <Button type="text" icon={<ThunderboltOutlined />} />
              </span>
              <span className="mode">
                <i />
                {status === 'human_takeover' ? '人工回复' : 'AI 自动回复'}
              </span>
              {status === 'streaming' ? (
                // 生成期间把发送按钮切换成停止按钮。
                <Button
                  danger
                  type="primary"
                  shape="circle"
                  icon={<StopOutlined />}
                  onClick={stopStream}
                  aria-label="停止生成"
                />
              ) : (
                // 没有生成任务时显示普通的发送按钮。
                <Button
                  type="primary"
                  shape="circle"
                  icon={<SendOutlined />}
                  onClick={send}
                  aria-label="发送消息"
                />
              )}
            </div>
          </div>
          <small>AI 生成内容可能存在误差，请结合业务信息判断</small>
        </footer>
      </main>
      {/* 右侧 */}
      <aside className="detail">
        <div className="detail-tabs">
          <b>客户信息</b>
          <Button type="text" onClick={toggleDetail}>
            ×
          </Button>
        </div>
        {/* <section className="profile">
          <Avatar size={58}>{active?.name[0]}</Avatar>
          <h3>{active?.name}</h3>
          <p>
            <Tag color="gold">金牌会员</Tag> 客户 2 年
          </p>
          <Button block>查看完整档案</Button>
        </section> */}
        <Info title="基础信息">
          <dl>
            <div>
              <dt>客户编号</dt>
              <dd>CUS-204856</dd>
            </div>
            <div>
              <dt>联系电话</dt>
              <dd>138****6280</dd>
            </div>
            <div>
              <dt>所属企业</dt>
              <dd>澄明科技</dd>
            </div>
          </dl>
        </Info>
        <Info title="相关订单">
          <div className="order">
            <span>订单 #202408180032</span>
            <Tag color="gold">退款中</Tag>
            <strong>¥ 2,899.00</strong>
            <p>企业协作套件 · 年度订阅</p>
          </div>
        </Info>
        <Info title="会话摘要">
          <p className="summary">
            客户咨询订单退款到账时间。退款已原路退回，预计 8 月 27
            日前到账。客户情绪平稳，暂无人工介入需要。
          </p>
          <div className="sentiment">
            情绪 <b>平稳</b>
            <span>
              <i />
            </span>
            <em>72</em>
          </div>
        </Info>
      </aside>
      <Modal
        title="退款处理规则"
        open={sourceOpen}
        footer={null}
        onCancel={() => setSourceOpen(false)}
      >
        <p className="source">售后服务规范 · 2024.08 版本 · 第 3.2 节</p>
        <blockquote>
          退款审核通过后，将原路退回至客户支付账户。银行或支付机构的处理周期通常为
          3–5 个工作日。
        </blockquote>
      </Modal>
    </div>
  );
}
function Info({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="info">
      <h4>{title}</h4>
      {children}
    </section>
  );
}
