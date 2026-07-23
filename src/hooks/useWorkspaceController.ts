import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { SessionState, WorkspaceRecord } from '../types';
import { createWorkspace, deleteWorkspace, listWorkspaces, openWorkspaceWindow, renameWorkspace, resolveBootWorkspace, type CreateWorkspaceInput } from '../lib/registry';
import { loadWorkspace, type WorkspaceSyncState } from '../lib/workspaces/lifecycle';
import { storageProvider } from '../lib/storage/localJson';
import type { ToastMessage } from '../components/Toast';
import { connectCloudWorkspace } from '../lib/cloud/client';
import { pullCloudWorkspace } from '../lib/cloud/sync';
import { useCollectionStore } from '../store/collectionStore';

export function useWorkspaceController(onToast: (message: ToastMessage) => void) {
  const [current, setCurrent] = useState<WorkspaceRecord | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [syncState, setSyncState] = useState<WorkspaceSyncState>('idle');
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveBootWorkspace().then(async ({ current: workspace, workspaces: rows }) => {
      const result = await loadWorkspace(workspace);
      if (cancelled) return;
      setBootError(null);
      setCurrent(workspace);
      setWorkspaces(rows);
      setSyncState(result.syncState);
      setReady(true);
      if (result.warning) onToast({ title: 'Workspace opened with a sync warning', detail: result.warning, tone: 'error' });
    }).catch((error) => {
      if (!cancelled) {
        setBootError(String(error));
        setReady(true);
        onToast({ title: 'Workspace unavailable', detail: String(error), tone: 'error' });
      }
    });
    return () => { cancelled = true; };
  }, [onToast]);

  const refresh = useCallback(async () => setWorkspaces(await listWorkspaces()), []);

  const replace = useCallback(async (workspace: WorkspaceRecord, session: SessionState) => {
    if (workspace.id === current?.id) return;
    setReady(false);
    try {
      if (!storageProvider.isReadOnly()) await storageProvider.saveSession(session);
      await storageProvider.flush();
      const result = await loadWorkspace(workspace);
      setCurrent(workspace);
      setSyncState(result.syncState);
      await refresh();
      if (result.warning) onToast({ title: 'Workspace opened with a sync warning', detail: result.warning, tone: 'error' });
    } finally {
      setReady(true);
    }
  }, [current?.id, onToast, refresh]);

  const create = useCallback(async (input: CreateWorkspaceInput) => {
    const workspace = await createWorkspace(input);
    if (workspace.syncType === 'cloud' && input.connectionUrl) {
      try { await connectCloudWorkspace(workspace.id, input.connectionUrl, input.deviceName || 'TesAPI desktop'); }
      catch (error) { await deleteWorkspace(workspace.id); throw error; }
    }
    await refresh();
    return workspace;
  }, [refresh]);

  const rename = useCallback(async (id: string, name: string) => {
    const updated = await renameWorkspace(id, name);
    setWorkspaces((rows) => rows.map((row) => row.id === id ? updated : row));
    if (current?.id === id) setCurrent(updated);
  }, [current?.id]);

  const remove = useCallback(async (id: string) => {
    if (current?.id === id) throw new Error('Switch to another workspace before removing this one.');
    await deleteWorkspace(id);
    setWorkspaces((rows) => rows.filter((row) => row.id !== id));
  }, [current?.id]);

  const retrySync = useCallback(async () => {
    if (!current || !['git', 'cloud'].includes(current.syncType)) return;
    if (current.syncType === 'cloud') {
      await pullCloudWorkspace(current);
      useCollectionStore.getState().reset();
      await useCollectionStore.getState().initialize();
      await useCollectionStore.getState().loadAll();
      setSyncState('synced');
      return;
    }
    const result = await invoke<{ state: WorkspaceSyncState }>('git_pull_workspace', {
      rootPath: current.rootPath,
      branch: current.gitBranch ?? 'main',
    });
    setSyncState(result.state);
  }, [current]);

  return { current, workspaces, ready, bootError, syncState, retrySync, replace, create, rename, remove, refresh, openNewWindow: openWorkspaceWindow };
}
