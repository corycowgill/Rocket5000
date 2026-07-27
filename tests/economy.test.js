'use strict';
// Integration tests for the reward pipeline in js/game.js — scrap/data income,
// staging bonuses, weather multipliers, unlocks, achievements, challenge
// payout, and the sandbox guards. game.js is DOM-bound, so we stub just enough
// document/localStorage for it to boot, then drive Game.applyResult directly.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

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

  const els = {};
  const makeEl = () => {
    const el = {
      _t: '', innerHTML: '', disabled: false, style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, appendChild() {}, querySelector: () => makeEl(),
    };
    Object.defineProperty(el, 'textContent', {
      get() { return this._t; }, set(v) { this._t = String(v); },
    });
    return el;
  };
  g.document = {
    querySelector: (s) => (els[s] = els[s] || makeEl()),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => makeEl(),
  };
  g.matchMedia = () => ({ matches: false });
  g.Sfx = { play() {}, startEngine() {}, stopEngine() {}, setEngineIntensity() {} };
  g.Flight = { enter() {}, exit() {} };

  const ctx = vm.createContext(g);
  for (const f of ['js/parts.js', 'js/storage.js', 'js/game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  // game.js wires state on DOMContentLoaded; do it manually
  g.Game.state = g.Storage.load();
  // builder is not loaded — stub the one API the challenge check needs
  g.Builder = {
    getStats: (r) => {
      let mass = 0, engineCount = 0;
      r.parts.forEach((id) => {
        const p = g.Parts.byId(id);
        if (!p) return;
        mass += p.mass;
        if (p.category === 'engine') engineCount++;
      });
      if (r.finId) { const f = g.Parts.byId(r.finId); if (f) mass += f.mass; }
      const st = g.Parts.computeStages(r.parts);
      return { mass, engineCount, stageCount: st.filter((s) => s.engineCount > 0).length };
    },
  };
  return g;
}

// Achievements also pay scrap, which would swamp the pure-income assertions.
// Pre-mark them all unlocked so those tests measure flight income only.
function muteAchievements(g) {
  g.Game.ACHIEVEMENTS.forEach((a) => { g.Game.state.achievements[a.id] = 1; });
}

const baseResult = (over) => Object.assign({
  altitude: 0, success: false, crashReason: null, time: 10,
  milestoneBonus: 0, comboBonus: 0, stageCount: 0, stageBonus: 0, cleanStages: 0,
  pickupScrap: 0, pickupData: 0, pickupCount: 0,
  modifierId: 'calm', modifierLabel: 'CALM', modifierScrapMul: 1.0,
}, over);

test('scrap and data scale with altitude', () => {
  const g = boot();
  muteAchievements(g);
  g.Game.applyResult(baseResult({ altitude: 10000 }));
  assert.equal(g.Game.state.scrap, 100);   // floor(10000/100)
  assert.equal(g.Game.state.data, 4);      // floor(10000/2500)
});

test('a low launch still earns 1 data (the old rate paid nothing)', () => {
  const g = boot();
  g.Game.applyResult(baseResult({ altitude: 1200 }));
  assert.equal(g.Game.state.data, 1, 'sub-2500ft flights must still yield data');
});

test('staging and clean-separation bonuses are both paid', () => {
  const g = boot();
  muteAchievements(g);
  g.Game.applyResult(baseResult({ altitude: 10000, stageCount: 2, stageBonus: 90 }));
  // 100 base + 2*25 staging + 90 clean separation
  assert.equal(g.Game.state.scrap, 100 + 50 + 90);
});

test('weather multiplier applies before staging bonuses, not after', () => {
  const g = boot();
  muteAchievements(g);
  g.Game.applyResult(baseResult({ altitude: 10000, modifierScrapMul: 1.25, stageCount: 1 }));
  // floor(100 * 1.25) = 125, then +25 staging
  assert.equal(g.Game.state.scrap, 150);
});

test('telemetry upgrade boosts data', () => {
  const g = boot();
  g.Game.state.upgrades.telemetry = 2;      // +30%
  g.Game.applyResult(baseResult({ altitude: 25000 }));
  assert.equal(g.Game.state.data, Math.floor(10 * 1.3));
});

test('altitude unlocks fire at their tier', () => {
  const g = boot();
  const before = g.Game.state.unlocked.length;
  g.Game.applyResult(baseResult({ altitude: 5000 }));
  assert.ok(g.Game.state.unlocked.length > before);
  assert.ok(g.Game.state.unlocked.includes('propane_tank'), 'the 5,000 ft tier should unlock');
});

test('achievements pay out and only once', () => {
  const g = boot();
  g.Game.applyResult(baseResult({ altitude: 5000 }));
  const afterFirst = g.Game.state.scrap;
  assert.ok(g.Game.state.achievements.alt_5k, 'alt_5k should unlock');
  const scrapBefore = g.Game.state.scrap;
  g.Game.applyResult(baseResult({ altitude: 5000 }));
  // second identical run must not re-pay the same achievement
  const gained = g.Game.state.scrap - scrapBefore;
  assert.ok(gained < afterFirst, 'achievement reward must not be paid twice');
});

test('sandbox earns nothing and records nothing', () => {
  const g = boot();
  g.Game.sandbox = true;
  g.Game.applyResult(baseResult({ altitude: 500000, stageCount: 3 }));
  assert.equal(g.Game.state.scrap, 0);
  assert.equal(g.Game.state.data, 0);
  assert.equal(g.Game.state.bestAltitude, 0);
  assert.deepEqual(g.Game.state.achievements, {}, 'sandbox must not bank achievements');
});

test('challenge pays only when goal AND build restriction are both met', () => {
  const g = boot();
  const ch = { id: 'one-engine', title: 'ONE ENGINE', reward: 100, dataReward: 5,
               restrict: 'oneEngine', goal: { type: 'altitude', ft: 8000 } };

  // two engines violates the restriction -> no challenge reward
  g.Game.activeChallenge = ch;
  g.Game.lastRocket = { parts: ['hairdryer', 'soda_bottle', 'hairdryer', 'soda_bottle', 'trash_can'], finId: null };
  g.Game.applyResult(baseResult({ altitude: 10000 }));
  const withoutReward = g.Game.state.scrap;

  // same flight, one engine -> reward granted
  const g2 = boot();
  g2.Game.activeChallenge = ch;
  g2.Game.lastRocket = { parts: ['hairdryer', 'soda_bottle', 'trash_can'], finId: null };
  g2.Game.applyResult(baseResult({ altitude: 10000 }));
  assert.equal(g2.Game.state.scrap - withoutReward, 100, 'legal build should earn the challenge reward');
});

test('challenge goal types other than altitude are honoured', () => {
  const g = boot();
  const clean = { id: 'clean-pilot', title: 'CLEAN PILOT', reward: 220, dataReward: 12,
                  restrict: null, goal: { type: 'clean', n: 2 } };
  g.Game.activeChallenge = clean;
  g.Game.lastRocket = { parts: ['hairdryer', 'soda_bottle', 'trash_can'], finId: null };
  // altitude alone must NOT satisfy a clean-separation goal
  g.Game.applyResult(baseResult({ altitude: 900000, cleanStages: 1 }));
  const noReward = g.Game.state.scrap;

  const g2 = boot();
  g2.Game.activeChallenge = clean;
  g2.Game.lastRocket = { parts: ['hairdryer', 'soda_bottle', 'trash_can'], finId: null };
  g2.Game.applyResult(baseResult({ altitude: 900000, cleanStages: 2 }));
  assert.equal(g2.Game.state.scrap - noReward, 220, 'meeting the clean goal should pay');
});

test('moonshot marks success and records the stat', () => {
  const g = boot();
  g.Game.applyResult(baseResult({ altitude: 1000000, success: true }));
  assert.equal(g.Game.state.stats.totalMoonshots, 1);
  assert.ok(g.Game.state.achievements.moonshot);
  assert.ok(g.Game.state.scrap > 10000, 'moonshot should pay the 500 bonus on top of altitude');
});
