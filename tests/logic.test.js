'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// parts.js attaches to a global `window`; shim it before loading.
global.window = global;
require(path.join(__dirname, '..', 'js', 'parts.js'));
const Parts = global.Parts;
const Storage = require(path.join(__dirname, '..', 'js', 'storage.js'));

// representative part ids from the catalog
const E = 'hairdryer';       // engine
const F = 'soda_bottle';     // fuel
const B = 'trash_can';       // body

test('computeStages: single stage groups everything together', () => {
  const stages = Parts.computeStages([E, F, B]);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].engineCount, 1);
  assert.equal(stages[0].fuelCount, 1);
});

test('computeStages: engine on fuel starts a new stage', () => {
  const stages = Parts.computeStages([E, F, E, F, B]);
  assert.equal(stages.length, 2);
  assert.deepEqual(stages[0].idxs, [0, 1]);
  assert.deepEqual(stages[1].idxs, [2, 3, 4]);
});

test('computeStages: clustered engines stay in one stage', () => {
  const stages = Parts.computeStages([E, E, F, F, B]);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].engineCount, 2);
});

test('computeStages: cluster plus a second stage', () => {
  const stages = Parts.computeStages([E, E, F, E, F, B]);
  assert.equal(stages.length, 2);
  assert.equal(stages[0].engineCount, 2);
  assert.equal(stages[1].engineCount, 1);
});

test('computeStages: skip map ignores dropped parts (flight staging)', () => {
  // drop the bottom stage [0,1]; only the upper stage should remain
  const stages = Parts.computeStages([E, F, E, F, B], { 0: true, 1: true });
  assert.equal(stages.length, 1);
  assert.deepEqual(stages[0].idxs, [2, 3, 4]);
});

test('deepMerge: backfills newly-added nested default keys', () => {
  const save = { scrap: 10, upgrades: { turbofuel: 2 } };
  const defaults = { scrap: 0, data: 0, upgrades: { turbofuel: 0, hull: 0 } };
  const merged = Storage.deepMerge(save, defaults);
  assert.equal(merged.scrap, 10);          // player value wins
  assert.equal(merged.data, 0);            // missing scalar backfilled
  assert.equal(merged.upgrades.turbofuel, 2); // nested player value wins
  assert.equal(merged.upgrades.hull, 0);   // nested missing key backfilled
});

test('deepMerge: keeps player arrays intact', () => {
  const save = { unlocked: ['hairdryer'] };
  const defaults = { unlocked: ['a', 'b', 'c'] };
  const merged = Storage.deepMerge(save, defaults);
  assert.deepEqual(merged.unlocked, ['hairdryer']);
});
