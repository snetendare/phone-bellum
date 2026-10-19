// ===== 3D test page: real battles from the engine on a three.js board, to try the camera and its controls =====
// Units are stand-ins (one simple solid per shape, a ring in the team colour underneath) until the real models exist.
// Board metres map to the 3D world as x -> x, y -> -z, and height is y: your side (side 0) is toward +z.
const $ = (id) => document.getElementById(id);
const COL = { you: '#5CC6DF', foe: '#EE6E5C', bg: '#0D1315' };
const BW = Game.COLS * Game.TILE, BD = Game.ROWS * Game.TILE; // board size in metres
const units = Shapes.assign(DATA.units).map(u => ({ ...Engine.withTraits(u), level: 0, bodies: Math.max(1, Math.round(u.bodies)), skillDefs: Engine.SLOTS.map(() => null) }));
const touch = matchMedia('(pointer: coarse)').matches;

// ---------- three.js basics: renderer, scene, camera, light ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.bg);
scene.fog = new THREE.Fog(COL.bg, 90, 220);
const camera = new THREE.PerspectiveCamera(35, 1, 1, 600);
scene.add(new THREE.HemisphereLight('#cfe3ff', '#20262a', 1.6));
const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
sun.position.set(-30, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 65, bottom: -65, near: 1, far: 160 });
scene.add(sun);

// ---------- the board: the 2D renderer paints the map floor onto a canvas, used here as the ground's texture ----------
const floorCanvas = $('board2d');
let floorView = null;
const floor2d = Render2D(floorCanvas, () => floorView);
const groundTex = new THREE.CanvasTexture(floorCanvas);
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
function paintFloor(match) {
  const noBattle = { bodies: [], projectiles: () => [], crippled: () => 0, time: () => 0 };
  floorView = { m: match, me: 0, phase: 'battle', units, mode: 'ai', bt: noBattle, battlePre: match, fx: [], selected: null, moving: null, drag: null, hoverTile: null, editable: false, placingUnit: null, placingElf: false, placingTower: false };
  floor2d.size(); floor2d.draw();
  groundTex.needsUpdate = true;
}

// ---------- stand-in units: one solid per shape, many copies drawn at once (instancing) ----------
const SOLIDS = {
  circle: () => new THREE.CylinderGeometry(0.8, 0.9, 1.3, 10),
  ring: () => new THREE.TorusGeometry(0.65, 0.28, 6, 12).rotateX(Math.PI / 2).translate(0, 0.3, 0),
  square: () => new THREE.BoxGeometry(1.5, 1.4, 1.5),
  triangle: () => new THREE.ConeGeometry(0.95, 1.6, 3),
  diamond: () => new THREE.OctahedronGeometry(0.95),
  pentagon: () => new THREE.CylinderGeometry(0.85, 0.85, 1.2, 5),
  hexagon: () => new THREE.CylinderGeometry(0.9, 0.9, 1.6, 6),
  star: () => new THREE.DodecahedronGeometry(0.9),
  cross: () => new THREE.BoxGeometry(0.5, 1.8, 0.5),
  bar: () => new THREE.BoxGeometry(2.0, 0.7, 0.7),
  horse: () => new THREE.CapsuleGeometry(0.5, 1.2, 3, 8).rotateX(Math.PI / 2),
  spider: () => new THREE.SphereGeometry(0.9, 8, 5).scale(1.2, 0.55, 1.2),
  sun: () => new THREE.IcosahedronGeometry(0.95),
  flame: () => new THREE.ConeGeometry(0.75, 2.0, 7),
  spear: () => new THREE.ConeGeometry(0.35, 2.2, 4),
  imp: () => new THREE.TetrahedronGeometry(1.0),
};
const geoCache = {};
function solid(shape) {
  if (!geoCache[shape]) {
    const g = (SOLIDS[shape] || SOLIDS.circle)().toNonIndexed(); // separate faces: the flat, faceted low-poly look
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.translate(0, -g.boundingBox.min.y, 0); // standing on the ground
    geoCache[shape] = g;
  }
  return geoCache[shape];
}
const bodyMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.75, metalness: 0.05 });
const ringGeo = new THREE.RingGeometry(1.0, 1.35, 20).rotateX(-Math.PI / 2).translate(0, 0.04, 0);
const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
const towerGeo = (() => { const g = new THREE.CylinderGeometry(2.0, 2.4, 5.5, 8).toNonIndexed(); g.computeVertexNormals(); return g.translate(0, 2.75, 0); })();
const shotGeo = new THREE.SphereGeometry(0.28, 6, 4);
const groups = {}; // key -> InstancedMesh, grown when it runs out of room
function group(key, geo, mat, cap) {
  let g = groups[key];
  if (g && g.instanceMatrix.count >= cap) return g;
  if (g) { scene.remove(g); g.dispose(); }
  g = new THREE.InstancedMesh(geo, mat, Math.max(16, cap * 2));
  g.castShadow = mat !== ringMat; g.receiveShadow = mat === bodyMat;
  g.frustumCulled = false;
  scene.add(g);
  return (groups[key] = g);
}
// size in metres, from health, as on the 2D board
const LEVEL_SIZE = [1, 0.8, 0.65], SWARM_SIZE = [1, 0.72, 0.56];
const size = (u) => Math.max(0.6, Math.min(2.4, 0.55 + Math.sqrt(u.hp * ((u.bodies >= 5 ? SWARM_SIZE : LEVEL_SIZE)[u.level | 0] || 1)) / 30));
const teamColor = [new THREE.Color(COL.you), new THREE.Color(COL.foe), new THREE.Color('#D8E68C')];
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();

