// Run: node src/lib/requestNormalization.test.ts (Node >=22)
import assert from 'node:assert';
import { normalizeRequestShape } from './requestNormalization.ts';

const normalized = normalizeRequestShape({
  id: 'request', method: 'POST', url: 'https://example.com/items', params: [], headers: [],
  body: { type: 'none', raw: '{"name":"copy"}' }, auth: { type: 'none' },
});

assert.equal(normalized.params.length, 1);
assert.equal(normalized.params[0].enabled, false);
assert.equal(normalized.body.type, 'json');
assert.equal(normalized.body.raw, '{"name":"copy"}');

const populated = normalizeRequestShape({
  id: 'request', method: 'GET', url: 'https://example.com/items',
  params: [{ key: 'page', value: '1' } as never], headers: [],
  body: { type: 'none' }, auth: { type: 'none' },
});
assert.equal(populated.params[0].enabled, true);
assert.ok(populated.params[0].id);
assert.equal(populated.params.length, 2);

const formData = normalizeRequestShape({
  id: 'request', method: 'POST', url: 'https://example.com/items', params: [], headers: [],
  body: { type: 'none', formData: [{ key: 'name', value: 'copy' } as never] }, auth: { type: 'none' },
});
assert.equal(formData.body.type, 'form-data');
assert.equal(formData.body.formData?.[0].enabled, true);

console.log('requestNormalization.test.ts: all assertions passed');
