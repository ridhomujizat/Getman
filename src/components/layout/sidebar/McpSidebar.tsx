import { RadioTower } from 'lucide-react';
import { useMcpStore } from '../../../store/mcpStore';
import { SidebarNav } from './SidebarNav';
import type { SidebarView } from './types';

export function McpSidebar({ onViewChange }: { onViewChange: (view: SidebarView) => void }) {
  const overview = useMcpStore((state) => state.overview);
  return (
    <div className="sidebar-pane mcp-sidebar-pane">
      <SidebarNav active="mcp" onChange={onViewChange} />
      <div className="mcp-sidebar-heading"><span>MCP Server</span><i className={overview?.enabled ? 'online' : ''} /></div>
      <div className="mcp-sidebar-summary"><RadioTower size={18} /><strong>{overview?.enabled ? 'Available to clients' : 'Server disabled'}</strong><span>{overview?.activeSessions ?? 0} active sessions</span></div>
      <div className="mcp-sidebar-clients">{overview?.clients.filter((item) => item.configurationStatus === 'configured').map((item) => <div key={item.kind}><i /><span>{item.displayName}</span><small>{item.client?.enabled ? 'enabled' : 'disabled'}</small></div>)}</div>
    </div>
  );
}
