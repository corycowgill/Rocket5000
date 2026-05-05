/* ==========================================================
   PARTS — catalog of 10 starter parts.

   Each part:
     id, name, category, mass (kg), tier (visual unlock order),
     sprite(ctx, x, y, scale, frame) — programmatic pixel art,
     plus category-specific stats:
       engine:  thrust, burnRate, jank, breakChance, color
       fuel:    capacity
       body:    stability, hullBonus
       fin:     stability
   ========================================================== */
(function (global) {
  'use strict';

  // ---- pixel art helpers ----------------------------------------------------
  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }
  function rect(ctx, x, y, w, h, fill, outline) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    if (outline) {
      ctx.fillStyle = outline;
      // 1px outline
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y + h - 1, w, 1);
      ctx.fillRect(x, y, 1, h);
      ctx.fillRect(x + w - 1, y, 1, h);
    }
  }

  // sprite functions take centerX, bottomY (so parts stack upward), scale
  // each part is drawn within a 32x32 cell scaled by `scale`

  function drawSodaBottle(ctx, cx, by, s, frame) {
    // 32x32. Bottle: light green w/ red label
    const X = cx - 16 * s, Y = by - 32 * s;
    rect(ctx, X + 12 * s, Y + 0,        8 * s, 4 * s, '#88aa55', '#445522'); // cap
    rect(ctx, X + 10 * s, Y + 4 * s,   12 * s, 4 * s, '#aacc77', '#445522'); // neck
    rect(ctx, X + 6 * s,  Y + 8 * s,   20 * s, 22 * s, '#bbdd88', '#445522'); // body
    rect(ctx, X + 6 * s,  Y + 14 * s,  20 * s, 6 * s,  '#cc4444', '#552211'); // label
    px(ctx, X + 12 * s, Y + 16 * s, 2 * s, 2 * s, '#ffeecc');
    px(ctx, X + 18 * s, Y + 16 * s, 2 * s, 2 * s, '#ffeecc');
  }

  function drawSoupCan(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 32 * s;
    rect(ctx, X + 4 * s,  Y + 2 * s,  24 * s, 4 * s,  '#dddddd', '#444444');
    rect(ctx, X + 4 * s,  Y + 6 * s,  24 * s, 22 * s, '#cc3333', '#440000');
    rect(ctx, X + 6 * s,  Y + 12 * s, 20 * s, 8 * s,  '#fff3cc', '#aa8855');
    px(ctx, X + 10 * s, Y + 14 * s, 12 * s, 2 * s, '#cc3333');
    rect(ctx, X + 4 * s,  Y + 28 * s, 24 * s, 4 * s,  '#dddddd', '#444444');
  }

  function drawLawnChair(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 28 * s;
    // backrest
    for (let i = 0; i < 3; i++) {
      rect(ctx, X + 6 * s, Y + (2 + i * 4) * s, 18 * s, 2 * s, '#ffaa44', '#552200');
    }
    // seat
    rect(ctx, X + 4 * s,  Y + 16 * s, 22 * s, 4 * s, '#ffaa44', '#552200');
    // legs
    rect(ctx, X + 4 * s,  Y + 20 * s, 2 * s,  8 * s, '#888899', '#333344');
    rect(ctx, X + 24 * s, Y + 20 * s, 2 * s,  8 * s, '#888899', '#333344');
  }

  function drawShoppingCart(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 30 * s;
    // basket
    rect(ctx, X + 2 * s,  Y + 4 * s,  28 * s, 18 * s, '#999999', '#222222');
    // grid lines
    for (let i = 0; i < 4; i++) {
      px(ctx, X + (4 + i * 6) * s, Y + 6 * s, 1 * s, 16 * s, '#666666');
    }
    px(ctx, X + 2 * s, Y + 12 * s, 28 * s, 1 * s, '#666666');
    // wheels
    rect(ctx, X + 4 * s,  Y + 24 * s, 6 * s, 6 * s, '#222222', '#000000');
    rect(ctx, X + 22 * s, Y + 24 * s, 6 * s, 6 * s, '#222222', '#000000');
    // handle
    rect(ctx, X + 26 * s, Y + 0 * s,  4 * s, 6 * s, '#cc3333', '#440000');
  }

  function drawDuctTape(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // engine bell (gray duct tape)
    rect(ctx, X + 6 * s,  Y + 16 * s, 20 * s, 12 * s, '#aaaaaa', '#444444');
    // tape stripes
    px(ctx, X + 6 * s,  Y + 18 * s, 20 * s, 2 * s, '#888888');
    px(ctx, X + 6 * s,  Y + 22 * s, 20 * s, 2 * s, '#888888');
    px(ctx, X + 6 * s,  Y + 26 * s, 20 * s, 2 * s, '#888888');
    // top mount
    rect(ctx, X + 10 * s, Y + 10 * s, 12 * s, 6 * s, '#777777', '#222222');
    // flame
    if (frame && frame.thrusting) {
      const flick = (frame.t % 4 < 2) ? 0 : 1;
      rect(ctx, X + 10 * s, Y + 28 * s, 12 * s, (4 + flick * 2) * s, '#ffcc33', '#cc6600');
      rect(ctx, X + 12 * s, Y + (32 + flick * 2) * s, 8 * s, 2 * s, '#ff5511', null);
    }
  }

  function drawFirework(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // tube
    rect(ctx, X + 8 * s,  Y + 8 * s,  16 * s, 22 * s, '#cc2222', '#440000');
    // gold band
    rect(ctx, X + 8 * s,  Y + 14 * s, 16 * s, 4 * s,  '#ffcc33', '#996600');
    // cone top
    rect(ctx, X + 12 * s, Y + 4 * s,  8 * s,  4 * s,  '#cc2222', '#440000');
    rect(ctx, X + 14 * s, Y + 0 * s,  4 * s,  4 * s,  '#ffeecc', null);
    // fuse
    px(ctx, X + 16 * s, Y - 2 * s, 1 * s, 2 * s, '#664400');
    if (frame && frame.thrusting) {
      const r = ((frame.t * 7) | 0) % 5;
      rect(ctx, X + (10 - r) * s, Y + 30 * s, (12 + r * 2) * s, 6 * s, '#ff8833', '#ff4400');
      px(ctx, X + 14 * s, Y + 36 * s, 4 * s, 2 * s, '#ffff88');
    }
  }

  function drawLeafBlower(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    rect(ctx, X + 4 * s,  Y + 12 * s, 24 * s, 14 * s, '#33aacc', '#114466');
    rect(ctx, X + 6 * s,  Y + 14 * s, 4 * s,  10 * s, '#88ddff', null);
    rect(ctx, X + 12 * s, Y + 4 * s,  8 * s,  10 * s, '#33aacc', '#114466'); // intake
    px(ctx, X + 14 * s, Y + 6 * s, 4 * s, 4 * s, '#222233');
    rect(ctx, X + 8 * s,  Y + 26 * s, 16 * s, 4 * s, '#666666', '#222222');
    if (frame && frame.thrusting) {
      const flick = (frame.t % 6 < 3) ? 0 : 1;
      rect(ctx, X + (10 - flick) * s, Y + 30 * s, (12 + flick * 2) * s, 6 * s, '#88ddff', '#33aacc');
    }
  }

  function drawNuclearCore(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 36 * s;
    // glowing core
    const glow = frame ? (frame.t % 8 < 4 ? '#88ff88' : '#aaffaa') : '#88ff88';
    rect(ctx, X + 4 * s,  Y + 8 * s,  24 * s, 24 * s, '#444444', '#111111');
    rect(ctx, X + 8 * s,  Y + 12 * s, 16 * s, 16 * s, glow, '#226622');
    rect(ctx, X + 12 * s, Y + 16 * s, 8 * s, 8 * s,   '#ffffff', null);
    // hazard stripes
    rect(ctx, X + 4 * s,  Y + 4 * s,  24 * s, 4 * s,  '#ffcc00', '#666600');
    px(ctx, X + 6 * s,  Y + 4 * s, 4 * s, 4 * s, '#000000');
    px(ctx, X + 14 * s, Y + 4 * s, 4 * s, 4 * s, '#000000');
    px(ctx, X + 22 * s, Y + 4 * s, 4 * s, 4 * s, '#000000');
    // exhaust
    rect(ctx, X + 10 * s, Y + 32 * s, 12 * s, 4 * s, '#222233', '#000000');
    if (frame && frame.thrusting) {
      rect(ctx, X + 8 * s, Y + 36 * s, 16 * s, 8 * s, '#aaffaa', '#33aa33');
      px(ctx, X + 12 * s, Y + 44 * s, 8 * s, 4 * s, '#ffffff');
    }
  }

  function drawCardboardFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 14 * s;
    // triangle-ish fin pair
    rect(ctx, X + 0 * s,   Y + 8 * s,  6 * s, 6 * s, '#aa7744', '#553311');
    rect(ctx, X + 0 * s,   Y + 4 * s,  4 * s, 4 * s, '#aa7744', '#553311');
    rect(ctx, X + 26 * s,  Y + 8 * s,  6 * s, 6 * s, '#aa7744', '#553311');
    rect(ctx, X + 28 * s,  Y + 4 * s,  4 * s, 4 * s, '#aa7744', '#553311');
    // tape
    px(ctx, X + 4 * s,  Y + 6 * s, 2 * s, 6 * s, '#888888');
    px(ctx, X + 26 * s, Y + 6 * s, 2 * s, 6 * s, '#888888');
    // center connector
    rect(ctx, X + 12 * s, Y + 8 * s, 8 * s, 6 * s, '#777777', '#333333');
  }

  function drawSteelFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 16 * s;
    rect(ctx, X + 0 * s,   Y + 8 * s,  8 * s, 8 * s, '#7799cc', '#223355');
    rect(ctx, X + 0 * s,   Y + 4 * s,  6 * s, 4 * s, '#7799cc', '#223355');
    rect(ctx, X + 0 * s,   Y + 0 * s,  4 * s, 4 * s, '#7799cc', '#223355');
    rect(ctx, X + 24 * s,  Y + 8 * s,  8 * s, 8 * s, '#7799cc', '#223355');
    rect(ctx, X + 26 * s,  Y + 4 * s,  6 * s, 4 * s, '#7799cc', '#223355');
    rect(ctx, X + 28 * s,  Y + 0 * s,  4 * s, 4 * s, '#7799cc', '#223355');
    rect(ctx, X + 12 * s,  Y + 8 * s,  8 * s, 8 * s, '#aaaabb', '#444466');
    px(ctx, X + 14 * s, Y + 10 * s, 4 * s, 1 * s, '#ddddee');
  }

  // ---- catalog --------------------------------------------------------------
  const ALL = [
    // ENGINES
    {
      id: 'duct_tape', name: 'Duct Tape Booster', category: 'engine', tier: 0,
      mass: 8, height: 32,
      thrust: 22, burnRate: 1.4, jank: 20, breakChance: 0.004,
      flameColor: '#ffcc33',
      sprite: drawDuctTape,
      blurb: 'Held together by hope.',
    },
    {
      id: 'firework_booster', name: 'Firework Booster', category: 'engine', tier: 1,
      mass: 12, height: 32,
      thrust: 38, burnRate: 2.6, jank: 70, breakChance: 0.018,
      thrustVariance: 0.6, // ±60% spike
      flameColor: '#ff7733',
      sprite: drawFirework,
      blurb: 'Probably not aerospace grade.',
    },
    {
      id: 'leaf_blower', name: 'Leaf Blower Thruster', category: 'engine', tier: 2,
      mass: 10, height: 32,
      thrust: 28, burnRate: 0.9, jank: 10, breakChance: 0.0008,
      flameColor: '#88ddff',
      sprite: drawLeafBlower,
      blurb: 'Surprisingly stable. Ear protection sold separately.',
    },
    {
      id: 'nuclear_core', name: '"Definitely Safe" Nuclear Core', category: 'engine', tier: 3,
      mass: 40, height: 36,
      thrust: 180, burnRate: 1.6, jank: 90, breakChance: 0.012, catastrophic: true,
      flameColor: '#aaffaa',
      sprite: drawNuclearCore,
      blurb: 'No questions please.',
    },

    // FUEL
    {
      id: 'soda_bottle', name: 'Soda Bottle Tank', category: 'fuel', tier: 0,
      mass: 4, height: 32,
      capacity: 50,
      sprite: drawSodaBottle,
      blurb: 'Mostly recycled. Mostly.',
    },
    {
      id: 'soup_can', name: 'Soup Can Tank', category: 'fuel', tier: 1,
      mass: 10, height: 32,
      capacity: 130,
      sprite: drawSoupCan,
      blurb: 'Now with 0% soup.',
    },

    // BODY
    {
      id: 'lawn_chair', name: 'Lawn Chair Cockpit', category: 'body', tier: 0,
      mass: 6, height: 28,
      stability: 8, hullBonus: 0,
      sprite: drawLawnChair,
      blurb: 'Cup holder included.',
    },
    {
      id: 'shopping_cart', name: 'Shopping Cart Chassis', category: 'body', tier: 2,
      mass: 22, height: 30,
      stability: 25, hullBonus: 60,
      sprite: drawShoppingCart,
      blurb: 'Reinforced. Probably stolen.',
    },

    // FINS
    {
      id: 'cardboard_fin', name: 'Cardboard Fin', category: 'fin', tier: 0,
      mass: 2, height: 14,
      stability: 18,
      sprite: drawCardboardFin,
      blurb: 'Aerodynamic in spirit.',
    },
    {
      id: 'steel_fin', name: 'Steel Fin', category: 'fin', tier: 2,
      mass: 8, height: 16,
      stability: 45,
      sprite: drawSteelFin,
      blurb: 'Heavy but firm.',
    },
  ];

  const byIdMap = {};
  ALL.forEach(p => byIdMap[p.id] = p);

  global.Parts = {
    all: ALL,
    byId(id) { return byIdMap[id] || null; },
    byCategory(cat) { return ALL.filter(p => p.category === cat); },
    CATEGORY_ORDER: ['engine', 'fuel', 'body', 'fin'],
  };
})(window);
