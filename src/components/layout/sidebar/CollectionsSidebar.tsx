import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileOutput, FileUp, Folder, FolderPlus, Plus } from 'lucide-react';
import { useCollectionStore } from '../../../store/collectionStore';
import { newRequest, useRequestStore } from '../../../store/requestStore';
import { isDescendant, type FlatNode } from '../../../lib/collections';
import { methodColor } from '../../../lib/methods';
import type { CollectionSummary } from '../../../types';
import type { ToastMessage } from '../../Toast';
import { SidebarNav } from './SidebarNav';
import { SidebarSearch } from './SidebarSearch';
import type { SidebarView, WorkspaceView } from './types';
import { buildMoveLocations, buildRows, type CollectionRow, type ContextState, type DeleteState, type DropMode, type DropState, type EditingState, type MoveState } from './collectionSidebarModel';
import { parsePostmanCollection } from '../../../lib/import/postman';
import { ImportCollectionModal, type ImportSource } from '../../collections/ImportCollectionModal';

const ROW_HEIGHT = 32;

interface Props { onToast: (message: ToastMessage) => void; onViewChange: (view: SidebarView) => void; onWorkspaceChange: (view: WorkspaceView) => void }

export function CollectionsSidebar({ onToast, onViewChange, onWorkspaceChange }: Props) {
  const collectionState = useCollectionStore();
  const { tabs, activeTabId, response: currentResponse, openRequest, renameSavedTab, closeSavedTabs } = useRequestStore();
  const [query, setQuery] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [context, setContext] = useState<ContextState | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState<{ collectionId: string; nodeId: string } | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);
  const treeRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef(0);
  const rows = useMemo(() => buildRows(collectionState, query), [collectionState.collectionsById, collectionState.expandedIds, collectionState.summaries, query]);
  const moveLocations = useMemo(() => move ? buildMoveLocations(collectionState, move, isDescendant) : [], [collectionState.collectionsById, collectionState.summaries, move]);
  const activeOrigin = tabs.find((tab) => tab.id === activeTabId)?.origin;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const end = Math.min(rows.length, start + Math.ceil(viewportHeight / ROW_HEIGHT) + 10);

  useEffect(() => {
    const element = treeRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (query.trim()) void collectionState.loadAll(); }, [collectionState.loadAll, query]);
  useEffect(() => {
    const close = () => { setContext(null); setAddMenuOpen(false); };
    const cancelDrag = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDragging(null); setDrop(null); setAddMenuOpen(false); } };
    window.addEventListener('click', close);
    window.addEventListener('keydown', cancelDrag);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', cancelDrag); };
  }, []);

  const toggleCollection = async (summary: CollectionSummary) => {
    const expanded = !collectionState.expandedIds[summary.id];
    if (expanded) await collectionState.loadCollection(summary.id);
    collectionState.setExpanded(summary.id, expanded);
  };
  const openNode = (collectionId: string, node: FlatNode) => {
    if (node.type === 'folder') collectionState.setExpanded(node.id, !collectionState.expandedIds[node.id]);
    else { openRequest(node.request, { collectionId, nodeId: node.id }); onWorkspaceChange('api'); }
  };
  const startEditing = (collectionId: string, value: string, nodeId?: string) => setEditing({ collectionId, nodeId, value });
  const createCollection = async () => {
    try { const id = await useCollectionStore.getState().createCollection('New collection'); startEditing(id, 'New collection'); }
    catch (error) { onToast({ title: 'Could not create collection', detail: String(error), tone: 'error' }); }
  };
  const importCollection = async (file: File, source: ImportSource) => {
    if (source !== 'postman') throw new Error('This import source is not available yet.');
    const fallback = file.name.replace(/\.postman_collection\.json$|\.json$/i, '');
    const imported = parsePostmanCollection(JSON.parse(await file.text()), fallback);
    await useCollectionStore.getState().importCollection(imported.name, imported.root);
    const detail = `${imported.requestCount} requests · ${imported.folderCount} folders · ${imported.responseCount} saved responses${imported.warnings[0] ? ` · ${imported.warnings[0]}` : ''}`;
    onToast({ title: `Imported ${imported.name}`, detail });
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
      } else await useCollectionStore.getState().renameCollection(target.collectionId, name);
    } catch (error) { onToast({ title: 'Could not rename item', detail: String(error), tone: 'error' }); }
  };
  const inlineName = (collectionId: string, value: string, nodeId?: string) => editing?.collectionId === collectionId && editing.nodeId === nodeId
    ? <input className="tree-rename-input" autoFocus value={editing.value} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onFocus={(event) => event.currentTarget.select()} onBlur={() => void commitEditing()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditing(null); }} />
    : <span>{value}</span>;

  const contextAction = async (action: string) => {
    if (!context) return;
    const target = context;
    setContext(null);
    const store = useCollectionStore.getState();
    if (action === 'new-collection') return createCollection();
    const collectionId = target.collectionId || store.summaries[0]?.id;
    if (!collectionId) return onToast({ title: 'Create a collection first' });
    await store.loadCollection(collectionId);
    const collection = useCollectionStore.getState().collectionsById[collectionId];
    const node = target.nodeId ? collection?.nodesById[target.nodeId] : null;
    if (target.type === 'response' && node?.type === 'request' && target.responseId) {
      const response = node.savedResponses?.find((item) => item.id === target.responseId);
      if (action === 'delete' && response) setDeleteTarget({ collectionId, nodeId: node.id, responseId: response.id, name: response.name, type: 'response' });
      return;
    }
    if (action === 'new-folder') {
      const parentId = node?.type === 'folder' ? node.id : null;
      const id = await store.createFolder(collectionId, parentId, 'New folder');
      collectionState.setExpanded(collectionId, true);
      if (parentId) collectionState.setExpanded(parentId, true);
      startEditing(collectionId, 'New folder', id);
    } else if (action === 'new-request') {
      const parentId = node?.type === 'folder' ? node.id : node?.parentId ?? null;
      const request = { ...newRequest(), name: 'New request' };
      const id = await store.saveRequest(collectionId, parentId, request.name, request);
      collectionState.setExpanded(collectionId, true);
      if (parentId) collectionState.setExpanded(parentId, true);
      openRequest(request, { collectionId, nodeId: id });
      onWorkspaceChange('api');
      startEditing(collectionId, request.name, id);
    } else if (action === 'rename') startEditing(collectionId, node?.name ?? collection?.name ?? store.summaries.find((item) => item.id === collectionId)?.name ?? '', node?.id);
    else if (action === 'duplicate' && node) {
      const id = await store.duplicateNode(collectionId, node.id);
      const duplicate = useCollectionStore.getState().collectionsById[collectionId]?.nodesById[id];
      if (duplicate?.type === 'request') { openRequest(duplicate.request, { collectionId, nodeId: id }); onWorkspaceChange('api'); startEditing(collectionId, duplicate.name, id); }
    } else if (action === 'delete') setDeleteTarget({ collectionId, nodeId: node?.id, name: node?.name ?? collection?.name ?? 'this collection', type: node?.type ?? 'collection' });
    else if (action === 'move' && node) { await store.loadAll(); setMove({ sourceCollectionId: collectionId, nodeId: node.id, location: `${collectionId}|` }); }
  };
  const runContextAction = (action: string) => void contextAction(action).catch((error) => onToast({ title: 'Collection action failed', detail: String(error), tone: 'error' }));
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const store = useCollectionStore.getState();
      if (deleteTarget.responseId && deleteTarget.nodeId) await store.deleteResponse(deleteTarget.collectionId, deleteTarget.nodeId, deleteTarget.responseId);
      else if (deleteTarget.nodeId) closeSavedTabs(deleteTarget.collectionId, await store.deleteNode(deleteTarget.collectionId, deleteTarget.nodeId));
      else { await store.deleteCollection(deleteTarget.collectionId); closeSavedTabs(deleteTarget.collectionId); }
      setDeleteTarget(null);
      onToast({ title: `${deleteTarget.type[0].toUpperCase()}${deleteTarget.type.slice(1)} deleted` });
    } catch (error) { onToast({ title: `Could not delete ${deleteTarget.type}`, detail: String(error), tone: 'error' }); }
    finally { setDeleting(false); }
  };
  const confirmMove = async () => {
    if (!move) return;
    const location = moveLocations.find((item) => item.value === move.location);
    if (!location) return;
    try { await collectionState.moveNode(move.sourceCollectionId, move.nodeId, location.collectionId, location.parentId); setMove(null); }
    catch (error) { onToast({ title: 'Could not move item', detail: String(error), tone: 'error' }); }
  };
  const dropOn = async (row: CollectionRow) => {
    if (!dragging) return;
    try {
      if (row.type === 'collection') { await collectionState.loadCollection(row.collection.id); await collectionState.moveNode(dragging.collectionId, dragging.nodeId, row.collection.id, null); }
      else {
        const collection = collectionState.collectionsById[row.collectionId];
        const siblings = collection?.childIdsByParent[row.node.parentId ?? '__root__'] ?? [];
        const mode = drop?.key === row.key ? drop.mode : row.type === 'folder' ? 'inside' : 'before';
        const index = mode === 'inside' ? undefined : siblings.indexOf(row.node.id) + (mode === 'after' ? 1 : 0);
        await collectionState.moveNode(dragging.collectionId, dragging.nodeId, row.collectionId, mode === 'inside' ? row.node.id : row.node.parentId, index);
      }
    } catch (error) { onToast({ title: 'Could not move item', detail: String(error), tone: 'error' }); }
    finally { setDragging(null); setDrop(null); }
  };
  const dragOver = (event: React.DragEvent, row: CollectionRow) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5;
    const mode: DropMode = row.type === 'collection' ? 'inside' : row.type === 'folder' ? ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside' : ratio < 0.5 ? 'before' : 'after';
    const source = dragging ? collectionState.collectionsById[dragging.collectionId] : undefined;
    const invalid = !!dragging && row.type === 'folder' && mode === 'inside' && dragging.collectionId === row.collectionId && !!source && isDescendant(source.nodesById, dragging.nodeId, row.node.id);
    event.dataTransfer.dropEffect = invalid ? 'none' : 'move';
    setDrop({ key: row.key, mode });
    window.clearTimeout(hoverTimer.current);
    if (row.type === 'folder' && mode === 'inside' && !collectionState.expandedIds[row.node.id]) hoverTimer.current = window.setTimeout(() => collectionState.setExpanded(row.node.id, true), 600);
    if (treeRef.current) { const bounds = treeRef.current.getBoundingClientRect(); if (event.clientY < bounds.top + 32) treeRef.current.scrollTop -= 20; if (event.clientY > bounds.bottom - 32) treeRef.current.scrollTop += 20; }
  };

  return <>
    <SidebarNav active="collections" onChange={onViewChange} action={<div className="sidebar-add-wrap" onClick={(event) => event.stopPropagation()}>
      <button className={`icon-button sidebar-add${addMenuOpen ? ' active' : ''}`} title="Add collection" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)}><Plus size={15} /></button>
      {addMenuOpen && <div className="sidebar-add-menu" role="menu"><button onClick={() => { setAddMenuOpen(false); void createCollection(); }}><FolderPlus size={13} /><span><b>New collection</b><small>Create an empty collection</small></span></button><button onClick={() => { setAddMenuOpen(false); setImportOpen(true); }}><FileUp size={13} /><span><b>Import…</b><small>From Postman and more</small></span></button></div>}
    </div>} />
    <SidebarSearch placeholder="Search requests" value={query} onChange={setQuery} />
    <div className="tree virtual-tree" ref={treeRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} onContextMenu={(event) => { event.preventDefault(); const fallback = collectionState.summaries.find((summary) => collectionState.expandedIds[summary.id])?.id ?? collectionState.summaries[0]?.id ?? ''; setContext({ x: event.clientX, y: event.clientY, collectionId: fallback, type: 'empty' }); }}>
      {!rows.length && <div className="sidebar-empty"><FolderPlus size={24} /><span>{query ? 'No matching requests' : 'No collections yet'}</span>{!query && <button onClick={() => void createCollection()}>New collection</button>}</div>}
      <div className="virtual-tree-space" style={{ height: rows.length * ROW_HEIGHT }}>{rows.slice(start, end).map((row, offset) => {
        const top = (start + offset) * ROW_HEIGHT;
        if (row.type === 'collection') {
          const expanded = !!collectionState.expandedIds[row.collection.id];
          return <div className={`virtual-tree-row collection-tree-row${drop?.key === row.key ? ` drop-${drop.mode}` : ''}`} key={row.key} style={{ top }} onDragOver={(event) => dragOver(event, row)} onDragLeave={() => setDrop(null)} onDrop={(event) => { event.preventDefault(); void dropOn(row); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContext({ x: event.clientX, y: event.clientY, collectionId: row.collection.id, type: 'collection' }); }}><div className="collection-row-main" role="button" tabIndex={0} onClick={() => void toggleCollection(row.collection)} onKeyDown={(event) => { if (event.key === 'Enter') void toggleCollection(row.collection); }}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Folder size={13} />{inlineName(row.collection.id, row.collection.name)}<small>{row.collection.requestCount}</small></div></div>;
        }
        if (row.type === 'response') {
          const openSavedResponse = () => {
            openRequest(row.node.request, { collectionId: row.collectionId, nodeId: row.node.id });
            useRequestStore.getState().setResponse(row.response.response);
            onWorkspaceChange('api');
          };
          const selected = activeOrigin?.collectionId === row.collectionId && activeOrigin.nodeId === row.node.id && currentResponse === row.response.response;
          return <div className={`virtual-tree-row saved-response-row${selected ? ' selected' : ''}`} key={row.key} role="button" tabIndex={0} style={{ top, paddingLeft: 8 + row.depth * 16 }} onClick={openSavedResponse} onKeyDown={(event) => { if (event.key === 'Enter') openSavedResponse(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContext({ x: event.clientX, y: event.clientY, collectionId: row.collectionId, nodeId: row.node.id, responseId: row.response.id, type: 'response' }); }}><FileOutput size={12} /><span>{row.response.name}</span><small>{row.response.response.status}</small></div>;
        }
        const expanded = row.type === 'folder' && !!collectionState.expandedIds[row.node.id];
        const requestNode = row.node.type === 'request' ? row.node : null;
        const hasResponses = !!requestNode?.savedResponses?.length;
        const requestExpanded = hasResponses && !!collectionState.expandedIds[row.node.id];
        const showingSavedResponse = requestNode?.savedResponses?.some((item) => item.response === currentResponse);
        const selected = row.type === 'request' && !showingSavedResponse && activeOrigin?.collectionId === row.collectionId && activeOrigin.nodeId === row.node.id;
        const isEditing = editing?.collectionId === row.collectionId && editing.nodeId === row.node.id;
        return <div className={`virtual-tree-row node-tree-row${row.type === 'request' ? ' request' : ''}${selected ? ' selected' : ''}${drop?.key === row.key ? ` drop-${drop.mode}` : ''}`} key={row.key} role="button" tabIndex={0} style={{ top, paddingLeft: 8 + row.depth * 16 }} draggable={!isEditing} onDragStart={(event) => { setDragging({ collectionId: row.collectionId, nodeId: row.node.id }); event.dataTransfer.setData('text/plain', row.node.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragging(null); setDrop(null); }} onDragOver={(event) => dragOver(event, row)} onDragLeave={() => setDrop(null)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void dropOn(row); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContext({ x: event.clientX, y: event.clientY, collectionId: row.collectionId, nodeId: row.node.id, type: row.type }); }} onClick={() => openNode(row.collectionId, row.node)} onKeyDown={(event) => { if (event.key === 'Enter' && !isEditing) openNode(row.collectionId, row.node); }}>{row.type === 'folder' ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <button className="request-response-toggle" disabled={!hasResponses} aria-label={requestExpanded ? 'Collapse saved responses' : 'Expand saved responses'} onClick={(event) => { event.stopPropagation(); if (hasResponses) collectionState.setExpanded(row.node.id, !requestExpanded); }}>{hasResponses ? requestExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}</button>}{requestNode && <span className="tree-method" style={{ color: methodColor(requestNode.request.method) }}>{requestNode.request.method}</span>}{row.type === 'folder' && <Folder size={13} />}{inlineName(row.collectionId, row.node.name, row.node.id)}</div>;
      })}</div>
    </div>
    {context && <div className="context-menu" style={{ left: context.x, top: context.y }} onClick={(event) => event.stopPropagation()}>{context.type === 'empty' ? <><button onClick={() => runContextAction('new-collection')}>New collection</button><button disabled={!context.collectionId} onClick={() => runContextAction('new-folder')}>New folder</button><button disabled={!context.collectionId} onClick={() => runContextAction('new-request')}>New request</button></> : context.type === 'response' ? <button className="danger" onClick={() => runContextAction('delete')}>Delete response</button> : <>{context.type !== 'request' && <button onClick={() => runContextAction('new-folder')}>New folder</button>}<button onClick={() => runContextAction('new-request')}>New request</button><button onClick={() => runContextAction('rename')}>Rename</button>{context.type === 'request' && <button onClick={() => runContextAction('duplicate')}>Duplicate</button>}{context.type !== 'collection' && <button onClick={() => runContextAction('move')}>Move to…</button>}<button className="danger" onClick={() => runContextAction('delete')}>Delete</button></>}</div>}
    {deleteTarget && <div className="modal-backdrop"><section className="close-tab-modal delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-item-title"><div className="save-modal-header"><div><h2 id="delete-item-title">Delete {deleteTarget.type}?</h2><p>“{deleteTarget.name}” will be permanently deleted{deleteTarget.type === 'folder' ? ', including everything inside it' : ''}.</p></div></div><div className="save-modal-actions"><button className="modal-cancel" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button><button className="modal-delete" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : 'Delete'}</button></div></section></div>}
    {move && <div className="modal-backdrop"><section className="save-location-modal move-location-modal" role="dialog" aria-modal="true" aria-labelledby="move-location-title"><div className="save-modal-header"><div><h2 id="move-location-title">Move item</h2><p>Choose a collection or nested folder.</p></div><button className="modal-close" aria-label="Close move dialog" onClick={() => setMove(null)}>×</button></div><label className="save-field"><span><b>Folder / location</b><small>Workspace folders</small></span><div className="save-select"><Folder size={14} /><select value={move.location} onChange={(event) => setMove({ ...move, location: event.target.value })}>{moveLocations.map((location) => <option key={location.value} value={location.value}>{location.label}</option>)}</select></div></label><div className="save-modal-actions"><button className="modal-cancel" onClick={() => setMove(null)}>Cancel</button><button className="modal-save" disabled={!moveLocations.length} onClick={() => void confirmMove()}>Move</button></div></section></div>}
    <ImportCollectionModal open={importOpen} onCancel={() => setImportOpen(false)} onImport={importCollection} />
  </>;
}