// ---------- the match: AI armies on both sides; a fight is the engine's real battle, played back ----------
let m = null, bt = null, fighting = false, acc = 0, result = null, seed = 1;
const DT = Game.SETTINGS.dt;
function newMatch() {
  seed = (Math.random() * 1e9) >>> 0;
  m = Game.createMatch(units, DATA.matrix, seed, $('map').value);
  paintFloor(m);
  deploy();
}
function deploy() {
  for (const s of [0, 1]) { Game.aiDeploy(m, s); Game.ensureTower(m, s); Game.ensurePack(m, s); }
  Game.settleTowerPicks(m);
  resetBattle();
}
function resetBattle() { bt = Game.startBattle(m); fighting = false; acc = 0; result = null; shots.length = 0; for (const b of bt.bodies) { b._x = b.x; b._y = b.y; } msg(`Round ${m.round} · deploy`); }
function step() { // one engine tick, remembering where every body was for smooth movement between ticks
  for (const b of bt.bodies) { b._x = b.x; b._y = b.y; }
  const more = bt.step();
  for (const b of bt.bodies) if (b._x === undefined) { b._x = b.x; b._y = b.y; } // bodies that joined this tick
  for (const s of bt.lastShots()) shots.push({ x1: s[0], y1: s[1], x2: s[2], y2: s[3], side: s[4], age: 0 });
  return more;
}
$('fight').addEventListener('click', () => { if (result) resetBattle(); fighting = true; msg(''); });
$('next').addEventListener('click', () => {
  if (!result) { while (step()) {} result = bt.result(); }
  Game.resolve(m, result);
  if (m.over) { newMatch(); return; }
  deploy();
});
$('new').addEventListener('click', newMatch);
$('map').addEventListener('change', newMatch);

// shots: short-lived lines from shooter to target
const shots = [];
const SHOT_CAP = 600;
const shotPos = new Float32Array(SHOT_CAP * 6), shotCol = new Float32Array(SHOT_CAP * 6);
const shotLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
shotLines.geometry.setAttribute('position', new THREE.BufferAttribute(shotPos, 3));
shotLines.geometry.setAttribute('color', new THREE.BufferAttribute(shotCol, 3));
shotLines.frustumCulled = false;
scene.add(shotLines);

// ---------- drawing a frame ----------
function placeBodies(alpha) {
  const byKey = {};
  for (const b of bt.bodies) {
    if (!b.alive) continue;
    const key = b.u.structure ? 'tower' : 'u:' + b.u.shape;
    (byKey[key] || (byKey[key] = [])).push(b);
  }
  const rings = [];
  for (const k of Object.keys(groups)) if (!byKey[k] && k !== 'rings' && k !== 'shots') groups[k].count = 0;
  for (const [key, list] of Object.entries(byKey)) {
    const g = key === 'tower' ? group(key, towerGeo, bodyMat, list.length) : group(key, solid(list[0].u.shape), bodyMat, list.length);
    list.forEach((b, i) => {
      const x = b._x + (b.x - b._x) * alpha, y = b._y + (b.y - b._y) * alpha;
      const r = b.u.structure ? 1 : size(b.u), lift = b.u.aloft ? 7 : 0;
      tmpQ.setFromAxisAngle(up, Math.atan2(-(b.hx || 0), b.hy == null ? (b.side ? -1 : 1) : b.hy)); // a model's front is its -z side
      tmpP.set(x, lift, -y); tmpS.setScalar(r * (b.hidden ? 0.6 : 1));
      g.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
      g.setColorAt(i, tmpC.set(b.u.structure ? teamColor[b.side] : b.u.color || '#cccccc'));
      rings.push([x, y, r * (b.u.structure ? 2.2 : 1), b.side]);
    });
    g.count = list.length;
    g.instanceMatrix.needsUpdate = true; if (g.instanceColor) g.instanceColor.needsUpdate = true;
  }
  const rg = group('rings', ringGeo, ringMat, rings.length);
  rings.forEach(([x, y, r, side], i) => { tmpP.set(x, 0, -y); tmpS.set(r, 1, r); tmpQ.identity(); rg.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); rg.setColorAt(i, teamColor[side] || teamColor[2]); });
  rg.count = rings.length; rg.instanceMatrix.needsUpdate = true; if (rg.instanceColor) rg.instanceColor.needsUpdate = true;
  // projectiles in flight
  const ps = bt.projectiles(), sg = group('shots', shotGeo, ringMat, ps.length);
  ps.forEach((p, i) => { tmpP.set(p.x, 1.2, -p.y); tmpS.setScalar(1); tmpQ.identity(); sg.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); sg.setColorAt(i, teamColor[p.owner.side] || teamColor[2]); });
  sg.count = ps.length; sg.instanceMatrix.needsUpdate = true; if (sg.instanceColor) sg.instanceColor.needsUpdate = true;
}
function drawShots(dt) {
  let n = 0;
  for (const s of shots) {
    s.age += dt; if (s.age > 0.18 || n >= SHOT_CAP) continue;
    const c = teamColor[s.side] || teamColor[2], k = 1 - s.age / 0.18;
    shotPos.set([s.x1, 1.0, -s.y1, s.x2, 0.9, -s.y2], n * 6);
    shotCol.set([c.r * k, c.g * k, c.b * k, c.r * k, c.g * k, c.b * k], n * 6);
    n++;
  }
  for (let i = shots.length - 1; i >= 0; i--) if (shots[i].age > 0.18) shots.splice(i, 1);
  shotLines.geometry.setDrawRange(0, n * 2);
  shotLines.geometry.attributes.position.needsUpdate = true;
  shotLines.geometry.attributes.color.needsUpdate = true;
}

