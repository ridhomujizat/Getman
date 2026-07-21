// Run: node src/store/requestStore.test.ts (Node >=22)
import assert from 'node:assert';
import { isTabDirty } from '../lib/collections.ts';
import { newRequest, useRequestStore } from './requestStore.ts';

const saved = { ...newRequest(), id: 'saved', name: 'List items', url: 'https://example.com/items' };
useRequestStore.getState().openRequest(saved, { collectionId: 'collection', nodeId: 'node' });
let active = useRequestStore.getState().tabs.find((tab) => tab.id === useRequestStore.getState().activeTabId)!;
assert.equal(isTabDirty(active), false);

useRequestStore.getState().renameSavedTab({ collectionId: 'collection', nodeId: 'node' }, 'Renamed items');
active = useRequestStore.getState().tabs.find((tab) => tab.id === useRequestStore.getState().activeTabId)!;
assert.equal(active.draft.name, 'Renamed items');
assert.equal(isTabDirty(active), false);

useRequestStore.getState().setUrl('https://example.com/items?limit=2');
active = useRequestStore.getState().tabs.find((tab) => tab.id === useRequestStore.getState().activeTabId)!;
assert.equal(isTabDirty(active), true);

useRequestStore.getState().setUrl('https://example.com/items/:id');
assert.equal(useRequestStore.getState().request.pathVariables?.[0].key, 'id');
useRequestStore.getState().setPathVariables([{ ...useRequestStore.getState().request.pathVariables![0], value: 'item 42' }]);
assert.equal(useRequestStore.getState().request.pathVariables?.[0].value, 'item 42');

useRequestStore.getState().setUrl('https://example.com/items');
active = useRequestStore.getState().tabs.find((tab) => tab.id === useRequestStore.getState().activeTabId)!;
assert.equal(isTabDirty(active), false);

useRequestStore.getState().createRequest();
active = useRequestStore.getState().tabs.find((tab) => tab.id === useRequestStore.getState().activeTabId)!;
assert.equal(isTabDirty(active), true);

useRequestStore.getState().closeSavedTabs('collection', ['node']);
assert.equal(useRequestStore.getState().tabs.some((tab) => tab.origin?.nodeId === 'node'), false);
assert.equal(useRequestStore.getState().tabs.length, 1);

for (const tab of useRequestStore.getState().tabs) useRequestStore.getState().closeTab(tab.id);
assert.equal(useRequestStore.getState().tabs.length, 0);
assert.equal(useRequestStore.getState().activeTabId, '');

useRequestStore.getState().createRequest();
assert.equal(useRequestStore.getState().tabs.length, 1);

console.log('requestStore.test.ts: all assertions passed');
