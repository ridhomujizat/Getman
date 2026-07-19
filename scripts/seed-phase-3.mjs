import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/seed-phase-3.mjs <tesapi-app-data-root>');

const workspaceId = 'performance-workspace';
const workspaceRoot = join(root, 'workspaces', workspaceId);
const collectionsRoot = join(workspaceRoot, 'collections');
await mkdir(collectionsRoot, { recursive: true });
await writeFile(join(root, 'workspaces.json'), JSON.stringify({ schemaVersion: 1, activeWorkspaceId: workspaceId, workspaces: [{ id: workspaceId, name: 'Performance Workspace', storage: { type: 'local' } }] }, null, 2));
await writeFile(join(workspaceRoot, 'workspace.json'), JSON.stringify({ schemaVersion: 1, name: 'Performance Workspace', storage: { type: 'local' } }, null, 2));
await writeFile(join(workspaceRoot, 'environments.json'), JSON.stringify({ schemaVersion: 1, activeEnvironmentId: null, environments: [] }, null, 2));

const request = (collection, index) => ({
  id: crypto.randomUUID(), name: `Request ${collection}-${index}`, method: index % 5 === 0 ? 'POST' : 'GET',
  url: `https://api.example.com/v1/collections/${collection}/items/${index}`, params: [], headers: [], body: { type: 'none', raw: '', formData: [] }, auth: { type: 'none' },
});

for (let collectionIndex = 0; collectionIndex < 50; collectionIndex += 1) {
  let children = [];
  const collection = { id: `collection-${collectionIndex}`, name: `Collection ${String(collectionIndex + 1).padStart(2, '0')}`, schemaVersion: 1, root: children };
  for (let depth = 0; depth < 12; depth += 1) {
    const folder = { id: crypto.randomUUID(), type: 'folder', name: `Level ${depth + 1}`, children: [] };
    children.push(folder);
    children = folder.children;
  }
  for (let index = 0; index < 200; index += 1) children.push({ id: crypto.randomUUID(), type: 'request', name: `Request ${collectionIndex}-${index}`, request: request(collectionIndex, index) });
  await writeFile(join(collectionsRoot, `${collection.id}.json`), `${JSON.stringify(collection, null, 2)}\n`);
}

console.log(`Seeded 50 collections and 10,000 requests in ${root}`);
