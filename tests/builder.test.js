'use strict';
// Regression tests for js/builder.js: the apogee integration, the QUICK BUILD
// auto-assembler, the TWR launch gate and the adaptive stack scaling.
//
// The estimator was rewritten for speed once already, and the rewrite silently
// produced a 4x-wrong number (a spent tank settling at ~1e-14 kept the burn
// alive forever). That was caught only by ad-hoc differential comparison against
// the previous implementation; these tests pin
// the known-good outputs so it cannot happen again unnoticed.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const E = 'hairdryer', F = 'soda_bottle', B = 'trash_can';

function boot(canvasH) {
  const g = Object.create(global);
  g.window = g;
  const makeEl = () => ({
    _t: '', innerHTML: '', disabled: false, style: {}, dataset: {},
    width: 640, height: canvasH || 720, clientWidth: 640, clientHeight: canvasH || 720,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, querySelector: () => makeEl(),
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
    parentElement: { clientWidth: 900, clientHeight: 900 },
  });
  g.document = {
    querySelector: () => makeEl(), querySelectorAll: () => [],
    addEventListener() {}, createElement: () => makeEl(),
  };
  g.Sfx = { play() {} };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.devicePixelRatio = 1;
  const store = {};
  g.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const ctx = vm.createContext(g);
  for (const f of ['js/parts.js', 'js/storage.js', 'js/builder.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  // real default state shape (buildSlots, upgrades, ...) so enter() works
  const state = g.Storage.load();
  state.unlocked = g.Parts.all.map(p => p.id);
  g.Game = {
    getUpgrades: () => ({}), sandbox: false, state,
    showToast() {}, getConsumables: () => ({ boost: 0, repair: 0, shield: 0 }),
  };
  return g;
}

const R = (parts, finId) => ({ name: 'T', parts, finId: finId || null });

// ---- apogee estimator ------------------------------------------------------
// Values measured from the original (pre-optimisation) implementation.
const KNOWN = [
  ['single 1 tank', [E, F, B], 19282],
  ['single 2 tanks', [E, F, F, B], 25919],
  ['2-stage', [E, F, E, F, B], 31369],
  ['3-stage', [E, F, E, F, E, F, B], 39875],
];

KNOWN.forEach(([label, parts, expected]) => {
  test('estimateApogeeFt matches the reference value: ' + label, () => {
    const g = boot();
    const got = g.Builder.estimateApogeeFt(R(parts));
    // allow a few feet of drift from incremental vs recomputed summation
    assert.ok(Math.abs(got - expected) <= 5,
      `expected ~${expected} ft, got ${Math.round(got)} ft`);
  });
});

test('estimateApogeeFt: staging beats the same parts in one stage', () => {
  const g = boot();
  const single = g.Builder.estimateApogeeFt(R([E, F, F, B]));
  const staged = g.Builder.estimateApogeeFt(R([E, F, E, F, B]));
  assert.ok(staged > single, 'a staged build should out-climb a single stack');
});

test('estimateApogeeFt terminates — fuel must fully exhaust', () => {
  // The optimisation bug left a spent tank at ~1e-14, so thrust never stopped
  // and the rocket climbed forever. A finite, sane apogee proves burnout works.
  const g = boot();
  const ft = g.Builder.estimateApogeeFt(R([E, F, F, F, E, F, F, F, E, F, F, F, E, F, F, F, B]));
  assert.ok(Number.isFinite(ft), 'apogee must be finite');
  assert.ok(ft > 0 && ft < 200000, `runaway burn suspected: ${Math.round(ft)} ft`);
});

test('estimateApogeeFt: no engine or no fuel cannot fly', () => {
  const g = boot();
  assert.equal(g.Builder.estimateApogeeFt(R([F, F, B])), 0, 'no engine -> no altitude');
  assert.equal(g.Builder.estimateApogeeFt(R([E, B])), 0, 'no fuel -> no altitude');
});

// ---- launch gate -----------------------------------------------------------
test('validate rejects TWR below 1.0 (it would never leave the pad)', () => {
  const g = boot();
  // one weak engine under a heavy stack of bodies
  const heavy = R([E, F, 'fridge', 'fridge', 'fridge', 'fridge']);
  const s = g.Builder.getStats(heavy);
  assert.ok(s.twr < 1.0, 'fixture should be too heavy to lift');
  assert.equal(g.Builder.validate(heavy).ok, false);
});

test('validate accepts a basic starter rocket', () => {
  const g = boot();
  assert.equal(g.Builder.validate(R([E, F, B])).ok, true);
});

// ---- QUICK BUILD -----------------------------------------------------------
test('quickBuild returns a launchable, multi-stage rocket', () => {
  const g = boot();
  const r = g.Builder.quickBuild(g.Game);
  assert.ok(r, 'should produce a build');
  assert.equal(g.Builder.validate(r).ok, true, 'quick build must be launchable');
  assert.ok(g.Builder.getStats(r).stageCount >= 2, 'should demonstrate staging');
});

test('quickBuild only uses unlocked parts', () => {
  const g = boot();
  const starter = ['hairdryer', 'duct_tape', 'hairspray_cluster', 'soda_bottle',
                   'lawn_chair', 'trash_can', 'wheelbarrow', 'pizza_box_fin', 'cardboard_fin'];
  g.Game.state.unlocked = starter;
  const r = g.Builder.quickBuild(g.Game);
  assert.ok(r, 'starter parts should still yield a build');
  r.parts.forEach(id => assert.ok(starter.includes(id), 'used a locked part: ' + id));
  if (r.finId) assert.ok(starter.includes(r.finId));
  assert.equal(g.Builder.validate(r).ok, true);
});

test('quickBuild returns null when no engine is available', () => {
  const g = boot();
  g.Game.state.unlocked = ['soda_bottle', 'trash_can'];
  assert.equal(g.Builder.quickBuild(g.Game), null);
});

// ---- adaptive stack scaling ------------------------------------------------
test('tall builds scale down to stay on the canvas (and stay clickable)', () => {
  const g = boot(720);
  g.Builder.enter(g.Game);
  const tall = [];
  for (let i = 0; i < 10; i++) { tall.push('salvaged_motor', 'industrial_drum'); }
  tall.push('fridge');
  g.Game.state.buildSlots[0].rocket = R(tall);
  g.Builder.enter(g.Game);
  const layout = g.Builder.getStackLayout();
  assert.ok(layout.scale < 2, 'an oversized stack must shrink below full scale');
  assert.ok(layout.topY >= 0, 'the stack must not run off the top of the canvas');
});

test('normal builds keep full scale', () => {
  const g = boot(720);
  g.Game.state.buildSlots[0].rocket = R([E, F, E, F, B]);
  g.Builder.enter(g.Game);
  assert.equal(g.Builder.getStackLayout().scale, 2);
});
