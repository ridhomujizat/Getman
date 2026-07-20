// Run: node src/hooks/useResizableLayout.test.ts (Node >=22)
import assert from 'node:assert';
import { clampPaneSize } from './useResizableLayout.ts';

assert.equal(clampPaneSize(300, 200, 400), 300);
assert.equal(clampPaneSize(100, 200, 400), 200);
assert.equal(clampPaneSize(500, 200, 400), 400);
assert.equal(clampPaneSize(300, 200, 150), 200);

console.log('useResizableLayout.test.ts: all assertions passed');