// ---------- camera and controls ----------
const tileMark = new THREE.Mesh(new THREE.PlaneGeometry(Game.TILE - 0.4, Game.TILE - 0.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL.you, transparent: true, opacity: 0.35, depthWrite: false }));
tileMark.position.y = 0.06; tileMark.visible = false; scene.add(tileMark);
const LEVEL_NAMES = ['Strategic', 'Angled', 'Ground'];
const cam = Camera3D(THREE, camera, renderer.domElement, {
  width: BW, depth: BD,
  // a tap in the strategic view: the tile under it, in the game's own column / row numbers (as the 2D board's tileAt)
  onTap: (p) => {
    if (!p) return;
    const col = Math.floor((p.x + BW / 2) / Game.TILE), row = Math.floor((p.z + BD / 2) / Game.TILE);
    if (col < 0 || row < 0 || col >= Game.COLS || row >= Game.ROWS) { tileMark.visible = false; return; }
    tileMark.position.set((col + 0.5) * Game.TILE - BW / 2, 0.06, (row + 0.5) * Game.TILE - BD / 2); tileMark.visible = true;
    msg(`Tapped tile: column ${col + 1}, row ${row + 1}`);
  },
});
function showLevel() {
  const lv = cam.level(), z = cam.zoom();
  [...$('levels').children].forEach((c, k) => c.classList.toggle('on', k === lv));
  tileMark.visible = tileMark.visible && z < 0.01;
}
$('help').textContent = touch
  ? 'Spread two fingers to go in · drag to look around · twist two fingers to rotate · tap to go back'
  : 'Scroll to go in or out · drag to look around · hold the right or middle button and drag to rotate (or Q / E) · click or Esc to go back';
let msgTimer = 0;
function msg(t) { $('msg').textContent = t; $('msg').hidden = !t; clearTimeout(msgTimer); if (t && t.startsWith('Tapped')) msgTimer = setTimeout(() => msg(''), 1800); }

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  cam.resize(w, h);
}
window.addEventListener('resize', resize);

// ---------- the loop ----------
let last = 0, fpsT = 0, fpsN = 0, fps = 0;
function frame(ts) {
  const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016; last = ts;
  if (fighting && !result) {
    acc += dt * (bt.time() > 20 ? 3 : 1.5);
    while (acc >= DT) { acc -= DT; if (!step()) { result = bt.result(); fighting = false; break; } }
    if (result) msg(result.winner === 0 ? `Round ${m.round}: blue wins` : result.winner === 1 ? `Round ${m.round}: red wins` : `Round ${m.round}: draw`);
  }
  placeBodies(fighting ? Math.min(1, acc / DT) : 1);
  drawShots(fighting ? dt * 1.5 : dt);
  cam.update(dt);
  const near = Math.min(1, cam.zoom() / 2); // fog only at the ground view: the strategic and angled views see the whole board
  scene.fog.near = 400 - 310 * near; scene.fog.far = 600 - 380 * near;
  showLevel();
  renderer.render(scene, camera);
  fpsN++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; $('stats').textContent = `${fps} fps · ${bt.bodies.filter(b => b.alive).length} bodies · ${renderer.info.render.calls} draws`; }
  requestAnimationFrame(frame);
}
resize();
newMatch();
requestAnimationFrame(frame);
window.__lab3d = { cam, get m() { return m; }, get bt() { return bt; } }; // for tests
