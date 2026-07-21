// Run: node src/lib/pathVariables.test.ts (Node >=22)
import assert from 'node:assert';
import { extractPathVariableNames, substitutePathVariables, syncPathVariables } from './pathVariables.ts';

assert.deepEqual(extractPathVariableNames('https://localhost:1420/users/:id/orders/:order_id?next=/:ignored'), ['id', 'order_id']);

const rows = syncPathVariables('https://example.com/users/:id/:id', [
  { id: 'id', key: 'id', value: 'Ada Lovelace/42', enabled: true, description: 'User ID' },
]);
assert.equal(rows.length, 1);
assert.equal(rows[0].description, 'User ID');
assert.equal(substitutePathVariables('https://example.com/users/:id?literal=/:id', rows), 'https://example.com/users/Ada%20Lovelace%2F42?literal=/:id');

console.log('pathVariables.test.ts: all assertions passed');
