import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Cloud, Copy, ExternalLink, GitBranch, HardDrive, Plus, Trash2, X } from 'lucide-react';
import { getSetting } from '../../lib/registry';
import type { WorkspaceRecord } from '../../types';
import { WorkspaceDeleteDialog } from './WorkspaceDeleteDialog';

interface Props {
  open: boolean;
  currentId: string;
  initialWorkspaceId?: string;
  workspaces: WorkspaceRecord[];
  onClose: () => void;
  onCreate: () => void;
  onOpenHere: (workspace: WorkspaceRecord) => void;
  onOpenWindow: (workspace: WorkspaceRecord) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAutoCommitChange: (id: string, enabled: boolean) => Promise<void>;
}

const workspaceColor = (id: string) => ['#6E9BFF', '#3FB68B', '#F0A030', '#B98AF0', '#4A9EDE', '#E5534B'][[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6];

export function ManageWorkspacesModal({ open, currentId, initialWorkspaceId, workspaces, onClose, onCreate, onOpenHere, onOpenWindow, onRename, onDelete, onAutoCommitChange }: Props) {
  const [selectedId, setSelectedId] = useState(currentId);
  const [name, setName] = useState('');
  const [autoCommit, setAutoCommit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRecord | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0], [selectedId, workspaces]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(initialWorkspaceId && workspaces.some((item) => item.id === initialWorkspaceId) ? initialWorkspaceId : currentId);
    setError(''); setDeleteTarget(null); setCopied(false);
  }, [currentId, initialWorkspaceId, open]);

  useEffect(() => {
    if (open && !workspaces.some((workspace) => workspace.id === selectedId)) setSelectedId(currentId);
  }, [currentId, open, selectedId, workspaces]);

  useEffect(() => {
    if (!selected) return;
    setName(selected.name); setError(''); setCopied(false);
    if (selected.syncType !== 'git') { setAutoCommit(false); return; }
    let cancelled = false;
    void getSetting<boolean>(`workspace:${selected.id}:autoCommitOnSave`)
      .then((value) => { if (!cancelled) setAutoCommit(value === true); })
      .catch((cause) => { if (!cancelled) setError(String(cause).replace(/^Error:\s*/, '')); });
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !deleteTarget && !busy) onClose(); };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [busy, deleteTarget, onClose, open]);

  if (!open || !selected) return null;
  const isCurrent = selected.id === currentId;
  const canDelete = !isCurrent && workspaces.length > 1;
  const saveName = async () => {
    const next = name.trim();
    if (!next || next === selected.name) return;
    setBusy(true); setError('');
    try { await onRename(selected.id, next); }
    catch (cause) { setError(String(cause).replace(/^Error:\s*/, '')); }
    finally { setBusy(false); }
  };
  const toggleAutoCommit = async () => {
    const next = !autoCommit;
    setBusy(true); setError('');
    try { await onAutoCommitChange(selected.id, next); setAutoCommit(next); }
    catch (cause) { setError(String(cause).replace(/^Error:\s*/, '')); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true); setError('');
    try { await onDelete(deleteTarget.id); setDeleteTarget(null); }
    catch (cause) { setError(String(cause).replace(/^Error:\s*/, '')); setDeleteTarget(null); }
    finally { setBusy(false); }
  };
  const copyPath = async () => {
    try { await navigator.clipboard.writeText(selected.rootPath); setCopied(true); }
    catch (cause) { setError(String(cause).replace(/^Error:\s*/, '')); }
  };

  return <>
    <div className="modal-backdrop workspace-manage-backdrop">
      <section className="manage-workspaces-modal" role="dialog" aria-modal="true" aria-labelledby="manage-workspaces-title">
        <header><div><h2 id="manage-workspaces-title">Manage workspaces</h2><p>Choose a workspace, then update how TesAPI uses it.</p></div><button aria-label="Close workspace manager" disabled={busy} onClick={onClose}><X size={14} /></button></header>
        <div className="workspace-manager-body">
          <aside>
            <div className="workspace-manager-list">{workspaces.map((workspace) => <button key={workspace.id} className={workspace.id === selected.id ? 'selected' : ''} onClick={() => setSelectedId(workspace.id)}>
              <span className="workspace-avatar" style={{ '--workspace-color': workspaceColor(workspace.id) } as React.CSSProperties}>{workspace.name.charAt(0).toUpperCase()}</span>
              <span><b>{workspace.name}</b><small>{workspace.syncType === 'git' ? workspace.gitBranch ?? 'Git workspace' : workspace.syncType === 'cloud' ? 'Cloud workspace' : 'Local workspace'}</small></span>
              {workspace.id === currentId && <i>Active</i>}
            </button>)}</div>
            <button className="workspace-manager-create" onClick={onCreate}><Plus size={13} /> Create workspace</button>
          </aside>
          <main>
            <section className="workspace-manager-identity">
              <span className="workspace-avatar large" style={{ '--workspace-color': workspaceColor(selected.id) } as React.CSSProperties}>{selected.name.charAt(0).toUpperCase()}</span>
              <div><strong>{selected.name}</strong><span>{isCurrent ? 'Active in this window' : 'Available workspace'}</span></div>
              {!isCurrent && <button className="workspace-manager-switch" onClick={() => onOpenHere(selected)}>Switch <ArrowRight size={13} /></button>}
            </section>
            <div className="workspace-manager-fields">
              <label className="workspace-field"><span>Workspace name</span><div className="workspace-manager-name"><input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveName(); }} /><button disabled={busy || !name.trim() || name.trim() === selected.name} onClick={() => void saveName()}>Save</button></div></label>
              <section className="workspace-manager-card"><span>{selected.syncType === 'git' ? <GitBranch size={14} /> : selected.syncType === 'cloud' ? <Cloud size={14} /> : <HardDrive size={14} />}</span><div><b>{selected.syncType === 'git' ? 'Git workspace' : selected.syncType === 'cloud' ? 'Cloud workspace' : 'Local workspace'}</b><small>{selected.syncType === 'git' ? `Branch: ${selected.gitBranch ?? 'main'}` : selected.syncType === 'cloud' ? 'Collections sync through TesAPI Sync' : 'Stored only on this device'}</small></div></section>
              <label className="workspace-field"><span>Workspace folder <small>{copied ? 'Copied' : 'Files remain here if removed'}</small></span><div className="workspace-manager-path"><code>{selected.rootPath}</code><button title="Copy workspace path" onClick={() => void copyPath()}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></div></label>
              {selected.syncType === 'git' && <><label className="workspace-field"><span>Repository</span><div className="workspace-manager-readonly mono">{selected.gitRemote || 'No remote configured'}</div></label><button className="workspace-manager-setting" role="switch" aria-checked={autoCommit} disabled={busy} onClick={() => void toggleAutoCommit()}><span><b>Auto-commit on save</b><small>Commit each saved request automatically.</small></span><i className={autoCommit ? 'enabled' : ''}><em /></i></button></>}
            </div>
            {error && <div className="save-modal-error">{error}</div>}
            <footer><button className="workspace-manager-open-window" onClick={() => onOpenWindow(selected)}><ExternalLink size={13} /> Open in new window</button><button className="danger-outline" disabled={!canDelete || busy} title={isCurrent ? 'Switch to another workspace before removing this one.' : workspaces.length === 1 ? 'TesAPI needs at least one workspace.' : 'Remove workspace'} onClick={() => setDeleteTarget(selected)}><Trash2 size={13} /> Remove workspace</button></footer>
          </main>
        </div>
      </section>
    </div>
    <WorkspaceDeleteDialog workspace={deleteTarget} busy={busy} onCancel={() => setDeleteTarget(null)} onConfirm={() => void remove()} />
  </>;
}
