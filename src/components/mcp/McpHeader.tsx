import { Power, RadioTower, ShieldCheck } from 'lucide-react';
import { setMcpGlobalState } from '../../lib/mcp/client';
import type { McpOverview } from '../../lib/mcp/types';
import { useMcpStore } from '../../store/mcpStore';
import type { ToastMessage } from '../Toast';

export function McpHeader({ overview, onToast }: { overview: McpOverview | null; onToast: (message: ToastMessage) => void }) {
  const loadOverview = useMcpStore((state) => state.loadOverview);
  const toggle = async () => {
    if (!overview) return;
    try {
      await setMcpGlobalState(!overview.enabled, overview.readOnly);
      await loadOverview();
      onToast({ title: overview.enabled ? 'MCP Server disabled' : 'MCP Server enabled' });
    } catch (error) { onToast({ title: 'Could not change MCP Server state', detail: String(error), tone: 'error' }); }
  };

  const status = !overview?.brokerAvailable ? 'Needs attention' : overview.enabled ? 'Available' : 'Disabled';
  return (
    <header className="mcp-page-header">
      <div className="mcp-title-mark"><RadioTower size={18} /><i /></div>
      <div className="mcp-page-heading">
        <span className="label-caps">Local integration</span>
        <h1>MCP Server</h1>
        <p>Let AI clients work with approved API knowledge—without handing them your secrets.</p>
      </div>
      <div className="mcp-header-status">
        <span className={`mcp-status-pill ${status.toLowerCase().replace(' ', '-')}`}><i /> {status}</span>
        <span className="mcp-session-count"><ShieldCheck size={12} /> {overview?.activeSessions ?? 0} active</span>
        <button className={`mcp-power ${overview?.enabled ? 'on' : ''}`} disabled={!overview} onClick={() => void toggle()}><Power size={13} /> {overview?.enabled ? 'Disable' : 'Enable'}</button>
      </div>
    </header>
  );
}
