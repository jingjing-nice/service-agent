import { Button, Tag } from 'antd';
import type { ReactNode } from 'react';
import { useWorkbenchStore } from '../stores';

export function CustomerDetails() {
  const toggleDetail = useWorkbenchStore((state) => state.toggleDetail);

  return (
    <aside className="detail">
      <div className="detail-tabs">
        <b>客户信息</b>
        <Button type="text" onClick={toggleDetail}>×</Button>
      </div>
      <Info title="基础信息">
        <dl>
          <div><dt>客户编号</dt><dd>CUS-204856</dd></div>
          <div><dt>联系电话</dt><dd>138****6280</dd></div>
          <div><dt>所属企业</dt><dd>澄明科技</dd></div>
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
          <span><i /></span>
          <em>72</em>
        </div>
      </Info>
    </aside>
  );
}

function Info({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="info">
      <h4>{title}</h4>
      {children}
    </section>
  );
}
