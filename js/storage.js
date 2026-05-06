/* ==========================================================
   STORAGE — localStorage save/load with safe defaults
   ========================================================== */
(function (global) {
  'use strict';

  const KEY = 'scrap-rocket-save-v1';

  const DEFAULTS = {
    scrap: 0,
    data: 0,
    bestAltitude: 0,
    totalLaunches: 0,
    successfulMoonshots: 0,
    unlocked: ['hairdryer', 'duct_tape', 'hairspray_cluster', 'soda_bottle', 'lawn_chair', 'trash_can', 'wheelbarrow', 'pizza_box_fin', 'cardboard_fin'],
    lastBuild: null,                    // legacy single build (kept for migration)
    buildSlots: [
      { label: 'ALPHA',   rocket: null },
      { label: 'BRAVO',   rocket: null },
      { label: 'CHARLIE', rocket: null },
    ],
    activeSlot: 0,
    seenChallengeId: null,
    completedChallenges: [],
    upgrades: {
      precision: 0,    // -10% engine break chance per level
      lightweight: 0,  // -5% rocket dry mass per level
      turbofuel: 0,    // +5% engine thrust per level
      hull: 0,         // +25 base hull per level
      efficient: 0,    // -8% burn rate per level
      magnet: 0,       // +30% pickup attraction radius per level
      telemetry: 0,    // +15% data earned per level
    },
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* quota exceeded or disabled — fail silently */
    }
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  global.Storage = { load, save, reset, DEFAULTS };
})(window);
