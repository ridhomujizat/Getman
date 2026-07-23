import { invoke } from '@tauri-apps/api/core';
import type { Collection } from '../../types';
import { setSetting } from '../registry';
import { stableStringify } from '../storage/serialization';

export interface CloudStatus {
  connected: boolean;
  baseUrl: string | null;
  workspaceId: string | null;
  deviceId: string | null;
  role: 'owner' | 'editor' | 'viewer' | null;
  cursor: string | null;
}

export interface CloudEntity {
  entityId: string;
  entityType: string;
  revision: number;
  deleted: boolean;
  payload?: { collection?: Collection };
}

export interface CloudSnapshot { entities: CloudEntity[]; cursor: string }

export const connectCloudWorkspace = (workspaceId: string, connectionUrl: string, deviceName: string) =>
  invoke<CloudStatus>('cloud_connect', { workspaceId, connectionUrl, deviceName });

export const getCloudStatus = (workspaceId: string) => invoke<CloudStatus>('cloud_status', { workspaceId });

export const disconnectCloudWorkspace = (workspaceId: string) => invoke<void>('cloud_disconnect', { workspaceId });

export const acceptCloudCollectionRevision = (workspaceId: string, collectionId: string, revision: number) =>
  invoke<void>('cloud_accept_collection_revision', { workspaceId, collectionId, revision });

export const cloudCollectionHashKey = (workspaceId: string, collectionId: string) => `workspace:${workspaceId}:cloud:collection:${collectionId}:hash`;

export async function pushCloudCollection(workspaceId: string, collection: Collection): Promise<number> {
  const revision = await invoke<number>('cloud_push_collection', { workspaceId, collection });
  await setSetting(cloudCollectionHashKey(workspaceId, collection.id), stableStringify(collection));
  return revision;
}

export async function deleteCloudCollection(workspaceId: string, collectionId: string): Promise<number> {
  const revision = await invoke<number>('cloud_delete_collection', { workspaceId, collectionId });
  await setSetting(cloudCollectionHashKey(workspaceId, collectionId), null);
  return revision;
}

export const getCloudSnapshot = (workspaceId: string) => invoke<CloudSnapshot>('cloud_snapshot', { workspaceId });
