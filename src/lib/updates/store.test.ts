import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoCheck } from './schedule.ts';

test('automatic update checks are limited to once per day', () => {
  const now = Date.UTC(2026, 6, 21, 12);
  assert.equal(shouldAutoCheck(null, now), true);
  assert.equal(shouldAutoCheck(now - 23 * 60 * 60 * 1000, now), false);
  assert.equal(shouldAutoCheck(now - 24 * 60 * 60 * 1000, now), true);
});
