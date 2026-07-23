import { invoke } from '@tauri-apps/api/core';
import type {
  Collection,
  CollectionSummary,
  EnvironmentsFile,
  HistoryEntry,
  HistoryQuery,
  SessionState,
  StorageConflict,
  WorkspaceMeta,
  WorkspaceRecord,
} from '../../types';
import { CollectionFiles } from './collectionFiles';
import { EnvironmentFiles, type SecretReviewState } from './environmentFiles';
import { historyPath, isSidecarPath } from './paths';
import type { StorageProvider } from './provider';
import { WorkspaceFileClient, WorkspaceWriteConflict } from './workspaceFileClient';
import { deleteCloudCollection, pushCloudCollection } from '../cloud/client';
import { isApplyingCloudSnapshot } from '../cloud/state';

const HISTORY_LIMIT = 1000;
const warningListeners = new Set<(message: string) => void>();
const conflictListeners = new Set<(conflict: StorageConflict) => void>();

export const onStorageWarning = (listener: (message: string) => void) => {
  warningListeners.add(listener);
  return () => { warningListeners.delete(listener); };
};

export const onStorageConflict = (listener: (conflict: StorageConflict) => void) => {
  conflictListeners.add(listener);
  return () => { conflictListeners.delete(listener); };
};

const warn = (message: string) => warningListeners.forEach((listener) => listener(message));
export { stableStringify } from './serialization';

export class LocalJsonProvider implements StorageProvider {
  private readonly files = new WorkspaceFileClient(warn);
  private readonly collections = new CollectionFiles(this.files);
  private readonly environments = new EnvironmentFiles(this.files);

  configure(workspace: WorkspaceRecord): void { this.files.configure(workspace); }
  currentWorkspace(): WorkspaceRecord | null { return this.files.currentWorkspace(); }
  isReadOnly(): boolean { return this.files.isReadOnly(); }
  readOnlyReason(): string | null { return this.files.readOnlyReason(); }
  inspectCompatibility(): Promise<void> { return this.detectForwardCompatibility(); }
  enableGitSync(autoCommitOnSave = true): void { this.files.enableGitSync(autoCommitOnSave); }

  async initialize(): Promise<WorkspaceMeta> {
    const workspace = this.requiredWorkspace();
    await this.detectForwardCompatibility();
    if (this.files.isReadOnly()) return this.loadWorkspaceMeta();
    await invoke('ensure_dirs', { paths: [workspace.rootPath, `${workspace.rootPath}/collections`] });
    if (workspace.syncType === 'git') await invoke('prepare_workspace_gitignore', { rootPath: workspace.rootPath });
    if (!await this.files.readJson('workspace.json')) {
      await this.files.writeJson('workspace.json', {
        schemaVersion: 1,
        id: workspace.id,
        name: workspace.name,
        syncType: workspace.syncType,
        gitRemote: workspace.gitRemote,
        gitBranch: workspace.gitBranch,
      });
    }
    await this.runWrite(async () => this.environments.save(await this.environments.load()));
    return this.loadWorkspaceMeta();
  }

  async loadWorkspaceMeta(): Promise<WorkspaceMeta> {
    const workspace = this.requiredWorkspace();
    return {
      schemaVersion: 1,
      activeWorkspaceId: workspace.id,
      workspaces: [{
        id: workspace.id,
        name: workspace.name,
        storage: { type: workspace.syncType, rootPath: workspace.rootPath, git: { enabled: workspace.syncType === 'git' } },
      }],
    };
  }

  listCollections(): Promise<CollectionSummary[]> { return this.collections.list(); }
  loadCollection(id: string): Promise<Collection> { return this.collections.load(id); }
  async saveCollection(collection: Collection): Promise<void> {
    await this.runWrite(() => this.collections.save(collection));
    const workspace = this.currentWorkspace();
    if (workspace?.syncType === 'cloud' && !isApplyingCloudSnapshot()) {
      await pushCloudCollection(workspace.id, collection).catch((error) => warn(`Saved locally, but cloud sync failed: ${String(error)}`));
    }
  }

  async deleteCollection(id: string): Promise<void> {
    await this.runWrite(() => this.collections.delete(id));
    const workspace = this.currentWorkspace();
    if (workspace?.syncType === 'cloud' && !isApplyingCloudSnapshot()) {
      await deleteCloudCollection(workspace.id, id).catch((error) => warn(`Deleted locally, but cloud sync failed: ${String(error)}`));
    }
  }

