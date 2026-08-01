'use strict';
// Integration smoke test: does the game actually boot and navigate?
//
// Every other test exercises a module in isolation with a permissive DOM stub
// that invents an element for any selector asked of it. That cannot catch the
// most ordinary failure mode in a project like this — JS referring to an id
// that no longer exists in index.html, or a screen that throws on entry. A lot
// of markup was added recently (the moon objective, the flight-analysis line,
// the warp button, the mission bar), all of it unverified against the page.
//
// So this stub is built FROM index.html: querySelector only resolves ids and
// classes that genuinely appear there, and anything else comes back null.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const IDS = new Set([...HTML.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const CLASSES = new Set(
  [...HTML.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
);

// Which selectors the game asked for but the page does not contain.
const missing = new Set();

function selectorExists(sel) {
  // resolve on the last simple token, e.g. '.parts-tabs .tab' -> '.tab'
  const last = sel.trim().split(/\s+/).pop();
  if (last.startsWith('#')) return IDS.has(last.slice(1));
  if (last.startsWith('.')) return CLASSES.has(last.slice(1).split('.')[0]);
  return true;                              // tag selectors: not our concern
}

function makeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeEl(sel) {
  const el = {
    _t: '', innerHTML: '', disabled: false, style: {}, dataset: { slot: '0', cat: 'engine', go: 'title' },
    width: 640, height: 720, clientWidth: 640, clientHeight: 720,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    querySelector: () => makeEl(sel + ' sub'),
    getContext: () => makeCtx(),
    parentElement: { clientWidth: 900, clientHeight: 900 },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 720 }),
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._t; }, set(v) { this._t = String(v); },
  });
  return el;
}

function boot() {
  const g = Object.create(global);
  g.window = g;
  g.self = g;

  const store = {};
  g.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const cache = {};
  let domReady = null;
  g.document = {
    querySelector(sel) {
      if (!selectorExists(sel)) { missing.add(sel); return null; }
      return (cache[sel] = cache[sel] || makeEl(sel));
    },
    querySelectorAll(sel) {
      if (!selectorExists(sel)) { missing.add(sel); return []; }
      return [makeEl(sel)];
    },
    addEventListener(ev, cb) { if (ev === 'DOMContentLoaded') domReady = cb; },
    removeEventListener() {},
    createElement: () => makeEl('created'),
  };
  g.matchMedia = () => ({ matches: false });
  g.devicePixelRatio = 1;
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.performance = { now: () => 0 };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};
  g.AudioContext = function () {
    return {
      currentTime: 0, destination: {},
      createGain: () => ({ connect() {}, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
      createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, type: '' }),
      createBufferSource: () => ({ connect() {}, start() {}, stop() {}, buffer: null, loop: false }),
      createBuffer: () => ({ getChannelData: () => new Float32Array(16) }),
      createBiquadFilter: () => ({ connect() {}, frequency: { value: 0, setValueAtTime() {} }, type: '' }),
      resume() {}, state: 'running',
    };
  };

  // script order must match index.html
  const scripts = [...HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const ctx = vm.createContext(g);
  for (const src of scripts) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, src), 'utf8'), ctx, { filename: src });
  }
  return { g, domReady, scripts };
}

test('index.html and the scripts agree on what exists', () => {
  const { g, domReady, scripts } = boot();
  assert.ok(scripts.length > 0, 'index.html should reference scripts');
  assert.ok(domReady, 'game.js should register a DOMContentLoaded handler');
  domReady();                                   // boot the game
  assert.ok(g.Game && g.Game.state, 'Game state should initialise');

  // walk every screen the menu can reach
  for (const screen of ['hangar', 'workshop', 'records', 'challenges', 'help', 'sandbox', 'title']) {
    assert.doesNotThrow(() => g.Game.go(screen), 'navigating to "' + screen + '" threw');
  }

  assert.deepEqual([...missing], [],
    'the code queried selectors that do not exist in index.html: ' + [...missing].join(', '));
});

test('a full result can be applied without touching a missing element', () => {
  const { g, domReady } = boot();
  domReady();
  const before = missing.size;
  assert.doesNotThrow(() => {
    g.Game.applyResult({
      altitude: 1200000, success: true, crashReason: null, time: 300,
      milestoneBonus: 5000, comboBonus: 200, stageCount: 3, stageBonus: 90, cleanStages: 2,
      pickupScrap: 150, pickupData: 9, pickupCount: 5,
      modifierId: 'storm', modifierLabel: 'THUNDERSTORM', modifierScrapMul: 1.25,
      fuelLeftPct: 0, hullLeftPct: 0.4, stagesLeft: 1, tumbleDeath: false,
    });
  }, 'applyResult threw on a full moonshot result');
  assert.equal(missing.size, before, 'the result screen queried a selector index.html does not have');
});
