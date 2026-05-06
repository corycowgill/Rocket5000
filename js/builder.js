/* ==========================================================
   BUILDER — drag/click hangar.

   Rocket model: { name, parts: [partId, partId, ...] }
   parts ordered bottom→top. Engines must be at the bottom of
   the stack; fuel + body in the middle; fins are attached to
   the bottom-most body section (visually side-mounted).

   For MVP simplicity we use a SINGLE STACK with these rules:
     - exactly one fin slot (last placed fin replaces previous)
     - parts stack vertically; click empty area to add selected
     - click an existing part on the stack to remove it
   ========================================================== */
(function (global) {
  'use strict';

  const State = {
    rocket: null,         // { name, parts: [], finId }
    selectedPartId: null,
    selectedCat: 'engine',
    canvas: null,
    ctx: null,
    cssWidth: 640,
    cssHeight: 720,
    hoverIndex: -1,
    initialized: false,
  };

  const COLUMN_X = 0;       // computed in resize, centered
  const STACK_SCALE = 2;    // pixels per sprite px in builder

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }

  function defaultRocket() {
    return { name: randomName(), parts: [], finId: null };
  }

  const NAME_PARTS_A = ['Wobbly', 'Janky', 'Mighty', 'Doomed', 'Glorious', 'Spicy', 'Crusty', 'Yeet', 'Honest', 'Cursed'];
  const NAME_PARTS_B = ['Pigeon', 'Bottle', 'Boomer', 'Toaster', 'Pretzel', 'Spaghetti', 'Comet', 'Goblin', 'Donut', 'Trashcan'];
  function randomName() {
    return NAME_PARTS_A[Math.floor(Math.random() * NAME_PARTS_A.length)] + ' ' +
           NAME_PARTS_B[Math.floor(Math.random() * NAME_PARTS_B.length)];
  }

  function enter(Game) {
    State.canvas = $('#build-canvas');
    State.ctx = State.canvas.getContext('2d');
    State.ctx.imageSmoothingEnabled = false;
    fitCanvas();

    // restore last build if available and not sandbox
    if (!State.rocket) {
      const saved = Game.state.lastBuild;
      State.rocket = (saved && Array.isArray(saved.parts)) ? { ...saved } : defaultRocket();
    }

    if (!State.initialized) {
      bindUI(Game);
      State.initialized = true;
    }
    State.selectedCat = 'engine';
    State.selectedPartId = null;
    renderPartsPanel(Game);
    redraw();
    updateStats();
    refreshTopbar(Game);
    window.addEventListener('resize', () => { fitCanvas(); redraw(); });
  }

  function fitCanvas() {
    // Maintain logical 640x720 backing, scale by CSS
    const c = State.canvas;
    const parent = c.parentElement;
    const maxW = parent.clientWidth - 24;
    const maxH = parent.clientHeight - 80;
    let w = 640, h = 720;
    const ratio = w / h;
    if (maxW / ratio < maxH) {
      w = Math.min(640, maxW);
      h = w / ratio;
    } else {
      h = Math.min(720, maxH);
      w = h * ratio;
    }
    c.style.width = Math.floor(w) + 'px';
    c.style.height = Math.floor(h) + 'px';
    State.cssWidth = w;
    State.cssHeight = h;
  }

  function refreshTopbar(Game) {
    $('#hangar-scrap').textContent = 'SCRAP ' + Game.state.scrap;
    $('#hangar-data').textContent  = 'DATA '  + Game.state.data;
  }

  // ---- parts panel ----------------------------------------------------------
  function renderPartsPanel(Game) {
    $$('.parts-tabs .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.cat === State.selectedCat);
    });
    const list = $('#parts-list');
    list.innerHTML = '';
    Parts.byCategory(State.selectedCat).forEach(part => {
      const unlocked = Game.sandbox || Game.state.unlocked.indexOf(part.id) !== -1;
      const card = document.createElement('div');
      card.className = 'part-card' + (unlocked ? '' : ' locked') + (State.selectedPartId === part.id ? ' selected' : '');
      card.title = unlocked ? part.blurb : 'Locked: reach higher altitudes to unlock';

      // icon canvas
      const iconCanvas = document.createElement('canvas');
      iconCanvas.width = 40;
      iconCanvas.height = 40;
      iconCanvas.className = 'part-icon';
      const ictx = iconCanvas.getContext('2d');
      ictx.imageSmoothingEnabled = false;
      ictx.fillStyle = '#0a0d18';
      ictx.fillRect(0, 0, 40, 40);
      const sc = 1.0;
      part.sprite(ictx, 20, 36, sc, null);

      const info = document.createElement('div');
      info.className = 'part-info';
      const name = document.createElement('div');
      name.className = 'part-name';
      name.textContent = part.name;
      const stats = document.createElement('div');
      stats.className = 'part-stats';
      stats.textContent = partStatsLine(part);

      info.appendChild(name);
      info.appendChild(stats);

      card.appendChild(iconCanvas);
      card.appendChild(info);

      if (!unlocked) {
        const lock = document.createElement('div');
        lock.className = 'part-lock';
        lock.textContent = 'LOCKED';
        card.appendChild(lock);
      } else {
        card.addEventListener('click', () => {
          State.selectedPartId = (State.selectedPartId === part.id) ? null : part.id;
          renderPartsPanel(Game);
          updateReadout();
        });
      }

      list.appendChild(card);
    });
  }

  function partStatsLine(p) {
    if (p.category === 'engine') return `${p.thrust}kN · burn ${p.burnRate} · jank ${p.jank}`;
    if (p.category === 'fuel')   return `${p.capacity}L · ${p.mass}kg`;
    if (p.category === 'body')   return `stab ${p.stability} · hull +${p.hullBonus}`;
    if (p.category === 'fin')    return `stab ${p.stability} · ${p.mass}kg`;
    return '';
  }

  // ---- canvas / building ----------------------------------------------------
  function pointerToCanvas(evt) {
    const c = State.canvas;
    const rect = c.getBoundingClientRect();
    const t = evt.touches ? evt.touches[0] : evt;
    const x = (t.clientX - rect.left) * (c.width / rect.width);
    const y = (t.clientY - rect.top)  * (c.height / rect.height);
    return { x, y };
  }

  function bindUI(Game) {
    $$('.parts-tabs .tab').forEach(t => {
      t.addEventListener('click', () => {
        State.selectedCat = t.dataset.cat;
        State.selectedPartId = null;
        renderPartsPanel(Game);
        updateReadout();
      });
    });

    $('#btn-clear').addEventListener('click', () => {
      State.rocket = defaultRocket();
      saveBuild(Game);
      redraw();
      updateStats();
    });

    $('#btn-rename').addEventListener('click', () => {
      const newName = prompt('Name your rocket', State.rocket.name);
      if (newName && newName.trim()) {
        State.rocket.name = newName.trim().slice(0, 24);
        saveBuild(Game);
        $('#rocket-name').textContent = State.rocket.name;
      }
    });

    State.canvas.addEventListener('click', (e) => onCanvasClick(e, Game));
    State.canvas.addEventListener('mousemove', (e) => {
      const p = pointerToCanvas(e);
      const idx = hitTestStack(p.x, p.y);
      if (idx !== State.hoverIndex) {
        State.hoverIndex = idx;
        redraw();
      }
    });
    State.canvas.addEventListener('mouseleave', () => {
      State.hoverIndex = -1;
      redraw();
    });
  }

  function onCanvasClick(e, Game) {
    const p = pointerToCanvas(e);
    const idx = hitTestStack(p.x, p.y);

    // clicked existing stack part: remove it
    if (idx >= 0) {
      const removed = State.rocket.parts.splice(idx, 1)[0];
      saveBuild(Game);
      redraw();
      updateStats();
      Game.showToast('Removed ' + (Parts.byId(removed)?.name || 'part'));
      return;
    }

    // clicked side fin slot
    if (hitTestFinSlot(p.x, p.y) && State.selectedPartId) {
      const part = Parts.byId(State.selectedPartId);
      if (part && part.category === 'fin') {
        State.rocket.finId = part.id;
        saveBuild(Game);
        redraw();
        updateStats();
        Game.showToast('Fins: ' + part.name);
      }
      return;
    }

    // empty area: add selected part
    if (!State.selectedPartId) {
      Game.showToast('Pick a part on the left first');
      return;
    }
    const part = Parts.byId(State.selectedPartId);
    if (!part) return;
    if (part.category === 'fin') {
      State.rocket.finId = part.id;
    } else {
      // ordering rules: engines at bottom, then fuel, then body
      const order = { engine: 0, fuel: 1, body: 2 };
      const pri = order[part.category];
      let insertAt = State.rocket.parts.length;
      for (let i = 0; i < State.rocket.parts.length; i++) {
        const existing = Parts.byId(State.rocket.parts[i]);
        if (!existing) continue;
        if (order[existing.category] > pri) {
          insertAt = i;
          break;
        }
      }
      State.rocket.parts.splice(insertAt, 0, part.id);
    }
    saveBuild(Game);
    redraw();
    updateStats();
    Sfx.play('snap');
  }

  function saveBuild(Game) {
    Game.state.lastBuild = { name: State.rocket.name, parts: State.rocket.parts.slice(), finId: State.rocket.finId };
    Storage.save(Game.state);
  }

  // ---- layout / hit testing -------------------------------------------------
  function getStackLayout() {
    // Returns { cx, groundY, items: [{partId, top, bottom, height}] }
    const cx = State.canvas.width / 2;
    const groundY = State.canvas.height - 60;
    const items = [];
    let cursorY = groundY;
    State.rocket.parts.forEach(pid => {
      const part = Parts.byId(pid);
      if (!part) return;
      const h = part.height * STACK_SCALE;
      items.push({ partId: pid, top: cursorY - h, bottom: cursorY, height: h });
      cursorY -= h;
    });
    return { cx, groundY, items, topY: cursorY };
  }

  function hitTestStack(x, y) {
    const layout = getStackLayout();
    const halfW = 18 * STACK_SCALE;
    if (x < layout.cx - halfW || x > layout.cx + halfW) return -1;
    for (let i = 0; i < layout.items.length; i++) {
      const it = layout.items[i];
      if (y >= it.top && y <= it.bottom) return i;
    }
    return -1;
  }

  function hitTestFinSlot(x, y) {
    const layout = getStackLayout();
    if (layout.items.length === 0) return false;
    const bottom = layout.items[0];
    const halfW = 36 * STACK_SCALE;
    return (y >= bottom.top && y <= bottom.bottom &&
            (x < layout.cx - 18 * STACK_SCALE && x > layout.cx - halfW ||
             x > layout.cx + 18 * STACK_SCALE && x < layout.cx + halfW));
  }

  // ---- drawing --------------------------------------------------------------
  function redraw() {
    const ctx = State.ctx;
    const W = State.canvas.width, H = State.canvas.height;

    // background
    ctx.fillStyle = '#0a0d18';
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.fillStyle = '#161c34';
    for (let y = 0; y < H; y += 16) ctx.fillRect(0, y, W, 1);
    for (let x = 0; x < W; x += 16) ctx.fillRect(x, 0, 1, H);

    // ground
    ctx.fillStyle = '#3a2614';
    ctx.fillRect(0, H - 60, W, 60);
    ctx.fillStyle = '#5a3820';
    ctx.fillRect(0, H - 60, W, 4);

    // launchpad
    const cx = W / 2;
    ctx.fillStyle = '#666';
    ctx.fillRect(cx - 56, H - 64, 112, 4);
    ctx.fillStyle = '#222';
    for (let i = -2; i <= 2; i += 1) ctx.fillRect(cx + i * 22 - 2, H - 60, 4, 8);

    // hint text if empty
    if (State.rocket.parts.length === 0) {
      ctx.fillStyle = '#3a4470';
      ctx.font = 'bold 16px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SELECT AN ENGINE → CLICK HERE', cx, H - 200);
      ctx.fillText('STACK ENGINES, FUEL, BODY', cx, H - 180);
    }

    // draw stack (bottom-up)
    const layout = getStackLayout();
    layout.items.forEach((item, i) => {
      const part = Parts.byId(item.partId);
      const isThrusting = (part.category === 'engine'); // mock animation in builder
      part.sprite(ctx, layout.cx, item.bottom, STACK_SCALE, { thrusting: false, t: 0 });

      if (i === State.hoverIndex) {
        ctx.fillStyle = '#ff5577';
        ctx.fillRect(layout.cx - 36, item.top - 1, 72, 2);
        ctx.fillRect(layout.cx - 36, item.bottom - 1, 72, 2);
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('CLICK TO REMOVE', layout.cx, item.top - 6);
      }
    });

    // draw fins on bottom-most body if equipped
    if (State.rocket.finId) {
      const finPart = Parts.byId(State.rocket.finId);
      const lowestBody = layout.items.find(it => Parts.byId(it.partId).category === 'body') || layout.items[0];
      if (lowestBody) {
        finPart.sprite(ctx, layout.cx, lowestBody.bottom + 6, STACK_SCALE, null);
      }
    }

    // draw nose cone
    if (layout.items.length > 0) {
      const top = layout.items[layout.items.length - 1].top;
      ctx.fillStyle = '#cc4444';
      ctx.fillRect(cx - 12, top - 8, 24, 8);
      ctx.fillRect(cx - 8, top - 16, 16, 8);
      ctx.fillRect(cx - 4, top - 22, 8, 6);
      ctx.fillStyle = '#552211';
      ctx.fillRect(cx - 12, top - 8, 24, 1);
    }

    // selected part preview ghost (top of column)
    if (State.selectedPartId && State.hoverIndex < 0) {
      const part = Parts.byId(State.selectedPartId);
      if (part && part.category !== 'fin') {
        ctx.globalAlpha = 0.4;
        const ghostBottom = layout.topY;
        part.sprite(ctx, cx, ghostBottom, STACK_SCALE, null);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---- stats ---------------------------------------------------------------
  function getStats(rocket) {
    let mass = 0, thrust = 0, capacity = 0, stability = 0, jank = 0, hullBonus = 0;
    let engineCount = 0, fuelCount = 0, bodyCount = 0;
    rocket.parts.forEach(pid => {
      const p = Parts.byId(pid);
      if (!p) return;
      mass += p.mass;
      if (p.category === 'engine') {
        thrust += p.thrust;
        jank += p.jank;
        engineCount++;
      }
      if (p.category === 'fuel') {
        capacity += p.capacity;
        fuelCount++;
      }
      if (p.category === 'body') {
        stability += p.stability || 0;
        hullBonus += p.hullBonus || 0;
        bodyCount++;
      }
    });
    if (rocket.finId) {
      const f = Parts.byId(rocket.finId);
      if (f) {
        mass += f.mass;
        stability += f.stability;
      }
    }
    // R&D upgrades — applied if available via Game.getUpgrades()
    const upg = (typeof Game !== 'undefined' && Game.getUpgrades) ? Game.getUpgrades() : {};
    if (upg.lightweight) mass    *= (1 - 0.05 * upg.lightweight);
    if (upg.turbofuel)   thrust  *= (1 + 0.05 * upg.turbofuel);
    const fuelMass = capacity * 0.05;
    const wetMass = mass + fuelMass;
    const twr = wetMass > 0 ? (thrust * 12) / (wetMass * 9.8) : 0;
    const stabPct = Math.min(100, Math.round(stability));
    const jankAvg = engineCount > 0 ? Math.round(jank / engineCount) : 0;
    return { mass, thrust, capacity, stability: stabPct, jank: jankAvg, hullBonus, engineCount, fuelCount, bodyCount, twr };
  }

  function updateStats() {
    const s = getStats(State.rocket);
    $('#stat-mass').textContent = s.mass.toFixed(0) + ' kg';
    $('#stat-thrust').textContent = s.thrust.toFixed(0) + ' kN';
    $('#stat-twr').textContent = s.twr.toFixed(2);
    $('#stat-fuel').textContent = s.capacity + ' L';
    $('#stat-stages').textContent = s.fuelCount;
    $('#stat-stab').textContent = s.stability + '%';
    $('#stat-jank').textContent = s.jank + '%';
    $('#rocket-name').textContent = State.rocket.name;

    // personality
    $('#rocket-personality').textContent = computePersonality(s);

    const v = validate(State.rocket);
    const launchBtn = $('#btn-launch');
    launchBtn.disabled = !v.ok;
    launchBtn.textContent = v.ok ? 'LAUNCH ↑' : v.reason.toUpperCase();
  }

  function updateReadout() {
    const sel = State.selectedPartId ? Parts.byId(State.selectedPartId) : null;
    const r = $('#build-readout');
    if (!sel) {
      r.textContent = State.rocket.parts.length
        ? 'Click a part on the rocket to remove. Click empty space to add.'
        : 'Pick a part on the left to begin.';
      return;
    }
    r.textContent = sel.name + ' — ' + sel.blurb;
  }

  function computePersonality(s) {
    if (s.engineCount === 0) return 'Hopeful but inert';
    const traits = [];
    if (s.twr > 3.5) traits.push('explodes off the pad');
    else if (s.twr > 1.8) traits.push('punchy');
    else if (s.twr > 1.1) traits.push('struggling');
    else traits.push('barely moves');
    if (s.stability > 60) traits.push('stable');
    else if (s.stability > 30) traits.push('wobbly');
    else traits.push('drunken');
    if (s.jank > 60) traits.push('unhinged');
    else if (s.jank > 30) traits.push('eccentric');
    else traits.push('predictable');
    return '"' + traits.join(', ') + '"';
  }

  function validate(rocket) {
    const s = getStats(rocket);
    if (s.engineCount === 0) return { ok: false, reason: 'Need an engine' };
    if (s.fuelCount === 0)   return { ok: false, reason: 'Need fuel' };
    if (s.bodyCount === 0)   return { ok: false, reason: 'Need a body' };
    if (s.twr < 0.5)         return { ok: false, reason: 'Too heavy to lift' };
    return { ok: true };
  }

  function getCurrentRocket() {
    const stats = getStats(State.rocket);
    return {
      name: State.rocket.name,
      parts: State.rocket.parts.slice(),
      finId: State.rocket.finId,
      stats,
    };
  }

  global.Builder = {
    enter, getCurrentRocket, validate, getStats,
  };
})(window);
