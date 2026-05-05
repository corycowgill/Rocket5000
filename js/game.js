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
  }

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
      { id: 'junk-only', title: 'JUNK ONLY', description: 'Reach 5,000 ft using only the starting parts.', reward: 80, dataReward: 4, target: 5000, restrict: 'starter' },
      { id: 'one-engine', title: 'ONE ENGINE', description: 'Reach 8,000 ft with exactly one engine.', reward: 100, dataReward: 5, target: 8000, restrict: 'oneEngine' },
      { id: 'no-fins', title: 'NO FINS', description: 'Reach 6,000 ft with no fins. Good luck steering.', reward: 90, dataReward: 5, target: 6000, restrict: 'noFins' },
      { id: 'lightweight', title: 'FEATHERWEIGHT', description: 'Launch a rocket weighing under 200 kg and reach 10,000 ft.', reward: 120, dataReward: 6, target: 10000, restrict: 'maxMass:200' },
      { id: 'apex', title: 'APEX PREDATOR', description: 'Reach 50,000 ft. No restrictions.', reward: 200, dataReward: 10, target: 50000, restrict: null },
    ];
    const choice = pool[Math.floor(rng() * pool.length)];
    return [choice];
  }

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

    // weather modifier multiplier on the whole take
    if (result.modifierScrapMul && result.modifierScrapMul !== 1) {
      scrapEarned = Math.floor(scrapEarned * result.modifierScrapMul);
    }

    // staging bonus — encourages multi-stage builds
    if (result.stageCount) {
      scrapEarned += result.stageCount * 25;
    }

    // challenge bonus
    if (Game.activeChallenge) {
      const ch = Game.activeChallenge;
      const challengeMet = result.altitude >= ch.target &&
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

    // unlocks based on altitude milestones
    const unlocks = checkUnlocks(state);

    Storage.save(state);
    Game.lastResult = result;
    renderResult(result, { scrapEarned, dataEarned, unlocks });
    go('result');
  }

  const UNLOCK_TIERS = [
    { altitude: 1000,    parts: ['firework_booster', 'soup_can'] },
    { altitude: 5000,    parts: ['leaf_blower', 'shopping_cart'] },
    { altitude: 20000,   parts: ['steel_fin'] },
    { altitude: 100000,  parts: ['nuclear_core'] },
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
    if (result.milestoneBonus) list.innerHTML += `<li><span>Milestones</span><b>+${result.milestoneBonus}</b></li>`;
    if (result.comboBonus) list.innerHTML += `<li><span>Pilot bonus</span><b>+${result.comboBonus}</b></li>`;
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
