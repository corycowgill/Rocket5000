'use strict';
// Randomised soak over the flight model. Hand-written tests only cover the
// builds someone thought to write down; this flies randomly generated rockets
// through every weather type with random steering and staging, and asserts the
// invariants that must hold for ANY build:
//
//   - no NaN or Infinity ever enters the physics state
//   - fuel stays within [0, capacity]
//   - recorded apogee never goes negative
//   - nothing throws
//
// Deliberately NOT asserted: that every flight terminates inside the step
// budget. Large rockets legitimately fly for minutes (one measured at 252s),
// which is what the RECOVER control exists for — so a long flight is not a bug.
const { test } = require('node:test');
const assert = require('node:assert');
const { createFlight } = require('./flight-harness.js');

const BUDGET_MS = 8000;      // keep the suite quick; enough for ~10-20 flights
const MAX_STEPS = 4000;

const MODS = [
  { id: 'calm',   windMul: 1,   debrisMul: 1,   lightningMul: 1, tailwind: 0, scrapMul: 1 },
  { id: 'storm',  windMul: 1.6, debrisMul: 1,   lightningMul: 3, tailwind: 0, scrapMul: 1.25 },
  { id: 'meteor', windMul: 1,   debrisMul: 3,   lightningMul: 1, tailwind: 0, scrapMul: 1.3 },
  { id: 'aurora', windMul: 1,   debrisMul: 1.5, lightningMul: 2, tailwind: 0, scrapMul: 1.4 },
];

test('random builds fly without breaking any physics invariant', () => {
  const probe = createFlight();
  const P = probe.Parts;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const engines = P.byCategory('engine').map((p) => p.id);
  const fuels = P.byCategory('fuel').map((p) => p.id);
  const bodies = P.byCategory('body').map((p) => p.id);
  const fins = P.byCategory('fin').map((p) => p.id);
  probe.exit();

  const randomBuild = () => {
    const stages = 1 + Math.floor(Math.random() * 4);
    const tanks = 1 + Math.floor(Math.random() * 3);
    const eng = pick(engines), fu = pick(fuels), parts = [];
    for (let i = 0; i < stages; i++) {
      parts.push(eng);
      for (let k = 0; k < tanks; k++) parts.push(fu);
    }
    parts.push(pick(bodies));
    return { parts, finId: Math.random() < 0.7 ? pick(fins) : null };
  };

  const started = Date.now();
  let flights = 0;

  while (Date.now() - started < BUDGET_MS) {
    const h = createFlight();
    const build = randomBuild();
    const s = h.launch(build, pick(MODS));
    h.thrust(true);
    flights++;
    const label = build.parts.join(',') + (build.finId ? ' +' + build.finId : '');

    for (let i = 0; i < MAX_STEPS; i++) {
      // random pilot input so steering, tumbling and staging all get exercised
      if (i % 7 === 0) {
        h.F.keys.left = Math.random() < 0.05;
        h.F.keys.right = Math.random() < 0.05;
      }
      if (i % 400 === 0) h.Flight._jettison();
      if (!h.step()) break;

      const vals = [s.x, s.y, s.vx, s.vy, s.angle, s.angVel, s.fuel, s.hull, s.maxAltitudeM];
      assert.ok(vals.every(Number.isFinite),
        'non-finite physics state at step ' + i + ' for ' + label + ' -> ' + vals.join('|'));
      assert.ok(s.fuel >= -1e-6, 'negative fuel for ' + label);
      assert.ok(s.maxFuel <= 0 || s.fuel <= s.maxFuel + 1e-6, 'fuel above capacity for ' + label);
      assert.ok(s.maxAltitudeM >= -1e-6, 'negative apogee for ' + label);

      if (s.crashed || s.moonReached) break;
    }
    h.exit();
  }

  assert.ok(flights > 0, 'the soak should complete at least one flight');
});
