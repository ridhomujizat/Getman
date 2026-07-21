// Run: node src/lib/environments.test.ts (Node >=22)
import assert from 'node:assert';
import { copyEnvironment, removeEnvironment, resolveRequest } from './environments.ts';
import type { EnvironmentsFile, TesApiRequest } from '../types/index.ts';

const request: TesApiRequest = {
  id: 'r', method: 'POST', url: '{{base_url}}/items',
  params: [{ id: 'p', key: 'tenant', value: '{{tenant}}', enabled: true }],
  pathVariables: [{ id: 'path', key: 'id', value: '{{user_id}}', enabled: true }],
  headers: [{ id: 'h', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
  body: { type: 'json', raw: '{"tenant":"{{tenant}}","missing":"{{missing}}"}' },
  auth: { type: 'bearer', token: '{{token}}' },
};
const result = resolveRequest(request, [
  { id: '1', key: 'base_url', value: 'https://example.com', enabled: true },
  { id: '2', key: 'tenant', value: 'acme', enabled: true },
  { id: '3', key: 'token', value: 'secret', enabled: true },
  { id: '4', key: 'user_id', value: 'user 42', enabled: true },
]);
assert.equal(result.request.url, 'https://example.com/items');
assert.equal(result.request.headers[0].value, 'Bearer secret');
assert.equal(result.request.auth.token, 'secret');
assert.equal(result.request.pathVariables?.[0].value, 'user 42');
assert.deepEqual(result.unresolved, ['missing']);
assert.equal(request.url, '{{base_url}}/items');

const environment = { id: 'env-a', name: 'Local', variables: [{ id: 'var-a', key: 'token', value: 'one', enabled: true }] };
const duplicate = copyEnvironment(environment);
assert.equal(duplicate.name, 'Local copy');
assert.notEqual(duplicate.id, environment.id);
assert.notEqual(duplicate.variables[0].id, environment.variables[0].id);
const file: EnvironmentsFile = { schemaVersion: 1, activeEnvironmentId: duplicate.id, environments: [environment, duplicate] };
const remaining = removeEnvironment(file, duplicate.id);
assert.equal(remaining.activeEnvironmentId, environment.id);
assert.deepEqual(remaining.environments, [environment]);

console.log('environments.test.ts: all assertions passed');
