import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { reloadWorkspacePath } from '../lib/workspaces/externalChanges';
import { useCollectionStore } from '../store/collectionStore';
import type { WorkspaceRecord } from '../types';

interface McpWorkspaceSaved {
  workspaceId: string;
  collectionId: string;
  folderId?: string | null;
}

export function useMcpWorkspaceEvents(workspace: WorkspaceRecord | null, onError: (error: unknown) => void): void {
  useEffect(() => {
    if (!workspace) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<McpWorkspaceSaved>('mcp-workspace-saved', (event) => {
      if (event.payload.workspaceId !== workspace.id) return;
      void (async () => {
        const store = useCollectionStore.getState();
        await store.refreshSummaries();
        await reloadWorkspacePath(`collections/${event.payload.collectionId}/tree.json`, false);
        store.setExpanded(event.payload.collectionId, true);
        if (event.payload.folderId) store.setExpanded(event.payload.folderId, true);
        window.dispatchEvent(new Event('tesapi-workspace-saved'));
      })().catch(onError);
    }).then((unlisten) => {
      if (disposed) unlisten(); else stop = unlisten;
    }).catch(onError);
    return () => { disposed = true; stop?.(); };
  }, [onError, workspace?.id]);
}
