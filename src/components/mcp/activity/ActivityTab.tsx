import { useMemo, useState } from 'react';
import { Download, Eraser, Filter, Search, TerminalSquare } from 'lucide-react';
import { clearMcpActivity, exportMcpActivity } from '../../../lib/mcp/client';
import type { McpActivity } from '../../../lib/mcp/types';
import type { WorkspaceRecord } from '../../../types';
import { useMcpStore } from '../../../store/mcpStore';
import type { ToastMessage } from '../../Toast';
import { ActivityDetailDrawer } from './ActivityDetailDrawer';
import '../styles/activity.css';

export function ActivityTab({ workspaces, onToast }: { workspaces: WorkspaceRecord[]; onToast: (message: ToastMessage) => void }) {
  const activity = useMcpStore((state) => state.activity);
  const loadActivity = useMcpStore((state) => state.loadActivity);
  const overview = useMcpStore((state) => state.overview);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [toolName, setToolName] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [approvalDecision, setApprovalDecision] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selected, setSelected] = useState<McpActivity | null>(null);
  const sessions = useMemo(() => [...new Set(activity.map((item) => item.sessionId))], [activity]);
  const query = useMemo(() => ({ search: search || undefined, status: status || undefined, clientId: clientId || undefined, workspaceId: workspaceId || undefined, toolName: toolName || undefined, sessionId: sessionId || undefined, approvalDecision: approvalDecision || undefined, startedAfter: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined, startedBefore: toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined, limit: 1000 }), [approvalDecision, clientId, fromDate, search, sessionId, status, toDate, toolName, workspaceId]);

  const apply = () => void loadActivity(query);
  const exportLogs = async (format: 'csv' | 'jsonl') => {
    try {
      const contents = await exportMcpActivity(format, query);
      const url = URL.createObjectURL(new Blob([contents], { type: format === 'csv' ? 'text/csv' : 'application/x-ndjson' }));
      const link = document.createElement('a'); link.href = url; link.download = `tesapi-mcp-activity.${format}`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { onToast({ title: 'Could not export activity', detail: String(error), tone: 'error' }); }
  };
  const clear = async () => {
    if (!window.confirm('Clear all MCP Activity logs? Client configuration, drafts, and Safety policies are preserved.')) return;
    try { await clearMcpActivity(); await loadActivity(query); setSelected(null); onToast({ title: 'MCP Activity cleared' }); }
    catch (error) { onToast({ title: 'Could not clear activity', detail: String(error), tone: 'error' }); }
  };

  return (
    <div className="mcp-tab-page mcp-activity-page">
      <div className="mcp-section-heading"><div><span className="label-caps">Audit trail</span><h2>Every tool call, in one place</h2><p>Inputs, outputs, errors, and exports are redacted before they reach this log.</p></div><span className="mcp-active-sessions"><i /> {overview?.activeSessions ?? 0} live sessions</span></div>
      <div className="mcp-activity-toolbar">
        <label className="mcp-search"><Search size={13} /><input value={search} placeholder="Search request, tool, client, error…" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') apply(); }} /></label>
        <select aria-label="Client filter" value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">All clients</option>{overview?.clients.flatMap((item) => item.client ? [<option key={item.client.id} value={item.client.id}>{item.displayName}</option>] : [])}</select>
        <select aria-label="Workspace filter" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">All workspaces</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select>
        <select aria-label="Tool filter" value={toolName} onChange={(event) => setToolName(event.target.value)}><option value="">All tools</option>{toolNames.map((item) => <option key={item} value={item}>{shortTool(item)}</option>)}</select>
        <select aria-label="Session filter" value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">All sessions</option>{sessions.map((item) => <option key={item} value={item}>{shortId(item)}</option>)}</select>
        <select aria-label="Status filter" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['completed','denied','awaiting_approval','cancelled','failed'].map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select>
        <select aria-label="Approval filter" value={approvalDecision} onChange={(event) => setApprovalDecision(event.target.value)}><option value="">All approvals</option>{['pending','allow_once','allow_session','deny','cancelled'].map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select>
        <label className="mcp-date-filter"><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="mcp-date-filter"><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button className="mcp-filter-button" onClick={apply}><Filter size={12} /> Apply</button>
        <div className="mcp-toolbar-spacer" />
        <button onClick={() => void exportLogs('jsonl')}><Download size={12} /> JSONL</button><button onClick={() => void exportLogs('csv')}><Download size={12} /> CSV</button><button className="danger-text" onClick={() => void clear()}><Eraser size={12} /> Clear</button>
      </div>
      <div className="mcp-activity-stage">
        <div className="mcp-activity-table-wrap">
          <table className="mcp-activity-table"><thead><tr><th>Time</th><th>Client</th><th>Session</th><th>Tool</th><th>Workspace / collection</th><th>Request</th><th>Duration</th><th>Status</th></tr></thead><tbody>
            {activity.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)}><td>{formatTime(item.startedAt)}</td><td>{item.clientName}</td><td><code>{shortId(item.sessionId)}</code></td><td><code>{shortTool(item.toolName)}</code></td><td>{[item.workspaceId, item.collectionId].filter(Boolean).join(' / ') || '—'}</td><td>{item.requestId ?? item.draftId ?? '—'}</td><td>{item.durationMs == null ? '—' : `${item.durationMs} ms`}</td><td><span className={`mcp-log-status ${item.status}`}>{item.status.replace('_', ' ')}</span></td></tr>)}
          </tbody></table>
          {!activity.length ? <div className="mcp-activity-empty"><TerminalSquare size={24} /><strong>No MCP activity yet</strong><span>Tool calls from configured AI clients will appear here.</span></div> : null}
        </div>
        <ActivityDetailDrawer activity={selected} onClose={() => setSelected(null)} onOpenDraft={(draftId) => window.dispatchEvent(new CustomEvent('tesapi-open-mcp-draft', { detail: draftId }))} />
      </div>
    </div>
  );
}

const shortTool = (tool: string) => tool.replace(/^tesapi_/, '');
const shortId = (id: string) => id.length > 14 ? `${id.slice(0, 7)}…${id.slice(-5)}` : id;
const formatTime = (time: number) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', month: 'short', day: 'numeric' }).format(time);
const toolNames = ['tesapi_list_workspaces','tesapi_list_collections','tesapi_search_requests','tesapi_get_collection_documentation','tesapi_get_request','tesapi_list_environments','tesapi_create_request_draft','tesapi_update_request_draft','tesapi_get_request_draft','tesapi_save_request_draft','tesapi_execute_request'];
