'use strict';
// Runs the REAL js/flight.js headless under Node so the flight model can be
// tested. flight.js is the largest file in the project and where nearly every
// bug in this game has been found, so it needs coverage more than anything else.
//
// The only alteration is to the module's export line, to expose internals the
// tests need. No game logic is modified — the file is otherwise executed as-is.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

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

function makeEl(id) {
  const el = {
    id, _text: '', innerHTML: '', disabled: false, style: {}, dataset: {},
    clientWidth: 800, clientHeight: 600, width: 800, height: 600,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return makeEl(id + ' sub'); },
    getContext() { return makeCtx(); },
    parentElement: { clientWidth: 900, clientHeight: 900 },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; }, set(v) { this._text = String(v); },
  });
  return el;
}

// Build a fresh, fully isolated flight environment.
function createFlight(opts) {
  opts = opts || {};
  const g = Object.create(global);
  g.window = g;
  g.self = g;

  const els = {};
  g.document = {
    querySelector: (s) => (els[s] = els[s] || makeEl(s)),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createElement: () => makeEl('created'),
  };
  g.matchMedia = () => ({ matches: false });
  g.devicePixelRatio = 1;
  g.addEventListener = () => {};
  g.removeEventListener = () => {};

  let NOW = 0;
  let pending = null;
  g.performance = { now: () => NOW };
  g.requestAnimationFrame = (cb) => { pending = cb; return 1; };
  g.cancelAnimationFrame = () => { pending = null; };

  g.Sfx = { startEngine() {}, stopEngine() {}, play() {}, setEngineIntensity() {} };
  g.Game = {
    currentScreen: 'flight',
    lastRocket: null,
    sandbox: false,
    state: { bestAltitude: 0, stats: {}, consumables: { boost: 9, repair: 9, shield: 9 } },
    getUpgrades: () => opts.upgrades || {},
    getConsumables() { return this.state.consumables; },
    spendConsumable(id) {
      if ((this.state.consumables[id] || 0) <= 0) return false;
      this.state.consumables[id]--; return true;
    },
    unlockAchievement() {},
    applyResult(r) { g._results = (g._results || []).concat([r]); },
  };

  const ctx = vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'parts.js'), 'utf8'), ctx, { filename: 'parts.js' });
  g.Builder = { getCurrentRocket: () => ({ parts: ['hairdryer', 'soda_bottle', 'trash_can'], finId: null }) };

  let src = fs.readFileSync(path.join(ROOT, 'js', 'flight.js'), 'utf8');
  // Append test-only internals to the module's export object. Anchored on the
  // last real entry rather than the whole literal so adding a public export does
  // not break the harness; if this anchor ever goes, it fails loudly here.
  const MARK = 'rollWeather: pickModifier,';
  if (!src.includes(MARK)) {
    throw new Error('flight.js export shape changed — update tests/flight-harness.js');
  }
  src = src.replace(MARK, MARK +
    ' _F: F, _jettison: jettisonStage, _useAbility: useAbility,' +
    ' _endFlight: endFlight, _canRecover: canRecover, _canStage: canStage,' +
    ' _makeHazard: makeHazard, _updateHazards: updateHazards,');
  vm.runInContext(src, ctx, { filename: 'flight.js' });

  const CALM = { id: 'calm', windMul: 1, debrisMul: 1, lightningMul: 1, tailwind: 0, scrapMul: 1 };

  return {
    g,
    Parts: g.Parts,
    Flight: g.Flight,
    get F() { return g.Flight._F; },
    get sim() { return g.Flight._F.sim; },
    launch(rocket, modifier) {
      g.Game.lastRocket = rocket;
      g.Game.currentScreen = 'flight';
      g.Flight.enter(g.Game);
      // `undefined` -> default to CALM for determinism; `null` -> keep whatever
      // enter() chose, so the pre-rolled forecast path can be tested
      if (modifier !== null) g.Flight._F.sim.modifier = modifier || CALM;
      return g.Flight._F.sim;
    },
    step(dt) {
      NOW += (dt || 1 / 60) * 1000;
      const cb = pending; pending = null;
      if (cb) cb(NOW);
      return pending !== null;
    },
    run(steps, each) {
      for (let i = 0; i < steps; i++) {
        if (each) each(i);
        if (!this.step()) return i;
        const s = g.Flight._F.sim;
        if (s.crashed || s.moonReached) return i;
      }
      return steps;
    },
    thrust(on) { g.Flight._F.keys.thrust = !!on; },
    exit() { g.Flight.exit(); },
  };
}

module.exports = { createFlight };
