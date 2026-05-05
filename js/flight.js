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
  const THRUST_GAIN = 12;
  const GRAVITY = 9.8;
  const FUEL_MASS_PER_L = 0.05;
  const M_TO_FT = 3.281;
  const MOON_ALTITUDE_FT = 1_000_000;
  const MOON_ALTITUDE_M = MOON_ALTITUDE_FT / M_TO_FT;
  const PIXEL_PER_M = 2;             // base zoom
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

  // ---- entry ----------------------------------------------------------------
  function enter(Game) {
    F.canvas = $('#flight-canvas');
    F.ctx = F.canvas.getContext('2d');
    F.ctx.imageSmoothingEnabled = false;

    const r = Game.lastRocket || Builder.getCurrentRocket();
    F.rocket = r;
    F.seed = Date.now() & 0xFFFFFFFF;
    F.rng = rngFromSeed(F.seed);

    initSim(r);
    initStars();
    F.particles = [];
    F.hazards = [];
    F.msg = 'IGNITION';
    F.msgT = 1.5;

    fitCanvas();
    if (!F.started) {
      bindControls(Game);
      F.started = true;
    }
    window.addEventListener('resize', fitCanvas);

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
  ];

  // ---- simulation init ------------------------------------------------------
  function initSim(rocket, opts) {
    opts = opts || {};
    const modifier = opts.modifier || pickModifier();
    const stats = recomputeStats(rocket, {});
    F.sim = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      angVel: 0,
      fuel: stats.capacity,
      maxFuel: stats.capacity,
      hull: 100 + stats.hullBonus,
      maxHull: 100 + stats.hullBonus,
      dryMass: stats.mass,
      fuelMass: stats.capacity * FUEL_MASS_PER_L,
      thrust: stats.thrust,
      burnRate: stats.burnRate,
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
    };
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
    for (let i = 0; i < 80; i++) {
      F.stars.push({
        x: Math.random() * 2000 - 1000,
        y: Math.random() * 4000,
        depth: 0.2 + Math.random() * 0.8,
        bright: Math.random(),
      });
    }
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
  }

  // ---- staging --------------------------------------------------------------
  function jettisonStage() {
    if (!F.sim || F.sim.exiting) return false;
    const s = F.sim;
    // find bottom-most still-attached fuel tank
    let lowestFuelIdx = -1;
    for (let i = 0; i < F.rocket.parts.length; i++) {
      if (s.dropped[i]) continue;
      const p = Parts.byId(F.rocket.parts[i]);
      if (p && p.category === 'fuel') { lowestFuelIdx = i; break; }
    }
    if (lowestFuelIdx < 0) {
      flashMsg('NOTHING TO STAGE');
      return false;
    }

    // drop everything below + including that fuel tank that hasn't been dropped
    const droppedNow = [];
    for (let i = 0; i <= lowestFuelIdx; i++) {
      if (!s.dropped[i]) {
        s.dropped[i] = true;
        droppedNow.push(i);
      }
    }
    if (!droppedNow.length) return false;

    // recompute physics stats from remaining parts
    const next = recomputeStats(F.rocket, s.dropped);
    s.dryMass = next.mass;
    s.thrust = next.thrust;
    s.burnRate = next.burnRate;
    s.stability = next.stability;
    s.jank = next.jank;
    // fuel pool clamps to remaining tank capacity
    if (s.fuel > next.capacity) s.fuel = next.capacity;
    s.maxFuel = next.capacity;
    s.fuelMass = next.capacity * FUEL_MASS_PER_L;
    s.engines = s.engines.filter(e => !s.dropped[e.idx]);

    // separation kick proportional to throttle (explosive bolts)
    const kick = 5 + s.throttle * 6;
    const ax = -Math.sin(s.angle);
    const ay = -Math.cos(s.angle);
    // kick the rocket forward (opposite of dropped direction = forward thrust direction)
    s.vx += -ax * 0; // mostly vertical kick
    s.vy += kick;

    // visual: spawn debris flying away from rocket bottom
    spawnStageDebris(s, droppedNow);
    spawnExplosion(s.x + ax * 1, s.y + ay * 1, 0.7);
    s.shake = Math.max(s.shake, 0.4);
    s.stageCount++;
    flashMsg('STAGE ' + s.stageCount + ' DROP');
    Sfx.play('explosion');
    return true;
  }

  function spawnStageDebris(s, indices) {
    // launch a few chunky debris pieces downward in rocket-frame
    const ax = -Math.sin(s.angle);
    const ay = -Math.cos(s.angle);
    for (let k = 0; k < 8; k++) {
      const spread = (Math.random() - 0.5) * 4;
      F.particles.push({
        x: s.x + ax * 1.5 + spread * 0.3,
        y: s.y + ay * 1.5 - 0.5,
        vx: ax * (4 + Math.random() * 4) + (Math.random() - 0.5) * 6 + s.vx * 0.5,
        vy: ay * (6 + Math.random() * 4) + (Math.random() - 0.5) * 4 + s.vy * 0.5,
        life: 1.2 + Math.random() * 0.8,
        color: ['#aaaaaa', '#888888', '#cc4444', '#ffcc33'][k % 4],
        size: 3 + Math.random() * 3,
      });
    }
  }

  function canStage() {
    if (!F.sim) return false;
    for (let i = 0; i < F.rocket.parts.length; i++) {
      if (F.sim.dropped[i]) continue;
      const p = Parts.byId(F.rocket.parts[i]);
      if (p && p.category === 'fuel') return true;
    }
    return false;
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

    update(dt, Game);
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
      modifierId: F.sim.modifier ? F.sim.modifier.id : 'calm',
      modifierLabel: F.sim.modifier ? F.sim.modifier.label : 'CALM',
      modifierScrapMul: F.sim.modifier ? F.sim.modifier.scrapMul : 1.0,
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

    // controls
    const throttleTarget = (F.keys.thrust || F.touch.thrust) ? 1 : 0;
    s.throttle += (throttleTarget - s.throttle) * Math.min(1, dt * 8);

    const steerL = F.keys.left || F.touch.left;
    const steerR = F.keys.right || F.touch.right;

    // engine breakage
    s.engines.forEach(eng => {
      if (!eng.alive) return;
      const part = Parts.byId(eng.pid);
      if (!part) return;
      if (s.throttle > 0.1 && Math.random() < part.breakChance * dt) {
        eng.alive = false;
        flashMsg(part.catastrophic ? 'CORE MELTDOWN' : (part.name + ' FAILED'));
        spawnExplosion(s.x, s.y - 0.5, part.catastrophic ? 1.5 : 0.6);
        if (part.catastrophic) s.hull -= 200;
        else s.hull -= 10;
        s.shake = Math.max(s.shake || 0, part.catastrophic ? 0.9 : 0.5);
        s.flash = Math.max(s.flash || 0, part.catastrophic ? 0.9 : 0.4);
        s.flashColor = part.catastrophic ? '#ff3333' : '#ffaa44';
      }
    });

    const liveThrust = s.engines.reduce((sum, eng) => {
      if (!eng.alive) return sum;
      const p = Parts.byId(eng.pid);
      let t = p.thrust;
      if (p.thrustVariance) {
        t *= 1 + (Math.random() * 2 - 1) * p.thrustVariance;
      }
      return sum + t;
    }, 0);

    // fuel
    const burningEngines = s.engines.filter(e => e.alive).length;
    if (s.throttle > 0.05 && s.fuel > 0 && burningEngines > 0) {
      const burn = s.burnRate * s.throttle * dt;
      s.fuel = Math.max(0, s.fuel - burn);
    }

    if (s.fuel <= 0) s.throttle = 0;

    // mass (decreases with fuel)
    const mass = s.dryMass + (s.fuel / s.maxFuel) * s.fuelMass;

    // accelerations
    const aThrustMag = (liveThrust * THRUST_GAIN / mass) * s.throttle * (s.fuel > 0 ? 1 : 0);
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
        s.shake = Math.max(s.shake, 0.25);
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

    // shake + flash decay
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 1.6);
    if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 1.2);

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

    // tumbling check
    if (Math.abs(s.angle) > Math.PI && altFt > 200) {
      s.hull -= 30 * dt;
      if (!s.tumbling) {
        flashMsg('TUMBLING!');
        s.tumbling = true;
      }
    }

    // hull check
    if (s.hull <= 0 && !s.crashed) {
      s.crashed = true;
      s.crashReason = s.crashReason || 'STRUCTURAL FAILURE';
      flashMsg('KABOOM');
      spawnExplosion(s.x, s.y, 3);
      Sfx.play('explosion');
    }

    // moon check
    if (s.y >= MOON_ALTITUDE_M && !s.moonReached) {
      s.moonReached = true;
      flashMsg('MOON REACHED!');
      Sfx.play('win');
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

    // exhaust particles (fire opposite the thrust direction so they trail behind tilted rockets)
    if (s.throttle > 0.1 && s.fuel > 0 && burningEngines > 0) {
      const ex = -Math.sin(s.angle), ey = -Math.cos(s.angle);
      for (let i = 0; i < 2; i++) {
        const colorPart = Parts.byId(s.engines.find(e => e.alive)?.pid);
        F.particles.push({
          x: s.x + ex * 0.6 + (Math.random() - 0.5) * 0.3,
          y: s.y + ey * 0.6 + (Math.random() - 0.5) * 0.3,
          vx: ex * (8 + Math.random() * 4) + s.vx * 0.3 + (Math.random() - 0.5) * 2,
          vy: ey * (8 + Math.random() * 4) + s.vy * 0.3 + (Math.random() - 0.5) * 2,
          life: 0.4 + Math.random() * 0.2,
          color: colorPart?.flameColor || '#ffcc33',
          size: 2 + Math.random() * 2,
        });
      }
    }

    if (F.msgT > 0) F.msgT -= dt;

    // engine sound intensity
    Sfx.setEngineIntensity(s.throttle * (s.fuel > 0 ? 1 : 0));
  }

  function flashMsg(m) { F.msg = m; F.msgT = 1.6; }

  function spawnExplosion(x, y, scale) {
    const n = Math.floor(20 * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 14 * scale;
      F.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.8,
        color: ['#ffcc33', '#ff5511', '#ff7733', '#ffffff'][i % 4],
        size: 2 + Math.random() * 4,
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
          if (h.type === 'bird') s.hull -= 12;
          if (h.type === 'lightning') s.hull -= 25;
          if (h.type === 'debris') s.hull -= 30;
          spawnExplosion(s.x, s.y, 0.6);
          h.dead = true;
          h.hit = true;
          // any hit resets combo
          s.combo = 0;
          flashMsg(h.type.toUpperCase() + ' STRIKE');
          s.shake = Math.max(s.shake, 0.5);
          s.flash = Math.max(s.flash || 0, 0.5);
          s.flashColor = '#ff5577';
        }
      }
    });

    // garbage collect & combo: hazards passing within close range without hitting
    F.hazards = F.hazards.filter(h => {
      const farX = Math.abs(h.x - s.x) > 30;
      const farY = Math.abs(h.y - s.y) > 30;
      const expired = h.t > 6;
      const offscreen = farX || farY || expired;
      if ((h.dead || offscreen) && !h.counted) {
        h.counted = true;
        if (!h.hit && h.t > 0.4) {
          // close pass = combo
          const dx = h.x - s.x, dy = h.y - s.y;
          const d2 = dx * dx + dy * dy;
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
    if (altFt < 800000) return 0.6;     // debris
    return 0.25;
  }

  function pickHazardType(altFt, mod) {
    // weather modifiers shift the mix
    const lightningMul = mod ? mod.lightningMul : 1;
    const debrisMul = mod ? mod.debrisMul : 1;

    if (altFt < 2000) return 'bird';
    if (altFt < 30000) {
      // lightning vs nothing
      const lProb = 0.4 * lightningMul;
      return Math.random() < lProb ? 'lightning' : 'bird';
    }
    if (altFt < 80000) {
      const lProb = 0.3 * lightningMul;
      const dProb = 0.4 * debrisMul;
      const r = Math.random();
      if (r < lProb) return 'lightning';
      if (r < lProb + dProb) return 'debris';
      return null;
    }
    // high altitude: mostly debris
    return Math.random() < (0.7 * debrisMul) ? 'debris' : null;
  }

  function makeHazard(type, s) {
    const side = Math.random() < 0.5 ? -1 : 1;
    if (type === 'bird') {
      return {
        type, x: s.x + side * 28 + (Math.random() - 0.5) * 4,
        y: s.y + (Math.random() - 0.3) * 14,
        vx: -side * (5 + Math.random() * 3),
        vy: (Math.random() - 0.5) * 2,
        radius: 0.7, t: 0, dead: false, telegraph: 0,
      };
    }
    if (type === 'lightning') {
      // strike where the rocket WILL be in `lookahead` seconds — player dodges
      // by changing course mid-telegraph
      const lookahead = 0.5;
      return {
        type,
        x: s.x + s.vx * lookahead + (Math.random() - 0.5) * 4,
        y: s.y + s.vy * lookahead,
        vx: 0, vy: 0,
        radius: 1.4,
        t: 0,
        dead: false,
        armed: false,
        telegraph: 0.5,
        dieAt: 1.1,
      };
    }
    if (type === 'debris') {
      return {
        type, x: s.x + side * 28 + (Math.random() - 0.5) * 8,
        y: s.y + 6 + Math.random() * 18,
        vx: -side * (6 + Math.random() * 3),
        vy: -(2 + Math.random() * 4),
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

    // screen shake — translate the canvas a few pixels
    let shakeX = 0, shakeY = 0;
    if (s.shake > 0) {
      const amp = s.shake * 8;
      shakeX = (Math.random() - 0.5) * amp;
      shakeY = (Math.random() - 0.5) * amp;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);

    // sky color stops
    const sky = skyGradient(ctx, W, H, altFt);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // stars (visible above ~10,000 ft, fade in)
    const starAlpha = Math.min(1, Math.max(0, (altFt - 5000) / 30000));
    if (starAlpha > 0) {
      drawStars(ctx, W, H, starAlpha, s);
    }

    // distant clouds (low altitude)
    if (altFt < 8000) drawClouds(ctx, W, H, altFt, s.x);

    // moon (visible above 200k ft, grows)
    if (altFt > 200000) drawMoon(ctx, W, H, altFt);

    // ground horizon (visible while low)
    if (altFt < 30000) drawHorizon(ctx, W, H, altFt, s.x);

    // world-space helpers
    const worldToScreen = (wx, wy) => {
      const sx = W / 2 + (wx - s.x) * PIXEL_PER_M;
      const sy = H * 0.65 - (wy - s.y) * PIXEL_PER_M;
      return [sx, sy];
    };

    // apex ghost line — your previous best altitude as a horizontal target line
    drawApexGhost(ctx, W, H, s, worldToScreen);

    // hazards
    F.hazards.forEach(h => {
      const [hx, hy] = worldToScreen(h.x, h.y);
      drawHazard(ctx, h, hx, hy);
    });

    // particles
    F.particles.forEach(p => {
      const [px, py] = worldToScreen(p.x, p.y);
      ctx.fillStyle = p.color;
      const sz = Math.max(1, p.size * (p.life > 0.3 ? 1 : p.life * 3));
      ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
    });

    // rocket
    const [rx, ry] = worldToScreen(s.x, s.y);
    drawRocket(ctx, rx, ry, s);

    // launchpad (when low)
    if (altFt < 600) {
      const [px, py] = worldToScreen(0, 0);
      ctx.fillStyle = '#666';
      ctx.fillRect(px - 60, py + 10, 120, 4);
      ctx.fillStyle = '#3a2614';
      ctx.fillRect(0, py + 14, W, H - (py + 14));
    }

    // altitude tick marks on the right edge
    drawAltitudeRail(ctx, W, H, s.y);

    ctx.restore();

    // milestone / damage screen flash on top
    if (s.flash > 0) {
      const a = Math.min(0.5, s.flash * 0.5);
      ctx.fillStyle = s.flashColor;
      ctx.globalAlpha = a;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
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
      // parallax: stars move slower than rocket
      const sx = (st.x - s.x * st.depth * 0.02 + 1000) % W;
      const sy = (st.y - s.y * st.depth * 0.02 + 4000) % H;
      const tw = (Math.sin((s.time + st.bright * 5) * 3) + 1) * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + tw * 0.6) + ')';
      ctx.fillRect(sx, sy, st.bright > 0.7 ? 2 : 1, st.bright > 0.7 ? 2 : 1);
    });
    ctx.globalAlpha = 1;
  }

  function drawClouds(ctx, W, H, altFt, x) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    const cloudY = H - 120 + altFt * 0.05;
    if (cloudY > -40 && cloudY < H + 40) {
      for (let i = 0; i < 6; i++) {
        const cx = ((i * 180 - x * 8) % (W + 200) + W + 200) % (W + 200) - 100;
        ctx.fillRect(cx, cloudY + (i % 2) * 12, 80, 12);
        ctx.fillRect(cx + 16, cloudY + (i % 2) * 12 - 6, 48, 6);
      }
    }
  }

  function drawHorizon(ctx, W, H, altFt, x) {
    // earth curvature: ground recedes as altitude grows
    const groundY = H * 0.65 + altFt * 0.04 * PIXEL_PER_M;
    if (groundY < H + 50) {
      ctx.fillStyle = '#3a2614';
      ctx.fillRect(0, groundY, W, H - groundY);
      ctx.fillStyle = '#5a3820';
      ctx.fillRect(0, groundY, W, 4);
      // distant trees
      ctx.fillStyle = '#1a3a1f';
      for (let i = 0; i < 12; i++) {
        const tx = ((i * 60 - x * 0.3) % W + W) % W;
        ctx.fillRect(tx, groundY - 6, 8, 6);
      }
    }
    if (altFt > 8000) {
      // earth curve when high
      const ey = H + 200 - (altFt - 8000) * 0.005;
      ctx.fillStyle = '#1a4d8f';
      ctx.beginPath();
      ctx.arc(W / 2, ey + 800, 800, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a8b3a';
      ctx.beginPath();
      ctx.arc(W / 2, ey + 800, 780, Math.PI * 1.2, Math.PI * 1.8);
      ctx.fill();
    }
  }

  function drawMoon(ctx, W, H, altFt) {
    const closeness = Math.min(1, (altFt - 200000) / 800000);
    const r = 30 + closeness * 200;
    const mx = W / 2;
    const my = H * 0.3 - (1 - closeness) * 100;
    ctx.fillStyle = '#dcd6c8';
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9a9588';
    [[-r * 0.3, -r * 0.2, r * 0.2], [r * 0.3, r * 0.1, r * 0.15], [-r * 0.1, r * 0.4, r * 0.1]].forEach(([dx, dy, cr]) => {
      ctx.beginPath();
      ctx.arc(mx + dx, my + dy, cr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawHazard(ctx, h, x, y) {
    if (h.type === 'bird') {
      const flap = ((h.t * 8) | 0) % 2;
      ctx.fillStyle = '#222';
      if (flap === 0) {
        ctx.fillRect(x - 8, y - 1, 6, 2);
        ctx.fillRect(x + 2, y - 1, 6, 2);
      } else {
        ctx.fillRect(x - 8, y - 4, 6, 2);
        ctx.fillRect(x + 2, y - 4, 6, 2);
      }
      ctx.fillRect(x - 2, y, 4, 3);
      // beak — direction by vx
      ctx.fillStyle = '#ffaa44';
      ctx.fillRect(x + (h.vx > 0 ? 2 : -3), y + 1, 1, 1);
    } else if (h.type === 'lightning') {
      if (!h.armed) {
        // telegraph: pulsing warning marker
        const pulse = (Math.sin(h.t * 18) + 1) * 0.5;
        ctx.fillStyle = 'rgba(255,255,136,' + (0.3 + pulse * 0.5) + ')';
        ctx.fillRect(x - 3, y - 30, 6, 60);
        ctx.fillStyle = '#ffff88';
        ctx.fillRect(x - 6, y - 4, 12, 2);
        ctx.fillRect(x - 4, y - 7, 8, 1);
        ctx.fillRect(x - 2, y - 10, 4, 1);
      } else {
        // strike: jagged bolt
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 1, y - 30, 3, 60);
        ctx.fillStyle = '#ffff88';
        ctx.fillRect(x - 4, y - 22, 4, 3);
        ctx.fillRect(x + 2, y - 12, 4, 3);
        ctx.fillRect(x - 5, y - 2, 4, 3);
        ctx.fillRect(x + 3, y + 8, 4, 3);
      }
    } else if (h.type === 'debris') {
      const ang = (h.spin || 0) * h.t;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = '#777';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(-3, -3, 3, 3);
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 1, 4, 3);
      ctx.fillRect(-4, 2, 2, 2);
      ctx.restore();
    }
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
    ctx.fillStyle = '#cc4444';
    ctx.fillRect(-12, topCursor - 6, 24, 6);
    ctx.fillRect(-8, topCursor - 12, 16, 6);
    ctx.fillRect(-4, topCursor - 18, 8, 6);

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
      const sy = H * 0.65 - (tickM - yM) * PIXEL_PER_M;
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

    // stage button enable/disable
    const stageBtn = $('#touch-stage');
    if (stageBtn) {
      const can = canStage();
      stageBtn.classList.toggle('disabled', !can);
      const remaining = F.rocket.parts.filter((pid, i) => {
        const p = Parts.byId(pid);
        return p && p.category === 'fuel' && !s.dropped[i];
      }).length;
      stageBtn.textContent = 'STAGE' + (remaining > 1 ? ' (' + remaining + ')' : '');
    }
  }

  global.Flight = { enter, exit };
})(window);
