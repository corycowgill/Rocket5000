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

    ensureSlots(Game);
    // load the rocket from the active slot every time we enter the hangar
    State.rocket = loadActiveSlot(Game);

    if (!State.initialized) {
      bindUI(Game);
      State.initialized = true;
    }
    State.selectedCat = 'engine';
    State.selectedPartId = null;
    renderSlotTabs(Game);
    renderPartsPanel(Game);
    redraw();
    updateStats();
    refreshTopbar(Game);
    window.addEventListener('resize', () => { fitCanvas(); redraw(); });
  }

  // ---- build slots ----------------------------------------------------------
  function ensureSlots(Game) {
    const st = Game.state;
    if (!Array.isArray(st.buildSlots) || st.buildSlots.length !== 3) {
      st.buildSlots = [
        { label: 'ALPHA',   rocket: null },
        { label: 'BRAVO',   rocket: null },
        { label: 'CHARLIE', rocket: null },
      ];
    }
    if (typeof st.activeSlot !== 'number' || st.activeSlot < 0 || st.activeSlot > 2) {
      st.activeSlot = 0;
    }
    // legacy single-build migration: if no slot has a rocket and there's a
    // lastBuild, copy it into slot 0 once
    const empty = st.buildSlots.every(s => !s.rocket);
    if (empty && st.lastBuild && Array.isArray(st.lastBuild.parts)) {
      st.buildSlots[0].rocket = { ...st.lastBuild };
      st.lastBuild = null;
      Storage.save(st);
    }
  }

  function loadActiveSlot(Game) {
    const st = Game.state;
    const slot = st.buildSlots[st.activeSlot];
    if (slot && slot.rocket && Array.isArray(slot.rocket.parts)) {
      return { ...slot.rocket };
    }
    return defaultRocket();
  }

  function switchSlot(Game, idx) {
    if (idx === Game.state.activeSlot) return;
    // persist current build into its slot before switching
    saveBuild(Game);
    Game.state.activeSlot = idx;
    Storage.save(Game.state);
    State.rocket = loadActiveSlot(Game);
    State.selectedPartId = null;
    State.hoverIndex = -1;
    renderSlotTabs(Game);
    redraw();
    updateStats();
    Game.showToast('SLOT ' + Game.state.buildSlots[idx].label);
  }

  function renderSlotTabs(Game) {
    $$('.slot-tab').forEach(tab => {
      const idx = parseInt(tab.dataset.slot, 10);
      const slot = Game.state.buildSlots[idx];
      tab.classList.toggle('active', idx === Game.state.activeSlot);
      tab.classList.toggle('has-build', !!(slot && slot.rocket && slot.rocket.parts && slot.rocket.parts.length));
      tab.title = slot ? (slot.label + (slot.rocket?.name ? ' — ' + slot.rocket.name : ' — empty')) : '';
    });
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

    $$('.slot-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const idx = parseInt(tab.dataset.slot, 10);
        switchSlot(Game, idx);
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
      // Stage-aware ordering: the body/payload always rides on top, but engines
      // and fuel keep the order you place them so you can stack real stages
      // (engine → fuel → engine → fuel → …). A new engine placed on top of a
      // fuel tank begins the next stage up. New body parts go to the very top;
      // new engine/fuel slot in just below the bottom-most body part.
      let insertAt = State.rocket.parts.length;
      if (part.category !== 'body') {
        for (let i = 0; i < State.rocket.parts.length; i++) {
          const existing = Parts.byId(State.rocket.parts[i]);
          if (existing && existing.category === 'body') {
            insertAt = i;
            break;
          }
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
    const snapshot = { name: State.rocket.name, parts: State.rocket.parts.slice(), finId: State.rocket.finId };
    if (Array.isArray(Game.state.buildSlots) && Game.state.buildSlots[Game.state.activeSlot]) {
      Game.state.buildSlots[Game.state.activeSlot].rocket = snapshot;
    }
    Storage.save(Game.state);
    if ($('.slot-tab')) renderSlotTabs(Game);
  }

  // ---- layout / hit testing -------------------------------------------------
  function getStackLayout() {
    // Returns { cx, groundY, scale, items: [{partId, top, bottom, height}] }
    // The scale shrinks below STACK_SCALE once a tall rocket would grow past the
    // top of the canvas. Without this, extra parts render off-screen where they
    // can't be seen OR clicked to remove — the stack has no part-count cap.
    const cx = State.canvas.width / 2;
    const groundY = State.canvas.height - 60;
    const HEADROOM = 34;              // leave room for the nose cone + ghost
    let spriteH = 0;
    State.rocket.parts.forEach(pid => {
      const part = Parts.byId(pid);
      if (part) spriteH += part.height;
    });
    const avail = groundY - HEADROOM;
    const scale = (spriteH * STACK_SCALE > avail && spriteH > 0)
      ? Math.max(0.35, avail / spriteH)
      : STACK_SCALE;
    const items = [];
    let cursorY = groundY;
    State.rocket.parts.forEach(pid => {
      const part = Parts.byId(pid);
      if (!part) return;
      const h = part.height * scale;
      items.push({ partId: pid, top: cursorY - h, bottom: cursorY, height: h });
      cursorY -= h;
    });
    return { cx, groundY, scale, items, topY: cursorY };
  }

  function hitTestStack(x, y) {
    const layout = getStackLayout();
    const halfW = 18 * layout.scale;
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
    const sc = layout.scale;
    const halfW = 36 * sc;
    return (y >= bottom.top && y <= bottom.bottom &&
            (x < layout.cx - 18 * sc && x > layout.cx - halfW ||
             x > layout.cx + 18 * sc && x < layout.cx + halfW));
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

    // stage bands — make the auto-stacked stage grouping visible while building.
    // STAGE 1 is the bottom (first to drop); each engine-on-fuel starts the next.
    const stages = Parts.computeStages(State.rocket.parts);
    if (stages.length >= 2 && layout.items.length) {
      const bandFill = ['rgba(90,150,255,0.07)', 'rgba(255,140,70,0.07)'];
      const bandEdge = ['rgba(120,180,255,0.55)', 'rgba(255,170,90,0.55)'];
      const halfBand = 22 * layout.scale;
      let stageNo = 0;
      stages.forEach((st, si) => {
        const bandBottom = layout.items[st.idxs[0]].bottom;                  // lowest part
        const bandTop = layout.items[st.idxs[st.idxs.length - 1]].top;       // highest part
        const midY = (bandTop + bandBottom) / 2;
        ctx.fillStyle = bandFill[si % bandFill.length];
        ctx.fillRect(cx - halfBand, bandTop, halfBand * 2, bandBottom - bandTop);
        // dashed divider between this stage and the one above it
        if (si < stages.length - 1) {
          ctx.strokeStyle = bandEdge[si % bandEdge.length];
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(cx - halfBand, bandTop);
          ctx.lineTo(cx + halfBand, bandTop);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // label on the left: powered groups are numbered stages, bottom→top
        const label = st.engineCount > 0 ? ('STAGE ' + (++stageNo)) : 'PAYLOAD';
        ctx.fillStyle = bandEdge[si % bandEdge.length];
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(label, cx - halfBand - 8, midY);
        // flag a stage that has an engine but no fuel above it
        if (st.engineCount > 0 && st.fuelCount === 0) {
          ctx.fillStyle = 'rgba(255,90,90,0.95)';
          ctx.textAlign = 'left';
          ctx.fillText('⚠ no fuel', cx + halfBand + 8, midY);
        }
      });
      ctx.textAlign = 'center';
    }

    layout.items.forEach((item, i) => {
      const part = Parts.byId(item.partId);
      const isThrusting = (part.category === 'engine'); // mock animation in builder
      part.sprite(ctx, layout.cx, item.bottom, layout.scale, { thrusting: false, t: 0 });

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
        finPart.sprite(ctx, layout.cx, lowestBody.bottom + 6, layout.scale, null);
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
        part.sprite(ctx, cx, ghostBottom, layout.scale, null);
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
    const twr = wetMass > 0 ? (thrust * 18) / (wetMass * 9.8) : 0;
    const stabPct = Math.min(100, Math.round(stability));
    const jankAvg = engineCount > 0 ? Math.round(jank / engineCount) : 0;
    // staging: a "stage" is a powered group (its own engine + the fuel above it)
    const stages = Parts.computeStages(rocket.parts);
    const stageCount = stages.filter(st => st.engineCount > 0).length;
    return { mass, thrust, capacity, stability: stabPct, jank: jankAvg, hullBonus, engineCount, fuelCount, bodyCount, twr, stages, stageCount };
  }

  function updateStats() {
    const s = getStats(State.rocket);
    $('#stat-mass').textContent = s.mass.toFixed(0) + ' kg';
    $('#stat-thrust').textContent = s.thrust.toFixed(0) + ' kN';
    $('#stat-twr').textContent = s.twr.toFixed(2);
    $('#stat-fuel').textContent = s.capacity + ' L';
    $('#stat-stages').textContent = s.stageCount;
    $('#stat-stab').textContent = s.stability + '%';
    $('#stat-jank').textContent = s.jank + '%';
    $('#rocket-name').textContent = State.rocket.name;

    // personality
    $('#rocket-personality').textContent = computePersonality(s);

    // flight assessment + altitude estimate
    const a = assessFlight(State.rocket, s);
    const led = $('#assess-led');
    led.classList.remove('go', 'marginal', 'nogo');
    led.classList.add(a.status);
    $('#assess-status').textContent = a.statusLabel;
    const issuesEl = $('#assess-issues');
    issuesEl.innerHTML = '';
    a.issues.forEach(it => {
      const li = document.createElement('li');
      li.textContent = it.text;
      if (it.kind === 'crit') li.classList.add('crit');
      else if (it.kind === 'warn') li.classList.add('warn');
      issuesEl.appendChild(li);
    });
    $('#assess-estimate').innerHTML = a.estimate || '';

    const v = validate(State.rocket);
    const launchBtn = $('#btn-launch');
    launchBtn.disabled = !v.ok;
    launchBtn.textContent = v.ok ? 'LAUNCH ↑' : v.reason.toUpperCase();
  }

  // Flight assessment: GO / MARGINAL / NO-GO + specific issues + altitude
  // estimate. Player should be able to glance at this and know whether the
  // rocket will fly and roughly how high.
  function assessFlight(rocket, s) {
    const issues = [];
    let status = 'go';
    const upgrade = (status, next) => {
      const order = { go: 0, marginal: 1, nogo: 2 };
      if (order[next] > order[status]) return next;
      return status;
    };

    if (s.engineCount === 0) { issues.push({ kind: 'crit', text: 'Add an engine' }); status = upgrade(status, 'nogo'); }
    if (s.fuelCount === 0)   { issues.push({ kind: 'crit', text: 'Add a fuel tank' }); status = upgrade(status, 'nogo'); }
    if (s.bodyCount === 0)   { issues.push({ kind: 'crit', text: 'Add a body / cockpit' }); status = upgrade(status, 'nogo'); }
    if (s.engineCount > 0 && s.fuelCount > 0 && s.bodyCount > 0) {
      if (s.twr < 1)             { issues.push({ kind: 'crit', text: 'TWR < 1.0 — won\'t lift off' }); status = upgrade(status, 'nogo'); }
      else if (s.twr < 1.3)      { issues.push({ kind: 'warn', text: 'TWR < 1.3 — marginal liftoff' }); status = upgrade(status, 'marginal'); }
      if (s.twr > 6)             { issues.push({ kind: 'warn', text: 'TWR very high — fuel will burn fast' }); }
      if (s.stability < 25)      { issues.push({ kind: 'warn', text: 'Low stability — expect heavy wobble' }); status = upgrade(status, 'marginal'); }
      if (s.jank > 60)           { issues.push({ kind: 'warn', text: 'High jank — engine failure risk' }); status = upgrade(status, 'marginal'); }
      if (!rocket.finId)         { issues.push({ kind: 'warn', text: 'No fins — sluggish steering' }); status = upgrade(status, 'marginal'); }
      if (s.capacity < 80)       { issues.push({ kind: 'warn', text: 'Limited fuel — short burn' }); }
      // staging guidance — a stage needs its own engine AND fuel above it
      const deadStage = s.stages.some(st => st.engineCount > 0 && st.fuelCount === 0);
      if (deadStage) {
        issues.push({ kind: 'warn', text: 'A stage has an engine but no fuel above it' });
        status = upgrade(status, 'marginal');
      }
      if (s.stageCount === 1) {
        issues.push({ kind: 'info', text: 'Single stage — stack engine→fuel→engine→fuel for more' });
      } else if (s.stageCount >= 2) {
        issues.push({ kind: 'info', text: s.stageCount + ' stages — drop spent ones with S in flight' });
      }
    }

    // Altitude estimate — only if it can lift
    let estimate = '';
    if (status !== 'nogo' && s.engineCount && s.fuelCount && s.bodyCount && s.twr >= 1) {
      const altFt = estimateApogeeFt(rocket) ;
      estimate = 'EST. APOGEE  <b>~' + formatAltitude(altFt) + '</b>'
               + (s.stageCount >= 2 ? '  <small>(staged)</small>' : '');
    }

    const statusLabel = status === 'go'        ? '★ READY FOR LAUNCH'
                      : status === 'marginal'  ? '⚠ MARGINAL — CAN LAUNCH'
                                               : '✕ NO-GO';
    return { status, statusLabel, issues, estimate };
  }

  // Estimate apogee by integrating the same physics the flight sim uses:
  // all attached engines fire, fuel drains bottom-tank-first, drag falls off
  // with altitude, and stages are dropped as soon as they run dry. The old
  // closed-form guess assumed a single burn and no drag, so it badly
  // under-reported multi-stage rockets — the exact builds staging rewards.
  // Vertical, full-throttle, no engine failures: an optimistic-but-honest ceiling.
  function estimateApogeeFt(rocket) {
    const GRAVITY = 9.8, THRUST_GAIN = 18, FUEL_MASS_PER_L = 0.05;
    const upg = (typeof Game !== 'undefined' && Game.getUpgrades) ? Game.getUpgrades() : {};
    const massMul   = 1 - 0.05 * (upg.lightweight || 0);
    const thrustMul = 1 + 0.05 * (upg.turbofuel   || 0);
    const burnMul   = 1 - 0.08 * (upg.efficient   || 0);

    const parts = rocket.parts;
    const dropped = {};
    const tank = {};
    parts.forEach((pid, i) => {
      const p = Parts.byId(pid);
      if (p && p.category === 'fuel') tank[i] = p.capacity;
    });
    let finMass = 0;
    if (rocket.finId) {
      const f = Parts.byId(rocket.finId);
      if (f) finMass = f.mass;
    }
    const attached = () => parts.map((_, i) => i).filter(i => !dropped[i] && Parts.byId(parts[i]));
    const dryMass = () => (attached().reduce((m, i) => m + Parts.byId(parts[i]).mass, 0) + finMass) * massMul;
    const totalFuel = () => attached().reduce((sum, i) => sum + (tank[i] || 0), 0);

    let y = 0, vy = 0, maxY = 0;
    const dt = 0.05;
    for (let step = 0; step < 24000; step++) {   // 20 min of flight, ample
      // optimal staging: drop the bottom stage the moment its tanks run dry
      const stages = Parts.computeStages(parts, dropped);
      if (stages.length >= 2 && stages.slice(1).some(st => st.engineCount > 0)) {
        const bottomFuel = stages[0].idxs.reduce((sum, i) => sum + (tank[i] || 0), 0);
        if (bottomFuel <= 0) stages[0].idxs.forEach(i => { dropped[i] = true; });
      }
      let thrust = 0, burn = 0;
      attached().forEach(i => {
        const p = Parts.byId(parts[i]);
        if (p.category === 'engine') { thrust += p.thrust; burn += p.burnRate; }
      });
      const fuelNow = totalFuel();
      const burning = fuelNow > 0 && thrust > 0;
      if (burning) {                              // drain lowest attached tank first
        let take = Math.min(burn * burnMul * dt, fuelNow);
        for (const i of attached()) {
          if (take <= 0) break;
          const have = tank[i] || 0;
          if (have <= 0) continue;
          const d = Math.min(have, take);
          tank[i] = have - d;
          take -= d;
        }
      }
      const mass = Math.max(0.01, dryMass() + totalFuel() * FUEL_MASS_PER_L);
      const aThrust = burning ? (thrust * thrustMul * THRUST_GAIN) / mass : 0;
      const airDensity = Math.max(0, 1 - (y / 1000) / 80);
      const drag = -0.0015 * airDensity * vy * Math.abs(vy);
      vy += (aThrust - GRAVITY + drag) * dt;
      y += vy * dt;
      if (y > maxY) maxY = y;
      if (vy < 0 && y <= 0) break;                // back on the ground
      if (!burning && vy < 0 && y < maxY * 0.5) break;   // clearly past apogee
    }
    return Math.max(0, maxY * 3.281);
  }

  function formatAltitude(ft) {
    if (ft >= 1_000_000) return (ft / 1_000_000).toFixed(2) + 'M ft';
    if (ft >= 1000)      return (ft / 1000).toFixed(1) + 'k ft';
    return Math.floor(ft) + ' ft';
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
