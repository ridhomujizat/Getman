// Run: node src/lib/collections.test.ts (Node >=22)
import assert from 'node:assert';
import { denormalizeCollection, isDescendant, normalizeCollection, normalizeForCompare } from './collections.ts';
import type { Collection, TesApiRequest } from '../types/index.ts';

const request = (id: string): TesApiRequest => ({
  id, method: 'GET', url: 'https://example.com/items', params: [], headers: [], body: { type: 'none' }, auth: { type: 'none' },
});
const collection: Collection = {
  id: 'c', name: 'API', schemaVersion: 1, root: [{
    id: 'folder', type: 'folder', name: 'Nested', children: [{ id: 'request', type: 'request', name: 'List', request: request('r') }],
  }],
};
const normalized = normalizeCollection(collection);
assert.deepEqual(denormalizeCollection(normalized), collection);
assert.equal(isDescendant(normalized.nodesById, 'folder', null), false);
assert.equal(isDescendant(normalized.nodesById, 'folder', 'folder'), true);
assert.equal(normalizeForCompare(request('a')), normalizeForCompare(request('b')));

console.log('collections.test.ts: all assertions passed');
