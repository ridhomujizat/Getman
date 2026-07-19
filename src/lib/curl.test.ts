// Run: node src/lib/curl.test.ts (Node >=22 strips TS types natively)
import assert from 'node:assert';
import { parseCurl, toCurl } from './curl.ts';

const request = parseCurl(`curl -X POST 'https://example.com/items?limit=2' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Token: abc' \\
  --data-raw '{"name":"GetMan"}'`);

assert(request);
assert.equal(request.method, 'POST');
assert.equal(request.url, 'https://example.com/items?limit=2');
assert.equal(request.params[0].key, 'limit');
assert.equal(request.headers[1].key, 'X-Token');
assert.equal(request.body.type, 'json');
assert.equal(request.body.raw, '{"name":"GetMan"}');
assert.match(toCurl(request), /--data-raw/);

const basic = parseCurl("curl -u 'ada:secret' https://example.com/me");
assert.deepEqual(basic?.auth, { type: 'basic', username: 'ada', password: 'secret' });

const upload = parseCurl("curl -F 'attachments=@receipt.pdf' -F 'attachments=@invoice.pdf' https://example.com/upload");
assert.equal(upload?.body.formData?.[0].valueType, 'file');
assert.equal(upload?.body.formData?.[0].files?.[0].name, 'receipt.pdf');
assert.equal(upload?.body.formData?.[0].files?.[1].name, 'invoice.pdf');
assert.match(toCurl(upload!), /attachments=@receipt\.pdf/);

console.log('curl.test.ts: all assertions passed');
