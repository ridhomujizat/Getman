// Run: node src/lib/environments.test.ts (Node >=22)
import assert from 'node:assert';
import { resolveRequest } from './environments.ts';
import type { TesApiRequest } from '../types/index.ts';

const request: TesApiRequest = {
  id: 'r', method: 'POST', url: '{{base_url}}/items',
  params: [{ id: 'p', key: 'tenant', value: '{{tenant}}', enabled: true }],
  headers: [{ id: 'h', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
  body: { type: 'json', raw: '{"tenant":"{{tenant}}","missing":"{{missing}}"}' },
  auth: { type: 'bearer', token: '{{token}}' },
};
const result = resolveRequest(request, [
  { id: '1', key: 'base_url', value: 'https://example.com', enabled: true },
  { id: '2', key: 'tenant', value: 'acme', enabled: true },
  { id: '3', key: 'token', value: 'secret', enabled: true },
]);
assert.equal(result.request.url, 'https://example.com/items');
assert.equal(result.request.headers[0].value, 'Bearer secret');
assert.equal(result.request.auth.token, 'secret');
assert.deepEqual(result.unresolved, ['missing']);
assert.equal(request.url, '{{base_url}}/items');

console.log('environments.test.ts: all assertions passed');
