import { AlertTriangle, Clock3, ShieldCheck, X } from 'lucide-react';
import type { McpActivity } from '../../../lib/mcp/types';

export function ActivityDetailDrawer({ activity, onClose, onOpenDraft }: { activity: McpActivity | null; onClose: () => void; onOpenDraft: (id: string) => void }) {
  if (!activity) return null;
  return (
    <aside className="mcp-activity-drawer" aria-label="MCP activity details">
      <header><div><span className="label-caps">Tool activity</span><h3>{activity.toolName}</h3></div><button aria-label="Close details" onClick={onClose}><X size={15} /></button></header>
      <div className="mcp-detail-status"><span className={`mcp-log-status ${activity.status}`}>{activity.status}</span><span><Clock3 size={12} /> {activity.durationMs ?? '—'} ms</span></div>
      {activity.draftId ? <button className="mcp-open-draft" onClick={() => onOpenDraft(activity.draftId!)}>Open draft in TesAPI</button> : null}
      <dl>
        <div><dt>Client</dt><dd>{activity.clientName}</dd></div><div><dt>Session</dt><dd><code>{activity.sessionId}</code></dd></div><div><dt>Started</dt><dd>{new Date(activity.startedAt).toLocaleString()}</dd></div><div><dt>Workspace</dt><dd>{activity.workspaceId ?? '—'}</dd></div><div><dt>Collection</dt><dd>{activity.collectionId ?? '—'}</dd></div><div><dt>Request</dt><dd>{activity.requestId ?? activity.draftId ?? '—'}</dd></div>
      </dl>
      {activity.policyReasons.length ? <section><h4><ShieldCheck size={13} /> Policy reasons</h4><div className="mcp-reason-list">{activity.policyReasons.map((reason) => <span key={reason}>{reason.replace(/_/g, ' ')}</span>)}</div></section> : null}
      {activity.approvalId ? <section><h4><ShieldCheck size={13} /> Approval</h4><dl className="mcp-approval-detail"><div><dt>Decision</dt><dd>{activity.approvalDecision?.replace(/_/g, ' ') ?? 'pending'}</dd></div><div><dt>Requested</dt><dd>{activity.approvalRequestedAt ? new Date(activity.approvalRequestedAt).toLocaleString() : '—'}</dd></div><div><dt>Decided</dt><dd>{activity.approvalDecidedAt ? new Date(activity.approvalDecidedAt).toLocaleString() : '—'}</dd></div></dl></section> : null}
      {activity.errorCode ? <section className="mcp-error-detail"><h4><AlertTriangle size={13} /> {activity.errorCode}</h4><p>{activity.errorDetail}</p></section> : null}
      <section><h4>Redacted input</h4><pre>{JSON.stringify(activity.inputSummary, null, 2)}</pre></section>
      <section><h4>Redacted output</h4><pre>{JSON.stringify(activity.outputSummary, null, 2)}</pre></section>
    </aside>
  );
}
