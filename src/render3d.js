// ===== 3D board renderer: draws the board, the squads and the battles with three.js =====
// Render3D(THREE, el, view, opts) puts a WebGL canvas in el and offers the same calls as Render2D, reading the game
// only through the same view():
//   { m, me, phase, units, mode, bt, battlePre, fx, selected, moving, drag, hoverTile, rangeOf,
//     editable, placingUnit, placingElf, placingTower, placingBuilding, battleCam, dev }
// battleCam ({ zoom, x, y, k }, the final seconds of a fight): from the strategic or tilted view the camera moves in, lower and onto
// the action (Camera3D's focus); a player who went into a closer view keeps it.
// Calls: size() after el changes size, draw() once per frame, tileAt(clientX, clientY) -> { col, row } or null,
// screenAt(col, row, h) -> [clientX, clientY] of a tile's middle h metres up,
// thumb(match) (from the 2D renderer). Also camera: the Camera3D driving the view.
// opts.onTap(tile | null): a tap in the strategic view, as a tile in model columns / rows (like tileAt).
// opts.onPress(tile) -> true to take a one-finger drag in the strategic view, then opts.onDrag(tile) and
// opts.onDrop(tile | null, ended): ended is false when a second finger or a cancel stopped it. opts.onHover(tile | null):
// the mouse over the strategic view. opts.placing() -> true: the angled view takes them too. All as in Camera3D, with
// tiles for ground points.
// opts.onLevel(level): the camera is settling on a level (0 strategic, 1 tilted, 2 angled, 3 ground).
// For a page that draws only when something changes: opts.onInput() on every pointer, wheel and key event, and
// still() -> false while the camera moves on its own. quality('high' | 'medium' | 'low') trades sharpness and shadows
// for speed: high is the screen's pixels up to 2 per CSS pixel with shadows, medium 1.5 with shadows, low 1 without.
// dispose() when the page is done with the board: frees the WebGL context (the page removes el). drawn(): what the
// last frame drew, and pickAt(clientX, clientY): the tile a touch there picks, for checks.
//
// The map floor (zones, flank tiles, mushrooms, buff tiles, the storm and the altar) is painted by the 2D renderer
// onto a hidden canvas and laid on the ground. Everything else is drawn here, with the same rules for what this
// screen may see as the 2D board. Board metres map to the world as x -> x, y -> -z (height is y), turned around for
// side 1 like the 2D board, so your side is toward +z. Bodies glide between engine ticks on their own.
// Layers: the low-poly models of Models3D (instanced, one mesh per model part), sprites (every small marker: health
// bars, arcs, rings, tile outlines, icons, labels; one draw call), beams (shots, bolts, heals, streaks), flame fans,
// ice walls, and a text overlay for the crippled-army notice.
const Render3D = (THREE, el, view, opts = {}) => {
  const BW = Game.COLS * Game.TILE, BD = Game.ROWS * Game.TILE, T = Game.TILE;
  const css = Art.css;
  const { ELF_COL, SHROOM_COL, CHARM_COL, BLEED_COL, POOL_COL } = Art;
  const models = Models3D(THREE);

  // ---------- three.js basics: renderer, scene, camera, light ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);
  // fingers on the board never scroll the page (some phones look at the canvas itself, not only at el)
  renderer.domElement.style.touchAction = 'none';
  el.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
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

  // ---------- the floor: the 2D renderer's board without squads, repainted when what it shows may have changed ----------
  const floorCv = document.createElement('canvas');
  floorCv.setAttribute('aria-hidden', 'true');
  floorCv.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px';
  document.body.appendChild(floorCv);
  let floorView = null, floorKey = null, floorAge = 0, floorDims = '';
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
  const ids = new WeakMap(); let nextId = 1;
  const idOf = (o) => o ? (ids.get(o) || (ids.set(o, nextId), nextId++)) : 0;
  function paintFloor(v, dt) {
    if (!v.m) return;
    // while deploying, the board changes with what the player buys (mushrooms, buff tiles, the altar): look again twice a second
    floorAge += dt;
    const key = [idOf(v.m), idOf(v.battlePre), v.m.round, v.me, v.phase, uiOff, v.dev ? JSON.stringify([v.dev, v.editable, v.m.dev.casts.length, v.m.armies[v.me].map(q => q.guide || 0)]) : ''].join('|'); // devtest: arrows, spells and placing show at once
    if (key === floorKey && !(v.phase === 'deploy' && floorAge > 0.5)) return;
    floorKey = key; floorAge = 0;
    floorView = { ...v, bt: v.phase === 'battle' ? null : v.bt, fx: [], selected: null, moving: null, drag: null, hoverTile: null, placingElf: false, placingTower: false, placingWall: false, placingBuilding: null };
    floor2d.size(); floor2d.floor(uiOff); // the ground view gets the land alone, no zones or grid
    // a texture can't grow in place: when the canvas changed size (the first floor, or after a resize), start a new one
    const dims = floorCv.width + 'x' + floorCv.height;
    if (dims !== floorDims) { groundTex.dispose(); floorDims = dims; }
    groundTex.needsUpdate = true;
  }

  // ---------- models: one instanced mesh per model part and look, grown when it runs out of room ----------
  const tintMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.75, metalness: 0.05 });
  const teamMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6, metalness: 0.1 });
  const fixedMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7, metalness: 0.1, vertexColors: true });
  // see-through looks, the whole body in the team colour: stealthed (yours, the enemy's), waiting to flank, airships
  const seeThrough = (opacity) => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.5, transparent: true, opacity, depthWrite: false });
  const LOOKS = { ghost: seeThrough(0.45), ghostFoe: seeThrough(0.22), glass: seeThrough(0.55) };
  const flatMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(1.0, 1.25, 20).rotateX(-Math.PI / 2).translate(0, 0.04, 0);
  const shotGeo = new THREE.SphereGeometry(0.28, 6, 4);
  const groups = {}; // key -> InstancedMesh
  const used = new Set(); // groups drawn this frame
  function group(key, geo, mat, cap) {
    let g = groups[key];
    if (!g || g.instanceMatrix.count < cap) {
      if (g) { scene.remove(g); g.dispose(); }
      g = new THREE.InstancedMesh(geo, mat, Math.max(16, cap * 2));
      g.castShadow = !mat.transparent; g.receiveShadow = !mat.transparent;
      g.frustumCulled = false;
      scene.add(g);
      groups[key] = g;
    }
    used.add(g);
    return g;
  }
  function finish(g, n) { g.count = n; g.instanceMatrix.needsUpdate = true; if (g.instanceColor) g.instanceColor.needsUpdate = true; }
  // size in metres, from health, as on the 2D board
  const LEVEL_SIZE = [1, 0.8, 0.65], SWARM_SIZE = [1, 0.72, 0.56];
  const size = (u) => Math.max(0.6, Math.min(2.4, 0.55 + Math.sqrt(u.hp * ((u.bodies >= 5 ? SWARM_SIZE : LEVEL_SIZE)[u.level | 0] || 1)) / 30));
  // unit models are drawn this much bigger than their 2D size, so they read from above
  const MODEL_SCALE = 1.3;
  const cols = {};
  const color = (hex) => cols[hex] || (cols[hex] = new THREE.Color(hex));
  const teamColor = (side, me) => color(Art.teamCol(side, me));
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();
  const zAxis = new THREE.Vector3(0, 0, 1), tmpD = new THREE.Vector3(), camRight = new THREE.Vector3(), camDown = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0), tmpQ2 = new THREE.Quaternion();

  // ---------- sprites: every small marker, in one draw call ----------
  // Each is a quad: an icon or a bar facing the camera, or a ring arc, disc or tile square lying on the ground.
  // p: icon -> its place in the atlas (u0, v0, u1, v1); bar -> fill; arc -> fill, thickness (share of the radius),
  // dashes around the full circle, soft (fades toward the rim); square -> -, thickness (share of half the side), dashes.
  const MODE = { icon: 0, bar: 1, arc: 2, square: 3 };
  const SPR_CAP = 6000;
  const sprGeo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  sprGeo.index = quad.index; sprGeo.setAttribute('position', quad.getAttribute('position')); sprGeo.setAttribute('uv', quad.getAttribute('uv'));
  const sprAttr = {};
  for (const [name, n] of [['aPos', 3], ['aSize', 2], ['aCol', 4], ['aP', 4], ['aMode', 1]]) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(SPR_CAP * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    sprGeo.setAttribute(name, a); sprAttr[name] = a;
  }
  const atlasCv = document.createElement('canvas'); atlasCv.width = atlasCv.height = 1024;
  const atlas = new THREE.CanvasTexture(atlasCv);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.generateMipmaps = false; atlas.minFilter = THREE.LinearFilter;
  const sprMat = new THREE.ShaderMaterial({
    uniforms: { atlas: { value: atlas } },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec3 aPos; attribute vec2 aSize; attribute vec4 aCol; attribute vec4 aP; attribute float aMode;
      varying vec2 vUv; varying vec4 vCol; varying vec4 vP; varying float vMode;
      void main() {
        vUv = uv; vCol = aCol; vP = aP; vMode = aMode;
        vec4 mv;
        if (aMode < 1.5) { mv = viewMatrix * vec4(aPos, 1.0); mv.xy += position.xy * aSize; }
        else mv = viewMatrix * vec4(aPos + vec3(position.x * aSize.x, 0.0, -position.y * aSize.y), 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D atlas;
      varying vec2 vUv; varying vec4 vCol; varying vec4 vP; varying float vMode;
      void main() {
        vec4 c = vCol;
        if (vMode < 0.5) c *= texture2D(atlas, mix(vP.xy, vP.zw, vUv));
        else if (vMode < 1.5) {
          float edge = step(vUv.y, 0.16) + step(0.84, vUv.y) + step(vUv.x, 0.025) + step(0.975, vUv.x);
          if (edge > 0.0 || vUv.x > vP.x) c = vec4(0.03, 0.04, 0.05, 0.8 * vCol.a);
        } else if (vMode < 2.5) {
          vec2 p = vUv * 2.0 - 1.0; float r = length(p);
          if (r > 1.0 || r < 1.0 - vP.y) discard;
          float f = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
          if (f > vP.x) discard;
          if (vP.z > 0.0 && fract(f * vP.z) > 0.5) discard;
          if (vP.w > 0.5) c.a *= 1.0 - r;
        } else {
          vec2 p = abs(vUv * 2.0 - 1.0);
          if (max(p.x, p.y) < 1.0 - vP.y) discard;
          if (vP.z > 0.0 && fract((vUv.x + vUv.y) * vP.z) > 0.5) discard;
        }
        if (c.a < 0.01) discard;
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
  });
  const sprites = new THREE.Mesh(sprGeo, sprMat);
  sprites.frustumCulled = false; sprites.renderOrder = 10;
  scene.add(sprites);
  // what the camera level shows: strategic (health as rings), tilted (health as bars, markers a
  // little bigger than angled), angled (health as bars), ground (no markers at all,
  // only what belongs to the scene: corpses, stun stars, buff sparkles; wrap those in scene())
  let viewMode = 'strategic', uiOff = false;
  const scene_ = (fn) => { const k = uiOff; uiOff = false; fn(); uiOff = k; };
  let ns = 0;
  function spr(mode, x, y, z, w, h, c, a, p0 = 0, p1 = 0, p2 = 0, p3 = 0) {
    if (ns >= SPR_CAP || a <= 0.01 || uiOff) return;
    const P = sprAttr.aPos.array, S = sprAttr.aSize.array, C = sprAttr.aCol.array, Q = sprAttr.aP.array, i3 = ns * 3, i2 = ns * 2, i4 = ns * 4;
    P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; S[i2] = w; S[i2 + 1] = h;
    C[i4] = c.r; C[i4 + 1] = c.g; C[i4 + 2] = c.b; C[i4 + 3] = a;
    Q[i4] = p0; Q[i4 + 1] = p1; Q[i4 + 2] = p2; Q[i4 + 3] = p3;
    sprAttr.aMode.array[ns] = mode;
    ns++;
  }
  const white = color('#ffffff');
  // icon (billboard), size s metres tall; wide icons (labels) keep their shape
  function icon(key, x, y, z, s, c = white, a = 1) { const u = cell(key); spr(MODE.icon, x, y, z, s * u.aspect, s, c, a, u.u0, u.v0, u.u1, u.v1); }
  const bar = (x, y, z, w, h, fill, c, a = 1) => spr(MODE.bar, x, y, z, w, h, c, a, Math.max(0, Math.min(1, fill)));
  // a ring or arc on the ground at board point (wx, wz) in the world; r = outer radius
  const arc = (wx, wz, r, c, a, fill = 1, thick = 0.12, dashes = 0, soft = 0, y = 0.07) => spr(MODE.arc, wx, y, wz, r * 2, r * 2, c, a, fill, thick, dashes, soft);
  const disc = (wx, wz, r, c, a, soft = 0) => arc(wx, wz, r, c, a, 1, 1, 0, soft, 0.06);
  // a tile square (screen column / row as this side sees the board): thick = 1 fills it
  const tileSq = (sc, sr, c, a, thick = 0.07, dashes = 0, inset = 0.06) => spr(MODE.square, (sc + 0.5) * T - BW / 2, 0.08, (sr + 0.5) * T - BD / 2, T * (1 - inset * 2), T * (1 - inset * 2), c, a, 0, thick, dashes);
  // a row of icons above a point, spread along the screen's horizontal
  function iconRow(keys, x, y, z, s, c, a = 1) {
    const step = s * 1.1, x0 = -(keys.length - 1) * step / 2;
    keys.forEach((k, i) => { const o = x0 + i * step; icon(k, x + camRight.x * o, y, z + camRight.z * o, s, Array.isArray(c) ? c[i] : c, a); });
  }

  // the icon atlas: 64 px cells, drawn the first time each icon is needed (labels take two cells' width)
  const CELL = 64, PER = 1024 / CELL;
  const actx = atlasCv.getContext('2d');
  let cells = {}, nextCell = 0;
  const ICONS = {
    dot: (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill(); },
    star: (g) => { g.fillStyle = '#fff'; g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 12 : 28; g.lineTo(32 + r * Math.cos(a), 34 + r * Math.sin(a)); } g.closePath(); g.fill(); },
    plus: (g) => { // ready to level up: a gold badge with a plus
      g.fillStyle = css('--gold'); g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
      g.strokeStyle = css('--bg'); g.lineWidth = 8; g.beginPath(); g.moveTo(16, 32); g.lineTo(48, 32); g.moveTo(32, 16); g.lineTo(32, 48); g.stroke(); },
    hat: (g) => { // the Gentleman's top hat
      g.fillStyle = '#16161C'; g.strokeStyle = '#EDEFF2'; g.lineWidth = 2.5;
      g.beginPath(); g.rect(4, 44, 56, 8); g.rect(16, 6, 32, 40); g.fill(); g.stroke();
      g.fillStyle = CHARM_COL; g.fillRect(16, 32, 32, 7); },
  };
  function drawCell(key, g) {
    const [kind, a, b, c] = key.split('|');
    if (ICONS[kind]) return ICONS[kind](g);
    if (kind === 'tag') { // a unit's 3-letter tag (two cells wide)
      g.font = '600 34px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 7; g.strokeStyle = 'rgba(8,12,14,0.9)'; g.strokeText(a, 64, 34); g.fillStyle = '#E5ECE9'; g.fillText(a, 64, 34);
    } else if (kind === 'arms') Art.armsFlag(g, a, 6, 12, 52, b); // a coat of arms on a flag edged in a side's colour
    else if (kind === 'rider') { // what rides inside a carrier: its shape on a disc
      g.fillStyle = css('--bg'); g.strokeStyle = c; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = b; Shapes.draw(g, a, 32, 32, 15, 1);
    }
  }
  function cell(key) {
    if (cells[key]) return cells[key];
    const wide = key.startsWith('tag|') ? 2 : 1;
    if (nextCell % PER + wide > PER) nextCell += PER - nextCell % PER;
    if (nextCell + wide > PER * PER) { cells = {}; nextCell = 0; actx.clearRect(0, 0, 1024, 1024); } // full: start over
    const cx = nextCell % PER, cy = Math.floor(nextCell / PER);
    nextCell += wide;
    actx.save(); actx.translate(cx * CELL, cy * CELL); actx.beginPath(); actx.rect(0, 0, CELL * wide, CELL); actx.clip();
    drawCell(key, actx); actx.restore();
    atlas.needsUpdate = true;
    const e = 0.5 / 1024;
    return (cells[key] = { u0: cx * CELL / 1024 + e, u1: (cx + wide) * CELL / 1024 - e, v0: 1 - (cy + 1) * CELL / 1024 + e, v1: 1 - cy * CELL / 1024 - e, aspect: wide });
  }

  // ---------- beams: shots, bolts, heals, hail and speed streaks (glowing boxes, added light) ----------
  const beamMat = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
  const beamGeo = new THREE.BoxGeometry(1, 1, 1);
  const beams = [];
  const beam = (x1, y1, z1, x2, y2, z2, w, c, a) => { if (a > 0.01) beams.push([x1, y1, z1, x2, y2, z2, w, c.r * a, c.g * a, c.b * a]); };
  function drawBeams() {
    const g = group('beams', beamGeo, beamMat, beams.length);
    beams.forEach(([x1, y1, z1, x2, y2, z2, w, r, gg, b], i) => {
      tmpD.set(x2 - x1, y2 - y1, z2 - z1); const L = tmpD.length() || 1e-3;
      tmpQ.setFromUnitVectors(zAxis, tmpD.multiplyScalar(1 / L));
      tmpP.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2); tmpS.set(w, w, L);
      g.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); g.setColorAt(i, tmpC.setRGB(r, gg, b));
    });
    finish(g, beams.length);
    beams.length = 0;
  }

  // ---------- flame cones: fans on the ground, bright at the mouth, fading outward ----------
  const FAN_CAP = 64, FAN_SEG = 10;
  const fanPos = new Float32Array(FAN_CAP * FAN_SEG * 9), fanCol = new Float32Array(FAN_CAP * FAN_SEG * 9);
  const fans = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  fans.geometry.setAttribute('position', new THREE.BufferAttribute(fanPos, 3));
  fans.geometry.setAttribute('color', new THREE.BufferAttribute(fanCol, 3));
  fans.frustumCulled = false;
  scene.add(fans);

  // ---------- ice walls around a tower (Frozen Peak): they shrink as they take hits ----------
  const wallMat = new THREE.MeshStandardMaterial({ color: '#CFEAF7', roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.75, flatShading: true });
  const walls = [];
  function addWalls(f, wx, wy, hits) {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    hits.forEach((n, k) => {
      if (!(n > 0)) return;
      const h = 2.6 * n / Game.ICE.wallHits, x = (wx + dirs[k][0] * T * 0.5) * f, z = -(wy + dirs[k][1] * T * 0.5) * f;
      walls.push([x, h, z, dirs[k][0] !== 0]);
    });
  }
  function drawWalls() {
    const g = group('walls', beamGeo, wallMat, walls.length);
    walls.forEach(([x, h, z, across], i) => { tmpP.set(x, h / 2, z); tmpQ.identity(); tmpS.set(across ? T * 0.12 : T * 0.8, h, across ? T * 0.8 : T * 0.12); g.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); });
    finish(g, walls.length);
    walls.length = 0;
  }

  // ---------- text over the board: a fallen tower cripples its army for a few seconds ----------
  const note = document.createElement('div');
  note.style.cssText = 'position:absolute;inset:0;pointer-events:none;font:600 13px "IBM Plex Mono",ui-monospace,monospace';
  el.appendChild(note);
  let noteText = '';
  function showNote(v) {
    const { bt, me, mode, phase } = v;
    let html = '';
    if (bt && phase === 'battle') for (const sd of [me, 1 - me]) {
      const s = bt.crippled(sd); if (!(s > 0)) continue;
      const txt = sd === me ? `Your tower fell · crippled ${Math.ceil(s)} s` : `${mode === 'claude' ? 'Claude’s' : 'Enemy'} tower fell · crippled ${Math.ceil(s)} s`;
      html += `<div style="position:absolute;left:50%;top:${sd === me ? 62 : 30}%;transform:translateX(-50%);background:rgba(0,0,0,.6);padding:4px 8px;white-space:nowrap;color:${Art.teamCol(sd, me)}">${txt}</div>`;
    }
    if (html !== noteText) { note.innerHTML = html; noteText = html; }
  }

  // ---------- where each body is drawn: it glides toward the engine's position, so movement looks smooth ----------
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

  // ---------- what stands on the board, with its markers ----------
  // A body: { u, side, x, y (board metres), hx, hy, look ('solid', 'ghost', 'ghostFoe', 'glass'), moving, phase,
  //   flag (a Color for its team parts, if not its side's), b (the battle body, for its markers) }
  let clock = 0;
  const bodies = [];
  const towerUnit = (m, side, seen) => seen ? Game.towerType(m, side).unit : Game.OUTPOST.unit;
  const world = (f, x, y) => [x * f, -y * f];
  // a tile in model columns / rows -> where this side sees it on the board ({ c, r })
  const tileCenter = (v, col, row) => v.me === 1 ? { c: Game.COLS - 1 - col, r: Game.ROWS - 1 - row } : { c: col, r: row };
  // the neutral elf spire and the players' own elf spires, as on the 2D board
  function addSpires(v, src, deploying, f) {
    const e = Game.elfSpot(src); if (!e) return;
    const strong = Game.elfPowered(src), roof = strong ? '#E8B931' : '#5E9A4E';
    const lead = Game.bribeLeader(src, deploying);
    const arms = (sd) => Game.charShown(src, v.me, deploying, sd) ? Game.charOf(src, sd) : null;
    const spire = (x, y, side, flagCol, crest, scale) => {
      bodies.push({ u: { spire: true, structure: true, color: roof }, side, x, y, look: 'solid', flag: color(flagCol), scale, crest, edge: flagCol });
      const [wx, wz] = world(f, x, y);
      if (strong) scene_(() => disc(wx, wz, 4.5, color('#FFD65A'), 0.45, 1));
    };
    spire(e.x, e.y, 2, lead < 0 ? '#F4F1E6' : Art.teamCol(lead, v.me), lead < 0 ? null : arms(lead), 1);
    if (deploying) { const [wx, wz] = world(f, e.x, e.y); arc(wx, wz, Game.ELF_TOWER.range, color(ELF_COL), 0.3, 1, 0.012, 90); }
    for (const sd of [v.me, 1 - v.me]) {
      const own = Game.elfOwnOf(src, sd);
      if (!own || !Game.elfOwnShown(src, v.me, deploying, sd)) continue;
      const w = Game.tileToWorld(own.col, own.row);
      spire(w.x, w.y, sd, Art.teamCol(sd, v.me), arms(sd), 0.85);
    }
  }
  let squadTiles = new Set(); // 'col,row' of the squads drawn while deploying (model columns / rows), for pick()
  let models_ = []; // the squad models drawn while deploying, for pick(): [x, z, radius, height, col, row] (world metres)
  function collectBattle(v, dt, f) {
    squadTiles = new Set();
    const { bt, me } = v, src = v.battlePre || v.m;
    const muted = color(css('--muted') || '#8DA1A1');
    for (const b of bt.bodies) {
      if (!b.alive) { if (!b.boarded) { const [wx, wz] = world(f, b.x, b.y); scene_(() => disc(wx, wz, Math.max(0.3, size(b.u) * 0.45), muted, 0.18)); } continue; }
      if (b.boarded) continue;
      const p = glide(b, dt);
      const look = b.u.aloft || (b.site && b.site.work < b.site.need) ? 'glass' : b.hidden ? (b.side === me ? 'ghost' : 'ghostFoe') : b.delay > 0 ? 'ghost' : 'solid'; // a building site is a see-through scaffold
      const crest = b.u.structure ? Game.charOf(src, b.side) : null;
      const u = b.mask && b.side !== me && !b.revealed ? { ...b.u, ...b.mask } : b.u; // a disguise, until its first attack (devtest)
      const tag = b.u.structure || b.u.aloft || b.u.noCount || (b.hidden && b.side !== me) ? null : `${b.side}|${b.squad}|${u.name}`;
      bodies.push({ u, side: b.side, x: p.x, y: p.y, hx: b.hx, hy: b.hy, look, moving: p.moving, phase: p.phase, b, crest, edge: Art.teamCol(b.side, me), tag });
      if (b.u.structure && b.walls) addWalls(f, b.x, b.y, b.walls);
    }
    // Pool shaper's pools: water on the ground, ringed in their side's colour
    for (const q of bt.pools ? bt.pools() : []) {
      const [wx, wz] = world(f, q.x, q.y), team = teamColor(q.side, me);
      scene_(() => { disc(wx, wz, q.r, color(POOL_COL), 0.3, 0.3); arc(wx, wz, q.r, team, 0.5, 1, 0.08); });
    }
    // the Mecha Tower's mines: a dark disc ringed in the team colour (the opponent's fainter)
    for (const mn of bt.mines ? bt.mines() : []) {
      const [wx, wz] = world(f, mn.x, mn.y), team = teamColor(mn.side, me);
      scene_(() => { disc(wx, wz, 0.55, color('#2B2F33'), 0.9); arc(wx, wz, 0.8, team, mn.side === me ? 0.9 : 0.5, 1, 0.14); });
    }
    // a linked squad: a faint line joins its bodies (they share one health pool)
    for (const b of bt.bodies) {
      if (!b.alive || !b.link || b.hidden || uiOff) continue;
      const nx = b.link[(b.link.indexOf(b) + 1) % b.link.length], p = shown.get(b), q = nx && shown.get(nx);
      if (nx === b || !nx.alive || !p || !q) continue;
      beam(p.x * f, 0.5, -p.y * f, q.x * f, 0.5, -q.y * f, 0.08 * fxWide(), teamColor(b.side, me), 0.35);
    }
    addSpires(v, src, false, f);
  }
  function collectDeploy(v, f) {
    shown = new WeakMap();
    squadTiles = new Set();
    const { m, me, phase, units, drag, moving, selected, hoverTile, placingUnit, editable } = v, foe = 1 - me;
    const deploying = phase === 'deploy';
    const you = color(css('--you') || '#5CC6DF'), gold = color(css('--gold') || '#E6B84A');
    const squad = (sq, side, fresh) => {
      if (units[sq.unit].building) { // a building bought in the shop (the Altar of Build): in the middle of its block
        const u = units[sq.unit], n = Game.footprint(m, sq.unit), w = Game.recordWorld({ col: sq.col, row: sq.row, size: n }), [wx, wz] = world(f, w.x, w.y);
        bodies.push({ u: { ...u, size: n }, side, x: w.x, y: w.y, look: sq.built ? 'solid' : 'glass' });
        if (!sq.built) arc(wx, wz, 2.6 * n, gold, 0.95, sq.progress || 0, 0.05);
        if (fresh) for (const [c, r] of Game.blockOf(m, sq.unit, sq.col, sq.row)) { const st = tileCenter(v, c, r); tileSq(st.c, st.r, teamColor(side, me), 0.8, 0.05, 14); }
        if (sq.level > 0) iconRow([...Array(sq.level)].map(() => 'dot'), wx, 7.2, wz, 0.5, gold);
        if (side === me && deploying && Game.isReady(m, sq)) icon('plus', wx + camRight.x * 4, 5, wz + camRight.z * 4, 1.1);
        return [wx, wz];
      }
      const u = units[sq.unit], w = Game.tileToWorld(sq.col, sq.row), st = tileCenter(v, sq.col, sq.row);
      const list = Engine.buildSquad(u, side, w.x, w.y, sq.id, T);
      squadTiles.add(sq.col + ',' + sq.row);
      for (const b of list) bodies.push({ u, side, x: b.x, y: b.y, look: 'solid', tag: side + '|' + sq.id, tile: sq });
      if (fresh) tileSq(st.c, st.r, teamColor(side, me), 0.8, 0.05, 14);
      // badges over the squad: level pips, charisma pips (or the Gentleman's hat), ready to level up (its tag goes
      // under it, see labels)
      const [wx, wz] = world(f, w.x, w.y), top = models.height(models.kindOf(u)) * size(u) * MODEL_SCALE + 0.6;
      const pips = [];
      for (let k = 0; k < (sq.level || 0); k++) pips.push(gold);
      const ch = Game.charmOf(sq);
      if (!Game.isGentleman(sq)) for (let k = 0; k < ch; k++) pips.push(color(CHARM_COL));
      // badges, read from above too (bigger in the strategic view, where the camera is farthest), placed as on the 2D
      // board: level and charisma pips at the squad's top left on the screen, ready to level up a gold plus at its top right
      const bs = viewMode === 'strategic' ? 2.5 : viewMode === 'tilted' ? 2 : 1.6, o = 1.4 + bs * 0.6;
      if (pips.length) { const n = (pips.length - 1) * 0.42 * bs * 1.1 / 2; iconRow(pips.map(() => 'dot'), wx - camRight.x * (o - n) - camDown.x * o, top + 0.2, wz - camRight.z * (o - n) - camDown.z * o, 0.42 * bs * 1.5, pips); }
      if (Game.isGentleman(sq)) icon('hat', wx, top + 1.1, wz, 1.1 * bs * 0.8);
      if (side === me && deploying && Game.isReady(m, sq)) icon('plus', wx + (camRight.x - camDown.x) * o, top + 0.2, wz + (camRight.z - camDown.z) * o, 0.9 * bs);
      return [wx, wz];
    };
    // the opponent's squads from this round stay hidden until the fight; a squad they moved shows on its old tile
    for (const sq of m.armies[foe]) if ((sq.round < m.round || !deploying) && !Game.hiddenFromFoe(m, sq)) {
      const p = deploying ? Game.seenAt(m, sq) : sq;
      const look = Game.shownUnit(m, me, foe, sq.unit); // a disguised unit shows as what it pretends to be
      squad(deploying ? { ...sq, unit: look, col: p.col, row: p.row, level: Game.seenLevel(m, sq) } : { ...sq, unit: look }, foe, false); // a level-up bought this round stays hidden
    }
    for (const sq of m.armies[me]) {
      if (deploying && sq.from && sq.movedRound === m.round) { const s = tileCenter(v, sq.from.col, sq.from.row); tileSq(s.c, s.r, color(css('--muted') || '#8DA1A1'), 0.6, 0.04, 10, 0.1); }
      if (Game.isRider(sq)) continue; // shown as a badge on its carrier
      const at = drag && drag.moved && drag.id === sq.id ? { ...sq, col: drag.over.col, row: drag.over.row } : sq;
      const [wx, wz] = squad(at, me, (sq.round === m.round || sq.movedRound === m.round) && deploying);
      const rider = Game.riderOf(m, me, sq);
      if (rider) { const ru = units[rider.unit]; icon(`rider|${ru.shape}|${ru.color}|${Art.teamCol(me, me)}`, wx - camRight.x * 1.6, 1.0, wz - camRight.z * 1.6, 1.0); }
      if (moving === sq.id && deploying) { const s = tileCenter(v, sq.col, sq.row); tileSq(s.c, s.r, gold, 1, 0.08, 0, 0.02); }
    }
    // the squad tapped last: its range as a dashed ring on the ground (theirs as you can know it)
    const rs = v.rangeOf && deploying && m.armies[v.rangeOf.side].find(s => s.id === v.rangeOf.id);
    if (rs) {
      const p = v.rangeOf.side !== me ? Game.seenAt(m, rs) : drag && drag.moved && drag.id === rs.id ? drag.over : rs;
      const w = Game.tileToWorld(p.col, p.row), [wx, wz] = world(f, w.x, w.y), r = Game.squadRange(m, v.rangeOf.side, rs, v.rangeOf.side !== me);
      arc(wx, wz, r, teamColor(v.rangeOf.side, me), 0.9, 1, 0.3 / r, Math.max(24, Math.round(r * 4)));
    }
    // where things may go
    if ((selected !== null || (drag && drag.moved) || moving != null) && deploying) {
      for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) {
        if (Game.canPlaceAt(m, me, c, row, placingUnit) && Game.spotFree(m, me, c, row, placingUnit)) { const s = tileCenter(v, c, row); tileSq(s.c, s.r, you, 0.3, 0.05); }
      }
      if (placingUnit != null) for (const sq of m.armies[me]) if (Game.boardable(m, me, sq.col, sq.row, placingUnit) && !(drag && drag.id === sq.id)) { const s = tileCenter(v, sq.col, sq.row); tileSq(s.c, s.r, gold, 0.85, 0.07, 0, 0.03); }
    }
    if (hoverTile && (selected !== null || moving != null) && Game.canPlaceAt(m, me, hoverTile.col, hoverTile.row, placingUnit) && (Game.spotFree(m, me, hoverTile.col, hoverTile.row, placingUnit) || (placingUnit != null && Game.boardable(m, me, hoverTile.col, hoverTile.row, placingUnit)))) {
      for (const [c, r] of Game.blockOf(m, placingUnit, hoverTile.col, hoverTile.row)) { const s = tileCenter(v, c, r); tileSq(s.c, s.r, you, 0.2, 1, 0, 0); } // a building's whole block
    }
    if (v.placingWall && editable) for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) if (Game.bwallSpotOk(m, me, c, row)) { const s = tileCenter(v, c, row); tileSq(s.c, s.r, you, 0.55, 0.06); }
    if (v.placingElf && editable) for (const row of Game.zoneRows(me)) for (let c = 0; c < Game.COLS; c++) if (Game.elfOwnSpotOk(m, me, c, row)) { const s = tileCenter(v, c, row); tileSq(s.c, s.r, color(ELF_COL), 0.6, 0.06); }
    if (v.placingTower && editable) for (const row of Game.zoneRows(me)) for (let c = 0; c < Game.COLS; c++) {
      if (Game.towerColOk(c) && !Game.reserved(me, c, row) && !Game.occupied(m, me, c, row)) { const s = tileCenter(v, c, row); tileSq(s.c, s.r, gold, 0.5, 0.06); }
    }
    // towers: their type and coat of arms only where this screen may see them
    // devtest: buildings (an opponent's new one from the fight on) and walls cast this round
    if (Game.isDev(m)) for (const side of [me, foe]) {
      for (const b of Game.placedLessers(m, side)) {
        if (!Game.devShown(m, me, deploying, side, b.round)) continue;
        const at = drag && drag.bkey === b.key && drag.moved && side === me ? drag.over : b, w = Game.tileToWorld(at.col, at.row);
        bodies.push({ u: Game.lesserUnit(m, side, b), side, x: w.x, y: w.y, look: 'solid', edge: Art.teamCol(side, me), tag: `${side}|b${b.key}`, scale: 0.75 });
        if (side === me && b.round === m.round && deploying) { const st = tileCenter(v, at.col, at.row); tileSq(st.c, st.r, teamColor(side, me), 0.8, 0.05, 14); }
      }
      for (const c of Game.activeCasts(m)) if (c.side === side && (Game.devSpell(c.id) || {}).kind === 'wall' && Game.devShown(m, me, deploying, side, c.round)) {
        const w = Game.tileToWorld(c.col, c.row);
        bodies.push({ u: { structure: true, lesser: true, kind: 'wall', color: '#9C7E58', hp: 1 }, side, x: w.x, y: w.y, look: 'solid', scale: 0.8 });
      }
    }
    // the bastions' walls while deploying (an opponent's new one only from the fight on)
    if (deploying) for (const side of [me, foe]) for (const bw of Game.bwallsOf(m, side)) {
      if (!Game.bwallShown(m, me, true, side, bw)) continue;
      const w = Game.tileToWorld(bw.col, bw.row);
      bodies.push({ u: Game.bwallUnit(), side, x: w.x, y: w.y, look: 'solid', edge: Art.teamCol(side, me) });
      if (side === me && bw.round === m.round) { const st = tileCenter(v, bw.col, bw.row); tileSq(st.c, st.r, teamColor(side, me), 0.8, 0.05, 14); }
    }
    // the treasuries (Test Grid): see-through in round 1, before they are built
    if (Game.treasuryOn(m)) for (const side of [me, foe]) {
      const ts = Game.treasurySpot(m, side), w = Game.tileToWorld(ts.col, ts.row);
      bodies.push({ u: Game.treasuryUnit(), side, x: w.x, y: w.y, look: Game.treasuryUp(m) ? 'solid' : 'glass', edge: Art.teamCol(side, me) });
    }
    for (const side of [me, foe]) if (m.towers && m.towers[side] && Game.towerUp(m, side)) {
      const w = Game.tileToWorld(m.towers[side].col, m.towers[side].row);
      const crest = Game.charShown(m, me, deploying, side) ? Game.charOf(m, side) : null;
      bodies.push({ u: towerUnit(m, side, Game.towerTypeShown(m, me, deploying, side)), side, x: w.x, y: w.y, look: 'solid', crest, edge: Art.teamCol(side, me) });
    }
    addSpires(v, m, deploying, f);
    // buildings (the Mechites' Factory): a see-through scaffold with a gold arc until it is built (an opponent's new one only from the fight on)
    for (const side of [me, foe]) for (const bl of Game.buildingsOf(m, side)) {
      if (!Game.buildingShown(m, me, deploying, side, bl)) continue;
      const info = Game.buildingInfo(bl.id) || {}, w = Game.tileToWorld(bl.col, bl.row), [wx, wz] = world(f, w.x, w.y);
      bodies.push({ u: { name: info.name, building: bl.id, color: info.color || '#B07A3C', hp: info.hp || 1000 }, side, x: w.x, y: w.y, look: bl.built ? 'solid' : 'glass' });
      if (!bl.built) arc(wx, wz, 3.2, gold, 0.95, bl.progress || 0, 0.07);
      if (bl.level > 0) iconRow([...Array(bl.level)].map(() => 'dot'), wx, 5.6, wz, 0.5, gold);
      if (side === me && deploying && Game.buildingReady(bl)) icon('plus', wx + camRight.x * 2.4, 4.2, wz + camRight.z * 2.4, 1.0);
    }
    if (v.placingBuilding && editable) for (const row of Game.zoneRows(me)) for (let c = 0; c < Game.COLS; c++) if (Game.buildingSpotOk(m, me, c, row)) { const s = tileCenter(v, c, row); tileSq(s.c, s.r, gold, 0.6, 0.06, 12); }
    if (Game.isIce(m)) for (const side of [me, foe]) {
      // Snowgres on their tiles in no man's land (an opponent's new one shows up at the fight), and walls bought this round
      const buys = (m.altar || []).filter(b => b.side === side && b.type === 'snowgre');
      Game.snowgres(m, side).forEach((sg, k) => {
        if (!Game.altarShown(m, me, deploying, buys[k])) return;
        const w = Game.tileToWorld(sg.col, sg.row);
        bodies.push({ u: Game.snowgreUnit(m, sg.strength), side, x: w.x, y: w.y, look: 'solid' });
      });
      const wb = (m.altar || []).find(b => b.side === side && b.type === 'walls' && b.round === m.round);
      if (wb && Game.altarShown(m, me, deploying, wb) && m.towers && m.towers[side]) { const w = Game.tileToWorld(m.towers[side].col, m.towers[side].row); addWalls(f, w.x, w.y, [1, 1, 1, 1].map(() => Game.ICE.wallHits)); }
    }
  }

  // markers on a battle body: health, wind-up, flank wait, statuses, charisma, level, mushroom and Zoe buffs
  function bodyMarkers(s, f, me, wx, wz, r, top, t) {
    const b = s.b, team = teamColor(s.side, me), u = s.u;
    const hpr = Math.max(0, b.hp / u.hp);
    let y = top + 0.45;
    const big = u.structure || u.building;
    if (big || (u.hp >= 500 && hpr < 1)) {
      if (viewMode === 'strategic') { // a ring around it, as on the 2D board (dark where the health is gone)
        const rr = big ? 3.1 * (u.size > 1 ? 1.5 : 1) : r * 1.42, th = big ? 0.11 : 0.1;
        arc(wx, wz, rr, color('#0B0F11'), 0.6, 1, th, 0, 0, 0.065); arc(wx, wz, rr, team, 1, hpr, th);
      } else { const w = big ? 4.2 : Math.max(1.6, r * 1.5); bar(wx, y, wz, w, big ? 0.42 : 0.3, hpr, team); y += 0.55; }
    }
    if (u.building) { // how far the site is built, and the unit it is making
      const gold = color(css('--gold') || '#E6B84A');
      if (b.site && b.site.work < b.site.need) arc(wx, wz, 3.5 * (u.size > 1 ? 1.5 : 1), gold, 1, b.site.work / b.site.need, 0.08);
      if (b.produce && !b.produced && b.prodT != null) arc(wx, wz, 2.5, gold, 0.95, 1 - b.prodT / b.produce.time, 0.1, 24);
      return;
    }
    if (u.structure) return;
    if (b.windTarget && u.windUp > 0) arc(wx, wz, r * 1.58, team, 0.95, 1 - b.windT / u.windUp, 0.1);
    if (b.buildT > 0 && b.buildFull > 0) arc(wx, wz, r * 1.58, color(css('--gold') || '#E6B84A'), 1, 1 - b.buildT / b.buildFull, 0.12, 24); // a builder at work
    if (b.delay > 0) arc(wx, wz, r * 1.58, color(css('--gold') || '#E6B84A'), 1, b.delay / Game.FLANK.delay, 0.1);
    if (b.level > 0) for (let k = 0; k < b.level; k++) arc(wx, wz, r * (1.8 + k * 0.24), color(css('--gold') || '#E6B84A'), 0.9, 1, 0.12);
    if (b.convert) arc(wx, wz, r * 1.66, color(CHARM_COL), 0.9, 1, 0.07, 16);
    if (b.forgeT > 0 && b.forgeFull > 0) arc(wx, wz, r * 1.7, color('#C9D1D9'), 0.95, 1 - b.forgeT / b.forgeFull, 0.1, 24); // forging a titanium spear
    // small dots over the head: poisoned (green), slowed (blue), bleeding (a red one per stack), charisma stacks (pink)
    const dots = [];
    if (b.poison && b.poison.length) dots.push(color('#6FD08C'));
    if (b.slowT > 0) dots.push(color('#9BD0FF'));
    if (b.bleed) for (let k = 0; k < b.bleed.n; k++) dots.push(color(BLEED_COL));
    const ch = v0.bt.charm ? v0.bt.charm(b.side, b.squad) : 0;
    if (ch >= Engine.CHARM_MAX) { icon('hat', wx, top + 0.35, wz, Math.max(0.8, r * 0.9)); y += 0.5; }
    else if (ch > 0) dots.push(color(CHARM_COL));
    if (dots.length) iconRow(dots.map(() => 'dot'), wx, y + 0.1, wz, 0.4, dots);
    scene_(() => sceneMarkers(b, wx, wz, r, top, t));
    if (b.fast) { // yellow mushroom: speed streaks behind it
      const hx = (b.hx || 0) * f, hz = -(b.hy || 0) * f;
      for (const o of [-0.4, 0.4]) beam(wx - hx * r * 1.2 - hz * r * o, 0.6 * r, wz - hz * r * 1.2 + hx * r * o, wx - hx * r * 2.4 - hz * r * o, 0.6 * r, wz - hz * r * 2.4 + hx * r * o, 0.06, color(SHROOM_COL.yellow), 0.6);
    }
  }
  // grey puffs rising from (x, y, z), part of the scene (shown in every view)
  const smokeCol = color('#8E8A86');
  function smoke(x, y, z, s, seed) {
    scene_(() => { for (let k = 0; k < 3; k++) { const p = ((clock * 0.6 + k / 3 + seed * 0.17) % 1 + 1) % 1; icon('dot', x + Math.sin((p + k) * 5) * s * 0.5, y + p * s * 4, z, s * (0.6 + p * 1.4), smokeCol, 0.5 * (1 - p)); } });
  }
  // what belongs to the scene itself, shown in every view: stun, mushroom spores, Zoe's stars
  function sceneMarkers(b, wx, wz, r, top, t) {
    if (b.stunT > 0) for (let k = 0; k < 3; k++) { // stunned: three dots circling over its head
      const a = t * 6 + k * 2.094; icon('dot', wx + Math.cos(a) * r * 0.7, top + 0.25, wz + Math.sin(a) * r * 0.7, 0.35, color('#FFD23F'));
    }
    const seed = b.squad * 0.29 + b.x * 0.11;
    if (b.shroom) for (let k = 0; k < 2; k++) { // purple mushroom: spores drifting up
      const s0 = (seed + k * 0.5) % 1, p = (t * 0.6 + s0) % 1;
      icon('dot', wx + (k ? 1 : -1) * r * (0.3 + 0.3 * Math.sin((p + s0) * 6)), top * (0.3 + 0.9 * p), wz, 0.3, color(SHROOM_COL.purple), 0.7 * Math.sin(p * Math.PI));
    }
    if (b.zoe) for (let k = 0; k < 2; k++) { // Zoe's buff: stars drifting up
      const s0 = (seed * 1.3 + k * 0.5) % 1, p = (t * 0.7 + s0) % 1;
      icon('star', wx + (k ? 1 : -1) * r * (0.35 + 0.25 * Math.sin((p + s0) * 6)), top * (0.3 + 1.0 * p), wz, 0.5, color(css('--gold') || '#E6B84A'), 0.75 * Math.sin(p * Math.PI));
    }
  }

  let v0 = null;
  function placeBodies(v, dt) {
    const f = v.me === 1 ? -1 : 1, me = v.me;
    bodies.length = 0;
    if (!v.m) return;
    const battle = v.bt && (v.phase === 'battle' || v.phase === 'result' || v.phase === 'end');
    if (battle) collectBattle(v, dt, f); else collectDeploy(v, f);
    const byKey = {};
    for (const s of bodies) { const k = models.kindOf(s.u) + '#' + s.look; (byKey[k] || (byKey[k] = [])).push(s); }
    const rings = [], labels = new Map();
    models_ = [];
    for (const [key, list] of Object.entries(byKey)) {
      const [kind, look] = key.split('#'), parts = models.parts(kind), top = models.height(kind);
      const gs = [['tint', tintMat], ['team', teamMat], ['fixed', fixedMat]].filter(([p]) => parts[p])
        .map(([p, mat]) => [p, group(key + ':' + p, parts[p], look === 'solid' ? mat : LOOKS[look], list.length)]);
      const rollAt = models.ROLL_AT[kind];
      list.forEach((s, i) => {
        // towers and buildings are drawn at their own size and face their own side (a walking building faces where it goes)
        const fixed = (s.u.structure || s.u.building) && !s.u.awake;
        const r = s.u.structure || s.u.building ? (s.scale || 1) : size(s.u) * MODEL_SCALE, sc = r * (s.look === 'ghost' || s.look === 'ghostFoe' ? 0.85 : 1);
        const hx = s.hx || 0, hy = s.hy == null ? (s.side === 1 ? -1 : 1) : s.hy;
        const lift = s.u.aloft ? (s.u.kind === 'drone' ? 4 : 6) + Math.sin(clock * 1.5 + (s.phase || 0)) * 0.3 : 0; // a drone flies lower than an airship
        // Mechites glide (smooth); a roller rolls instead of bobbing
        const bob = s.moving && !s.u.smooth && !rollAt ? Math.abs(Math.sin(clock * 9 + s.phase)) * 0.12 * r * s.moving : 0;
        const [wx, wz] = world(f, s.x, s.y);
        tmpQ.setFromAxisAngle(up, fixed ? (s.side === me ? Math.PI : 0) : Math.atan2(-hx * f, hy * f)); // a model's front is its -z side; a tower's door faces its own side
        tmpP.set(wx, lift + bob, wz); tmpS.setScalar(sc);
        if (rollAt && s.b) { // turn the ball around its middle by how far it has rolled
          tmpQ.multiply(tmpQ2.setFromAxisAngle(xAxis, -(s.b.moved || 0) / (rollAt * sc)));
          const c = rollAt * sc; tmpD.set(0, -c, 0).applyQuaternion(tmpQ); tmpP.x += tmpD.x; tmpP.y += c + tmpD.y; tmpP.z += tmpD.z;
        }
        // what the Mechites build rattles (in fights)
        if (s.b && (s.u.construct || s.u.building) && s.look === 'solid') { tmpP.x += Math.sin(clock * 47 + (s.phase || 0) * 13) * 0.04 * sc; tmpP.z += Math.cos(clock * 53 + (s.phase || 0) * 7) * 0.04 * sc; }
        tmpM.compose(tmpP, tmpQ, tmpS);
        const team = s.flag || teamColor(s.side, me);
        for (const [p, g] of gs) {
          g.setMatrixAt(i, tmpM);
          if (look !== 'solid') g.setColorAt(i, team);
          else g.setColorAt(i, p === 'tint' ? tmpC.set(s.u.color || '#cccccc') : p === 'team' ? team : white);
        }
        // a stealthed body is only its see-through model, as the dashed ghost on the 2D board: no markers, and no
        // ring under the opponent's
        const ghost = !!(s.b && s.b.hidden && !s.u.aloft);
        if (!s.u.spire && !uiOff && !(ghost && s.side !== me)) rings.push([wx, wz, r * (s.u.structure || s.u.building ? 2.6 * (s.u.size > 1 ? 1.6 : 1) : 1), s.side]);
        const h = top * sc + lift;
        if (s.crest) icon(`arms|${s.crest}|${s.edge}`, wx, h + 1.2, wz, 1.5);
        if (s.b && !ghost) { bodyMarkers(s, f, me, wx, wz, r, h, clock); s.marked = true; }
        // smoke from constructs, and from a working building's chimney (in fights)
        if (s.b && s.look === 'solid' && (s.u.construct || s.u.building)) {
          if (s.u.building === 'factory') { tmpD.set(1.3, s.u.awake ? 5.5 : 4.8, 0.9).applyQuaternion(tmpQ); smoke(wx + tmpD.x, tmpD.y, wz + tmpD.z, 0.9, s.phase || 0); }
          else if (s.u.building) { /* the altar doesn't smoke */ }
          else smoke(wx, h, wz, 0.35 * r, s.phase || 0);
        }
        if (s.tag) { const l = labels.get(s.tag) || { u: s.u, pts: [] }; l.pts.push([wx, wz, r]); labels.set(s.tag, l); }
        if (s.tile) models_.push([wx, wz, r, h, s.tile.col, s.tile.row]);
      });
      for (const [, g] of gs) finish(g, list.length);
    }
    // each squad's tag, just below it on the screen and clear of its models, so it can be read from above
    const tagS = viewMode === 'strategic' ? 2.8 : viewMode === 'tilted' ? 2.2 : 1.6;
    for (const { u, pts } of labels.values()) {
      let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
      let reach = 0; for (const [x, z, r] of pts) reach = Math.max(reach, (x - cx) * camDown.x + (z - cz) * camDown.z + r * 0.8);
      const d = reach + tagS * 0.3;
      icon('tag|' + Shapes.tag(u), cx + camDown.x * d, 0.3, cz + camDown.z * d, tagS, white, 0.95);
    }
    const rg = group('rings', ringGeo, flatMat, rings.length);
    rings.forEach(([x, z, r, side], i) => { tmpP.set(x, 0, z); tmpS.set(r, 1, r); tmpQ.identity(); rg.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); rg.setColorAt(i, teamColor(side, me)); });
    finish(rg, rings.length);
    if (!battle) return;
    // projectiles in flight: thrown spears, and team-coloured shot for the rest
    const ps = v.phase === 'battle' ? v.bt.projectiles() : [];
    const isSpear = (p) => p.spear || p.owner.u.shape === 'spear'; // Truespear, and titanium spears
    const spears = ps.filter(isSpear), rest = ps.filter(p => !isSpear(p));
    const sg = group('projectiles', shotGeo, flatMat, rest.length);
    rest.forEach((p, i) => { tmpP.set(p.x * f, 1.6, -p.y * f); tmpS.setScalar(fxWide() * 1.4); tmpQ.identity(); sg.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); sg.setColorAt(i, tmpC.copy(teamColor(p.owner.side, me)).lerp(white, 0.45)); });
    finish(sg, rest.length);
    const sp = models.parts('spear'), spT = group('spear:tint', sp.tint, tintMat, spears.length), spF = group('spear:fixed', sp.fixed, fixedMat, spears.length);
    spears.forEach((p, i) => {
      tmpD.set(p.dirX * f, 0, -p.dirY * f).normalize(); tmpQ.setFromUnitVectors(tmpS.set(0, 0, -1), tmpD);
      tmpP.set(p.x * f, 1.3, -p.y * f); tmpS.setScalar(1); tmpM.compose(tmpP, tmpQ, tmpS);
      spT.setMatrixAt(i, tmpM); spT.setColorAt(i, tmpC.set(p.owner.u.color || '#cccccc'));
      spF.setMatrixAt(i, tmpM); spF.setColorAt(i, white);
    });
    finish(spT, spears.length); finish(spF, spears.length);
    // hail on Frozen Peak: falling streaks in the hail tiles
    const src = v.battlePre || v.m;
    if (Game.isIce(src) && v.phase === 'battle') for (const h of Game.hailTiles(src)) {
      const s = tileCenter(v, h.col, h.row), x0 = s.c * T - BW / 2, z0 = s.r * T - BD / 2;
      for (let k = 0; k < 6; k++) {
        const fx = (k * 0.37 + h.col * 0.13) % 1, fz = (k * 0.53 + h.row * 0.29) % 1, p = (v.bt.time() * (0.9 + (k % 3) * 0.25) + k * 0.21) % 1, y = 9 * (1 - p);
        beam(x0 + fx * T, y + 0.8, z0 + fz * T, x0 + fx * T - 0.1, y, z0 + fz * T, 0.07, color('#EAF6FF'), 0.8);
      }
    }
  }

  // ---------- effects from view().fx ----------
  // shots and bolts are drawn wider the farther the camera is, so they show from above as on the 2D board
  const fxWide = () => viewMode === 'strategic' ? 3 : viewMode === 'tilted' ? 2.3 : viewMode === 'angled' ? 1.7 : 1;
  function drawFx(v) {
    const f = v.me === 1 ? -1 : 1, k = fxWide();
    let nf = 0;
    // a flamer breathes fire every tick: draw only its newest cone, so they don't stack into a solid blaze
    const flames = new Map();
    for (const e of v.fx || []) if (e.kind === 'flame') { const k = Math.round(e.x1 * 2) + ':' + Math.round(e.y1 * 2), o = flames.get(k); if (!o || e.age < o.age) flames.set(k, e); }
    const newest = new Set(flames.values());
    const jag = (seed, k) => (Math.sin((seed * 97 + k) * 12.9898) * 43758.5453) % 1;
    for (const e of v.fx || []) {
      const a = Math.max(0, 1 - e.age / e.life), team = teamColor(e.side, v.me);
      if (e.kind === 'death') { arc(e.x * f, -e.y * f, size(e.u) * (1 + e.age / e.life), team, 0.6 * a, 1, 0.1); continue; }
      const x1 = e.x1 * f, z1 = -e.y1 * f, x2 = e.x2 * f, z2 = -e.y2 * f;
      if (e.kind === 'shot') {
        beam(x1, 1.1, z1, x2, 0.9, z2, k * Math.max(e.charged ? 0.28 : 0.1, 0.1 + ((e.spin || 1) - 1) * 0.16), team, 0.85 * a);
        if (e.splash > 0) arc(x2, z2, e.splash, team, 0.55 * a, 1, 0.08);
      } else if (e.kind === 'heal') { // a dashed green line
        const L = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.floor(L / 1.2)), heal = color('#6FD08C');
        for (let k = 0; k < n; k++) { const p0 = k / n, p1 = (k + 0.5) / n; beam(x1 + (x2 - x1) * p0, 1.0, z1 + (z2 - z1) * p0, x1 + (x2 - x1) * p1, 1.0, z1 + (z2 - z1) * p1, 0.12 * k, heal, 0.9 * a); }
        if (e.splash > 0) arc(x2, z2, e.splash, heal, 0.6 * a, 1, 0.08);
      } else if (e.kind === 'bolt') { // lightning: a jagged white-blue line with a glow in the team colour
        const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1, n = Math.max(3, Math.round(L / 2.5)), pts = [[x1, 1.2, z1]];
        for (let k = 1; k < n; k++) { const o = jag(e.seed || 0, k) * Math.min(1.5, L * 0.12); pts.push([x1 + dx * k / n - dz / L * o, 1.2 + Math.abs(o) * 0.6, z1 + dz * k / n + dx / L * o]); }
        pts.push([x2, 1.0, z2]);
        for (let j = 1; j < pts.length; j++) {
          beam(...pts[j - 1], ...pts[j], 0.4 * k, team, 0.4 * a);
          beam(...pts[j - 1], ...pts[j], 0.1 * k, color('#E8F1FF'), a);
        }
      } else if (e.kind === 'flame' && nf < FAN_CAP && newest.has(e)) { // a fire cone, bright at the mouth
        const ang = Math.atan2(z2 - z1, x2 - x1), half = (e.half || 30) * Math.PI / 180, rr = Math.hypot(x2 - x1, z2 - z1), k = 0.4 + 0.6 * a;
        for (let sgm = 0; sgm < FAN_SEG; sgm++) {
          const a0 = ang - half + 2 * half * sgm / FAN_SEG, a1 = ang - half + 2 * half * (sgm + 1) / FAN_SEG, o = (nf * FAN_SEG + sgm) * 9;
          fanPos.set([x1, 0.3, z1, x1 + Math.cos(a0) * rr, 0.3, z1 + Math.sin(a0) * rr, x1 + Math.cos(a1) * rr, 0.3, z1 + Math.sin(a1) * rr], o);
          fanCol.set(e.slam ? [0.42 * k, 0.33 * k, 0.2 * k, 0.12 * k, 0.09 * k, 0.05 * k, 0.12 * k, 0.09 * k, 0.05 * k] : [0.55 * k, 0.32 * k, 0.08 * k, 0.12 * k, 0.03 * k, 0, 0.12 * k, 0.03 * k, 0], o); // a ground slam is dust, not fire
        }
        nf++;
      }
    }
    fans.geometry.setDrawRange(0, nf * FAN_SEG * 3);
    fans.geometry.attributes.position.needsUpdate = true; fans.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- the tile under the pointer (view().hoverTile), in the strategic view ----------
  // model column / row <-> the board as this side sees it (the flip is its own inverse)
  const screenTile = (me, col, row) => me === 1 ? { col: Game.COLS - 1 - col, row: Game.ROWS - 1 - row } : { col, row };
  function tileOfGround(p, me) {
    if (!p) return null;
    const c = Math.floor((p.x + BW / 2) / T), r = Math.floor((p.z + BD / 2) / T);
    if (c < 0 || r < 0 || c >= Game.COLS || r >= Game.ROWS) return null;
    return screenTile(me, c, r);
  }

  // ---------- what a finger points at ----------
  // In the angled view a model stands above its tile, so a touch on its body meets the ground behind it. Follow the
  // touch down from the height of the tallest model: the first squad model it passes through gives the tile; else
  // the tile on the ground.
  function pick(p, cx, cy) {
    const t = tileOfGround(p, lastMe);
    if (cx == null || viewMode === 'strategic' || !models_.length) return t;
    const top = Math.max(...models_.map(b => b[3]));
    for (let h = top; h > 0.1; h -= 0.25) {
      const q = cam.groundAt(cx, cy, h); if (!q) continue;
      for (const [x, z, r, mh, col, row] of models_) if (h <= mh && Math.hypot(q.x - x, q.z - z) < r * 0.75) return { col, row };
    }
    return t;
  }

  // ---------- camera ----------
  let lastMe = 0;
  const cam = Camera3D(THREE, camera, renderer.domElement, {
    width: BW, depth: BD,
    onTap: (p, cx, cy) => { if (opts.onTap) opts.onTap(pick(p, cx, cy)); },
    // a press on a squad never moves the camera: one the page doesn't drag is held still, as on the 2D board
    onPress: (p, cx, cy) => { const t = pick(p, cx, cy); return !!(opts.onPress && opts.onPress(t)) || !!(t && squadTiles.has(t.col + ',' + t.row)); },
    onDrag: (p) => { if (opts.onDrag) opts.onDrag(tileOfGround(p, lastMe)); },
    onDrop: (p) => { if (opts.onDrop) opts.onDrop(tileOfGround(p, lastMe), !!p); },
    onHover: (p) => { if (opts.onHover) opts.onHover(tileOfGround(p, lastMe)); },
    placing: () => !!(opts.placing && opts.placing()),
    onLevel: (lv) => { if (opts.onLevel) opts.onLevel(lv); },
    onInput: () => { if (opts.onInput) opts.onInput(); },
  });

  // ---------- the calls ----------
  function sizeTo() {
    const r = el.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    cam.resize(r.width, r.height);
  }
  let last = 0, camOn = false; // camOn: the battle cam has the camera
  function draw() {
    const now = performance.now(), dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016; last = now;
    clock += dt;
    const v = view();
    v0 = v; lastMe = v.me;
    if (v.battleCam) { const f = v.me === 1 ? -1 : 1; cam.focus(v.battleCam.k, v.battleCam.x * f, -v.battleCam.y * f); camOn = true; }
    else if (camOn) { cam.focus(0); camOn = false; }
    cam.update(dt);
    camRight.setFromMatrixColumn(camera.matrixWorld, 0); camRight.y = 0; camRight.normalize();
    // down the screen, along the ground (toward the camera in the angled view, toward your side from above)
    camDown.setFromMatrixColumn(camera.matrixWorld, 1).negate(); camDown.y = 0;
    if (camDown.lengthSq() < 1e-6) camDown.set(0, 0, 1); camDown.normalize();
    const z = cam.zoom();
    viewMode = z < -0.5 ? 'tilted' : z < 0.5 ? 'strategic' : z < 1.5 ? 'angled' : 'ground'; uiOff = viewMode === 'ground';
    paintFloor(v, dt);
    used.clear(); ns = 0;
    placeBodies(v, dt);
    drawFx(v);
    if (v.hoverTile && cam.handsOn() && !(v.selected !== null || v.moving != null)) { const s = screenTile(v.me, v.hoverTile.col, v.hoverTile.row); tileSq(s.col, s.row, color(css('--you') || '#5CC6DF'), 0.35, 1, 0, 0.03); }
    drawBeams(); drawWalls();
    for (const g of Object.values(groups)) if (!used.has(g)) g.count = 0;
    sprGeo.instanceCount = ns;
    for (const a of Object.values(sprAttr)) { a.clearUpdateRanges(); a.addUpdateRange(0, ns * a.itemSize); a.needsUpdate = true; }
    showNote(uiOff ? {} : v);
    const near = Math.max(0, Math.min(1, cam.zoom() / 2)); // fog only at the ground view: the strategic, tilted and angled views see the whole board
    scene.fog.near = 400 - 310 * near; scene.fog.far = 600 - 380 * near;
    renderer.render(scene, camera);
  }
  const tileAt = (clientX, clientY) => tileOfGround(cam.groundAt(clientX, clientY), view().me);
  // the tile a touch there picks (a squad's model in front of the ground wins, see pick()), for checks
  const pickAt = (clientX, clientY) => pick(cam.groundAt(clientX, clientY), clientX, clientY);
  // where the middle of a tile (model column / row), h metres above the ground, is on the screen: [clientX, clientY]
  const scrV = new THREE.Vector3();
  function screenAt(col, row, h = 0) {
    const f = view().me === 1 ? -1 : 1, w = Game.tileToWorld(col, row), r = renderer.domElement.getBoundingClientRect();
    scrV.set(w.x * f, h, -w.y * f).project(camera);
    return [r.left + (scrV.x + 1) / 2 * r.width, r.top + (1 - scrV.y) / 2 * r.height];
  }
  const QUALITY = { high: [2, true], medium: [1.5, true], low: [1, false] };
  function quality(q) {
    const [ratio, shadows] = QUALITY[q] || QUALITY.high;
    renderer.setPixelRatio(Math.min(ratio, window.devicePixelRatio || 1));
    sun.castShadow = shadows;
    sizeTo();
  }
  // for checks: what the last frame drew of each body (its unit's name, kind, shape and colour, side, look, coat of
  // arms and its edge, whether it got markers)
  const drawn = () => bodies.map(s => ({ name: s.u.name || null, kind: s.u.kind || null, shape: s.u.shape || null, color: s.u.color || null,
    side: s.side, look: s.look, crest: s.crest || null, edge: s.edge || null, structure: !!s.u.structure, building: s.u.building || null, spire: !!s.u.spire, aloft: !!s.u.aloft, marked: !!s.marked }));
  function dispose() {
    cam.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return { size: sizeTo, draw, tileAt, thumb: (match) => floor2d.thumb(match), camera: cam, info: () => renderer.info.render,
    still: () => !cam.busy(), quality, pixelRatio: () => renderer.getPixelRatio(), dispose, drawn, screenAt, pickAt };
};
