import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderPlus, History, Layers3, Plus, Search, Trash2 } from 'lucide-react';
import { useCollectionStore } from '../../store/collectionStore';
import { useEnvironmentStore } from '../../store/environmentStore';
import { newRequest, useRequestStore } from '../../store/requestStore';
import { methodColor } from '../../lib/methods';
import { storageProvider } from '../../lib/storage/localJson';
import type { CollectionSummary, HistoryEntry, HistoryQuery } from '../../types';
import { isDescendant, type FlatNode } from '../../lib/collections';
import type { ToastMessage } from '../Toast';
import { applyRowEdit } from '../../lib/params';

type View = 'collections' | 'history' | 'environments';
type CollectionRow =
  | { key: string; type: 'collection'; collection: CollectionSummary; depth: number }
  | { key: string; type: 'folder' | 'request'; collectionId: string; node: FlatNode; depth: number };
type DropMode = 'before' | 'inside' | 'after';

interface ContextState {
  x: number;
  y: number;
  collectionId: string;
  nodeId?: string;
  type: 'empty' | 'collection' | 'folder' | 'request';
}

interface MoveState {
  sourceCollectionId: string;
  nodeId: string;
  location: string;
}

interface EditingState {
  collectionId: string;
  nodeId?: string;
  value: string;
}

interface DeleteState {
  collectionId: string;
  nodeId?: string;
  name: string;
  type: 'collection' | 'folder' | 'request';
}

const ROW_HEIGHT = 32;

