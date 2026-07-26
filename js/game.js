/* ==========================================================
   GAME — top-level state machine, navigation, app glue
   ========================================================== */
(function () {
  'use strict';

  const Game = {
    state: null,
    currentScreen: 'title',
    sandbox: false,
    lastResult: null,
    toastTimer: null,
  };

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }

  function go(screen) {
    Game.currentScreen = screen;
    $$('.screen').forEach(el => el.classList.remove('active'));
    const target = $('#screen-' + screen);
    if (target) target.classList.add('active');
    if (screen === 'title') {
      Game.sandbox = false;
      Game.activeChallenge = null;
      refreshTitle();
    }
    if (screen === 'hangar') Builder.enter(Game);
    if (screen === 'flight') Flight.enter(Game);
    if (screen === 'challenges') renderChallenges();
    if (screen === 'workshop') renderWorkshop();
    if (screen === 'records') renderRecords();
  }

  // ---- achievements + lifetime stats -----------------------------------
  const ACHIEVEMENTS = [
    { id: 'first_launch',   name: 'First Liftoff',          icon: '▲',   reward: 50,  desc: 'Complete your first launch.' },
    { id: 'crash_10',       name: 'Plenty of Practice',     icon: '✕',   reward: 100, desc: 'Crash 10 rockets total.' },
    { id: 'crash_100',      name: 'Spectacularly Persistent', icon: '☠', reward: 1000, desc: 'Crash 100 rockets total.' },
    { id: 'alt_5k',         name: 'Cleared the Clouds',     icon: '☁',   reward: 100, desc: 'Reach 5,000 ft in one launch.' },
    { id: 'alt_50k',        name: 'Stratosphere',           icon: '⌃',   reward: 200, desc: 'Reach 50,000 ft in one launch.' },
    { id: 'alt_100k',       name: 'Karman Line',            icon: '◬',   reward: 400, desc: 'Reach 100,000 ft in one launch.' },
    { id: 'alt_500k',       name: 'Halfway There',          icon: '◐',   reward: 800, desc: 'Reach 500,000 ft in one launch.' },
    { id: 'moonshot',       name: 'One Small Step',         icon: '◯',   reward: 2000, desc: 'Touch the moon for the first time.' },
    { id: 'mach_1',         name: 'Mach 1',                 icon: '⏵',   reward: 150, desc: 'Break the sound barrier in atmosphere.' },
    { id: 'combo_5',        name: 'Pilot',                  icon: '★',   reward: 100, desc: 'Reach a PILOT combo of 5.' },
    { id: 'combo_10',       name: 'Ace Pilot',              icon: '✦',   reward: 300, desc: 'Reach a PILOT combo of 10.' },
    { id: 'stage_3',        name: 'Three-Stage',            icon: '⇊',   reward: 200, desc: 'Drop 3 stages in one run.' },
    { id: 'pickup_10',      name: 'Magpie',                 icon: '◇',   reward: 100, desc: 'Collect 10 pickups in one run.' },
    { id: 'pickup_100',     name: 'Hoarder',                icon: '◈',   reward: 500, desc: 'Collect 100 pickups lifetime.' },
    { id: 'upgrade_first',  name: 'R&D',                    icon: '⚙',   reward: 50,  desc: 'Install your first upgrade.' },
    { id: 'upgrade_max',    name: 'Maxed Out',              icon: '⚡',  reward: 500, desc: 'Max out any upgrade to level 3.' },
    { id: 'ability_use',    name: 'Field Tested',           icon: '+',   reward: 50,  desc: 'Trigger any consumable mid-flight.' },
    { id: 'storm_survive',  name: 'Storm Chaser',           icon: '⚐',   reward: 200, desc: 'Reach 10,000 ft during THUNDERSTORM.' },
    { id: 'aurora_run',     name: 'Aurora Borealis',        icon: '〰',   reward: 200, desc: 'Reach 100,000 ft during AURORA.' },
    { id: 'scrap_10k',      name: 'Junk Tycoon',            icon: '$',   reward: 500, desc: 'Earn 10,000 lifetime scrap.' },
  ];
  Game.ACHIEVEMENTS = ACHIEVEMENTS;

  function ensureRecordsState() {
    Game.state.achievements = Game.state.achievements || {};
    Game.state.stats = Game.state.stats || {
      totalLaunches: 0, totalMoonshots: 0, totalCrashes: 0,
      totalPickups: 0, totalStages: 0, totalScrapEarned: 0,
      highestCombo: 0, highestMach: 0,
    };
  }

  Game.unlockAchievement = function (id) {
    // Sandbox is a consequence-free test range: it hands out maxed upgrades and
    // unlimited consumables, so banking achievement scrap there would let you
    // claim rewards you never earned. applyResult already skips rewards for
    // sandbox runs, but combo/mach/ability unlocks fire from flight directly.
    if (Game.sandbox) return false;
    ensureRecordsState();
    if (Game.state.achievements[id]) return false;
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (!a) return false;
    Game.state.achievements[id] = Date.now();
    Game.state.scrap += a.reward;
    Game.state.stats.totalScrapEarned = (Game.state.stats.totalScrapEarned || 0) + a.reward;
    Storage.save(Game.state);
    showToast('★ ACHIEVEMENT · ' + a.name + ' (+' + a.reward + ' SC)', 3500);
    Sfx.play('win');
    return true;
  };

  function renderRecords() {
    ensureRecordsState();
    const st = Game.state.stats;
    const fmt = (n, suffix) => (n || 0).toLocaleString() + (suffix || '');

    // lifetime stats
    const stats = $('#lifetime-stats');
    stats.innerHTML = '';
    const items = [
      ['BEST APOGEE', formatFt(Game.state.bestAltitude)],
      ['LAUNCHES', fmt(st.totalLaunches)],
      ['MOONSHOTS', fmt(st.totalMoonshots)],
      ['CRASHES', fmt(st.totalCrashes)],
      ['PICKUPS', fmt(st.totalPickups)],
      ['STAGES', fmt(st.totalStages)],
      ['SCRAP EARNED', fmt(st.totalScrapEarned)],
      ['BEST COMBO', '×' + (st.highestCombo || 0)],
    ];
    items.forEach(([k, v]) => {
      const li = document.createElement('li');
      li.innerHTML = '<span>' + k + '</span><b>' + v + '</b>';
      stats.appendChild(li);
    });

    // achievements
    const grid = $('#achievements-grid');
    grid.innerHTML = '';
    let unlocked = 0;
    ACHIEVEMENTS.forEach(a => {
      const has = !!Game.state.achievements[a.id];
      if (has) unlocked++;
      const card = document.createElement('div');
      card.className = 'achievement-card' + (has ? '' : ' locked');
      card.innerHTML = `
        <div class="ach-icon">${a.icon}</div>
        <div class="ach-info">
          <div class="ach-name">${a.name}</div>
          <div class="ach-desc">${a.desc}</div>
          <span class="ach-reward">${has ? 'UNLOCKED · +' + a.reward + ' SC' : '+' + a.reward + ' SC'}</span>
        </div>
      `;
      grid.appendChild(card);
    });
    $('#ach-progress').textContent = unlocked + ' / ' + ACHIEVEMENTS.length;
  }

  // ---- workshop / persistent upgrades ----------------------------------
  const UPGRADES = [
    { id: 'precision',  name: 'Precision Engineering', max: 3, baseCost: 200,
      effect: lvl => 'Engine break chance −' + (lvl * 10) + '%' },
    { id: 'lightweight', name: 'Lightweight Materials', max: 3, baseCost: 250,
      effect: lvl => 'Rocket dry mass −' + (lvl * 5) + '%' },
    { id: 'turbofuel',  name: 'Turbo Fuel Mix', max: 3, baseCost: 300,
      effect: lvl => 'Engine thrust +' + (lvl * 5) + '%' },
    { id: 'hull',       name: 'Reinforced Hull', max: 3, baseCost: 250,
      effect: lvl => 'Base hull +' + (lvl * 25) },
    { id: 'efficient',  name: 'Efficient Combustion', max: 3, baseCost: 350,
      effect: lvl => 'Burn rate −' + (lvl * 8) + '%' },
    { id: 'magnet',     name: 'Aerial Magnet', max: 3, baseCost: 200,
      effect: lvl => 'Pickup attraction +' + (lvl * 30) + '%' },
    { id: 'telemetry',  name: 'Telemetry Uplink', max: 3, baseCost: 400,
      effect: lvl => 'Data earned +' + (lvl * 15) + '%' },
  ];
  Game.UPGRADES = UPGRADES;

  function upgradeCost(u, lvl) {
    // 1: base, 2: 3x base, 3: 7x base
    if (lvl >= u.max) return -1;
    return u.baseCost * (lvl === 0 ? 1 : (lvl === 1 ? 3 : 7));
  }

  function renderWorkshop() {
    $('#workshop-scrap').textContent = 'SCRAP ' + Game.state.scrap;
    $('#workshop-data').textContent  = 'DATA '  + Game.state.data;
    const grid = $('#upgrade-grid');
    grid.innerHTML = '';
    Game.state.upgrades = Game.state.upgrades || {};
    UPGRADES.forEach(u => {
      const lvl = Game.state.upgrades[u.id] || 0;
      const cost = upgradeCost(u, lvl);
      const card = document.createElement('div');
      card.className = 'upgrade-card' + (lvl >= u.max ? ' maxed' : '');
      const pips = Array.from({ length: u.max })
        .map((_, i) => `<div class="pip ${i < lvl ? 'lit' : ''}"></div>`).join('');
      const nextLvl = Math.min(u.max, lvl + 1);
      const effectText = lvl > 0 ? u.effect(lvl) + (lvl < u.max ? '   →   ' + u.effect(nextLvl) : '') : u.effect(nextLvl);
      card.innerHTML = `
        <h4>${u.name}</h4>
        <div class="upgrade-effect">${effectText}</div>
        <div class="upgrade-pips">${pips}</div>
        <div class="upgrade-cost">
          <span class="cost-label">${lvl >= u.max ? 'MAX LEVEL' : 'COST  ' + cost + ' SC'}</span>
        </div>
      `;
      if (lvl < u.max) {
        const btn = document.createElement('button');
        btn.textContent = 'INSTALL';
        btn.disabled = Game.state.scrap < cost;
        btn.addEventListener('click', () => {
          if (Game.state.scrap < cost) return;
          Game.state.scrap -= cost;
          Game.state.upgrades[u.id] = lvl + 1;
          Storage.save(Game.state);
          showToast('INSTALLED · ' + u.name);
          Sfx.play('snap');
          // achievements
          Game.unlockAchievement('upgrade_first');
          if (Game.state.upgrades[u.id] >= u.max) Game.unlockAchievement('upgrade_max');
          renderWorkshop();
        });
        card.querySelector('.upgrade-cost').appendChild(btn);
      }
      grid.appendChild(card);
    });
    renderSupplies();
  }

  // expose for builder/flight modules
  Game.getUpgrades = function () {
    if (Game.sandbox) {
      const maxed = {};
      UPGRADES.forEach(u => maxed[u.id] = u.max);
      return maxed;
    }
    return Game.state.upgrades || {};
  };

  // ---- consumable flight supplies --------------------------------------
  const SUPPLIES = [
    { id: 'boost',  name: 'EMERGENCY THRUST', cost: 5,
      effect: '+50 m/s instant velocity boost on use.' },
    { id: 'repair', name: 'REPAIR DRONE', cost: 8,
      effect: '+50 hull instantly, capped at max.' },
    { id: 'shield', name: 'SHIELD BURST', cost: 12,
      effect: '5 seconds of damage immunity.' },
  ];
  Game.SUPPLIES = SUPPLIES;

  function renderSupplies() {
    const grid = $('#supplies-grid');
    if (!grid) return;
    grid.innerHTML = '';
    Game.state.consumables = Game.state.consumables || { boost: 0, repair: 0, shield: 0 };
    SUPPLIES.forEach(sup => {
      const stock = Game.state.consumables[sup.id] || 0;
      const card = document.createElement('div');
      card.className = 'supply-card';
      card.innerHTML = `
        <h4>${sup.name}</h4>
        <div class="effect">${sup.effect}</div>
        <div class="stock-row">
          <span class="stock">STOCK <b>${stock}</b></span>
        </div>
      `;
      const buyBtn = document.createElement('button');
      buyBtn.textContent = 'BUY · ' + sup.cost + ' DT';
      buyBtn.disabled = Game.state.data < sup.cost;
      buyBtn.addEventListener('click', () => {
        if (Game.state.data < sup.cost) return;
        Game.state.data -= sup.cost;
        Game.state.consumables[sup.id] = (Game.state.consumables[sup.id] || 0) + 1;
        Storage.save(Game.state);
        showToast('+1 ' + sup.name);
        Sfx.play('snap');
        renderWorkshop();
      });
      card.querySelector('.stock-row').appendChild(buyBtn);
      grid.appendChild(card);
    });
  }

  // exposed for flight to read/decrement
  Game.getConsumables = function () {
    if (Game.sandbox) return { boost: 99, repair: 99, shield: 99 };
    return Game.state.consumables || { boost: 0, repair: 0, shield: 0 };
  };
  Game.spendConsumable = function (id) {
    if (Game.sandbox) return true;
    Game.state.consumables = Game.state.consumables || { boost: 0, repair: 0, shield: 0 };
    if ((Game.state.consumables[id] || 0) <= 0) return false;
    Game.state.consumables[id]--;
    Storage.save(Game.state);
    return true;
  };

  function refreshTitle() {
    $('#title-best').textContent = formatFt(Game.state.bestAltitude).toUpperCase();
    $('#title-scrap').textContent = Game.state.scrap.toString();
  }

  function formatFt(v) {
    v = Math.floor(v);
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M ft';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k ft';
    return v + ' ft';
  }

  function showToast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    if (Game.toastTimer) clearTimeout(Game.toastTimer);
    Game.toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2400);
  }

  function renderChallenges() {
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    const challenges = generateDailyChallenges(seed);
    const root = $('#challenge-body');
    root.innerHTML = '';
    challenges.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'challenge-card';
      card.innerHTML = `
        <h4>${ch.title}</h4>
        <p>${ch.description}</p>
        <div style="font-size:10px;letter-spacing:0.18em;color:var(--ink-soft);font-weight:900;border-top:1px dashed var(--paper-line);padding-top:8px;margin-top:8px">REWARD: ${ch.reward} SCRAP · ${ch.dataReward} DATA</div>
      `;
      const btn = document.createElement('button');
      btn.className = 'btn btn-small btn-primary';
      btn.style.marginTop = '10px';
      btn.textContent = 'ATTEMPT';
      btn.addEventListener('click', () => {
        Game.activeChallenge = ch;
        showToast('CHALLENGE: ' + ch.title);
        go('hangar');
      });
      card.appendChild(btn);
      root.appendChild(card);
    });
  }

  function generateDailyChallenges(seed) {
    // deterministic per-day
    const rng = mulberry32(seed);
    const pool = [
      { id: 'junk-only', title: 'JUNK ONLY', description: 'Reach 5,000 ft using only the starting parts.', reward: 80, dataReward: 4, target: 5000, restrict: 'starter', goal: { type: 'altitude', ft: 5000 } },
      { id: 'one-engine', title: 'ONE ENGINE', description: 'Reach 8,000 ft with exactly one engine.', reward: 100, dataReward: 5, target: 8000, restrict: 'oneEngine', goal: { type: 'altitude', ft: 8000 } },
      { id: 'no-fins', title: 'NO FINS', description: 'Reach 6,000 ft with no fins. Good luck steering.', reward: 90, dataReward: 5, target: 6000, restrict: 'noFins', goal: { type: 'altitude', ft: 6000 } },
      { id: 'lightweight', title: 'FEATHERWEIGHT', description: 'Launch a rocket weighing under 200 kg and reach 10,000 ft.', reward: 120, dataReward: 6, target: 10000, restrict: 'maxMass:200', goal: { type: 'altitude', ft: 10000 } },
      { id: 'apex', title: 'APEX PREDATOR', description: 'Reach 50,000 ft. No restrictions.', reward: 200, dataReward: 10, target: 50000, restrict: null, goal: { type: 'altitude', ft: 50000 } },
      { id: 'moonshot', title: 'LUNAR DELIVERY', description: 'Touch the moon. No restrictions.', reward: 400, dataReward: 20, restrict: null, goal: { type: 'moon' } },
      { id: 'stacker', title: 'STACK ’EM', description: 'Reach 80,000 ft with a 3+ stage rocket.', reward: 260, dataReward: 12, restrict: 'minStages:3', goal: { type: 'altitude', ft: 80000 } },
      { id: 'clean-pilot', title: 'CLEAN PILOT', description: 'Pull off 2 clean separations in one flight.', reward: 220, dataReward: 12, restrict: 'minStages:3', goal: { type: 'clean', n: 2 } },
      { id: 'express', title: 'EXPRESS', description: 'Reach 30,000 ft in under 25 seconds.', reward: 200, dataReward: 10, restrict: null, goal: { type: 'timeUnder', ft: 30000, sec: 25 } },
    ];
    // pick 3 distinct challenges for the day, deterministically (Fisher–Yates
    // driven by the seeded rng so everyone sees the same roster each day)
    const order = pool.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order.slice(0, 3);
  }

  // Check a rocket against a challenge restriction. Returns { ok, reason }.
  // Kept here (not in the builder) so both launch-gating and reward-granting
  // use exactly the same rule.
  function challengeRestrictionCheck(rocket, restrict) {
    if (!restrict) return { ok: true };
    const s = Builder.getStats(rocket);
    if (restrict === 'starter') {
      const starter = Storage.DEFAULTS.unlocked;
      const ids = rocket.parts.slice();
      if (rocket.finId) ids.push(rocket.finId);
      const bad = ids.find(pid => starter.indexOf(pid) === -1);
      if (bad) return { ok: false, reason: 'Starter parts only' };
    } else if (restrict === 'oneEngine') {
      if (s.engineCount !== 1) return { ok: false, reason: 'Exactly one engine' };
    } else if (restrict === 'noFins') {
      if (rocket.finId) return { ok: false, reason: 'No fins allowed' };
    } else if (restrict.indexOf('maxMass:') === 0) {
      const cap = parseFloat(restrict.split(':')[1]);
      if (s.mass >= cap) return { ok: false, reason: 'Must weigh under ' + cap + ' kg' };
    } else if (restrict.indexOf('minStages:') === 0) {
      const need = parseInt(restrict.split(':')[1], 10);
      if ((s.stageCount || 0) < need) return { ok: false, reason: 'Needs ' + need + '+ stages' };
    }
    return { ok: true };
  }
  Game.challengeRestrictionCheck = challengeRestrictionCheck;

  // Did a flight result satisfy a challenge's goal? Older challenges only
  // carried a `target` altitude; newer ones carry a typed `goal` so we can ask
  // for moonshots, stage counts, clean separations, or timed climbs.
  function challengeGoalMet(ch, result) {
    const g = ch.goal || (ch.target ? { type: 'altitude', ft: ch.target } : null);
    if (!g) return false;
    switch (g.type) {
      case 'altitude':  return result.altitude >= g.ft;
      case 'moon':      return !!result.success;
      case 'stages':    return (result.stageCount || 0) >= g.n;
      case 'clean':     return (result.cleanStages || 0) >= g.n;
      case 'timeUnder': return result.altitude >= g.ft && result.time <= g.sec;
      default:          return false;
    }
  }
  Game.challengeGoalMet = challengeGoalMet;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function bindNav() {
    $$('[data-go]').forEach(el => {
      el.addEventListener('click', () => go(el.dataset.go));
    });

    $('#btn-launch').addEventListener('click', () => {
      const rocket = Builder.getCurrentRocket();
      const validation = Builder.validate(rocket);
      if (!validation.ok) {
        showToast(validation.reason);
        return;
      }
      // if a challenge is active, its build restriction must be satisfied to launch
      if (Game.activeChallenge) {
        const rc = challengeRestrictionCheck(rocket, Game.activeChallenge.restrict);
        if (!rc.ok) {
          showToast('CHALLENGE: ' + rc.reason);
          return;
        }
      }
      Sfx.play('launch');
      Game.lastRocket = rocket;
      go('flight');
    });

    $('#btn-retry').addEventListener('click', () => go('flight'));
    $('#btn-back-hangar').addEventListener('click', () => go('hangar'));
    $('#btn-sandbox-go').addEventListener('click', () => {
      Game.sandbox = true;
      go('hangar');
    });
  }

  function applyResult(result) {
    // result: { altitude, fuelUsed, partsLost, success, time }
    if (Game.sandbox) {
      Game.lastResult = result;
      renderResult(result, { scrapEarned: 0, dataEarned: 0, unlocks: [] });
      go('result');
      return;
    }

    const state = Game.state;
    state.totalLaunches++;
    if (result.altitude > state.bestAltitude) state.bestAltitude = result.altitude;
    if (result.success) state.successfulMoonshots++;

    // scrap based on altitude
    let scrapEarned = Math.floor(result.altitude / 100);
    let dataEarned = Math.floor(result.altitude / 5000);
    if (result.success) { scrapEarned += 500; dataEarned += 25; }

    // milestone + combo bonuses (earned during flight)
    scrapEarned += result.milestoneBonus || 0;
    scrapEarned += result.comboBonus || 0;

    // pickups collected during flight
    scrapEarned += result.pickupScrap || 0;
    dataEarned  += result.pickupData  || 0;

    // weather modifier multiplier on the whole take
    if (result.modifierScrapMul && result.modifierScrapMul !== 1) {
      scrapEarned = Math.floor(scrapEarned * result.modifierScrapMul);
    }

    // R&D telemetry uplink: bonus data per level
    const telemetryLvl = (state.upgrades && state.upgrades.telemetry) || 0;
    if (telemetryLvl > 0) {
      dataEarned = Math.floor(dataEarned * (1 + 0.15 * telemetryLvl));
    }

    // staging bonus — encourages multi-stage builds
    if (result.stageCount) {
      scrapEarned += result.stageCount * 25;
    }
    // clean-separation skill bonus — dropping near-empty stages, timed well
    if (result.stageBonus) {
      scrapEarned += result.stageBonus;
    }

    // challenge bonus
    if (Game.activeChallenge) {
      const ch = Game.activeChallenge;
      const restrictOk = challengeRestrictionCheck(Game.lastRocket, ch.restrict).ok;
      const challengeMet = restrictOk && challengeGoalMet(ch, result) &&
        (state.completedChallenges.indexOf(ch.id + ':' + new Date().toDateString()) === -1);
      if (challengeMet) {
        scrapEarned += ch.reward;
        dataEarned += ch.dataReward;
        state.completedChallenges.push(ch.id + ':' + new Date().toDateString());
      }
      Game.activeChallenge = null;
    }

    state.scrap += scrapEarned;
    state.data += dataEarned;

    // lifetime stats + achievement triggers
    ensureRecordsState();
    state.stats.totalLaunches = (state.stats.totalLaunches || 0) + 1;
    state.stats.totalScrapEarned = (state.stats.totalScrapEarned || 0) + scrapEarned;
    state.stats.totalPickups = (state.stats.totalPickups || 0) + (result.pickupCount || 0);
    state.stats.totalStages = (state.stats.totalStages || 0) + (result.stageCount || 0);
    if (result.success) state.stats.totalMoonshots = (state.stats.totalMoonshots || 0) + 1;
    else state.stats.totalCrashes = (state.stats.totalCrashes || 0) + 1;

    Game.unlockAchievement('first_launch');
    if (result.altitude >= 5000)   Game.unlockAchievement('alt_5k');
    if (result.altitude >= 50000)  Game.unlockAchievement('alt_50k');
    if (result.altitude >= 100000) Game.unlockAchievement('alt_100k');
    if (result.altitude >= 500000) Game.unlockAchievement('alt_500k');
    if (result.success)            Game.unlockAchievement('moonshot');
    if (result.stageCount >= 3)    Game.unlockAchievement('stage_3');
    if ((result.pickupCount || 0) >= 10) Game.unlockAchievement('pickup_10');
    if (state.stats.totalCrashes >= 10)  Game.unlockAchievement('crash_10');
    if (state.stats.totalCrashes >= 100) Game.unlockAchievement('crash_100');
    if (state.stats.totalPickups >= 100) Game.unlockAchievement('pickup_100');
    if (state.stats.totalScrapEarned >= 10000) Game.unlockAchievement('scrap_10k');
    if (result.modifierId === 'storm'  && result.altitude >= 10000)  Game.unlockAchievement('storm_survive');
    if (result.modifierId === 'aurora' && result.altitude >= 100000) Game.unlockAchievement('aurora_run');

    // unlocks based on altitude milestones
    const unlocks = checkUnlocks(state);

    Storage.save(state);
    Game.lastResult = result;
    renderResult(result, { scrapEarned, dataEarned, unlocks });
    go('result');
  }

  const UNLOCK_TIERS = [
    { altitude: 1000,    parts: ['firework_booster', 'pressure_cooker', 'lawnmower', 'soup_can', 'beer_keg', 'plywood_fin', 'stop_sign_fin'] },
    { altitude: 5000,    parts: ['leaf_blower', 'magnetron', 'propane_tank', 'shopping_cart', 'filing_cabinet'] },
    { altitude: 20000,   parts: ['steel_fin'] },
    { altitude: 100000,  parts: ['nuclear_core', 'industrial_drum'] },
    { altitude: 200000,  parts: ['salvaged_motor', 'fridge', 'aerospace_fin'] },
  ];

  function checkUnlocks(state) {
    const unlocks = [];
    UNLOCK_TIERS.forEach(tier => {
      if (state.bestAltitude >= tier.altitude) {
        tier.parts.forEach(pid => {
          if (state.unlocked.indexOf(pid) === -1) {
            state.unlocked.push(pid);
            unlocks.push(pid);
          }
        });
      }
    });
    return unlocks;
  }

  function renderResult(result, rewards) {
    const titleEl = $('#result-title');
    const stampEl = $('#result-stamp');
    if (result.success) {
      titleEl.textContent = 'MOONSHOT CONFIRMED';
      titleEl.classList.add('success');
      if (stampEl) {
        stampEl.textContent = 'MISSION SUCCESS';
        stampEl.classList.add('success');
      }
    } else {
      titleEl.textContent = result.crashReason || 'VEHICLE LOSS';
      titleEl.classList.remove('success');
      if (stampEl) {
        stampEl.textContent = pickStampText(result);
        stampEl.classList.remove('success');
      }
    }
    $('#result-alt').textContent = formatFt(result.altitude).replace(/ ft$/, '').toUpperCase();
    $('#result-flair').textContent = pickFlair(result);

    const list = $('#result-rewards');
    list.innerHTML = '';
    if (result.modifierLabel && result.modifierId !== 'calm') {
      const mulPct = Math.round((result.modifierScrapMul - 1) * 100);
      const mulStr = mulPct >= 0 ? '+' + mulPct + '%' : mulPct + '%';
      list.innerHTML += `<li><span>Weather</span><b>${result.modifierLabel} ${mulStr}</b></li>`;
    }
    if (result.stageCount) list.innerHTML += `<li><span>Stages dropped</span><b>${result.stageCount}</b></li>`;
    if (result.cleanStages) list.innerHTML += `<li class="unlock"><span>Clean separations (${result.cleanStages})</span><b>+${result.stageBonus}</b></li>`;
    if (result.milestoneBonus) list.innerHTML += `<li><span>Milestones</span><b>+${result.milestoneBonus}</b></li>`;
    if (result.comboBonus) list.innerHTML += `<li><span>Pilot bonus</span><b>+${result.comboBonus}</b></li>`;
    if (result.pickupCount) list.innerHTML += `<li><span>Pickups (${result.pickupCount})</span><b>+${result.pickupScrap || 0} sc · +${result.pickupData || 0} dt</b></li>`;
    if (rewards.scrapEarned) list.innerHTML += `<li><span>Scrap total</span><b>+${rewards.scrapEarned}</b></li>`;
    if (rewards.dataEarned) list.innerHTML += `<li><span>Data</span><b>+${rewards.dataEarned}</b></li>`;
    if (result.success) list.innerHTML += `<li class="unlock"><span>Achievement</span><b>MOON LANDED</b></li>`;
    rewards.unlocks.forEach(pid => {
      const part = Parts.byId(pid);
      list.innerHTML += `<li class="unlock"><span>Unlocked</span><b>${part ? part.name : pid}</b></li>`;
    });
    if (!list.innerHTML) list.innerHTML = '<li><span>Nothing salvaged</span><b>—</b></li>';
  }

  function pickStampText(result) {
    if (result.altitude >= 250000) return 'NEAR MISS';
    if (result.altitude >= 50000) return 'PARTIAL DATA';
    if (result.altitude >= 5000) return 'RECOVERED';
    if (result.altitude >= 500) return 'INCIDENT';
    return 'TOTAL LOSS';
  }

  function pickFlair(result) {
    if (result.success) {
      const wins = ['You touched the moon. Probably illegal.', 'NASA is calling. Don\'t answer.', 'A small step for trash, a giant leap for trash.'];
      return wins[Math.floor(Math.random() * wins.length)];
    }
    if (result.altitude > 50000) {
      return ['Almost. Almost.', 'So close you could taste the regolith.', 'The moon waved back.'][Math.floor(Math.random() * 3)];
    }
    if (result.altitude < 1000) {
      return ['That barely counts as a launch.', 'Birds laughed at you.', 'Your neighbor called the police.'][Math.floor(Math.random() * 3)];
    }
    const mid = ['Spectacular failure.', 'Parts everywhere. Nothing learned.', 'The crater spells your name.', 'The duct tape held. Briefly.'];
    return mid[Math.floor(Math.random() * mid.length)];
  }

  // expose helpers
  Game.go = go;
  Game.applyResult = applyResult;
  Game.showToast = showToast;
  Game.formatFt = formatFt;
  window.Game = Game;

  // boot
  document.addEventListener('DOMContentLoaded', () => {
    Game.state = Storage.load();
    bindNav();
    refreshTitle();
    go('title');
  });
})();
