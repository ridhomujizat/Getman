// Run: node src/lib/params.test.ts  (Node >=22 strips TS types natively)
import assert from 'node:assert';
import { buildUrl, parseParams, withTrailingBlank } from './params.ts';

// buildUrl: only enabled, non-empty keys; encodes; replaces existing query.
assert.equal(
  buildUrl('http://x/api?stale=1', [
    { id: '1', key: 'a', value: '1', enabled: true },
    { id: '2', key: 'b', value: 'x y', enabled: true },
    { id: '3', key: 'off', value: 'z', enabled: false },
    { id: '4', key: '', value: 'v', enabled: true },
  ]),
  'http://x/api?a=1&b=x%20y',
);

// buildUrl: no active params strips the query entirely.
assert.equal(buildUrl('http://x/api?old=1', [emptyRow()]), 'http://x/api');

// parseParams: round-trips the encoded value and appends a trailing blank.
const rows = parseParams('http://x/api?a=1&b=x%20y');
assert.equal(rows.length, 3);
assert.deepEqual(
  rows.slice(0, 2).map((r) => [r.key, r.value]),
  [['a', '1'], ['b', 'x y']],
);
assert.equal(rows[2].key, '');

// withTrailingBlank: no double-append when last row already blank.
const blanked = withTrailingBlank([{ id: '1', key: 'a', value: '1', enabled: true }, emptyRow()]);
assert.equal(blanked.length, 2);

// File-only rows are not blank even though their string value is empty.
const withFile = withTrailingBlank([{
  id: 'file', key: '', value: '', enabled: true, valueType: 'file' as const,
  files: [{ name: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 3, data: [1, 2, 3] }],
}]);
assert.equal(withFile.length, 2);

function emptyRow() {
  return { id: 'x', key: '', value: '', enabled: true };
}

console.log('params.test.ts: all assertions passed');
