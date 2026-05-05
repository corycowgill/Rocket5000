/* ==========================================================
   PARTS — catalog of 10 starter parts.

   Each part:
     id, name, category, mass (kg), tier (visual unlock order),
     sprite(ctx, x, y, scale, frame) — programmatic pixel art,
     plus category-specific stats:
       engine:  thrust, burnRate, jank, breakChance, flameColor
       fuel:    capacity
       body:    stability, hullBonus
       fin:     stability

   Sprites use shaded pixel art: each cylindrical body has a
   highlight column, a body color, and a shadow column for
   subtle depth without breaking the chunky pixel-art feel.

   Engine flames are layered (outer / middle / core) and grow
   with thrust intensity for satisfying ignition feedback.
   ========================================================== */
(function (global) {
  'use strict';

  // ---- pixel art helpers ----------------------------------------------------
  function px(ctx, x, y, w, h, color) {
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }
  function rect(ctx, x, y, w, h, fill, outline) {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
    }
    if (outline) {
      ctx.fillStyle = outline;
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y + h - 1, w, 1);
      ctx.fillRect(x, y, 1, h);
      ctx.fillRect(x + w - 1, y, 1, h);
    }
  }
  /* shaded cylinder: highlight column + body + shadow column */
  function cyl(ctx, x, y, w, h, body, hi, lo, outline) {
    rect(ctx, x, y, w, h, body, outline);
    if (hi) px(ctx, x + 1, y + 1, 1, h - 2, hi);                // highlight
    if (lo) px(ctx, x + w - 2, y + 1, 1, h - 2, lo);            // shadow
  }
  /* layered flame: outer (cool) → middle (hot) → core (white) */
  function flame(ctx, cx, top, baseW, len, t, colors) {
    const flick  = (t % 4 < 2) ? 0 : 1;
    const flick2 = (t % 6 < 3) ? 0 : 2;
    const wow    = (t % 8 < 4) ? 0 : 1;
    const outer  = colors[0], mid = colors[1], core = colors[2];
    // outer: widest, tallest with random tip
    rect(ctx, cx - baseW / 2 - 2 + wow, top, baseW + 4, len + flick2, outer);
    // tapered tip
    rect(ctx, cx - baseW / 2 + 1, top + len + flick2, baseW - 2, 3 + flick, outer);
    // middle layer
    rect(ctx, cx - baseW / 2, top + 1, baseW, len + flick, mid);
    rect(ctx, cx - baseW / 2 + 2, top + len + flick, baseW - 4, 2 + flick2, mid);
    // hot core
    rect(ctx, cx - baseW / 2 + 2, top + 2, baseW - 4, len - 2, core);
    // bright sparkle at tip
    rect(ctx, cx - 1, top + len - 1 + flick, 2, 2, '#ffffff');
  }

  // ============================================================
  // PARTS — sprite functions take (ctx, centerX, bottomY, scale, frame)
  // Each part draws within a 32×32 cell at its bottom anchored at by.
  // ============================================================

  function drawSodaBottle(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // cap (red plastic)
    cyl(ctx, X + 12 * s, Y + 0,        8 * s, 4 * s,  '#cc4422', '#ee6644', '#882211', '#441100');
    // neck
    cyl(ctx, X + 10 * s, Y + 4 * s,   12 * s, 5 * s,  '#aacc77', '#cce099', '#668844', '#445522');
    // body
    cyl(ctx, X + 6 * s,  Y + 8 * s,   20 * s, 22 * s, '#bbdd88', '#ddeeaa', '#669944', '#445522');
    // label band
    rect(ctx, X + 6 * s,  Y + 14 * s, 20 * s, 7 * s,  '#cc3333', '#552211');
    px(ctx, X + 7 * s,  Y + 14 * s, 19 * s, 1 * s, '#ee5544');
    // SCRAP COLA badge
    px(ctx, X + 12 * s, Y + 16 * s, 1 * s, 3 * s, '#ffeecc');
    px(ctx, X + 14 * s, Y + 16 * s, 2 * s, 3 * s, '#ffeecc');
    px(ctx, X + 17 * s, Y + 16 * s, 1 * s, 3 * s, '#ffeecc');
    px(ctx, X + 19 * s, Y + 16 * s, 2 * s, 3 * s, '#ffeecc');
    // bubbles in liquid
    px(ctx, X + 9 * s,  Y + 25 * s, 2 * s, 1 * s, '#ddeeaa');
    px(ctx, X + 13 * s, Y + 27 * s, 1 * s, 1 * s, '#ddeeaa');
    px(ctx, X + 21 * s, Y + 24 * s, 1 * s, 1 * s, '#ddeeaa');
  }

  function drawSoupCan(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // top rim
    rect(ctx, X + 4 * s,  Y + 2 * s,  24 * s, 4 * s,  '#cccccc', '#444444');
    px(ctx, X + 5 * s,  Y + 3 * s, 22 * s, 1 * s, '#ffffff');
    // body
    cyl(ctx, X + 4 * s,  Y + 6 * s,  24 * s, 22 * s, '#cc3333', '#ee5544', '#882211', '#440000');
    // cream label
    cyl(ctx, X + 6 * s,  Y + 11 * s, 20 * s, 11 * s, '#fff3cc', '#ffeebb', '#cca877', '#aa8855');
    // brand text bars
    px(ctx, X + 9 * s,  Y + 14 * s, 14 * s, 2 * s, '#cc3333');
    px(ctx, X + 11 * s, Y + 18 * s, 10 * s, 1 * s, '#cc3333');
    // bottom rim
    rect(ctx, X + 4 * s,  Y + 28 * s, 24 * s, 4 * s,  '#cccccc', '#444444');
    px(ctx, X + 5 * s,  Y + 29 * s, 22 * s, 1 * s, '#ffffff');
  }

  function drawLawnChair(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 28 * s;
    // backrest slats
    for (let i = 0; i < 3; i++) {
      rect(ctx, X + 6 * s, Y + (2 + i * 4) * s, 18 * s, 2 * s, '#ff9933', '#552200');
      px(ctx, X + 6 * s, Y + (2 + i * 4) * s, 18 * s, 1 * s, '#ffbb55');
    }
    // seat
    rect(ctx, X + 4 * s,  Y + 14 * s, 22 * s, 4 * s, '#ff9933', '#552200');
    px(ctx, X + 4 * s,  Y + 14 * s, 22 * s, 1 * s, '#ffbb55');
    // arm rests
    px(ctx, X + 4 * s, Y + 8 * s, 2 * s, 6 * s, '#ddaa77');
    px(ctx, X + 26 * s, Y + 8 * s, 2 * s, 6 * s, '#ddaa77');
    // legs (steel tubing)
    cyl(ctx, X + 4 * s,  Y + 18 * s, 2 * s,  10 * s, '#999999', '#cccccc', '#444444');
    cyl(ctx, X + 24 * s, Y + 18 * s, 2 * s,  10 * s, '#999999', '#cccccc', '#444444');
    // duct tape strap holding rocket on
    rect(ctx, X + 2 * s,  Y + 12 * s, 28 * s, 1 * s, '#bbbbbb');
  }

  function drawShoppingCart(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 30 * s;
    // basket
    rect(ctx, X + 2 * s,  Y + 4 * s,  28 * s, 18 * s, '#aaaaaa', '#222222');
    // basket grid
    for (let i = 0; i < 4; i++) {
      px(ctx, X + (4 + i * 6) * s, Y + 6 * s, 1 * s, 16 * s, '#666666');
    }
    px(ctx, X + 2 * s, Y + 12 * s, 28 * s, 1 * s, '#666666');
    // shine on top edge
    px(ctx, X + 3 * s, Y + 5 * s, 26 * s, 1 * s, '#dddddd');
    // wheels
    cyl(ctx, X + 4 * s,  Y + 24 * s, 6 * s, 6 * s, '#222222', '#444444', '#000000', '#000000');
    cyl(ctx, X + 22 * s, Y + 24 * s, 6 * s, 6 * s, '#222222', '#444444', '#000000', '#000000');
    px(ctx, X + 6 * s,  Y + 26 * s, 2 * s, 2 * s, '#666666');
    px(ctx, X + 24 * s, Y + 26 * s, 2 * s, 2 * s, '#666666');
    // handle (red plastic over steel)
    rect(ctx, X + 26 * s, Y + 0 * s,  4 * s, 6 * s, '#cc3333', '#440000');
    px(ctx, X + 27 * s, Y + 1 * s, 1 * s, 4 * s, '#ee5555');
  }

  function drawDuctTape(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // engine bell (dirty silver tape)
    cyl(ctx, X + 6 * s,  Y + 16 * s, 20 * s, 12 * s, '#a8a8a8', '#cccccc', '#555555', '#1a1a1a');
    // tape stripes
    px(ctx, X + 6 * s,  Y + 19 * s, 20 * s, 1 * s, '#666666');
    px(ctx, X + 6 * s,  Y + 23 * s, 20 * s, 1 * s, '#666666');
    px(ctx, X + 6 * s,  Y + 27 * s, 20 * s, 1 * s, '#666666');
    // peeling tape edge (chaos detail)
    px(ctx, X + 5 * s,  Y + 21 * s, 1 * s, 4 * s, '#888888');
    // top mount
    cyl(ctx, X + 10 * s, Y + 10 * s, 12 * s, 6 * s, '#777777', '#999999', '#333333', '#1a1a1a');
    // bell rim
    rect(ctx, X + 8 * s,  Y + 28 * s, 16 * s, 2 * s, '#444444', '#1a1a1a');
    // hot inside the bell
    if (frame && frame.thrusting) {
      px(ctx, X + 10 * s, Y + 26 * s, 12 * s, 2 * s, '#ff7733');
    }
    // exhaust flame
    if (frame && frame.thrusting) {
      flame(ctx, X + 16 * s, Y + 30 * s, 14 * s, 14 * s, frame.t,
            ['#ff5511', '#ffcc33', '#ffeeaa']);
    }
  }

  function drawFirework(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // tube (red cardboard)
    cyl(ctx, X + 8 * s,  Y + 8 * s,  16 * s, 22 * s, '#cc2222', '#ee4444', '#770000', '#330000');
    // gold bands (printed on the tube)
    rect(ctx, X + 8 * s,  Y + 14 * s, 16 * s, 4 * s,  '#ffcc33', '#996600');
    px(ctx, X + 8 * s,  Y + 14 * s, 16 * s, 1 * s, '#ffeeaa');
    // text-y squiggle
    px(ctx, X + 12 * s, Y + 16 * s, 8 * s, 1 * s, '#cc8800');
    // cone top
    rect(ctx, X + 12 * s, Y + 4 * s,  8 * s,  4 * s,  '#cc2222', '#770000');
    rect(ctx, X + 14 * s, Y + 0 * s,  4 * s,  4 * s,  '#ffeecc', '#aa8844');
    // fuse
    px(ctx, X + 16 * s, Y - 2 * s, 1 * s, 2 * s, '#664400');
    // bottom igniter
    rect(ctx, X + 8 * s,  Y + 30 * s, 16 * s, 2 * s,  '#222222', null);
    // chaotic flame (firework-style)
    if (frame && frame.thrusting) {
      const r = ((frame.t * 7) | 0) % 5;
      // big bursty outer
      rect(ctx, X + (6 - r) * s, Y + 32 * s, (20 + r * 2) * s, (10 + r) * s, '#ff5511');
      rect(ctx, X + (10 - r) * s, Y + (38 + r) * s, (12 + r * 2) * s, 4 * s, '#ff5511');
      // mid
      rect(ctx, X + (10 - r) * s, Y + 33 * s, (12 + r * 2) * s, (8 + r) * s, '#ff8833');
      // bright core
      rect(ctx, X + 13 * s, Y + 34 * s, 6 * s, (10 + r) * s, '#ffff88');
      // sparks shooting sideways
      px(ctx, X + (4 + r) * s, Y + (36 + r) * s, 2 * s, 1 * s, '#ffeebb');
      px(ctx, X + (28 - r) * s, Y + (38 - r) * s, 2 * s, 1 * s, '#ffeebb');
      px(ctx, X + (8 - r) * s, Y + (42 - r) * s, 1 * s, 2 * s, '#ffff88');
    }
  }

  function drawLeafBlower(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // intake (top fan housing)
    cyl(ctx, X + 12 * s, Y + 4 * s,  8 * s,  10 * s, '#33aacc', '#66ccee', '#114466', '#062234');
    // fan blades visible
    px(ctx, X + 14 * s, Y + 6 * s, 4 * s, 1 * s, '#222233');
    px(ctx, X + 14 * s, Y + 9 * s, 4 * s, 1 * s, '#222233');
    px(ctx, X + 14 * s, Y + 12 * s, 4 * s, 1 * s, '#222233');
    // main body (turbine housing)
    cyl(ctx, X + 4 * s,  Y + 14 * s, 24 * s, 12 * s, '#33aacc', '#66ccee', '#114466', '#062234');
    // viewport / sticker
    rect(ctx, X + 6 * s,  Y + 16 * s, 6 * s,  6 * s, '#88ddff', '#114466');
    px(ctx, X + 7 * s,  Y + 17 * s, 1 * s, 1 * s, '#ffffff');
    // power label
    rect(ctx, X + 14 * s, Y + 18 * s, 12 * s, 4 * s, '#ffaa22', '#552200');
    px(ctx, X + 16 * s, Y + 19 * s, 8 * s, 2 * s, '#ffeeaa');
    // outflow pipe
    cyl(ctx, X + 8 * s,  Y + 26 * s, 16 * s, 4 * s, '#666666', '#999999', '#222222', '#1a1a1a');
    // cool blue flame
    if (frame && frame.thrusting) {
      flame(ctx, X + 16 * s, Y + 30 * s, 12 * s, 12 * s, frame.t,
            ['#33aacc', '#88ddff', '#ffffff']);
    }
  }

  function drawNuclearCore(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 36 * s;
    // hazard stripe header
    rect(ctx, X + 4 * s,  Y + 4 * s,  24 * s, 4 * s,  '#ffcc00', '#666600');
    px(ctx, X + 6 * s,  Y + 4 * s, 4 * s, 4 * s, '#000000');
    px(ctx, X + 14 * s, Y + 4 * s, 4 * s, 4 * s, '#000000');
    px(ctx, X + 22 * s, Y + 4 * s, 4 * s, 4 * s, '#000000');
    // shielding casing
    cyl(ctx, X + 4 * s,  Y + 8 * s,  24 * s, 24 * s, '#444444', '#666666', '#222222', '#0a0a0a');
    // inner radiation glow window
    const glow = frame ? ((frame.t % 8 < 4) ? '#88ff88' : '#aaffaa') : '#88ff88';
    cyl(ctx, X + 8 * s,  Y + 12 * s, 16 * s, 16 * s, glow, '#ccffcc', '#226622', '#114411');
    // hot core dot
    rect(ctx, X + 12 * s, Y + 16 * s, 8 * s, 8 * s, '#ffffff');
    px(ctx, X + 13 * s, Y + 17 * s, 6 * s, 1 * s, glow);
    // radiation symbol
    px(ctx, X + 15 * s, Y + 19 * s, 2 * s, 2 * s, '#226622');
    // exhaust port
    rect(ctx, X + 10 * s, Y + 32 * s, 12 * s, 4 * s, '#222233', '#0a0a14');
    // green nuclear flame
    if (frame && frame.thrusting) {
      flame(ctx, X + 16 * s, Y + 36 * s, 18 * s, 18 * s, frame.t,
            ['#33aa33', '#aaffaa', '#ffffff']);
      // extra glow halo
      px(ctx, X + 6 * s, Y + 38 * s, 20 * s, 1 * s, '#88ff88');
    }
  }

  function drawCardboardFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 14 * s;
    // left fin (jagged cardboard)
    rect(ctx, X + 0 * s,   Y + 8 * s,  6 * s, 6 * s, '#aa7744', '#553311');
    rect(ctx, X + 0 * s,   Y + 4 * s,  4 * s, 4 * s, '#aa7744', '#553311');
    px(ctx, X + 0 * s, Y + 4 * s, 4 * s, 1 * s, '#cc9966');
    // right fin
    rect(ctx, X + 26 * s,  Y + 8 * s,  6 * s, 6 * s, '#aa7744', '#553311');
    rect(ctx, X + 28 * s,  Y + 4 * s,  4 * s, 4 * s, '#aa7744', '#553311');
    px(ctx, X + 28 * s, Y + 4 * s, 4 * s, 1 * s, '#cc9966');
    // duct tape holding them on
    px(ctx, X + 4 * s,  Y + 6 * s, 2 * s, 6 * s, '#aaaaaa');
    px(ctx, X + 26 * s, Y + 6 * s, 2 * s, 6 * s, '#aaaaaa');
    px(ctx, X + 4 * s,  Y + 7 * s, 2 * s, 1 * s, '#dddddd');
    px(ctx, X + 26 * s, Y + 7 * s, 2 * s, 1 * s, '#dddddd');
    // center connector
    cyl(ctx, X + 12 * s, Y + 8 * s, 8 * s, 6 * s, '#777777', '#999999', '#333333', '#1a1a1a');
  }

  function drawSteelFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 16 * s;
    // left fin (swept aerodynamic)
    rect(ctx, X + 0 * s,   Y + 8 * s,  8 * s, 8 * s, '#7799cc', '#223355');
    rect(ctx, X + 0 * s,   Y + 4 * s,  6 * s, 4 * s, '#7799cc', '#223355');
    rect(ctx, X + 0 * s,   Y + 0 * s,  4 * s, 4 * s, '#7799cc', '#223355');
    // metallic shine
    px(ctx, X + 1 * s, Y + 4 * s, 1 * s, 10 * s, '#aabbdd');
    // right fin
    rect(ctx, X + 24 * s,  Y + 8 * s,  8 * s, 8 * s, '#7799cc', '#223355');
    rect(ctx, X + 26 * s,  Y + 4 * s,  6 * s, 4 * s, '#7799cc', '#223355');
    rect(ctx, X + 28 * s,  Y + 0 * s,  4 * s, 4 * s, '#7799cc', '#223355');
    px(ctx, X + 30 * s, Y + 4 * s, 1 * s, 10 * s, '#aabbdd');
    // center connector with bolts
    cyl(ctx, X + 12 * s,  Y + 8 * s,  8 * s, 8 * s, '#aaaabb', '#ccccdd', '#444466', '#1a1a22');
    px(ctx, X + 14 * s, Y + 10 * s, 1 * s, 1 * s, '#222244');
    px(ctx, X + 18 * s, Y + 10 * s, 1 * s, 1 * s, '#222244');
    px(ctx, X + 14 * s, Y + 14 * s, 1 * s, 1 * s, '#222244');
    px(ctx, X + 18 * s, Y + 14 * s, 1 * s, 1 * s, '#222244');
  }

  // ---- catalog --------------------------------------------------------------
  const ALL = [
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
      thrustVariance: 0.6,
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
