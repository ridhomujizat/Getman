import { invoke } from '@tauri-apps/api/core';
import type { WorkspaceRecord, WorkspaceSyncType } from '../../types';

export interface CreateWorkspaceInput {
  name: string;
  rootPath: string;
  syncType: WorkspaceSyncType;
  gitRemote?: string;
  gitBranch?: string;
  connectionUrl?: string;
  deviceName?: string;
}

export const listWorkspaces = () => invoke<WorkspaceRecord[]>('registry_list_workspaces');
export const getWorkspace = (id: string) => invoke<WorkspaceRecord | null>('registry_get_workspace', { id });
export const createWorkspace = (input: CreateWorkspaceInput) => invoke<WorkspaceRecord>('registry_create_workspace', { input });
export const renameWorkspace = (id: string, name: string) => invoke<WorkspaceRecord>('registry_rename_workspace', { id, name });
export const deleteWorkspace = (id: string) => invoke<void>('registry_delete_workspace', { id });
export const touchLastOpened = (id: string) => invoke<void>('registry_touch_workspace', { id });
export const defaultWorkspacePath = (slug: string) => invoke<string>('registry_default_workspace_path', { slug });

export async function getSetting<T>(key: string): Promise<T | null> {
  const value = await invoke<string | null>('registry_get_setting', { key });
  return value == null ? null : JSON.parse(value) as T;
}

export const setSetting = (key: string, value: unknown) => invoke<void>('registry_set_setting', { key, value: JSON.stringify(value) });

export async function resolveBootWorkspace(): Promise<{ current: WorkspaceRecord; workspaces: WorkspaceRecord[] }> {
  const workspaces = await listWorkspaces();
  if (!workspaces.length) throw new Error('No workspace is available.');
  const bootId = new URLSearchParams(window.location.search).get('workspaceId');
  const lastId = bootId ?? await getSetting<string>('last_workspace_id');
  return { current: workspaces.find((workspace) => workspace.id === lastId) ?? workspaces[0], workspaces };
}

export const registerWorkspaceWindow = (workspaceId: string) => invoke<void>('register_workspace_window', { workspaceId });
export const setWorkspaceWindowTitle = (workspaceName: string) => invoke<void>('set_workspace_window_title', { workspaceName });
export const openWorkspaceWindow = (workspace: WorkspaceRecord) => invoke<void>('open_workspace_window', { workspaceId: workspace.id, workspaceName: workspace.name });
