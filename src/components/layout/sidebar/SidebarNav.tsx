import { Folder, History, Layers3, RadioTower } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SidebarView } from './types';

interface Props {
  active: SidebarView;
  onChange: (view: SidebarView) => void;
  action?: ReactNode;
}

export function SidebarNav({ active, onChange, action }: Props) {
  return (
    <div className="sidebar-header">
      <button className={`icon-button${active === 'collections' ? ' active' : ''}`} title="Collections" onClick={() => onChange('collections')}><Folder size={15} /></button>
      <button className={`icon-button${active === 'history' ? ' active' : ''}`} title="History" onClick={() => onChange('history')}><History size={15} /></button>
      <button className={`icon-button${active === 'environments' ? ' active' : ''}`} title="Environments" onClick={() => onChange('environments')}><Layers3 size={15} /></button>
      <button className={`icon-button${active === 'mcp' ? ' active' : ''}`} title="MCP Server" onClick={() => onChange('mcp')}><RadioTower size={15} /></button>
      {action}
    </div>
  );
}
