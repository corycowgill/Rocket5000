'use strict';
// Regression tests for the flight model. Every case here corresponds to a bug
// that was actually found and fixed in this file — including two introduced
// while fixing something else. Without these, the next change to flight.js has
// nothing catching it.
const { test } = require('node:test');
const assert = require('node:assert');
const { createFlight } = require('./flight-harness.js');

const E = 'lawnmower', F = 'beer_keg', B = 'trash_can';
const twoStage = () => ({ parts: [E, F, E, F, B], finId: 'plywood_fin' });

// ---- staging ---------------------------------------------------------------

test('staging drops the bottom stage and keeps an engine firing', () => {
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(120);
  const enginesBefore = s.engines.length;
  assert.ok(h.Flight._jettison(), 'should be able to stage');
  assert.equal(s.stageCount, 1);
  assert.ok(s.engines.length < enginesBefore, 'the dropped stage takes its engine');
  assert.ok(s.engines.length >= 1, 'an engine must survive to keep flying');
  assert.ok(s.thrust > 0, 'thrust must remain after separation');
  h.exit();
});

test('the last powered stage can never be jettisoned', () => {
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(120);
  assert.ok(h.Flight._jettison(), 'first drop allowed');
  assert.equal(h.Flight._jettison(), false, 'second drop would leave no engine');
  assert.ok(s.engines.length >= 1);
  h.exit();
});

test('a single-stage rocket cannot stage at all', () => {
  const h = createFlight();
  h.launch({ parts: [E, F, B], finId: null });
  h.thrust(true);
  h.run(60);
  assert.equal(h.Flight._canStage(), false);
  h.exit();
});

// ---- per-tank fuel ---------------------------------------------------------

test('fuel drains the bottom tank first, and staging keeps the upper tank', () => {
  const h = createFlight();
  const s = h.launch(twoStage());
  const idxs = Object.keys(s.tankFuel).map(Number).sort((a, b) => a - b);
  const [low, high] = idxs;
  const highStart = s.tankFuel[high];
  h.thrust(true);
  h.run(400);
  assert.ok(s.tankFuel[low] < highStart, 'the lower tank should drain first');
  assert.equal(s.tankFuel[high], highStart, 'the upper tank must be untouched');
  h.exit();
});

// ---- engine sputter (agency over instant failure) ---------------------------

test('an engine sputters before it dies, and easing off saves it', () => {
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(60);
  const eng = s.engines[0];
  eng.sputterT = 1.6;                 // force the failure window
  // hold the throttle: it should die
  h.run(140);
  assert.equal(eng.alive, false, 'riding the throttle through a sputter loses the engine');
  h.exit();

  const h2 = createFlight();
  const s2 = h2.launch(twoStage());
  h2.thrust(true);
  h2.run(60);
  const eng2 = s2.engines[0];
  eng2.sputterT = 1.6;
  h2.thrust(false);                   // cut throttle to nurse it
  h2.run(120);
  assert.equal(eng2.alive, true, 'cutting the throttle must save a sputtering engine');
  assert.equal(eng2.sputterT, 0, 'and clear the fault');
  h2.exit();
});

// ---- tumbling --------------------------------------------------------------

test('a completed 360 roll is not treated as tumbling', () => {
  // s.angle accumulates unwrapped; angle = 2*PI renders upright and must not
  // drain hull. This bug killed recovered rockets outright.
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(60);
  s.y = 5000; s.angle = Math.PI * 2; s.angVel = 0;
  const hull = s.hull;
  h.run(60);
  assert.ok(s.hull >= hull - 0.001, 'an upright rocket at angle 2pi must take no tumble damage');
  h.exit();
});

test('genuinely inverted flight does drain hull', () => {
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(60);
  s.y = 5000; s.angle = Math.PI; s.angVel = 0;
  const hull = s.hull;
  h.run(60);
  assert.ok(s.hull < hull, 'inverted flight should still be punished');
  h.exit();
});

// ---- terminal state (the soft-lock) ----------------------------------------

test('a spent rocket at rest ends the flight instead of hanging forever', () => {
  // crashed was previously only set by hull loss, so a gentle touchdown left the
  // run with no result screen and no way out but reloading the page.
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(30);
  s.y = 0; s.vy = 0; s.fuel = 0; s.time = 5;
  Object.keys(s.tankFuel).forEach((k) => { s.tankFuel[k] = 0; });
  h.run(10);
  assert.ok(s.crashed, 'the flight must reach a terminal state');
  assert.ok(s.crashReason, 'and report a reason');
  h.exit();
});

