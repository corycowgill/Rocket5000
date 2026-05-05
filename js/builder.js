/* ==========================================================
   BUILDER — drag-drop hangar. Filled in Chunk 2.
   ========================================================== */
(function (global) {
  'use strict';
  global.Builder = {
    enter() {},
    getCurrentRocket() { return { parts: [] }; },
    validate() { return { ok: false, reason: 'Builder not implemented yet' }; },
  };
})(window);