  async appendHistory(entry: HistoryEntry): Promise<void> {
    const path = historyPath(this.files.rootPath());
    await this.files.appendLine('history.ndjson', JSON.stringify(entry));
    const lines = await invoke<string[]>('read_last_lines', { path, count: HISTORY_LIMIT + 1 });
    if (lines.length > HISTORY_LIMIT) await this.files.writeText('history.ndjson', `${lines.slice(-HISTORY_LIMIT).join('\n')}\n`);
  }

  async queryHistory(query: HistoryQuery): Promise<HistoryEntry[]> {
    const lines = await invoke<string[]>('read_last_lines', { path: historyPath(this.files.rootPath()), count: query.limit ?? HISTORY_LIMIT });
    const search = query.search?.toLowerCase() ?? '';
    return lines.reverse().flatMap((line) => { try { return [JSON.parse(line) as HistoryEntry]; } catch { return []; } }).filter((entry) => {
      if (search && !entry.url.toLowerCase().includes(search)) return false;
      if (query.method && query.method !== 'ALL' && entry.method !== query.method) return false;
      if (query.statusClass && query.statusClass !== 'ALL') return query.statusClass === 'error' ? entry.status === 0 : Math.floor(entry.status / 100) === Number(query.statusClass[0]);
      return true;
    });
  }

  async clearHistory(): Promise<void> {
    await Promise.all([this.files.deleteFile('history.ndjson'), this.files.deleteFile('history.ndjson.bak')]);
  }

  loadSession(): Promise<SessionState | null> { return this.files.readJson<SessionState>('session.json'); }
  saveSession(session: SessionState): Promise<void> { return this.runWrite(() => this.files.writeJson('session.json', session).then(() => undefined)); }
  loadEnvironments(): Promise<EnvironmentsFile> { return this.environments.load(); }
  saveEnvironments(file: EnvironmentsFile): Promise<void> { return this.runWrite(() => this.environments.save(file)); }

  secretReview(): Promise<SecretReviewState | null> { return this.environments.reviewState(); }
  completeSecretReview(choice: 'rotated' | 'purged'): Promise<void> { return this.environments.completeReview(choice); }
  flush(): Promise<void> { return this.files.flush(); }
  externalChanges(paths: string[]): Promise<string[]> { return this.files.externalChanges(paths); }
  acceptExternal(path: string): Promise<void> { return this.files.acceptExternal(path); }

  private requiredWorkspace(): WorkspaceRecord {
    const workspace = this.files.currentWorkspace();
    if (!workspace) throw new Error('Workspace storage is not configured.');
    return workspace;
  }

  private async detectForwardCompatibility(): Promise<void> {
    const descriptor = await this.files.inspectJson<{ schemaVersion?: number }>('workspace.json');
    this.files.guardSchema('workspace.json', descriptor?.schemaVersion, 1);
    const environments = await this.files.inspectJson<{ schemaVersion?: number }>('environments.json');
    this.files.guardSchema('environments.json', environments?.schemaVersion, 2);
    const local = await this.files.inspectJson<{ schemaVersion?: number }>('environments.local.json');
    this.files.guardSchema('environments.local.json', local?.schemaVersion, 1);
    const session = await this.files.inspectJson<{ schemaVersion?: number }>('session.json');
    this.files.guardSchema('session.json', session?.schemaVersion, 1);
    for (const entry of await this.files.list('collections')) {
      if (entry.endsWith('.json')) {
        const value = await this.files.inspectJson<{ schemaVersion?: number }>(`collections/${entry}`);
        this.files.guardSchema(`collections/${entry}`, value?.schemaVersion, 1);
        continue;
      }
      for (const file of ['collection.json', 'tree.json']) {
        const path = `collections/${entry}/${file}`;
        const value = await this.files.inspectJson<{ schemaVersion?: number }>(path);
        this.files.guardSchema(path, value?.schemaVersion, 2);
      }
      for (const request of await this.files.list(`collections/${entry}/requests`)) {
        if (!request.endsWith('.json') || isSidecarPath(request)) continue;
        const path = `collections/${entry}/requests/${request}`;
        const value = await this.files.inspectJson<{ schemaVersion?: number }>(path);
        this.files.guardSchema(path, value?.schemaVersion, 2);
      }
    }
  }

  private async runWrite<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof WorkspaceWriteConflict) {
        conflictListeners.forEach((listener) => listener({
          path: error.path,
          detail: 'This file changed outside TesAPI after it was loaded.',
          keepMine: error.retry,
        }));
      }
      throw error;
    }
  }
}

export const storageProvider = new LocalJsonProvider();
