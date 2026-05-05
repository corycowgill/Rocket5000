/* ==========================================================
   FLIGHT — physics + render loop. Filled in Chunk 3.
   ========================================================== */
(function (global) {
  'use strict';
  global.Flight = {
    enter() {
      // Fallback: just bounce back to result so app doesn't get stuck
      setTimeout(() => {
        Game.applyResult({ altitude: 0, success: false, crashReason: 'NO ENGINE' });
      }, 600);
    },
  };
})(window);
