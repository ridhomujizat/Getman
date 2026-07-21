// Run: node src/lib/curl/__tests__/parse.test.ts (Node >=22)
import assert from 'node:assert';
import { isCurlCommand, parseCurl } from '../index.ts';
import { chromeBash, chromeCmd, chromePowerShell, chromeUrl, secChUa } from './fixtures.ts';

function parsed(command: string) {
  const result = parseCurl(command);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.request : assert.fail(result.error);
}

function shape(command: string) {
  const request = parsed(command);
  return {
    method: request.method,
    url: request.url,
    params: request.params.filter((row) => row.key).map(({ key, value, enabled }) => ({ key, value, enabled })),
    headers: request.headers.filter((row) => row.key).map(({ key, value, enabled }) => ({ key, value, enabled })),
    body: {
      type: request.body.type,
      raw: request.body.raw,
      formData: request.body.formData?.filter((row) => row.key).map(({ key, value, enabled, valueType, files }) => ({
        key, value, enabled, valueType, files: files?.map((file) => file.name),
      })),
    },
    auth: request.auth,
  };
}

const cmd = shape(chromeCmd);
assert.equal(cmd.method, 'GET');
assert.equal(cmd.url, chromeUrl);
assert.deepEqual(cmd.params.map((param) => [param.key, param.value]), [
  ['start_date', '2026-07-01'],
  ['end_date', '2026-07-18'],
  ['type_date', 'created_at'],
  ['product_id', ''],
  ['campaign_id', ''],
]);
assert.equal(cmd.headers.length, 13);
assert.equal(cmd.headers.find((header) => header.key === 'sec-ch-ua')?.value, secChUa);
assert.equal(cmd.headers.find((header) => header.key === 'Cookie')?.value, 'Path=/; access_token=eyJ.test.token');
assert.deepEqual(shape(chromeBash), cmd);
assert.deepEqual(shape(chromePowerShell), cmd);

const json = parsed(`curl --json '{"name":"TesAPI"}' https://example.com/items`);
assert.equal(json.method, 'POST');
assert.equal(json.body.type, 'json');
assert.equal(json.headers.filter((header) => header.key).length, 2);

const form = parsed(`curl -F 'attachments=@/tmp/receipt.pdf' -F 'attachments=@invoice.pdf' -F 'note=a=b' https://example.com/upload`);
assert.equal(form.body.type, 'form-data');
assert.deepEqual(form.body.formData?.[0].files?.map((file) => file.name), ['receipt.pdf', 'invoice.pdf']);
assert.equal(form.body.formData?.[1].value, 'a=b');

assert.deepEqual(parsed(`curl -u 'ada:secret:part' https://example.com`).auth, { type: 'basic', username: 'ada', password: 'secret:part' });
assert.deepEqual(parsed(`curl -H 'Authorization: Bearer token' https://example.com`).auth, { type: 'bearer', token: 'token' });
assert.deepEqual(parsed(`curl -H 'Authorization: Basic YWRhOnNlY3JldA==' https://example.com`).auth, { type: 'basic', username: 'ada', password: 'secret' });
assert.deepEqual(shape(`curl -H 'Referer;' https://example.com`).headers, [{ key: 'Referer', value: '', enabled: true }]);

const getData = parsed(`curl 'https://example.com/search?existing=1' -G -d 'q=get man' --data-urlencode 'tag=a&b'`);
assert.equal(getData.method, 'GET');
assert.equal(getData.body.type, 'none');
assert.deepEqual(getData.params.filter((param) => param.key).map(({ key, value }) => [key, value]), [
  ['existing', '1'], ['q', 'get man'], ['tag', 'a&b'],
]);

const multiple = parsed(`curl https://example.com -d 'a=1' --data 'b=2'`);
assert.equal(multiple.body.type, 'x-www-form-urlencoded');
assert.deepEqual(multiple.body.formData?.filter((item) => item.key).map(({ key, value }) => [key, value]), [['a', '1'], ['b', '2']]);

const warned = parseCurl(`curl --retry 2 --mystery https://example.com`);
assert.equal(warned.ok, true);
if (warned.ok) assert.deepEqual(warned.warnings, ['Ignored unsupported flag: --retry', 'Ignored unsupported flag: --mystery']);
assert.equal(isCurlCommand('\uFEFF  curl.exe https://example.com'), true);

for (const malformed of ['', 'garbage', 'curl', 'curl -H', `curl 'https://example.com`]) {
  assert.equal(parseCurl(malformed).ok, false, malformed);
}

console.log('parse.test.ts: all assertions passed');
