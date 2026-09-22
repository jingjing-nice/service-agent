import { Avatar, Badge, Button, Tooltip } from 'antd';
import {
  BookOutlined,
  CustomerServiceOutlined,
  DollarOutlined,
  SettingOutlined,
} from '@ant-design/icons';

type WorkbenchRailProps = {
  onOpenKnowledge: () => void;
  onOpenRefunds: () => void;
};

export function WorkbenchRail({ onOpenKnowledge, onOpenRefunds }: WorkbenchRailProps) {
  return (
    <aside className="rail">
      <div className="logo">Z</div>
      <nav>
        <Tooltip title="工作台" placement="right">
          <Button type="text" className="active" icon={<CustomerServiceOutlined />} />
        </Tooltip>
        <Tooltip title="知识库" placement="right">
          <Button type="text" onClick={onOpenKnowledge} icon={<BookOutlined />} />
        </Tooltip>
        <Tooltip title="退款审批" placement="right">
          <Button type="text" onClick={onOpenRefunds} icon={<DollarOutlined />} />
        </Tooltip>
      </nav>
      <div>
        <Button type="text" icon={<SettingOutlined />} />
        <Avatar size={34}>林</Avatar>
      </div>
    </aside>
  );
}
