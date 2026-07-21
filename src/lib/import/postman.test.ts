// Run: node src/lib/import/postman.test.ts (Node >=22)
import assert from 'node:assert';
import { parsePostmanCollection } from './postman.ts';

const imported = parsePostmanCollection({
  info: { name: 'Example API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'Users', item: [{
    name: 'Create user',
    request: { method: 'POST', url: { raw: '{{base_url}}/users/:id?active=true', query: [{ key: 'active', value: 'true' }], variable: [{ key: 'id', value: 'user 42', description: 'User ID' }] }, header: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', raw: '{"name":"Ridho"}', options: { raw: { language: 'json' } } } },
    response: [{ name: 'Success', code: 201, status: 'Created', header: [{ key: 'Content-Type', value: 'application/json' }], body: '{"id":1}' }],
  }] }],
});

assert.equal(imported.name, 'Example API');
assert.deepEqual({ requests: imported.requestCount, folders: imported.folderCount, responses: imported.responseCount }, { requests: 1, folders: 1, responses: 1 });
const folder = imported.root[0];
assert.equal(folder.type, 'folder');
if (folder.type === 'folder') {
  const request = folder.children[0];
  assert.equal(request.type, 'request');
  if (request.type === 'request') {
    assert.equal(request.request.body.type, 'json');
    assert.equal(request.request.params[0].key, 'active');
    assert.deepEqual(request.request.pathVariables?.map(({ key, value, description }) => ({ key, value, description })), [{ key: 'id', value: 'user 42', description: 'User ID' }]);
    assert.equal(request.savedResponses?.[0].response.status, 201);
  }
}

console.log('postman.test.ts: all assertions passed');
