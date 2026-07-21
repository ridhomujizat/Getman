import { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { listMcpWorkspaceCollections, listMcpWorkspaceEnvironments, setMcpClientAccess, setMcpGlobalState, setMcpSafetySettings, upsertMcpPolicy } from '../../../lib/mcp/client';
import type { CollectionOption, EnvironmentOption, McpCapability, McpPolicy, McpSafetySettings, PolicyInput } from '../../../lib/mcp/types';
import type { WorkspaceRecord } from '../../../types';
import { useMcpStore } from '../../../store/mcpStore';
import type { ToastMessage } from '../../Toast';
import { ScopeAccess } from './ScopeAccess';
import { DataProtectionControls } from './DataProtectionControls';
import '../styles/safety.css';

interface Props { currentWorkspace: WorkspaceRecord; workspaces: WorkspaceRecord[]; onToast: (message: ToastMessage) => void }

export function SafetyTab({ currentWorkspace, workspaces, onToast }: Props) {
  const overview = useMcpStore((state) => state.overview);
  const policies = useMcpStore((state) => state.policies);
  const refresh = useMcpStore((state) => state.refresh);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(currentWorkspace.id);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentOption[]>([]);
  const selectedWorkspace = useMemo(() => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? currentWorkspace, [currentWorkspace, selectedWorkspaceId, workspaces]);

  useEffect(() => {
    void Promise.all([listMcpWorkspaceCollections(selectedWorkspace.id), listMcpWorkspaceEnvironments(selectedWorkspace.id)])
      .then(([nextCollections, nextEnvironments]) => { setCollections(nextCollections); setEnvironments(nextEnvironments); })
      .catch((error) => onToast({ title: 'Could not load workspace access', detail: String(error), tone: 'error' }));
  }, [onToast, selectedWorkspace.id]);

  const setGlobal = async (enabled: boolean, readOnly: boolean) => {
    try { await setMcpGlobalState(enabled, readOnly); await refresh(currentWorkspace.id); }
    catch (error) { onToast({ title: 'Could not update MCP safety', detail: String(error), tone: 'error' }); }
  };
  const saveSafety = async (settings: McpSafetySettings) => {
    try { await setMcpSafetySettings(settings); await refresh(currentWorkspace.id); onToast({ title: 'MCP protection settings saved' }); }
    catch (error) { onToast({ title: 'Could not update protection settings', detail: String(error), tone: 'error' }); throw error; }
  };
  const savePolicy = async (scope: Partial<McpPolicy>, patch: Partial<McpPolicy>) => {
    const existing = policies.find((item) => item.clientId === (scope.clientId ?? null) && item.workspaceId === (scope.workspaceId ?? null) && item.collectionId === (scope.collectionId ?? null) && item.environmentId === (scope.environmentId ?? null));
    const input: PolicyInput = { id: existing?.id ?? null, clientId: scope.clientId ?? null, workspaceId: scope.workspaceId ?? null, collectionId: scope.collectionId ?? null, environmentId: scope.environmentId ?? null, capability: patch.capability ?? existing?.capability ?? 'read', environmentClass: patch.environmentClass ?? existing?.environmentClass ?? null, environmentUse: patch.environmentUse ?? existing?.environmentUse ?? null, approvalMode: patch.approvalMode ?? existing?.approvalMode ?? null };
    try { await upsertMcpPolicy(input); await refresh(currentWorkspace.id); }
    catch (error) { onToast({ title: 'Could not update access policy', detail: String(error), tone: 'error' }); }
  };
  const workspacePolicy = policies.find((item) => item.workspaceId === selectedWorkspace.id && item.collectionId == null && item.environmentId == null && item.clientId == null);

  return (
    <div className="mcp-tab-page mcp-safety-page">
      <div className="mcp-section-heading"><div><span className="label-caps">Trust boundary</span><h2>Permission should feel deliberate</h2><p>Every scope can reduce access. Approval never overrides an explicit deny.</p></div><span className="mcp-safe-default"><ShieldCheck size={13} /> Deny by default</span></div>
      <section className="mcp-safety-global">
        <div className="mcp-global-card"><div className="mcp-global-icon"><EyeOff size={17} /></div><div><strong>Read-only mode</strong><span>Allow discovery and inspection; reject drafts, saves, and execution.</span></div><label className="mcp-toggle"><input type="checkbox" checked={overview?.readOnly ?? true} onChange={(event) => { const next = event.target.checked; if (!next && !window.confirm('Disable read-only mode? Workspace and client permissions still apply, but approved drafts and requests may change data.')) return; void setGlobal(overview?.enabled ?? false, next); }} /><span /></label></div>
        <div className="mcp-global-card"><div className="mcp-global-icon"><AlertOctagon size={17} /></div><div><strong>Emergency stop</strong><span>Disable new calls, revoke live sessions, and deny pending approvals.</span></div><button className="mcp-emergency" onClick={() => void setGlobal(false, true)}>Stop MCP</button></div>
      </section>
      <section className="mcp-client-access"><div className="mcp-subheading"><LockKeyhole size={15} /><div><h3>Client ceilings</h3><p>A client cannot exceed this maximum, even when a workspace allows more.</p></div></div><div className="mcp-client-access-grid">{overview?.clients.filter((item) => item.client).map((item) => <article key={item.client!.id}><div><strong>{item.displayName}</strong><span>{item.client!.lastSeenAt ? `Last seen ${new Date(item.client!.lastSeenAt!).toLocaleString()}` : 'Never connected'}</span></div><label className="mcp-switch-label"><input type="checkbox" checked={item.client!.enabled} onChange={async (event) => { try { await setMcpClientAccess(item.client!.id, event.target.checked, item.client!.capability); await refresh(currentWorkspace.id); } catch (error) { onToast({ title: 'Could not update client', detail: String(error), tone: 'error' }); } }} /><span /> Enabled</label><select value={item.client!.capability} onChange={async (event) => { try { await setMcpClientAccess(item.client!.id, item.client!.enabled, event.target.value as McpCapability); await refresh(currentWorkspace.id); } catch (error) { onToast({ title: 'Could not update client', detail: String(error), tone: 'error' }); } }}><option value="read">Read</option><option value="draft">Draft</option><option value="execute">Execute</option></select></article>)}</div></section>
      {overview ? <DataProtectionControls settings={overview.safety} onSave={saveSafety} /> : null}
      <section className="mcp-workspace-access"><div className="mcp-workspace-picker"><span>Configure workspace</span><select value={selectedWorkspace.id} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></div><ScopeAccess workspace={selectedWorkspace} workspacePolicy={workspacePolicy} collections={collections} environments={environments} policies={policies} onWorkspaceChange={(capability) => void savePolicy({ workspaceId: selectedWorkspace.id }, { capability })} onCollectionChange={(collectionId, capability) => void savePolicy({ workspaceId: selectedWorkspace.id, collectionId }, { capability })} onEnvironmentChange={(environmentId, patch) => void savePolicy({ workspaceId: selectedWorkspace.id, environmentId }, { ...patch, capability: workspacePolicy?.capability ?? 'read' })} /></section>
    </div>
  );
}
