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

// ---- post-flight analysis ---------------------------------------------------
// The result screen's one actionable takeaway. Ordering matters: destruction
// must outrank fuel advice, or a torn-apart rocket gets told it had a clean burn.
function analysisFor(g, over) {
  const src = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
  const fn = src.slice(src.indexOf('function flightAnalysis'), src.indexOf('\n  function pickStampText'));
  const flightAnalysis = eval('(' + fn + ')');
  return flightAnalysis(Object.assign({
    success: false, crashReason: null, fuelLeftPct: 0, hullLeftPct: 1,
    stagesLeft: 0, stageCount: 0, tumbleDeath: false,
  }, over));
}

test('analysis: a moonshot needs no advice', () => {
  assert.equal(analysisFor(null, { success: true }), null);
});

test('analysis: tumbling is called out first', () => {
  const a = analysisFor(null, { tumbleDeath: true, hullLeftPct: 0, fuelLeftPct: 0.5 });
  assert.match(a, /Tumbling/);
});

test('analysis: destroyed with fuel left reports the wasted fuel', () => {
  const a = analysisFor(null, { hullLeftPct: 0, fuelLeftPct: 0.62 });
  assert.match(a, /62% of your fuel unburned/);
});

test('analysis: destroyed with no fuel must NOT claim a clean burn', () => {
  const a = analysisFor(null, { hullLeftPct: 0, fuelLeftPct: 0, stageCount: 3 });
  assert.match(a, /destroyed/i);
  assert.ok(!/clean burn/i.test(a), 'destruction must outrank fuel advice');
});

test('analysis: undropped spent stages are flagged', () => {
  const a = analysisFor(null, { fuelLeftPct: 0, stagesLeft: 2 });
  assert.match(a, /2 spent stages/);
});

test('analysis: a single-stage burnout is pointed at staging', () => {
  const a = analysisFor(null, { fuelLeftPct: 0, stageCount: 0 });
  assert.match(a, /engine/);
});

test('analysis: a rocket that never lifted is pointed at TWR', () => {
  const a = analysisFor(null, { crashReason: 'NEVER LEFT THE PAD' });
  assert.match(a, /TWR/);
});

// ---- daily challenge claim state -------------------------------------------
// A challenge pays once per day, but the roster showed no sign of which were
// already claimed — so a player could spend a long flight on one that could not
// pay. These pin the claim bookkeeping the roster reads.

test('a challenge pays once per day, not twice', () => {
  const g = boot();
  muteAchievements(g);
  const ch = { id: 'apex', title: 'APEX', reward: 200, dataReward: 10,
               restrict: null, goal: { type: 'altitude', ft: 5000 } };
  const rocket = { parts: ['hairdryer', 'soda_bottle', 'trash_can'], finId: null };

  g.Game.activeChallenge = ch;
  g.Game.lastRocket = rocket;
  const before = g.Game.state.scrap;
  g.Game.applyResult(baseResult({ altitude: 10000 }));
  const firstGain = g.Game.state.scrap - before;

  g.Game.activeChallenge = ch;
  g.Game.lastRocket = rocket;
  const mid = g.Game.state.scrap;
  g.Game.applyResult(baseResult({ altitude: 10000 }));
  const secondGain = g.Game.state.scrap - mid;

  assert.equal(firstGain - secondGain, ch.reward,
    'the second claim of the day must not pay the challenge reward again');
});

test('completing a challenge records a key the roster can match', () => {
  const g = boot();
  const ch = { id: 'apex', title: 'APEX', reward: 200, dataReward: 10,
               restrict: null, goal: { type: 'altitude', ft: 5000 } };
  g.Game.activeChallenge = ch;
  g.Game.lastRocket = { parts: ['hairdryer', 'soda_bottle', 'trash_can'], finId: null };
  g.Game.applyResult(baseResult({ altitude: 10000 }));

  const expected = 'apex:' + new Date().toDateString();
  assert.ok(g.Game.state.completedChallenges.includes(expected),
    'payout and roster must agree on the claim key, got ' +
    JSON.stringify(g.Game.state.completedChallenges));
});

test('the roster prunes claim keys from previous days', () => {
  const g = boot();
  g.Game.state.completedChallenges = [
    'apex:Mon Jan 01 2024',            // stale, can never match again
    'no-fins:' + new Date().toDateString(),
  ];
  g.Game.go('challenges');
  assert.ok(!g.Game.state.completedChallenges.some(k => k.includes('2024')),
    'stale keys should be dropped so the save does not grow forever');
  assert.ok(g.Game.state.completedChallenges.some(k => k.startsWith('no-fins:')),
    "today's keys must be kept");
});
