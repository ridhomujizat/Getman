import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Cloud, ExternalLink, GitBranch, HardDrive, Plus, RefreshCw, Replace, Settings2, SquarePen } from 'lucide-react';
import type { WorkspaceRecord } from '../../types';

interface Props {
  current: WorkspaceRecord;
  workspaces: WorkspaceRecord[];
  onCreate: () => void;
  onOpenHere: (workspace: WorkspaceRecord) => void;
  onOpenWindow: (workspace: WorkspaceRecord) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onManage: (workspace?: WorkspaceRecord) => void;
  onGitMenu?: () => void;
  gitDirtyCount?: number;
  gitBusy?: boolean;
  gitBranch?: string;
}

const colors = ['#6E9BFF', '#3FB68B', '#F0A030', '#B98AF0', '#4A9EDE', '#E5534B'];
const avatarColor = (id: string) => colors[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length];

export function WorkspaceSwitcher({ current, workspaces, onCreate, onOpenHere, onOpenWindow, onRename, onManage, onGitMenu, gitDirtyCount = 0, gitBusy = false, gitBranch }: Props) {
  const [open, setOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, workspaces.findIndex((item) => item.id === current.id)));
  const [context, setContext] = useState<{ x: number; y: number; workspace: WorkspaceRecord } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const recents = useMemo(() => workspaces.filter((item) => item.id !== current.id).slice(0, 5), [current.id, workspaces]);

  useEffect(() => {
    if (!open && !context) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); setContext(null); }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [context, open]);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + workspaces.length) % workspaces.length);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const target = workspaces[activeIndex];
        if (!target || target.id === current.id) return;
        if (event.metaKey || event.ctrlKey) onOpenWindow(target); else onOpenHere(target);
        setOpen(false);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [activeIndex, current.id, onOpenHere, onOpenWindow, open, workspaces]);

  const startRename = (workspace: WorkspaceRecord) => {
    setEditing(workspace.id);
    setName(workspace.name);
    setContext(null);
  };
  const finishRename = async (workspace: WorkspaceRecord) => {
    const next = name.trim();
    setEditing(null);
    if (next && next !== workspace.name) await onRename(workspace.id, next);
  };

  return <div className="workspace-switcher" ref={rootRef}>
    <div className="workspace-bar">
      <button className="workspace-trigger" aria-expanded={open} onClick={() => { setOpen((value) => !value); setRecentOpen(false); }}>
        <span className="workspace-avatar" style={{ '--workspace-color': avatarColor(current.id) } as React.CSSProperties}>{current.name.charAt(0).toUpperCase()}</span>
        <span className="workspace-current-name">{current.name}</span><ChevronsUpDown size={13} />
      </button>
      {current.syncType === 'git' ? <button className={`workspace-sync-badge git-trigger${gitDirtyCount ? ' dirty' : ''}`} onClick={onGitMenu} title="Git workspace menu"><GitBranch size={11} />{gitBranch ?? current.gitBranch ?? 'main'}{gitBusy ? <span className="spinner tiny-spinner" /> : gitDirtyCount > 0 ? <b>{gitDirtyCount}</b> : null}</button> : <span className="workspace-sync-badge">{current.syncType === 'cloud' ? <Cloud size={11} /> : <HardDrive size={11} />}{current.syncType}</span>}
    </div>
    {open && <div className="workspace-popover" role="menu">
      <div className="workspace-popover-label">WORKSPACES</div>
      <div className="workspace-list">{workspaces.map((workspace, index) => {
        const isCurrent = workspace.id === current.id;
        return <div key={workspace.id} className={`workspace-row${index === activeIndex ? ' keyboard-active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onContextMenu={(event) => { event.preventDefault(); setContext({ x: event.clientX, y: event.clientY, workspace }); }}>
          <span className="workspace-avatar" style={{ '--workspace-color': avatarColor(workspace.id) } as React.CSSProperties}>{workspace.name.charAt(0).toUpperCase()}</span>
          {editing === workspace.id ? <input className="workspace-rename" autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={() => void finishRename(workspace)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditing(null); }} /> : <button className="workspace-row-main" onClick={() => { if (!isCurrent) onOpenHere(workspace); setOpen(false); }}><span>{workspace.name}</span><small>{workspace.syncType}</small></button>}
          {isCurrent ? <Check className="workspace-current-check" size={14} /> : <span className="workspace-row-actions"><button title="Open in new window" onClick={() => { onOpenWindow(workspace); setOpen(false); }}><ExternalLink size={13} /></button><button title="Open in this window — replaces the current workspace" onClick={() => { onOpenHere(workspace); setOpen(false); }}><Replace size={13} /></button></span>}
        </div>;
      })}</div>
      <div className="workspace-popover-footer"><button onClick={() => { setOpen(false); onCreate(); }}><Plus size={13} /> Create workspace</button><button onClick={() => { setOpen(false); onManage(current); }}><Settings2 size={13} /> Manage workspaces…</button><button disabled={!recents.length} onClick={() => setRecentOpen((value) => !value)}><RefreshCw size={13} /> Open recent</button></div>
      {recentOpen && <div className="workspace-recent-list">{recents.map((workspace) => <button key={workspace.id} onClick={() => { onOpenHere(workspace); setOpen(false); }}><span>{workspace.name}</span><small>{workspace.syncType}</small></button>)}</div>}
    </div>}
    {context && <div className="context-menu workspace-context-menu" style={{ left: context.x, top: context.y }}><button onClick={() => startRename(context.workspace)}><SquarePen size={12} /> Rename workspace</button><button onClick={() => { onManage(context.workspace); setContext(null); setOpen(false); }}><Settings2 size={12} /> Workspace settings…</button></div>}
  </div>;
}