// ---- RECOVER ---------------------------------------------------------------

test('RECOVER is refused while fuel remains and allowed once dry', () => {
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(200);
  assert.equal(h.Flight._canRecover(), false, 'cannot bail out mid-burn');
  assert.equal(h.Flight._endFlight(), false);

  Object.keys(s.tankFuel).forEach((k) => { s.tankFuel[k] = 0; });
  s.fuel = 0;
  assert.equal(h.Flight._canRecover(), true);
  const apogee = s.maxAltitudeM;
  assert.ok(h.Flight._endFlight());
  assert.ok(s.crashed);
  assert.equal(s.maxAltitudeM, apogee, 'recovering must not cost the player their apogee');
  assert.equal(h.Flight._endFlight(), false, 'and is not repeatable');
  h.exit();
});

// ---- hazards ---------------------------------------------------------------

test('hazards are not culled instantly at flight speed', () => {
  // Hazards used to carry a world-frame vy against a 30m cull window, so a
  // climbing rocket left every one behind in ~0.2s and nothing could ever hit.
  // The hazard is constructed directly rather than waiting for a random spawn,
  // which produced no hazard at all in roughly one run in six.
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(200);
  s.y = 4000; s.vy = 200;               // climbing fast, which used to cull everything

  const bird = h.Flight._makeHazard('bird', s);
  h.F.hazards.length = 0;
  h.F.hazards.push(bird);

  // Survival time alone is too weak an assertion — the speed-scaled cull window
  // satisfies it on its own. What actually matters is that the hazard can still
  // CLOSE on a fast-climbing rocket, which is what the rocket-frame vy provides.
  const startDist = Math.hypot(bird.x - s.x, bird.y - s.y);
  let minDist = startDist;
  for (let i = 0; i < 300; i++) {
    s.vy = 200;                          // keep climbing for the whole window
    if (!h.step()) break;
    if (!h.F.hazards.includes(bird)) break;
    minDist = Math.min(minDist, Math.hypot(bird.x - s.x, bird.y - s.y));
  }
  assert.ok(minDist < startDist * 0.5,
    'a hazard must be able to close on a climbing rocket: started ' +
    startDist.toFixed(1) + 'm, got no nearer than ' + minDist.toFixed(1) + 'm');
  h.exit();
});

test('lightning spawns inside the cull window and arms', () => {
  // The strike used to lead the rocket by vy*0.5 unclamped, putting it outside
  // the 30m cull radius on its first frame whenever |vy| > 60 — so it was
  // deleted before arming and storm/aurora lightning was entirely inert.
  // Constructed directly rather than waiting on a random spawn, so it cannot flake.
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(200);
  s.y = 3000; s.vy = 200;             // fast enough that the old lead overshot

  const bolt = h.Flight._makeHazard('lightning', s);
  assert.ok(Math.abs(bolt.y - s.y) <= 30,
    'a bolt must spawn inside the cull window, was ' + (bolt.y - s.y).toFixed(1) + 'm away');

  h.F.hazards.length = 0;
  h.F.hazards.push(bolt);
  let armed = false;
  h.run(120, () => { if (h.F.hazards.some((z) => z.armed)) armed = true; });
  assert.ok(armed, 'the bolt must live long enough to arm');
  h.exit();
});

// ---- pickups ---------------------------------------------------------------

test('pickups above the rocket are culled during descent', () => {
  // The GC test was one-sided ((s.y - p.y) < 80), so anything above the rocket
  // was never removed; a descent stranded them at the cap and blocked all
  // further pickup spawns for the rest of the flight.
  const h = createFlight();
  const s = h.launch(twoStage());
  h.thrust(true);
  h.run(300);
  h.F.pickups.length = 0;
  // must match the real pickup shape — a missing vx/vy makes x go NaN and the
  // pickup gets culled by the x test instead, which would hide the bug
  const stranded = { type: 'scrap', x: s.x, y: s.y + 4000, vx: 0, vy: 0, t: 0, collected: false };
  h.F.pickups.push(stranded);
  s.vy = 0;
  h.run(5);
  // Assert THIS pickup is gone rather than that the array is empty: the spawner
  // can add a fresh pickup during these frames, which made an emptiness check
  // intermittently fail for a reason unrelated to the bug under test.
  assert.ok(!h.F.pickups.includes(stranded), 'a pickup far above the rocket must be culled');
  h.exit();
});

