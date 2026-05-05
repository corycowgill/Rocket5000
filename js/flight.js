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

    Audio.startEngine();
    F.lastT = performance.now();
    cancelAnimationFrame(F.raf);
    F.raf = requestAnimationFrame(loop.bind(null, Game));
  }

  function exit() {
    cancelAnimationFrame(F.raf);
    F.raf = 0;
    Audio.stopEngine();
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

  // ---- simulation init ------------------------------------------------------
  function initSim(rocket) {
    const stats = rocket.stats || Builder.getStats(rocket);
    const fuelMass = stats.capacity * FUEL_MASS_PER_L;
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
      fuelMass,
      thrust: stats.thrust,
      burnRate: sumBurnRate(rocket),
      stability: stats.stability,
      jank: stats.jank,
      engines: rocket.parts.filter(pid => Parts.byId(pid)?.category === 'engine')
        .map(pid => ({ id: pid, alive: true })),
      time: 0,
      maxAltitudeM: 0,
      crashed: false,
      moonReached: false,
      crashReason: null,
      throttle: 0, // 0..1 smoothed
    };
  }

  function sumBurnRate(rocket) {
    let r = 0;
    rocket.parts.forEach(pid => {
      const p = Parts.byId(pid);
      if (p && p.category === 'engine') r += p.burnRate;
    });
    return r;
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
      Audio.setEngineIntensity(0);
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
      const part = Parts.byId(eng.id);
      if (!part) return;
      if (s.throttle > 0.1 && Math.random() < part.breakChance * dt * 60) {
        eng.alive = false;
        flashMsg(part.catastrophic ? 'CORE MELTDOWN' : (part.name + ' FAILED'));
        spawnExplosion(s.x, s.y - 0.5, part.catastrophic ? 1.5 : 0.6);
        if (part.catastrophic) s.hull -= 200;
        else s.hull -= 10;
      }
    });

    const liveThrust = s.engines.reduce((sum, eng) => {
      if (!eng.alive) return sum;
      const p = Parts.byId(eng.id);
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

    // angular dynamics
    const controlAuth = 0.6 + (s.stability / 100) * 1.2;
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

    // wind shear in mid atmosphere
    const altFt = s.y * M_TO_FT;
    if (altFt > 2000 && altFt < 15000) {
      // ribbons of wind every ~500ft
      const band = Math.floor(altFt / 500);
      const dir = ((band * 31) % 7) - 3; // -3..3
      s.vx += dir * 0.3 * dt;
    }

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
      Audio.play('explosion');
    }

    // moon check
    if (s.y >= MOON_ALTITUDE_M && !s.moonReached) {
      s.moonReached = true;
      flashMsg('MOON REACHED!');
      Audio.play('win');
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

    // exhaust particles
    if (s.throttle > 0.1 && s.fuel > 0 && burningEngines > 0) {
      for (let i = 0; i < 2; i++) {
        const colorPart = Parts.byId(s.engines.find(e => e.alive)?.id);
        F.particles.push({
          x: s.x + (Math.random() - 0.5) * 0.5,
          y: s.y - 0.5,
          vx: (Math.random() - 0.5) * 2 + s.vx * 0.5,
          vy: -8 - Math.random() * 4 + s.vy * 0.2 - Math.cos(s.angle) * 6,
          life: 0.4 + Math.random() * 0.2,
          color: colorPart?.flameColor || '#ffcc33',
          size: 2 + Math.random() * 2,
        });
      }
    }

    if (F.msgT > 0) F.msgT -= dt;

    // engine sound intensity
    Audio.setEngineIntensity(s.throttle * (s.fuel > 0 ? 1 : 0));
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

    // spawn check
    if (Math.random() < dt * spawnRate(altFt)) {
      const type = pickHazardType(altFt);
      if (type) F.hazards.push(makeHazard(type, s));
    }

    F.hazards.forEach(h => {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.t += dt;

      // collision: simple radius
      const dx = h.x - s.x, dy = h.y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < (h.radius + 0.6) * (h.radius + 0.6)) {
        if (h.type === 'bird') s.hull -= 12;
        if (h.type === 'lightning') s.hull -= 25;
        if (h.type === 'debris') s.hull -= 30;
        spawnExplosion(s.x, s.y, 0.6);
        h.dead = true;
        flashMsg(h.type.toUpperCase() + ' STRIKE');
      }
    });

    F.hazards = F.hazards.filter(h => !h.dead && Math.abs(h.x - s.x) < 80 && Math.abs(h.y - s.y) < 80);
  }

  function spawnRate(altFt) {
    if (altFt < 100) return 0;
    if (altFt < 2000) return 0.6;       // birds
    if (altFt < 15000) return 0.3;      // wind handled separately
    if (altFt < 30000) return 0.4;      // lightning
    if (altFt < 100000) return 0.2;
    if (altFt < 800000) return 0.5;     // debris
    return 0.2;
  }

  function pickHazardType(altFt) {
    if (altFt < 2000) return 'bird';
    if (altFt < 30000 && Math.random() < 0.5) return 'lightning';
    if (altFt > 30000) return 'debris';
    return null;
  }

  function makeHazard(type, s) {
    const side = Math.random() < 0.5 ? -1 : 1;
    return {
      type,
      x: s.x + side * 25 + (Math.random() - 0.5) * 10,
      y: s.y + (Math.random() - 0.3) * 30,
      vx: -side * (3 + Math.random() * 4),
      vy: type === 'debris' ? (Math.random() - 0.5) * 4 : (Math.random() - 0.5) * 2,
      radius: type === 'lightning' ? 1.2 : 0.8,
      t: 0,
      dead: false,
    };
  }

  // ---- render ---------------------------------------------------------------
  function render(dt) {
    const ctx = F.ctx;
    const c = F.canvas;
    const W = c.clientWidth, H = c.clientHeight;
    const s = F.sim;
    const altFt = s.y * M_TO_FT;

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
    } else if (h.type === 'lightning') {
      ctx.fillStyle = '#ffff88';
      ctx.fillRect(x, y - 20, 2, 8);
      ctx.fillRect(x - 4, y - 12, 6, 2);
      ctx.fillRect(x - 2, y - 10, 2, 8);
      ctx.fillRect(x + 2, y - 4, 4, 2);
      ctx.fillRect(x, y - 2, 2, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y - 18, 2, 4);
    } else if (h.type === 'debris') {
      ctx.fillStyle = '#777';
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(x - 2, y - 2, 2, 2);
      ctx.fillStyle = '#333';
      ctx.fillRect(x, y, 4, 2);
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
    const totalH = rocket.parts.reduce((sum, pid) => {
      const p = Parts.byId(pid);
      return sum + (p ? p.height : 0);
    }, 0) * STACK_SCALE;

    // bottom of rocket centered at translated origin (so center of mass at origin-ish)
    let cursor = totalH / 2;
    rocket.parts.forEach((pid, i) => {
      const p = Parts.byId(pid);
      if (!p) return;
      const eng = sim.engines.find(e => e.id === pid);
      const isAlive = eng ? eng.alive : true;
      if (p.category === 'engine' && !isAlive) {
        ctx.globalAlpha = 0.5;
      }
      p.sprite(ctx, 0, cursor, STACK_SCALE, { thrusting: thrusting && isAlive, t });
      ctx.globalAlpha = 1;
      cursor -= p.height * STACK_SCALE;
    });

    // fins on bottom-most body
    if (rocket.finId) {
      const fin = Parts.byId(rocket.finId);
      // find bottom-most body's bottom y
      let yCursor = totalH / 2;
      let bodyBottom = null;
      for (let i = 0; i < rocket.parts.length; i++) {
        const p = Parts.byId(rocket.parts[i]);
        if (!p) continue;
        if (p.category === 'body' && bodyBottom === null) bodyBottom = yCursor;
        yCursor -= p.height * STACK_SCALE;
      }
      if (bodyBottom !== null) fin.sprite(ctx, 0, bodyBottom, STACK_SCALE, null);
    }

    // nose cone
    let topCursor = totalH / 2 - rocket.parts.reduce((sum, pid) => {
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
  }

  global.Flight = { enter, exit };
})(window);
