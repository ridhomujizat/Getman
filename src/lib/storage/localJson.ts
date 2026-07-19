import { invoke } from '@tauri-apps/api/core';
import type { Collection, CollectionSummary, EnvironmentsFile, HistoryEntry, HistoryQuery, SessionState, WorkspaceFile, WorkspaceMeta } from '../../types';
import { countNodes } from '../collections';
import { uid } from '../id';
import { migrate } from './migrate';
import { collectionPath, collectionsPath, environmentsPath, historyPath, registryPath, sessionPath, workspacePath, workspaceRoot } from './paths';
import type { StorageProvider } from './provider';

const HISTORY_LIMIT = 1000;
const warningListeners = new Set<(message: string) => void>();

export const onStorageWarning = (listener: (message: string) => void) => {
  warningListeners.add(listener);
  return () => { warningListeners.delete(listener); };
};

const warn = (message: string) => warningListeners.forEach((listener) => listener(message));

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
}

export const stableStringify = (value: unknown) => `${JSON.stringify(stable(value), null, 2)}\n`;

interface RecoveryResult { quarantinedPath: string; backup?: string }
interface CollectionSummaryRecord { fileName: string; summary: CollectionSummary | null }

export class LocalJsonProvider implements StorageProvider {
  private meta: WorkspaceMeta | null = null;

  private async read<T>(path: string): Promise<T | null> {
    const contents = await invoke<string | null>('read_json', { path });
    if (contents == null) return null;
    try {
      return JSON.parse(contents) as T;
    } catch {
      const recovered = await invoke<RecoveryResult>('quarantine_file', { path });
      warn(`Recovered corrupt storage file: ${path}`);
      if (!recovered.backup) return null;
      try {
        const parsed = JSON.parse(recovered.backup) as T;
        await invoke('atomic_write_json', { path, contents: stableStringify(parsed) });
        return parsed;
      } catch {
        throw new Error(`Storage file and backup are both corrupt: ${path}`);
      }
    }
  }

  private async write(path: string, value: unknown): Promise<void> {
    await invoke('atomic_write_json', { path, contents: stableStringify(value) });
  }

  private async activeWorkspaceId(): Promise<string> {
    return (this.meta ?? await this.loadWorkspaceMeta()).activeWorkspaceId;
  }

  async initialize(): Promise<WorkspaceMeta> {
    let meta = await this.read<WorkspaceMeta>(registryPath);
    if (!meta) {
      const id = uid();
      meta = { schemaVersion: 1, activeWorkspaceId: id, workspaces: [{ id, name: 'My Workspace', storage: { type: 'local' } }] };
      await invoke('ensure_dirs', { paths: [workspaceRoot(id), collectionsPath(id)] });
      await this.write(registryPath, meta);
      const workspace: WorkspaceFile = { schemaVersion: 1, name: 'My Workspace', storage: { type: 'local' } };
      await this.write(workspacePath(id), workspace);
      await this.write(environmentsPath(id), { schemaVersion: 1, activeEnvironmentId: null, environments: [] });
    }
    this.meta = migrate(meta);
    const workspaceId = this.meta.activeWorkspaceId;
    await invoke('ensure_dirs', { paths: [workspaceRoot(workspaceId), collectionsPath(workspaceId)] });
    if (!await this.read<WorkspaceFile>(workspacePath(workspaceId))) {
      const descriptor = this.meta.workspaces.find((workspace) => workspace.id === workspaceId)!;
      await this.write(workspacePath(workspaceId), { schemaVersion: 1, name: descriptor.name, storage: descriptor.storage });
    }
    if (!await this.read<EnvironmentsFile>(environmentsPath(workspaceId))) {
      await this.write(environmentsPath(workspaceId), { schemaVersion: 1, activeEnvironmentId: null, environments: [] });
    }
    return this.meta;
  }

  async loadWorkspaceMeta(): Promise<WorkspaceMeta> {
    const meta = await this.read<WorkspaceMeta>(registryPath);
    if (!meta) return this.initialize();
    this.meta = migrate(meta);
    return this.meta;
  }

  async listCollections(): Promise<CollectionSummary[]> {
    const workspaceId = await this.activeWorkspaceId();
    const records = await invoke<CollectionSummaryRecord[]>('list_collection_summaries', { path: collectionsPath(workspaceId) });
    const summaries: CollectionSummary[] = [];
    for (const record of records) {
      if (record.summary) {
        summaries.push(record.summary);
        continue;
      }
      const collection = await this.read<Collection>(`${collectionsPath(workspaceId)}/${record.fileName}`);
      if (!collection) continue;
      const counts = countNodes(collection);
      summaries.push({ id: collection.id, name: collection.name, ...counts });
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async loadCollection(id: string): Promise<Collection> {
    const collection = await this.read<Collection>(collectionPath(await this.activeWorkspaceId(), id));
    if (!collection) throw new Error(`Collection not found: ${id}`);
    return migrate(collection);
  }

  async saveCollection(collection: Collection): Promise<void> {
    await this.write(collectionPath(await this.activeWorkspaceId(), collection.id), migrate(collection));
  }

  async deleteCollection(id: string): Promise<void> {
    await invoke('delete_file', { path: collectionPath(await this.activeWorkspaceId(), id) });
  }

  async appendHistory(entry: HistoryEntry): Promise<void> {
    const path = historyPath(await this.activeWorkspaceId());
    await invoke('append_line', { path, line: JSON.stringify(entry) });
    const lines = await invoke<string[]>('read_last_lines', { path, count: HISTORY_LIMIT + 1 });
    if (lines.length > HISTORY_LIMIT) await invoke('atomic_write_json', { path, contents: `${lines.slice(-HISTORY_LIMIT).join('\n')}\n` });
  }

  async queryHistory(query: HistoryQuery): Promise<HistoryEntry[]> {
    const lines = await invoke<string[]>('read_last_lines', { path: historyPath(await this.activeWorkspaceId()), count: query.limit ?? HISTORY_LIMIT });
    const search = query.search?.toLowerCase() ?? '';
    return lines.reverse().flatMap((line) => {
      try { return [JSON.parse(line) as HistoryEntry]; } catch { return []; }
    }).filter((entry) => {
      if (search && !entry.url.toLowerCase().includes(search)) return false;
      if (query.method && query.method !== 'ALL' && entry.method !== query.method) return false;
      if (query.statusClass && query.statusClass !== 'ALL') {
        if (query.statusClass === 'error') return entry.status === 0;
        return Math.floor(entry.status / 100) === Number(query.statusClass[0]);
      }
      return true;
    });
  }

  async clearHistory(): Promise<void> {
    const path = historyPath(await this.activeWorkspaceId());
    await Promise.all([
      invoke('delete_file', { path }),
      invoke('delete_file', { path: `${path}.bak` }),
    ]);
  }

  async loadSession(): Promise<SessionState | null> {
    return this.read<SessionState>(sessionPath(await this.activeWorkspaceId()));
  }

  async saveSession(session: SessionState): Promise<void> {
    await this.write(sessionPath(await this.activeWorkspaceId()), session);
  }

  async loadEnvironments(): Promise<EnvironmentsFile> {
    return migrate(await this.read<EnvironmentsFile>(environmentsPath(await this.activeWorkspaceId())) ?? { schemaVersion: 1, activeEnvironmentId: null, environments: [] });
  }

  async saveEnvironments(environments: EnvironmentsFile): Promise<void> {
    await this.write(environmentsPath(await this.activeWorkspaceId()), migrate(environments));
  }
}

export const storageProvider = new LocalJsonProvider();
