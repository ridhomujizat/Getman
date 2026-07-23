import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ToastMessage } from '../components/Toast';
import type { GitConflictFile } from './useGitConflicts';
import type { StorageConflict, WorkspaceRecord } from '../types';
import { getSetting, setSetting } from '../lib/registry';
import { onStorageConflict, onStorageWarning, storageProvider } from '../lib/storage/localJson';
import { reloadWorkspacePath } from '../lib/workspaces/externalChanges';
import { useGitConflicts } from './useGitConflicts';
import { useWorkspaceWatcher } from './useWorkspaceWatcher';

export function useWorkspaceCollaboration(
  workspace: WorkspaceRecord | null,
  ready: boolean,
  retrySync: () => Promise<void>,
  showToast: (message: ToastMessage) => void,
) {
  const [storageConflict, setStorageConflict] = useState<StorageConflict | null>(null);
  const [storageConflictBusy, setStorageConflictBusy] = useState(false);
  const [gitConflictBusy, setGitConflictBusy] = useState(false);
  const [secretReview, setSecretReview] = useState<Awaited<ReturnType<typeof storageProvider.secretReview>>>(null);
  const [secretReviewBusy, setSecretReviewBusy] = useState(false);
  const [secretReviewError, setSecretReviewError] = useState('');
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState('');
  const [syncRetryBusy, setSyncRetryBusy] = useState(false);
  const watcherError = useCallback((error: unknown) => {
    showToast({ title: 'Workspace watcher warning', detail: String(error), tone: 'error' });
  }, [showToast]);
  const gitConflicts = useGitConflicts(workspace, watcherError);
  useWorkspaceWatcher(workspace, setStorageConflict, watcherError);

  useEffect(() => onStorageWarning((message) => showToast({ title: 'Storage warning', detail: message, tone: 'error' })), [showToast]);
  useEffect(() => onStorageConflict(setStorageConflict), []);
  useEffect(() => {
    if (!ready || !workspace || storageProvider.isReadOnly()) return;
    void storageProvider.secretReview().then(setSecretReview).catch(watcherError);
  }, [ready, watcherError, workspace?.id]);
  useEffect(() => {
    if (!ready || workspace?.syncType !== 'git' || storageProvider.isReadOnly()) return;
    void getSetting<{ name: string; email: string }>('git_identity').then((identity) => setIdentityOpen(!identity)).catch(watcherError);
  }, [ready, watcherError, workspace?.id, workspace?.syncType]);

  const resolveStorageConflict = useCallback(async (keepMine: boolean) => {
    if (!storageConflict) return;
    setStorageConflictBusy(true);
    try {
      if (keepMine) await storageConflict.keepMine();
      await reloadWorkspacePath(storageConflict.path, !keepMine);
      setStorageConflict(null);
      showToast({ title: keepMine ? 'Your version was kept' : 'Reloaded from disk' });
    } catch (error) {
      showToast({ title: 'Could not resolve file change', detail: String(error), tone: 'error' });
    } finally {
      setStorageConflictBusy(false);
    }
  }, [showToast, storageConflict]);

  const resolveGitConflict = useCallback(async (file: GitConflictFile, choice: 'mine' | 'theirs') => {
    if (!workspace) return;
    setGitConflictBusy(true);
    try {
      const complete = await invoke<boolean>('git_resolve_workspace_conflict', { rootPath: workspace.rootPath, path: file.path, choice });
      await gitConflicts.refresh();
      if (complete) await retrySync();
      window.dispatchEvent(new Event('tesapi-conflicts-changed'));
      showToast({ title: choice === 'mine' ? 'Kept local version' : 'Accepted remote version' });
    } catch (error) {
      showToast({ title: 'Could not resolve Git conflict', detail: String(error), tone: 'error' });
    } finally {
      setGitConflictBusy(false);
    }
  }, [gitConflicts, retrySync, showToast, workspace]);

  const completeSecretReview = useCallback(async (choice: 'rotated' | 'purged') => {
    setSecretReviewBusy(true);
    setSecretReviewError('');
    try {
      await storageProvider.completeSecretReview(choice);
      setSecretReview(null);
      showToast({ title: choice === 'purged' ? 'Git history verified' : 'Credential review completed' });
    } catch (error) {
      setSecretReviewError(String(error).replace(/^Error:\s*/, ''));
    } finally {
      setSecretReviewBusy(false);
    }
  }, [showToast]);

  const saveIdentity = useCallback(async (name: string, email: string) => {
    if (!workspace) return;
    setIdentityBusy(true);
    setIdentityError('');
    try {
      await invoke('git_set_identity', { rootPath: workspace.rootPath, name, email });
      await setSetting('git_identity', { name, email });
      storageProvider.enableGitSync(await getSetting<boolean>(`workspace:${workspace.id}:autoCommitOnSave`) === true);
      await retrySync();
      setIdentityOpen(false);
    } catch (error) {
      setIdentityError(String(error).replace(/^Error:\s*/, ''));
    } finally {
      setIdentityBusy(false);
    }
  }, [retrySync, workspace]);

  const retryPausedSync = useCallback(() => {
    setSyncRetryBusy(true);
    void retrySync()
      .catch((error) => showToast({ title: 'Workspace sync retry failed', detail: String(error), tone: 'error' }))
      .finally(() => setSyncRetryBusy(false));
  }, [retrySync, showToast]);

  return {
    storageConflict, storageConflictBusy, resolveStorageConflict,
    gitManifest: gitConflicts.manifest, gitConflictBusy, resolveGitConflict,
    secretReview, secretReviewBusy, secretReviewError, completeSecretReview,
    identityOpen, identityBusy, identityError, saveIdentity,
    syncRetryBusy, retryPausedSync,
  };
}
