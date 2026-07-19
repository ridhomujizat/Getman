import { create } from 'zustand';
import type { Collection, CollectionSummary, TesApiRequest } from '../types';
import { denormalizeCollection, isDescendant, normalizeCollection, ROOT, type FlatNode } from '../lib/collections';
import { uid } from '../lib/id';
import { storageProvider } from '../lib/storage/localJson';

interface State {
  initialized: boolean;
  summaries: CollectionSummary[];
  collectionsById: Record<string, { collectionId: string; name: string; nodesById: Record<string, FlatNode>; childIdsByParent: Record<string, string[]> }>;
  expandedIds: Record<string, boolean>;
  initialize: () => Promise<void>;
  loadCollection: (id: string) => Promise<void>;
  loadAll: () => Promise<void>;
  setExpanded: (id: string, expanded: boolean) => void;
  createCollection: (name: string) => Promise<string>;
  renameCollection: (id: string, name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  createFolder: (collectionId: string, parentId: string | null, name: string) => Promise<string>;
  saveRequest: (collectionId: string, parentId: string | null, name: string, request: TesApiRequest, nodeId?: string) => Promise<string>;
  renameNode: (collectionId: string, nodeId: string, name: string) => Promise<void>;
  deleteNode: (collectionId: string, nodeId: string) => Promise<string[]>;
  duplicateNode: (collectionId: string, nodeId: string) => Promise<string>;
  moveNode: (sourceCollectionId: string, nodeId: string, targetCollectionId: string, targetParentId: string | null, targetIndex?: number) => Promise<void>;
}

type Normalized = State['collectionsById'][string];

function emptyCollection(id: string, name: string): Normalized {
  return { collectionId: id, name, nodesById: {}, childIdsByParent: { [ROOT]: [] } };
}

function collectionValue(normalized: Normalized): Collection {
  return denormalizeCollection(normalized);
}

function withCollection(state: State, id: string, update: (collection: Normalized) => Normalized): State['collectionsById'] {
  return { ...state.collectionsById, [id]: update(state.collectionsById[id]) };
}

function descendants(collection: Normalized, nodeId: string): string[] {
  const ids = [nodeId];
  for (const child of collection.childIdsByParent[nodeId] ?? []) ids.push(...descendants(collection, child));
  return ids;
}

function removeNode(collection: Normalized, nodeId: string): Normalized {
  const node = collection.nodesById[nodeId];
  if (!node) return collection;
  const removeIds = new Set(descendants(collection, nodeId));
  const nextNodes = Object.fromEntries(Object.entries(collection.nodesById).filter(([id]) => !removeIds.has(id)));
  const nextChildren = Object.fromEntries(Object.entries(collection.childIdsByParent)
    .filter(([id]) => !removeIds.has(id))
    .map(([parent, ids]) => [parent, ids.filter((id) => !removeIds.has(id))]));
  return { ...collection, nodesById: nextNodes, childIdsByParent: nextChildren };
}

async function persist(collection: Normalized): Promise<void> {
  await storageProvider.saveCollection(collectionValue(collection));
}

export const useCollectionStore = create<State>((set, get) => ({
  initialized: false,
  summaries: [],
  collectionsById: {},
  expandedIds: {},
  initialize: async () => {
    await storageProvider.initialize();
    const summaries = await storageProvider.listCollections();
    set({ initialized: true, summaries });
  },
  loadCollection: async (id) => {
    if (get().collectionsById[id]) return;
    const normalized = normalizeCollection(await storageProvider.loadCollection(id));
    set((state) => ({ collectionsById: { ...state.collectionsById, [id]: normalized } }));
  },
  loadAll: async () => {
    const summaries = get().summaries;
    await Promise.all(summaries.map(({ id }) => get().loadCollection(id)));
  },
  setExpanded: (id, expanded) => set((state) => ({ expandedIds: { ...state.expandedIds, [id]: expanded } })),
  createCollection: async (name) => {
    const id = uid();
    const normalized = emptyCollection(id, name.trim() || 'New collection');
    await persist(normalized);
    set((state) => ({
      summaries: [...state.summaries, { id, name: normalized.name, requestCount: 0, folderCount: 0 }],
      collectionsById: { ...state.collectionsById, [id]: normalized },
      expandedIds: { ...state.expandedIds, [id]: true },
    }));
    return id;
  },
  renameCollection: async (id, name) => {
    const current = get().collectionsById[id];
    if (!current) return;
    const next = { ...current, name: name.trim() || current.name };
    await persist(next);
    set((state) => ({
      collectionsById: { ...state.collectionsById, [id]: next },
      summaries: state.summaries.map((summary) => summary.id === id ? { ...summary, name: next.name } : summary),
    }));
  },
  deleteCollection: async (id) => {
    await storageProvider.deleteCollection(id);
    set((state) => ({
      summaries: state.summaries.filter((summary) => summary.id !== id),
      collectionsById: Object.fromEntries(Object.entries(state.collectionsById).filter(([key]) => key !== id)),
      expandedIds: Object.fromEntries(Object.entries(state.expandedIds).filter(([key]) => key !== id)),
    }));
  },
  createFolder: async (collectionId, parentId, name) => {
    const current = get().collectionsById[collectionId];
    if (!current) throw new Error('Collection is not loaded');
    const id = uid();
    const next: Normalized = {
      ...current,
      nodesById: { ...current.nodesById, [id]: { id, collectionId, parentId, type: 'folder', name: name.trim() || 'New folder' } },
      childIdsByParent: { ...current.childIdsByParent, [id]: [], [parentId ?? ROOT]: [...(current.childIdsByParent[parentId ?? ROOT] ?? []), id] },
    };
    await persist(next);
    set((state) => ({ collectionsById: withCollection(state, collectionId, () => next), summaries: state.summaries.map((summary) => summary.id === collectionId ? { ...summary, folderCount: summary.folderCount + 1 } : summary) }));
    return id;
  },
  saveRequest: async (collectionId, parentId, name, request, nodeId) => {
    const current = get().collectionsById[collectionId];
    if (!current) throw new Error('Collection is not loaded');
    const id = nodeId ?? uid();
    const existing = nodeId ? current.nodesById[nodeId] : null;
    if (existing && (existing.type !== 'request' || existing.collectionId !== collectionId)) throw new Error('Request node not found');
    const next: Normalized = {
      ...current,
      nodesById: {
        ...current.nodesById,
        [id]: { id, collectionId, parentId: existing?.parentId ?? parentId, type: 'request', name: name.trim() || 'Untitled request', request: { ...request, name: name.trim() || request.name } },
      },
      childIdsByParent: existing ? current.childIdsByParent : { ...current.childIdsByParent, [parentId ?? ROOT]: [...(current.childIdsByParent[parentId ?? ROOT] ?? []), id] },
    };
    await persist(next);
    const requestCount = Object.values(next.nodesById).filter((node) => node.type === 'request').length;
    set((state) => ({ collectionsById: withCollection(state, collectionId, () => next), summaries: state.summaries.map((summary) => summary.id === collectionId ? { ...summary, requestCount } : summary) }));
    return id;
  },
  renameNode: async (collectionId, nodeId, name) => {
    const current = get().collectionsById[collectionId];
    const node = current?.nodesById[nodeId];
    if (!current || !node) return;
    const nextName = name.trim() || node.name;
    const renamed = node.type === 'request'
      ? { ...node, name: nextName, request: { ...node.request, name: nextName } }
      : { ...node, name: nextName };
    const next = { ...current, nodesById: { ...current.nodesById, [nodeId]: renamed } };
    await persist(next);
    set((state) => ({ collectionsById: withCollection(state, collectionId, () => next) }));
  },
  deleteNode: async (collectionId, nodeId) => {
    const current = get().collectionsById[collectionId];
    if (!current?.nodesById[nodeId]) return [];
    const removedIds = descendants(current, nodeId);
    const next = removeNode(current, nodeId);
    await persist(next);
    const requestCount = Object.values(next.nodesById).filter((node) => node.type === 'request').length;
    const folderCount = Object.values(next.nodesById).filter((node) => node.type === 'folder').length;
    const removed = new Set(removedIds);
    set((state) => ({
      collectionsById: withCollection(state, collectionId, () => next),
      summaries: state.summaries.map((summary) => summary.id === collectionId ? { ...summary, requestCount, folderCount } : summary),
      expandedIds: Object.fromEntries(Object.entries(state.expandedIds).filter(([key]) => !removed.has(key))),
    }));
    return removedIds;
  },
  duplicateNode: async (collectionId, nodeId) => {
    const current = get().collectionsById[collectionId];
    const source = current?.nodesById[nodeId];
    if (!current || !source) throw new Error('Node not found');
    const mutable: Normalized = { nodesById: { ...current.nodesById }, childIdsByParent: Object.fromEntries(Object.entries(current.childIdsByParent).map(([key, ids]) => [key, [...ids]])), collectionId: current.collectionId, name: current.name };
    const clone = (sourceId: string, parentId: string | null): string => {
      const original = mutable.nodesById[sourceId];
      const id = uid();
      const copied: FlatNode = original.type === 'folder'
        ? { ...original, id, parentId, name: `${original.name} copy` }
        : { ...original, id, parentId, name: `${original.name} copy`, request: { ...original.request, id: uid(), name: `${original.name} copy` } };
      mutable.nodesById[id] = copied;
      mutable.childIdsByParent[parentId ?? ROOT] = [...(mutable.childIdsByParent[parentId ?? ROOT] ?? []), id];
      if (original.type === 'folder') {
        mutable.childIdsByParent[id] = [];
        for (const child of current.childIdsByParent[sourceId] ?? []) clone(child, id);
      }
      return id;
    };
    const clonedId = clone(nodeId, source.parentId);
    await persist(mutable);
    const requestCount = Object.values(mutable.nodesById).filter((item) => item.type === 'request').length;
    const folderCount = Object.values(mutable.nodesById).filter((item) => item.type === 'folder').length;
    set((state) => ({ collectionsById: withCollection(state, collectionId, () => mutable), summaries: state.summaries.map((summary) => summary.id === collectionId ? { ...summary, requestCount, folderCount } : summary) }));
    return clonedId;
  },
  moveNode: async (sourceCollectionId, nodeId, targetCollectionId, targetParentId, targetIndex) => {
    const source = get().collectionsById[sourceCollectionId];
    const target = get().collectionsById[targetCollectionId];
    const node = source?.nodesById[nodeId];
    if (!source || !target || !node) throw new Error('Node not found');
    if (sourceCollectionId === targetCollectionId && isDescendant(source.nodesById, nodeId, targetParentId)) throw new Error('Cannot move a folder into itself or its descendants.');
    const sourceNext = removeNode(source, nodeId);
    const movingIds = descendants(source, nodeId);
    const moved: Record<string, FlatNode> = {};
    const remap = (id: string, parentId: string | null) => {
      const currentNode = source.nodesById[id];
      if (!currentNode) return;
      moved[id] = { ...currentNode, collectionId: targetCollectionId, parentId };
      for (const childId of source.childIdsByParent[id] ?? []) remap(childId, id);
    };
    remap(nodeId, targetParentId);
    const targetBase = sourceCollectionId === targetCollectionId ? sourceNext : target;
    const targetChildren = [...(targetBase.childIdsByParent[targetParentId ?? ROOT] ?? [])].filter((id) => !movingIds.includes(id));
    let insertIndex = targetIndex ?? targetChildren.length;
    if (sourceCollectionId === targetCollectionId && node.parentId === targetParentId) {
      const originalIndex = source.childIdsByParent[targetParentId ?? ROOT]?.indexOf(nodeId) ?? -1;
      if (originalIndex >= 0 && originalIndex < insertIndex) insertIndex -= 1;
    }
    targetChildren.splice(Math.max(0, Math.min(insertIndex, targetChildren.length)), 0, nodeId);
    const movedChildren = Object.fromEntries(movingIds.filter((id) => source.childIdsByParent[id]).map((id) => [id, [...source.childIdsByParent[id]]]));
    const targetNext: Normalized = { ...targetBase, nodesById: { ...targetBase.nodesById, ...moved }, childIdsByParent: { ...targetBase.childIdsByParent, ...movedChildren, [targetParentId ?? ROOT]: targetChildren } };
    if (sourceCollectionId === targetCollectionId) {
      await persist(targetNext);
      set((state) => ({ collectionsById: withCollection(state, sourceCollectionId, () => targetNext) }));
      return;
    }
    try {
      await Promise.all([persist(sourceNext), persist(targetNext)]);
    } catch (error) {
      await Promise.allSettled([persist(source), persist(target)]);
      throw error;
    }
    const counts = (collection: Normalized) => ({ requestCount: Object.values(collection.nodesById).filter((item) => item.type === 'request').length, folderCount: Object.values(collection.nodesById).filter((item) => item.type === 'folder').length });
    set((state) => ({
      collectionsById: { ...state.collectionsById, [sourceCollectionId]: sourceNext, [targetCollectionId]: targetNext },
      summaries: state.summaries.map((summary) => summary.id === sourceCollectionId ? { ...summary, ...counts(sourceNext) } : summary.id === targetCollectionId ? { ...summary, ...counts(targetNext) } : summary),
    }));
  },
}));
