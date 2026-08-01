'use strict';
// Guards the game's win condition.
//
// Fixing hazards so they could actually connect silently made the moon
// unreachable: above 100,000 ft the spawn rate was 0.6/s with a 70% debris
// share at 30 damage a strike, in exactly the band a moonshot must cross for
// minutes. Real flights with good piloting capped at 113k-224k ft — five times
// short of the goal — and nothing caught it, because every existing test asked
// "do hazards behave correctly?" and none asked "can you still win?".
//
// Flying an actual moonshot takes ~27,000 steps (23s wall-clock), too slow to
// run routinely, so these pin the density parameters whose inflation caused the
// wall, plus the rule that lets a run continue past the moon at all.
const { test } = require('node:test');
const assert = require('node:assert');
const { createFlight } = require('./flight-harness.js');

const CALM = { id: 'calm', windMul: 1, debrisMul: 1, lightningMul: 1, tailwind: 0, scrapMul: 1 };
const M_TO_FT = 3.281;

// Hazards spawned per simulated minute while holding a given altitude band.
// Counting spawns rather than damage taken is deliberate: damage depends on
// convergence geometry and on which engine is fitted (a catastrophic core
// meltdown is 200 hull and would swamp the signal), whereas spawn density is
// exactly the quantity that broke the win condition.
function spawnsPerMinute(altFt, windows) {
  let total = 0;
  for (let w = 0; w < windows; w++) {
    const h = createFlight();
    const s = h.launch({ parts: ['salvaged_motor', 'industrial_drum', 'trash_can'], finId: 'aerospace_fin' }, CALM);
    h.thrust(true);
    h.run(60);
    const seen = new Set();
    let n = 0;
    for (let i = 0; i < 3600; i++) {   // 60 simulated seconds in-band
      s.y = altFt / M_TO_FT;
      s.vy = 200;
      if (!h.step()) break;
      h.F.hazards.forEach((z) => { if (!seen.has(z)) { seen.add(z); n++; } });
    }
    total += n;
    h.exit();
  }
  return total / windows;
}

test('the high band a moonshot crosses is not saturated with debris', () => {
  // Intended ~4/min (0.22/s spawn x 0.3 debris share). The rate that made the
  // moon unreachable measured ~25/min. A moonshot spends 5-7 minutes up here
  // with a hull near 200, and debris is 30 damage a strike.
  const rate = spawnsPerMinute(300000, 3);
  assert.ok(rate <= 12,
    rate.toFixed(1) + ' hazards/min at 300,000 ft — too dense for a moonshot to cross');
});

test('the very high band stays sparse too', () => {
  const rate = spawnsPerMinute(900000, 3);
  assert.ok(rate <= 12,
    rate.toFixed(1) + ' hazards/min at 900,000 ft — too dense to approach the moon');
});

test('a first moonshot ends the run, later flights press past it', () => {
  // The deep-space objectives beyond 1,000,000 ft could never fire while every
  // run stopped dead the instant it touched the moon.
  const first = createFlight();
  first.launch({ parts: ['hairdryer', 'soda_bottle', 'trash_can'], finId: null }, CALM);
  assert.equal(first.sim.moonEndsFlight, true, 'the first moonshot should be the win');
  first.exit();

  const veteran = createFlight();
  veteran.g.Game.state.stats.totalMoonshots = 1;
  veteran.launch({ parts: ['hairdryer', 'soda_bottle', 'trash_can'], finId: null }, CALM);
  assert.equal(veteran.sim.moonEndsFlight, false,
    'once the moon is landed the run must continue past it, or deep space is unreachable');
  veteran.exit();
});
