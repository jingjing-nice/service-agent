import { Avatar, Badge, Button, Tooltip } from 'antd';
import {
  BookOutlined,
  CustomerServiceOutlined,
  SettingOutlined,
} from '@ant-design/icons';

type WorkbenchRailProps = {
  onOpenKnowledge: () => void;
};

export function WorkbenchRail({ onOpenKnowledge }: WorkbenchRailProps) {
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
      </nav>
      <div>
        <Button type="text" icon={<SettingOutlined />} />
        <Avatar size={34}>林</Avatar>
      </div>
    </aside>
  );
}
