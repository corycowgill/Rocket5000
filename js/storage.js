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
    unlocked: ['soda_bottle', 'duct_tape', 'lawn_chair', 'trash_can', 'cardboard_fin'],
    lastBuild: null,
    seenChallengeId: null,
    completedChallenges: [],
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