// ---- time acceleration -----------------------------------------------------

test('warp advances the sim faster without changing the timestep', () => {
  // A moonshot runs 7-14 minutes of real time. Warp runs extra physics steps at
  // the SAME dt, so the simulation is identical — only wall-clock is saved.
  //
  // The guard conditions are re-cleared every frame and frames are counted
  // rather than assumed: a random engine sputter or an early crash would
  // otherwise suspend warp mid-measurement and fail this for reasons that have
  // nothing to do with warp.
  const measure = (warp) => {
    const h = createFlight();
    const s = h.launch(twoStage());
    h.thrust(true);
    h.run(200);                          // clear the time < 3s guard
    s.warp = warp;
    const start = s.time;
    let frames = 0;
    for (let i = 0; i < 100; i++) {
      s.y = 20000 / 3.281;               // above the low-altitude guard
      s.angle = 0; s.angVel = 0;         // not tumbling
      s.hull = s.maxHull;                // cannot die mid-measurement
      s.engines.forEach((e) => { e.sputterT = 0; });
      if (!h.step()) break;
      frames++;
    }
    const per = frames > 0 ? (s.time - start) / frames : 0;
    h.exit();
    return per;
  };

  const perFrame1 = measure(1);
  const perFrame8 = measure(8);
  assert.ok(perFrame8 > perFrame1 * 6,
    'x8 warp should advance the sim far faster per frame (' +
    perFrame1.toFixed(4) + ' vs ' + perFrame8.toFixed(4) + ')');
});

test('warp is suspended whenever the player needs to react', () => {
  // Warping past a sputtering engine would silently eat the ~1.6s window in
  // which cutting the throttle saves it, turning a skill moment into a dice roll.
  const cases = [
    ['engine sputtering', (s) => { s.engines[0].sputterT = 1.6; }],
    ['tumbling',          (s) => { s.angle = Math.PI; s.angVel = 0; }],
    ['near the ground',   (s) => { s.y = 300 / 3.281; }],
  ];
  for (const [label, breakIt] of cases) {
    const h = createFlight();
    const s = h.launch(twoStage());
    h.thrust(true);
    h.run(200);
    s.warp = 8;
    const start = s.time;
    let frames = 0;
    for (let i = 0; i < 40; i++) {
      // baseline is warp-eligible; breakIt() then introduces exactly one blocker
      s.y = 20000 / 3.281; s.angle = 0; s.angVel = 0; s.hull = s.maxHull;
      s.engines.forEach((e) => { e.sputterT = 0; });
      breakIt(s);
      if (!h.step()) break;
      frames++;
    }
    const perFrame = frames > 0 ? (s.time - start) / frames : 0;
    assert.ok(perFrame < 0.03,
      'warp must drop to real time during: ' + label + ' (got ' + perFrame.toFixed(4) + ' s/frame)');
    h.exit();
  }
});

// ---- weather forecast ------------------------------------------------------

test('the pre-rolled forecast is the weather actually flown', () => {
  // A moonshot is a 10+ minute commitment and METEOR SHOWER triples debris in
  // the band it must cross. Rolling the weather only at launch made that an
  // unseeable dice roll, so the hangar now forecasts it — which is only
  // meaningful if the forecast is what you actually get.
  const h = createFlight();
  const forecast = h.Flight.MODIFIERS.find((m) => m.id === 'meteor');
  h.g.Game.nextWeather = forecast;
  const s = h.launch({ parts: [E, F, B], finId: null }, null);
  assert.equal(s.modifier.id, forecast.id, 'the flight must use the forecast weather');
  h.exit();
});

test('with no forecast a valid weather is still rolled', () => {
  const h = createFlight();
  h.g.Game.nextWeather = null;
  const s = h.launch({ parts: [E, F, B], finId: null }, null);
  assert.ok(s.modifier && s.modifier.id, 'a flight must always have weather');
  assert.ok(h.Flight.MODIFIERS.some((m) => m.id === s.modifier.id), 'and it must be a real modifier');
  h.exit();
});
