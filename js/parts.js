/* ==========================================================
   PARTS — catalog of 10 starter parts.

   Sprites use these helpers:
     px(ctx, x, y, w, h, color)         — solid pixel block
     rect(ctx, x, y, w, h, fill, out)   — block + 1px outline
     cyl(ctx, x, y, w, h, body, hi, lo, outline)  — shaded cylinder
     flame(...)                          — layered engine flame

   Plus per-sprite icons for screws, labels, hazard symbols.

   Each part draws within a 32×32 cell with bottom anchored at (cx, by).
   The hangar builder renders sprites at scale 1.0 (40×40 thumbnail),
   the build canvas at 2.0, and flight at 1.5 — so 1px details are
   highly visible. Detail counts.
   ========================================================== */
(function (global) {
  'use strict';

  // ---- core pixel helpers ---------------------------------------------------
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
  function cyl(ctx, x, y, w, h, body, hi, lo, outline) {
    rect(ctx, x, y, w, h, body, outline);
    if (hi) px(ctx, x + 1, y + 1, 1, h - 2, hi);
    if (lo) px(ctx, x + w - 2, y + 1, 1, h - 2, lo);
  }
  function flame(ctx, cx, top, baseW, len, t, colors) {
    const flick  = (t % 4 < 2) ? 0 : 1;
    const flick2 = (t % 6 < 3) ? 0 : 2;
    const wow    = (t % 8 < 4) ? 0 : 1;
    const outer  = colors[0], mid = colors[1], core = colors[2];
    rect(ctx, cx - baseW / 2 - 2 + wow, top, baseW + 4, len + flick2, outer);
    rect(ctx, cx - baseW / 2 + 1, top + len + flick2, baseW - 2, 3 + flick, outer);
    rect(ctx, cx - baseW / 2, top + 1, baseW, len + flick, mid);
    rect(ctx, cx - baseW / 2 + 2, top + len + flick, baseW - 4, 2 + flick2, mid);
    rect(ctx, cx - baseW / 2 + 2, top + 2, baseW - 4, len - 2, core);
    rect(ctx, cx - 1, top + len - 1 + flick, 2, 2, '#ffffff');
  }

  // ---- detail helpers -------------------------------------------------------
  function bolt(ctx, x, y, s, dark, hi) {
    // 2x2 bolt with a 1-pixel highlight on the upper-left
    px(ctx, x, y, 2 * s, 2 * s, dark || '#1a1a1a');
    px(ctx, x, y, 1 * s, 1 * s, hi || '#888');
  }
  function rivet(ctx, x, y, s) {
    // small 1x1 rivet dot
    px(ctx, x, y, 1 * s, 1 * s, '#1a1a1a');
  }
  function trefoil(ctx, cx, cy, s, color) {
    // tiny radiation trefoil symbol (~6×6)
    px(ctx, cx, cy, 1 * s, 1 * s, color);
    px(ctx, cx - 2 * s, cy - 2 * s, 2 * s, 2 * s, color);
    px(ctx, cx + 1 * s, cy - 2 * s, 2 * s, 2 * s, color);
    px(ctx, cx - 1 * s, cy + 1 * s, 2 * s, 2 * s, color);
  }
  function chevron(ctx, x, y, s, color) {
    // small 6x4 caution chevron
    px(ctx, x, y + 2 * s, 2 * s, 1 * s, color);
    px(ctx, x + 2 * s, y + 1 * s, 2 * s, 1 * s, color);
    px(ctx, x + 4 * s, y, 2 * s, 1 * s, color);
  }
  // ridges/corrugation: parallel 1-px ribs on a vertical span
  function ridges(ctx, x, y, w, h, color, every) {
    every = every || 3;
    for (let yy = y; yy < y + h; yy += every) px(ctx, x, yy, w, 1, color);
  }
  // brand text: a row of micro-rectangles that read as letters
  function brandRow(ctx, x, y, s, color) {
    // S-C-R-A-P pattern in 1-px shapes (~2px wide each, 1px gap)
    px(ctx, x, y, 2 * s, 3 * s, color);          // S
    px(ctx, x + 3 * s, y, 2 * s, 3 * s, color);  // C
    px(ctx, x + 6 * s, y, 2 * s, 3 * s, color);  // R
    px(ctx, x + 9 * s, y, 2 * s, 3 * s, color);  // A
    px(ctx, x + 12 * s, y, 2 * s, 3 * s, color); // P
    // gaps to suggest letters
    px(ctx, x + 1 * s, y + 1 * s, 1 * s, 1 * s, '#222');
    px(ctx, x + 4 * s, y + 1 * s, 1 * s, 1 * s, '#222');
    px(ctx, x + 7 * s, y + 1 * s, 1 * s, 1 * s, '#222');
    px(ctx, x + 10 * s, y + 1 * s, 1 * s, 1 * s, '#222');
    px(ctx, x + 13 * s, y + 1 * s, 1 * s, 1 * s, '#222');
  }

  // ============================================================
  // PARTS — sprite functions
  // ============================================================

  function drawSodaBottle(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // wear scuff on the right side
    px(ctx, X + 24 * s, Y + 11 * s, 1 * s, 4 * s, '#669944');
    // bottle cap with screw ridges
    cyl(ctx, X + 12 * s, Y + 0,        8 * s, 4 * s,  '#cc4422', '#ee6644', '#882211', '#441100');
    px(ctx, X + 12 * s, Y + 1 * s, 8 * s, 1 * s, '#ee6644');
    px(ctx, X + 13 * s, Y + 2 * s, 1 * s, 1 * s, '#882211');
    px(ctx, X + 15 * s, Y + 2 * s, 1 * s, 1 * s, '#882211');
    px(ctx, X + 17 * s, Y + 2 * s, 1 * s, 1 * s, '#882211');
    px(ctx, X + 19 * s, Y + 2 * s, 1 * s, 1 * s, '#882211');
    // threaded neck
    cyl(ctx, X + 10 * s, Y + 4 * s,   12 * s, 5 * s,  '#aacc77', '#cce099', '#668844', '#445522');
    px(ctx, X + 10 * s, Y + 5 * s, 12 * s, 1 * s, '#cce099');
    px(ctx, X + 10 * s, Y + 7 * s, 12 * s, 1 * s, '#668844');
    // shoulder taper
    rect(ctx, X + 8 * s, Y + 9 * s, 16 * s, 2 * s, '#bbdd88', '#445522');
    // main bottle body
    cyl(ctx, X + 6 * s,  Y + 11 * s,  20 * s, 19 * s, '#bbdd88', '#ddeeaa', '#669944', '#445522');
    // bright vertical highlight on left (translucent feel)
    px(ctx, X + 7 * s, Y + 12 * s, 1 * s, 17 * s, '#ddeeaa');
    px(ctx, X + 8 * s, Y + 12 * s, 1 * s, 4 * s, '#f0ffd0');
    // big red label band
    rect(ctx, X + 6 * s,  Y + 14 * s, 20 * s, 8 * s,  '#cc3333', '#552211');
    px(ctx, X + 7 * s,  Y + 14 * s, 18 * s, 1 * s, '#ee5544');  // top highlight
    px(ctx, X + 7 * s,  Y + 21 * s, 18 * s, 1 * s, '#992211');  // bottom shadow
    // SCRAP COLA branding (5 letterforms)
    brandRow(ctx, X + 8 * s, Y + 16 * s, s, '#ffeecc');
    // fizz bubbles in liquid
    px(ctx, X + 8 * s,  Y + 23 * s, 2 * s, 1 * s, '#ddeeaa');
    px(ctx, X + 13 * s, Y + 25 * s, 1 * s, 1 * s, '#ddeeaa');
    px(ctx, X + 18 * s, Y + 24 * s, 1 * s, 1 * s, '#ddeeaa');
    px(ctx, X + 22 * s, Y + 27 * s, 2 * s, 1 * s, '#ddeeaa');
    px(ctx, X + 11 * s, Y + 28 * s, 1 * s, 1 * s, '#ddeeaa');
    // condensation droplets
    px(ctx, X + 10 * s, Y + 17 * s, 1 * s, 1 * s, '#f0ffe0');
    px(ctx, X + 19 * s, Y + 19 * s, 1 * s, 1 * s, '#f0ffe0');
    // bottle base lip
    rect(ctx, X + 6 * s, Y + 30 * s, 20 * s, 2 * s, '#669944', '#445522');
  }

  function drawSoupCan(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // top rim with pull-tab indicator
    rect(ctx, X + 4 * s,  Y + 1 * s,  24 * s, 4 * s,  '#cccccc', '#444444');
    px(ctx, X + 5 * s,  Y + 2 * s, 22 * s, 1 * s, '#ffffff');
    px(ctx, X + 14 * s, Y + 0,        4 * s, 2 * s, '#aaaaaa');  // pull-tab nub
    // body with corrugated ribs
    cyl(ctx, X + 4 * s,  Y + 5 * s,  24 * s, 23 * s, '#cc3333', '#ee5544', '#882211', '#440000');
    // rib lines (1 pixel rings every 5 pixels)
    px(ctx, X + 4 * s, Y + 7 * s,  24 * s, 1 * s, '#aa2222');
    px(ctx, X + 4 * s, Y + 25 * s, 24 * s, 1 * s, '#aa2222');
    // cream label panel
    rect(ctx, X + 6 * s, Y + 10 * s, 20 * s, 12 * s, '#fff3cc', '#aa8855');
    px(ctx, X + 7 * s, Y + 10 * s, 18 * s, 1 * s, '#ffffff');   // label highlight
    px(ctx, X + 7 * s, Y + 21 * s, 18 * s, 1 * s, '#ddc888');   // label shadow
    // red brand band across label
    rect(ctx, X + 6 * s, Y + 13 * s, 20 * s, 3 * s, '#cc3333', null);
    px(ctx, X + 6 * s, Y + 13 * s, 20 * s, 1 * s, '#ee5544');
    // SCRAP brand letters on the band
    brandRow(ctx, X + 8 * s, Y + 14 * s, s, '#ffeecc');
    // fine print (small dashes below band)
    for (let i = 0; i < 5; i++) px(ctx, X + (8 + i * 3) * s, Y + 18 * s, 2 * s, 1 * s, '#aa8855');
    // dent (chaos detail)
    px(ctx, X + 22 * s, Y + 19 * s, 2 * s, 3 * s, '#882211');
    // bottom rim
    rect(ctx, X + 4 * s,  Y + 28 * s, 24 * s, 4 * s,  '#cccccc', '#444444');
    px(ctx, X + 5 * s,  Y + 29 * s, 22 * s, 1 * s, '#ffffff');
    px(ctx, X + 5 * s,  Y + 31 * s, 22 * s, 1 * s, '#888888');
    // barcode
    px(ctx, X + 7 * s,  Y + 19 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 9 * s,  Y + 19 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 10 * s, Y + 19 * s, 2 * s, 2 * s, '#222');
  }

  function drawLawnChair(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 28 * s;
    // backrest top bar
    rect(ctx, X + 4 * s, Y + 0,         24 * s, 2 * s, '#888899', '#333344');
    // backrest webbing (orange + alternating cream stripes)
    for (let i = 0; i < 3; i++) {
      const yy = Y + (2 + i * 4) * s;
      rect(ctx, X + 6 * s, yy, 18 * s, 2 * s, '#ff9933', '#552200');
      px(ctx, X + 6 * s, yy, 18 * s, 1 * s, '#ffbb55');
      // criss-cross weave hint
      for (let j = 0; j < 9; j++) {
        px(ctx, X + (7 + j * 2) * s, yy + 1 * s, 1 * s, 1 * s, '#cc7722');
      }
    }
    // armrest caps (rounded plastic feel)
    rect(ctx, X + 2 * s,  Y + 8 * s, 4 * s, 2 * s, '#ddaa77', '#552200');
    rect(ctx, X + 26 * s, Y + 8 * s, 4 * s, 2 * s, '#ddaa77', '#552200');
    // armrest tubes
    px(ctx, X + 4 * s,  Y + 10 * s, 2 * s, 4 * s, '#aabbcc');
    px(ctx, X + 26 * s, Y + 10 * s, 2 * s, 4 * s, '#aabbcc');
    // duct tape patch on left armrest
    px(ctx, X + 3 * s, Y + 11 * s, 4 * s, 2 * s, '#aaaaaa');
    px(ctx, X + 4 * s, Y + 11 * s, 1 * s, 1 * s, '#cccccc');
    // seat with weave
    rect(ctx, X + 4 * s,  Y + 14 * s, 22 * s, 4 * s, '#ff9933', '#552200');
    px(ctx, X + 4 * s,  Y + 14 * s, 22 * s, 1 * s, '#ffbb55');
    for (let i = 0; i < 11; i++) {
      px(ctx, X + (5 + i * 2) * s, Y + 16 * s, 1 * s, 1 * s, '#cc7722');
    }
    // beverage holder (cup hole)
    rect(ctx, X + 22 * s, Y + 14 * s, 4 * s, 4 * s, '#222', null);
    px(ctx, X + 23 * s, Y + 15 * s, 2 * s, 2 * s, '#000');
    // legs (steel tubing with bracket bolts)
    cyl(ctx, X + 4 * s,  Y + 18 * s, 2 * s,  10 * s, '#999999', '#cccccc', '#444444');
    cyl(ctx, X + 24 * s, Y + 18 * s, 2 * s,  10 * s, '#999999', '#cccccc', '#444444');
    // cross brace
    rect(ctx, X + 6 * s, Y + 23 * s, 18 * s, 1 * s, '#777777', null);
    // duct-tape strap holding rocket
    rect(ctx, X + 2 * s, Y + 12 * s, 28 * s, 1 * s, '#bbbbbb', null);
    px(ctx, X + 4 * s, Y + 12 * s, 6 * s, 1 * s, '#dddddd');
    // foot pads
    rect(ctx, X + 3 * s,  Y + 27 * s, 4 * s, 1 * s, '#222', null);
    rect(ctx, X + 23 * s, Y + 27 * s, 4 * s, 1 * s, '#222', null);
  }

  function drawShoppingCart(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 30 * s;
    // basket top frame
    rect(ctx, X + 2 * s,  Y + 2 * s,  28 * s, 2 * s, '#bbbbbb', '#222222');
    // basket body
    rect(ctx, X + 2 * s,  Y + 4 * s,  28 * s, 18 * s, '#aaaaaa', '#222222');
    // vertical mesh wires
    for (let i = 0; i < 7; i++) {
      px(ctx, X + (4 + i * 4) * s, Y + 4 * s, 1 * s, 18 * s, '#666666');
    }
    // horizontal mesh wires
    px(ctx, X + 2 * s, Y + 8 * s,  28 * s, 1 * s, '#666666');
    px(ctx, X + 2 * s, Y + 12 * s, 28 * s, 1 * s, '#666666');
    px(ctx, X + 2 * s, Y + 16 * s, 28 * s, 1 * s, '#666666');
    // front-edge highlight
    px(ctx, X + 3 * s, Y + 5 * s, 26 * s, 1 * s, '#dddddd');
    // child-seat fold line (diagonal slot)
    px(ctx, X + 8 * s, Y + 6 * s, 6 * s, 1 * s, '#444');
    px(ctx, X + 9 * s, Y + 7 * s, 6 * s, 1 * s, '#444');
    // ad placard (yellow card on the side)
    rect(ctx, X + 18 * s, Y + 14 * s, 8 * s, 4 * s, '#ffcc33', '#664400');
    px(ctx, X + 19 * s, Y + 15 * s, 6 * s, 1 * s, '#000');
    px(ctx, X + 19 * s, Y + 16 * s, 4 * s, 1 * s, '#000');
    // wheels with hubs
    cyl(ctx, X + 4 * s,  Y + 24 * s, 6 * s, 6 * s, '#222222', '#444444', '#000000', '#000000');
    cyl(ctx, X + 22 * s, Y + 24 * s, 6 * s, 6 * s, '#222222', '#444444', '#000000', '#000000');
    px(ctx, X + 6 * s,  Y + 26 * s, 2 * s, 2 * s, '#888888');
    px(ctx, X + 24 * s, Y + 26 * s, 2 * s, 2 * s, '#888888');
    px(ctx, X + 7 * s,  Y + 27 * s, 1 * s, 1 * s, '#cccccc');
    px(ctx, X + 25 * s, Y + 27 * s, 1 * s, 1 * s, '#cccccc');
    // wheel struts
    px(ctx, X + 8 * s,  Y + 22 * s, 1 * s, 4 * s, '#444');
    px(ctx, X + 22 * s, Y + 22 * s, 1 * s, 4 * s, '#444');
    // red plastic handle bar with rubber grip
    rect(ctx, X + 26 * s, Y + 0 * s,  4 * s, 6 * s, '#cc3333', '#440000');
    px(ctx, X + 27 * s, Y + 1 * s, 1 * s, 4 * s, '#ee5555');
    px(ctx, X + 26 * s, Y + 1 * s, 4 * s, 1 * s, '#882222');
    px(ctx, X + 26 * s, Y + 3 * s, 4 * s, 1 * s, '#882222');
    // coin slot
    rect(ctx, X + 6 * s, Y + 1 * s, 3 * s, 1 * s, '#222', null);
  }

  function drawDuctTape(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // top mount with bolts (bolted to fuel tank above)
    cyl(ctx, X + 10 * s, Y + 8 * s, 12 * s, 4 * s, '#777777', '#999999', '#333333', '#1a1a1a');
    rivet(ctx, X + 11 * s, Y + 9 * s, s);
    rivet(ctx, X + 14 * s, Y + 9 * s, s);
    rivet(ctx, X + 17 * s, Y + 9 * s, s);
    rivet(ctx, X + 20 * s, Y + 9 * s, s);
    // serial stencil on the throat
    px(ctx, X + 13 * s, Y + 12 * s, 1 * s, 1 * s, '#222');
    px(ctx, X + 15 * s, Y + 12 * s, 1 * s, 1 * s, '#222');
    px(ctx, X + 17 * s, Y + 12 * s, 2 * s, 1 * s, '#222');
    // status warning sticker on the bell shoulder
    px(ctx, X + 9 * s, Y + 18 * s, 4 * s, 2 * s, '#ffcc33');
    px(ctx, X + 10 * s, Y + 18 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 12 * s, Y + 18 * s, 1 * s, 2 * s, '#222');
    // fuel injection collar
    cyl(ctx, X + 11 * s, Y + 12 * s, 10 * s, 2 * s, '#555555', '#777777', '#333333', '#1a1a1a');
    // throat (narrow neck)
    cyl(ctx, X + 12 * s, Y + 14 * s, 8 * s, 2 * s, '#888888', '#aaaaaa', '#444444', '#1a1a1a');
    // bell (widening, bell-mouth shape)
    rect(ctx, X + 10 * s, Y + 16 * s, 12 * s, 2 * s, '#a8a8a8', '#1a1a1a');
    rect(ctx, X + 8 * s,  Y + 18 * s, 16 * s, 2 * s, '#a8a8a8', '#1a1a1a');
    rect(ctx, X + 7 * s,  Y + 20 * s, 18 * s, 8 * s, '#a8a8a8', '#1a1a1a');
    // duct tape wraps (varying gray)
    px(ctx, X + 7 * s,  Y + 21 * s, 18 * s, 1 * s, '#888888');
    px(ctx, X + 7 * s,  Y + 23 * s, 18 * s, 1 * s, '#666666');
    px(ctx, X + 7 * s,  Y + 25 * s, 18 * s, 1 * s, '#888888');
    px(ctx, X + 7 * s,  Y + 27 * s, 18 * s, 1 * s, '#666666');
    // peeling tape edge for chaos
    px(ctx, X + 6 * s,  Y + 22 * s, 1 * s, 4 * s, '#aaaaaa');
    px(ctx, X + 6 * s,  Y + 22 * s, 2 * s, 1 * s, '#cccccc');
    // sloppy "X" cross-tape patch
    px(ctx, X + 13 * s, Y + 22 * s, 1 * s, 4 * s, '#999999');
    px(ctx, X + 19 * s, Y + 22 * s, 1 * s, 4 * s, '#999999');
    // metallic vertical highlight
    px(ctx, X + 9 * s, Y + 19 * s, 1 * s, 9 * s, '#cccccc');
    // bell rim (heat-darkened bottom edge)
    rect(ctx, X + 6 * s,  Y + 28 * s, 20 * s, 2 * s, '#444444', '#1a1a1a');
    px(ctx, X + 6 * s, Y + 28 * s, 20 * s, 1 * s, '#666666');
    // inside of bell — dark (or hot when thrusting)
    if (frame && frame.thrusting) {
      px(ctx, X + 9 * s, Y + 26 * s, 14 * s, 2 * s, '#ff7733');
      px(ctx, X + 11 * s, Y + 25 * s, 10 * s, 1 * s, '#ffeeaa');
    } else {
      px(ctx, X + 9 * s, Y + 26 * s, 14 * s, 2 * s, '#1a1a1a');
    }
    // "NO STEP" stencil (suggestion via 4-bar pattern)
    px(ctx, X + 11 * s, Y + 19 * s, 2 * s, 1 * s, '#444');
    px(ctx, X + 14 * s, Y + 19 * s, 2 * s, 1 * s, '#444');
    px(ctx, X + 17 * s, Y + 19 * s, 2 * s, 1 * s, '#444');
    px(ctx, X + 20 * s, Y + 19 * s, 1 * s, 1 * s, '#444');
    // exhaust flame
    if (frame && frame.thrusting) {
      flame(ctx, X + 16 * s, Y + 30 * s, 14 * s, 14 * s, frame.t,
            ['#ff5511', '#ffcc33', '#ffeeaa']);
    }
  }

  function drawFirework(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // pointy cone top with star pattern
    rect(ctx, X + 13 * s, Y + 6 * s,  6 * s, 4 * s, '#cc2222', '#770000');
    rect(ctx, X + 14 * s, Y + 4 * s,  4 * s, 2 * s, '#cc2222', '#770000');
    rect(ctx, X + 15 * s, Y + 2 * s,  2 * s, 2 * s, '#cc2222', '#770000');
    px(ctx, X + 15 * s, Y + 3 * s, 1 * s, 1 * s, '#ee4444');
    // fuse with sparkle
    px(ctx, X + 16 * s, Y - 2 * s, 1 * s, 4 * s, '#664400');
    px(ctx, X + 16 * s, Y - 3 * s, 1 * s, 1 * s, '#ffaa00');
    // tube body (red cardboard)
    cyl(ctx, X + 8 * s,  Y + 10 * s, 16 * s, 20 * s, '#cc2222', '#ee4444', '#770000', '#330000');
    // primary gold band (top)
    rect(ctx, X + 8 * s,  Y + 12 * s, 16 * s, 3 * s,  '#ffcc33', '#996600');
    px(ctx, X + 8 * s,  Y + 12 * s, 16 * s, 1 * s, '#ffeeaa');
    // BLASTO brand letters (5-letter pattern)
    brandRow(ctx, X + 9 * s, Y + 13 * s, s, '#cc2222');
    // secondary gold band (middle)
    rect(ctx, X + 8 * s, Y + 18 * s, 16 * s, 2 * s, '#ffcc33', '#996600');
    // little star icon
    px(ctx, X + 11 * s, Y + 22 * s, 1 * s, 1 * s, '#ffcc33');
    px(ctx, X + 10 * s, Y + 23 * s, 3 * s, 1 * s, '#ffcc33');
    px(ctx, X + 11 * s, Y + 24 * s, 1 * s, 1 * s, '#ffcc33');
    // warning chevron decal on right side
    chevron(ctx, X + 18 * s, Y + 22 * s, s, '#ffcc33');
    // tertiary gold band (bottom)
    rect(ctx, X + 8 * s, Y + 26 * s, 16 * s, 2 * s, '#ffcc33', '#996600');
    // bottom igniter (charred black)
    rect(ctx, X + 8 * s, Y + 30 * s, 16 * s, 2 * s, '#222222', '#000000');
    px(ctx, X + 9 * s, Y + 30 * s, 14 * s, 1 * s, '#444');
    // chaotic flame
    if (frame && frame.thrusting) {
      const r = ((frame.t * 7) | 0) % 5;
      rect(ctx, X + (6 - r) * s, Y + 32 * s, (20 + r * 2) * s, (10 + r) * s, '#ff5511');
      rect(ctx, X + (10 - r) * s, Y + (38 + r) * s, (12 + r * 2) * s, 4 * s, '#ff5511');
      rect(ctx, X + (10 - r) * s, Y + 33 * s, (12 + r * 2) * s, (8 + r) * s, '#ff8833');
      rect(ctx, X + 13 * s, Y + 34 * s, 6 * s, (10 + r) * s, '#ffff88');
      px(ctx, X + (4 + r) * s, Y + (36 + r) * s, 2 * s, 1 * s, '#ffeebb');
      px(ctx, X + (28 - r) * s, Y + (38 - r) * s, 2 * s, 1 * s, '#ffeebb');
      px(ctx, X + (8 - r) * s, Y + (42 - r) * s, 1 * s, 2 * s, '#ffff88');
    }
  }

  function drawLeafBlower(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // intake fan housing
    cyl(ctx, X + 12 * s, Y + 2 * s,  8 * s, 12 * s, '#33aacc', '#66ccee', '#114466', '#062234');
    // visible fan blades behind grille
    px(ctx, X + 13 * s, Y + 4 * s, 6 * s, 1 * s, '#222233');
    px(ctx, X + 13 * s, Y + 7 * s, 6 * s, 1 * s, '#222233');
    px(ctx, X + 13 * s, Y + 10 * s, 6 * s, 1 * s, '#222233');
    px(ctx, X + 13 * s, Y + 13 * s, 6 * s, 1 * s, '#222233');
    // central fan hub
    px(ctx, X + 15 * s, Y + 8 * s, 2 * s, 2 * s, '#aa6622');
    // intake rim
    rect(ctx, X + 12 * s, Y + 1 * s, 8 * s, 1 * s, '#bbeeff', null);
    // main turbine body
    cyl(ctx, X + 4 * s,  Y + 14 * s, 24 * s, 12 * s, '#33aacc', '#66ccee', '#114466', '#062234');
    // cooling slats (vent grille)
    px(ctx, X + 6 * s,  Y + 17 * s, 6 * s, 1 * s, '#062234');
    px(ctx, X + 6 * s,  Y + 19 * s, 6 * s, 1 * s, '#062234');
    px(ctx, X + 6 * s,  Y + 21 * s, 6 * s, 1 * s, '#062234');
    // viewport / status display
    rect(ctx, X + 14 * s, Y + 16 * s, 6 * s, 5 * s, '#88ddff', '#114466');
    px(ctx, X + 15 * s, Y + 17 * s, 1 * s, 1 * s, '#ffffff');
    px(ctx, X + 17 * s, Y + 18 * s, 1 * s, 1 * s, '#88ff88'); // green status LED
    // TURBO power label
    rect(ctx, X + 22 * s, Y + 17 * s, 5 * s, 4 * s, '#ffaa22', '#552200');
    px(ctx, X + 23 * s, Y + 18 * s, 3 * s, 1 * s, '#ffeeaa');
    px(ctx, X + 23 * s, Y + 19 * s, 1 * s, 1 * s, '#552200');
    px(ctx, X + 25 * s, Y + 19 * s, 1 * s, 1 * s, '#552200');
    // edge bolts holding the housing together
    rivet(ctx, X + 5 * s,  Y + 15 * s, s);
    rivet(ctx, X + 26 * s, Y + 15 * s, s);
    rivet(ctx, X + 5 * s,  Y + 24 * s, s);
    rivet(ctx, X + 26 * s, Y + 24 * s, s);
    // electric cord stub coiling out the back
    px(ctx, X + 4 * s, Y + 22 * s, 2 * s, 1 * s, '#222');
    px(ctx, X + 3 * s, Y + 23 * s, 2 * s, 1 * s, '#222');
    // outflow pipe (where the cool flame comes out)
    cyl(ctx, X + 8 * s,  Y + 26 * s, 16 * s, 4 * s, '#666666', '#999999', '#222222', '#1a1a1a');
    px(ctx, X + 9 * s, Y + 27 * s, 14 * s, 1 * s, '#aaaaaa');
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
    // shielding casing — bolted plate look
    cyl(ctx, X + 4 * s,  Y + 8 * s,  24 * s, 24 * s, '#444444', '#666666', '#222222', '#0a0a0a');
    // corner rivets on the case
    rivet(ctx, X + 5 * s,  Y + 9 * s, s);
    rivet(ctx, X + 26 * s, Y + 9 * s, s);
    rivet(ctx, X + 5 * s,  Y + 30 * s, s);
    rivet(ctx, X + 26 * s, Y + 30 * s, s);
    rivet(ctx, X + 5 * s,  Y + 19 * s, s);
    rivet(ctx, X + 26 * s, Y + 19 * s, s);
    // cooling fins on the sides — heat-tinted when thrusting
    const finHot = frame && frame.thrusting;
    const finTip = finHot ? '#ff7733' : '#666';
    px(ctx, X + 4 * s, Y + 12 * s, 1 * s, 12 * s, '#222');
    px(ctx, X + 27 * s, Y + 12 * s, 1 * s, 12 * s, '#222');
    px(ctx, X + 3 * s, Y + 14 * s, 1 * s, 1 * s, finTip);
    px(ctx, X + 3 * s, Y + 18 * s, 1 * s, 1 * s, finTip);
    px(ctx, X + 3 * s, Y + 22 * s, 1 * s, 1 * s, finTip);
    px(ctx, X + 28 * s, Y + 14 * s, 1 * s, 1 * s, finTip);
    px(ctx, X + 28 * s, Y + 18 * s, 1 * s, 1 * s, finTip);
    px(ctx, X + 28 * s, Y + 22 * s, 1 * s, 1 * s, finTip);
    // coolant hoses across the back (pixel art ribbing)
    px(ctx, X + 4 * s, Y + 28 * s, 24 * s, 1 * s, '#3366aa');
    px(ctx, X + 5 * s, Y + 29 * s, 22 * s, 1 * s, '#1a3358');
    // status LEDs (red + green + blinking yellow) at top of casing
    const blink = frame ? (frame.t % 6 < 3 ? '#ffff44' : '#666600') : '#666600';
    px(ctx, X + 8 * s, Y + 10 * s, 2 * s, 1 * s, '#ff3333');
    px(ctx, X + 11 * s, Y + 10 * s, 2 * s, 1 * s, '#88ff88');
    px(ctx, X + 14 * s, Y + 10 * s, 2 * s, 1 * s, blink);
    // pressure gauge dial
    rect(ctx, X + 18 * s, Y + 9 * s, 7 * s, 4 * s, '#dddddd', '#222');
    px(ctx, X + 21 * s, Y + 11 * s, 1 * s, 1 * s, '#cc0000'); // needle
    px(ctx, X + 22 * s, Y + 10 * s, 1 * s, 1 * s, '#cc0000');
    // inner radiation glow window
    const glow = frame ? ((frame.t % 8 < 4) ? '#88ff88' : '#aaffaa') : '#88ff88';
    cyl(ctx, X + 8 * s,  Y + 14 * s, 16 * s, 14 * s, glow, '#ccffcc', '#226622', '#114411');
    // hot core dot
    rect(ctx, X + 12 * s, Y + 17 * s, 8 * s, 8 * s, '#ffffff');
    px(ctx, X + 13 * s, Y + 18 * s, 6 * s, 1 * s, glow);
    // proper trefoil radiation symbol over the core
    trefoil(ctx, X + 16 * s, Y + 21 * s, s, '#226622');
    // exhaust port
    rect(ctx, X + 10 * s, Y + 32 * s, 12 * s, 4 * s, '#222233', '#0a0a14');
    px(ctx, X + 11 * s, Y + 33 * s, 10 * s, 1 * s, '#444466');
    // green nuclear flame
    if (frame && frame.thrusting) {
      flame(ctx, X + 16 * s, Y + 36 * s, 18 * s, 18 * s, frame.t,
            ['#33aa33', '#aaffaa', '#ffffff']);
      px(ctx, X + 6 * s, Y + 38 * s, 20 * s, 1 * s, '#88ff88');
    }
  }

  function drawCardboardFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 14 * s;
    // left fin (jagged cardboard with corrugation)
    rect(ctx, X + 0 * s,   Y + 8 * s,  6 * s, 6 * s, '#aa7744', '#553311');
    rect(ctx, X + 0 * s,   Y + 4 * s,  4 * s, 4 * s, '#aa7744', '#553311');
    px(ctx, X + 0 * s, Y + 4 * s, 4 * s, 1 * s, '#cc9966');
    // corrugation lines
    px(ctx, X + 1 * s, Y + 9 * s, 4 * s, 1 * s, '#996644');
    px(ctx, X + 1 * s, Y + 11 * s, 4 * s, 1 * s, '#996644');
    px(ctx, X + 1 * s, Y + 13 * s, 4 * s, 1 * s, '#996644');
    // FRAGILE stamp suggestion (red horizontal bar)
    px(ctx, X + 1 * s, Y + 6 * s, 3 * s, 1 * s, '#cc3333');
    // right fin
    rect(ctx, X + 26 * s,  Y + 8 * s,  6 * s, 6 * s, '#aa7744', '#553311');
    rect(ctx, X + 28 * s,  Y + 4 * s,  4 * s, 4 * s, '#aa7744', '#553311');
    px(ctx, X + 28 * s, Y + 4 * s, 4 * s, 1 * s, '#cc9966');
    px(ctx, X + 27 * s, Y + 9 * s, 4 * s, 1 * s, '#996644');
    px(ctx, X + 27 * s, Y + 11 * s, 4 * s, 1 * s, '#996644');
    px(ctx, X + 27 * s, Y + 13 * s, 4 * s, 1 * s, '#996644');
    px(ctx, X + 28 * s, Y + 6 * s, 3 * s, 1 * s, '#cc3333');
    // duct tape strips (criss-cross over the joint)
    px(ctx, X + 4 * s,  Y + 6 * s, 2 * s, 6 * s, '#aaaaaa');
    px(ctx, X + 26 * s, Y + 6 * s, 2 * s, 6 * s, '#aaaaaa');
    px(ctx, X + 4 * s,  Y + 7 * s, 2 * s, 1 * s, '#dddddd');
    px(ctx, X + 26 * s, Y + 7 * s, 2 * s, 1 * s, '#dddddd');
    // diagonal cross-tape for "heavy reinforcement"
    px(ctx, X + 5 * s, Y + 9 * s, 1 * s, 3 * s, '#888');
    px(ctx, X + 6 * s, Y + 8 * s, 1 * s, 3 * s, '#888');
    // center connector with bolts
    cyl(ctx, X + 12 * s, Y + 8 * s, 8 * s, 6 * s, '#777777', '#999999', '#333333', '#1a1a1a');
    rivet(ctx, X + 13 * s, Y + 9 * s, s);
    rivet(ctx, X + 18 * s, Y + 9 * s, s);
    rivet(ctx, X + 13 * s, Y + 12 * s, s);
    rivet(ctx, X + 18 * s, Y + 12 * s, s);
  }

  // ==========================================================
  // NEW PARTS — additional gear for the catalog
  // ==========================================================

  function drawPressureCooker(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // pressure release valve (black knob, hisses when active)
    rect(ctx, X + 14 * s, Y + 0, 4 * s, 3 * s, '#222', '#000');
    px(ctx, X + 15 * s, Y + 1 * s, 2 * s, 1 * s, '#444');
    // wisp of steam — animated with frame.t whether thrusting or idle
    if (frame) {
      const w = (frame.t % 6 < 3) ? 0 : 1;
      const tall = frame.thrusting ? 4 : 2;
      px(ctx, X + 15 * s + w, Y - tall * s, 1 * s, tall * s, 'rgba(220,220,230,0.6)');
      if (frame.thrusting) {
        px(ctx, X + 16 * s - w, Y - 6 * s, 1 * s, 1 * s, 'rgba(220,220,230,0.4)');
      }
    }
    // tiny secondary release valve on the side
    px(ctx, X + 25 * s, Y + 2 * s, 2 * s, 1 * s, '#222');
    // domed lid
    rect(ctx, X + 8 * s,  Y + 3 * s, 16 * s, 3 * s, '#bbbbbb', '#444444');
    rect(ctx, X + 6 * s,  Y + 6 * s, 20 * s, 2 * s, '#cccccc', '#444444');
    px(ctx, X + 7 * s, Y + 6 * s, 18 * s, 1 * s, '#eeeeee');
    // 4 lid clamps (latches)
    rect(ctx, X + 4 * s,  Y + 7 * s, 3 * s, 3 * s, '#555', '#222');
    rect(ctx, X + 25 * s, Y + 7 * s, 3 * s, 3 * s, '#555', '#222');
    px(ctx, X + 5 * s, Y + 8 * s, 1 * s, 1 * s, '#888');
    px(ctx, X + 26 * s, Y + 8 * s, 1 * s, 1 * s, '#888');
    // pressure gauge dial on the lid
    rect(ctx, X + 13 * s, Y + 4 * s, 6 * s, 3 * s, '#dddddd', '#222');
    px(ctx, X + 15 * s, Y + 5 * s, 1 * s, 1 * s, '#cc0000'); // needle
    px(ctx, X + 16 * s, Y + 5 * s, 1 * s, 1 * s, '#cc0000');
    // body — polished stainless cylinder
    cyl(ctx, X + 4 * s,  Y + 10 * s, 24 * s, 18 * s, '#c0c0c8', '#e8e8f0', '#7a7a82', '#222');
    // mid hoop/band
    rect(ctx, X + 4 * s, Y + 17 * s, 24 * s, 2 * s, '#888', '#222');
    px(ctx, X + 5 * s, Y + 17 * s, 22 * s, 1 * s, '#aaaabb');
    // SAFE-T-COOK brand band
    rect(ctx, X + 6 * s, Y + 13 * s, 20 * s, 3 * s, '#cc3333', '#552211');
    brandRow(ctx, X + 8 * s, Y + 14 * s, s, '#ffeecc');
    // rivet ring around body
    for (let i = 0; i < 5; i++) rivet(ctx, X + (6 + i * 4) * s, Y + 21 * s, s);
    // vertical highlight stripe
    px(ctx, X + 6 * s, Y + 11 * s, 1 * s, 16 * s, '#e8e8f0');
    // bottom mount + heating element
    rect(ctx, X + 8 * s, Y + 28 * s, 16 * s, 2 * s, '#666', '#222');
    rect(ctx, X + 10 * s, Y + 30 * s, 12 * s, 2 * s, '#888', '#222');
    if (frame && frame.thrusting) {
      px(ctx, X + 10 * s, Y + 30 * s, 12 * s, 1 * s, '#ff7733');
      flame(ctx, X + 16 * s, Y + 32 * s, 12 * s, 12 * s, frame.t,
            ['#ff5511', '#ffaa44', '#ffeeaa']);
    }
  }

  function drawMagnetron(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // outer microwave box
    rect(ctx, X + 4 * s,  Y + 2 * s,  24 * s, 22 * s, '#333344', '#0a0a14');
    // top brushed-metal panel
    rect(ctx, X + 4 * s,  Y + 2 * s,  24 * s, 4 * s,  '#666677', '#0a0a14');
    px(ctx, X + 5 * s, Y + 3 * s, 22 * s, 1 * s, '#888899');
    // viewing window with glowing magnetron tube
    rect(ctx, X + 6 * s,  Y + 6 * s, 14 * s, 14 * s, '#0a0a0a', '#222');
    // glow inside (pulses when thrusting)
    const lit = frame && frame.thrusting;
    const glow = lit ? ((frame.t % 4 < 2) ? '#ffaa66' : '#ff7733') : '#552211';
    px(ctx, X + 8 * s, Y + 8 * s, 10 * s, 10 * s, glow);
    // magnetron tube center
    rect(ctx, X + 11 * s, Y + 10 * s, 4 * s, 6 * s, '#888', '#222');
    if (lit) {
      px(ctx, X + 12 * s, Y + 11 * s, 2 * s, 4 * s, '#ffeeaa');
      // sparks inside
      const sp = ((frame.t * 3) | 0) % 4;
      px(ctx, X + (8 + sp) * s, Y + (12 + sp) * s, 1 * s, 1 * s, '#ffffff');
      px(ctx, X + (16 - sp) * s, Y + (10 + sp) * s, 1 * s, 1 * s, '#ffffff');
    }
    // window grille (microwave-style mesh dots)
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        if ((i + j) % 2 === 0) {
          px(ctx, X + (7 + i * 3) * s, Y + (8 + j * 3) * s, 1 * s, 1 * s, '#222');
        }
      }
    }
    // control panel on the right
    rect(ctx, X + 21 * s, Y + 6 * s, 6 * s, 14 * s, '#222', '#000');
    // digital display — scrolling timer-like dots
    rect(ctx, X + 22 * s, Y + 7 * s, 4 * s, 3 * s, '#0a1a10', '#000');
    const tShift = frame ? ((frame.t * 0.4) | 0) % 4 : 0;
    px(ctx, X + (22 + tShift) * s, Y + 8 * s, 1 * s, 1 * s, '#2dff85');
    px(ctx, X + (22 + ((tShift + 2) % 4)) * s, Y + 8 * s, 1 * s, 1 * s, '#2dff85');
    // colon separator
    px(ctx, X + 24 * s, Y + 7 * s, 1 * s, 1 * s, '#1f3328');
    // round buttons
    px(ctx, X + 23 * s, Y + 12 * s, 2 * s, 2 * s, '#aaa');
    px(ctx, X + 23 * s, Y + 15 * s, 2 * s, 2 * s, '#aaa');
    px(ctx, X + 23 * s, Y + 18 * s, 2 * s, 2 * s, '#cc3333');
    // vent slats on left
    for (let i = 0; i < 5; i++) px(ctx, X + 5 * s, Y + (7 + i * 3) * s, 1 * s, 1 * s, '#222');
    // brand
    px(ctx, X + 5 * s, Y + 23 * s, 12 * s, 1 * s, '#aaa');
    // exhaust port at bottom
    rect(ctx, X + 8 * s, Y + 24 * s, 16 * s, 4 * s, '#444', '#0a0a14');
    rect(ctx, X + 10 * s, Y + 28 * s, 12 * s, 2 * s, '#222', '#000');
    if (lit) {
      flame(ctx, X + 16 * s, Y + 30 * s, 14 * s, 14 * s, frame.t,
            ['#ff5511', '#ffaa44', '#ffeeaa']);
    }
  }

  function drawBeerKeg(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // tap on top
    rect(ctx, X + 14 * s, Y + 0, 4 * s, 3 * s, '#aaa', '#222');
    px(ctx, X + 15 * s, Y + 1 * s, 2 * s, 1 * s, '#ddd');
    rect(ctx, X + 13 * s, Y + 3 * s, 6 * s, 2 * s, '#666', '#222');
    // domed top with rim hoop
    rect(ctx, X + 6 * s,  Y + 5 * s, 20 * s, 3 * s, '#aaaaaa', '#222');
    rect(ctx, X + 4 * s,  Y + 7 * s, 24 * s, 3 * s, '#888', '#222');
    px(ctx, X + 5 * s, Y + 7 * s, 22 * s, 1 * s, '#bbb');
    // body — stainless cylinder
    cyl(ctx, X + 4 * s,  Y + 10 * s, 24 * s, 18 * s, '#bbbbc4', '#dddde4', '#7a7a82', '#222');
    // mid hoop
    rect(ctx, X + 4 * s, Y + 17 * s, 24 * s, 2 * s, '#666', '#222');
    px(ctx, X + 4 * s, Y + 17 * s, 24 * s, 1 * s, '#888');
    // brand label panel
    rect(ctx, X + 6 * s, Y + 11 * s, 20 * s, 5 * s, '#cc8822', '#552211');
    px(ctx, X + 6 * s, Y + 11 * s, 20 * s, 1 * s, '#eeaa44');
    brandRow(ctx, X + 8 * s, Y + 12 * s, s, '#ffeecc');
    // foam bubbles overflowing the tap (more chaos)
    px(ctx, X + 13 * s, Y + 4 * s, 1 * s, 1 * s, '#ffffff');
    px(ctx, X + 19 * s, Y + 5 * s, 1 * s, 1 * s, '#ffffff');
    px(ctx, X + 16 * s, Y + 3 * s, 1 * s, 1 * s, '#ffffff');
    px(ctx, X + 17 * s, Y + 6 * s, 2 * s, 1 * s, '#ffeecc'); // foam dribble down
    // tap drip below
    px(ctx, X + 16 * s, Y + 8 * s, 1 * s, 2 * s, '#cc9933');
    // condensation droplets
    px(ctx, X + 8 * s, Y + 21 * s, 1 * s, 1 * s, '#ddddee');
    px(ctx, X + 22 * s, Y + 23 * s, 1 * s, 1 * s, '#ddddee');
    // bung hole on the side
    rect(ctx, X + 22 * s, Y + 21 * s, 3 * s, 3 * s, '#222', '#000');
    // bottom rim hoop
    rect(ctx, X + 4 * s, Y + 28 * s, 24 * s, 4 * s, '#888', '#222');
    px(ctx, X + 5 * s, Y + 29 * s, 22 * s, 1 * s, '#bbb');
    px(ctx, X + 5 * s, Y + 31 * s, 22 * s, 1 * s, '#444');
  }

  function drawPropaneTank(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 36 * s;
    // protective ring around valve
    rect(ctx, X + 8 * s,  Y + 0, 16 * s, 1 * s, '#444', null);
    px(ctx, X + 8 * s, Y + 1 * s, 1 * s, 4 * s, '#444');
    px(ctx, X + 23 * s, Y + 1 * s, 1 * s, 4 * s, '#444');
    // valve handle (red BBQ-style)
    rect(ctx, X + 13 * s, Y + 1 * s, 6 * s, 3 * s, '#cc3333', '#552211');
    px(ctx, X + 14 * s, Y + 2 * s, 4 * s, 1 * s, '#ee5544');
    // valve stem
    rect(ctx, X + 15 * s, Y + 4 * s, 2 * s, 2 * s, '#888', '#222');
    // domed top
    rect(ctx, X + 6 * s,  Y + 6 * s, 20 * s, 3 * s, '#dddddd', '#222');
    rect(ctx, X + 4 * s,  Y + 9 * s, 24 * s, 2 * s, '#cccccc', '#222');
    px(ctx, X + 5 * s, Y + 9 * s, 22 * s, 1 * s, '#eeeeee');
    // tall white body
    cyl(ctx, X + 4 * s,  Y + 11 * s, 24 * s, 22 * s, '#dddddd', '#ffffff', '#888888', '#222');
    // hazard warning label (red diamond)
    rect(ctx, X + 6 * s, Y + 14 * s, 8 * s, 8 * s, '#cc3333', '#552211');
    px(ctx, X + 9 * s, Y + 16 * s, 2 * s, 1 * s, '#ffeeaa');  // flame icon
    px(ctx, X + 8 * s, Y + 17 * s, 4 * s, 1 * s, '#ffeeaa');
    px(ctx, X + 7 * s, Y + 18 * s, 6 * s, 2 * s, '#ffeeaa');
    px(ctx, X + 9 * s, Y + 20 * s, 2 * s, 1 * s, '#ffaa00');
    // PROPANE label across (orange band)
    rect(ctx, X + 14 * s, Y + 16 * s, 12 * s, 4 * s, '#ff8822', '#552211');
    brandRow(ctx, X + 14 * s, Y + 17 * s, s, '#ffeecc');
    // hand-painted serial number
    px(ctx, X + 8 * s, Y + 26 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 10 * s, Y + 26 * s, 2 * s, 2 * s, '#222');
    px(ctx, X + 13 * s, Y + 26 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 15 * s, Y + 26 * s, 2 * s, 2 * s, '#222');
    // bottom skirt
    rect(ctx, X + 6 * s, Y + 33 * s, 20 * s, 3 * s, '#999', '#222');
    px(ctx, X + 7 * s, Y + 34 * s, 18 * s, 1 * s, '#bbb');
  }

  function drawTrashCan(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 28 * s;
    // lid with handle
    rect(ctx, X + 4 * s,  Y + 0, 24 * s, 2 * s, '#999999', '#444');
    px(ctx, X + 5 * s, Y + 0, 22 * s, 1 * s, '#bbbbbb');
    // lid handle on top
    rect(ctx, X + 13 * s, Y - 2 * s, 6 * s, 2 * s, '#666', '#222');
    px(ctx, X + 14 * s, Y - 1 * s, 4 * s, 1 * s, '#888');
    // lid lip
    rect(ctx, X + 3 * s,  Y + 2 * s, 26 * s, 2 * s, '#777', '#222');
    px(ctx, X + 4 * s, Y + 2 * s, 24 * s, 1 * s, '#999');
    // body — galvanized steel cylinder
    cyl(ctx, X + 5 * s,  Y + 4 * s, 22 * s, 20 * s, '#888', '#aaaabb', '#555', '#222');
    // 3 horizontal ribs (galvanized look)
    px(ctx, X + 5 * s, Y + 8 * s,  22 * s, 1 * s, '#666');
    px(ctx, X + 5 * s, Y + 14 * s, 22 * s, 1 * s, '#666');
    px(ctx, X + 5 * s, Y + 20 * s, 22 * s, 1 * s, '#666');
    px(ctx, X + 5 * s, Y + 9 * s,  22 * s, 1 * s, '#aaa');
    px(ctx, X + 5 * s, Y + 15 * s, 22 * s, 1 * s, '#aaa');
    px(ctx, X + 5 * s, Y + 21 * s, 22 * s, 1 * s, '#aaa');
    // side handles
    rect(ctx, X + 2 * s,  Y + 11 * s, 3 * s, 4 * s, '#555', '#222');
    rect(ctx, X + 27 * s, Y + 11 * s, 3 * s, 4 * s, '#555', '#222');
    // dent (chaos detail)
    px(ctx, X + 18 * s, Y + 17 * s, 4 * s, 2 * s, '#555');
    // spilled trash hint (banana peel sticking out under lid)
    px(ctx, X + 20 * s, Y + 3 * s, 3 * s, 1 * s, '#ffcc33');
    // base
    rect(ctx, X + 4 * s,  Y + 24 * s, 24 * s, 4 * s, '#555', '#222');
    px(ctx, X + 5 * s, Y + 25 * s, 22 * s, 1 * s, '#777');
  }

  function drawFilingCabinet(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // top surface with rim
    rect(ctx, X + 4 * s,  Y + 0, 24 * s, 3 * s, '#888', '#222');
    px(ctx, X + 5 * s, Y + 1 * s, 22 * s, 1 * s, '#aaa');
    // body box (taller than other bodies)
    rect(ctx, X + 4 * s,  Y + 3 * s, 24 * s, 27 * s, '#999', '#222');
    // left-side highlight
    px(ctx, X + 5 * s, Y + 3 * s, 1 * s, 26 * s, '#bbb');
    px(ctx, X + 26 * s, Y + 3 * s, 1 * s, 26 * s, '#666');
    // 3 drawers with handles + label tabs
    for (let i = 0; i < 3; i++) {
      const dy = Y + (5 + i * 8) * s;
      // drawer face
      rect(ctx, X + 6 * s, dy, 20 * s, 7 * s, '#aaa', '#444');
      px(ctx, X + 6 * s, dy, 20 * s, 1 * s, '#ccc');
      px(ctx, X + 6 * s, dy + 6 * s, 20 * s, 1 * s, '#777');
      // pull handle
      rect(ctx, X + 13 * s, dy + 3 * s, 6 * s, 2 * s, '#666', '#222');
      px(ctx, X + 14 * s, dy + 3 * s, 4 * s, 1 * s, '#888');
      // label tab (white card)
      rect(ctx, X + 8 * s, dy + 1 * s, 4 * s, 2 * s, '#ffffee', '#888');
      px(ctx, X + 9 * s, dy + 2 * s, 2 * s, 1 * s, '#222');
    }
    // brand sticker on top
    rect(ctx, X + 18 * s, Y + 1 * s, 8 * s, 1 * s, '#cc3333', null);
    // wheels at bottom
    rect(ctx, X + 5 * s,  Y + 30 * s, 3 * s, 2 * s, '#222', '#000');
    rect(ctx, X + 24 * s, Y + 30 * s, 3 * s, 2 * s, '#222', '#000');
  }

  function drawPlywoodFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 16 * s;
    // left fin (plywood with grain)
    rect(ctx, X + 0 * s,   Y + 8 * s,  8 * s, 8 * s, '#cc9966', '#553311');
    rect(ctx, X + 0 * s,   Y + 4 * s,  6 * s, 4 * s, '#cc9966', '#553311');
    rect(ctx, X + 0 * s,   Y + 0 * s,  4 * s, 4 * s, '#cc9966', '#553311');
    // wood grain horizontal lines
    px(ctx, X + 1 * s, Y + 2 * s, 3 * s, 1 * s, '#a87a4a');
    px(ctx, X + 1 * s, Y + 6 * s, 5 * s, 1 * s, '#a87a4a');
    px(ctx, X + 1 * s, Y + 10 * s, 6 * s, 1 * s, '#a87a4a');
    px(ctx, X + 1 * s, Y + 13 * s, 7 * s, 1 * s, '#a87a4a');
    // knot detail
    px(ctx, X + 4 * s, Y + 11 * s, 2 * s, 2 * s, '#7a4a2a');
    px(ctx, X + 5 * s, Y + 12 * s, 1 * s, 1 * s, '#5a3a1a');
    // edge highlight
    px(ctx, X + 0 * s, Y + 1 * s, 1 * s, 13 * s, '#eebb88');
    // right fin (mirror)
    rect(ctx, X + 24 * s,  Y + 8 * s,  8 * s, 8 * s, '#cc9966', '#553311');
    rect(ctx, X + 26 * s,  Y + 4 * s,  6 * s, 4 * s, '#cc9966', '#553311');
    rect(ctx, X + 28 * s,  Y + 0 * s,  4 * s, 4 * s, '#cc9966', '#553311');
    px(ctx, X + 28 * s, Y + 2 * s, 3 * s, 1 * s, '#a87a4a');
    px(ctx, X + 26 * s, Y + 6 * s, 5 * s, 1 * s, '#a87a4a');
    px(ctx, X + 25 * s, Y + 10 * s, 6 * s, 1 * s, '#a87a4a');
    px(ctx, X + 24 * s, Y + 13 * s, 7 * s, 1 * s, '#a87a4a');
    px(ctx, X + 26 * s, Y + 11 * s, 2 * s, 2 * s, '#7a4a2a');
    px(ctx, X + 27 * s, Y + 12 * s, 1 * s, 1 * s, '#5a3a1a');
    px(ctx, X + 31 * s, Y + 1 * s, 1 * s, 13 * s, '#eebb88');
    // center connector with bolts
    cyl(ctx, X + 12 * s, Y + 8 * s, 8 * s, 8 * s, '#888', '#aaa', '#444', '#222');
    rivet(ctx, X + 13 * s, Y + 9 * s, s);
    rivet(ctx, X + 18 * s, Y + 9 * s, s);
    rivet(ctx, X + 13 * s, Y + 13 * s, s);
    rivet(ctx, X + 18 * s, Y + 13 * s, s);
  }

  // ==========================================================
  // BATCH 3 — even more parts
  // ==========================================================

  function drawHairdryer(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // barrel (where heat comes out — points down)
    cyl(ctx, X + 8 * s,  Y + 4 * s,  16 * s, 14 * s, '#ff66aa', '#ff99cc', '#992244', '#440011');
    // brand label band
    rect(ctx, X + 9 * s, Y + 9 * s, 14 * s, 3 * s, '#ffffff', '#992244');
    px(ctx, X + 11 * s, Y + 10 * s, 1 * s, 1 * s, '#ff66aa');
    px(ctx, X + 13 * s, Y + 10 * s, 1 * s, 1 * s, '#ff66aa');
    px(ctx, X + 15 * s, Y + 10 * s, 1 * s, 1 * s, '#ff66aa');
    px(ctx, X + 17 * s, Y + 10 * s, 1 * s, 1 * s, '#ff66aa');
    px(ctx, X + 19 * s, Y + 10 * s, 1 * s, 1 * s, '#ff66aa');
    // heating coils visible inside the barrel mouth
    const hot = frame && frame.thrusting;
    rect(ctx, X + 10 * s, Y + 14 * s, 12 * s, 4 * s, hot ? '#ff5500' : '#444', '#222');
    if (hot) {
      px(ctx, X + 11 * s, Y + 15 * s, 10 * s, 1 * s, '#ffaa44');
      px(ctx, X + 11 * s, Y + 17 * s, 10 * s, 1 * s, '#ffaa44');
    } else {
      px(ctx, X + 11 * s, Y + 15 * s, 10 * s, 1 * s, '#666');
      px(ctx, X + 11 * s, Y + 17 * s, 10 * s, 1 * s, '#666');
    }
    // air vents on the back
    rect(ctx, X + 8 * s, Y + 0, 16 * s, 4 * s, '#cc4488', '#440011');
    for (let i = 0; i < 7; i++) px(ctx, X + (9 + i * 2) * s, Y + 1 * s, 1 * s, 2 * s, '#220011');
    // pistol grip handle
    rect(ctx, X + 12 * s, Y + 18 * s, 8 * s, 10 * s, '#ff66aa', '#440011');
    px(ctx, X + 13 * s, Y + 19 * s, 1 * s, 8 * s, '#ff99cc');
    // trigger
    rect(ctx, X + 11 * s, Y + 20 * s, 2 * s, 4 * s, '#222', '#000');
    // cool/hot/off slider switch — slides depending on thrust state
    rect(ctx, X + 14 * s, Y + 22 * s, 4 * s, 2 * s, '#ddd', '#222');
    px(ctx, X + (hot ? 17 : 14) * s, Y + 22 * s, 1 * s, 2 * s, hot ? '#cc0000' : '#3399cc');
    // power LED — green when on
    px(ctx, X + 19 * s, Y + 22 * s, 1 * s, 1 * s, hot ? '#88ff88' : '#226622');
    // power cord coiled at handle, ending in plug
    px(ctx, X + 16 * s, Y + 28 * s, 1 * s, 4 * s, '#222');
    px(ctx, X + 17 * s, Y + 31 * s, 3 * s, 1 * s, '#222');
    px(ctx, X + 19 * s, Y + 30 * s, 2 * s, 2 * s, '#888'); // plug prongs
    px(ctx, X + 20 * s, Y + 31 * s, 1 * s, 1 * s, '#222');
    if (hot) {
      flame(ctx, X + 16 * s, Y + 18 * s, 10 * s, 8 * s, frame.t,
            ['#ff5511', '#ffaa44', '#ffeeaa']);
    }
  }

  function drawLawnmower(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // boxy engine block
    rect(ctx, X + 4 * s,  Y + 4 * s,  24 * s, 16 * s, '#3a6b3a', '#1a3a1a');
    px(ctx, X + 5 * s, Y + 5 * s, 22 * s, 1 * s, '#5a8b5a');
    // top edge / cooling fins
    for (let i = 0; i < 5; i++) px(ctx, X + (6 + i * 4) * s, Y + 6 * s, 2 * s, 1 * s, '#2a4b2a');
    // BRIGGS-style brand band
    rect(ctx, X + 6 * s, Y + 9 * s, 20 * s, 4 * s, '#ffcc33', '#664400');
    brandRow(ctx, X + 8 * s, Y + 10 * s, s, '#3a6b3a');
    // pull cord with grip
    px(ctx, X + 26 * s, Y + 7 * s, 1 * s, 5 * s, '#222');
    rect(ctx, X + 27 * s, Y + 7 * s, 3 * s, 3 * s, '#cc3333', '#552211');
    px(ctx, X + 28 * s, Y + 8 * s, 1 * s, 1 * s, '#ee5544');
    // gas cap with embossed F
    rect(ctx, X + 22 * s, Y + 4 * s, 4 * s, 2 * s, '#222', '#000');
    px(ctx, X + 23 * s, Y + 4 * s, 2 * s, 1 * s, '#444');
    px(ctx, X + 24 * s, Y + 4 * s, 1 * s, 2 * s, '#666');
    // tiny fuel-level gauge (white window with float dot)
    rect(ctx, X + 14 * s, Y + 5 * s, 6 * s, 2 * s, '#ddffdd', '#1a3a1a');
    px(ctx, X + 16 * s, Y + 6 * s, 1 * s, 1 * s, '#cc3333');
    // oil cap on the other side
    px(ctx, X + 6 * s, Y + 4 * s, 3 * s, 1 * s, '#222');
    px(ctx, X + 7 * s, Y + 5 * s, 1 * s, 1 * s, '#444');
    // spark plug stub on top
    rect(ctx, X + 8 * s, Y + 2 * s, 2 * s, 3 * s, '#888', '#222');
    px(ctx, X + 8 * s, Y + 2 * s, 2 * s, 1 * s, '#ccc');
    // muffler / smokestack on the side
    cyl(ctx, X + 28 * s, Y + 14 * s, 4 * s, 8 * s, '#444', '#666', '#222', '#000');
    // smoke if running
    if (frame && frame.thrusting) {
      const w = (frame.t % 6 < 3) ? 0 : 1;
      px(ctx, X + (29 + w) * s, Y + 11 * s, 2 * s, 2 * s, 'rgba(120,120,120,0.7)');
      px(ctx, X + (28 + w) * s, Y + 8 * s, 3 * s, 2 * s, 'rgba(140,140,140,0.5)');
    }
    // visible bolts on the block
    rivet(ctx, X + 5 * s, Y + 17 * s, s);
    rivet(ctx, X + 26 * s, Y + 17 * s, s);
    rivet(ctx, X + 5 * s, Y + 6 * s, s);
    // exhaust manifold + nozzle
    rect(ctx, X + 8 * s,  Y + 20 * s, 16 * s, 4 * s, '#666', '#222');
    rect(ctx, X + 10 * s, Y + 24 * s, 12 * s, 4 * s, '#888', '#222');
    px(ctx, X + 11 * s, Y + 25 * s, 10 * s, 1 * s, '#bbb');
    rect(ctx, X + 12 * s, Y + 28 * s, 8 * s, 2 * s, '#222', '#000');
    if (frame && frame.thrusting) {
      flame(ctx, X + 16 * s, Y + 30 * s, 12 * s, 12 * s, frame.t,
            ['#aa4422', '#ff8833', '#ffeeaa']);
    }
  }

  function drawSalvagedMotor(ctx, cx, by, s, frame) {
    const X = cx - 16 * s, Y = by - 36 * s;
    // turbopump assembly at top
    cyl(ctx, X + 10 * s, Y + 0,        12 * s, 4 * s, '#aaaabb', '#ccccdd', '#555566', '#0a0a14');
    // fuel + oxidizer feed lines
    px(ctx, X + 6 * s,  Y + 1 * s, 4 * s, 2 * s, '#cc3333');  // red fuel line
    px(ctx, X + 22 * s, Y + 1 * s, 4 * s, 2 * s, '#3366cc');  // blue ox line
    // turbopump bolts
    rivet(ctx, X + 11 * s, Y + 1 * s, s);
    rivet(ctx, X + 14 * s, Y + 1 * s, s);
    rivet(ctx, X + 17 * s, Y + 1 * s, s);
    rivet(ctx, X + 20 * s, Y + 1 * s, s);
    // injector dome
    rect(ctx, X + 8 * s,  Y + 4 * s, 16 * s, 4 * s, '#888', '#222');
    px(ctx, X + 9 * s, Y + 5 * s, 14 * s, 1 * s, '#bbb');
    // combustion chamber (proper cylindrical)
    cyl(ctx, X + 9 * s,  Y + 8 * s, 14 * s, 8 * s, '#666', '#888', '#333', '#0a0a14');
    // heat-shielded panels
    px(ctx, X + 10 * s, Y + 9 * s, 1 * s, 6 * s, '#aaa');
    px(ctx, X + 21 * s, Y + 9 * s, 1 * s, 6 * s, '#aaa');
    // serial / "PROPERTY OF" stencil
    px(ctx, X + 11 * s, Y + 11 * s, 2 * s, 1 * s, '#222');
    px(ctx, X + 14 * s, Y + 11 * s, 2 * s, 1 * s, '#222');
    px(ctx, X + 17 * s, Y + 11 * s, 2 * s, 1 * s, '#222');
    px(ctx, X + 20 * s, Y + 11 * s, 1 * s, 1 * s, '#222');
    // expansion nozzle (proper bell shape — wider toward bottom)
    rect(ctx, X + 9 * s,  Y + 16 * s, 14 * s, 2 * s, '#888', '#222');
    rect(ctx, X + 8 * s,  Y + 18 * s, 16 * s, 2 * s, '#999', '#222');
    rect(ctx, X + 7 * s,  Y + 20 * s, 18 * s, 2 * s, '#aaa', '#222');
    rect(ctx, X + 6 * s,  Y + 22 * s, 20 * s, 2 * s, '#aaa', '#222');
    rect(ctx, X + 5 * s,  Y + 24 * s, 22 * s, 8 * s, '#bbb', '#222');
    // bell rib lines
    px(ctx, X + 5 * s, Y + 26 * s, 22 * s, 1 * s, '#999');
    px(ctx, X + 5 * s, Y + 28 * s, 22 * s, 1 * s, '#888');
    px(ctx, X + 5 * s, Y + 30 * s, 22 * s, 1 * s, '#777');
    // metallic vertical highlight on the bell
    px(ctx, X + 6 * s, Y + 25 * s, 1 * s, 7 * s, '#ddd');
    // hot inside the bell when burning
    if (frame && frame.thrusting) {
      px(ctx, X + 8 * s, Y + 30 * s, 16 * s, 2 * s, '#ff7733');
      px(ctx, X + 10 * s, Y + 28 * s, 12 * s, 2 * s, '#ffaa44');
      flame(ctx, X + 16 * s, Y + 32 * s, 18 * s, 18 * s, frame.t,
            ['#ff5511', '#ffcc33', '#ffffff']);
    } else {
      px(ctx, X + 8 * s, Y + 30 * s, 16 * s, 2 * s, '#222');
    }
    // bell rim
    rect(ctx, X + 5 * s, Y + 32 * s, 22 * s, 1 * s, '#444', null);
  }

  function drawHairsprayCluster(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 32 * s;
    // 6 small aerosol cans arranged in a 3x2 grid, wired together
    const cols = [
      { x: X + 4 * s,  c1: '#cc3399', c2: '#882266' },  // pink
      { x: X + 13 * s, c1: '#ffcc33', c2: '#996600' },  // gold
      { x: X + 22 * s, c1: '#3399cc', c2: '#226688' },  // blue
    ];
    // top row
    cols.forEach(col => {
      // spray nozzle
      rect(ctx, col.x + 2 * s, Y + 0, 2 * s, 2 * s, '#222', null);
      px(ctx, col.x + 2 * s, Y + 1 * s, 2 * s, 1 * s, '#444');
      // cap
      rect(ctx, col.x, Y + 2 * s, 6 * s, 2 * s, '#888', '#222');
      // body
      cyl(ctx, col.x, Y + 4 * s, 6 * s, 10 * s, col.c1, '#ffffff', col.c2, '#222');
      // brand band
      rect(ctx, col.x, Y + 7 * s, 6 * s, 2 * s, '#ffffff', col.c2);
      px(ctx, col.x + 1 * s, Y + 7 * s, 4 * s, 1 * s, col.c1);
      // bottom
      rect(ctx, col.x, Y + 14 * s, 6 * s, 1 * s, col.c2, null);
    });
    // bottom row
    cols.forEach(col => {
      rect(ctx, col.x + 2 * s, Y + 16 * s, 2 * s, 2 * s, '#222', null);
      rect(ctx, col.x, Y + 18 * s, 6 * s, 2 * s, '#888', '#222');
      cyl(ctx, col.x, Y + 20 * s, 6 * s, 10 * s, col.c1, '#ffffff', col.c2, '#222');
      rect(ctx, col.x, Y + 23 * s, 6 * s, 2 * s, '#ffffff', col.c2);
      px(ctx, col.x + 1 * s, Y + 23 * s, 4 * s, 1 * s, col.c1);
      rect(ctx, col.x, Y + 30 * s, 6 * s, 1 * s, col.c2, null);
    });
    // wires zigzagging between cans
    px(ctx, X + 10 * s, Y + 5 * s, 3 * s, 1 * s, '#222');
    px(ctx, X + 19 * s, Y + 5 * s, 3 * s, 1 * s, '#222');
    px(ctx, X + 10 * s, Y + 21 * s, 3 * s, 1 * s, '#222');
    px(ctx, X + 19 * s, Y + 21 * s, 3 * s, 1 * s, '#222');
    px(ctx, X + 10 * s, Y + 12 * s, 1 * s, 8 * s, '#222');
    px(ctx, X + 19 * s, Y + 12 * s, 1 * s, 8 * s, '#222');
    // duct tape strip across the middle
    rect(ctx, X + 4 * s, Y + 14 * s, 24 * s, 2 * s, '#aaa', '#222');
    px(ctx, X + 5 * s, Y + 14 * s, 22 * s, 1 * s, '#ccc');
  }

  function drawIndustrialDrum(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 38 * s;
    // top rim with bung holes
    rect(ctx, X + 4 * s,  Y + 1 * s, 24 * s, 3 * s, '#999', '#222');
    px(ctx, X + 5 * s, Y + 2 * s, 22 * s, 1 * s, '#bbb');
    rect(ctx, X + 9 * s, Y + 0, 4 * s, 1 * s, '#222', null);  // bung
    rect(ctx, X + 19 * s, Y + 0, 4 * s, 1 * s, '#222', null); // bung
    // body — industrial yellow drum
    cyl(ctx, X + 4 * s,  Y + 4 * s, 24 * s, 28 * s, '#e8b820', '#ffd644', '#aa8800', '#553300');
    // top hoop band
    rect(ctx, X + 4 * s, Y + 8 * s, 24 * s, 2 * s, '#aa8800', '#553300');
    // middle hoop band
    rect(ctx, X + 4 * s, Y + 18 * s, 24 * s, 2 * s, '#aa8800', '#553300');
    // bottom hoop band
    rect(ctx, X + 4 * s, Y + 28 * s, 24 * s, 2 * s, '#aa8800', '#553300');
    // hazard warning placard
    rect(ctx, X + 7 * s, Y + 11 * s, 9 * s, 6 * s, '#ffffff', '#222');
    // diamond shape with skull-like dots
    px(ctx, X + 11 * s, Y + 12 * s, 1 * s, 4 * s, '#222');
    px(ctx, X + 9 * s, Y + 14 * s, 5 * s, 1 * s, '#222');
    px(ctx, X + 10 * s, Y + 13 * s, 3 * s, 1 * s, '#cc3333');
    // brand text band
    rect(ctx, X + 17 * s, Y + 11 * s, 9 * s, 6 * s, '#cc3333', '#552211');
    brandRow(ctx, X + 18 * s, Y + 13 * s, s, '#ffeecc');
    // serial / batch number
    px(ctx, X + 7 * s, Y + 22 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 9 * s, Y + 22 * s, 2 * s, 2 * s, '#222');
    px(ctx, X + 12 * s, Y + 22 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 14 * s, Y + 22 * s, 2 * s, 2 * s, '#222');
    px(ctx, X + 17 * s, Y + 22 * s, 2 * s, 2 * s, '#222');
    // dent
    px(ctx, X + 22 * s, Y + 24 * s, 3 * s, 2 * s, '#aa8800');
    // bottom rim
    rect(ctx, X + 4 * s, Y + 32 * s, 24 * s, 4 * s, '#999', '#222');
    px(ctx, X + 5 * s, Y + 33 * s, 22 * s, 1 * s, '#bbb');
    px(ctx, X + 5 * s, Y + 35 * s, 22 * s, 1 * s, '#444');
    // vertical highlight
    px(ctx, X + 5 * s, Y + 5 * s, 1 * s, 26 * s, '#ffd644');
  }

  function drawWheelbarrow(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 28 * s;
    // tray bed (orange/red plastic)
    rect(ctx, X + 4 * s,  Y + 4 * s,  24 * s, 14 * s, '#cc3333', '#552211');
    // tray rim
    rect(ctx, X + 3 * s,  Y + 3 * s,  26 * s, 2 * s, '#ee5544', '#552211');
    px(ctx, X + 4 * s, Y + 4 * s, 24 * s, 1 * s, '#dd4444');
    // rivets along the rim
    rivet(ctx, X + 5 * s, Y + 5 * s, s);
    rivet(ctx, X + 14 * s, Y + 5 * s, s);
    rivet(ctx, X + 23 * s, Y + 5 * s, s);
    // dirt/cargo inside (mound)
    rect(ctx, X + 8 * s,  Y + 9 * s, 16 * s, 5 * s, '#5a3820', '#3a2614');
    px(ctx, X + 10 * s, Y + 9 * s, 12 * s, 1 * s, '#7a4830');
    // handle bars (wood)
    rect(ctx, X + 24 * s, Y + 10 * s, 6 * s, 2 * s, '#aa7744', '#553311');
    px(ctx, X + 25 * s, Y + 10 * s, 5 * s, 1 * s, '#cc9966');
    rect(ctx, X + 24 * s, Y + 16 * s, 6 * s, 2 * s, '#aa7744', '#553311');
    px(ctx, X + 25 * s, Y + 16 * s, 5 * s, 1 * s, '#cc9966');
    // single wheel in front
    cyl(ctx, X + 1 * s,  Y + 16 * s, 8 * s, 8 * s, '#222', '#444', '#000', '#000');
    px(ctx, X + 3 * s, Y + 18 * s, 4 * s, 4 * s, '#888');
    px(ctx, X + 4 * s, Y + 19 * s, 2 * s, 2 * s, '#ccc');
    // axle support / fork
    rect(ctx, X + 6 * s,  Y + 14 * s, 6 * s, 2 * s, '#666', '#222');
    rect(ctx, X + 8 * s,  Y + 16 * s, 2 * s, 4 * s, '#666', '#222');
    // legs (rear support)
    rect(ctx, X + 22 * s, Y + 18 * s, 2 * s, 8 * s, '#888', '#444');
    rect(ctx, X + 8 * s,  Y + 22 * s, 2 * s, 4 * s, '#888', '#444');
  }

  function drawFridge(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 38 * s;
    // top vent grille
    rect(ctx, X + 4 * s,  Y + 0, 24 * s, 2 * s, '#999', '#222');
    for (let i = 0; i < 7; i++) px(ctx, X + (5 + i * 3) * s, Y + 0, 2 * s, 1 * s, '#666');
    // body — white kitchen appliance
    rect(ctx, X + 4 * s,  Y + 2 * s, 24 * s, 34 * s, '#f0f0f0', '#888');
    px(ctx, X + 5 * s, Y + 3 * s, 22 * s, 1 * s, '#ffffff');
    // freezer door (top section)
    rect(ctx, X + 5 * s,  Y + 4 * s, 22 * s, 10 * s, '#e8e8e8', '#888');
    px(ctx, X + 5 * s, Y + 14 * s, 22 * s, 1 * s, '#bbb');
    // freezer handle
    rect(ctx, X + 22 * s, Y + 7 * s, 4 * s, 4 * s, '#aaaaaa', '#444');
    px(ctx, X + 23 * s, Y + 7 * s, 2 * s, 1 * s, '#ddd');
    // main fridge door (bottom section)
    rect(ctx, X + 5 * s,  Y + 15 * s, 22 * s, 19 * s, '#e8e8e8', '#888');
    // big handle
    rect(ctx, X + 22 * s, Y + 17 * s, 4 * s, 14 * s, '#aaaaaa', '#444');
    px(ctx, X + 23 * s, Y + 17 * s, 2 * s, 1 * s, '#ddd');
    // door hinges (left side)
    rect(ctx, X + 4 * s, Y + 6 * s, 2 * s, 3 * s, '#666', '#222');
    rect(ctx, X + 4 * s, Y + 18 * s, 2 * s, 3 * s, '#666', '#222');
    rect(ctx, X + 4 * s, Y + 28 * s, 2 * s, 3 * s, '#666', '#222');
    // brand badge
    rect(ctx, X + 11 * s, Y + 18 * s, 8 * s, 3 * s, '#222', null);
    brandRow(ctx, X + 11 * s, Y + 19 * s, s * 0.5, '#cccccc');
    // refrigerator magnets / stickers (chaos)
    px(ctx, X + 8 * s, Y + 6 * s, 3 * s, 2 * s, '#ffcc33');  // smiley magnet
    px(ctx, X + 9 * s, Y + 7 * s, 1 * s, 1 * s, '#222');
    px(ctx, X + 13 * s, Y + 24 * s, 4 * s, 3 * s, '#cc3333'); // photo
    px(ctx, X + 14 * s, Y + 25 * s, 2 * s, 1 * s, '#ffeecc');
    // power indicator LED
    px(ctx, X + 7 * s, Y + 5 * s, 1 * s, 1 * s, '#88ff88');
    // bottom kickplate
    rect(ctx, X + 4 * s,  Y + 36 * s, 24 * s, 2 * s, '#666', '#222');
  }

  function drawPizzaBoxFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 14 * s;
    // left fin (square pizza box piece)
    rect(ctx, X + 0 * s,   Y + 4 * s,  10 * s, 10 * s, '#cc9966', '#553311');
    // box flap fold line
    px(ctx, X + 0 * s, Y + 8 * s, 10 * s, 1 * s, '#996644');
    // grease stain
    px(ctx, X + 4 * s, Y + 9 * s, 3 * s, 2 * s, '#aa7744');
    // pepperoni dot showing through grease
    px(ctx, X + 5 * s, Y + 10 * s, 2 * s, 1 * s, '#882211');
    // cheese drip dribble at the bottom edge
    px(ctx, X + 3 * s, Y + 13 * s, 1 * s, 2 * s, '#ffeebb');
    px(ctx, X + 7 * s, Y + 13 * s, 1 * s, 2 * s, '#ffeebb');
    // pizza brand stripe (red)
    rect(ctx, X + 0 * s, Y + 5 * s, 10 * s, 2 * s, '#cc3333', '#552211');
    px(ctx, X + 0 * s, Y + 5 * s, 10 * s, 1 * s, '#ee5544');
    // pizza brand letters
    px(ctx, X + 1 * s, Y + 6 * s, 1 * s, 1 * s, '#ffeecc');
    px(ctx, X + 3 * s, Y + 6 * s, 1 * s, 1 * s, '#ffeecc');
    px(ctx, X + 5 * s, Y + 6 * s, 1 * s, 1 * s, '#ffeecc');
    px(ctx, X + 7 * s, Y + 6 * s, 1 * s, 1 * s, '#ffeecc');
    // tomato icon (small red circle next to letters)
    px(ctx, X + 9 * s, Y + 6 * s, 1 * s, 1 * s, '#ffcc33');
    // edge highlight
    px(ctx, X + 0 * s, Y + 4 * s, 10 * s, 1 * s, '#eebb88');
    // right fin (mirror)
    rect(ctx, X + 22 * s,  Y + 4 * s,  10 * s, 10 * s, '#cc9966', '#553311');
    px(ctx, X + 22 * s, Y + 8 * s, 10 * s, 1 * s, '#996644');
    px(ctx, X + 26 * s, Y + 9 * s, 3 * s, 2 * s, '#aa7744');
    px(ctx, X + 27 * s, Y + 10 * s, 2 * s, 1 * s, '#882211'); // pepperoni
    px(ctx, X + 25 * s, Y + 13 * s, 1 * s, 2 * s, '#ffeebb'); // cheese drip
    px(ctx, X + 29 * s, Y + 13 * s, 1 * s, 2 * s, '#ffeebb');
    rect(ctx, X + 22 * s, Y + 5 * s, 10 * s, 2 * s, '#cc3333', '#552211');
    px(ctx, X + 22 * s, Y + 5 * s, 10 * s, 1 * s, '#ee5544');
    px(ctx, X + 24 * s, Y + 6 * s, 1 * s, 1 * s, '#ffeecc');
    px(ctx, X + 26 * s, Y + 6 * s, 1 * s, 1 * s, '#ffeecc');
    px(ctx, X + 28 * s, Y + 6 * s, 1 * s, 1 * s, '#ffeecc');
    px(ctx, X + 30 * s, Y + 6 * s, 1 * s, 1 * s, '#ffeecc');
    px(ctx, X + 22 * s, Y + 4 * s, 1 * s, 1 * s, '#ffcc33'); // tomato
    px(ctx, X + 22 * s, Y + 4 * s, 10 * s, 1 * s, '#eebb88');
    // duct tape attaching the fins
    px(ctx, X + 10 * s, Y + 6 * s, 2 * s, 6 * s, '#aaaaaa');
    px(ctx, X + 20 * s, Y + 6 * s, 2 * s, 6 * s, '#aaaaaa');
    // center connector
    rect(ctx, X + 12 * s, Y + 8 * s, 8 * s, 6 * s, '#777', '#222');
  }

  function drawStopSignFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 16 * s;
    // octagonal red stop sign on each side
    // left fin
    rect(ctx, X + 1 * s,  Y + 4 * s, 8 * s, 8 * s, '#cc1122', '#440011');
    // octagon corners (clip 4 corner pixels for octagon shape)
    px(ctx, X + 1 * s, Y + 4 * s, 1 * s, 1 * s, '#553344');  // dark sky behind corner
    px(ctx, X + 8 * s, Y + 4 * s, 1 * s, 1 * s, '#553344');
    px(ctx, X + 1 * s, Y + 11 * s, 1 * s, 1 * s, '#553344');
    px(ctx, X + 8 * s, Y + 11 * s, 1 * s, 1 * s, '#553344');
    // top edge highlight
    px(ctx, X + 2 * s, Y + 4 * s, 6 * s, 1 * s, '#ee3344');
    // STOP letters (white on red)
    px(ctx, X + 3 * s, Y + 7 * s, 1 * s, 2 * s, '#fff');
    px(ctx, X + 4 * s, Y + 7 * s, 1 * s, 1 * s, '#fff');
    px(ctx, X + 5 * s, Y + 8 * s, 1 * s, 1 * s, '#fff');
    px(ctx, X + 6 * s, Y + 7 * s, 1 * s, 2 * s, '#fff');
    // pole stub
    rect(ctx, X + 4 * s, Y + 12 * s, 2 * s, 4 * s, '#888', '#222');
    // right fin (mirror)
    rect(ctx, X + 23 * s, Y + 4 * s, 8 * s, 8 * s, '#cc1122', '#440011');
    px(ctx, X + 23 * s, Y + 4 * s, 1 * s, 1 * s, '#553344');
    px(ctx, X + 30 * s, Y + 4 * s, 1 * s, 1 * s, '#553344');
    px(ctx, X + 23 * s, Y + 11 * s, 1 * s, 1 * s, '#553344');
    px(ctx, X + 30 * s, Y + 11 * s, 1 * s, 1 * s, '#553344');
    px(ctx, X + 24 * s, Y + 4 * s, 6 * s, 1 * s, '#ee3344');
    px(ctx, X + 25 * s, Y + 7 * s, 1 * s, 2 * s, '#fff');
    px(ctx, X + 26 * s, Y + 7 * s, 1 * s, 1 * s, '#fff');
    px(ctx, X + 27 * s, Y + 8 * s, 1 * s, 1 * s, '#fff');
    px(ctx, X + 28 * s, Y + 7 * s, 1 * s, 2 * s, '#fff');
    rect(ctx, X + 26 * s, Y + 12 * s, 2 * s, 4 * s, '#888', '#222');
    // center connector
    cyl(ctx, X + 12 * s, Y + 8 * s, 8 * s, 8 * s, '#aaa', '#ccc', '#666', '#222');
    rivet(ctx, X + 13 * s, Y + 9 * s, s);
    rivet(ctx, X + 18 * s, Y + 9 * s, s);
    rivet(ctx, X + 13 * s, Y + 13 * s, s);
    rivet(ctx, X + 18 * s, Y + 13 * s, s);
  }

  function drawAerospaceFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 16 * s;
    // left fin: sleek titanium swept aerodynamic
    rect(ctx, X + 0 * s,   Y + 6 * s,  10 * s, 10 * s, '#dde0e8', '#445566');
    rect(ctx, X + 0 * s,   Y + 3 * s,  8 * s, 3 * s,  '#dde0e8', '#445566');
    rect(ctx, X + 0 * s,   Y + 0 * s,  6 * s, 3 * s,  '#dde0e8', '#445566');
    // gloss highlight
    px(ctx, X + 1 * s, Y + 1 * s, 1 * s, 14 * s, '#ffffff');
    px(ctx, X + 0 * s, Y + 4 * s, 1 * s, 1 * s, '#ffffff');
    // black stripe
    px(ctx, X + 0 * s, Y + 10 * s, 10 * s, 1 * s, '#222');
    // brand stencil (red triangle warning)
    px(ctx, X + 4 * s, Y + 12 * s, 1 * s, 1 * s, '#cc1122');
    px(ctx, X + 3 * s, Y + 13 * s, 3 * s, 1 * s, '#cc1122');
    // serial number
    px(ctx, X + 6 * s, Y + 13 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 7 * s, Y + 14 * s, 1 * s, 1 * s, '#222');
    // right fin (mirror)
    rect(ctx, X + 22 * s,  Y + 6 * s,  10 * s, 10 * s, '#dde0e8', '#445566');
    rect(ctx, X + 24 * s,  Y + 3 * s,  8 * s, 3 * s,  '#dde0e8', '#445566');
    rect(ctx, X + 26 * s,  Y + 0 * s,  6 * s, 3 * s,  '#dde0e8', '#445566');
    px(ctx, X + 30 * s, Y + 1 * s, 1 * s, 14 * s, '#ffffff');
    px(ctx, X + 31 * s, Y + 4 * s, 1 * s, 1 * s, '#ffffff');
    px(ctx, X + 22 * s, Y + 10 * s, 10 * s, 1 * s, '#222');
    px(ctx, X + 27 * s, Y + 12 * s, 1 * s, 1 * s, '#cc1122');
    px(ctx, X + 26 * s, Y + 13 * s, 3 * s, 1 * s, '#cc1122');
    px(ctx, X + 25 * s, Y + 13 * s, 1 * s, 2 * s, '#222');
    px(ctx, X + 24 * s, Y + 14 * s, 1 * s, 1 * s, '#222');
    // center connector — milled aluminum bracket
    cyl(ctx, X + 12 * s, Y + 6 * s, 8 * s, 10 * s, '#bbbbcc', '#eeeeff', '#666677', '#222');
    px(ctx, X + 12 * s, Y + 6 * s, 8 * s, 1 * s, '#ffffff');
    bolt(ctx, X + 13 * s, Y + 8 * s, s);
    bolt(ctx, X + 17 * s, Y + 8 * s, s);
    bolt(ctx, X + 13 * s, Y + 13 * s, s);
    bolt(ctx, X + 17 * s, Y + 13 * s, s);
  }

  function drawSteelFin(ctx, cx, by, s) {
    const X = cx - 16 * s, Y = by - 16 * s;
    // left fin with swept aerodynamic shape
    rect(ctx, X + 0 * s,   Y + 8 * s,  8 * s, 8 * s, '#7799cc', '#223355');
    rect(ctx, X + 0 * s,   Y + 4 * s,  6 * s, 4 * s, '#7799cc', '#223355');
    rect(ctx, X + 0 * s,   Y + 0 * s,  4 * s, 4 * s, '#7799cc', '#223355');
    // metallic shine on leading edge
    px(ctx, X + 1 * s, Y + 1 * s, 1 * s, 14 * s, '#aabbdd');
    px(ctx, X + 0 * s, Y + 2 * s, 1 * s, 1 * s, '#cce0ff');
    // rivets along the leading edge
    rivet(ctx, X + 2 * s, Y + 4 * s, s);
    rivet(ctx, X + 2 * s, Y + 8 * s, s);
    rivet(ctx, X + 2 * s, Y + 12 * s, s);
    // stencil number on left fin
    px(ctx, X + 4 * s, Y + 11 * s, 1 * s, 2 * s, '#fff');
    px(ctx, X + 5 * s, Y + 11 * s, 1 * s, 1 * s, '#fff');
    // right fin (mirror)
    rect(ctx, X + 24 * s,  Y + 8 * s,  8 * s, 8 * s, '#7799cc', '#223355');
    rect(ctx, X + 26 * s,  Y + 4 * s,  6 * s, 4 * s, '#7799cc', '#223355');
    rect(ctx, X + 28 * s,  Y + 0 * s,  4 * s, 4 * s, '#7799cc', '#223355');
    px(ctx, X + 30 * s, Y + 1 * s, 1 * s, 14 * s, '#aabbdd');
    px(ctx, X + 31 * s, Y + 2 * s, 1 * s, 1 * s, '#cce0ff');
    rivet(ctx, X + 28 * s, Y + 4 * s, s);
    rivet(ctx, X + 28 * s, Y + 8 * s, s);
    rivet(ctx, X + 28 * s, Y + 12 * s, s);
    px(ctx, X + 26 * s, Y + 11 * s, 1 * s, 2 * s, '#fff');
    px(ctx, X + 27 * s, Y + 11 * s, 1 * s, 1 * s, '#fff');
    // center connector with bolted bracket
    cyl(ctx, X + 12 * s,  Y + 8 * s,  8 * s, 8 * s, '#aaaabb', '#ccccdd', '#444466', '#1a1a22');
    bolt(ctx, X + 13 * s, Y + 10 * s, s);
    bolt(ctx, X + 17 * s, Y + 10 * s, s);
    bolt(ctx, X + 13 * s, Y + 13 * s, s);
    bolt(ctx, X + 17 * s, Y + 13 * s, s);
    // bracket panel highlight
    px(ctx, X + 12 * s, Y + 8 * s, 8 * s, 1 * s, '#ddddee');
  }

  // ---- catalog --------------------------------------------------------------
  const ALL = [
    {
      id: 'hairdryer', name: 'Hairdryer', category: 'engine', tier: 0,
      mass: 6, height: 32,
      thrust: 16, burnRate: 0.6, jank: 5, breakChance: 0.0003,
      flameColor: '#ffaa66',
      sprite: drawHairdryer,
      blurb: 'Maximum heat. Minimum dignity.',
    },
    {
      id: 'duct_tape', name: 'Duct Tape Booster', category: 'engine', tier: 0,
      mass: 8, height: 32,
      thrust: 22, burnRate: 1.4, jank: 20, breakChance: 0.004,
      flameColor: '#ffcc33',
      sprite: drawDuctTape,
      blurb: 'Held together by hope.',
    },
    {
      id: 'lawnmower', name: 'Lawnmower Engine', category: 'engine', tier: 1,
      mass: 18, height: 32,
      thrust: 42, burnRate: 1.8, jank: 30, breakChance: 0.003,
      flameColor: '#ff8833',
      sprite: drawLawnmower,
      blurb: 'Smells like victory and gasoline.',
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
      id: 'pressure_cooker', name: 'Pressure Cooker', category: 'engine', tier: 1,
      mass: 14, height: 32,
      thrust: 26, burnRate: 0.7, jank: 5, breakChance: 0.0006,
      flameColor: '#ffaa44',
      sprite: drawPressureCooker,
      blurb: 'Reliable. Frugal. Possibly explosive.',
    },
    {
      id: 'magnetron', name: 'Microwave Magnetron', category: 'engine', tier: 2,
      mass: 16, height: 32,
      thrust: 50, burnRate: 1.4, jank: 35, breakChance: 0.005,
      thrustVariance: 0.3,
      flameColor: '#ff8855',
      sprite: drawMagnetron,
      blurb: 'Cooks fuel from the inside out.',
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
      id: 'salvaged_motor', name: 'Salvaged Rocket Motor', category: 'engine', tier: 4,
      mass: 50, height: 36,
      thrust: 220, burnRate: 2.0, jank: 15, breakChance: 0.0008,
      flameColor: '#ffcc88',
      sprite: drawSalvagedMotor,
      blurb: 'Probably borrowed from a launch pad. Probably.',
    },
    {
      id: 'hairspray_cluster', name: 'Hairspray Cluster', category: 'fuel', tier: 0,
      mass: 3, height: 32,
      capacity: 35,
      sprite: drawHairsprayCluster,
      blurb: 'Six cans, one bad idea.',
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
      id: 'beer_keg', name: 'Beer Keg Tank', category: 'fuel', tier: 1,
      mass: 14, height: 32,
      capacity: 180,
      sprite: drawBeerKeg,
      blurb: 'Drained for science.',
    },
    {
      id: 'propane_tank', name: 'Propane Tank', category: 'fuel', tier: 2,
      mass: 24, height: 36,
      capacity: 280,
      sprite: drawPropaneTank,
      blurb: 'Strapped in by a single shoelace.',
    },
    {
      id: 'industrial_drum', name: 'Industrial Drum', category: 'fuel', tier: 3,
      mass: 40, height: 38,
      capacity: 500,
      sprite: drawIndustrialDrum,
      blurb: 'Definitely not full of motor oil.',
    },
    {
      id: 'wheelbarrow', name: 'Wheelbarrow', category: 'body', tier: 0,
      mass: 8, height: 28,
      stability: 12, hullBonus: 5,
      sprite: drawWheelbarrow,
      blurb: 'Steers like a wheelbarrow.',
    },
    {
      id: 'lawn_chair', name: 'Lawn Chair Cockpit', category: 'body', tier: 0,
      mass: 6, height: 28,
      stability: 8, hullBonus: 0,
      sprite: drawLawnChair,
      blurb: 'Cup holder included.',
    },
    {
      id: 'trash_can', name: 'Trash Can Hull', category: 'body', tier: 0,
      mass: 5, height: 28,
      stability: 6, hullBonus: 15,
      sprite: drawTrashCan,
      blurb: 'Bin there. Done that.',
    },
    {
      id: 'filing_cabinet', name: 'Filing Cabinet', category: 'body', tier: 1,
      mass: 30, height: 32,
      stability: 35, hullBonus: 100,
      sprite: drawFilingCabinet,
      blurb: 'Bureaucracy-grade armor.',
    },
    {
      id: 'shopping_cart', name: 'Shopping Cart Chassis', category: 'body', tier: 2,
      mass: 22, height: 30,
      stability: 25, hullBonus: 60,
      sprite: drawShoppingCart,
      blurb: 'Reinforced. Probably stolen.',
    },
    {
      id: 'fridge', name: 'Refrigerator', category: 'body', tier: 4,
      mass: 50, height: 38,
      stability: 50, hullBonus: 200,
      sprite: drawFridge,
      blurb: 'It still keeps the leftovers cold.',
    },
    {
      id: 'pizza_box_fin', name: 'Pizza Box Fin', category: 'fin', tier: 0,
      mass: 1, height: 14,
      stability: 12,
      sprite: drawPizzaBoxFin,
      blurb: 'Smells like garlic. Steers like garlic.',
    },
    {
      id: 'cardboard_fin', name: 'Cardboard Fin', category: 'fin', tier: 0,
      mass: 2, height: 14,
      stability: 18,
      sprite: drawCardboardFin,
      blurb: 'Aerodynamic in spirit.',
    },
    {
      id: 'stop_sign_fin', name: 'Stop Sign Fin', category: 'fin', tier: 1,
      mass: 6, height: 16,
      stability: 32,
      sprite: drawStopSignFin,
      blurb: 'Federal offense. Excellent stability.',
    },
    {
      id: 'plywood_fin', name: 'Plywood Fin', category: 'fin', tier: 1,
      mass: 4, height: 16,
      stability: 28,
      sprite: drawPlywoodFin,
      blurb: 'Cut on the kitchen counter.',
    },
    {
      id: 'steel_fin', name: 'Steel Fin', category: 'fin', tier: 2,
      mass: 8, height: 16,
      stability: 45,
      sprite: drawSteelFin,
      blurb: 'Heavy but firm.',
    },
    {
      id: 'aerospace_fin', name: 'Aerospace Fin', category: 'fin', tier: 4,
      mass: 12, height: 16,
      stability: 70,
      sprite: drawAerospaceFin,
      blurb: 'Real hardware. Title questionable.',
    },
  ];

  const byIdMap = {};
  ALL.forEach(p => byIdMap[p.id] = p);

  // Group a bottom→top parts[] array into stages. A new stage begins at an
  // engine that sits directly on top of a non-engine part: this keeps clustered
  // engines (engine-on-engine) together in one stage, while an engine mounted on
  // a fuel tank starts the next stage up. `skip` is an optional index→true map
  // of already-jettisoned parts (flight) so the bottom stage is computed from
  // whatever is still attached. Fins live on rocket.finId, not parts[], so they
  // never appear here. Each stage: { idxs, base, engineCount, fuelCount, bodyCount }.
  function computeStages(parts, skip) {
    const stages = [];
    let cur = null;
    let prevCat = null;
    for (let i = 0; i < parts.length; i++) {
      if (skip && skip[i]) continue;
      const p = byIdMap[parts[i]];
      if (!p) continue;
      const isEngine = p.category === 'engine';
      const boundary = isEngine && prevCat !== null && prevCat !== 'engine';
      if (!cur || boundary) {
        cur = { idxs: [], base: i, engineCount: 0, fuelCount: 0, bodyCount: 0 };
        stages.push(cur);
      }
      cur.idxs.push(i);
      if (isEngine) cur.engineCount++;
      else if (p.category === 'fuel') cur.fuelCount++;
      else if (p.category === 'body') cur.bodyCount++;
      prevCat = p.category;
    }
    return stages;
  }

  global.Parts = {
    all: ALL,
    byId(id) { return byIdMap[id] || null; },
    byCategory(cat) { return ALL.filter(p => p.category === cat); },
    computeStages,
    CATEGORY_ORDER: ['engine', 'fuel', 'body', 'fin'],
  };
})(window);
