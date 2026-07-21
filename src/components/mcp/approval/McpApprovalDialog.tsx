import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, Check, Clock3, ShieldAlert, X } from 'lucide-react';
import { decideMcpApproval } from '../../../lib/mcp/client';
import { useMcpStore } from '../../../store/mcpStore';
import type { ToastMessage } from '../../Toast';
import '../styles/approval.css';

export function McpApprovalDialog({ workspaceId, onToast }: { workspaceId: string; onToast: (message: ToastMessage) => void }) {
  const approvals = useMcpStore((state) => state.approvals);
  const loadApprovals = useMcpStore((state) => state.loadApprovals);
  const [now, setNow] = useState(Date.now());
  const approval = approvals[0] ?? null;
  useEffect(() => { void loadApprovals(workspaceId); }, [loadApprovals, workspaceId]);
  useEffect(() => { const promise = listen('mcp-approval-changed', () => void loadApprovals(workspaceId)); return () => { void promise.then((unlisten) => unlisten()); }; }, [loadApprovals, workspaceId]);
  useEffect(() => { if (!approval) return; const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, [approval]);
  const seconds = useMemo(() => Math.max(0, Math.ceil(((approval?.expiresAt ?? now) - now) / 1000)), [approval?.expiresAt, now]);
  if (!approval) return null;
  const summary = approval.summary;
  const decide = async (decision: 'allow_once' | 'allow_session' | 'deny') => {
    try { await decideMcpApproval(approval.id, decision); await loadApprovals(workspaceId); }
    catch (error) { onToast({ title: 'Could not decide MCP approval', detail: String(error), tone: 'error' }); }
  };
  return (
    <div className="modal-backdrop mcp-modal-backdrop mcp-approval-backdrop">
      <section className="mcp-approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mcp-approval-title">
        <header><div className="mcp-approval-icon"><ShieldAlert size={19} /></div><div><span className="label-caps">MCP approval</span><h2 id="mcp-approval-title">{summary.action === 'save' ? 'Save request draft?' : 'Execute API request?'}</h2></div><span className="mcp-approval-timer"><Clock3 size={12} /> {seconds}s</span></header>
        <div className="mcp-approval-body"><p><strong>{approval.clientName}</strong> requested <code>{approval.toolName}</code>.</p><div className="mcp-approval-summary"><div><span>Method</span><strong>{String(summary.method ?? summary.action ?? '—').toUpperCase()}</strong></div><div><span>Destination</span><strong>{String(summary.url ?? summary.collectionId ?? '—')}</strong></div><div><span>Environment</span><strong>{String(summary.environmentClass ?? summary.environmentId ?? '—')}</strong></div></div>{approval.riskReasons.length ? <div className="mcp-risk-list"><h3><AlertTriangle size={13} /> Review these risks</h3>{approval.riskReasons.map((risk) => <span key={risk}>{risk.replace(/_/g, ' ')}</span>)}</div> : null}<details><summary>Redacted request details</summary><pre>{JSON.stringify(summary.request ?? summary, null, 2)}</pre></details></div>
        <footer><button className="mcp-deny" onClick={() => void decide('deny')}><X size={13} /> Deny</button><div />{summary.allowSession === true ? <button onClick={() => void decide('allow_session')}>Allow for session</button> : null}<button className="primary" onClick={() => void decide('allow_once')}><Check size={13} /> Allow once</button></footer>
      </section>
    </div>
  );
}
