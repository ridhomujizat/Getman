import { useCallback, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listMcpApprovals } from '../lib/mcp/client';
import { storageProvider } from '../lib/storage/localJson';
import { useGitStore } from '../store/gitStore';
import { useRequestStore } from '../store/requestStore';
import { useUpdateStore } from '../lib/updates/store';
import type { ToastMessage } from '../components/Toast';
import type { WorkspaceRecord } from '../types';

interface Props {
  ready: boolean;
  currentWorkspace: WorkspaceRecord | null;
  workspaces: WorkspaceRecord[];
  onToast: (message: ToastMessage) => void;
}

export function useAppUpdater({ ready, currentWorkspace, workspaces, onToast }: Props) {
  const initialize = useUpdateStore((state) => state.initialize);
  const initializedNotice = useRef(false);

  useEffect(() => {
    if (!ready) return;
    void initialize().catch((error) => onToast({ title: 'Could not initialize updates', detail: String(error), tone: 'error' }));
  }, [initialize, onToast, ready]);

  const updatedVersion = useUpdateStore((state) => state.updatedVersion);
  useEffect(() => {
    if (!updatedVersion || initializedNotice.current) return;
    initializedNotice.current = true;
    onToast({ title: 'TesAPI updated', detail: `Now running version ${updatedVersion}.` });
  }, [onToast, updatedVersion]);

  useEffect(() => {
    if (!ready || !currentWorkspace || getCurrentWindow().label !== 'main') return;
    const timer = window.setTimeout(() => void useUpdateStore.getState().checkForUpdates(), 2500);
    return () => window.clearTimeout(timer);
  }, [currentWorkspace, ready]);

  const install = useCallback(async () => {
    const [activeRequests, pendingApprovals, busyRoots] = await Promise.all([
      invoke<number>('http_active_requests'),
      listMcpApprovals(),
      Promise.all(workspaces.map(async (workspace) => ({ workspace, busy: await invoke<boolean>('workspace_queue_busy', { rootPath: workspace.rootPath }) }))),
    ]);
    const blockers = [
      activeRequests > 0 ? `${activeRequests} API request${activeRequests === 1 ? '' : 's'} still running` : '',
      pendingApprovals.length ? `${pendingApprovals.length} MCP approval${pendingApprovals.length === 1 ? '' : 's'} pending` : '',
      ...busyRoots.filter((item) => item.busy).map((item) => `workspace activity in ${item.workspace.name}`),
      useRequestStore.getState().loading ? 'the active API request is still finishing' : '',
      useGitStore.getState().inFlight ? `Git ${useGitStore.getState().inFlight} is still running` : '',
    ].filter(Boolean);
    if (blockers.length) throw new Error(`Finish ${blockers.join('; ')} before restarting TesAPI.`);

    await Promise.all(workspaces.map((workspace) => invoke('workspace_flush', { rootPath: workspace.rootPath })));
    await storageProvider.flush();
    await useUpdateStore.getState().install();
  }, [workspaces]);

  return { install };
}
