import type { Collection, TesApiRequest, KeyValue, TreeNode } from '../types';

export type FlatNode =
  | { id: string; collectionId: string; parentId: string | null; type: 'folder'; name: string }
  | { id: string; collectionId: string; parentId: string | null; type: 'request'; name: string; request: TesApiRequest };

export interface NormalizedCollection {
  collectionId: string;
  name: string;
  nodesById: Record<string, FlatNode>;
  childIdsByParent: Record<string, string[]>;
}

export const ROOT = '__root__';

export function normalizeCollection(collection: Collection): NormalizedCollection {
  const nodesById: Record<string, FlatNode> = {};
  const childIdsByParent: Record<string, string[]> = { [ROOT]: [] };
  const visit = (nodes: TreeNode[], parentId: string | null) => {
    const parentKey = parentId ?? ROOT;
    childIdsByParent[parentKey] ??= [];
    for (const node of nodes) {
      const flat: FlatNode = node.type === 'folder'
        ? { id: node.id, collectionId: collection.id, parentId, type: 'folder', name: node.name }
        : { id: node.id, collectionId: collection.id, parentId, type: 'request', name: node.name, request: node.request };
      nodesById[node.id] = flat;
      childIdsByParent[parentKey].push(node.id);
      if (node.type === 'folder') {
        childIdsByParent[node.id] = [];
        visit(node.children, node.id);
      }
    }
  };
  visit(collection.root, null);
  return { collectionId: collection.id, name: collection.name, nodesById, childIdsByParent };
}

export function denormalizeCollection(normalized: NormalizedCollection): Collection {
  const visit = (parentId: string | null): TreeNode[] => {
    const ids = normalized.childIdsByParent[parentId ?? ROOT] ?? [];
    const nodes: TreeNode[] = [];
    for (const id of ids) {
      const node = normalized.nodesById[id];
      if (!node) continue;
      nodes.push(node.type === 'folder'
        ? { id: node.id, type: 'folder', name: node.name, children: visit(node.id) }
        : { id: node.id, type: 'request', name: node.name, request: node.request });
    }
    return nodes;
  };
  return { id: normalized.collectionId, name: normalized.name, schemaVersion: 1, root: visit(null) };
}

export function countNodes(collection: Collection): { requestCount: number; folderCount: number } {
  let requestCount = 0;
  let folderCount = 0;
  const visit = (nodes: TreeNode[]) => nodes.forEach((node) => {
    if (node.type === 'request') requestCount += 1;
    else { folderCount += 1; visit(node.children); }
  });
  visit(collection.root);
  return { requestCount, folderCount };
}

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'id' && key !== 'data')
    .map(([key, entry]) => [key, stripIds(entry)]));
}

function stripRows(rows: KeyValue[] | undefined): unknown[] {
  const active = (rows ?? []).filter((row) => row.key || row.value || row.description || row.valueType === 'file');
  return active.map((row) => stripIds(row));
}

export function normalizeForCompare(request: TesApiRequest): string {
  const normalized = {
    name: request.name ?? '',
    method: request.method,
    url: request.url,
    params: stripRows(request.params),
    headers: stripRows(request.headers),
    body: {
      type: request.body.type,
      raw: request.body.raw ?? '',
      formData: stripRows(request.body.formData),
    },
    auth: stripIds(request.auth),
  };
  return JSON.stringify(normalized);
}

export function isTabDirty(tab: { draft: TesApiRequest; origin: unknown; savedSnapshot: string | null }): boolean {
  return tab.origin === null || normalizeForCompare(tab.draft) !== tab.savedSnapshot;
}

export function isDescendant(nodesById: Record<string, FlatNode>, sourceId: string, targetParentId: string | null): boolean {
  let current = targetParentId;
  while (current) {
    if (current === sourceId) return true;
    current = nodesById[current]?.parentId ?? null;
  }
  return false;
}

export function requestName(request: TesApiRequest): string {
  if (request.name?.trim()) return request.name.trim();
  try {
    return new URL(request.url).pathname.split('/').filter(Boolean).pop() || `${request.method} request`;
  } catch {
    return `${request.method} request`;
  }
}
