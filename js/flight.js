/* ==========================================================
   FLIGHT — physics, rendering, controls.

   Coordinate system:
     y_m: meters above launchpad (positive = up)
     x_m: meters horizontal (0 = launchpad center)
     angle: radians from vertical (0 = up, +ve = tilted right)

   Display:
     altitude shown as feet (y_m * 3.281)
     rocket fixed at 65% from top of screen, world scrolls
   ========================================================== */
(function (global) {
  'use strict';

  // ---- constants ------------------------------------------------------------
  const THRUST_GAIN = 18;
  const GRAVITY = 9.8;
  const FUEL_MASS_PER_L = 0.05;
  const M_TO_FT = 3.281;
  const MOON_ALTITUDE_FT = 1_000_000;
  const MOON_ALTITUDE_M = MOON_ALTITUDE_FT / M_TO_FT;
  const PIXEL_PER_M_BASE = 2.4;      // base zoom (will scale with speed)
  const PIXEL_PER_M_MIN  = 1.2;      // minimum zoom at high speed
  const STACK_SCALE = 1.5;           // sprite scale during flight

  // ---- module state ---------------------------------------------------------
  const F = {
    canvas: null, ctx: null,
    rocket: null,
    sim: null,
    raf: 0,
    lastT: 0,
    keys: { left: false, right: false, thrust: false },
    touch: { left: false, right: false, thrust: false },
    started: false,
    stars: [],
    particles: [],
    hazards: [],
    droppedTanks: [], // tumbling jettisoned parts (proper sprites)
    satellites: [],   // drifting decoration in space
    contrail: [],     // recent rocket positions for the trail line
    comets: [],       // decorative meteors at high altitude
    balloons: [],     // hot air balloons at low-mid altitude
    npcRockets: [],   // ambient rockets in the distance
    raindrops: [],    // visible rain during THUNDERSTORM
    pickups: [],      // collectible items floating in flight
    msg: '',
    msgT: 0,
    seed: 0,
    rng: null,
  };

  function $(s) { return document.querySelector(s); }

  function rngFromSeed(seed) {
    let a = seed >>> 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return { r: 255, g: 200, b: 80 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  // ---- entry ----------------------------------------------------------------
  function enter(Game) {
    F.canvas = $('#flight-canvas');
    F.ctx = F.canvas.getContext('2d');
    F.ctx.imageSmoothingEnabled = false;
    // respect the OS "reduce motion" setting: damp screen shake and skip the
    // full-screen impact/milestone flashes for motion-sensitive players
    F.reducedMotion = !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const r = Game.lastRocket || Builder.getCurrentRocket();
    F.rocket = r;
    F.seed = Date.now() & 0xFFFFFFFF;
    F.rng = rngFromSeed(F.seed);

    initSim(r, { modifier: (Game && Game.nextWeather) || null });
    initStars();
    F.particles = [];
    F.hazards = [];
    F.droppedTanks = [];
    F.satellites = [];
    F.contrail = [];
    F.comets = [];
    F.balloons = [];
    F.npcRockets = [];
    F.raindrops = [];
    F.pickups = [];
    F.msg = 'IGNITION';
    F.msgT = 1.5;

    fitCanvas();
    if (!F.started) {
      bindControls(Game);
      // inside the guard: this used to re-register on every flight, so after N
      // launches a single resize ran fitCanvas N times
      window.addEventListener('resize', fitCanvas);
      F.started = true;
    }

    Sfx.startEngine();
    F.lastT = performance.now();
    cancelAnimationFrame(F.raf);
    F.raf = requestAnimationFrame(loop.bind(null, Game));
  }

  function exit() {
    cancelAnimationFrame(F.raf);
    F.raf = 0;
    Sfx.stopEngine();
  }

  function fitCanvas() {
    const c = F.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    F.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    F.ctx.imageSmoothingEnabled = false;
  }

  // ---- weather modifiers ----------------------------------------------------
  const MODIFIERS = [
    { id: 'calm',    label: 'CALM',          windMul: 1.0, debrisMul: 1.0, lightningMul: 1.0, tailwind: 0,    scrapMul: 1.0 },
    { id: 'gusty',   label: 'GUSTY',         windMul: 2.5, debrisMul: 1.0, lightningMul: 1.0, tailwind: 0,    scrapMul: 1.15 },
    { id: 'storm',   label: 'THUNDERSTORM',  windMul: 1.6, debrisMul: 1.0, lightningMul: 3.0, tailwind: 0,    scrapMul: 1.25 },
    { id: 'meteor',  label: 'METEOR SHOWER', windMul: 1.0, debrisMul: 3.0, lightningMul: 1.0, tailwind: 0,    scrapMul: 1.30 },
    { id: 'tail',    label: 'TAILWIND',      windMul: 1.2, debrisMul: 1.0, lightningMul: 1.0, tailwind: 1.0,  scrapMul: 0.95 },
    { id: 'aurora',  label: 'AURORA',        windMul: 1.0, debrisMul: 1.5, lightningMul: 2.0, tailwind: 0,    scrapMul: 1.40 },
  ];

  // altitude milestones (feet) — each fires once per run
  const MILESTONES = [
    { ft: 500,     label: 'CLEARED THE TREES',  bonus: 5 },
    { ft: 2000,    label: 'BIRDS RESPECT YOU',  bonus: 15 },
    { ft: 10000,   label: 'CLOUD LAYER',        bonus: 50 },
    { ft: 50000,   label: 'STRATOSPHERE',       bonus: 150 },
    { ft: 100000,  label: 'KÁRMÁN ENVY',        bonus: 400 },
    { ft: 250000,  label: 'EXOSPHERE',          bonus: 800 },
    { ft: 500000,  label: 'HALFWAY TO THE MOON',bonus: 1500 },
    { ft: 1000000, label: 'MOON',               bonus: 5000 },
    // Past the moon there was nothing left to chase. A maxed 8-stage build
    // estimates out past 40M ft, so these are demanding but genuinely reachable.
    { ft: 2500000,  label: 'LUNAR TRANSFER',    bonus: 8000 },
    { ft: 5000000,  label: 'DEEP SPACE',        bonus: 15000 },
    { ft: 10000000, label: 'INTERPLANETARY',    bonus: 40000 },
  ];

  // ---- simulation init ------------------------------------------------------
  function initSim(rocket, opts) {
    opts = opts || {};
    const modifier = opts.modifier || pickModifier();
    const stats = recomputeStats(rocket, {});
    // R&D upgrades for this run
    const upg = (typeof Game !== 'undefined' && Game.getUpgrades) ? Game.getUpgrades() : {};
    const hullBoost   = (upg.hull       || 0) * 25;
    const burnFactor  = 1 - 0.08 * (upg.efficient || 0);
    const breakFactor = 1 - 0.10 * (upg.precision || 0);
    // apply mass/thrust upgrades to the recomputed stats so physics matches builder
    if (upg.lightweight) stats.mass   *= (1 - 0.05 * upg.lightweight);
    if (upg.turbofuel)   stats.thrust *= (1 + 0.05 * upg.turbofuel);
    F.sim = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      angVel: 0,
      fuel: stats.capacity,
      maxFuel: stats.capacity,
      hull: 100 + stats.hullBonus + hullBoost,
      maxHull: 100 + stats.hullBonus + hullBoost,
      dryMass: stats.mass,
      fuelMass: stats.capacity * FUEL_MASS_PER_L,
      thrust: stats.thrust,
      // turbofuel R&D multiplier — applied to live flight thrust below, not just
      // baked into the (display-only) stats.thrust, so the upgrade actually works
      thrustMul: 1 + 0.05 * (upg.turbofuel || 0),
      burnRate: stats.burnRate * burnFactor,
      breakFactor,
      magnetBoost: 1 + 0.30 * (upg.magnet || 0),
      stability: stats.stability,
      jank: stats.jank,
      engines: rocket.parts.map((pid, idx) => ({ pid, idx, alive: true }))
        .filter(e => Parts.byId(e.pid)?.category === 'engine'),
      dropped: {}, // index -> true for jettisoned parts
      stageCount: 0,
      time: 0,
      maxAltitudeM: 0,
      crashed: false,
      moonReached: false,
      crashReason: null,
      // the first moonshot terminates the run; later flights press on past it
      moonEndsFlight: !(typeof Game !== 'undefined' && Game.state && Game.state.stats &&
                        (Game.state.stats.totalMoonshots || 0) > 0),
      passedMoon: false,
      warp: 1,                  // time acceleration (T cycles it)
      throttle: 0,
      modifier,
      // milestones
      milestones: MILESTONES.map(m => ({ ...m, hit: false })),
      milestoneScrapBonus: 0,
      // combo
      combo: 0,
      comboT: 0,
      comboBonus: 0,
      // tracked hazards for combo (so we don't double-count)
      hazardsTracked: new WeakSet ? new WeakSet() : null,
      // flash overlays
      flash: 0,
      flashColor: '#ffffff',
      shake: 0,
      rumble: 0,
      contrailT: 0,
      launchShockwaveDone: false,
      firstIgnitionDone: false,
      gimbal: 0,            // visual thrust-vector gimbal (radians)
      sonicBoomDone: false, // expanding ring on Mach crossing
      met: 0,               // mission elapsed time (seconds)
      pickupScrap: 0,       // scrap collected from pickups this run
      pickupData: 0,        // data collected from pickups this run
      pickupCount: 0,       // total pickups grabbed
      shieldT: 0,           // remaining seconds of damage immunity
    };
    // drop the previous flight's stage cache — leaving the hangar without
    // crashing can carry dropVersion 0 across into a different rocket
    F._stageCache = null;
    // per-tank fuel: each fuel part starts full; s.fuel is their attached total
    F.sim.tankFuel = {};
    rocket.parts.forEach((pid, i) => {
      const p = Parts.byId(pid);
      if (p && p.category === 'fuel') F.sim.tankFuel[i] = p.capacity;
    });
  }

  function recomputeStats(rocket, dropped) {
    let mass = 0, capacity = 0, hullBonus = 0, stability = 0, jank = 0;
    let burnRate = 0, thrust = 0, engineCount = 0;
    rocket.parts.forEach((pid, i) => {
      if (dropped && dropped[i]) return;
      const p = Parts.byId(pid);
      if (!p) return;
      mass += p.mass;
      if (p.category === 'engine') {
        thrust += p.thrust;
        burnRate += p.burnRate;
        jank += p.jank;
        engineCount++;
      }
      if (p.category === 'fuel') capacity += p.capacity;
      if (p.category === 'body') {
        stability += p.stability || 0;
        hullBonus += p.hullBonus || 0;
      }
    });
    if (rocket.finId) {
      const f = Parts.byId(rocket.finId);
      if (f) { mass += f.mass; stability += f.stability; }
    }
    return {
      mass, capacity, hullBonus, thrust, burnRate,
      stability: Math.min(100, Math.round(stability)),
      jank: engineCount > 0 ? Math.round(jank / engineCount) : 0,
    };
  }

  // ---- per-tank fuel --------------------------------------------------------
  // Burn drains the lowest still-attached tank first, so the bottom (active)
  // stage empties before the stages above it. Staging then sheds an already-
  // spent tank while the upper stages keep their fuel — that's what makes a
  // multi-stage build climb higher than a single stack of the same parts.
  // s.fuel stays the attached total (HUD + physics: mass grows with s.fuel).
  function sumTankFuel(s) {
    let sum = 0;
    for (const k in s.tankFuel) {
      if (!(s.dropped && s.dropped[k])) sum += s.tankFuel[k];
    }
    return sum;
  }
  function drainFuel(s, amount) {
    const parts = F.rocket.parts;
    let left = amount;
    for (let i = 0; i < parts.length && left > 0; i++) {
      if (s.dropped && s.dropped[i]) continue;
      const have = s.tankFuel[i] || 0;
      if (have <= 0) continue;
      const take = Math.min(have, left);
      s.tankFuel[i] = have - take;
      left -= take;
    }
    s.fuel = sumTankFuel(s);
  }
  // computeStages allocates a fresh array of stage objects on every call, and it
  // was being run ~6x per frame from update/render/HUD even though the grouping
  // only changes when parts are actually jettisoned. Cache it against a version
  // counter bumped wherever sim.dropped is written (staging and death).
  // Callers only read the result — nothing mutates it — so sharing is safe.
  function currentStages(s) {
    const v = s.dropVersion || 0;
    if (F._stageCache && F._stageCache.v === v) return F._stageCache.stages;
    const stages = Parts.computeStages(F.rocket.parts, s.dropped);
    F._stageCache = { v, stages };
    return stages;
  }

  // true once EVERY tank in the bottom stage is empty — the whole stage is then
  // dead weight worth jettisoning. Checking the whole stage (not just the lowest
  // tank) avoids nudging a premature drop that would waste a still-full tank.
  function bottomStageDry(s) {
    const stages = currentStages(s);
    if (!stages.length) return false;
    let hasTank = false;
    for (const i of stages[0].idxs) {
      const p = Parts.byId(F.rocket.parts[i]);
      if (p && p.category === 'fuel') {
        hasTank = true;
        if ((s.tankFuel[i] || 0) > 0) return false;
      }
    }
    return hasTank;
  }

  function addFuel(s, amount) {
    const parts = F.rocket.parts;
    let left = amount;
    for (let i = 0; i < parts.length && left > 0; i++) {
      if (s.dropped && s.dropped[i]) continue;
      const p = Parts.byId(parts[i]);
      if (!p || p.category !== 'fuel') continue;
      const room = p.capacity - (s.tankFuel[i] || 0);
      if (room <= 0) continue;
      const put = Math.min(room, left);
      s.tankFuel[i] = (s.tankFuel[i] || 0) + put;
      left -= put;
    }
    s.fuel = sumTankFuel(s);
  }

  function pickModifier() {
    // Mostly calm, some weather variety; slight bias to interesting.
    const roll = Math.random();
    if (roll < 0.35) return MODIFIERS[0]; // calm
    if (roll < 0.55) return MODIFIERS[1]; // gusty
    if (roll < 0.70) return MODIFIERS[2]; // storm
    if (roll < 0.83) return MODIFIERS[3]; // meteor
    if (roll < 0.93) return MODIFIERS[4]; // tail
    return MODIFIERS[5]; // aurora
  }

  function initStars() {
    F.stars = [];
    // 3 depth layers — distant tiny, mid, bright near
    for (let i = 0; i < 60; i++) F.stars.push(makeStar(0.2));   // far
    for (let i = 0; i < 40; i++) F.stars.push(makeStar(0.5));   // mid
    for (let i = 0; i < 20; i++) F.stars.push(makeStar(0.9));   // near
  }
  function makeStar(depth) {
    return {
      x: Math.random() * 2400 - 1200,
      y: Math.random() * 5000,
      depth: depth + Math.random() * 0.1,
      bright: Math.random(),
      tint: Math.random(),
    };
  }

  // ---- controls -------------------------------------------------------------
  function bindControls(Game) {
    document.addEventListener('keydown', (e) => {
      if (Game.currentScreen !== 'flight') return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        F.keys.thrust = true; e.preventDefault();
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') F.keys.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') F.keys.right = true;
      if (e.code === 'KeyS' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!e.repeat) jettisonStage();
        e.preventDefault();
      }
      if (!e.repeat && (e.code === 'Digit1' || e.code === 'Numpad1')) { useAbility('boost');  e.preventDefault(); }
      if (!e.repeat && (e.code === 'Digit2' || e.code === 'Numpad2')) { useAbility('repair'); e.preventDefault(); }
      if (!e.repeat && (e.code === 'Digit3' || e.code === 'Numpad3')) { useAbility('shield'); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyT') { cycleWarp(); e.preventDefault(); }
      if (!e.repeat && (e.code === 'Escape' || e.code === 'Enter')) {
        if (!endFlight() && !F.sim.crashed) flashMsg('BURN OUT YOUR FUEL FIRST');
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') F.keys.thrust = false;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') F.keys.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') F.keys.right = false;
    });

    function bindTouch(btn, key) {
      const el = $(btn);
      const press = (e) => { F.touch[key] = true; el.classList.add('held'); e.preventDefault(); };
      const release = (e) => { F.touch[key] = false; el.classList.remove('held'); e.preventDefault(); };
      el.addEventListener('touchstart', press, { passive: false });
      el.addEventListener('touchend', release);
      el.addEventListener('touchcancel', release);
      el.addEventListener('mousedown', press);
      el.addEventListener('mouseup', release);
      el.addEventListener('mouseleave', release);
    }
    bindTouch('#touch-left', 'left');
    bindTouch('#touch-right', 'right');
    bindTouch('#touch-thrust', 'thrust');

    const stageBtn = $('#touch-stage');
    const stageHandler = (e) => { jettisonStage(); e.preventDefault(); };
    stageBtn.addEventListener('click', stageHandler);
    stageBtn.addEventListener('touchstart', stageHandler, { passive: false });

    const warpBtn = $('#touch-warp');
    if (warpBtn) {
      const warpHandler = (e) => { cycleWarp(); e.preventDefault(); };
      warpBtn.addEventListener('click', warpHandler);
      warpBtn.addEventListener('touchstart', warpHandler, { passive: false });
    }

    const recBtn = $('#touch-recover');
    if (recBtn) {
      const recHandler = (e) => { endFlight(); e.preventDefault(); };
      recBtn.addEventListener('click', recHandler);
      recBtn.addEventListener('touchstart', recHandler, { passive: false });
    }

    // ability buttons (boost / repair / shield)
    bindAbility('#ability-boost',  'boost');
    bindAbility('#ability-repair', 'repair');
    bindAbility('#ability-shield', 'shield');
  }

  function bindAbility(selector, id) {
    const el = $(selector);
    if (!el) return;
    const handler = (e) => { useAbility(id); e.preventDefault(); };
    el.addEventListener('click', handler);
    el.addEventListener('touchstart', handler, { passive: false });
  }

  function useAbility(id) {
    if (!F.sim || F.sim.exiting) return false;
    // don't burn a repair drone that can't heal anything — the stock was spent
    // before this check, so a full-hull tap silently cost the player an item
    if (id === 'repair' && F.sim.hull >= F.sim.maxHull) {
      flashMsg('HULL ALREADY FULL');
      return false;
    }
    if (!Game.spendConsumable(id)) {
      // say where charges actually come from — the ability buttons otherwise
      // just read 0 with no hint that they're bought with DATA in the R&D LAB
      flashMsg('NO ' + id.toUpperCase() + ' — BUY WITH DATA IN R&D LAB');
      return false;
    }
    if (Game.unlockAchievement) Game.unlockAchievement('ability_use');
    const s = F.sim;
    if (id === 'boost') {
      // instant velocity along thrust axis
      const ex = -Math.sin(s.angle), ey = -Math.cos(s.angle);
      s.vx += -ex * 50;
      s.vy += -ey * 50;
      s.shake = Math.max(s.shake || 0, 0.6);
      s.flash = Math.max(s.flash || 0, 0.4);
      s.flashColor = '#ffaa44';
      // celebratory exhaust burst
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 10;
        F.particles.push({
          x: s.x + ex * 0.6, y: s.y + ey * 0.6,
          vx: ex * (10 + Math.random() * 6) + Math.cos(a) * sp * 0.3,
          vy: ey * (10 + Math.random() * 6) + Math.sin(a) * sp * 0.3,
          life: 0.5 + Math.random() * 0.4,
          color: i % 2 === 0 ? '#ffffff' : '#ffaa44',
          size: 3,
        });
      }
      flashMsg('BOOST!');
    }
    if (id === 'repair') {
      const before = s.hull;
      s.hull = Math.min(s.maxHull, s.hull + 50);
      s.flash = Math.max(s.flash || 0, 0.3);
      s.flashColor = '#88ff88';
      // green sparkle around rocket
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 1 + Math.random() * 1.5;
        F.particles.push({
          x: s.x + Math.cos(a) * r,
          y: s.y + Math.sin(a) * r,
          vx: Math.cos(a) * 4,
          vy: Math.sin(a) * 4,
          life: 0.6,
          color: '#88ff88',
          size: 2,
        });
      }
      flashMsg('REPAIRED +' + Math.floor(s.hull - before));
    }
    if (id === 'shield') {
      s.shieldT = 5.0;
      s.flash = Math.max(s.flash || 0, 0.4);
      s.flashColor = '#aaccff';
      flashMsg('SHIELD UP 5s');
    }
    Sfx.play('snap');
    return true;
  }

  // ---- staging --------------------------------------------------------------
  function jettisonStage() {
    if (!F.sim || F.sim.exiting) return false;
    const s = F.sim;
    // Drop the bottom-most stage only — but never the last powered stage, or
    // we'd jettison our only engine. There must be a stage above us that still
    // carries an engine to keep flying.
    const stages = Parts.computeStages(F.rocket.parts, s.dropped);
    const poweredAbove = stages.slice(1).some(st => st.engineCount > 0);
    if (stages.length < 2 || !poweredAbove) {
      flashMsg('NOTHING TO STAGE');
      return false;
    }

    // how much of the dropped stage's fuel goes to waste — near-empty = a
    // "clean separation" the player timed well, and earns a bonus below
    let dropCap = 0, dropFuel = 0;
    stages[0].idxs.forEach(idx => {
      const p = Parts.byId(F.rocket.parts[idx]);
      if (p && p.category === 'fuel') { dropCap += p.capacity; dropFuel += (s.tankFuel[idx] || 0); }
    });
    const wastedFrac = dropCap > 0 ? dropFuel / dropCap : 0;

    // drop every still-attached part in the bottom stage (its engine + fuel)
    const droppedNow = stages[0].idxs.slice();
    if (!droppedNow.length) return false;
    droppedNow.forEach(i => { s.dropped[i] = true; });
    s.dropVersion = (s.dropVersion || 0) + 1;   // invalidate the stage cache

    // recompute physics stats from remaining parts (apply same upgrades)
    const next = recomputeStats(F.rocket, s.dropped);
    const upgN = (typeof Game !== 'undefined' && Game.getUpgrades) ? Game.getUpgrades() : {};
    if (upgN.lightweight) next.mass     *= (1 - 0.05 * upgN.lightweight);
    if (upgN.turbofuel)   next.thrust   *= (1 + 0.05 * upgN.turbofuel);
    if (upgN.efficient)   next.burnRate *= (1 - 0.08 * upgN.efficient);
    s.dryMass = next.mass;
    s.thrust = next.thrust;
    s.burnRate = next.burnRate;
    s.stability = next.stability;
    s.jank = next.jank;
    // the dropped stage's tanks leave with it; upper stages keep their fuel
    s.maxFuel = next.capacity;
    s.fuelMass = next.capacity * FUEL_MASS_PER_L;
    s.fuel = sumTankFuel(s);
    s.engines = s.engines.filter(e => !s.dropped[e.idx]);
    s.stagePrompted = false;   // re-arm the "stage dry" cue for the next stage

    // separation kick proportional to throttle (explosive bolts) — pushes the
    // vehicle along its own forward axis, so a tilted rocket gets a tilted nudge
    // instead of always shoving straight up in world space
    const kick = 5 + s.throttle * 6;
    const ax = -Math.sin(s.angle);
    const ay = -Math.cos(s.angle);
    s.vx += -ax * kick; // forward (= thrust) direction; equals world-up at angle 0
    s.vy += -ay * kick;

    // visual: spawn debris flying away from rocket bottom
    spawnStageDebris(s, droppedNow);
    spawnExplosion(s.x + ax * 1, s.y + ay * 1, 0.7);
    s.shake = Math.max(s.shake || 0, 0.4);
    s.stageCount++;
    // clean separation: dropped a near-empty stage → skill bonus (scales with
    // how many stages deep you are, so tall rockets reward good timing more)
    if (dropCap > 0 && wastedFrac <= 0.12) {
      const bonus = 30 * s.stageCount;
      s.stageBonus = (s.stageBonus || 0) + bonus;
      s.cleanStages = (s.cleanStages || 0) + 1;
      flashMsg('CLEAN SEPARATION +' + bonus);
    } else {
      flashMsg('STAGE ' + s.stageCount + ' DROP');
    }
    Sfx.play('explosion');
    return true;
  }

  function spawnStageDebris(s, indices) {
    // proper tumbling sprites for each dropped part — much more dramatic
    // than a particle burst because you can see the actual hardware fall away
    const ax = -Math.sin(s.angle);
    const ay = -Math.cos(s.angle);
    // we'll spread the dropped parts along the rocket's belly
    indices.forEach((idx, k) => {
      const partId = F.rocket.parts[idx];
      const part = Parts.byId(partId);
      if (!part) return;
      const offset = (k - indices.length / 2) * 0.4;
      F.droppedTanks.push({
        partId,
        x: s.x + ax * (1.5 + k * 0.3) + offset * Math.cos(s.angle),
        y: s.y + ay * (1.5 + k * 0.3) + offset * Math.sin(s.angle),
        vx: ax * (3 + Math.random() * 3) + (Math.random() - 0.5) * 4 + s.vx * 0.6,
        vy: ay * (5 + Math.random() * 3) + (Math.random() - 0.5) * 3 + s.vy * 0.6,
        angle: s.angle + (Math.random() - 0.5) * 0.4,
        angVel: (Math.random() - 0.5) * 6,
        life: 4.0,
        // engines that were still alive and burning go out spectacularly
        onFire: part.category === 'engine' && s.fuel > 0 && s.throttle > 0.2,
      });
      // companion smoke + sparks for the bolt-blow-off effect
      for (let j = 0; j < 4; j++) {
        F.particles.push({
          x: s.x + ax * 1.0,
          y: s.y + ay * 1.0,
          vx: (Math.random() - 0.5) * 8 + s.vx * 0.3,
          vy: (Math.random() - 0.5) * 8 + s.vy * 0.3,
          life: 0.4 + Math.random() * 0.3,
          color: '#ffeeaa',
          size: 2 + Math.random() * 2,
        });
      }
    });
  }

  // Once the tanks are dry the apogee — which drives every reward — is already
  // locked in, and the fall can take minutes with no throttle input possible.
  // Let the player collect their results instead of watching it. Descending
  // still earns combo and pickups, so this is opt-in rather than automatic.
  const WARP_STEPS = [1, 2, 4, 8];

  function cycleWarp() {
    const s = F.sim;
    if (!s || s.exiting) return;
    const i = WARP_STEPS.indexOf(s.warp || 1);
    s.warp = WARP_STEPS[(i + 1) % WARP_STEPS.length];
    flashMsg(s.warp === 1 ? 'REAL TIME' : 'TIME x' + s.warp);
  }

  // Warp is suppressed whenever the player has something to react to, so it can
  // never skip a decision: a sputtering engine (the throttle-cut window is only
  // ~1.6s), a tumble, or the moments around liftoff and the ground.
  function warpBlocked() {
    const s = F.sim;
    if (!s) return true;
    if (s.crashed || s.moonReached || s.exiting) return true;
    if (s.time < 3) return true;
    if (s.y * M_TO_FT < 1500) return true;                  // near the ground
    if (s.engines.some(e => e.alive && e.sputterT > 0)) return true;
    const w = Math.atan2(Math.sin(s.angle), Math.cos(s.angle));
    if (Math.abs(w) > 1.2) return true;                     // attitude needs attention
    return false;
  }

  function effectiveWarp() {
    const s = F.sim;
    if (!s) return 1;
    return warpBlocked() ? 1 : (s.warp || 1);
  }

  function canRecover() {
    const s = F.sim;
    return !!s && !s.crashed && !s.moonReached && !s.exiting && s.fuel <= 0 && s.time > 2;
  }

  function endFlight() {
    if (!canRecover()) return false;
    const s = F.sim;
    s.crashed = true;
    s.crashReason = s.maxAltitudeM > 3 ? 'RECOVERED' : 'SCRUBBED';
    flashMsg('FLIGHT ENDED');
    return true;
  }

  function canStage() {
    if (!F.sim) return false;
    // can stage when a bottom stage can be dropped while an upper stage keeps an engine
    const stages = currentStages(F.sim);
    return stages.length >= 2 && stages.slice(1).some(st => st.engineCount > 0);
  }

  // ---- main loop ------------------------------------------------------------
  function loop(Game, t) {
    if (Game.currentScreen !== 'flight') {
      exit();
      return;
    }
    let dt = (t - F.lastT) / 1000;
    F.lastT = t;
    if (dt > 0.05) dt = 0.05;

    // Time acceleration. A moonshot runs 7-14 minutes of real time and a
    // deep-space attempt over 20, most of it coasting with no input to give.
    // Extra physics steps at the SAME dt keep the simulation identical — this
    // only spends less wall-clock on it, it does not change the flight.
    const warp = effectiveWarp();
    for (let i = 0; i < warp; i++) {
      update(dt, Game);
      if (F.sim.crashed || F.sim.moonReached) break;   // don't overshoot the end
    }
    render(dt);
    updateHud();

    if ((F.sim.crashed || F.sim.moonReached) && !F.sim.exiting) {
      F.sim.exiting = true;
      setTimeout(() => {
        if (Game.currentScreen !== 'flight') return;
        const result = buildResult();
        exit();
        Game.applyResult(result);
      }, 1500);
    }

    F.raf = requestAnimationFrame(loop.bind(null, Game));
  }

  function buildResult() {
    const altitudeFt = Math.max(0, Math.floor(F.sim.maxAltitudeM * M_TO_FT));
    return {
      altitude: altitudeFt,
      success: F.sim.moonReached === true || altitudeFt >= MOON_ALTITUDE_FT,
      crashReason: F.sim.crashReason,
      time: F.sim.time,
      milestoneBonus: F.sim.milestoneScrapBonus || 0,
      comboBonus: F.sim.comboBonus || 0,
      stageCount: F.sim.stageCount || 0,
      stageBonus: F.sim.stageBonus || 0,
      cleanStages: F.sim.cleanStages || 0,
      pickupScrap: F.sim.pickupScrap || 0,
      pickupData: F.sim.pickupData || 0,
      pickupCount: F.sim.pickupCount || 0,
      modifierId: F.sim.modifier ? F.sim.modifier.id : 'calm',
      modifierLabel: F.sim.modifier ? F.sim.modifier.label : 'CALM',
      modifierScrapMul: F.sim.modifier ? F.sim.modifier.scrapMul : 1.0,
      // telemetry for the post-flight analysis line
      fuelLeftPct: F.sim.maxFuel > 0 ? F.sim.fuel / F.sim.maxFuel : 0,
      hullLeftPct: F.sim.maxHull > 0 ? Math.max(0, F.sim.hull) / F.sim.maxHull : 0,
      stagesLeft: Math.max(0, currentStages(F.sim).length - 1),
      tumbleDeath: !!F.sim.tumbling,
    };
  }

  // ---- update ---------------------------------------------------------------
  function update(dt, Game) {
    const s = F.sim;
    if (s.exiting) {
      // freeze physics, still animate particles + message
      F.particles.forEach(p => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= GRAVITY * 0.3 * dt;
        p.life -= dt;
      });
      F.particles = F.particles.filter(p => p.life > 0);
      if (F.msgT > 0) F.msgT -= dt;
      Sfx.setEngineIntensity(0);
      return;
    }

    s.time += dt;

    // controls — near-instant throttle response so holding feels right.
    // (the old smoothing felt sluggish, masking the held-thrust acceleration.)
    const throttleTarget = (F.keys.thrust || F.touch.thrust) ? 1 : 0;
    const prev = s.throttle;
    s.throttle += (throttleTarget - s.throttle) * Math.min(1, dt * 40);
    // first-ignition kick — fires exactly once per flight, the instant
    // throttle starts ramping up.
    if (!s.firstIgnitionDone && prev < 0.05 && s.throttle >= 0.05 && s.fuel > 0) {
      s.firstIgnitionDone = true;
      const ax = -Math.sin(s.angle), ay = -Math.cos(s.angle);
      s.vy += -ay * 6;
      s.vx += -ax * 6;
      s.shake = Math.max(s.shake || 0, 0.4);
      flashMsg('IGNITION');
    }
    // continuous engine rumble while burning
    if (s.throttle > 0.15 && s.fuel > 0) {
      s.rumble = Math.min(0.18, (s.rumble || 0) + dt * 0.5);
    } else {
      s.rumble = Math.max(0, (s.rumble || 0) - dt * 0.8);
    }

    const steerL = F.keys.left || F.touch.left;
    const steerR = F.keys.right || F.touch.right;

    // Engine breakage. Failures used to fire instantly with no warning — across
    // 18 identical test flights 78% suffered one, the earliest at T+2.1s, which
    // simply ended the run through luck alone. Jank is the game's identity, so
    // the odds are unchanged; instead a doomed engine now SPUTTERS first, giving
    // a window to stage it away (or spend a repair) before it lets go.
    s.engines.forEach(eng => {
      if (!eng.alive) return;
      const part = Parts.byId(eng.pid);
      if (!part) return;

      if (eng.sputterT > 0) {
        // Universal counterplay: an over-stressed engine recovers if you ease
        // off. Staging the failure away only works when it is in the bottom
        // stage, so without this an upper-stage failure had no answer at all.
        // The cost is real — you give up thrust and altitude to save the engine.
        if (s.throttle <= 0.1) {
          eng.recoverT = (eng.recoverT || 0) + dt;
          if (eng.recoverT >= 0.8) {
            eng.sputterT = 0;
            eng.recoverT = 0;
            flashMsg(part.name.toUpperCase() + ' RECOVERED');
            return;
          }
          return;                       // under no load the failure does not progress
        }
        eng.recoverT = 0;               // back on the throttle and it keeps dying
        eng.sputterT -= dt;
        // cough smoke out of the failing bell so it reads visually, not just as text
        if (Math.random() < 0.4) {
          const ex = -Math.sin(s.angle), ey = -Math.cos(s.angle);
          F.particles.push({
            x: s.x + ex * 1.2 + (Math.random() - 0.5) * 0.6,
            y: s.y + ey * 1.2 + (Math.random() - 0.5) * 0.6,
            vx: (Math.random() - 0.5) * 5 + s.vx * 0.3,
            vy: (Math.random() - 0.5) * 5 + s.vy * 0.3,
            life: 0.5 + Math.random() * 0.4,
            color: Math.random() < 0.5 ? '#555555' : '#ffaa44',
            size: 2 + Math.random() * 2,
          });
        }
        if (eng.sputterT <= 0) {
          eng.alive = false;
          flashMsg(part.catastrophic ? 'CORE MELTDOWN' : (part.name + ' FAILED'));
          spawnExplosion(s.x, s.y - 0.5, part.catastrophic ? 1.5 : 0.6);
          if (part.catastrophic) s.hull -= 200;
          else s.hull -= 10;
          s.shake = Math.max(s.shake || 0, part.catastrophic ? 0.9 : 0.5);
          s.flash = Math.max(s.flash || 0, part.catastrophic ? 0.9 : 0.4);
          s.flashColor = part.catastrophic ? '#ff3333' : '#ffaa44';
        }
        return;
      }

      if (s.throttle > 0.1 && Math.random() < part.breakChance * dt * (s.breakFactor || 1)) {
        // a catastrophic core gets a shorter fuse — it is meant to be scary
        eng.sputterT = part.catastrophic ? 0.9 : 1.6;
        flashMsg('⚠ ' + part.name.toUpperCase() + ' SPUTTERING');
        s.shake = Math.max(s.shake || 0, 0.25);
        Sfx.play('explosion');
      }
    });

    const liveThrust = s.engines.reduce((sum, eng) => {
      if (!eng.alive) return sum;
      const p = Parts.byId(eng.pid);
      let t = p.thrust;
      if (p.thrustVariance) {
        t *= 1 + (Math.random() * 2 - 1) * p.thrustVariance;
      }
      // a sputtering engine coughs — thrust drops and stutters while it dies,
      // so the warning is felt in the controls, not just read in the HUD
      if (eng.sputterT > 0) t *= 0.35 + Math.random() * 0.3;
      return sum + t;
    }, 0);

    // fuel
    const burningEngines = s.engines.filter(e => e.alive).length;
    if (s.throttle > 0.05 && s.fuel > 0 && burningEngines > 0) {
      const burn = s.burnRate * s.throttle * dt;
      drainFuel(s, burn); // lowest attached tank first (bottom stage burns first)
    }

    if (s.fuel <= 0) s.throttle = 0;

    // stage-timing cue: once the bottom tank runs dry it's pure dead weight, and
    // dropping it before the coast is worth a big apogee gain — but the player
    // can't see per-tank levels, so nudge them exactly once when it empties
    if (!s.stagePrompted && bottomStageDry(s) && canStage()) {
      flashMsg('BOTTOM STAGE DRY — STAGE (S)');
      s.stagePrompted = true;
    }

    // mass (decreases with fuel) — guard divide-by-zero after staging the
    // last fuel tank: when capacity hits 0 there's no fuel mass to add.
    const fuelFraction = s.maxFuel > 0 ? (s.fuel / s.maxFuel) : 0;
    const mass = Math.max(0.01, s.dryMass + fuelFraction * s.fuelMass);

    // accelerations
    const aThrustMag = (liveThrust * (s.thrustMul || 1) * THRUST_GAIN / mass) * s.throttle * (s.fuel > 0 ? 1 : 0);
    const ax = aThrustMag * Math.sin(s.angle);
    const ayThrust = aThrustMag * Math.cos(s.angle);

    // drag (atmospheric, falls off with altitude)
    const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    const altKm = s.y / 1000;
    const airDensity = Math.max(0, 1 - altKm / 80); // zero at ~80km
    const dragCoef = 0.0015 * airDensity;
    const dragX = -dragCoef * s.vx * speed;
    const dragY = -dragCoef * s.vy * speed;

    s.vx += (ax + dragX) * dt;
    s.vy += (ayThrust - GRAVITY + dragY) * dt;

    // angular dynamics — snappier so dodging actually works
    const controlAuth = 2.4 + (s.stability / 100) * 2.6;
    if (steerL) s.angVel -= controlAuth * dt;
    if (steerR) s.angVel += controlAuth * dt;

    // stabilizing torque drives angle toward 0 (when atmosphere helps)
    const stabTorque = -Math.sin(s.angle) * (0.3 + s.stability / 200) * (0.3 + airDensity);
    s.angVel += stabTorque * dt;

    // jank wobble noise
    if (s.throttle > 0.1) {
      s.angVel += (Math.random() - 0.5) * (s.jank / 100) * 0.4 * dt;
    }

    // damping
    s.angVel *= Math.pow(0.92, dt * 60);
    s.angle += s.angVel * dt;

    // pos
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.y > s.maxAltitudeM) s.maxAltitudeM = s.y;

    // hazards
    updateHazards(dt, s);

    // wind shear in mid atmosphere — scales with weather modifier
    const altFt = s.y * M_TO_FT;
    if (altFt > 2000 && altFt < 15000) {
      const band = Math.floor(altFt / 500);
      const dir = ((band * 31) % 7) - 3; // -3..3
      s.vx += dir * 0.3 * s.modifier.windMul * dt;
    }

    // tailwind modifier: free upward push while atmosphere thick
    if (s.modifier.tailwind > 0 && airDensity > 0.05) {
      s.vy += s.modifier.tailwind * airDensity * 0.6 * dt;
    }

    // altitude milestones
    s.milestones.forEach(m => {
      if (!m.hit && altFt >= m.ft) {
        m.hit = true;
        s.milestoneScrapBonus += m.bonus;
        flashMsg(m.label + '  +' + m.bonus);
        s.flash = 0.6;
        s.flashColor = m.ft >= 1000000 ? '#88ff88' : (m.ft >= 100000 ? '#ffcc33' : '#ffffff');
        s.shake = Math.max(s.shake || 0, 0.25);
        Sfx.play('snap');
      }
    });

    // apex ghost line crossing — fanfare when we beat our previous best
    if (Game.state && !s.apexCrossed && s.maxAltitudeM > 0) {
      const bestM = (Game.state.bestAltitude || 0) / M_TO_FT;
      if (bestM > 50 && s.y >= bestM) {
        s.apexCrossed = true;
        flashMsg('NEW RECORD');
        s.flash = 0.8;
        s.flashColor = '#ffcc33';
        Sfx.play('win');
      }
    }

    // combo decay
    if (s.combo > 0) {
      s.comboT -= dt;
      if (s.comboT <= 0) s.combo = 0;
    }

    // weather mood flashes — gentle, atmospheric, not gameplay
    if (s.modifier && s.modifier.id === 'storm' && altFt > 1500 && altFt < 35000) {
      // distant lightning sheet flash every few seconds
      if (Math.random() < dt * 0.18) {
        s.flash = Math.max(s.flash || 0, 0.45);
        s.flashColor = '#dde6ff';
      }
    }
    if (s.modifier && s.modifier.id === 'aurora' && altFt > 80000) {
      // gentle aurora pulse very rarely
      if (Math.random() < dt * 0.03) {
        s.flash = Math.max(s.flash || 0, 0.18);
        s.flashColor = '#88ffcc';
      }
    }

    // shake + flash decay
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 1.6);
    if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 1.2);
    // shield burst countdown
    if (s.shieldT > 0) s.shieldT = Math.max(0, s.shieldT - dt);

    // collision: ground
    if (s.y < 0 && s.vy < 0) {
      s.y = 0;
      if (s.vy < -8) {
        s.hull = 0;
        s.crashReason = 'HARD LANDING';
      } else if (Math.abs(s.angle) > 0.5) {
        s.hull = 0;
        s.crashReason = 'TIPPED OVER';
      } else {
        // soft landing while stationary — only ok before launch
        s.vy = 0;
      }
    }

    // Terminal state for a vehicle at rest on the ground with nothing left to
    // burn. `crashed` is otherwise only set by hull loss, so a gentle touchdown
    // — or a rocket that never lifted off at all (Builder.validate admits any
    // TWR >= 0.5, but you need > 1.0 to beat gravity) — would sit here forever:
    // no result screen and no abort button, forcing a page reload.
    if (!s.crashed && !s.moonReached && s.y <= 0 && s.fuel <= 0 &&
        Math.abs(s.vy) < 0.5 && s.time > 3) {
      s.crashed = true;
      s.crashReason = s.maxAltitudeM > 3 ? 'LANDED' : 'NEVER LEFT THE PAD';
    }

    // tumbling check — compare the WRAPPED angle. s.angle accumulates without
    // normalization, so a completed 360 roll (angle = 2pi) renders upright yet
    // would otherwise count as tumbling forever and drain hull to death.
    const wrappedAngle = Math.atan2(Math.sin(s.angle), Math.cos(s.angle));
    if (Math.abs(wrappedAngle) > 2.5 && altFt > 200) {
      s.hull -= 30 * dt;
      if (!s.tumbling) {
        flashMsg('TUMBLING!');
        s.tumbling = true;
      }
    } else {
      s.tumbling = false;   // re-arm the cue once the player recovers
    }

    // hull check
    if (s.hull <= 0 && !s.crashed) {
      s.crashed = true;
      s.crashReason = s.crashReason || 'STRUCTURAL FAILURE';
      flashMsg('KABOOM');
      explodeRocket(s);
      Sfx.play('explosion');
    }

    // Moon check. The first moonshot ends the flight — that is the win, and it
    // should land as a moment. Afterwards the moon becomes a waypoint you fly
    // straight past, otherwise the deep-space objectives beyond it could never
    // be reached: the run would always stop dead at 1,000,000 ft.
    if (s.y >= MOON_ALTITUDE_M && !s.passedMoon) {
      s.passedMoon = true;
      flashMsg(s.moonEndsFlight ? 'MOON REACHED!' : 'MOON — PRESSING ON');
      Sfx.play('win');
      if (s.moonEndsFlight) s.moonReached = true;
    }

    // out of fuel + falling far below max → end
    if (s.fuel <= 0 && s.vy < -5 && altFt < s.maxAltitudeM * M_TO_FT - 1000 && altFt < 200) {
      // falling back to ground; let it crash naturally
    }

    // particles
    F.particles.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= GRAVITY * 0.3 * dt;
      p.life -= dt;
    });
    F.particles = F.particles.filter(p => p.life > 0);

    // dropped fuel tanks tumble & fall
    F.droppedTanks.forEach(d => {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy -= GRAVITY * dt;
      d.angle += d.angVel * dt;
      d.life -= dt;
      // sputter trail if it was burning when dropped
      if (d.onFire && d.life > 1.5 && Math.random() < 0.3) {
        F.particles.push({
          x: d.x, y: d.y,
          vx: (Math.random() - 0.5) * 4 + d.vx * 0.3,
          vy: (Math.random() - 0.5) * 4 + d.vy * 0.3,
          life: 0.5,
          color: '#ff7733',
          size: 3,
        });
      }
    });
    F.droppedTanks = F.droppedTanks.filter(d => d.life > 0 && (d.y - F.sim.y) > -80);

    // mission elapsed time clock
    s.met += dt;

    // gimbal: tilt visible thrust vector opposite the steering input
    const steerLcheck = F.keys.left || F.touch.left;
    const steerRcheck = F.keys.right || F.touch.right;
    const gimbalTarget = steerLcheck ? -0.28 : (steerRcheck ? 0.28 : 0);
    s.gimbal += (gimbalTarget - s.gimbal) * Math.min(1, dt * 14);

    // sonic boom — once when crossing ~340 m/s in atmosphere
    const altKmSonic = s.y / 1000;
    const airDensSonic = Math.max(0, 1 - altKmSonic / 80);
    const speedTotal = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (!s.sonicBoomDone && speedTotal > 340 && airDensSonic > 0.1) {
      s.sonicBoomDone = true;
      spawnSonicBoom(s);
      flashMsg('MACH 1');
      if (typeof Game !== 'undefined' && Game.unlockAchievement) Game.unlockAchievement('mach_1');
    }
    // track highest combo + mach lifetime stats — skipped in sandbox, which
    // runs with maxed upgrades and free consumables and so must not write
    // permanent records (applyResult likewise skips all stats for sandbox)
    if (typeof Game !== 'undefined' && Game.state && Game.state.stats && !Game.sandbox) {
      if (s.combo > (Game.state.stats.highestCombo || 0)) {
        Game.state.stats.highestCombo = s.combo;
      }
      const mach = speedTotal / 343;
      if (mach > (Game.state.stats.highestMach || 0)) {
        Game.state.stats.highestMach = mach;
      }
      // combo achievements fire as soon as the threshold hits
      if (s.combo >= 5)  Game.unlockAchievement('combo_5');
      if (s.combo >= 10) Game.unlockAchievement('combo_10');
    }

    // satellites drift across at high altitude
    updateSatellites(dt, F.sim);

    // decorative comets streak through high-altitude views
    updateComets(dt, F.sim);

    // hot air balloons drift at 1.5k-8k ft
    updateBalloons(dt, F.sim);

    // ambient NPC rockets cross the sky
    updateNpcRockets(dt, F.sim);

    // rain droplets during THUNDERSTORM weather while in atmosphere
    updateRain(dt, F.sim);

    // collectible pickups: reason to maneuver mid-flight
    updatePickups(dt, F.sim);

    // contrail: stamp rocket position every ~50ms while burning, then age out
    if (s.throttle > 0.1 && s.fuel > 0) {
      s.contrailT = (s.contrailT || 0) + dt;
      if (s.contrailT > 0.05) {
        F.contrail.push({ x: s.x, y: s.y, t: 0, atmosphere: s.y / 1000 < 25 });
        s.contrailT = 0;
      }
    }
    F.contrail.forEach(p => p.t += dt);
    F.contrail = F.contrail.filter(p => p.t < 6);

    // first-ignition launch shockwave: dust + ring once at liftoff
    const altFtNow = s.y * M_TO_FT;
    if (!s.launchShockwaveDone && s.throttle > 0.5 && altFtNow < 60 && s.fuel > 0) {
      s.launchShockwaveDone = true;
      spawnLaunchShockwave(s);
      s.shake = Math.max(s.shake || 0, 0.7);
    }

    // exhaust particles — layered: hot core sparks + outer glow + smoke trail
    if (s.throttle > 0.1 && s.fuel > 0 && burningEngines > 0) {
      // gimbal angles the exhaust away from straight-down so steering reads
      const exitAngle = s.angle + s.gimbal;
      const ex = -Math.sin(exitAngle), ey = -Math.cos(exitAngle);
      const colorPart = Parts.byId(s.engines.find(e => e.alive)?.pid);
      const flame = colorPart?.flameColor || '#ffcc33';
      // hot sparks
      for (let i = 0; i < 3; i++) {
        F.particles.push({
          x: s.x + ex * 0.6 + (Math.random() - 0.5) * 0.4,
          y: s.y + ey * 0.6 + (Math.random() - 0.5) * 0.4,
          vx: ex * (10 + Math.random() * 6) + s.vx * 0.3 + (Math.random() - 0.5) * 2,
          vy: ey * (10 + Math.random() * 6) + s.vy * 0.3 + (Math.random() - 0.5) * 2,
          life: 0.3 + Math.random() * 0.2,
          color: i === 0 ? '#ffffff' : flame,
          size: 2 + Math.random() * 2,
        });
      }
      // smoke trail (low altitude only — vacuum has no smoke)
      const altKm = s.y / 1000;
      const smokeAir = Math.max(0, 1 - altKm / 30);
      if (smokeAir > 0 && Math.random() < 0.7) {
        F.particles.push({
          x: s.x + ex * 1.2 + (Math.random() - 0.5) * 0.5,
          y: s.y + ey * 1.2 + (Math.random() - 0.5) * 0.5,
          vx: ex * 2 + (Math.random() - 0.5) * 1,
          vy: ey * 2 + (Math.random() - 0.5) * 1,
          life: 1.2 + Math.random() * 0.8,
          color: '#888888',
          size: 4 + Math.random() * 4,
          smoke: true,
        });
      }
    }

    if (F.msgT > 0) F.msgT -= dt;

    // engine sound intensity
    Sfx.setEngineIntensity(s.throttle * (s.fuel > 0 ? 1 : 0));
  }

  function flashMsg(m) { F.msg = m; F.msgT = 1.6; }

  // The rocket dying: every still-attached part is launched outward as a
  // tumbling sprite with its own mini-explosion. Then a big central blast
  // and a long-lingering smoke cloud over the wreckage. Much more dramatic
  // than just a particle burst.
  function explodeRocket(s) {
    const rocket = F.rocket;
    if (!rocket) return;
    // map of which parts are still attached at moment of death
    let halfH = 0;
    rocket.parts.forEach((pid, i) => {
      if (s.dropped && s.dropped[i]) return;
      const p = Parts.byId(pid);
      if (p) halfH += p.height;
    });
    halfH = halfH * STACK_SCALE / 2;

    // walk the stack and eject each attached part
    let cursor = halfH;
    rocket.parts.forEach((pid, i) => {
      if (s.dropped && s.dropped[i]) return;
      const p = Parts.byId(pid);
      if (!p) return;
      const partCenterY = cursor - (p.height * STACK_SCALE) / 2;
      cursor -= p.height * STACK_SCALE;

      // world position of this part's center, accounting for rocket rotation
      const cosA = Math.cos(s.angle), sinA = Math.sin(s.angle);
      // local (0, partCenterY) → world delta is rotated; STACK_SCALE→m via /(STACK_SCALE*PIXEL_PER_M_BASE)
      const localY = partCenterY / (STACK_SCALE * 4); // approximate sprite px → world m
      const wx = s.x + localY * sinA * -1; // upward in rocket frame
      const wy = s.y + localY * cosA;

      // outward radial direction from rocket center plus extra random scatter
      const outAng = Math.atan2(wy - s.y, wx - s.x) + (Math.random() - 0.5) * 0.5;
      const outSp = 6 + Math.random() * 8;

      F.droppedTanks.push({
        partId: pid,
        x: wx, y: wy,
        vx: Math.cos(outAng) * outSp + s.vx * 0.5 + (Math.random() - 0.5) * 4,
        vy: Math.sin(outAng) * outSp + s.vy * 0.5 + 4 + Math.random() * 4,
        angle: s.angle + (Math.random() - 0.5) * 0.8,
        angVel: (Math.random() - 0.5) * 12,
        life: 3.5 + Math.random() * 1.5,
        // engines that were burning at death go out trailing flame
        onFire: p.category === 'engine' && (s.fuel > 0 || Math.random() < 0.5),
      });

      // mini-explosion at this part's location
      spawnExplosion(wx, wy, 0.5 + Math.random() * 0.4);
      // mark dropped so the rocket sprite stops drawing this part
      s.dropped = s.dropped || {};
      s.dropped[i] = true;
      s.dropVersion = (s.dropVersion || 0) + 1;
    });
    // also eject the nose cone as a flying chunk
    F.droppedTanks.push({
      partId: '__nose',
      x: s.x, y: s.y + halfH / 4,
      vx: (Math.random() - 0.5) * 8 + s.vx * 0.5,
      vy: 5 + Math.random() * 6 + s.vy * 0.5,
      angle: (Math.random() - 0.5) * 0.6,
      angVel: (Math.random() - 0.5) * 10,
      life: 3.0,
      onFire: false,
    });

    // gigantic central shockwave + cloud
    spawnExplosion(s.x, s.y, 4);
    // extra ring shockwave (white/blue)
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const sp = 26 + Math.random() * 4;
      F.particles.push({
        x: s.x, y: s.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5,
        color: i % 2 === 0 ? '#ffffff' : '#ddeeff',
        size: 4,
      });
    }
    // lingering pall of smoke
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 5;
      F.particles.push({
        x: s.x, y: s.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1,
        life: 2.5 + Math.random() * 1.5,
        color: ['#3a3a3a', '#555', '#777', '#222'][i % 4],
        size: 6 + Math.random() * 5,
        smoke: true,
      });
    }
    // big shake
    s.shake = Math.max(s.shake || 0, 1.0);
    s.flash = Math.max(s.flash || 0, 0.8);
    s.flashColor = '#ff7733';
  }

  function spawnExplosion(x, y, scale) {
    // shockwave ring (a few short-lived bright particles in a circle)
    const ringN = Math.floor(18 * scale);
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2;
      const sp = 18 + Math.random() * 4 * scale;
      F.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.25,
        color: '#ffffff',
        size: 3,
      });
    }
    // hot inner burst
    const n = Math.floor(28 * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 14 * scale;
      F.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.8,
        color: ['#ffcc33', '#ff5511', '#ff7733', '#ffffff', '#ffaa22'][i % 5],
        size: 2 + Math.random() * 4,
      });
    }
    // smoke cloud (lingers)
    const smokeN = Math.floor(14 * scale);
    for (let i = 0; i < smokeN; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      F.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1,
        life: 1.4 + Math.random() * 0.8,
        color: i % 3 === 0 ? '#444444' : '#777777',
        size: 4 + Math.random() * 4,
        smoke: true,
      });
    }
    // chunky debris fragments
    const debN = Math.floor(6 * scale);
    for (let i = 0; i < debN; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 8;
      F.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1.0 + Math.random() * 0.6,
        color: ['#888', '#555', '#aaa'][i % 3],
        size: 3 + Math.random() * 3,
      });
    }
  }

  // ---- hazards --------------------------------------------------------------
  function updateHazards(dt, s) {
    const altFt = s.y * M_TO_FT;

    // spawn check (modifier scales)
    let rate = spawnRate(altFt);
    const mod = s.modifier;
    if (mod) {
      // Different modifiers boost different hazard types — applied in pickHazardType
      rate *= 1.0;
    }
    if (Math.random() < dt * rate) {
      const type = pickHazardType(altFt, mod);
      if (type) F.hazards.push(makeHazard(type, s));
    }

    F.hazards.forEach(h => {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.t += dt;

      // Track the CLOSEST approach each frame. The combo check used to measure
      // distance in the GC filter — i.e. at the moment a hazard is removed for
      // being far away — so a genuine near miss was almost never detected.
      const ndx = h.x - s.x, ndy = h.y - s.y;
      const nd2 = ndx * ndx + ndy * ndy;
      if (h.minD2 === undefined || nd2 < h.minD2) h.minD2 = nd2;

      // lightning telegraphs for ~0.8s before activating, then dies after dieAt
      if (h.type === 'lightning' && !h.armed && h.t > h.telegraph) {
        h.armed = true;
      }
      if (h.dieAt && h.t > h.dieAt) h.dead = true;

      // collision: simple radius. Lightning only damages while armed (the strike window).
      if (h.type !== 'lightning' || h.armed) {
        const dx = h.x - s.x, dy = h.y - s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < (h.radius + 0.6) * (h.radius + 0.6) && !h.dead) {
          // shield deflects damage entirely
          const deflected = (s.shieldT || 0) > 0;
          if (deflected) {
            // deflect particles in the bounce direction
            const ang = Math.atan2(dy, dx) + Math.PI;
            for (let k = 0; k < 8; k++) {
              const a = ang + (Math.random() - 0.5) * 1.0;
              F.particles.push({
                x: s.x, y: s.y,
                vx: Math.cos(a) * 8, vy: Math.sin(a) * 8,
                life: 0.4, color: '#aaccff', size: 2,
              });
            }
            h.dead = true;
            h.hit = true;
            flashMsg('DEFLECTED');
            Sfx.play('snap');
            return; // skip the rest of this hazard's collision handling
          }
          if (h.type === 'bird') s.hull -= 12;
          if (h.type === 'lightning') s.hull -= 25;
          if (h.type === 'debris') s.hull -= 30;
          spawnExplosion(s.x, s.y, 0.6);
          // directional sparks ricocheting off the rocket where the hazard hit
          const ang = Math.atan2(dy, dx) + Math.PI; // away from hazard
          for (let k = 0; k < 14; k++) {
            const a = ang + (Math.random() - 0.5) * 1.6;
            const sp = 6 + Math.random() * 10;
            F.particles.push({
              x: s.x, y: s.y,
              vx: Math.cos(a) * sp + s.vx * 0.4,
              vy: Math.sin(a) * sp + s.vy * 0.4,
              life: 0.35 + Math.random() * 0.3,
              color: k % 3 === 0 ? '#ffffff' : '#ffcc44',
              size: 2 + Math.random() * 2,
            });
          }
          h.dead = true;
          h.hit = true;
          // any hit resets combo
          s.combo = 0;
          flashMsg(h.type.toUpperCase() + ' STRIKE');
          s.shake = Math.max(s.shake || 0, 0.5);
          s.flash = Math.max(s.flash || 0, 0.5);
          s.flashColor = '#ff5577';
        }
      }
    });

    // garbage collect & combo: hazards passing within close range without hitting
    F.hazards = F.hazards.filter(h => {
      // Scale the vertical cull window with speed. A fixed 30 m window culled
      // every hazard within ~0.2 s at flight speeds (100-300 m/s), long before
      // a laterally-approaching bird or debris could ever reach the rocket.
      const rangeY = 30 + Math.abs(s.vy) * 1.5;
      const farX = Math.abs(h.x - s.x) > 30;
      const farY = Math.abs(h.y - s.y) > rangeY;
      const expired = h.t > 6;
      const offscreen = farX || farY || expired;
      if ((h.dead || offscreen) && !h.counted) {
        h.counted = true;
        if (!h.hit && h.t > 0.4) {
          // close pass = combo, judged on closest approach over the hazard's life
          const d2 = h.minD2 !== undefined ? h.minD2 : Infinity;
          if (d2 < 25) {
            s.combo += 1;
            s.comboT = 3.0;
            const bonus = 5 * s.combo;
            s.comboBonus += bonus;
            flashMsg('CLOSE CALL  +' + bonus);
            Sfx.play('snap');
          }
        }
      }
      return !h.dead && !offscreen;
    });
  }

  function spawnRate(altFt) {
    if (altFt < 100) return 0;
    if (altFt < 2000) return 0.6;       // birds
    if (altFt < 15000) return 0.4;
    if (altFt < 30000) return 0.5;      // lightning band
    if (altFt < 100000) return 0.25;
    // The old 0.6/s here was the highest rate in the game, and it sits in the
    // band a moonshot must cross for minutes. That was survivable only while
    // hazards could never actually connect; once they did, sustained
    // high-altitude flight became impossible and capped real apogees near
    // 200k ft — five times short of the moon. Brought in line with the band below.
    if (altFt < 800000) return 0.22;    // debris
    return 0.18;
  }

  function pickHazardType(altFt, mod) {
    // weather modifiers shift the mix
    const lightningMul = mod ? mod.lightningMul : 1;
    const debrisMul = mod ? mod.debrisMul : 1;

    if (altFt < 2000) return 'bird';
    if (altFt < 30000) {
      // Lightning frequency was tuned back when bolts never actually armed, so
      // 40% of spawns here was harmless. Now that they connect, that rate meant
      // a 25-damage strike roughly every 5s even in CALM — measured 5 strikes
      // (125 damage vs ~110 hull) on an otherwise clean flight. Dropped to a
      // rare event; the weather multipliers still make storms genuinely deadly.
      // Birds are the fallback here, so simply cutting the lightning share would
      // have converted those spawns into birds (60% -> 88% of attempts) and
      // swapped one damage tax for another. Let some attempts yield nothing.
      const lProb = 0.12 * lightningMul;
      const r = Math.random();
      if (r < lProb) return 'lightning';
      if (r < lProb + 0.55) return 'bird';
      return null;
    }
    if (altFt < 80000) {
      const lProb = 0.1 * lightningMul;
      const dProb = 0.4 * debrisMul;
      const r = Math.random();
      if (r < lProb) return 'lightning';
      if (r < lProb + dProb) return 'debris';
      return null;
    }
    // High altitude: debris only. At 30 damage a strike this is the most lethal
    // hazard in the game, so it stays sparse — the weather multiplier (METEOR
    // SHOWER 3x) is what makes a debris field genuinely dangerous.
    return Math.random() < (0.3 * debrisMul) ? 'debris' : null;
  }

  function makeHazard(type, s) {
    const side = Math.random() < 0.5 ? -1 : 1;
    // Lateral hazards close at only 5-9 m/s from 28 m out, which takes 3-5 s.
    // Their vy is therefore expressed in the ROCKET's frame — a world-frame vy
    // near zero meant a rocket climbing at 100-300 m/s left every hazard behind
    // long before it could arrive, so nothing ever hit.
    if (type === 'bird') {
      return {
        type, x: s.x + side * 28 + (Math.random() - 0.5) * 4,
        y: s.y + (Math.random() - 0.3) * 14,
        vx: -side * (5 + Math.random() * 3),
        vy: s.vy + (Math.random() - 0.5) * 2,
        radius: 0.7, t: 0, dead: false, telegraph: 0,
      };
    }
    if (type === 'lightning') {
      // strike where the rocket WILL be in `lookahead` seconds — player dodges
      // by changing course mid-telegraph
      // Clamp the lead: at |vy| > 60 the raw lookahead put the bolt outside the
      // cull window on its very first frame, so it was deleted before arming —
      // lightning never struck at all, making the storm/aurora modifiers inert.
      const lookahead = 0.5;
      const lead = Math.max(-25, Math.min(25, s.vy * lookahead));
      return {
        type,
        x: s.x + s.vx * lookahead + (Math.random() - 0.5) * 4,
        y: s.y + lead,
        vx: 0, vy: 0,
        radius: 1.4,
        t: 0,
        dead: false,
        armed: false,
        // longer fuse so the strike is actually dodgeable: 0.5s was not enough
        // time to translate away from the bolt at flight speeds
        telegraph: 0.9,
        dieAt: 1.5,
      };
    }
    if (type === 'debris') {
      return {
        type, x: s.x + side * 28 + (Math.random() - 0.5) * 8,
        y: s.y + 6 + Math.random() * 18,
        vx: -side * (6 + Math.random() * 3),
        vy: s.vy - (2 + Math.random() * 4),
        radius: 0.9, t: 0, dead: false, telegraph: 0,
        spin: (Math.random() - 0.5) * 6,
      };
    }
    return null;
  }

  // ---- render ---------------------------------------------------------------
  function render(dt) {
    const ctx = F.ctx;
    const c = F.canvas;
    const W = c.clientWidth, H = c.clientHeight;
    const s = F.sim;
    const altFt = s.y * M_TO_FT;

    // screen shake (impacts) + rumble (continuous while burning)
    let shakeX = 0, shakeY = 0;
    const rumble = s.rumble || 0;
    let shakeAmp = (s.shake > 0 ? s.shake * 8 : 0) + rumble * 6;
    if (F.reducedMotion) shakeAmp *= 0.15;
    if (shakeAmp > 0) {
      shakeX = (Math.random() - 0.5) * shakeAmp;
      shakeY = (Math.random() - 0.5) * shakeAmp;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);

    // compute zoom up-front so any draw helper that wants ppm has it
    const speed = Math.abs(s.vy);
    const zoomT = Math.min(1, speed / 220);
    const ppm = PIXEL_PER_M_BASE - (PIXEL_PER_M_BASE - PIXEL_PER_M_MIN) * zoomT;
    s.lastPpm = ppm;
    const worldToScreen = (wx, wy) => {
      const sx = W / 2 + (wx - s.x) * ppm;
      const sy = H * 0.65 - (wy - s.y) * ppm;
      return [sx, sy];
    };

    // sky color stops
    const sky = skyGradient(ctx, W, H, altFt);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // sun — visible from atmosphere up to lower space; fades out high
    drawSun(ctx, W, H, altFt);

    // stars (visible above ~10,000 ft, fade in)
    const starAlpha = Math.min(1, Math.max(0, (altFt - 5000) / 30000));
    if (starAlpha > 0) {
      drawStars(ctx, W, H, starAlpha, s);
    }

    // aurora bands — only during AURORA weather, fades in at altitude
    if (s.modifier && s.modifier.id === 'aurora' && altFt > 25000) {
      drawAurora(ctx, W, H, s, altFt);
    }

    // distant clouds (low altitude) — multi-layer parallax cumulus
    if (altFt < 9000) drawClouds(ctx, W, H, altFt, s.x);

    // moon (visible above 200k ft, grows)
    if (altFt > 200000) drawMoon(ctx, W, H, altFt);

    // ground horizon (visible while low)
    if (altFt < 30000) drawHorizon(ctx, W, H, altFt, s.x);

    // mountains stacked in front of horizon
    if (altFt < 5500) drawMountains(ctx, W, H, altFt, s.x);

    // hot air balloons floating at low-mid altitude
    drawBalloons(ctx, worldToScreen);

    // ambient NPC rockets crossing in the distance
    drawNpcRockets(ctx, worldToScreen);

    // rain during thunderstorm
    drawRain(ctx, W, H);

    // pickups (collectibles) — drawn between hazards and rocket so they
    // visually pop above the world but the rocket overlaps when grabbing
    drawPickups(ctx, worldToScreen);

    // wind streaks blow across the atmosphere
    drawWindStreaks(ctx, W, H, altFt, s.modifier, s.time);

    // speed streaks — overlay above sky, below world objects
    drawSpeedStreaks(ctx, W, H, s);

    // apex ghost line — your previous best altitude as a horizontal target line
    drawApexGhost(ctx, W, H, s, worldToScreen);

    // hazards
    F.hazards.forEach(h => {
      const [hx, hy] = worldToScreen(h.x, h.y);
      drawHazard(ctx, h, hx, hy);
    });

    // particles — smoke billows + fades; sparks shrink as life ends
    F.particles.forEach(p => {
      const [px, py] = worldToScreen(p.x, p.y);
      if (p.smoke) {
        // expand + fade smoke
        const lifePct = Math.max(0, p.life / 1.6);
        const sz = p.size * (1 + (1 - lifePct) * 1.5);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = lifePct * 0.6;
        ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
        ctx.globalAlpha = 1;
      } else {
        const sz = Math.max(1, p.size * (p.life > 0.3 ? 1 : p.life * 3));
        ctx.fillStyle = p.color;
        ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
      }
    });

    // satellites drifting through space (behind hazards & rocket)
    drawSatellites(ctx, W, H, worldToScreen);

    // decorative comets in space
    drawComets(ctx, worldToScreen);

    // contrail trail behind the rocket — drawn before everything else
    // in front of the camera so it appears under exhaust + rocket
    drawContrail(ctx, worldToScreen);

    // dropped fuel-tank sprites tumbling away
    F.droppedTanks.forEach(d => drawDroppedTank(ctx, d, worldToScreen));

    // engine glow halo — additive blend, sits behind rocket but in front
    // of exhaust particles so the trail glows along its core
    drawEngineGlow(ctx, s, worldToScreen);

    // mach diamonds (visible shock pattern in supersonic exhaust at altitude)
    drawMachDiamonds(ctx, s, worldToScreen);

    // re-entry plasma envelope: when falling fast through atmosphere
    drawPlasma(ctx, s, worldToScreen);

    // heat shimmer below the bell at high throttle (in atmosphere)
    drawHeatShimmer(ctx, s, worldToScreen);

    // rocket
    const [rx, ry] = worldToScreen(s.x, s.y);
    drawRocket(ctx, rx, ry, s);

    // launch gantry + pad (visible while low)
    if (altFt < 1200) {
      drawGantry(ctx, W, H, altFt, worldToScreen);
    }

    // crash crater scar (after impact)
    drawCrater(ctx, s, worldToScreen);

    // cloud passthrough fog — opacity based on altitude vs cloud bands
    const fog = cloudFogAt(altFt);
    if (fog > 0.02) {
      ctx.fillStyle = 'rgba(245, 248, 252,' + fog + ')';
      ctx.fillRect(0, 0, W, H);
    }

    // altitude tick marks on the right edge
    drawAltitudeRail(ctx, W, H, s.y);

    ctx.restore();

    // stage ladder — fixed, unrotated readout of remaining stages + next drop
    drawStageIndicator(ctx, W, H, s);

    // attitude recovery prompt — tumbling is what actually ends most flights
    drawAttitudeWarning(ctx, W, H, s);

    // subtle CRT scanline overlay — sells the "mission control monitor" feel
    drawScanlines(ctx, W, H);

    // milestone / damage screen flash on top (suppressed under reduced motion)
    if (s.flash > 0 && !F.reducedMotion) {
      const a = Math.min(0.5, s.flash * 0.5);
      ctx.fillStyle = s.flashColor;
      ctx.globalAlpha = a;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // Tumbling drains 30 hull/s and ends most flights, yet recovery only takes
  // about a second of correct counter-steering — players just were not told
  // which way to steer, and the "TUMBLING!" toast fired once and vanished.
  // This shows a live attitude bar and the exact key to press.
  function drawAttitudeWarning(ctx, W, H, sim) {
    if (sim.exiting || sim.crashed) return;
    const w = Math.atan2(Math.sin(sim.angle), Math.cos(sim.angle));
    const off = Math.abs(w);
    if (off < 1.2) return;                       // upright enough — stay quiet
    const critical = off > 2.5;                  // this is the band that hurts

    // steer command: same PD rule that recovers in ~1s in testing.
    // left decreases angVel, right increases it.
    const ctl = -(w * 1.5) - (sim.angVel || 0) * 1.2;
    const goRight = ctl > 0;

    const cx = W / 2, y = H * 0.30;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // tilt bar: how far from upright, 0 (centre) to pi (ends)
    const barW = Math.min(260, W * 0.5), barH = 8;
    ctx.fillStyle = 'rgba(10,14,26,0.75)';
    ctx.fillRect(cx - barW / 2, y + 14, barW, barH);
    const frac = Math.min(1, off / Math.PI);
    ctx.fillStyle = critical ? 'rgba(255,70,70,0.95)' : 'rgba(255,180,60,0.9)';
    const mark = cx + (w < 0 ? -1 : 1) * (barW / 2) * frac;
    ctx.fillRect(Math.min(mark, cx), y + 14, Math.abs(mark - cx), barH);
    ctx.strokeStyle = 'rgba(220,230,250,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - barW / 2 + 0.5, y + 14.5, barW - 1, barH - 1);
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 1, y + 12, 2, barH + 4);   // upright marker

    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.fillStyle = critical ? '#ff6a6a' : '#ffc061';
    ctx.fillText(critical ? '⚠ TUMBLING — HULL BURNING' : 'ATTITUDE HIGH', cx, y - 6);

    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(goRight ? 'STEER  →  (D)' : 'STEER  ←  (A)', cx, y + 42);
    ctx.restore();
  }

  function drawStageIndicator(ctx, W, H, sim) {
    if (sim.exiting) return;
    const stages = currentStages(sim);
    if (stages.length < 2) return;          // single stage — nothing to show
    const n = stages.length;
    const segH = 20, gap = 3, segW = 30;
    const stackH = n * segH + (n - 1) * gap;
    const x = 16;
    const top = H * 0.5 - stackH / 2;       // vertically centered on the left
    ctx.save();
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    // title above the ladder
    ctx.fillStyle = 'rgba(200,215,245,0.8)';
    ctx.textAlign = 'left';
    ctx.fillText('STAGES', x, top - 11);
    // remaining-fuel fraction for a stage (sum of its tanks / their capacity)
    const stageFuelFrac = (stage) => {
      let have = 0, cap = 0;
      for (const idx of stage.idxs) {
        const p = Parts.byId(F.rocket.parts[idx]);
        if (p && p.category === 'fuel') { cap += p.capacity; have += (sim.tankFuel[idx] || 0); }
      }
      return cap > 0 ? have / cap : 0;
    };
    // stages[] is bottom→top; draw highest at the top of the ladder so STAGE 1
    // (the next to drop) sits at the bottom, matching the rocket above the pad
    for (let i = n - 1; i >= 0; i--) {
      const isNext = (i === 0);             // bottom stage drops next (active)
      const y = top + (n - 1 - i) * (segH + gap);
      const cy = y + segH / 2;
      const frac = stageFuelFrac(stages[i]);
      // empty tank body
      ctx.fillStyle = 'rgba(28,36,54,0.8)';
      ctx.fillRect(x, y, segW, segH);
      // fuel fill (left→right) — the active stage burns green→empty so you can
      // watch it drain and know exactly when dropping it is free
      if (frac > 0) {
        ctx.fillStyle = isNext ? 'rgba(120,225,140,0.92)' : 'rgba(110,140,200,0.75)';
        ctx.fillRect(x, y, Math.max(1, segW * frac), segH);
      } else if (isNext) {
        ctx.fillStyle = 'rgba(255,90,70,0.6)';   // active + empty = drop it now
        ctx.fillRect(x, y, segW, segH);
      }
      ctx.strokeStyle = isNext ? '#ffd0a0' : 'rgba(180,200,240,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, segW - 1, segH - 1);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText('S' + (i + 1), x + segW / 2, cy);
      if (isNext) {
        ctx.fillStyle = frac > 0 ? 'rgba(255,255,255,0.75)' : '#ffd0a0';
        ctx.textAlign = 'left';
        ctx.fillText(frac > 0 ? 'ACTIVE' : '▼ DROP (S)', x + segW + 6, cy);
      }
    }
    ctx.restore();
  }

  function drawGantry(ctx, W, H, altFt, worldToScreen) {
    const [padX, padY] = worldToScreen(0, 0);
    if (padY < 0 || padY > H + 200) return;
    // earth/soil under the pad fills the bottom of screen
    ctx.fillStyle = '#3a2614';
    ctx.fillRect(0, padY + 14, W, H - (padY + 14));
    ctx.fillStyle = '#5a3820';
    ctx.fillRect(0, padY + 14, W, 3);
    // grass tufts
    ctx.fillStyle = '#1f5d22';
    for (let i = 0; i < W; i += 14) {
      const h = 2 + ((i * 7) % 5);
      ctx.fillRect(i, padY + 14 - h, 2, h);
    }

    // concrete pad
    ctx.fillStyle = '#888';
    ctx.fillRect(padX - 90, padY + 10, 180, 6);
    ctx.fillStyle = '#666';
    ctx.fillRect(padX - 90, padY + 16, 180, 2);
    // scorch marks
    ctx.fillStyle = '#1f1612';
    ctx.fillRect(padX - 30, padY + 12, 60, 3);
    // pad bolts
    ctx.fillStyle = '#222';
    for (let i = -3; i <= 3; i++) ctx.fillRect(padX + i * 24 - 1, padY + 11, 2, 2);

    // gantry tower (steel scaffold) — only while still on/near pad
    if (altFt < 800) {
      const towerH = 160;
      const towerX = padX + 60;
      const fade = Math.max(0, 1 - altFt / 800);
      ctx.globalAlpha = 0.35 + fade * 0.65;
      // vertical members
      ctx.fillStyle = '#bb6622';
      ctx.fillRect(towerX, padY - towerH, 4, towerH + 14);
      ctx.fillRect(towerX + 24, padY - towerH, 4, towerH + 14);
      // horizontal cross-braces
      for (let i = 0; i <= 6; i++) {
        const yy = padY - (i * (towerH / 6));
        ctx.fillRect(towerX, yy, 28, 2);
        // diagonal brace
        ctx.fillStyle = '#883311';
        for (let k = 0; k < 12; k++) {
          ctx.fillRect(towerX + k * 2, yy - k - 2, 2, 1);
        }
        ctx.fillStyle = '#bb6622';
      }
      // service arm (bridge to rocket)
      const armY = padY - towerH * 0.6;
      ctx.fillRect(padX + 14, armY, 50, 3);
      ctx.fillRect(padX + 14, armY - 6, 4, 6);
      // antenna on top
      ctx.fillStyle = '#fff';
      ctx.fillRect(towerX + 12, padY - towerH - 14, 2, 14);
      ctx.fillStyle = '#cc2222';
      ctx.fillRect(towerX + 11, padY - towerH - 16, 4, 3);
      ctx.globalAlpha = 1;
    }

    // billowing launch smoke at the base while low and burning
    if (F.sim.throttle > 0.2 && altFt < 400) {
      const t = F.sim.time;
      ctx.fillStyle = 'rgba(220,220,220,0.45)';
      for (let i = 0; i < 6; i++) {
        const cx = padX + Math.sin(t * 1.2 + i) * 30 + i * 20 - 60;
        const r = 16 + Math.sin(t * 2 + i) * 4;
        ctx.fillRect(cx - r / 2, padY + 4 - r / 2, r, r);
      }
    }

    // pad sign
    if (altFt < 200) {
      ctx.fillStyle = '#ffcc33';
      ctx.fillRect(padX - 100, padY - 4, 18, 8);
      ctx.fillStyle = '#000';
      ctx.fillRect(padX - 99, padY - 3, 16, 1);
      ctx.fillRect(padX - 99, padY + 2, 16, 1);
      ctx.fillRect(padX - 96, padY - 1, 1, 3);
      ctx.fillRect(padX - 92, padY - 1, 2, 3);
      ctx.fillRect(padX - 88, padY - 1, 1, 3);
    }
  }

  function drawSpeedStreaks(ctx, W, H, s) {
    const speed = Math.abs(s.vy);
    const t = Math.max(0, Math.min(1, (speed - 35) / 200));
    if (t <= 0) return;
    const count = Math.floor(8 + t * 32);
    const rng = (n) => ((Math.sin(n * 91.7 + s.time * 0.4) + 1) * 0.5);
    ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.05 + t * 0.18) + ')';
    for (let i = 0; i < count; i++) {
      const x = (rng(i) * W);
      // streak length grows with speed; phase scrolls so they appear to fly past
      const phase = (s.time * (60 + speed * 0.6) + i * 53) % H;
      const yScreen = (phase) % H;
      const len = 6 + t * 24;
      ctx.fillRect(x, yScreen, 1, len);
    }
  }

  function drawApexGhost(ctx, W, H, s, worldToScreen) {
    if (!global.Game || !global.Game.state) return;
    const bestFt = global.Game.state.bestAltitude || 0;
    if (bestFt < 200) return; // not worth showing for first run
    const bestM = bestFt / M_TO_FT;
    const [, sy] = worldToScreen(0, bestM);
    if (sy < 30 || sy > H - 30) return;
    const dashLen = 12, gap = 8;
    ctx.fillStyle = 'rgba(255, 204, 51, 0.55)';
    for (let x = 0; x < W; x += dashLen + gap) {
      ctx.fillRect(x, sy, dashLen, 1);
    }
    ctx.fillStyle = 'rgba(255, 204, 51, 0.85)';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('▲ BEST ' + formatFt(bestFt), 8, sy - 4);
  }

  function skyGradient(ctx, W, H, altFt) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    if (altFt < 3000) {
      grad.addColorStop(0, '#7fb3ff');
      grad.addColorStop(1, '#cce0ff');
    } else if (altFt < 15000) {
      grad.addColorStop(0, '#3a4d7a');
      grad.addColorStop(1, '#7aa2cc');
    } else if (altFt < 50000) {
      grad.addColorStop(0, '#0e1430');
      grad.addColorStop(1, '#2a356a');
    } else if (altFt < 200000) {
      grad.addColorStop(0, '#020414');
      grad.addColorStop(1, '#0e1430');
    } else {
      grad.addColorStop(0, '#000005');
      grad.addColorStop(1, '#020414');
    }
    return grad;
  }

  function drawStars(ctx, W, H, alpha, s) {
    ctx.globalAlpha = alpha;
    F.stars.forEach(st => {
      const sx = (st.x - s.x * st.depth * 0.04 + 1000) % W;
      const sy = (st.y - s.y * st.depth * 0.04 + 5000) % H;
      const tw = (Math.sin((s.time * 1.4 + st.bright * 5)) + 1) * 0.5;
      // tint: slight blue/yellow/white variation
      let r = 255, g = 255, b = 255;
      if (st.tint < 0.25)      { r = 255; g = 240; b = 200; }   // warm
      else if (st.tint < 0.45) { r = 200; g = 220; b = 255; }   // cool
      // brightness from depth
      const bright = (0.35 + st.depth * 0.4 + tw * 0.3) * st.bright;
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + bright + ')';
      // size by depth (near stars are 2x2, far are 1x1)
      const sz = st.depth > 0.7 ? 2 : 1;
      ctx.fillRect(sx | 0, sy | 0, sz, sz);
      // 4-point sparkle on the brightest near stars
      if (st.depth > 0.85 && st.bright > 0.7 && tw > 0.6) {
        ctx.fillRect((sx | 0) - 1, sy | 0, 1, 1);
        ctx.fillRect((sx | 0) + 2, sy | 0, 1, 1);
        ctx.fillRect(sx | 0, (sy | 0) - 1, 1, 1);
        ctx.fillRect(sx | 0, (sy | 0) + 2, 1, 1);
      }
    });
    ctx.globalAlpha = 1;
  }

  // ---- Multi-layer parallax cumulus -----------------------------------------
  function drawClouds(ctx, W, H, altFt, x) {
    const layers = [
      { altMin: 0,    altMax: 4500, baseY: H * 0.55, parallax: 8, scale: 1.0, alpha: 0.85 },
      { altMin: 800,  altMax: 7000, baseY: H * 0.30, parallax: 4, scale: 0.7, alpha: 0.55 },
      { altMin: 2500, altMax: 9000, baseY: H * 0.10, parallax: 2, scale: 0.5, alpha: 0.40 },
    ];
    layers.forEach((layer, li) => {
      if (altFt < layer.altMin || altFt > layer.altMax) return;
      const fadeIn  = Math.min(1, (altFt - layer.altMin) / 600);
      const fadeOut = Math.min(1, (layer.altMax - altFt) / 1200);
      const fade = Math.max(0, Math.min(fadeIn, fadeOut));
      // baseline layer Y rises with altitude (clouds fall below us as we climb)
      const cloudY = layer.baseY + altFt * 0.05;
      for (let i = 0; i < 5; i++) {
        const seed = i * 100 + li * 50;
        const cx = ((seed * 173 - x * layer.parallax) % (W + 360) + W + 360) % (W + 360) - 180;
        const sc = layer.scale * (0.85 + ((seed * 37) % 30) / 100);
        drawCumulus(ctx, cx, cloudY + ((seed * 51) % 30) - 15, sc, fade * layer.alpha);
      }
    });
  }

  // pixel-art cumulus: bitmap shape with top-highlight + underside-shadow
  const CUMULUS_PATTERN = [
    "0001110011110000",
    "0011111111111000",
    "0111111111111110",
    "1111111111111111",
    "1111111111111111",
    "0111111111111110",
    "0011111111111000",
    "0000011110000000",
  ];
  function drawCumulus(ctx, cx, cy, scale, alpha) {
    const u = Math.max(2, Math.floor(4 * scale));
    ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
    for (let y = 0; y < CUMULUS_PATTERN.length; y++) {
      for (let x = 0; x < CUMULUS_PATTERN[y].length; x++) {
        if (CUMULUS_PATTERN[y][x] === '1') {
          ctx.fillRect(cx + x * u, cy + y * u, u, u);
        }
      }
    }
    // bright top highlight
    ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 0.5) + ')';
    for (let x = 0; x < CUMULUS_PATTERN[1].length; x++) {
      if (CUMULUS_PATTERN[1][x] === '1') ctx.fillRect(cx + x * u, cy + 1 * u, u, u / 2);
    }
    // underside shadow (last 2 rows)
    ctx.fillStyle = 'rgba(140,150,180,' + (alpha * 0.5) + ')';
    for (let y = CUMULUS_PATTERN.length - 2; y < CUMULUS_PATTERN.length; y++) {
      for (let x = 0; x < CUMULUS_PATTERN[y].length; x++) {
        if (CUMULUS_PATTERN[y][x] === '1') {
          ctx.fillRect(cx + x * u, cy + y * u, u, u);
        }
      }
    }
  }

  // ---- Aurora curtains (AURORA modifier) ------------------------------------
  function drawAurora(ctx, W, H, s, altFt) {
    const fade = Math.min(1, (altFt - 25000) / 80000);
    ctx.globalCompositeOperation = 'lighter';
    const colors = [
      [80, 255, 180],   // green
      [180, 120, 255],  // violet
      [120, 200, 255],  // cyan
    ];
    for (let band = 0; band < 3; band++) {
      const yBase = H * (0.18 + band * 0.10);
      const amp   = 26 + band * 12;
      const c     = colors[band];
      const a     = (0.10 + 0.04 * Math.sin(s.time * 0.8 + band)) * fade;
      ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
      ctx.beginPath();
      ctx.moveTo(0, yBase);
      const phase = s.time * 0.4 + band * 1.7;
      const step = 6;
      for (let x = 0; x <= W; x += step) {
        const y = yBase + Math.sin(x * 0.012 + phase) * amp + Math.sin(x * 0.04 + phase * 2) * (amp * 0.3);
        ctx.lineTo(x, y);
      }
      // bottom fade-out
      for (let x = W; x >= 0; x -= step) {
        const yBot = yBase + 80 + Math.sin(x * 0.018 + phase * 0.7) * 10;
        ctx.lineTo(x, yBot);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Earth horizon + curve from space -------------------------------------
  function drawHorizon(ctx, W, H, altFt, x) {
    const ppm = F.sim.lastPpm || PIXEL_PER_M_BASE;
    const groundY = H * 0.65 + altFt * 0.04 * ppm;
    if (groundY < H + 50) {
      // ground gradient (warmer on top)
      ctx.fillStyle = '#3a2614';
      ctx.fillRect(0, groundY, W, H - groundY);
      ctx.fillStyle = '#5a3820';
      ctx.fillRect(0, groundY, W, 4);
      ctx.fillStyle = '#7a4828';
      ctx.fillRect(0, groundY + 4, W, 1);
      // distant tree silhouettes (parallax with x)
      ctx.fillStyle = '#1a3a1f';
      for (let i = 0; i < 14; i++) {
        const tx = ((i * 56 - x * 0.4) % W + W) % W;
        const th = 5 + ((i * 7) % 4);
        ctx.fillRect(tx, groundY - th, 6 + ((i * 3) % 3), th);
      }
      // distant city lights / windows hint at very low alt
      if (altFt < 800) {
        for (let i = 0; i < 6; i++) {
          const lx = ((i * 130 - x * 0.6) % W + W) % W;
          ctx.fillStyle = '#ffaa44';
          ctx.fillRect(lx, groundY - 3, 1, 1);
          ctx.fillRect(lx + 6, groundY - 5, 1, 1);
        }
      }
    }
    if (altFt > 8000) drawEarthFromSpace(ctx, W, H, altFt);
  }

  function drawEarthFromSpace(ctx, W, H, altFt) {
    const fade = Math.min(1, (altFt - 8000) / 60000);
    const ey = H + 200 - (altFt - 8000) * 0.005;
    const cy = ey + 800;
    const r = 800;
    if (cy - r > H + 80) return;

    // atmospheric blue glow halo
    ctx.fillStyle = 'rgba(120, 200, 255,' + (0.18 * fade) + ')';
    ctx.beginPath(); ctx.arc(W / 2, cy, r + 36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(180, 230, 255,' + (0.22 * fade) + ')';
    ctx.beginPath(); ctx.arc(W / 2, cy, r + 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255,' + (0.25 * fade) + ')';
    ctx.beginPath(); ctx.arc(W / 2, cy, r + 6, 0, Math.PI * 2); ctx.fill();

    // ocean
    ctx.fillStyle = '#1a4d8f';
    ctx.beginPath(); ctx.arc(W / 2, cy, r, 0, Math.PI * 2); ctx.fill();
    // surface highlight band (sun reflection on the day side)
    ctx.fillStyle = '#2966a8';
    ctx.beginPath(); ctx.arc(W / 2, cy, r - 8, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();

    // continents — irregular green shapes only on the visible cap
    const continents = [
      { x: -240, y: -30, w: 110, h: 22 },
      { x: -110, y: -8,  w: 70,  h: 16 },
      { x:   60, y: -22, w: 90,  h: 24 },
      { x:  220, y: -10, w: 60,  h: 16 },
      { x: -140, y: 10,  w: 50,  h: 12 },
      { x:   30, y: 16,  w: 70,  h: 14 },
    ];
    continents.forEach(c => {
      const px = W / 2 + c.x;
      const py = cy + c.y - r * 0.985;
      if (py > -10 && py < H) {
        ctx.fillStyle = '#3a8b3a';
        ctx.fillRect(px, py, c.w, c.h);
        // darker inland forests
        ctx.fillStyle = '#2d6a2d';
        ctx.fillRect(px + c.w * 0.5, py + c.h * 0.5, c.w * 0.35, c.h * 0.4);
        // coastal lighter strip
        ctx.fillStyle = '#5cae5c';
        ctx.fillRect(px, py, c.w, 1);
      }
    });

    // wispy cloud bands
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(W / 2 - 180, cy - r + 40, 70, 3);
    ctx.fillRect(W / 2 + 30,  cy - r + 28, 90, 3);
    ctx.fillRect(W / 2 - 60,  cy - r + 70, 60, 2);
    ctx.fillRect(W / 2 + 140, cy - r + 60, 50, 2);

    // night-side terminator (right edge in shadow)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
    ctx.beginPath();
    ctx.moveTo(W / 2 + r * 0.4, cy - r);
    ctx.arc(W / 2, cy, r, -Math.PI / 2.6, Math.PI / 2.6);
    ctx.lineTo(W / 2 + r * 0.4, cy - r);
    ctx.closePath();
    ctx.fill();
  }

  // ---- Moon -----------------------------------------------------------------
  function drawMoon(ctx, W, H, altFt) {
    const closeness = Math.min(1, (altFt - 200000) / 800000);
    const r = 30 + closeness * 200;
    const mx = W / 2;
    const my = H * 0.3 - (1 - closeness) * 100;

    // soft glow halo
    ctx.fillStyle = 'rgba(255, 240, 200, 0.06)';
    ctx.beginPath(); ctx.arc(mx, my, r + 10, 0, Math.PI * 2); ctx.fill();

    // surface
    ctx.fillStyle = '#dcd6c8';
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();

    // mare (large dark patches)
    ctx.fillStyle = '#9a9588';
    const mare = [
      [-0.30, -0.18, 0.26], // Imbrium
      [ 0.22, -0.05, 0.20], // Tranquillitatis
      [-0.12,  0.36, 0.18], // Nubium
      [ 0.42,  0.20, 0.14], // Crisium
    ];
    mare.forEach(([dx, dy, dr]) => {
      ctx.beginPath();
      ctx.arc(mx + dx * r, my + dy * r, dr * r, 0, Math.PI * 2);
      ctx.fill();
    });

    // smaller craters scattered across the surface
    ctx.fillStyle = '#7d7864';
    const craters = [
      [-0.55, -0.30, 0.05], [ 0.40, -0.45, 0.04], [ 0.65,  0.10, 0.05],
      [-0.35,  0.55, 0.05], [ 0.18,  0.62, 0.04], [-0.65,  0.10, 0.04],
      [ 0.55, -0.18, 0.03], [-0.20, -0.55, 0.04], [-0.05,  0.05, 0.03],
      [ 0.10, -0.30, 0.03], [-0.55,  0.40, 0.03],
    ];
    craters.forEach(([dx, dy, dr]) => {
      if (dx * dx + dy * dy < 0.85) {
        ctx.beginPath();
        ctx.arc(mx + dx * r, my + dy * r, dr * r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // bright Tycho with ray system at higher closeness
    if (closeness > 0.25) {
      const tx = mx + 0.10 * r, ty = my + 0.55 * r;
      ctx.strokeStyle = 'rgba(255, 248, 224,' + (0.22 * closeness) + ')';
      ctx.lineWidth = Math.max(1, r * 0.012);
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(angle) * r * 0.45, ty + Math.sin(angle) * r * 0.45);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff4dc';
      ctx.beginPath(); ctx.arc(tx, ty, r * 0.05, 0, Math.PI * 2); ctx.fill();
    }

    // terminator shadow on the far edge
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.moveTo(mx + r * 0.5, my - r);
    ctx.arc(mx, my, r, -Math.PI / 2.5, Math.PI / 2.5);
    ctx.lineTo(mx + r * 0.5, my - r);
    ctx.closePath();
    ctx.fill();
  }

  // ---- Sun ------------------------------------------------------------------
  function drawSun(ctx, W, H, altFt) {
    if (altFt > 90000) return;
    const fade = Math.min(1, Math.max(0, 1 - altFt / 90000));
    const sx = W * 0.78;
    const sy = H * 0.18 + Math.min(20, altFt * 0.0008);

    // wide soft halo
    ctx.fillStyle = 'rgba(255, 240, 180,' + (0.16 * fade) + ')';
    ctx.beginPath(); ctx.arc(sx, sy, 70, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 230, 150,' + (0.25 * fade) + ')';
    ctx.beginPath(); ctx.arc(sx, sy, 44, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = 'rgba(255, 248, 180,' + (0.85 * fade + 0.15) + ')';
    ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.fill();
    // hot core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
    // cross-shaped lensflare while in atmosphere
    if (altFt < 60000) {
      ctx.fillStyle = 'rgba(255, 250, 200,' + (0.4 * fade) + ')';
      ctx.fillRect(sx - 60, sy, 120, 1);
      ctx.fillRect(sx, sy - 60, 1, 120);
    }
  }

  // ---- CRT scanlines --------------------------------------------------------
  function drawScanlines(ctx, W, H) {
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let y = 0; y < H; y += 3) {
      ctx.fillRect(0, y, W, 1);
    }
    // tiny vignette darkens corners for monitor feel
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, 6);
    ctx.fillRect(0, H - 6, W, 6);
    ctx.fillRect(0, 0, 6, H);
    ctx.fillRect(W - 6, 0, 6, H);
  }

  // ---- Re-entry plasma envelope ---------------------------------------------
  function drawPlasma(ctx, sim, worldToScreen) {
    const speed = Math.sqrt(sim.vx * sim.vx + sim.vy * sim.vy);
    const altKm = sim.y / 1000;
    const air = Math.max(0, 1 - altKm / 80);
    // need real speed AND atmosphere (not just falling in vacuum)
    const intensity = Math.max(0, (speed - 70) / 140) * air;
    if (intensity <= 0.05) return;
    const [cx, cy] = worldToScreen(sim.x, sim.y);
    // direction of motion in screen-space (plasma forms on the leading face)
    const speedY = (sim.vy >= 0 ? -1 : 1); // plasma in front of motion
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 5; i >= 0; i--) {
      const r = (10 + i * 9) * (0.5 + intensity);
      const a = (0.30 - i * 0.045) * intensity;
      ctx.fillStyle = 'rgba(255,' + (110 - i * 14) + ',' + (40 + i * 8) + ',' + a + ')';
      // skew the envelope toward the leading face by speedY
      ctx.fillRect(cx - r, cy - r + speedY * 4, r * 2, r * 2);
    }
    // hot leading edge highlight
    ctx.fillStyle = 'rgba(255, 240, 180,' + (0.5 * intensity) + ')';
    ctx.fillRect(cx - 14, cy + speedY * 14, 28, 4);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Heat shimmer below engine bell ---------------------------------------
  function drawHeatShimmer(ctx, sim, worldToScreen) {
    if (sim.throttle < 0.3 || sim.fuel <= 0) return;
    const altKm = sim.y / 1000;
    const air = Math.max(0, 1 - altKm / 50);
    if (air <= 0.1) return;
    const ex = -Math.sin(sim.angle), ey = -Math.cos(sim.angle);
    // start a few meters past the engine
    ctx.fillStyle = 'rgba(255, 230, 180,' + (0.10 * air * sim.throttle) + ')';
    for (let i = 0; i < 8; i++) {
      const along = 1.5 + i * 0.6;
      const wob = Math.sin(sim.time * 12 + i * 0.7) * 3;
      const ortho = Math.cos(sim.angle); // simple lateral wobble vector
      const wx = sim.x + ex * along + wob * 0.05;
      const wy = sim.y + ey * along;
      const [sx, sy] = worldToScreen(wx, wy);
      ctx.fillRect(sx - 14 + wob, sy, 28, 1);
    }
  }

  // ---- Dropped fuel tank tumbling away --------------------------------------
  function drawDroppedTank(ctx, d, worldToScreen) {
    const [sx, sy] = worldToScreen(d.x, d.y);
    const fade = Math.min(1, d.life / 1.0);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(d.angle);
    ctx.globalAlpha = fade;
    if (d.partId === '__nose') {
      // tumbling nose cone fragment
      ctx.fillStyle = '#aa3333';
      ctx.fillRect(-12, -3, 24, 6);
      ctx.fillStyle = '#cc4444';
      ctx.fillRect(-12, -3, 22, 1);
      ctx.fillStyle = '#882222';
      ctx.fillRect(10, -3, 2, 6);
      ctx.fillStyle = '#aa3333';
      ctx.fillRect(-8, -9, 16, 6);
      ctx.fillStyle = '#cc4444';
      ctx.fillRect(-8, -9, 14, 1);
      ctx.fillStyle = '#aa3333';
      ctx.fillRect(-4, -15, 8, 6);
      // tip beacon
      ctx.fillStyle = '#ffeecc';
      ctx.fillRect(-1, -17, 2, 2);
    } else {
      const part = Parts.byId(d.partId);
      if (part) {
        const halfH = part.height * STACK_SCALE / 2;
        const frame = d.onFire && d.life > 1.5 ? { thrusting: true, t: (d.life * 60) | 0 } : null;
        part.sprite(ctx, 0, halfH, STACK_SCALE, frame);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- Contrail trail behind rocket -----------------------------------------
  function drawContrail(ctx, worldToScreen) {
    const list = F.contrail;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const [sx, sy] = worldToScreen(p.x, p.y);
      const age = p.t / 6;            // 0 = new, 1 = expired
      const fade = Math.max(0, 1 - age);
      const expand = 1 + age * 5;
      if (p.atmosphere) {
        // smoky white contrail in atmosphere
        ctx.fillStyle = 'rgba(225, 230, 240,' + (fade * 0.55) + ')';
        const sz = 2 + expand * 1.5;
        ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      } else {
        // exhaust glow trail in space
        ctx.fillStyle = 'rgba(255, 200, 130,' + (fade * 0.35) + ')';
        const sz = 2 + expand;
        ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
    }
  }

  // ---- Launch shockwave + dust kick-up --------------------------------------
  function spawnLaunchShockwave(s) {
    // bright expanding ring of bolts rolling out from the pad
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const sp = 18 + Math.random() * 4;
      F.particles.push({
        x: s.x + Math.cos(a) * 0.8,
        y: 0.5 + Math.sin(a) * 0.4,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * Math.abs(sp) * 0.25 + 1.5,
        life: 0.9 + Math.random() * 0.4,
        color: '#ffeecc',
        size: 4 + Math.random() * 3,
      });
    }
    // big rolling dust cloud at the base
    for (let i = 0; i < 36; i++) {
      F.particles.push({
        x: s.x + (Math.random() - 0.5) * 10,
        y: 0.3 + Math.random() * 1.0,
        vx: (Math.random() - 0.5) * 22,
        vy: 1 + Math.random() * 4,
        life: 2.0 + Math.random() * 1.2,
        color: ['#aaa090', '#888070', '#bbb0a0', '#9c9080'][i % 4],
        size: 6 + Math.random() * 5,
        smoke: true,
      });
    }
    Sfx.play('launch');
  }

  // ---- Decorative comets at high altitude -----------------------------------
  function updateComets(dt, s) {
    const altFt = s.y * M_TO_FT;
    if (altFt > 80000 && altFt < 950000 && F.comets.length < 2) {
      if (Math.random() < dt * 0.10) {
        F.comets.push({
          x: s.x + (Math.random() < 0.5 ? -55 : 55),
          y: s.y + 35 + Math.random() * 35,
          vx: -45 + Math.random() * 90,
          vy: -25 - Math.random() * 30,
          t: 0,
          life: 2.0,
          trail: [],
        });
      }
    }
    F.comets.forEach(c => {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.t += dt;
      c.trail.push({ x: c.x, y: c.y });
      if (c.trail.length > 14) c.trail.shift();
    });
    F.comets = F.comets.filter(c => c.t < c.life);
  }

  function drawComets(ctx, worldToScreen) {
    F.comets.forEach(c => {
      // tail (older positions, fading)
      c.trail.forEach((p, i) => {
        const fade = i / c.trail.length;
        const [sx, sy] = worldToScreen(p.x, p.y);
        ctx.fillStyle = 'rgba(180, 220, 255,' + (fade * 0.6) + ')';
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      });
      // head — bright white core + halo
      const [hx, hy] = worldToScreen(c.x, c.y);
      ctx.fillStyle = 'rgba(180, 220, 255, 0.4)';
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx - 1, hy - 1, 3, 3);
    });
  }

  // ---- Crash crater (post-impact ground scar) -------------------------------
  function drawCrater(ctx, sim, worldToScreen) {
    if (!sim.crashed && !sim.exiting) return;
    if (sim.y > 8) return; // only visible at ground level
    const [cx, cy] = worldToScreen(sim.x, 0);
    // outer scorched ring
    ctx.fillStyle = '#0a0806';
    ctx.fillRect(cx - 38, cy + 4, 76, 4);
    ctx.fillStyle = '#1a1210';
    ctx.fillRect(cx - 32, cy + 2, 64, 6);
    ctx.fillStyle = '#3a2018';
    ctx.fillRect(cx - 26, cy, 52, 5);
    // smoldering ember at center, pulsing
    if ((sim.time * 4) % 2 < 1) {
      ctx.fillStyle = 'rgba(255, 80, 30, 0.85)';
      ctx.fillRect(cx - 4, cy + 1, 8, 2);
    } else {
      ctx.fillStyle = 'rgba(255, 150, 60, 0.7)';
      ctx.fillRect(cx - 3, cy + 1, 6, 2);
    }
    // wisp of smoke rising
    ctx.fillStyle = 'rgba(120, 120, 130, 0.4)';
    const drift = Math.sin(sim.time * 2) * 4;
    ctx.fillRect(cx - 2 + drift, cy - 8, 3, 4);
    ctx.fillRect(cx - 1 + drift * 1.5, cy - 16, 4, 4);
  }

  // ---- Cloud passthrough fog ------------------------------------------------
  function cloudFogAt(altFt) {
    const bands = [
      { min: 800,  max: 4500, peak: 0.45 },
      { min: 1800, max: 6500, peak: 0.30 },
      { min: 3500, max: 8500, peak: 0.20 },
    ];
    let total = 0;
    bands.forEach(b => {
      if (altFt > b.min && altFt < b.max) {
        const t = (altFt - b.min) / (b.max - b.min);
        total += Math.sin(t * Math.PI) * b.peak;
      }
    });
    return Math.min(0.55, total);
  }

  // ---- Satellites drifting at high altitude ---------------------------------
  function updateSatellites(dt, s) {
    const altFt = s.y * M_TO_FT;
    // spawn occasionally between 80k and 900k ft
    if (altFt > 60000 && altFt < 900000 && F.satellites.length < 3) {
      if (Math.random() < dt * 0.18) {
        const fromRight = Math.random() < 0.5;
        F.satellites.push({
          // place in world coords near rocket so they pass through view
          x: s.x + (fromRight ? 60 : -60),
          y: s.y + (Math.random() - 0.3) * 60,
          vx: (fromRight ? -1 : 1) * (4 + Math.random() * 5),
          vy: (Math.random() - 0.5) * 1.5,
          spin: (Math.random() - 0.5) * 0.4,
          t: 0,
          variant: Math.floor(Math.random() * 3),
        });
      }
    }
    F.satellites.forEach(sat => {
      sat.x += sat.vx * dt;
      sat.y += sat.vy * dt;
      sat.t += dt;
    });
    // GC when far from rocket
    F.satellites = F.satellites.filter(sat =>
      Math.abs(sat.x - s.x) < 100 && Math.abs(sat.y - s.y) < 100);
  }

  function drawSatellites(ctx, W, H, worldToScreen) {
    F.satellites.forEach(sat => {
      const [sx, sy] = worldToScreen(sat.x, sat.y);
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(sat.spin * sat.t);
      drawSatellite(ctx, sat);
      ctx.restore();
    });
  }

  function drawSatellite(ctx, sat) {
    const glint = (Math.sin(sat.t * 3) + 1) * 0.5;
    if (sat.variant === 0) {
      // ISS-style: panels on both sides of central truss
      ctx.fillStyle = '#1a3060';
      ctx.fillRect(-18, -2, 12, 4);
      ctx.fillRect(6, -2, 12, 4);
      // panel grid
      ctx.fillStyle = '#3a6090';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(-17 + i * 4, -2, 1, 4);
        ctx.fillRect(7 + i * 4, -2, 1, 4);
      }
      // truss
      ctx.fillStyle = '#aaaaaa';
      ctx.fillRect(-6, -1, 12, 2);
      // body
      ctx.fillStyle = '#dddddd';
      ctx.fillRect(-3, -3, 6, 6);
      // glint
      ctx.fillStyle = 'rgba(255,255,200,' + (0.5 + glint * 0.5) + ')';
      ctx.fillRect(-2, -2, 1, 1);
    } else if (sat.variant === 1) {
      // dish-style satellite
      ctx.fillStyle = '#cccccc';
      // dish
      ctx.beginPath();
      ctx.arc(0, -2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(0, -2, 4, 0, Math.PI * 2);
      ctx.fill();
      // body
      ctx.fillStyle = '#444';
      ctx.fillRect(-3, 2, 6, 5);
      // small panel
      ctx.fillStyle = '#1a3060';
      ctx.fillRect(-10, 3, 6, 3);
      ctx.fillRect(4, 3, 6, 3);
      // glint
      ctx.fillStyle = 'rgba(255,255,255,' + glint + ')';
      ctx.fillRect(-1, -3, 1, 1);
    } else {
      // tumbling junk satellite (out of service)
      ctx.fillStyle = '#777';
      ctx.fillRect(-5, -3, 10, 6);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(-4, -2, 6, 1);
      // gold foil flapping
      ctx.fillStyle = '#ddaa55';
      ctx.fillRect(5, -3, 4, 6);
      ctx.fillStyle = '#886633';
      ctx.fillRect(5, 0, 4, 1);
      // broken antenna
      ctx.fillStyle = '#444';
      ctx.fillRect(0, -7, 1, 4);
    }
  }

  // ---- Mountain silhouettes at low altitude ---------------------------------
  function drawMountains(ctx, W, H, altFt, x) {
    if (altFt > 5500) return;
    const fade = Math.min(1, (5500 - altFt) / 1500);
    const ppm = F.sim.lastPpm || PIXEL_PER_M_BASE;
    const groundY = H * 0.65 + altFt * 0.04 * ppm;
    // far range — distant haze blue
    ctx.fillStyle = 'rgba(60, 75, 110,' + (0.55 * fade) + ')';
    for (let i = 0; i < 10; i++) {
      const seed = i * 137;
      const mx = ((seed - x * 0.18) % (W + 200) + W + 200) % (W + 200) - 100;
      const peak = 28 + (seed % 16);
      const w = 80 + (seed % 30);
      ctx.beginPath();
      ctx.moveTo(mx - w / 2, groundY);
      ctx.lineTo(mx, groundY - peak);
      ctx.lineTo(mx + w / 2, groundY);
      ctx.closePath();
      ctx.fill();
    }
    // near range — darker, taller, with snow caps
    ctx.fillStyle = 'rgba(40, 55, 80,' + (0.85 * fade) + ')';
    for (let i = 0; i < 6; i++) {
      const seed = i * 211;
      const mx = ((seed - x * 0.4) % (W + 220) + W + 220) % (W + 220) - 110;
      const peak = 60 + (seed % 24);
      const w = 120 + (seed % 40);
      ctx.beginPath();
      ctx.moveTo(mx - w / 2, groundY);
      ctx.lineTo(mx - w / 8, groundY - peak * 0.7);
      ctx.lineTo(mx, groundY - peak);
      ctx.lineTo(mx + w / 6, groundY - peak * 0.6);
      ctx.lineTo(mx + w / 2, groundY);
      ctx.closePath();
      ctx.fill();
      // snow cap
      ctx.fillStyle = 'rgba(220, 230, 245,' + (0.7 * fade) + ')';
      ctx.beginPath();
      ctx.moveTo(mx - 6, groundY - peak * 0.8);
      ctx.lineTo(mx, groundY - peak);
      ctx.lineTo(mx + 5, groundY - peak * 0.75);
      ctx.lineTo(mx + 2, groundY - peak * 0.7);
      ctx.lineTo(mx - 3, groundY - peak * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(40, 55, 80,' + (0.85 * fade) + ')';
    }
  }

  // ---- Atmospheric wind streaks ---------------------------------------------
  function drawWindStreaks(ctx, W, H, altFt, modifier, time) {
    if (altFt < 800 || altFt > 28000) return;
    const baseIntensity = 0.25;
    const stormy = modifier && (modifier.id === 'gusty' || modifier.id === 'storm');
    const intensity = baseIntensity * (stormy ? 3.5 : 1);
    const count = Math.floor(14 * intensity);
    ctx.fillStyle = 'rgba(255, 255, 255,' + (0.10 * intensity) + ')';
    for (let i = 0; i < count; i++) {
      const speed = 60 + (i * 17) % 80;
      const phase = (time * speed + i * 73) % (W + 80);
      const y = (i * 31 + (i * 7) % H) % H;
      const len = 8 + (i * 3) % 14;
      ctx.fillRect(W - phase - len, y, len, 1);
    }
  }

  // ---- Mach diamonds in exhaust ---------------------------------------------
  // The visible repeating bright/dark pattern in a supersonic rocket plume.
  // Only meaningful in atmosphere with high throttle.
  function drawMachDiamonds(ctx, sim, worldToScreen) {
    if (sim.throttle < 0.5 || sim.fuel <= 0) return;
    const altKm = sim.y / 1000;
    const air = Math.max(0, 1 - altKm / 30);
    if (air < 0.15) return;

    const ex = -Math.sin(sim.angle + sim.gimbal);
    const ey = -Math.cos(sim.angle + sim.gimbal);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const dist = 1.6 + i * 0.9;
      const wob = Math.sin(sim.time * 22 + i * 1.2) * 0.15;
      const [sx, sy] = worldToScreen(sim.x + ex * (dist + wob), sim.y + ey * (dist + wob));
      const sz = 6 + i * 2;
      // bright core diamond
      ctx.fillStyle = 'rgba(255, 250, 200,' + (0.55 * sim.throttle * air) + ')';
      ctx.fillRect(sx - sz / 2, sy - 1, sz, 2);
      ctx.fillStyle = 'rgba(255, 230, 180,' + (0.4 * sim.throttle * air) + ')';
      ctx.fillRect(sx - sz / 4, sy - 2, sz / 2, 4);
      // outer halo
      ctx.fillStyle = 'rgba(255, 200, 110,' + (0.22 * sim.throttle * air) + ')';
      ctx.fillRect(sx - sz, sy - 3, sz * 2, 6);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Sonic boom shockwave -------------------------------------------------
  function spawnSonicBoom(s) {
    // expanding ring of bright particles
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const sp = 28;
      F.particles.push({
        x: s.x, y: s.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.6,
        color: '#ffffff',
        size: 3,
      });
    }
    // soft halo wave
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const sp = 14;
      F.particles.push({
        x: s.x, y: s.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1.2,
        color: '#cce0ff',
        size: 5,
        smoke: true,
      });
    }
    s.shake = Math.max(s.shake || 0, 0.5);
  }

  // ---- Hot air balloons -----------------------------------------------------
  function updateBalloons(dt, s) {
    const altFt = s.y * M_TO_FT;
    if (altFt > 1000 && altFt < 8000 && F.balloons.length < 2) {
      if (Math.random() < dt * 0.10) {
        const fromRight = Math.random() < 0.5;
        const palettes = [
          { skin: '#cc3333', stripe: '#ffcc33' },
          { skin: '#3366cc', stripe: '#ffffff' },
          { skin: '#33aa66', stripe: '#ffaa44' },
          { skin: '#ee99cc', stripe: '#cc3399' },
        ];
        F.balloons.push({
          x: s.x + (fromRight ? 50 : -50),
          y: s.y + (Math.random() - 0.5) * 30,
          vx: (fromRight ? -1 : 1) * (1.5 + Math.random() * 1.5),
          vy: (Math.random() - 0.5) * 0.4,
          t: 0,
          palette: palettes[Math.floor(Math.random() * palettes.length)],
        });
      }
    }
    F.balloons.forEach(b => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.t += dt;
    });
    F.balloons = F.balloons.filter(b => Math.abs(b.x - s.x) < 80 && Math.abs(b.y - s.y) < 60);
  }

  function drawBalloons(ctx, worldToScreen) {
    F.balloons.forEach(b => {
      const [sx, sy] = worldToScreen(b.x, b.y);
      // sway
      const sway = Math.sin(b.t * 1.5) * 1;
      const cx = sx + sway, cy = sy;
      // balloon — pear shape with stripes
      ctx.fillStyle = b.palette.skin;
      ctx.fillRect(cx - 6, cy - 10, 12, 8);
      ctx.fillRect(cx - 5, cy - 12, 10, 2);
      ctx.fillRect(cx - 4, cy - 14, 8, 2);
      ctx.fillRect(cx - 5, cy - 2, 10, 1);
      // vertical stripe
      ctx.fillStyle = b.palette.stripe;
      ctx.fillRect(cx - 1, cy - 14, 2, 12);
      // gondola basket
      ctx.fillStyle = '#aa7744';
      ctx.fillRect(cx - 3, cy + 2, 6, 3);
      ctx.fillStyle = '#553311';
      ctx.fillRect(cx - 3, cy + 5, 6, 1);
      // ropes
      ctx.fillStyle = '#222';
      ctx.fillRect(cx - 4, cy - 1, 1, 3);
      ctx.fillRect(cx + 3, cy - 1, 1, 3);
      // highlight on balloon
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(cx - 5, cy - 12, 1, 6);
    });
  }

  // ---- Ambient NPC rockets at distance --------------------------------------
  function updateNpcRockets(dt, s) {
    const altFt = s.y * M_TO_FT;
    if (F.npcRockets.length < 1 && altFt < 200000) {
      if (Math.random() < dt * 0.04) {
        // spawn from off-screen, moving up at an angle
        const fromRight = Math.random() < 0.5;
        F.npcRockets.push({
          x: s.x + (fromRight ? 70 : -70),
          y: s.y + (Math.random() - 0.5) * 60,
          vx: (fromRight ? -1 : 1) * 6,
          vy: 18 + Math.random() * 8,
          trail: [],
          t: 0,
        });
      }
    }
    F.npcRockets.forEach(r => {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.t += dt;
      r.trail.push({ x: r.x, y: r.y });
      if (r.trail.length > 16) r.trail.shift();
    });
    F.npcRockets = F.npcRockets.filter(r => Math.abs(r.x - s.x) < 100 && Math.abs(r.y - s.y) < 120);
  }

  function drawNpcRockets(ctx, worldToScreen) {
    F.npcRockets.forEach(r => {
      // exhaust trail
      r.trail.forEach((p, i) => {
        const fade = i / r.trail.length;
        const [tx, ty] = worldToScreen(p.x, p.y);
        ctx.fillStyle = 'rgba(255, 200, 120,' + (fade * 0.5) + ')';
        ctx.fillRect(tx - 1, ty - 1, 2, 2);
      });
      // tiny rocket sprite
      const [sx, sy] = worldToScreen(r.x, r.y);
      const ang = Math.atan2(-r.vy, r.vx) - Math.PI / 2;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      // body
      ctx.fillStyle = '#dddddd';
      ctx.fillRect(-2, -4, 4, 8);
      // nose
      ctx.fillStyle = '#cc3333';
      ctx.fillRect(-1, -6, 2, 2);
      // fins
      ctx.fillStyle = '#888';
      ctx.fillRect(-3, 3, 1, 2);
      ctx.fillRect(2, 3, 1, 2);
      // flame
      const flick = (r.t * 12 | 0) % 2;
      ctx.fillStyle = '#ffcc33';
      ctx.fillRect(-1, 4, 2, 3 + flick);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 5, 1, 1 + flick);
      ctx.restore();
    });
  }

  // ---- Storm rain -----------------------------------------------------------
  function updateRain(dt, s) {
    const altFt = s.y * M_TO_FT;
    const isStorm = s.modifier && (s.modifier.id === 'storm');
    if (!isStorm || altFt > 18000) {
      F.raindrops = []; return;
    }
    const W = F.canvas ? (F.canvas.clientWidth || 800) : 800;
    const H = F.canvas ? (F.canvas.clientHeight || 600) : 600;
    while (F.raindrops.length < 32) {
      F.raindrops.push({
        x: Math.random() * W,
        y: -10 + Math.random() * H,
        vy: 600 + Math.random() * 200, // px/s in screen-space
        len: 6 + Math.random() * 6,
      });
    }
    F.raindrops.forEach(d => {
      d.y += d.vy * dt;
    });
  }

  function drawRain(ctx, W, H) {
    if (F.raindrops.length === 0) return;
    ctx.fillStyle = 'rgba(180, 200, 240, 0.5)';
    F.raindrops.forEach(d => {
      // wrap + relocate when offscreen
      if (d.y > H + 20) {
        d.y = -10;
        d.x = Math.random() * W;
      }
      const x = d.x % W;
      ctx.fillRect(x, d.y, 1, d.len);
    });
  }

  // ---- Pickups (in-flight collectibles) -------------------------------------
  // 5 types weighted by rarity. They float into view ahead of the rocket and
  // gently steer toward it within an attraction radius so the player has a
  // forgiving but skill-rewarding incentive to maneuver mid-flight.
  const PICKUP_TYPES = ['scrap','scrap','scrap','scrap','fuel','fuel','repair','data','data','star'];
  const PICKUP_LABELS = {
    scrap:  '+50 SCRAP',
    fuel:   'FUEL +20%',
    repair: 'HULL +30',
    data:   '+3 DATA',
    star:   'STAR +200',
  };
  const PICKUP_COLORS = {
    scrap:  ['#aaaaaa', '#ffffff', '#444444'],
    fuel:   ['#ff8833', '#ffeeaa', '#552200'],
    repair: ['#cc3333', '#ffeeee', '#552211'],
    data:   ['#3399cc', '#cce0ff', '#114466'],
    star:   ['#ffcc33', '#ffffff', '#664400'],
  };

  function updatePickups(dt, s) {
    const altFt = s.y * M_TO_FT;
    // pickups don't spawn on the pad — give the player a moment to launch
    if (altFt > 200 && F.pickups.length < 4) {
      // higher spawn rate higher up to reward exploration
      const rate = 0.55 + Math.min(1.0, altFt / 100000) * 0.4;
      if (Math.random() < dt * rate) {
        spawnPickup(s);
      }
    }

    F.pickups.forEach(p => {
      p.t += dt;
      // gentle drift downward so they pass by even stationary rockets
      p.x += p.vx * dt;
      p.y += (p.vy + s.vy * 0.05) * dt;

      // attraction within radius — eases toward rocket
      // R&D Aerial Magnet upgrade scales the radius
      const mag = s.magnetBoost || 1;
      const radius = 6 * mag;
      const dx = s.x - p.x, dy = s.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < radius * radius && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const pull = 14 * (1 - d / radius);
        p.vx += (dx / d) * pull * dt;
        p.vy += (dy / d) * pull * dt;
      } else {
        // mild damping when out of attraction range
        p.vx *= Math.pow(0.92, dt * 60);
        p.vy *= Math.pow(0.96, dt * 60);
      }

      // collected when close enough
      if (d2 < 1.6 && !p.collected) {
        collectPickup(p, s);
        p.collected = true;
      }
    });

    // GC: collected, or far from the rocket. The vertical test must be absolute
    // — the one-sided form never culled pickups ABOVE the rocket, so a descent
    // stranded them at the spawn cap and blocked new pickups for the whole run.
    F.pickups = F.pickups.filter(p =>
      !p.collected && Math.abs(s.y - p.y) < 80 && Math.abs(p.x - s.x) < 80
    );
  }

  function spawnPickup(s) {
    const type = PICKUP_TYPES[Math.floor(Math.random() * PICKUP_TYPES.length)];
    // spawn ahead of the rocket along its velocity vector with some scatter
    const ahead = 32 + Math.random() * 18;
    const lateral = (Math.random() - 0.5) * 22;
    F.pickups.push({
      type,
      x: s.x + lateral,
      y: s.y + ahead,
      vx: 0, vy: -0.4 - Math.random() * 0.3,
      t: Math.random() * Math.PI * 2,
      collected: false,
    });
  }

  function collectPickup(p, s) {
    if (p.type === 'scrap')  s.pickupScrap += 50;
    if (p.type === 'fuel') {
      addFuel(s, s.maxFuel * 0.20); // tops up attached tanks, bottom-first
    }
    if (p.type === 'repair') {
      s.hull = Math.min(s.maxHull, s.hull + 30);
    }
    if (p.type === 'data')   s.pickupData += 3;
    if (p.type === 'star') {
      s.pickupScrap += 200;
      s.flash = Math.max(s.flash || 0, 0.5);
      s.flashColor = '#ffcc33';
    }
    s.pickupCount++;
    flashMsg(PICKUP_LABELS[p.type]);
    spawnPickupBurst(p);
    Sfx.play('snap');
  }

  function spawnPickupBurst(p) {
    const colors = PICKUP_COLORS[p.type];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const sp = 6 + Math.random() * 4;
      F.particles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.3,
        color: i % 2 === 0 ? colors[1] : colors[0],
        size: 2 + Math.random() * 2,
      });
    }
  }

  function drawPickups(ctx, worldToScreen) {
    F.pickups.forEach(p => {
      const [sx, sy] = worldToScreen(p.x, p.y);
      const bob = Math.sin(p.t * 4) * 2;
      const pulse = (Math.sin(p.t * 5) + 1) * 0.5;
      const colors = PICKUP_COLORS[p.type];

      // outer glow halo — color-coded
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = colors[0] + 'aa'.replace(/.{2}/, hex(0.18 + pulse * 0.18));
      ctx.fillRect(sx - 14, sy + bob - 14, 28, 28);
      ctx.globalCompositeOperation = 'source-over';

      // sprite per type
      const cx = sx, cy = sy + bob;
      if (p.type === 'scrap') {
        // gray cube with bolt indent
        ctx.fillStyle = colors[0];
        ctx.fillRect(cx - 5, cy - 5, 10, 10);
        ctx.fillStyle = colors[1];
        ctx.fillRect(cx - 5, cy - 5, 10, 1);
        ctx.fillRect(cx - 5, cy - 5, 1, 10);
        ctx.fillStyle = colors[2];
        ctx.fillRect(cx + 4, cy - 5, 1, 10);
        ctx.fillRect(cx - 5, cy + 4, 10, 1);
        ctx.fillStyle = colors[2];
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
      } else if (p.type === 'fuel') {
        // canister with nozzle and "F"
        ctx.fillStyle = colors[2];
        ctx.fillRect(cx - 1, cy - 7, 2, 2);
        ctx.fillStyle = colors[0];
        ctx.fillRect(cx - 5, cy - 5, 10, 10);
        ctx.fillStyle = colors[1];
        ctx.fillRect(cx - 5, cy - 5, 10, 1);
        ctx.fillStyle = colors[2];
        ctx.fillRect(cx - 5, cy + 4, 10, 1);
        // F letter
        ctx.fillStyle = colors[1];
        ctx.fillRect(cx - 2, cy - 3, 1, 6);
        ctx.fillRect(cx - 2, cy - 3, 4, 1);
        ctx.fillRect(cx - 2, cy, 3, 1);
      } else if (p.type === 'repair') {
        // red square with white plus
        ctx.fillStyle = colors[0];
        ctx.fillRect(cx - 5, cy - 5, 10, 10);
        ctx.fillStyle = colors[2];
        ctx.fillRect(cx - 5, cy + 4, 10, 1);
        ctx.fillStyle = colors[1];
        ctx.fillRect(cx - 1, cy - 4, 2, 8);
        ctx.fillRect(cx - 4, cy - 1, 8, 2);
      } else if (p.type === 'data') {
        // diamond crystal
        ctx.fillStyle = colors[0];
        ctx.fillRect(cx - 4, cy, 8, 1);
        ctx.fillRect(cx - 3, cy - 1, 6, 1);
        ctx.fillRect(cx - 2, cy - 2, 4, 1);
        ctx.fillRect(cx - 1, cy - 3, 2, 1);
        ctx.fillRect(cx - 3, cy + 1, 6, 1);
        ctx.fillRect(cx - 2, cy + 2, 4, 1);
        ctx.fillRect(cx - 1, cy + 3, 2, 1);
        ctx.fillStyle = colors[1];
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
      } else if (p.type === 'star') {
        // 4-point gold star with white core
        ctx.fillStyle = colors[0];
        ctx.fillRect(cx - 1, cy - 6, 2, 12);
        ctx.fillRect(cx - 6, cy - 1, 12, 2);
        ctx.fillRect(cx - 4, cy - 4, 8, 8);
        // diagonal stars
        ctx.fillRect(cx - 3, cy - 3, 1, 1);
        ctx.fillRect(cx + 2, cy - 3, 1, 1);
        ctx.fillRect(cx - 3, cy + 2, 1, 1);
        ctx.fillRect(cx + 2, cy + 2, 1, 1);
        ctx.fillStyle = colors[1];
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
      }

      // hint indicator if pickup is offscreen-top (rocket falling, missed it)
      // also, distance-fade so far pickups read as smaller
    });
  }

  function hex(a) {
    const v = Math.max(0, Math.min(255, Math.round(a * 255)));
    return v.toString(16).padStart(2, '0');
  }

  // ---- Engine glow halo -----------------------------------------------------
  function drawEngineGlow(ctx, sim, worldToScreen) {
    if (sim.throttle < 0.1 || sim.fuel <= 0) return;
    const live = sim.engines.find(e => e.alive);
    if (!live) return;
    const colorPart = Parts.byId(live.pid);
    const flame = colorPart?.flameColor || '#ffcc33';
    const rgb = hexToRgb(flame);

    // glow center: 0.5m below rocket along (gimbaled) thrust axis
    const ex = -Math.sin(sim.angle + (sim.gimbal || 0));
    const ey = -Math.cos(sim.angle + (sim.gimbal || 0));
    const [gx, gy] = worldToScreen(sim.x + ex * 0.5, sim.y + ey * 0.5);

    ctx.globalCompositeOperation = 'lighter';
    const flick = (sim.time * 30 | 0) % 2;
    for (let i = 5; i >= 0; i--) {
      const radius = (10 + i * 22) * sim.throttle + flick;
      const alpha = (0.18 - i * 0.026);
      ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
      ctx.fillRect(gx - radius, gy - radius, radius * 2, radius * 2);
    }
    // bright hot core
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(gx - 4, gy - 4, 8, 8);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHazard(ctx, h, x, y) {
    if (h.type === 'bird') {
      drawBird(ctx, h, x, y);
    } else if (h.type === 'lightning') {
      drawLightning(ctx, h, x, y);
    } else if (h.type === 'debris') {
      drawDebris(ctx, h, x, y);
    }
  }

  function drawBird(ctx, h, x, y) {
    const dir = h.vx > 0 ? 1 : -1;
    const flap = (h.t * 9) % 1; // 0..1
    // wing positions (3 phases)
    const phase = flap < 0.33 ? 0 : (flap < 0.66 ? 1 : 2);

    // body — dark with hint of blue (corvid)
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(x - 3, y - 1, 6, 4);
    ctx.fillRect(x - 2, y - 2, 4, 5);
    // back highlight
    ctx.fillStyle = '#33333d';
    ctx.fillRect(x - 2, y - 2, 4, 1);
    // head + eye
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(x + dir * 2, y - 2, 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + dir * 3, y - 2, 1, 1);
    ctx.fillStyle = '#ffaa44';
    // beak
    ctx.fillRect(x + dir * 4, y - 1, 1, 1);
    // tail
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(x - dir * 4, y, 2, 2);

    // wings (3 flap phases)
    ctx.fillStyle = '#1a1a22';
    if (phase === 0) {       // wings up
      ctx.fillRect(x - 8, y - 5, 6, 2);
      ctx.fillRect(x + 2, y - 5, 6, 2);
      ctx.fillRect(x - 5, y - 7, 3, 2);
      ctx.fillRect(x + 2, y - 7, 3, 2);
    } else if (phase === 1) { // wings out
      ctx.fillRect(x - 9, y - 1, 7, 2);
      ctx.fillRect(x + 2, y - 1, 7, 2);
      ctx.fillRect(x - 11, y, 2, 1);
      ctx.fillRect(x + 9, y, 2, 1);
    } else {                  // wings down
      ctx.fillRect(x - 8, y + 1, 6, 2);
      ctx.fillRect(x + 2, y + 1, 6, 2);
      ctx.fillRect(x - 5, y + 3, 3, 2);
      ctx.fillRect(x + 2, y + 3, 3, 2);
    }
  }

  // Pre-baked branching lightning paths so the bolt looks alive but
  // doesn't redraw a different shape every frame.
  function lightningPath(seed) {
    const rng = (n) => {
      n = (n + seed * 91) | 0;
      n = (n ^ (n >>> 15)) * 0x2c1b3c6d;
      n = (n ^ (n >>> 12)) * 0x297a2d39;
      return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
    };
    const segs = [];
    let px = 0, py = -28;
    for (let i = 0; i < 14; i++) {
      const dx = (rng(i * 3) - 0.5) * 8;
      const dy = 4 + rng(i * 3 + 1) * 2;
      segs.push({ x1: px, y1: py, x2: px + dx, y2: py + dy });
      px += dx; py += dy;
      // occasional branch
      if (rng(i * 3 + 2) > 0.7) {
        let bx = px, by = py;
        for (let j = 0; j < 4; j++) {
          const bdx = (rng(i * 7 + j * 2) - 0.5) * 6;
          const bdy = 3;
          segs.push({ x1: bx, y1: by, x2: bx + bdx, y2: by + bdy, branch: true });
          bx += bdx; by += bdy;
        }
      }
    }
    return segs;
  }
  const _lightningCache = {};
  function getLightning(seed) {
    if (!_lightningCache[seed]) _lightningCache[seed] = lightningPath(seed);
    return _lightningCache[seed];
  }

  function drawLightning(ctx, h, x, y) {
    if (!h.armed) {
      // telegraph — pulsing warning glow
      const pulse = (Math.sin(h.t * 16) + 1) * 0.5;
      ctx.fillStyle = 'rgba(255, 255, 130,' + (0.18 + pulse * 0.18) + ')';
      ctx.fillRect(x - 6, y - 32, 12, 64);
      ctx.fillStyle = 'rgba(255, 255, 200,' + (0.4 + pulse * 0.4) + ')';
      ctx.fillRect(x - 2, y - 28, 4, 56);
      // warning chevron at strike point
      ctx.fillStyle = '#ffff88';
      ctx.fillRect(x - 8, y - 2, 16, 2);
      ctx.fillRect(x - 6, y - 5, 12, 1);
      ctx.fillRect(x - 3, y - 8, 6, 1);
      // pulsing "exclamation" dot below
      const a = 0.5 + pulse * 0.5;
      ctx.fillStyle = 'rgba(255, 220, 80,' + a + ')';
      ctx.fillRect(x - 1, y + 8, 2, 4);
      ctx.fillRect(x - 1, y + 14, 2, 2);
    } else {
      // active strike — outer halo + bright branching bolt
      const seed = ((h.x * 1000) | 0) ^ ((h.y * 1000) | 0);
      const segs = getLightning(seed);

      // outer cyan-white halo
      ctx.strokeStyle = 'rgba(180, 220, 255, 0.5)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      segs.forEach(s => {
        ctx.moveTo(x + s.x1, y + s.y1);
        ctx.lineTo(x + s.x2, y + s.y2);
      });
      ctx.stroke();

      // bright yellow inner bolt
      ctx.strokeStyle = '#ffff88';
      ctx.lineWidth = 3;
      ctx.beginPath();
      segs.forEach(s => {
        ctx.moveTo(x + s.x1, y + s.y1);
        ctx.lineTo(x + s.x2, y + s.y2);
      });
      ctx.stroke();

      // hot white core
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      segs.forEach(s => {
        if (s.branch) return;
        ctx.moveTo(x + s.x1, y + s.y1);
        ctx.lineTo(x + s.x2, y + s.y2);
      });
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  function drawDebris(ctx, h, x, y) {
    const ang = (h.spin || 0) * h.t;
    const variant = ((h.x * 13 + h.y * 7) | 0) % 3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (variant === 0) {
      // chunk of metal
      ctx.fillStyle = '#888';
      ctx.fillRect(-6, -5, 12, 10);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(-5, -4, 4, 3);
      ctx.fillStyle = '#444';
      ctx.fillRect(0, 1, 4, 3);
      ctx.fillRect(-4, 2, 2, 2);
      // bolt
      ctx.fillStyle = '#222';
      ctx.fillRect(-2, -1, 1, 1);
      ctx.fillRect(2, 2, 1, 1);
    } else if (variant === 1) {
      // jagged chunk (asteroid-ish)
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(-6, -3, 12, 7);
      ctx.fillRect(-5, -5, 8, 2);
      ctx.fillRect(-3, 4, 8, 2);
      ctx.fillStyle = '#7a6a52';
      ctx.fillRect(-5, -2, 5, 2);
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(2, -1, 3, 2);
      ctx.fillRect(-3, 2, 2, 2);
    } else {
      // satellite chunk (panel + hardware)
      ctx.fillStyle = '#aaaaaa';
      ctx.fillRect(-7, -2, 14, 4);
      // gold foil
      ctx.fillStyle = '#ddaa55';
      ctx.fillRect(-6, -1, 12, 2);
      ctx.fillStyle = '#886633';
      ctx.fillRect(-6, 0, 12, 1);
      // antenna stub
      ctx.fillStyle = '#444';
      ctx.fillRect(0, -5, 1, 4);
      ctx.fillRect(-1, -6, 3, 1);
    }
    ctx.restore();
  }

  function drawRocket(ctx, cx, cy, sim) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sim.angle);

    const rocket = F.rocket;
    const t = (sim.time * 60) | 0;
    const thrusting = sim.throttle > 0.1 && sim.fuel > 0;

    // damage flash
    if (sim.hull < sim.maxHull * 0.3 && (t % 4 < 2)) {
      ctx.globalAlpha = 0.7;
    }

    // build stack bottom-up; vertical draw with bottom at y=+halfH
    // dropped parts are skipped so the visible rocket shrinks as you stage
    const totalH = rocket.parts.reduce((sum, pid, i) => {
      if (sim.dropped && sim.dropped[i]) return sum;
      const p = Parts.byId(pid);
      return sum + (p ? p.height : 0);
    }, 0) * STACK_SCALE;

    // bottom of rocket centered at translated origin
    let cursor = totalH / 2;
    rocket.parts.forEach((pid, i) => {
      if (sim.dropped && sim.dropped[i]) return;
      const p = Parts.byId(pid);
      if (!p) return;
      const eng = sim.engines.find(e => e.idx === i);
      const isAlive = eng ? eng.alive : true;
      if (p.category === 'engine' && !isAlive) {
        ctx.globalAlpha = 0.5;
      }
      p.sprite(ctx, 0, cursor, STACK_SCALE, { thrusting: thrusting && isAlive, t });
      ctx.globalAlpha = 1;
      cursor -= p.height * STACK_SCALE;
    });

    // separation hint: highlight the stage that drops next + show the cut line.
    // Drawn in the rocket's rotated frame so the band hugs the actual hardware.
    if (!sim.exiting) {
      const remStages = currentStages(sim);
      const poweredAbove = remStages.slice(1).some(st => st.engineCount > 0);
      if (remStages.length >= 2 && poweredAbove) {
        let dropH = 0;
        remStages[0].idxs.forEach(idx => {
          const dp = Parts.byId(rocket.parts[idx]);
          if (dp) dropH += dp.height;
        });
        dropH *= STACK_SCALE;
        const cutY = totalH / 2 - dropH;          // local y of the separation plane
        const halfW = 16 * STACK_SCALE;
        const pulse = 0.16 + 0.12 * Math.sin(sim.time * 6);
        ctx.fillStyle = 'rgba(255,90,70,' + pulse.toFixed(3) + ')';
        ctx.fillRect(-halfW, cutY, halfW * 2, totalH / 2 - cutY);
        ctx.strokeStyle = 'rgba(255,175,95,0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(-halfW - 4, cutY);
        ctx.lineTo(halfW + 4, cutY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // fins on bottom-most non-dropped body
    if (rocket.finId) {
      const fin = Parts.byId(rocket.finId);
      let yCursor = totalH / 2;
      let bodyBottom = null;
      for (let i = 0; i < rocket.parts.length; i++) {
        if (sim.dropped && sim.dropped[i]) continue;
        const p = Parts.byId(rocket.parts[i]);
        if (!p) continue;
        if (p.category === 'body' && bodyBottom === null) bodyBottom = yCursor;
        yCursor -= p.height * STACK_SCALE;
      }
      if (bodyBottom !== null) fin.sprite(ctx, 0, bodyBottom, STACK_SCALE, null);
    }

    // nose cone — top of remaining stack
    let topCursor = totalH / 2 - rocket.parts.reduce((sum, pid, i) => {
      if (sim.dropped && sim.dropped[i]) return sum;
      const p = Parts.byId(pid); return sum + (p ? p.height : 0);
    }, 0) * STACK_SCALE;
    // shaded nose cone (3 stepped tiers) with vertical highlight
    ctx.fillStyle = '#aa3333';
    ctx.fillRect(-12, topCursor - 6, 24, 6);
    ctx.fillStyle = '#cc4444';
    ctx.fillRect(-12, topCursor - 6, 22, 1);  // top edge highlight
    ctx.fillStyle = '#882222';
    ctx.fillRect(10, topCursor - 6, 2, 6);    // right shadow
    ctx.fillStyle = '#aa3333';
    ctx.fillRect(-8, topCursor - 12, 16, 6);
    ctx.fillStyle = '#cc4444';
    ctx.fillRect(-8, topCursor - 12, 14, 1);
    ctx.fillStyle = '#882222';
    ctx.fillRect(6, topCursor - 12, 2, 6);
    ctx.fillStyle = '#aa3333';
    ctx.fillRect(-4, topCursor - 18, 8, 6);
    ctx.fillStyle = '#cc4444';
    ctx.fillRect(-4, topCursor - 18, 6, 1);
    ctx.fillStyle = '#882222';
    ctx.fillRect(2, topCursor - 18, 2, 6);
    // tiny tip beacon
    ctx.fillStyle = '#ffeecc';
    ctx.fillRect(-1, topCursor - 20, 2, 2);

    // engine light reflection — warm glow on rocket lower body during burn
    if (thrusting) {
      const livePid = sim.engines.find(e => e.alive)?.pid;
      const engPart = livePid ? Parts.byId(livePid) : null;
      const flameHex = engPart?.flameColor || '#ffcc33';
      const rgb = hexToRgb(flameHex);
      ctx.globalCompositeOperation = 'lighter';
      // bright tight band closest to engine, dimmer wider band higher
      for (let i = 0; i < 5; i++) {
        const a = (0.14 - i * 0.025) * sim.throttle;
        ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + a + ')';
        const yoff = totalH / 2 - i * 8;
        const w = 36 - i * 4;
        ctx.fillRect(-w / 2, yoff - 12, w, 12);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();
  }

  function drawAltitudeRail(ctx, W, H, yM) {
    ctx.fillStyle = 'rgba(232,236,255,0.4)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    const altFt = yM * M_TO_FT;
    const tickEvery = altFt < 5000 ? 500 : altFt < 50000 ? 5000 : altFt < 500000 ? 50000 : 200000;
    const baseTick = Math.floor(altFt / tickEvery) * tickEvery;
    for (let k = -3; k <= 6; k++) {
      const tickFt = baseTick + k * tickEvery;
      if (tickFt < 0) continue;
      const tickM = tickFt / M_TO_FT;
      const ppm = F.sim.lastPpm || PIXEL_PER_M_BASE;
      const sy = H * 0.65 - (tickM - yM) * ppm;
      if (sy < 0 || sy > H) continue;
      ctx.fillRect(W - 30, sy, 6, 1);
      ctx.fillText(formatFt(tickFt), W - 36, sy + 4);
    }
  }

  function formatFt(v) {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return v + '';
  }

  // ---- HUD ------------------------------------------------------------------
  function updateHud() {
    const s = F.sim;
    // MET T+mm:ss
    const totalSec = Math.floor(s.met || 0);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    const metEl = $('#hud-met');
    if (metEl) metEl.textContent = 'T+' + mm + ':' + ss;
    $('#hud-alt').textContent = formatFt(Math.floor(s.maxAltitudeM * M_TO_FT)) + ' ft';
    $('#hud-vel').textContent = Math.floor(s.vy * M_TO_FT) + '';
    $('#hud-fuel').textContent = Math.floor((s.fuel / Math.max(1, s.maxFuel)) * 100) + '%';
    $('#hud-hull').textContent = Math.max(0, Math.floor((s.hull / Math.max(1, s.maxHull)) * 100)) + '%';
    if (F.msgT > 0) {
      $('#hud-msg').textContent = F.msg;
      $('#hud-msg').style.opacity = Math.min(1, F.msgT);
    } else {
      $('#hud-msg').textContent = '';
    }

    // weather modifier label
    const modEl = $('#hud-modifier');
    if (s.modifier && s.modifier.id !== 'calm') {
      modEl.textContent = '⚠ ' + s.modifier.label;
      modEl.classList.remove('empty');
    } else {
      modEl.classList.add('empty');
    }

    // combo
    const comboEl = $('#hud-combo');
    if (s.combo > 0) {
      comboEl.textContent = 'PILOT ×' + s.combo;
      comboEl.classList.add('show');
    } else {
      comboEl.classList.remove('show');
    }

    // pickups counter
    const puEl = $('#hud-pickups');
    if (puEl) {
      if (s.pickupCount > 0) {
        puEl.textContent = '◇ ' + s.pickupCount + '  +' + s.pickupScrap + ' SC';
        puEl.classList.add('show');
      } else {
        puEl.classList.remove('show');
      }
    }

    // stage button enable/disable
    const stageBtn = $('#touch-stage');
    if (stageBtn) {
      const can = canStage();
      stageBtn.classList.toggle('disabled', !can);
      // count powered stages still attached below the top one — that's how many
      // more STAGE drops are available
      const stages = currentStages(s);
      const droppable = stages.length - 1;
      stageBtn.textContent = 'STAGE' + (droppable > 1 ? ' (' + droppable + ')' : '');
    }

    const warpBtn2 = $('#touch-warp');
    if (warpBtn2) {
      const set = s.warp || 1;
      const eff = effectiveWarp();
      warpBtn2.textContent = set === 1 ? 'TIME x1' : ('TIME x' + set + (eff === 1 ? ' (HELD)' : ''));
      warpBtn2.classList.toggle('active', set > 1 && eff > 1);
      warpBtn2.classList.toggle('held', set > 1 && eff === 1);
    }

    // recover button — only live once the tanks are dry
    const recBtn = $('#touch-recover');
    if (recBtn) {
      const can = canRecover();
      recBtn.classList.toggle('disabled', !can);
      recBtn.classList.toggle('ready', can && s.vy < 0);
    }

    // ability buttons reflect remaining stock + shield active state
    const cons = (Game && Game.getConsumables) ? Game.getConsumables() : { boost: 0, repair: 0, shield: 0 };
    const setAbility = (selector, count, isActive) => {
      const el = $(selector);
      if (!el) return;
      el.querySelector('.ct').textContent = count;
      el.classList.toggle('empty', count <= 0);
      el.classList.toggle('shield-active', !!isActive);
      el.disabled = count <= 0 && !isActive;
    };
    setAbility('#ability-boost',  cons.boost, false);
    setAbility('#ability-repair', cons.repair, false);
    setAbility('#ability-shield', cons.shield, (s.shieldT || 0) > 0);
  }

  // The hangar forecasts the next launch's weather so a 10-minute moonshot is
  // never committed to blind. Flight.enter consumes Game.nextWeather if set.
  global.Flight = {
    enter, exit,
    MODIFIERS,
    rollWeather: pickModifier,
  };
})(window);
