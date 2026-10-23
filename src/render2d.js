// ===== 2D board renderer: draws the board, the squads and the battles on a <canvas> =====
// It sees the game only through view(), which it calls at the start of every draw and which returns what this
// screen shows right now:
//   { m, me, phase, units, mode, bt, battlePre, fx, selected, moving, drag, hoverTile, rangeOf,
//     editable, placingUnit, placingElf, placingTower, battleCam, dev }
// dev (Factions devtest only): { bPlacing, castMode, guideMode, guideId, guide }: the building being placed, the spell being
// cast, and the arrow being drawn (guide: its points so far, for squad guideId).
// fx: short-lived battle effects as plain data (shots, flames, bolts, heals, deaths), in board metres.
// rangeOf: { side, id } of the squad whose range shows as a dotted ring while deploying, or null.
// battleCam: { zoom, x, y } while the battle cam zooms in on the final seconds of a fight (board metres), else null.
// Calls: size() after the canvas changes size, draw(), tileAt(clientX, clientY) -> { col, row } or null,
// thumb(match) -> a data URL of a small picture of that match's board (null: a plain board with a question mark),
// floor(plain): only the board itself (map, zones, tiles), no squads or towers: the 3D renderer lays it on the ground;
// plain leaves out the zones, grid and tile markers (for the 3D ground-level view).
// A 3D renderer can take its place by offering the same calls.
const Render2D = (cv, view) => {
  let ctx = cv.getContext('2d'); // swapped for a moment while drawing map thumbnails (thumb)
  let m = null, me = 0, phase = 'start', units = [], mode = 'ai', bt = null, battlePre = null, fx = [], battleCam = null;
  let selected = null, moving = null, drag = null, hoverTile = null, rangeOf = null, editable = false, placingUnit = null, placingElf = false, placingTower = false, dev = null;
  const pull = () => { ({ m, me, phase, units, mode, bt, battlePre, fx, selected, moving, drag, hoverTile, rangeOf, editable, placingUnit, placingElf, placingTower, battleCam, dev } = view()); };
  const foe = () => 1 - me;
  const css = Art.css, tag = Shapes.tag;
  const { ELF_COL, SHROOM_COL, CHARM_COL } = Art;
  let W = 0, H = 0, S = 0;
  function size() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = W * Game.ROWS / Game.COLS;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = W / (Game.COLS * Game.TILE);
  }
  // The board is turned around for side 1, so both players see their own zone at the bottom (read from Game each
  // time: the Test Grid map has a bigger board)
  const flip = () => me === 1 ? -1 : 1;
  const PX = (x) => (Game.COLS * Game.TILE / 2 + x * flip()) * S;
  const PY = (y) => (Game.ROWS * Game.TILE / 2 - y * flip()) * S;
  const scol = (c) => me === 1 ? Game.COLS - 1 - c : c;   // model column -> screen column (and back)
  const srow = (r) => me === 1 ? Game.ROWS - 1 - r : r;
  const tilePx = () => Game.TILE * S;
  // size from health, but a leveled unit (2x, 3x health) only counts part of its extra health, and swarms
  // (5+ bodies) even less, so level 2 and 3 squads don't crowd the board
  const LEVEL_SIZE = [1, 0.8, 0.65], SWARM_SIZE = [1, 0.72, 0.56];
  const radius = (u) => Math.max(0.6, Math.min(2.4, 0.55 + Math.sqrt(u.hp * ((u.bodies >= 5 ? SWARM_SIZE : LEVEL_SIZE)[u.level | 0] || 1)) / 30)) * S;
  const teamCol = (side) => Art.teamCol(side, me);
  const upOf = (side) => side === me ? 1 : -1;

  // ---------- map backgrounds ----------
  // Each map's floor is painted once per board size onto a canvas of its own, then copied onto the board every
  // frame. paint(c, rr, t): the canvas context, a seeded random number generator (same picture every time), tile size in px.
  let mapBg = null;
  function mapBackground(id) {
    const key = id + W + 'x' + H;
    if (mapBg && mapBg.key === key) return mapBg.cv;
    const [seed, paint] = BACKGROUNDS[id];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const oc = document.createElement('canvas'); oc.width = Math.round(W * dpr); oc.height = Math.round(H * dpr);
    const c = oc.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    let sd = seed; const rr = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648; };
    paint(c, rr, tilePx());
    c.globalAlpha = 1;
    mapBg = { key, cv: oc };
    return oc;
  }
  // Forest Clearing: an open, faded green glade in the middle, with the edge of a dense forest
  // closing in on both flanks. Kept dark and muted so the squads stand out.
  function paintForest(c, rr, t) {
    // the clearing: a soft lighter patch in the middle of a dark green floor
    c.fillStyle = '#132219'; c.fillRect(0, 0, W, H);
    const gl = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.62);
    gl.addColorStop(0, '#1F3923'); gl.addColorStop(0.55, '#1A301F'); gl.addColorStop(1, '#13241A');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    // patches of slightly different greens and faint grass tufts
    const tints = ['#223D27', '#1B321F', '#26392A', '#182C1C'];
    for (let k = 0; k < 26; k++) {
      c.globalAlpha = 0.35; c.fillStyle = tints[k % tints.length];
      c.beginPath(); c.ellipse(t + rr() * (W - 2 * t), rr() * H, t * (0.6 + rr() * 1.4), t * (0.4 + rr() * 0.9), rr() * 3, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#3E5E40'; c.lineWidth = 1;
    for (let k = 0; k < 260; k++) {
      const x = rr() * W, y = rr() * H, h = 2 + rr() * 3;
      c.globalAlpha = 0.12 + rr() * 0.1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 1, y - h); c.moveTo(x, y); c.lineTo(x + 1.2, y - h * 0.8); c.stroke();
    }
    // the forest edge: shade darkening toward both sides of the board
    for (const left of [true, false]) {
      const x0 = left ? 0 : W, x1 = left ? t * 1.6 : W - t * 1.6;
      const sh = c.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(6,14,9,0.85)'); sh.addColorStop(0.45, 'rgba(8,18,11,0.45)'); sh.addColorStop(1, 'rgba(8,18,11,0)');
      c.globalAlpha = 1; c.fillStyle = sh; c.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
    }
    // trees: crowded canopies at the very edge, thinning out toward the clearing
    const trees = [];
    for (const left of [true, false]) {
      for (let k = 0; k < Math.round(H / t * 5); k++) {
        const depth = rr() * rr();                       // most trees close to the edge
        const r = t * (0.28 + rr() * 0.3) * (1 - depth * 0.35);
        const dx = -t * 0.25 + depth * t * 1.15;          // from just past the edge to a little into column 2
        trees.push({ x: left ? dx : W - dx, y: rr() * (H + t) - t / 2, r, depth });
      }
    }
    trees.sort((a, b) => a.y - b.y);
    const leaf = ['#0B1C10', '#0F2414', '#132B18', '#17311C'];
    for (const tr of trees) { // shadow cast down and away from the clearing
      c.globalAlpha = 0.35; c.fillStyle = '#050B07';
      c.beginPath(); c.ellipse(tr.x + (tr.x < W / 2 ? -1 : 1) * tr.r * 0.15, tr.y + tr.r * 0.35, tr.r * 1.05, tr.r * 0.8, 0, 0, Math.PI * 2); c.fill();
    }
    for (const tr of trees) {
      const a = 0.92 - tr.depth * 0.45;                  // trees further into the clearing are fainter
      c.globalAlpha = a; c.fillStyle = leaf[Math.floor(rr() * leaf.length)];
      c.beginPath();
      for (let k = 0; k < 7; k++) { // a lumpy canopy: a ring of overlapping blobs
        const ang = k / 7 * Math.PI * 2, br = tr.r * (0.55 + rr() * 0.15);
        c.moveTo(tr.x + Math.cos(ang) * tr.r * 0.5 + br, tr.y + Math.sin(ang) * tr.r * 0.5);
        c.arc(tr.x + Math.cos(ang) * tr.r * 0.5, tr.y + Math.sin(ang) * tr.r * 0.5, br, 0, Math.PI * 2);
      }
      c.fill();
      c.globalAlpha = a * 0.3; c.fillStyle = '#2A4A2C'; // light from the top left
      c.beginPath(); c.arc(tr.x - tr.r * 0.25, tr.y - tr.r * 0.3, tr.r * 0.45, 0, Math.PI * 2); c.fill();
    }
  }

  // Mushroom Cavern: a dim purple cave floor, darker rock shading the flanks, and faded glowing mushrooms
  // (big and small) scattered around.
  function paintCavern(c, rr, t) {
    c.fillStyle = '#16111D'; c.fillRect(0, 0, W, H);
    const gl = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
    gl.addColorStop(0, '#221A2C'); gl.addColorStop(0.6, '#1B1524'); gl.addColorStop(1, '#130F19');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    // uneven rock floor: soft darker and lighter patches
    for (let k = 0; k < 30; k++) {
      c.globalAlpha = 0.3; c.fillStyle = k % 2 ? '#2A2033' : '#120E17';
      c.beginPath(); c.ellipse(rr() * W, rr() * H, t * (0.5 + rr() * 1.3), t * (0.3 + rr() * 0.8), rr() * 3, 0, Math.PI * 2); c.fill();
    }
    // the flanks: cave walls closing in, darker toward the edge, with rough boulders
    for (const left of [true, false]) {
      const x0 = left ? 0 : W, x1 = left ? t * 1.5 : W - t * 1.5;
      const sh = c.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(5,3,8,0.9)'); sh.addColorStop(0.5, 'rgba(8,5,12,0.5)'); sh.addColorStop(1, 'rgba(8,5,12,0)');
      c.globalAlpha = 1; c.fillStyle = sh; c.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
      for (let k = 0; k < Math.round(H / t * 3); k++) {
        const depth = rr() * rr(), r = t * (0.25 + rr() * 0.3) * (1 - depth * 0.4), dx = -t * 0.2 + depth * t;
        const x = left ? dx : W - dx, y = rr() * H;
        c.globalAlpha = 0.8 - depth * 0.5; c.fillStyle = ['#0B0810', '#100C16', '#151019'][Math.floor(rr() * 3)];
        c.beginPath(); c.ellipse(x, y, r * 1.2, r, rr() * 3, 0, Math.PI * 2); c.fill();
        c.globalAlpha = (0.8 - depth * 0.5) * 0.35; c.fillStyle = '#2A2135'; // a faint lit edge
        c.beginPath(); c.ellipse(x - r * 0.25, y - r * 0.3, r * 0.5, r * 0.3, 0, 0, Math.PI * 2); c.fill();
      }
    }
    // faded glowing mushrooms, big and small
    const shroom = (x, y, sz, a) => {
      const glow = c.createRadialGradient(x, y - sz * 0.4, 0, x, y - sz * 0.4, sz * 2.2);
      glow.addColorStop(0, 'rgba(176,110,240,0.35)'); glow.addColorStop(1, 'rgba(176,110,240,0)');
      c.globalAlpha = a; c.fillStyle = glow; c.beginPath(); c.arc(x, y - sz * 0.4, sz * 2.2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#6B5A78'; c.fillRect(x - sz * 0.13, y - sz * 0.5, sz * 0.26, sz * 0.75); // stem
      c.fillStyle = '#8A5DB8'; c.beginPath(); c.ellipse(x, y - sz * 0.5, sz * 0.6, sz * 0.38, 0, Math.PI, 0); c.fill(); // cap
      c.fillStyle = '#D2B4F2'; for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(x + (k - 1) * sz * 0.25, y - sz * 0.68 + (k === 1 ? -sz * 0.06 : 0), sz * 0.06, 0, Math.PI * 2); c.fill(); }
    };
    const list = [];
    for (let k = 0; k < 34; k++) { // clusters: one bigger mushroom with a couple of small ones next to it
      const x = rr() * W, y = rr() * H, edge = Math.min(x, W - x) < t * 1.3;
      list.push({ x, y, sz: t * (edge ? 0.35 : 0.22 + rr() * 0.28), a: edge ? 0.26 : 0.16 });
      const n = Math.floor(rr() * 3);
      for (let j = 0; j < n; j++) list.push({ x: x + (rr() - 0.5) * t * 0.7, y: y + (rr() - 0.2) * t * 0.4, sz: t * (0.1 + rr() * 0.08), a: 0.18 });
    }
    list.sort((a, b) => a.y - b.y).forEach(q => shroom(q.x, q.y, q.sz, q.a));
  }
  // a mushroom tile: tinted tile with a small glowing mushroom in the tile's colour
  // Frozen Peak: a dark icy floor with snow drifts and cracks in the ice, and snow-capped rock on both flanks.
  function paintIce(c, rr, t) {
    c.fillStyle = '#131B22'; c.fillRect(0, 0, W, H);
    const gl = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
    gl.addColorStop(0, '#1D2833'); gl.addColorStop(0.6, '#18212A'); gl.addColorStop(1, '#121920');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    // snow drifts: soft pale patches
    for (let k = 0; k < 30; k++) {
      c.globalAlpha = 0.12 + rr() * 0.08; c.fillStyle = k % 3 ? '#3A4B5A' : '#4B5E6E';
      c.beginPath(); c.ellipse(rr() * W, rr() * H, t * (0.6 + rr() * 1.5), t * (0.25 + rr() * 0.5), (rr() - 0.5) * 0.6, 0, Math.PI * 2); c.fill();
    }
    // cracks in the ice
    c.strokeStyle = '#9FC3D9'; c.lineWidth = 0.8;
    for (let k = 0; k < 14; k++) {
      let x = t + rr() * (W - 2 * t), y = rr() * H;
      c.globalAlpha = 0.1 + rr() * 0.08; c.beginPath(); c.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (rr() - 0.5) * t * 0.9; y += (rr() - 0.5) * t * 0.9; c.lineTo(x, y); }
      c.stroke();
    }
    // the flanks: mountain rock rising on both sides, with snow on top
    for (const left of [true, false]) {
      const x0 = left ? 0 : W, x1 = left ? t * 1.5 : W - t * 1.5;
      const sh = c.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(6,9,12,0.9)'); sh.addColorStop(0.5, 'rgba(8,12,16,0.5)'); sh.addColorStop(1, 'rgba(8,12,16,0)');
      c.globalAlpha = 1; c.fillStyle = sh; c.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
      const rocks = [];
      for (let k = 0; k < Math.round(H / t * 2.6); k++) {
        const depth = rr() * rr(), r = t * (0.3 + rr() * 0.35) * (1 - depth * 0.4), dx = -t * 0.2 + depth * t * 1.05;
        rocks.push({ x: left ? dx : W - dx, y: rr() * (H + t) - t / 2, r, depth });
      }
      rocks.sort((a, b) => a.y - b.y);
      for (const q of rocks) {
        const a = 0.9 - q.depth * 0.5;
        c.globalAlpha = a; c.fillStyle = ['#0D1318', '#111920', '#151E26'][Math.floor(rr() * 3)];
        c.beginPath(); // a jagged rock
        for (let j = 0; j < 6; j++) { const ang = j / 6 * Math.PI * 2 + rr() * 0.4, rad = q.r * (0.75 + rr() * 0.35); const px = q.x + Math.cos(ang) * rad, py = q.y + Math.sin(ang) * rad * 0.8; j ? c.lineTo(px, py) : c.moveTo(px, py); }
        c.closePath(); c.fill();
        c.globalAlpha = a * 0.45; c.fillStyle = '#C8D7E2'; // snow cap
        c.beginPath(); c.ellipse(q.x - q.r * 0.1, q.y - q.r * 0.45, q.r * 0.55, q.r * 0.2, 0, 0, Math.PI * 2); c.fill();
      }
    }
    // a few snowflakes
    c.fillStyle = '#DCE8F0';
    for (let k = 0; k < 120; k++) { c.globalAlpha = 0.08 + rr() * 0.14; c.beginPath(); c.arc(rr() * W, rr() * H, 0.6 + rr() * 0.9, 0, Math.PI * 2); c.fill(); }
  }
  const BACKGROUNDS = { forest: [1234567, paintForest], cavern: [7654321, paintCavern], ice: [4242421, paintIce] };
  const ICE_COL = '#BFE3F5';
  // the storm band (a faint frost) and this round's hail tiles (animated during the fight)
  function drawStorm(v) {
    const t = tilePx(), rows = Game.stormRows(v);
    const y0 = Math.min(...rows.map(srow)) * t;
    ctx.fillStyle = ICE_COL; ctx.globalAlpha = 0.05; ctx.fillRect(0, y0, W, rows.length * t);
    ctx.strokeStyle = ICE_COL; ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
    ctx.strokeRect(1, y0 + 1, W - 2, rows.length * t - 2); ctx.setLineDash([]);
    const time = phase === 'battle' && bt ? bt.time() : 0;
    for (const h of Game.hailTiles(v)) {
      const x = scol(h.col) * t, y = srow(h.row) * t;
      ctx.fillStyle = ICE_COL; ctx.globalAlpha = 0.16; ctx.fillRect(x, y, t, t);
      ctx.strokeStyle = ICE_COL; ctx.globalAlpha = 0.5; ctx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3);
      // hailstones: falling streaks during the fight, resting pellets while deploying
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, t, t); ctx.clip();
      for (let k = 0; k < 6; k++) {
        const fx = ((k * 0.37 + h.col * 0.13) % 1), sp = 0.9 + (k % 3) * 0.25;
        const fy = time ? (time * sp + k * 0.21 + h.row * 0.07) % 1 : ((k * 0.53 + h.row * 0.29) % 1);
        const px = x + fx * t, py = y + fy * t;
        ctx.globalAlpha = 0.7;
        if (time) { ctx.strokeStyle = '#EAF6FF'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(px + t * 0.06, py - t * 0.16); ctx.lineTo(px, py); ctx.stroke(); }
        ctx.fillStyle = '#EAF6FF'; ctx.beginPath(); ctx.arc(px, py, Math.max(1, t * 0.035), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  // the altar of ice: a cluster of pale ice shards on a frosted plinth, in the middle of the board
  function drawAltar() {
    const x = W / 2, y = H / 2, s = tilePx();
    const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 1.1);
    glow.addColorStop(0, 'rgba(191,227,245,0.35)'); glow.addColorStop(1, 'rgba(191,227,245,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, s * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5E7C8E'; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.28, s * 0.42, s * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    const shard = (dx, h, w, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + dx - w, y + s * 0.26); ctx.lineTo(x + dx, y + s * 0.26 - h); ctx.lineTo(x + dx + w, y + s * 0.26); ctx.closePath(); ctx.fill(); };
    ctx.globalAlpha = 0.95;
    shard(-s * 0.2, s * 0.45, s * 0.1, '#9CCBE3'); shard(s * 0.2, s * 0.5, s * 0.1, '#9CCBE3');
    shard(0, s * 0.75, s * 0.14, '#D8F0FB');
    ctx.strokeStyle = '#FFFFFF'; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.26 - s * 0.75); ctx.lineTo(x - s * 0.04, y + s * 0.1); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // ice walls around a tower: one arc per side, fading as it takes hits. walls = [north, east, south, west] (world)
  function drawWalls(wx, wy, walls) {
    const t = tilePx();
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    walls.forEach((n, k) => {
      if (!(n > 0)) return;
      const cx = PX(wx + dirs[k][0] * Game.TILE * 0.5), cy = PY(wy + dirs[k][1] * Game.TILE * 0.5);
      const horiz = Math.abs(PX(wx + dirs[k][0]) - PX(wx)) < 1e-6; // a wall facing up/down on screen lies flat
      ctx.globalAlpha = 0.35 + 0.55 * n / Game.ICE.wallHits; ctx.fillStyle = '#CFEAF7'; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1;
      const L = t * 0.8, D = t * 0.12;
      if (horiz) { ctx.fillRect(cx - L / 2, cy - D / 2, L, D); ctx.strokeRect(cx - L / 2, cy - D / 2, L, D); }
      else { ctx.fillRect(cx - D / 2, cy - L / 2, D, L); ctx.strokeRect(cx - D / 2, cy - L / 2, D, L); }
    });
    ctx.globalAlpha = 1;
  }
  // what this screen may show of the opponent (see Game.charShown)
  const deploying = () => phase === 'deploy';
  const altarShown = (v, b) => Game.altarShown(v, me, deploying(), b);
  const shroomShown = (v, col, row) => Game.shroomShown(v, me, deploying(), col, row);
  const myRemovalNow = (col, row) => Game.removingShroom(m, me, deploying(), col, row);
  const towerVisible = (side) => !!(m && m.towers && m.towers[side]);
  const charVisible = (side) => Game.charShown(m, me, deploying(), side);
  const towerTypeVisible = (side) => Game.towerTypeShown(m, me, deploying(), side);
  const elfOwnShown = (v, sd) => Game.elfOwnShown(v, me, deploying(), sd);
  // who the flag shows ahead in the bribe-off: while deploying, this round's bribes (either player's) don't count
  // yet, as the opponent's stay hidden until the fight; from the fight on, every bribe counts
  const bribeLeadShown = (v) => Game.bribeLeader(v, deploying());
  const drawKeep = (x, y, s, side, hpr, kind, g, crest) => Art.keep(g || ctx, x, y, s, teamCol(side), hpr, kind, crest);
  function drawShroomTile(tl) {
    const t = tilePx(), x = scol(tl.col) * t, y = srow(tl.row) * t, col = SHROOM_COL[tl.type];
    ctx.fillStyle = col; ctx.globalAlpha = 0.13; ctx.fillRect(x, y, t, t);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3);
    const cx = x + t / 2, cy = y + t * 0.62, sz = t * 0.34;
    const glow = ctx.createRadialGradient(cx, cy - sz * 0.4, 0, cx, cy - sz * 0.4, sz * 1.4);
    glow.addColorStop(0, col); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.22; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy - sz * 0.4, sz * 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.6; ctx.fillStyle = '#CFC3D6'; ctx.fillRect(cx - sz * 0.12, cy - sz * 0.5, sz * 0.24, sz * 0.7);
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx, cy - sz * 0.5, sz * 0.62, sz * 0.4, 0, Math.PI, 0); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // plain: only the land itself (the map, mushrooms, the storm), without zones, grid or tile markers
  function drawBoard(plain = false) {
    const t = tilePx();
    const Z = Game.ZONE, mine = (Game.ROWS - Z) * t;
    const v = phase === 'battle' && battlePre ? battlePre : m; // during a fight: the board as it was when the fight began, not the next round's
    const mp = Game.mapOf(v);
    if (mp && BACKGROUNDS[mp.id]) ctx.drawImage(mapBackground(mp.id), 0, 0, W, H);
    else { ctx.fillStyle = css('--board'); ctx.fillRect(0, 0, W, H); }
    if (!plain) {
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = css('--foe'); ctx.fillRect(0, 0, W, t * Z);
      ctx.fillStyle = css('--you'); ctx.fillRect(0, mine, W, t * Z);
      if (v) for (const side of [0, 1]) { // flank tiles inside the other zone: reserved from the start, usable from round 3
        ctx.fillStyle = side === me ? css('--you') : css('--foe'); ctx.globalAlpha = Game.flankOpen(v) ? 0.22 : 0.12;
        for (const col of Game.FLANK.cols) for (const row of Game.flankRows(side)) ctx.fillRect(scol(col) * t, srow(row) * t, t, t);
      }
    }
    ctx.globalAlpha = 1;
    if (mp && mp.ice) { drawStorm(v); if (phase === 'deploy' && Game.altarRound(v)) drawAltar(); } // the altar only stands while deploying
    if (mp && mp.shrooms) for (const tl of v.map.tiles || []) {
      if (shroomShown(v, tl.col, tl.row)) drawShroomTile(tl);
      else if (!plain && myRemovalNow(tl.col, tl.row)) { // removed by you this round: a faint dashed outline until the fight
        const t = tilePx(), x = scol(tl.col) * t, y = srow(tl.row) * t;
        ctx.strokeStyle = SHROOM_COL[tl.type]; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.strokeRect(x + 2.5, y + 2.5, t - 5, t - 5); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    if (v && v.dev) devFloor(v, plain);
    if (plain) return;
    if (v && v.buff) for (const side of [0, 1]) { // Zoe's buff tiles: a gold tile with a star
      if (!charVisible(side)) continue;
      for (const b of v.buff[side] || []) {
        const x = scol(b.col) * t, y = srow(b.row) * t;
        ctx.fillStyle = css('--gold'); ctx.globalAlpha = 0.16; ctx.fillRect(x, y, t, t);
        ctx.globalAlpha = 0.75; ctx.font = `${Math.round(t * 0.42)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('★', x + t / 2, y + t / 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = 'rgba(200, 230, 225, 0.06)'; ctx.lineWidth = 1;
    for (let i = 1; i < Game.COLS; i++) { ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, H); ctx.stroke(); }
    for (let i = 1; i < Game.ROWS; i++) { ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(W, i * t); ctx.stroke(); }
    ctx.setLineDash([5, 6]); ctx.lineWidth = 1.2;
    ctx.strokeStyle = css('--foe'); ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(0, t * Z); ctx.lineTo(W, t * Z); ctx.stroke();
    ctx.strokeStyle = css('--you');
    ctx.beginPath(); ctx.moveTo(0, mine); ctx.lineTo(W, mine); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // ---------- Factions devtest: spells, arrows, the tower's tile, where things may go (on the floor, so the 3D board
  // gets them too), and buildings ----------
  const ZONE_COL = { burn: '#E07A4F', mend: '#7FCB8A', mud: '#9C8456', haste: '#E6D27A' };
  function devFloor(v, plain) {
    const t = tilePx(), deploying = phase === 'deploy';
    for (const c of Game.activeCasts(v)) {
      if (!Game.devShown(v, me, deploying, c.side, c.round)) continue;
      const sp = Game.devSpell(c.id) || {}, team = teamCol(c.side);
      if (sp.kind === 'zone') for (const tl of Game.castTiles(c)) {
        const x = scol(tl.col) * t, y = srow(tl.row) * t;
        ctx.fillStyle = ZONE_COL[sp.effect] || '#C9B79C'; ctx.globalAlpha = 0.3; ctx.fillRect(x, y, t, t);
        ctx.globalAlpha = 0.7; ctx.strokeStyle = team; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3); ctx.setLineDash([]);
      }
      if (sp.kind === 'strike') { // where it will land: a dashed ring of its radius and a cross
        const w = Game.tileToWorld(c.col, c.row), x = PX(w.x), y = PY(w.y), r = (+sp.radius || 6) * S;
        ctx.strokeStyle = '#E8A15A'; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = team; ctx.beginPath(); ctx.moveTo(x - t * 0.25, y); ctx.lineTo(x + t * 0.25, y); ctx.moveTo(x, y - t * 0.25); ctx.lineTo(x, y + t * 0.25); ctx.stroke();
      }
      if (sp.kind === 'wall' && deploying) drawWallBlock(PX(Game.tileToWorld(c.col, c.row).x), PY(Game.tileToWorld(c.col, c.row).y), t, c.side, 1);
    }
    ctx.globalAlpha = 1;
    // the tower's tile before the tower stands (rounds 1 and 2)
    if (v.towers) for (const side of [0, 1]) if (v.towers[side] && !Game.towerUp(v, side)) {
      const x = scol(v.towers[side].col) * t, y = srow(v.towers[side].row) * t;
      ctx.strokeStyle = teamCol(side); ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.strokeRect(x + 4, y + 4, t - 8, t - 8); ctx.setLineDash([]);
      ctx.fillStyle = teamCol(side); ctx.font = `600 ${Math.max(8, Math.round(t * 0.24))}px "IBM Plex Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('R' + Game.TOWER_PICK_ROUND, x + t / 2, y + t / 2); ctx.globalAlpha = 1;
    }
    if (plain || !deploying) return;
    // your arrows, and the one being drawn
    for (const sq of v.armies[me]) if (sq.guide && !(dev && dev.guideId === sq.id)) drawArrow(sq, sq.guide, 0.75);
    if (dev && dev.guideId != null && dev.guide) { const sq = v.armies[me].find(q => q.id === dev.guideId); if (sq) drawArrow(sq, dev.guide, 1); }
    if (!dev || !editable) return;
    if (dev.bPlacing != null) { // where the building may go
      const b = Game.buildingsOf(v, me).find(x => x.key === dev.bPlacing), d = b && Game.devBuilding(b.id);
      ctx.strokeStyle = css('--gold'); ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5;
      if (b) for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) if (Game.buildingSpotOk(v, me, d, c, row, b.key)) ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6);
    }
    if (dev.castMode) { // where the spell may go
      const sp = Game.devSpell(dev.castMode);
      ctx.strokeStyle = '#E8A15A'; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) if (Game.castSpotOk(v, me, sp, c, row)) ctx.strokeRect(scol(c) * t + 4, srow(row) * t + 4, t - 8, t - 8);
    }
    ctx.globalAlpha = 1;
  }
  // a squad's arrow: from its tile through its points, with a head at the end
  function drawArrow(sq, pts, a) {
    const t = tilePx(), at = (p) => [(scol(p.col) + 0.5) * t, (srow(p.row) + 0.5) * t];
    const list = [sq, ...pts].map(at).filter((p, i, l) => !i || p[0] !== l[i - 1][0] || p[1] !== l[i - 1][1]);
    if (list.length < 2) return;
    ctx.strokeStyle = css('--you'); ctx.fillStyle = css('--you'); ctx.globalAlpha = a; ctx.lineWidth = Math.max(2, t * 0.08); ctx.lineJoin = 'round'; ctx.setLineDash([t * 0.18, t * 0.12]);
    ctx.beginPath(); ctx.moveTo(...list[0]); for (const p of list.slice(1)) ctx.lineTo(...p); ctx.stroke(); ctx.setLineDash([]);
    const [x2, y2] = list[list.length - 1], [x1, y1] = list[list.length - 2], ang = Math.atan2(y2 - y1, x2 - x1), h = t * 0.32;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(ang - 0.5), y2 - h * Math.sin(ang - 0.5)); ctx.lineTo(x2 - h * Math.cos(ang + 0.5), y2 - h * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // a lesser building: a small house in its faction's colour with a roof in its side's colour (hpr: health left in a fight)
  function drawBuilding(x, y, t, side, u, hpr, fresh) {
    const s = t * 0.62, c = teamCol(side);
    ctx.globalAlpha = 1;
    ctx.fillStyle = u.color || '#B7AE9C'; ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(x - s / 2, y - s * 0.2, s, s * 0.62); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - s * 0.62, y - s * 0.18); ctx.lineTo(x, y - s * 0.62); ctx.lineTo(x + s * 0.62, y - s * 0.18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css('--bg'); ctx.fillRect(x - s * 0.1, y + s * 0.12, s * 0.2, s * 0.3);
    if (hpr != null) { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, t * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpr); ctx.stroke(); }
    if (fresh) { ctx.strokeStyle = c; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeRect(x - t / 2 + 1.5, y - t / 2 + 1.5, t - 3, t - 3); ctx.setLineDash([]); }
    if (t >= 26 && u.name) { ctx.font = `500 ${Math.max(8, Math.round(t * 0.24))}px "IBM Plex Mono", monospace`; ctx.fillStyle = css('--ink'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.globalAlpha = 0.85; ctx.fillText(tag(u), x, y + t / 2 - 1); ctx.globalAlpha = 1; }
  }
  // a wall (spell): a row of stakes
  function drawWallBlock(x, y, t, side, hpr) {
    const s = t * 0.8;
    ctx.fillStyle = '#9C7E58'; ctx.strokeStyle = teamCol(side); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5 + 0.5 * hpr;
    for (let k = 0; k < 4; k++) { const sx = x - s / 2 + k * s / 4; ctx.beginPath(); ctx.moveTo(sx + 1, y + s * 0.3); ctx.lineTo(sx + 1, y - s * 0.2); ctx.lineTo(sx + s / 8, y - s * 0.38); ctx.lineTo(sx + s / 4 - 1, y - s * 0.2); ctx.lineTo(sx + s / 4 - 1, y + s * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // the buildings this screen may see while deploying (an opponent's new one only from the fight on)
  function drawBuildings() {
    const t = tilePx();
    for (const side of [me, foe()]) for (const b of Game.placedBuildings(m, side)) {
      if (!Game.devShown(m, me, phase === 'deploy', side, b.round)) continue;
      const at = drag && drag.bkey === b.key && drag.moved && side === me ? drag.over : b;
      drawBuilding((scol(at.col) + 0.5) * t, (srow(at.row) + 0.5) * t, t, side, Game.buildingUnit(m, side, b), null, side === me && b.round === m.round);
    }
  }

  function drawSquad(sq, side, fresh) {
    const u = units[sq.unit];
    const w = Game.tileToWorld(sq.col, sq.row);
    const bodies = Engine.buildSquad(u, side, w.x, w.y, sq.id, Game.TILE);
    const col = teamCol(side);
    const t = tilePx(), c = scol(sq.col), r0 = srow(sq.row);
    if (fresh) {
      ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(c * t + 1.5, r0 * t + 1.5, t - 3, t - 3); ctx.setLineDash([]);
    }
    const r = radius(u);
    for (const b of bodies) Shapes.body(ctx, u.shape, PX(b.x), PY(b.y), r, upOf(side), u.color, col, 0.95);
    ctx.globalAlpha = 1;
    if (side === me && phase === 'deploy' && Game.isReady(m, sq)) { // ready to level up: gold plus badge
      const br = Math.max(5, t * 0.17), bx = (c + 1) * t - br - 2, by = r0 * t + br + 2;
      ctx.fillStyle = css('--gold'); ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = css('--bg'); ctx.lineWidth = Math.max(1.5, br * 0.3);
      ctx.beginPath(); ctx.moveTo(bx - br * 0.5, by); ctx.lineTo(bx + br * 0.5, by); ctx.moveTo(bx, by - br * 0.5); ctx.lineTo(bx, by + br * 0.5); ctx.stroke();
    }
    if (Game.charmOf(sq) > 0) { // Matteo's charisma: a pink pip per stack up the left edge, a top hat for a Gentleman
      const pr = Math.max(1.5, t * 0.05);
      ctx.fillStyle = CHARM_COL;
      for (let k = 0; k < Game.charmOf(sq); k++) { ctx.beginPath(); ctx.arc(c * t + pr + 2, (r0 + 1) * t - pr - 3 - k * (pr * 2.6), pr, 0, Math.PI * 2); ctx.fill(); }
      if (Game.isGentleman(sq)) drawHat((c + 0.5) * t, r0 * t + t * 0.2, t * 0.22);
    }
    if (sq.level > 0) {
      ctx.fillStyle = css('--gold');
      const pr = Math.max(2, t * 0.07);
      for (let k = 0; k < sq.level; k++) {
        ctx.beginPath(); ctx.arc(c * t + pr + 3 + k * (pr * 2.6), r0 * t + pr + 3, pr, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (t >= 26) {
      ctx.font = `500 ${Math.max(8, Math.round(t * 0.26))}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = css('--ink'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.globalAlpha = 0.85; ctx.fillText(tag(u), (c + 0.5) * t, (r0 + 1) * t - 1); ctx.globalAlpha = 1;
    }
  }

  // the Gentleman's top hat (brim centred on x, y; s = its width)
  function drawHat(x, y, s) {
    ctx.fillStyle = '#16161C'; ctx.strokeStyle = '#EDEFF2'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x - s / 2, y - s * 0.12, s, s * 0.12); ctx.rect(x - s * 0.3, y - s * 0.75, s * 0.6, s * 0.65); ctx.fill(); ctx.stroke();
    ctx.fillStyle = CHARM_COL; ctx.fillRect(x - s * 0.3, y - s * 0.3, s * 0.6, s * 0.12);
  }
  // the sniper tower's airship: a see-through blimp in the team colour, nose toward where it flies (t: tile size in px)
  function drawAirship(b, t) {
    const x = PX(b.x), y = PY(b.y), c = teamCol(b.side), L = t * 0.42, H = t * 0.17;
    const ang = Math.atan2(-(b.hy == null ? (b.side === 0 ? 1 : -1) : b.hy) * flip(), (b.hx || 0) * flip());
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = 0.45;
    ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-L * 0.8, 0); ctx.lineTo(-L * 1.1, -H * 0.9); ctx.lineTo(-L * 1.1, H * 0.9); ctx.closePath(); ctx.fill(); // tail fins
    ctx.beginPath(); ctx.ellipse(0, 0, L, H, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.8; ctx.stroke();
    ctx.fillStyle = '#1B2326'; ctx.fillRect(-L * 0.25, H * 0.75, L * 0.5, H * 0.45); // gondola
    ctx.restore(); ctx.globalAlpha = 1;
  }
  // A small picture of a match's board for the map picker: the board at the start of a match, with both towers
  // (and the elf tower). Drawn with the board's own drawing code, by pointing it at a small canvas for a moment.
  function thumb(match) {
    const tw = 96, th = tw * Game.ROWS / Game.COLS, dpr = 2;
    const oc = document.createElement('canvas'); oc.width = tw * dpr; oc.height = th * dpr;
    const g = oc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const keep = { ctx, W, H, S, m, me, phase, mapBg };
    try {
      ctx = g; W = tw; H = th; S = W / (Game.COLS * Game.TILE); me = 0; phase = 'start'; mapBg = null;
      m = match;
      drawBoard();
      const t = tilePx();
      if (m) {
        for (const side of [0, 1]) { const p = m.towers[side]; drawKeep((scol(p.col) + 0.5) * t, (srow(p.row) + 0.5) * t, t * 1.6, side, null, 'keep', g); }
        drawElfTower(m, false);
      } else { // Random: a question mark on the plain board
        g.fillStyle = css('--gold'); g.font = `700 ${Math.round(tw * 0.5)}px "Chakra Petch", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('?', tw / 2, th / 2);
      }
      return oc.toDataURL();
    } finally { ({ ctx, W, H, S, m, me, phase, mapBg } = keep); }
  }
  function drawTowerTile(side) {
    const tw = m.towers[side], t = tilePx();
    drawKeep((scol(tw.col) + 0.5) * t, (srow(tw.row) + 0.5) * t, t, side, null, towerTypeVisible(side) ? Game.towerType(m, side).id : 'outpost', null, charVisible(side) ? Game.charOf(m, side) : null);
  }
  // the neutral elf tower: a slim pale spire with a leaf-green roof. range = show its reach as a faint ring.
  // Players' own elf towers are drawn too (an opponent's new one only from the fight on).
  function drawElfTower(v, range) {
    const e = Game.elfSpot(v); if (!e) return;
    const x = PX(e.x), y = PY(e.y);
    if (range) {
      ctx.strokeStyle = ELF_COL; ctx.globalAlpha = 0.22; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(x, y, Game.ELF_TOWER.range * S, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // the flag on the roof: the coat of arms of whoever is ahead in the bribe-off, edged in their colour; plain white while it's level
    const lead = bribeLeadShown(v);
    drawSpire(x, y, tilePx() * 1.25, lead < 0 ? '#F4F1E6' : teamCol(lead), Game.elfPowered(v), lead < 0 ? null : armsShown(v, lead));
    for (const sd of [me, foe()]) {
      const own = Game.elfOwnOf(v, sd);
      if (!own || !elfOwnShown(v, sd)) continue;
      const w = Game.tileToWorld(own.col, own.row);
      drawSpire(PX(w.x), PY(w.y), tilePx() * 1.05, teamCol(sd), Game.elfPowered(v), armsShown(v, sd));
    }
  }
  // a player's coat of arms where this screen may show it (null while their character is hidden)
  const armsShown = (v, side) => charVisible(side) ? Game.charOf(v, side) : null;
  // one elf spire at (x, y), size s, its flag in flagCol. strong (after round 5): a golden glow and a gilded roof.
  // arms: a character's coat of arms, flown on a flag edged in flagCol instead of the plain pennant
  function drawSpire(x, y, s, flagCol, strong, arms) {
    if (strong) {
      const gl = ctx.createRadialGradient(x, y - s * 0.1, 0, x, y - s * 0.1, s * 0.75);
      gl.addColorStop(0, 'rgba(255, 214, 90, 0.5)'); gl.addColorStop(1, 'rgba(255, 214, 90, 0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y - s * 0.1, s * 0.75, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.26, s * 0.22, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const w = s * 0.2, top = y - s * 0.12, base = y + s * 0.26;
    ctx.fillStyle = '#CFC6A8'; ctx.strokeStyle = strong ? '#8A6A12' : '#3F5A35'; ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath(); ctx.moveTo(x - w / 2 - s * 0.03, base); ctx.lineTo(x - w / 2, top); ctx.lineTo(x + w / 2, top); ctx.lineTo(x + w / 2 + s * 0.03, base); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = strong ? '#E8B931' : '#5E9A4E';
    ctx.beginPath(); ctx.moveTo(x - w * 0.85, top + s * 0.02); ctx.lineTo(x, top - s * 0.3); ctx.lineTo(x + w * 0.85, top + s * 0.02); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = strong ? '#FFE27A' : ELF_COL; ctx.fillRect(x - s * 0.025, top + s * 0.08, s * 0.05, s * 0.09); // a lit window
    const py = top - s * 0.3;
    ctx.strokeStyle = '#3F5A35'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py - s * 0.28); ctx.stroke();
    if (arms) { Art.armsFlag(ctx, arms, x, py - s * 0.28, Math.max(10, s * 0.3), flagCol); return; }
    ctx.fillStyle = flagCol;
    ctx.beginPath(); ctx.moveTo(x, py - s * 0.28); ctx.lineTo(x + s * 0.2, py - s * 0.23); ctx.lineTo(x, py - s * 0.18); ctx.closePath(); ctx.fill();
  }

  function drawDeploy() {
    drawBoard();
    const t = tilePx();
    if (placingElf && editable) { // where the elf tower may go: any free tile of your zone
      ctx.strokeStyle = ELF_COL; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5;
      for (const row of Game.zoneRows(me)) for (let c = 0; c < Game.COLS; c++) if (Game.elfOwnSpotOk(m, me, c, row)) ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6);
      ctx.globalAlpha = 1;
    }
    if (placingTower && editable) { // where the tower may go: the sides of your zone, not the middle columns
      ctx.strokeStyle = css('--gold'); ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
      for (const row of Game.zoneRows(me)) for (let c = 0; c < Game.COLS; c++) {
        if (Game.towerColOk(c) && !Game.reserved(me, c, row) && !Game.occupied(m, me, c, row)) ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6);
      }
      ctx.globalAlpha = 1;
    }
    if ((selected !== null || (drag && drag.moved) || moving != null) && phase === 'deploy') {
      ctx.strokeStyle = css('--you'); ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
      const pu = placingUnit;
      for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) {
        if (Game.canPlaceAt(m, me, c, row, pu) && !Game.occupied(m, me, c, row)) ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6);
      }
      // your carriers with room for this unit
      ctx.strokeStyle = css('--gold'); ctx.globalAlpha = 0.8; ctx.lineWidth = 1.5;
      if (pu != null) for (const sq of m.armies[me]) if (Game.boardable(m, me, sq.col, sq.row, pu) && !(drag && drag.id === sq.id)) ctx.strokeRect(scol(sq.col) * t + 2, srow(sq.row) * t + 2, t - 4, t - 4);
      ctx.globalAlpha = 1;
    }
    if (hoverTile && (selected !== null || moving != null) && Game.canPlaceAt(m, me, hoverTile.col, hoverTile.row, placingUnit) && (!Game.occupied(m, me, hoverTile.col, hoverTile.row) || (placingUnit != null && Game.boardable(m, me, hoverTile.col, hoverTile.row, placingUnit)))) {
      ctx.fillStyle = css('--you'); ctx.globalAlpha = 0.18;
      ctx.fillRect(scol(hoverTile.col) * t, srow(hoverTile.row) * t, t, t); ctx.globalAlpha = 1;
    }
    // the opponent's squads from this round stay hidden until the fight
    // a squad they moved this round still shows on its old tile
    for (const sq of m.armies[foe()]) if ((sq.round < m.round || phase !== 'deploy') && !Game.hiddenFromFoe(m, sq)) {
      const p = phase === 'deploy' ? Game.seenAt(m, sq) : sq;
      const look = Game.shownUnit(m, me, foe(), sq.unit); // a disguised unit shows as what it pretends to be
      drawSquad(phase === 'deploy' ? { ...sq, unit: look, col: p.col, row: p.row, level: Game.seenLevel(m, sq) } : { ...sq, unit: look }, foe(), false); // a level-up bought this round stays hidden
    }
    for (const sq of m.armies[me]) {
      if (phase === 'deploy' && sq.from && sq.movedRound === m.round) { // where your moved squad came from
        ctx.strokeStyle = css('--muted'); ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
        ctx.strokeRect(scol(sq.from.col) * t + 4, srow(sq.from.row) * t + 4, t - 8, t - 8); ctx.setLineDash([]);
      }
      if (Game.isRider(sq)) continue; // drawn as a badge on its carrier
      const at = drag && drag.moved && drag.id === sq.id ? { ...sq, col: drag.over.col, row: drag.over.row } : sq;
      drawSquad(at, me, (sq.round === m.round || sq.movedRound === m.round) && phase === 'deploy');
      const rider = Game.riderOf(m, me, sq);
      if (rider) { // what rides inside: a small disc with its shape, bottom left of the tile (only you see it)
        const ru = units[rider.unit], br = Math.max(6, t * 0.2), bx = scol(at.col) * t + br + 2, by = (srow(at.row) + 1) * t - br - 2;
        ctx.fillStyle = css('--bg'); ctx.strokeStyle = teamCol(me); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = ru.color; Shapes.draw(ctx, ru.shape, bx, by, br * 0.55, 1);
      }
      if (moving === sq.id && phase === 'deploy') {
        ctx.strokeStyle = css('--gold'); ctx.lineWidth = 2;
        ctx.strokeRect(scol(sq.col) * t + 1, srow(sq.row) * t + 1, t - 2, t - 2);
      }
    }
    for (const side of [me, foe()]) if (towerVisible(side) && Game.towerUp(m, side)) drawTowerTile(side);
    if (Game.isDev(m)) drawBuildings();
    // the squad tapped last: its range as a dotted ring round its tile (theirs as you can know it)
    const rs = rangeOf && phase === 'deploy' && m.armies[rangeOf.side].find(s => s.id === rangeOf.id);
    if (rs) {
      const p = rangeOf.side !== me ? Game.seenAt(m, rs) : drag && drag.moved && drag.id === rs.id ? drag.over : rs;
      const w = Game.tileToWorld(p.col, p.row);
      ctx.strokeStyle = teamCol(rangeOf.side); ctx.globalAlpha = 0.9; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(PX(w.x), PY(w.y), Game.squadRange(m, rangeOf.side, rs, rangeOf.side !== me) * S, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    drawElfTower(m, true);
    if (Game.isIce(m)) for (const side of [me, foe()]) {
      // Snowgres on their tiles in no man's land (an opponent's new one shows up at the fight)
      const buys = (m.altar || []).filter(b => b.side === side && b.type === 'snowgre');
      Game.snowgres(m, side).forEach((sg, k) => {
        if (!altarShown(m, buys[k])) return;
        const u = Game.snowgreUnit(m, sg.strength), w = Game.tileToWorld(sg.col, sg.row);
        Shapes.body(ctx, 'square', PX(w.x), PY(w.y), radius(u), upOf(side), u.color, teamCol(side), 0.95);
      });
      const wb = (m.altar || []).find(b => b.side === side && b.type === 'walls' && b.round === m.round);
      if (wb && altarShown(m, wb) && m.towers && m.towers[side]) { const w = Game.tileToWorld(m.towers[side].col, m.towers[side].row); drawWalls(w.x, w.y, [1, 1, 1, 1].map(() => Game.ICE.wallHits)); }
    }
  }

  function drawBattle() {
    drawBoard();
    const muted = css('--muted'), gold = css('--gold');
    for (const e of fx) {
      const a = 1 - e.age / e.life;
      if (e.kind === 'flame') { // fire cone, drawn under the bodies
        const cx = PX(e.x1), cy = PY(e.y1), ex = PX(e.x2), ey = PY(e.y2);
        const ang = Math.atan2(ey - cy, ex - cx), half = e.half * Math.PI / 180, rr = Math.hypot(ex - cx, ey - cy);
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        grd.addColorStop(0, 'rgba(255,210,90,0.6)'); grd.addColorStop(0.6, 'rgba(255,120,40,0.35)'); grd.addColorStop(1, 'rgba(255,70,20,0.05)');
        ctx.fillStyle = grd; ctx.globalAlpha = 0.4 + 0.6 * a;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, rr, ang - half, ang + half); ctx.closePath(); ctx.fill();
      }
      if (e.kind === 'death') {
        ctx.strokeStyle = teamCol(e.side); ctx.globalAlpha = 0.5 * a; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(PX(e.x), PY(e.y), radius(e.u) * (1 + e.age / e.life), 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (const b of bt.bodies) {
      if (b.alive || b.boarded) continue; // a rider still inside its carrier isn't a corpse
      ctx.fillStyle = muted; ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), Math.max(1.5, radius(b.u) * 0.45), 0, Math.PI * 2); ctx.fill();
    }
    for (const b of bt.bodies) {
      if (!b.alive || !b.u.structure) continue;
      const hpr = b.hp / b.u.hp, t = tilePx();
      if (b.u.kind === 'wall') { drawWallBlock(PX(b.x), PY(b.y), t, b.side, hpr); continue; }
      if (b.u.building) { drawBuilding(PX(b.x), PY(b.y), t, b.side, b.u, hpr, false); continue; }
      drawKeep(PX(b.x), PY(b.y), t, b.side, hpr, b.u.kind, null, Game.charOf(battlePre || m, b.side));
      ctx.strokeStyle = teamCol(b.side); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), t * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpr); ctx.stroke();
      if (b.walls) drawWalls(b.x, b.y, b.walls);
    }
    drawElfTower(battlePre || m, false);
    for (const b of bt.bodies) {
      if (!b.alive || b.u.structure || b.u.aloft) continue;
      const c = teamCol(b.side), r = radius(b.u), hpr = b.hp / b.u.hp;
      if (b.hidden) { // stealthed: a dashed ghost while hidden (fainter for the enemy's)
        ctx.globalAlpha = b.side === me ? 0.6 : 0.3; ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
        Shapes.outline(ctx, b.u.shape, PX(b.x), PY(b.y), r, upOf(b.side));
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        continue;
      }
      const lk = b.mask && b.side !== me && !b.revealed ? b.mask : b.u; // a disguise, until its first attack (devtest)
      Shapes.body(ctx, lk.shape, PX(b.x), PY(b.y), r, upOf(b.side), lk.color, c, (0.35 + 0.65 * hpr) * (b.delay > 0 ? 0.45 : 1));
      if (b.delay > 0) { // flank squads arrive a few seconds late: a shrinking ring shows the wait
        ctx.strokeStyle = css('--gold'); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.delay / Game.FLANK.delay); ctx.stroke();
      }
      if (b.poison && b.poison.length) { ctx.fillStyle = '#6FD08C'; ctx.beginPath(); ctx.arc(PX(b.x) + r * 0.9, PY(b.y) - r * 0.9, Math.max(2, r * 0.3), 0, Math.PI * 2); ctx.fill(); }
      if (b.slowT > 0) { ctx.fillStyle = '#9BD0FF'; ctx.beginPath(); ctx.arc(PX(b.x) - r * 0.9, PY(b.y) - r * 0.9, Math.max(2, r * 0.3), 0, Math.PI * 2); ctx.fill(); } // slowed
      if (b.stunT > 0) { // stunned after a charge: three dots circling over its head
        ctx.fillStyle = '#FFD23F';
        for (let k = 0; k < 3; k++) { const a = bt.time() * 6 + k * 2.094; ctx.beginPath(); ctx.arc(PX(b.x) + Math.cos(a) * r * 0.8, PY(b.y) - r * 1.2 + Math.sin(a) * r * 0.3, Math.max(1.5, r * 0.2), 0, Math.PI * 2); ctx.fill(); }
      }
      if (b.u.hp >= 500 && hpr < 1) {
        ctx.strokeStyle = c; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpr); ctx.stroke();
      }
      if (b.windTarget && b.u.windUp > 0) {
        ctx.strokeStyle = c; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.windT / b.u.windUp)); ctx.stroke();
      }
      const ch = bt.charm ? bt.charm(b.side, b.squad) : 0;
      if (ch >= Engine.CHARM_MAX) drawHat(PX(b.x), PY(b.y) - r * 0.8, Math.max(6, r * 1.3)); // a Gentleman
      else if (ch > 0) { ctx.fillStyle = CHARM_COL; ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y) - r * 1.1, Math.max(1.5, r * 0.25), 0, Math.PI * 2); ctx.fill(); }
      if (b.convert) { // won over by a Gentleman: a pink ring
        ctx.strokeStyle = CHARM_COL; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (b.level > 0) {
        ctx.strokeStyle = gold; ctx.lineWidth = Math.min(2.5, 0.8 + b.level * 0.5);
        Shapes.outline(ctx, b.u.shape, PX(b.x), PY(b.y), r + 3.5, upOf(b.side));
      }
      if (b.shroom) { // purple mushroom buff: faint purple spores drifting up, looping
        ctx.fillStyle = SHROOM_COL.purple;
        for (let k = 0; k < 2; k++) {
          const s0 = (b.squad * 0.29 + b.x * 0.11 + k * 0.5) % 1, p = (bt.time() * 0.6 + s0) % 1;
          ctx.globalAlpha = 0.5 * Math.sin(p * Math.PI);
          ctx.beginPath(); ctx.arc(PX(b.x) + (k ? 1 : -1) * r * (0.3 + 0.3 * Math.sin((p + s0) * 6)), PY(b.y) - r * (0.4 + 1.6 * p), Math.max(1.2, r * 0.16), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (b.fast) { // yellow mushroom: a short speed streak behind the body
        ctx.strokeStyle = SHROOM_COL.yellow; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2;
        const hx = (b.hx || 0) * flip(), hy = -(b.hy || 0) * flip();
        for (const o of [-0.4, 0.4]) { ctx.beginPath(); ctx.moveTo(PX(b.x) - hx * r * 1.2 + hy * r * o, PY(b.y) - hy * r * 1.2 - hx * r * o); ctx.lineTo(PX(b.x) - hx * r * 2.2 + hy * r * o, PY(b.y) - hy * r * 2.2 - hx * r * o); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      if (b.zoe) { // Zoe buff: two faint stars drifting up from the body, looping
        ctx.fillStyle = gold; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(7, Math.round(r * 0.7))}px sans-serif`;
        for (let k = 0; k < 2; k++) {
          const s = (b.squad * 0.37 + b.x * 0.13 + k * 0.5) % 1, p = (bt.time() * 0.7 + s) % 1;
          ctx.globalAlpha = 0.55 * Math.sin(p * Math.PI);
          ctx.fillText('★', PX(b.x) + (k ? 1 : -1) * r * (0.35 + 0.25 * Math.sin((p + s) * 6)), PY(b.y) - r * (0.4 + 1.8 * p));
        }
        ctx.globalAlpha = 1;
      }
    }
    for (const b of bt.bodies) if (b.alive && b.u.aloft) drawAirship(b, tilePx()); // airships fly over everything
    for (const e of fx) {
      const a = 1 - e.age / e.life;
      if (e.kind === 'heal') {
        ctx.strokeStyle = '#6FD08C'; ctx.globalAlpha = 0.8 * a; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(PX(e.x1), PY(e.y1)); ctx.lineTo(PX(e.x2), PY(e.y2)); ctx.stroke(); ctx.setLineDash([]);
        if (e.splash > 0) { ctx.globalAlpha = 0.5 * a; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(PX(e.x2), PY(e.y2), e.splash * S, 0, Math.PI * 2); ctx.stroke(); } // the elves' splash heal
      }
      if (e.kind === 'bolt') { // lightning: a jagged white-blue line with a glow in the team colour
        const x1 = PX(e.x1), y1 = PY(e.y1), x2 = PX(e.x2), y2 = PY(e.y2), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, n = Math.max(3, Math.round(L / 8));
        const pts = [[x1, y1]];
        for (let k = 1; k < n; k++) { const o = (Math.sin((e.seed * 97 + k) * 12.9898) * 43758.5453 % 1) * Math.min(6, L * 0.12); pts.push([x1 + dx * k / n - dy / L * o, y1 + dy * k / n + dx / L * o]); }
        pts.push([x2, y2]);
        for (const [col, lw, al] of [[teamCol(e.side), 4, 0.35], ['#E8F1FF', 1.5, 0.95]]) {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.globalAlpha = al * a; ctx.beginPath(); pts.forEach(([px, py], k) => k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.stroke();
        }
      }
      if (e.kind === 'shot') {
        ctx.strokeStyle = teamCol(e.side); ctx.globalAlpha = 0.7 * a; ctx.lineWidth = Math.max(e.charged ? 3 : 1, 1 + (e.spin - 1) * 1.5); // spun-up beams get thicker
        ctx.beginPath(); ctx.moveTo(PX(e.x1), PY(e.y1)); ctx.lineTo(PX(e.x2), PY(e.y2)); ctx.stroke();
        if (e.splash > 0) { ctx.globalAlpha = 0.4 * a; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(PX(e.x2), PY(e.y2), e.splash * S, 0, Math.PI * 2); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
    for (const p of bt.projectiles()) {
      if (p.owner.u.shape === 'spear') { // a thrown spear: shaft and head along its flight, in the unit's colour
        const L = Math.max(12, 3 * S), dx = p.dirX * flip(), dy = -p.dirY * flip(), hx = PX(p.x), hy = PY(p.y), tx = hx - dx * L, ty = hy - dy * L;
        ctx.strokeStyle = teamCol(p.owner.side); ctx.lineWidth = 3.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.strokeStyle = p.owner.u.color; ctx.lineWidth = 1.5; ctx.stroke();
        const hl = L * 0.32, hw = L * 0.14;
        ctx.fillStyle = p.owner.u.color; ctx.strokeStyle = teamCol(p.owner.side); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(hx + dx * hl * 0.6, hy + dy * hl * 0.6); ctx.lineTo(hx - dx * hl * 0.4 - dy * hw, hy - dy * hl * 0.4 + dx * hw); ctx.lineTo(hx - dx * hl * 0.4 + dy * hw, hy - dy * hl * 0.4 - dx * hw); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.lineCap = 'butt';
        continue;
      }
      ctx.fillStyle = teamCol(p.owner.side);
      ctx.fillRect(PX(p.x) - 2.5, PY(p.y) - 2.5, 5, 5);
    }
    // a fallen tower cripples its army for a few seconds
    const crip = [me, foe()].filter(sd => bt.crippled(sd) > 0);
    crip.forEach((sd, k) => {
      const txt = sd === me ? `Your tower fell · crippled ${Math.ceil(bt.crippled(sd))} s` : `${mode === 'claude' ? 'Claude’s' : 'Enemy'} tower fell · crippled ${Math.ceil(bt.crippled(sd))} s`;
      ctx.font = `600 ${Math.max(11, Math.round(W * 0.035))}px "IBM Plex Mono", monospace`;
      const tw = ctx.measureText(txt).width + 16, th = Math.max(20, W * 0.06), x = (W - tw) / 2, y = H * (sd === me ? 0.62 : 0.32) + k * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, y, tw, th);
      ctx.fillStyle = teamCol(sd); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, W / 2, y + th / 2);
    });
  }
  function draw() {
    pull();
    if (!m) { drawBoard(); return; }
    if (bt && phase === 'battle' && battleCam) { // the battle cam, zoomed in around its focus
      const fx0 = PX(battleCam.x), fy0 = PY(battleCam.y);
      ctx.save(); ctx.translate(fx0, fy0); ctx.scale(battleCam.zoom, battleCam.zoom); ctx.translate(-fx0, -fy0);
      drawBattle();
      ctx.restore();
    } else if (bt && (phase === 'battle' || phase === 'result' || phase === 'end')) drawBattle();
    else drawDeploy();
  }

  // the tile under a point on the screen, in model coordinates (the flip is its own inverse)
  function tileAt(clientX, clientY) {
    pull();
    const r = cv.getBoundingClientRect();
    const c = Math.floor((clientX - r.left) / r.width * Game.COLS);
    const rw = Math.floor((clientY - r.top) / r.height * Game.ROWS);
    if (c < 0 || rw < 0 || c >= Game.COLS || rw >= Game.ROWS) return null;
    return { col: scol(c), row: srow(rw) };
  }

  function floor(plain = false) { pull(); drawBoard(plain); }

  return { size, draw, tileAt, thumb, floor };
};
