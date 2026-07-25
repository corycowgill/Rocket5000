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
    consumables: {
      boost:  0,  // emergency velocity boost
      repair: 0,  // mid-flight hull repair
      shield: 0,  // 5s damage immunity
    },
    achievements: {},
    stats: {
      totalLaunches: 0,
      totalMoonshots: 0,
      totalCrashes: 0,
      totalPickups: 0,
      totalStages: 0,
      totalScrapEarned: 0,
      highestCombo: 0,
      highestMach: 0,
    },
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return deepMerge({}, DEFAULTS);
      const parsed = JSON.parse(raw);
      // deep-merge so newly-added nested default keys (a new upgrade, a new
      // stat) reach existing saves instead of being dropped by a shallow spread
      return deepMerge(parsed, DEFAULTS);
    } catch (e) {
      return deepMerge({}, DEFAULTS);
    }
  }

  // Fill any key missing from `base` with the value from `defaults`, recursing
  // into plain objects. Arrays and existing scalar values in `base` are kept
  // as-is (the player's data wins); only genuinely-absent keys are backfilled.
  function deepMerge(base, defaults) {
    const isPlain = v => v && typeof v === 'object' && !Array.isArray(v);
    const out = isPlain(base) ? { ...base } : (base === undefined ? undefined : base);
    if (!isPlain(defaults)) return out === undefined ? defaults : out;
    const result = isPlain(out) ? out : {};
    for (const k of Object.keys(defaults)) {
      if (isPlain(defaults[k])) {
        result[k] = deepMerge(isPlain(result[k]) ? result[k] : {}, defaults[k]);
      } else if (!(k in result)) {
        result[k] = defaults[k];
      }
    }
    return result;
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

  global.Storage = { load, save, reset, deepMerge, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).Storage;
}