function dayLabel(timestamp: string): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function Sidebar({ onToast }: { onToast: (message: ToastMessage) => void }) {
  const collectionState = useCollectionStore();
  const environmentFile = useEnvironmentStore((state) => state.file);
  const createEnvironment = useEnvironmentStore((state) => state.createEnvironment);
  const setActiveEnvironment = useEnvironmentStore((state) => state.setActive);
  const setEnvironmentVariables = useEnvironmentStore((state) => state.setVariables);
  const { tabs, activeTabId, openRequest, openUnsaved, renameSavedTab, closeSavedTabs } = useRequestStore();
  const [view, setView] = useState<View>('collections');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [method, setMethod] = useState<HistoryQuery['method']>('ALL');
  const [statusClass, setStatusClass] = useState<HistoryQuery['statusClass']>('ALL');
  const [context, setContext] = useState<ContextState | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState<{ collectionId: string; nodeId: string } | null>(null);
  const [drop, setDrop] = useState<{ key: string; mode: DropMode } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);
  const treeRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef(0);

  useEffect(() => {
    const element = treeRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, [view]);

  useEffect(() => {
    if (view === 'collections' && query.trim()) void collectionState.loadAll();
  }, [collectionState.loadAll, query, view]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await storageProvider.queryHistory({ search: query, method, statusClass, limit: 1000 }));
    } catch (error) {
      onToast({ title: 'Could not load history', detail: String(error), tone: 'error' });
    }
  }, [method, onToast, query, statusClass]);

  useEffect(() => {
    if (view === 'history') void refreshHistory();
  }, [refreshHistory, view]);

  useEffect(() => {
    if (view !== 'history') return;
    const refresh = () => void refreshHistory();
    window.addEventListener('tesapi-history-updated', refresh);
    return () => window.removeEventListener('tesapi-history-updated', refresh);
  }, [refreshHistory, view]);

  useEffect(() => {
    const close = () => setContext(null);
    const cancelDrag = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDragging(null); setDrop(null); } };
    window.addEventListener('click', close);
    window.addEventListener('keydown', cancelDrag);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', cancelDrag); };
  }, []);

  const rows = useMemo(() => {
    const result: CollectionRow[] = [];
    const search = query.trim().toLowerCase();
    if (search) {
      for (const summary of collectionState.summaries) {
        const collection = collectionState.collectionsById[summary.id];
        for (const node of Object.values(collection?.nodesById ?? {})) {
          if (node.type === 'request' && (node.name.toLowerCase().includes(search) || node.request.url.toLowerCase().includes(search))) {
            result.push({ key: `${summary.id}:${node.id}`, type: 'request', collectionId: summary.id, node, depth: 0 });
          }
        }
      }
      return result;
    }
    const visit = (collectionId: string, nodeId: string, depth: number) => {
      const collection = collectionState.collectionsById[collectionId];
      const node = collection?.nodesById[nodeId];
      if (!node) return;
      result.push({ key: `${collectionId}:${node.id}`, type: node.type, collectionId, node, depth });
      if (node.type === 'folder' && collectionState.expandedIds[node.id]) {
        for (const child of collection.childIdsByParent[node.id] ?? []) visit(collectionId, child, depth + 1);
      }
    };
    for (const summary of collectionState.summaries) {
      result.push({ key: summary.id, type: 'collection', collection: summary, depth: 0 });
      if (!collectionState.expandedIds[summary.id]) continue;
      const collection = collectionState.collectionsById[summary.id];
      for (const id of collection?.childIdsByParent.__root__ ?? []) visit(summary.id, id, 1);
    }
    return result;
  }, [collectionState.collectionsById, collectionState.expandedIds, collectionState.summaries, query]);
  const activeEnvironment = environmentFile.environments.find((environment) => environment.id === environmentFile.activeEnvironmentId);
  const activeOrigin = tabs.find((tab) => tab.id === activeTabId)?.origin;
  const moveLocations = useMemo(() => {
    if (!move) return [];
    const result: { value: string; label: string; collectionId: string; parentId: string | null }[] = [];
    const sourceCollection = collectionState.collectionsById[move.sourceCollectionId];
    const sourceNode = sourceCollection?.nodesById[move.nodeId];
    const visit = (collectionId: string, nodeId: string, depth: number) => {
      const collection = collectionState.collectionsById[collectionId];
      const node = collection?.nodesById[nodeId];
      if (!node || node.type !== 'folder') return;
      if (sourceNode?.type === 'folder' && collectionId === move.sourceCollectionId && isDescendant(sourceCollection.nodesById, sourceNode.id, node.id)) return;
      result.push({ value: `${collectionId}|${node.id}`, label: `${'  '.repeat(depth)}${node.name}`, collectionId, parentId: node.id });
      for (const childId of collection.childIdsByParent[node.id] ?? []) visit(collectionId, childId, depth + 1);
    };
    for (const summary of collectionState.summaries) {
      result.push({ value: `${summary.id}|`, label: summary.name, collectionId: summary.id, parentId: null });
      const collection = collectionState.collectionsById[summary.id];
      for (const nodeId of collection?.childIdsByParent.__root__ ?? []) visit(summary.id, nodeId, 1);
    }
    return result;
  }, [collectionState.collectionsById, collectionState.summaries, move]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const end = Math.min(rows.length, start + Math.ceil(viewportHeight / ROW_HEIGHT) + 10);

  const toggleCollection = async (summary: CollectionSummary) => {
    const expanded = !collectionState.expandedIds[summary.id];
    if (expanded) await collectionState.loadCollection(summary.id);
    collectionState.setExpanded(summary.id, expanded);
  };

  const openNode = (collectionId: string, node: FlatNode) => {
    if (node.type === 'folder') {
      collectionState.setExpanded(node.id, !collectionState.expandedIds[node.id]);
    } else {
      openRequest(node.request, { collectionId, nodeId: node.id });
    }
  };

  const startEditing = (collectionId: string, value: string, nodeId?: string) => setEditing({ collectionId, nodeId, value });

  const createCollection = async () => {
    try {
      const collectionId = await useCollectionStore.getState().createCollection('New collection');
      startEditing(collectionId, 'New collection');
    } catch (error) {
      onToast({ title: 'Could not create collection', detail: String(error), tone: 'error' });
    }
  };

  const commitEditing = async () => {
    const target = editing;
    if (!target) return;
    setEditing(null);
    const name = target.value.trim();
    if (!name) return;
    try {
      if (target.nodeId) {
        const node = useCollectionStore.getState().collectionsById[target.collectionId]?.nodesById[target.nodeId];
        await useCollectionStore.getState().renameNode(target.collectionId, target.nodeId, name);
        if (node?.type === 'request') renameSavedTab({ collectionId: target.collectionId, nodeId: target.nodeId }, name);
      } else {
        await useCollectionStore.getState().renameCollection(target.collectionId, name);
      }
    } catch (error) {
      onToast({ title: 'Could not rename item', detail: String(error), tone: 'error' });
    }
  };

  const inlineName = (collectionId: string, value: string, nodeId?: string) => {
    const active = editing?.collectionId === collectionId && editing.nodeId === nodeId;
    if (!active) return <span>{value}</span>;
    return <input className="tree-rename-input" autoFocus value={editing.value} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onFocus={(event) => event.currentTarget.select()} onBlur={() => void commitEditing()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditing(null); }} />;
  };

  const contextAction = async (action: string) => {
    if (!context) return;
    const target = context;
    setContext(null);
    const store = useCollectionStore.getState();
    if (action === 'new-collection') {
      await createCollection();
      return;
    }
    const collectionId = target.collectionId || store.summaries[0]?.id;
    if (!collectionId) {
      onToast({ title: 'Create a collection first' });
      return;
    }
    await store.loadCollection(collectionId);
    const collection = useCollectionStore.getState().collectionsById[collectionId];
    const node = target.nodeId ? collection?.nodesById[target.nodeId] : null;
    if (action === 'new-folder') {
      const parentId = node?.type === 'folder' ? node.id : null;
      const folderId = await store.createFolder(collectionId, parentId, 'New folder');
      collectionState.setExpanded(collectionId, true);
      if (parentId) collectionState.setExpanded(parentId, true);
      startEditing(collectionId, 'New folder', folderId);
    } else if (action === 'new-request') {
      const parentId = node?.type === 'folder' ? node.id : node?.parentId ?? null;
      const request = { ...newRequest(), name: 'New request' };
      const nodeId = await store.saveRequest(collectionId, parentId, request.name, request);
      collectionState.setExpanded(collectionId, true);
      if (parentId) collectionState.setExpanded(parentId, true);
      openRequest(request, { collectionId, nodeId });
      startEditing(collectionId, request.name, nodeId);
    } else if (action === 'rename') {
      startEditing(collectionId, node?.name ?? collection?.name ?? store.summaries.find((item) => item.id === collectionId)?.name ?? '', node?.id);
    } else if (action === 'duplicate' && node) {
      const nodeId = await store.duplicateNode(collectionId, node.id);
      const duplicate = useCollectionStore.getState().collectionsById[collectionId]?.nodesById[nodeId];
      if (duplicate?.type === 'request') {
        openRequest(duplicate.request, { collectionId, nodeId });
        startEditing(collectionId, duplicate.name, nodeId);
      }
    } else if (action === 'delete') {
      setDeleteTarget({ collectionId, nodeId: node?.id, name: node?.name ?? collection?.name ?? 'this collection', type: node?.type ?? 'collection' });
    } else if (action === 'move' && node) {
      await store.loadAll();
      setMove({ sourceCollectionId: collectionId, nodeId: node.id, location: `${collectionId}|` });
    }
  };

  const runContextAction = (action: string) => {
    void contextAction(action).catch((error) => onToast({ title: 'Collection action failed', detail: String(error), tone: 'error' }));
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    try {
      const store = useCollectionStore.getState();
      if (target.nodeId) {
        const removedIds = await store.deleteNode(target.collectionId, target.nodeId);
        closeSavedTabs(target.collectionId, removedIds);
      } else {
        await store.deleteCollection(target.collectionId);
        closeSavedTabs(target.collectionId);
      }
      setDeleteTarget(null);
      onToast({ title: `${target.type[0].toUpperCase()}${target.type.slice(1)} deleted` });
    } catch (error) {
      onToast({ title: `Could not delete ${target.type}`, detail: String(error), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const confirmMove = async () => {
    if (!move) return;
    const location = moveLocations.find((item) => item.value === move.location);
    if (!location) return;
    try {
      await collectionState.moveNode(move.sourceCollectionId, move.nodeId, location.collectionId, location.parentId);
      setMove(null);
    } catch (error) {
      onToast({ title: 'Could not move item', detail: String(error), tone: 'error' });
    }
  };

  const dropOn = async (row: CollectionRow) => {
    if (!dragging) return;
    try {
      if (row.type === 'collection') {
        await collectionState.loadCollection(row.collection.id);
        await collectionState.moveNode(dragging.collectionId, dragging.nodeId, row.collection.id, null);
      } else if (row.type === 'folder') {
        const mode = drop?.key === row.key ? drop.mode : 'inside';
        const collection = collectionState.collectionsById[row.collectionId];
        const siblings = collection?.childIdsByParent[row.node.parentId ?? '__root__'] ?? [];
        const index = mode === 'inside' ? undefined : siblings.indexOf(row.node.id) + (mode === 'after' ? 1 : 0);
        await collectionState.moveNode(dragging.collectionId, dragging.nodeId, row.collectionId, mode === 'inside' ? row.node.id : row.node.parentId, index);
      } else {
        const collection = collectionState.collectionsById[row.collectionId];
        const siblings = collection.childIdsByParent[row.node.parentId ?? '__root__'] ?? [];
        const mode = drop?.key === row.key ? drop.mode : 'before';
        await collectionState.moveNode(dragging.collectionId, dragging.nodeId, row.collectionId, row.node.parentId, siblings.indexOf(row.node.id) + (mode === 'after' ? 1 : 0));
      }
    } catch (error) {
      onToast({ title: 'Could not move item', detail: String(error), tone: 'error' });
    } finally {
      setDragging(null);
      setDrop(null);
    }
  };

  const dragOver = (event: React.DragEvent, row: CollectionRow) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5;
    const mode: DropMode = row.type === 'collection'
      ? 'inside'
      : row.type === 'folder'
        ? ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
        : ratio < 0.5 ? 'before' : 'after';
    const sourceCollection = dragging ? collectionState.collectionsById[dragging.collectionId] : undefined;
    const invalid = !!dragging && row.type === 'folder' && mode === 'inside' && dragging.collectionId === row.collectionId && !!sourceCollection && isDescendant(sourceCollection.nodesById, dragging.nodeId, row.node.id);
    event.dataTransfer.dropEffect = invalid ? 'none' : 'move';
    setDrop({ key: row.key, mode });
    window.clearTimeout(hoverTimer.current);
    if (row.type === 'folder' && mode === 'inside' && !collectionState.expandedIds[row.node.id]) {
      hoverTimer.current = window.setTimeout(() => collectionState.setExpanded(row.node.id, true), 600);
    }
    const tree = treeRef.current;
    if (!tree) return;
    const treeBounds = tree.getBoundingClientRect();
    if (event.clientY < treeBounds.top + 32) tree.scrollTop -= 20;
    if (event.clientY > treeBounds.bottom - 32) tree.scrollTop += 20;
  };

  return (
    <aside className="sidebar" onContextMenu={(event) => event.preventDefault()}>
      <div className="sidebar-header">
        <button className={`icon-button${view === 'collections' ? ' active' : ''}`} title="Collections" onClick={() => setView('collections')}><Folder size={15} /></button>
        <button className={`icon-button${view === 'history' ? ' active' : ''}`} title="History" onClick={() => setView('history')}><History size={15} /></button>
        <button className={`icon-button${view === 'environments' ? ' active' : ''}`} title="Environments" onClick={() => setView('environments')}><Layers3 size={15} /></button>
        {view === 'collections' && <button className="icon-button sidebar-add" title="New collection" onClick={() => void createCollection()}><Plus size={15} /></button>}
      </div>
      <div className="sidebar-search">
        <div className="search-box"><Search size={13} color="var(--text-muted)" /><input placeholder={view === 'history' ? 'Search history' : 'Search requests'} spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘K</kbd></div>
        {view === 'history' && <div className="history-filters"><select value={method} onChange={(event) => setMethod(event.target.value as HistoryQuery['method'])}><option value="ALL">All methods</option>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => <option key={value}>{value}</option>)}</select><select value={statusClass} onChange={(event) => setStatusClass(event.target.value as HistoryQuery['statusClass'])}><option value="ALL">All status</option><option value="2xx">2xx</option><option value="3xx">3xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option><option value="error">Network</option></select></div>}
      </div>

      {view === 'collections' && (
        <div className="tree virtual-tree" ref={treeRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} onContextMenu={(event) => { event.preventDefault(); const fallback = collectionState.summaries.find((summary) => collectionState.expandedIds[summary.id])?.id ?? collectionState.summaries[0]?.id ?? ''; setContext({ x: event.clientX, y: event.clientY, collectionId: fallback, type: 'empty' }); }}>
          {!rows.length && <div className="sidebar-empty"><FolderPlus size={24} /><span>{query ? 'No matching requests' : 'No collections yet'}</span>{!query && <button onClick={() => void createCollection()}>New collection</button>}</div>}
          <div className="virtual-tree-space" style={{ height: rows.length * ROW_HEIGHT }}>
            {rows.slice(start, end).map((row, offset) => {
              const top = (start + offset) * ROW_HEIGHT;
              if (row.type === 'collection') {
                const expanded = !!collectionState.expandedIds[row.collection.id];
                return <div className={`virtual-tree-row collection-tree-row${drop?.key === row.key ? ` drop-${drop?.mode}` : ''}`} key={row.key} style={{ top }} onDragOver={(event) => dragOver(event, row)} onDragLeave={() => setDrop(null)} onDrop={(event) => { event.preventDefault(); void dropOn(row); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContext({ x: event.clientX, y: event.clientY, collectionId: row.collection.id, type: 'collection' }); }}><div className="collection-row-main" role="button" tabIndex={0} onClick={() => void toggleCollection(row.collection)} onKeyDown={(event) => { if (event.key === 'Enter') void toggleCollection(row.collection); }}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Folder size={13} />{inlineName(row.collection.id, row.collection.name)}<small>{row.collection.requestCount}</small></div></div>;
              }
              const expanded = row.type === 'folder' && !!collectionState.expandedIds[row.node.id];
              const selected = row.type === 'request' && activeOrigin?.collectionId === row.collectionId && activeOrigin.nodeId === row.node.id;
              const isEditing = editing?.collectionId === row.collectionId && editing.nodeId === row.node.id;
              return <div className={`virtual-tree-row node-tree-row${row.type === 'request' ? ' request' : ''}${selected ? ' selected' : ''}${drop?.key === row.key ? ` drop-${drop?.mode}` : ''}`} key={row.key} role="button" tabIndex={0} style={{ top, paddingLeft: 8 + row.depth * 16 }} draggable={!isEditing} onDragStart={(event) => { setDragging({ collectionId: row.collectionId, nodeId: row.node.id }); event.dataTransfer.setData('text/plain', row.node.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragging(null); setDrop(null); }} onDragOver={(event) => dragOver(event, row)} onDragLeave={() => setDrop(null)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void dropOn(row); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContext({ x: event.clientX, y: event.clientY, collectionId: row.collectionId, nodeId: row.node.id, type: row.type }); }} onClick={() => openNode(row.collectionId, row.node)} onKeyDown={(event) => { if (event.key === 'Enter' && !isEditing) openNode(row.collectionId, row.node); }}>{row.type === 'folder' ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="tree-method" style={{ color: methodColor(row.node.type === 'request' ? row.node.request.method : 'GET') }}>{row.node.type === 'request' ? row.node.request.method : ''}</span>}{row.type === 'folder' && <Folder size={13} />}{inlineName(row.collectionId, row.node.name, row.node.id)}</div>;
            })}
          </div>
        </div>
      )}

      {view === 'history' && <div className="tree history-list"><div className="history-toolbar"><span className="label-caps">History</span><button onClick={() => { if (window.confirm('Clear all history?')) void storageProvider.clearHistory().then(refreshHistory); }}><Trash2 size={12} /> Clear</button></div>{history.map((entry, index) => { const label = dayLabel(entry.ts); const previous = index ? dayLabel(history[index - 1].ts) : ''; return <div key={entry.id}>{label !== previous && <div className="history-day label-caps">{label}</div>}<button className="history-entry" onClick={() => openUnsaved(entry.request)}><span className="tree-method" style={{ color: methodColor(entry.method) }}>{entry.method}</span><span className="history-url">{entry.url}</span><span className={`history-status status-${entry.status ? Math.floor(entry.status / 100) : 0}`}>{entry.status || 'ERR'}</span><time>{entry.durationMs} ms</time></button></div>; })}{!history.length && <div className="sidebar-empty"><History size={24} /><span>No history yet</span></div>}</div>}

      {view === 'environments' && <div className="tree environment-editor"><div className="environment-toolbar"><select value={environmentFile.activeEnvironmentId ?? ''} onChange={(event) => void setActiveEnvironment(event.target.value || null)}><option value="">No environment</option>{environmentFile.environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select><button title="New environment" onClick={() => { const name = window.prompt('Environment name'); if (name?.trim()) void createEnvironment(name); }}><Plus size={13} /></button></div>{activeEnvironment ? <div className="environment-rows">{activeEnvironment.variables.map((variable) => <div className={`environment-variable${variable.enabled ? '' : ' disabled'}`} key={variable.id}><input type="checkbox" checked={variable.enabled} onChange={(event) => void setEnvironmentVariables(activeEnvironment.id, activeEnvironment.variables.map((item) => item.id === variable.id ? { ...item, enabled: event.target.checked } : item))} /><input placeholder="Variable" value={variable.key} onChange={(event) => void setEnvironmentVariables(activeEnvironment.id, activeEnvironment.variables.map((item) => item.id === variable.id ? applyRowEdit(item, { key: event.target.value }) : item))} /><input placeholder="Value" value={variable.value} onChange={(event) => void setEnvironmentVariables(activeEnvironment.id, activeEnvironment.variables.map((item) => item.id === variable.id ? applyRowEdit(item, { value: event.target.value }) : item))} /></div>)}</div> : <div className="sidebar-empty"><Layers3 size={24} /><span>No environments yet</span><button onClick={() => { const name = window.prompt('Environment name'); if (name?.trim()) void createEnvironment(name); }}>New environment</button></div>}</div>}

      {context && <div className="context-menu" style={{ left: context.x, top: context.y }} onClick={(event) => event.stopPropagation()}>{context.type === 'empty' ? <><button onClick={() => runContextAction('new-collection')}>New collection</button><button disabled={!context.collectionId} onClick={() => runContextAction('new-folder')}>New folder</button><button disabled={!context.collectionId} onClick={() => runContextAction('new-request')}>New request</button></> : <>{context.type !== 'request' && <button onClick={() => runContextAction('new-folder')}>New folder</button>}<button onClick={() => runContextAction('new-request')}>New request</button><button onClick={() => runContextAction('rename')}>Rename</button>{context.type === 'request' && <button onClick={() => runContextAction('duplicate')}>Duplicate</button>}{context.type !== 'collection' && <button onClick={() => runContextAction('move')}>Move to…</button>}<button className="danger" onClick={() => runContextAction('delete')}>Delete</button></>}</div>}

      {deleteTarget && <div className="modal-backdrop"><section className="close-tab-modal delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-item-title"><div className="save-modal-header"><div><h2 id="delete-item-title">Delete {deleteTarget.type}?</h2><p>“{deleteTarget.name}” will be permanently deleted{deleteTarget.type === 'folder' ? ', including everything inside it' : ''}.</p></div></div><div className="save-modal-actions"><button className="modal-cancel" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button><button className="modal-delete" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : 'Delete'}</button></div></section></div>}

      {move && <div className="modal-backdrop"><section className="save-location-modal move-location-modal" role="dialog" aria-modal="true" aria-labelledby="move-location-title"><div className="save-modal-header"><div><h2 id="move-location-title">Move item</h2><p>Choose a collection or nested folder.</p></div><button className="modal-close" aria-label="Close move dialog" onClick={() => setMove(null)}>×</button></div><label className="save-field"><span><b>Folder / location</b><small>Workspace folders</small></span><div className="save-select"><Folder size={14} /><select value={move.location} onChange={(event) => setMove({ ...move, location: event.target.value })}>{moveLocations.map((location) => <option key={location.value} value={location.value}>{location.label}</option>)}</select></div></label><div className="save-modal-actions"><button className="modal-cancel" onClick={() => setMove(null)}>Cancel</button><button className="modal-save" disabled={!moveLocations.length} onClick={() => void confirmMove()}>Move</button></div></section></div>}
    </aside>
  );
}
