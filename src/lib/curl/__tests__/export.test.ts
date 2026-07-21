// Run: node src/lib/curl/__tests__/export.test.ts (Node >=22)
import assert from 'node:assert';
import type { TesApiRequest, KeyValue } from '../../../types/index.ts';
import { parseCurl, toCurl } from '../index.ts';

const row = (key: string, value: string, extra: Partial<KeyValue> = {}): KeyValue => ({ id: key || 'blank', key, value, enabled: !!key, ...extra });
const blank = row('', '');

function request(patch: Partial<TesApiRequest>): TesApiRequest {
  return {
    id: 'request',
    method: 'GET',
    url: 'https://example.com',
    params: [blank],
    headers: [blank],
    body: { type: 'none', raw: '', formData: [blank] },
    auth: { type: 'none' },
    ...patch,
  };
}

function canonical(value: TesApiRequest) {
  const rows = (items: KeyValue[] | undefined) => items?.filter((item) => item.key).map((item) => ({
    key: item.key,
    value: item.value,
    enabled: item.enabled,
    valueType: item.valueType,
    files: item.files?.map((file) => ({ name: file.name })),
  })) ?? [];
  return {
    method: value.method,
    url: value.url,
    params: rows(value.params),
    headers: rows(value.headers),
    body: { type: value.body.type, raw: value.body.raw ?? '', formData: rows(value.body.formData) },
    auth: value.auth,
  };
}

function roundTrip(value: TesApiRequest) {
  const result = parseCurl(toCurl(value));
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (result.ok) assert.deepEqual(canonical(result.request), canonical(value));
}

roundTrip(request({ url: 'https://example.com/search?q=get%20man&empty=', params: [row('q', 'get man'), row('empty', ''), blank] }));
roundTrip(request({
  method: 'POST',
  url: 'https://example.com/items',
  headers: [row('Content-Type', 'application/json'), row('X-Quote', "Ada's value"), blank],
  body: { type: 'json', raw: '{"name":"Ada"}', formData: [blank] },
}));
roundTrip(request({
  method: 'POST',
  body: {
    type: 'form-data', raw: '', formData: [
      row('note', 'hello'),
      row('attachments', '', { valueType: 'file', files: [
        { name: 'receipt.pdf', mimeType: '', sizeBytes: 0, data: [] },
        { name: 'invoice.pdf', mimeType: '', sizeBytes: 0, data: [] },
      ] }),
      blank,
    ],
  },
}));
roundTrip(request({ method: 'POST', auth: { type: 'basic', username: 'ada', password: 'secret:part' } }));
roundTrip(request({ auth: { type: 'bearer', token: 'abc.123' } }));
roundTrip(request({
  method: 'POST',
  body: { type: 'x-www-form-urlencoded', raw: '', formData: [row('q', 'a&b'), row('empty', ''), blank] },
}));

assert.match(toCurl(request({ method: 'POST', body: { type: 'text', raw: "it's fine" } })), /'it'\\''s fine'/);
assert.doesNotMatch(toCurl(request({})), /-X GET/);
assert.match(toCurl(request({
  url: 'https://example.com/users/:id',
  pathVariables: [row('id', 'Ada Lovelace/42')],
})), /https:\/\/example\.com\/users\/Ada%20Lovelace%2F42/);

console.log('export.test.ts: all assertions passed');
