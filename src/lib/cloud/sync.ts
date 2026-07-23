import type { WorkspaceRecord } from '../../types';
import { getSetting, setSetting } from '../registry';
import { storageProvider } from '../storage/localJson';
import { stableStringify } from '../storage/serialization';
import { acceptCloudCollectionRevision, cloudCollectionHashKey, getCloudSnapshot, pushCloudCollection } from './client';
import { applyCloudSnapshot } from './state';

export async function pullCloudWorkspace(workspace: WorkspaceRecord): Promise<number> {
  const snapshot = await getCloudSnapshot(workspace.id);
  const collections = snapshot.entities.filter((entity) => entity.entityType === 'collection');
  const remoteIds = new Set(collections.map((entity) => entity.entityId));
  await applyCloudSnapshot(async () => {
    for (const entity of collections) {
      const hashKey = cloudCollectionHashKey(workspace.id, entity.entityId);
      const previousHash = await getSetting<string>(hashKey);
      const local = await storageProvider.loadCollection(entity.entityId).catch(() => null);
      const localHash = local ? stableStringify(local) : null;
      if (entity.deleted) {
        if (local && previousHash !== localHash) throw new Error(`Cloud conflict in “${local.name}”. Your local collection was kept.`);
        if (local) await storageProvider.deleteCollection(entity.entityId);
        await acceptCloudCollectionRevision(workspace.id, entity.entityId, entity.revision);
        await setSetting(hashKey, null);
        continue;
      }
      const remote = entity.payload?.collection;
      if (!remote) continue;
      const remoteHash = stableStringify(remote);
      if (!local || localHash === previousHash) await storageProvider.saveCollection(remote);
      else if (remoteHash === previousHash) {
        await acceptCloudCollectionRevision(workspace.id, entity.entityId, entity.revision);
        await pushCloudCollection(workspace.id, local);
        continue;
      }
      else if (localHash !== remoteHash) throw new Error(`Cloud conflict in “${remote.name}”. Your local collection was kept.`);
      await acceptCloudCollectionRevision(workspace.id, entity.entityId, entity.revision);
      await setSetting(hashKey, remoteHash);
    }
    for (const summary of await storageProvider.listCollections()) {
      if (remoteIds.has(summary.id) || await getSetting(cloudCollectionHashKey(workspace.id, summary.id)) !== null) continue;
      await pushCloudCollection(workspace.id, await storageProvider.loadCollection(summary.id));
    }
  });
  return collections.length;
}
