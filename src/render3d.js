// ===== 3D board renderer: draws the board, the squads and the battles with three.js =====
// Render3D(THREE, el, view, opts) puts a WebGL canvas in el and offers the same calls as Render2D, reading the game
// only through the same view():
//   { m, me, phase, units, mode, bt, battlePre, fx, selected, moving, drag, hoverTile,
//     editable, placingUnit, placingElf, placingTower }
// Calls: size() after el changes size, draw() once per frame, tileAt(clientX, clientY) -> { col, row } or null,
// thumb(match) (from the 2D renderer). Also camera: the Camera3D driving the view.
// opts.onTap(tile | null): a tap in the strategic view, as a tile in model columns / rows (like tileAt).
// opts.onLevel(level): the camera is settling on a level (0 strategic, 1 angled, 2 ground).
//
// The map floor is painted by the 2D renderer onto a hidden canvas and laid on the ground. Board metres map to the
// world as x -> x, y -> -z (height is y), turned around for side 1 like the 2D board, so your side is toward +z.
// Bodies glide between engine ticks on their own; units are the low-poly models of Models3D.
const Render3D = (THREE, el, view, opts = {}) => {
  const BW = Game.COLS * Game.TILE, BD = Game.ROWS * Game.TILE;
  const css = Art.css;
  const models = Models3D(THREE);

  // ---------- three.js basics: renderer, scene, camera, light ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);
  const bg = css('--bg') || '#0D1315';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, 90, 220);
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 600);
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#20262a', 1.6));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
  sun.position.set(-30, 60, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 65, bottom: -65, near: 1, far: 160 });
  scene.add(sun);

  // ---------- the floor: painted by the 2D renderer (no bodies), repainted when the match, round or side changes ----------
  const floorCv = document.createElement('canvas');
  floorCv.setAttribute('aria-hidden', 'true');
  floorCv.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px';
  document.body.appendChild(floorCv);
  let floorView = null, floorKey = null;
  const floor2d = Render2D(floorCv, () => floorView);
  const groundTex = new THREE.CanvasTexture(floorCv);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(BW, BD), new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // dark land around the board, so the angled views don't end in nothing
  const around = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: '#141b1d' }));
  around.rotation.x = -Math.PI / 2; around.position.y = -0.05; around.receiveShadow = true;
  scene.add(around);
  const noBattle = { bodies: [], projectiles: () => [], crippled: () => 0, time: () => 0 };
  function paintFloor(v) {
    const key = v.m && [v.m.map && v.m.map.id, v.m.round, v.me, v.m.seed].join('|');
    if (!v.m || key === floorKey) return;
    floorKey = key;
    floorView = { ...v, phase: 'battle', bt: noBattle, battlePre: v.m, fx: [], selected: null, moving: null, drag: null, hoverTile: null, editable: false, placingUnit: null, placingElf: false, placingTower: false };
    floor2d.size(); floor2d.draw();
    groundTex.needsUpdate = true;
  }

  // ---------- bodies: one instanced mesh per model part, grown when it runs out of room ----------
  const tintMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.75, metalness: 0.05 });
  const teamMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6, metalness: 0.1 });
  const fixedMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7, metalness: 0.1, vertexColors: true });
  const flatMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(1.0, 1.25, 20).rotateX(-Math.PI / 2).translate(0, 0.04, 0);
  const shotGeo = new THREE.SphereGeometry(0.28, 6, 4);
  const groups = {}; // key -> InstancedMesh
  function group(key, geo, mat, cap) {
    let g = groups[key];
    if (g && g.instanceMatrix.count >= cap) return g;
    if (g) { scene.remove(g); g.dispose(); }
    g = new THREE.InstancedMesh(geo, mat, Math.max(16, cap * 2));
    g.castShadow = mat !== flatMat; g.receiveShadow = mat !== flatMat;
    g.frustumCulled = false;
    scene.add(g);
    return (groups[key] = g);
  }
  function finish(g, n) { g.count = n; g.instanceMatrix.needsUpdate = true; if (g.instanceColor) g.instanceColor.needsUpdate = true; }
  // size in metres, from health, as on the 2D board
  const LEVEL_SIZE = [1, 0.8, 0.65], SWARM_SIZE = [1, 0.72, 0.56];
  const size = (u) => Math.max(0.6, Math.min(2.4, 0.55 + Math.sqrt(u.hp * ((u.bodies >= 5 ? SWARM_SIZE : LEVEL_SIZE)[u.level | 0] || 1)) / 30));
  const teamCols = {};
  const teamColor = (side, me) => teamCols[side + ':' + me] || (teamCols[side + ':' + me] = new THREE.Color(Art.teamCol(side, me)));
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();

  // where each body is drawn: it glides toward the engine's position, so movement looks smooth between ticks
  let shown = new WeakMap();
  const GLIDE = 0.06; // seconds to close most of the gap
  function glide(b, dt) {
    let p = shown.get(b);
    if (!p || Math.hypot(b.x - p.x, b.y - p.y) > 6) { p = { x: b.x, y: b.y, moving: 0, phase: Math.random() * 6 }; shown.set(b, p); return p; }
    const k = 1 - Math.exp(-dt / GLIDE), dx = (b.x - p.x) * k, dy = (b.y - p.y) * k;
    p.x += dx; p.y += dy;
    p.moving += ((Math.hypot(dx, dy) / Math.max(dt, 1e-3) > 0.4 ? 1 : 0) - p.moving) * Math.min(1, dt * 8);
    return p;
  }

  // what stands on the board: { u, side, x, y, hx, hy, hidden, key } in board metres
  function standing(v, dt) {
    const out = [], { m, me, bt, phase, units } = v;
    if (!m) return out;
    if (bt && (phase === 'battle' || phase === 'result' || phase === 'end')) {
      for (const b of bt.bodies) {
        if (!b.alive || b.boarded) continue;
        const p = glide(b, dt);
        out.push({ u: b.u, side: b.side, x: p.x, y: p.y, hx: b.hx, hy: b.hy, hidden: b.hidden, moving: p.moving, phase: p.phase });
      }
      return out;
    }
    shown = new WeakMap();
    const foe = 1 - me;
    const squad = (sq, side) => {
      const u = units[sq.unit], w = Game.tileToWorld(sq.col, sq.row);
      for (const b of Engine.buildSquad(u, side, w.x, w.y, sq.id, Game.TILE)) out.push({ u, side, x: b.x, y: b.y });
    };
    // the opponent's squads from this round stay hidden until the fight; a squad they moved shows on its old tile
    for (const sq of m.armies[foe]) if ((sq.round < m.round || phase !== 'deploy') && !Game.hiddenFromFoe(m, sq)) {
      const p = phase === 'deploy' ? Game.seenAt(m, sq) : sq;
      squad(p === sq ? sq : { ...sq, col: p.col, row: p.row }, foe);
    }
    for (const sq of m.armies[me]) if (!Game.isRider(sq)) squad(sq, me);
    for (const side of [me, foe]) if (m.towers && m.towers[side]) {
      const w = Game.tileToWorld(m.towers[side].col, m.towers[side].row);
      out.push({ u: { structure: true }, side, x: w.x, y: w.y });
    }
    const e = Game.elfSpot(m);
    if (e) out.push({ u: { structure: true }, side: 2, x: e.x, y: e.y });
    return out;
  }

  let clock = 0;
  function placeBodies(v, dt) {
    const f = v.me === 1 ? -1 : 1, me = v.me;
    const byKind = {};
    for (const s of standing(v, dt)) (byKind[models.kindOf(s.u)] || (byKind[models.kindOf(s.u)] = [])).push(s);
    for (const g of Object.values(groups)) g.count = 0;
    const rings = [];
    for (const [kind, list] of Object.entries(byKind)) {
      const parts = models.parts(kind);
      const gs = [['tint', tintMat], ['team', teamMat], ['fixed', fixedMat]].filter(([p]) => parts[p]).map(([p, mat]) => [p, group(kind + ':' + p, parts[p], mat, list.length)]);
      list.forEach((s, i) => {
        const r = s.u.structure ? 1 : size(s.u);
        const hx = s.hx || 0, hy = s.hy == null ? (s.side === 1 ? -1 : 1) : s.hy;
        const bob = s.moving ? Math.abs(Math.sin(clock * 9 + s.phase)) * 0.12 * r * s.moving : 0;
        tmpQ.setFromAxisAngle(up, Math.atan2(-hx * f, hy * f)); // a model's front is its -z side
        tmpP.set(s.x * f, (s.u.aloft ? 6 : 0) + bob, -s.y * f); tmpS.setScalar(r * (s.hidden ? 0.6 : 1));
        tmpM.compose(tmpP, tmpQ, tmpS);
        for (const [p, g] of gs) {
          g.setMatrixAt(i, tmpM);
          if (p === 'tint') g.setColorAt(i, tmpC.set(s.u.color || '#cccccc'));
          if (p === 'team') g.setColorAt(i, teamColor(s.side, me));
          if (p === 'fixed') g.setColorAt(i, tmpC.set('#ffffff'));
        }
        rings.push([s.x * f, -s.y * f, r * (s.u.structure ? 2.6 : 1), s.side]);
      });
      for (const [, g] of gs) finish(g, list.length);
    }
    const rg = group('rings', ringGeo, flatMat, rings.length);
    rings.forEach(([x, z, r, side], i) => { tmpP.set(x, 0, z); tmpS.set(r, 1, r); tmpQ.identity(); rg.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); rg.setColorAt(i, teamColor(side, me)); });
    finish(rg, rings.length);
    // projectiles in flight
    const ps = v.bt && v.phase === 'battle' ? v.bt.projectiles() : [], sg = group('projectiles', shotGeo, flatMat, ps.length);
    ps.forEach((p, i) => { tmpP.set(p.x * f, 1.2, -p.y * f); tmpS.setScalar(1); tmpQ.identity(); sg.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); sg.setColorAt(i, teamColor(p.owner.side, me)); });
    finish(sg, ps.length);
  }

  // ---------- effects from view().fx: shots, bolts, heals and flames as fading lines, deaths as a widening ring ----------
  const LINE_CAP = 800;
  const linePos = new Float32Array(LINE_CAP * 6), lineCol = new Float32Array(LINE_CAP * 6);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  lines.geometry.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lines.geometry.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  lines.frustumCulled = false;
  scene.add(lines);
  const deathGeo = new THREE.RingGeometry(0.92, 1.0, 24).rotateX(-Math.PI / 2).translate(0, 0.06, 0);
  const FX_COL = { heal: new THREE.Color('#7BD66A'), flame: new THREE.Color('#FF8A3D'), bolt: new THREE.Color('#BFE3FF') };
  function drawFx(v) {
    const f = v.me === 1 ? -1 : 1;
    let n = 0;
    const deaths = [];
    for (const e of v.fx || []) {
      const a = Math.max(0, 1 - e.age / e.life);
      if (e.kind === 'death') { deaths.push([e, a]); continue; }
      if (n >= LINE_CAP) continue;
      const c = FX_COL[e.kind] || teamColor(e.side, v.me);
      linePos.set([e.x1 * f, 1.0, -e.y1 * f, e.x2 * f, 0.9, -e.y2 * f], n * 6);
      lineCol.set([c.r * a, c.g * a, c.b * a, c.r * a, c.g * a, c.b * a], n * 6);
      n++;
    }
    lines.geometry.setDrawRange(0, n * 2);
    lines.geometry.attributes.position.needsUpdate = true;
    lines.geometry.attributes.color.needsUpdate = true;
    const dg = group('deaths', deathGeo, flatMat, deaths.length);
    deaths.forEach(([e, a], i) => {
      const r = size(e.u) * (1 + e.age / e.life);
      tmpP.set(e.x * f, 0, -e.y * f); tmpS.set(r, 1, r); tmpQ.identity();
      dg.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); dg.setColorAt(i, tmpC.copy(teamColor(e.side, v.me)).multiplyScalar(a));
    });
    finish(dg, deaths.length);
  }

  // ---------- the tile under the pointer (view().hoverTile) ----------
  const tileMark = new THREE.Mesh(new THREE.PlaneGeometry(Game.TILE - 0.4, Game.TILE - 0.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: css('--you') || '#5CC6DF', transparent: true, opacity: 0.35, depthWrite: false }));
  tileMark.position.y = 0.06; tileMark.visible = false; scene.add(tileMark);
  // model column / row <-> the board as this side sees it (the flip is its own inverse)
  const screenTile = (me, col, row) => me === 1 ? { col: Game.COLS - 1 - col, row: Game.ROWS - 1 - row } : { col, row };
  function tileOfGround(p, me) {
    if (!p) return null;
    const c = Math.floor((p.x + BW / 2) / Game.TILE), r = Math.floor((p.z + BD / 2) / Game.TILE);
    if (c < 0 || r < 0 || c >= Game.COLS || r >= Game.ROWS) return null;
    return screenTile(me, c, r);
  }

  // ---------- camera ----------
  let lastMe = 0;
  const cam = Camera3D(THREE, camera, renderer.domElement, {
    width: BW, depth: BD,
    onTap: (p) => { if (opts.onTap) opts.onTap(tileOfGround(p, lastMe)); },
    onLevel: (lv) => { if (opts.onLevel) opts.onLevel(lv); },
  });

  // ---------- the calls ----------
  function sizeTo() {
    const r = el.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    cam.resize(r.width, r.height);
  }
  let last = 0;
  function draw() {
    const now = performance.now(), dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016; last = now;
    clock += dt;
    const v = view();
    lastMe = v.me;
    paintFloor(v);
    placeBodies(v, dt);
    drawFx(v);
    const ht = v.hoverTile && cam.strategic() ? screenTile(v.me, v.hoverTile.col, v.hoverTile.row) : null;
    tileMark.visible = !!ht;
    if (ht) tileMark.position.set((ht.col + 0.5) * Game.TILE - BW / 2, 0.06, (ht.row + 0.5) * Game.TILE - BD / 2);
    cam.update(dt);
    const near = Math.min(1, cam.zoom() / 2); // fog only at the ground view: the strategic and angled views see the whole board
    scene.fog.near = 400 - 310 * near; scene.fog.far = 600 - 380 * near;
    renderer.render(scene, camera);
  }
  const tileAt = (clientX, clientY) => tileOfGround(cam.groundAt(clientX, clientY), view().me);
  return { size: sizeTo, draw, tileAt, thumb: (match) => floor2d.thumb(match), camera: cam, info: () => renderer.info.render };
};
