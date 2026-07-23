import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Cloud, FolderOpen, GitBranch, HardDrive, Info, Plus, X } from 'lucide-react';
import { defaultWorkspacePath, type CreateWorkspaceInput } from '../../lib/registry';
import type { WorkspaceRecord } from '../../types';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreate: (input: CreateWorkspaceInput) => Promise<WorkspaceRecord>;
  onCreated: (workspace: WorkspaceRecord) => void;
}

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';

export function CreateWorkspaceModal({ open: visible, onCancel, onCreate, onCreated }: Props) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [syncType, setSyncType] = useState<'local' | 'git' | 'cloud'>('git');
  const [gitRemote, setGitRemote] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [connectionUrl, setConnectionUrl] = useState('');
  const [autoLocation, setAutoLocation] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!visible) return;
    setName(''); setSyncType('git'); setGitRemote(''); setGitBranch('main'); setConnectionUrl(''); setError(''); setAutoLocation(true);
    void defaultWorkspacePath('workspace').then(setLocation);
    window.setTimeout(() => nameRef.current?.focus(), 30);
  }, [visible]);

  useEffect(() => {
    if (!visible || !autoLocation) return;
    const timer = window.setTimeout(() => { void defaultWorkspacePath(slugify(name)).then(setLocation); }, 100);
    return () => window.clearTimeout(timer);
  }, [autoLocation, name, visible]);

  if (!visible) return null;
  const browse = async () => {
    const selected = await open({ directory: true, multiple: false, title: 'Choose TesAPI workspace folder' });
    if (selected) { setLocation(selected); setAutoLocation(false); }
  };
  const submit = async () => {
    if (!name.trim()) { setError('Workspace name is required.'); nameRef.current?.focus(); return; }
    if (!location.trim()) { setError('Workspace location is required.'); return; }
    if (syncType === 'cloud' && !connectionUrl.trim()) { setError('Cloud connection URL is required.'); return; }
    setCreating(true); setError('');
    try {
      onCreated(await onCreate({ name: name.trim(), rootPath: location.trim(), syncType, gitRemote: syncType === 'git' ? gitRemote.trim() : undefined, gitBranch: syncType === 'git' ? gitBranch.trim() || 'main' : undefined, connectionUrl: syncType === 'cloud' ? connectionUrl.trim() : undefined, deviceName: 'TesAPI desktop' }));
    } catch (cause) {
      setError(String(cause).replace(/^Error:\s*/, ''));
    } finally {
      setCreating(false);
    }
  };

  return <div className="modal-backdrop workspace-create-backdrop">
    <section className="create-workspace-modal" role="dialog" aria-modal="true" aria-labelledby="create-workspace-title">
      <header><div><h2 id="create-workspace-title">Create workspace</h2><p>A workspace holds its own collections, environments and history.</p></div><button aria-label="Close create workspace" disabled={creating} onClick={onCancel}><X size={14} /></button></header>
      <div className="create-workspace-body">
        <label className="workspace-field"><span>Workspace name</span><input ref={nameRef} value={name} placeholder="Mobile Team API" onChange={(event) => setName(event.target.value)} /></label>
        <label className="workspace-field"><span>Location <small>Workspace files are stored in this folder</small></span><div className="workspace-location"><input value={location} onChange={(event) => { setLocation(event.target.value); setAutoLocation(false); }} /><button type="button" onClick={() => void browse()}><FolderOpen size={13} /> Browse…</button></div></label>
        <section className="workspace-sync-section"><div className="workspace-sync-heading"><span>Sync method</span><small>You can change this later</small></div><div className="workspace-sync-cards">
          <button className={syncType === 'local' ? 'selected' : ''} onClick={() => setSyncType('local')}><span><i>{syncType === 'local' && <b />}</i><HardDrive size={14} /> Local only</span><small>Keep everything on this device. No sync.</small></button>
          <button className={syncType === 'git' ? 'selected' : ''} onClick={() => setSyncType('git')}><span><i>{syncType === 'git' && <b />}</i><GitBranch size={14} /> Git</span><small>Sync to a Git repository you control.</small></button>
          <button className={syncType === 'cloud' ? 'selected' : ''} onClick={() => setSyncType('cloud')}><span><i>{syncType === 'cloud' && <b />}</i><Cloud size={14} /> Cloud</span><small>Connect with a one-time TesAPI Sync URL.</small></button>
        </div></section>
        {syncType === 'git' && <section className="workspace-git-config"><label className="workspace-field"><span>Repository URL <small>Optional</small></span><input className="mono" value={gitRemote} placeholder="git@github.com:acme/mobile-team-api.git" onChange={(event) => setGitRemote(event.target.value)} /></label><div className="workspace-git-row"><label className="workspace-field"><span>Branch</span><input className="mono" value={gitBranch} onChange={(event) => setGitBranch(event.target.value)} /></label><p><Info size={12} /> Saves stay local until you commit or sync them.</p></div></section>}
        {syncType === 'cloud' && <section className="workspace-git-config"><label className="workspace-field"><span>Connection URL <small>Single use</small></span><input className="mono" value={connectionUrl} placeholder="https://sync.example.com/connect#enrollment=..." onChange={(event) => setConnectionUrl(event.target.value)} /></label><p><Info size={12} /> The enrollment secret is exchanged once and the device credential is stored in your system keychain.</p></section>}
        {error && <div className="save-modal-error">{error}</div>}
      </div>
      <footer><button className="modal-cancel" disabled={creating} onClick={onCancel}>Cancel</button><button className="modal-save" disabled={creating || !name.trim() || !location.trim() || (syncType === 'cloud' && !connectionUrl.trim())} onClick={() => void submit()}>{creating ? <span className="spinner" /> : <Plus size={14} />}{creating ? 'Creating…' : 'Create workspace'}</button></footer>
    </section>
  </div>;
}
