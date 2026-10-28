// ===== 3D board scenery: the land around the board (trees, bushes, rocks) and small dressing on it (grass, flowers) =====
// Scenery3D(THREE, scene, opts) loads models/scenery.bin (built by tools/scenery/build-scenery.js from the Quaternius
// Stylized Nature MegaKit, CC0) or, in a build that inlined it, window.PB_SCENERY (base64), and lays the models out once
// per map and side: instanced, one mesh per model part, so the whole scenery costs a few dozen draw calls.
// Purely visual: nothing here touches the game, and it is placed with its own seeded random numbers, so both players
// see the same land (each from their own side: the world always has your side toward +z).
// opts.onReady(): the models have loaded (the page draws a frame). opts.url: where scenery.bin is.
// Calls: update(v, groundY, BW, BD, T): lay out the scenery for this view's map and side (cheap when nothing changed);
// biome(v) -> the look for this map { sky, land } (colours); shadows(on); dispose().
// The floor itself (the meadow under the zones) is painted by meadow() below, through the 2D renderer's ground hook.
const Scenery3D = (THREE, scene, opts = {}) => {
  // ---------- looks per map: the colour of the sky and the land around the board, what grows there ----------
  // trees: which tree models; tint: a colour every model is multiplied by (1 = as painted); grow: how much of the
  // space round the board gets something (0 to 1); dress: small plants on the board itself.
  const BIOMES = {
    meadow: { sky: '#AFC2C0', land: '#778C5C', tint: [1, 1, 1], trees: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'Pine_1', 'Pine_3'], grow: 1, dress: 1 },
    forest: { sky: '#1D2B22', land: '#16271B', tint: [0.55, 0.68, 0.58], trees: ['CommonTree_1', 'CommonTree_2', 'CommonTree_4', 'Pine_1', 'Pine_2', 'Pine_3', 'TwistedTree_1'], grow: 1.25, dress: 0 },
    ice: { sky: '#26323A', land: '#1C2830', tint: [0.62, 0.72, 0.82], low: 'rocks', trees: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_5', 'DeadTree_1', 'DeadTree_3'], grow: 0.8, dress: 0 },
    cavern: { sky: '#120E17', land: '#17121D', tint: [0.42, 0.36, 0.5], low: 'rocks', trees: [], grow: 0.7, dress: 0 },
  };
  const biomeOf = (id) => BIOMES[id] || BIOMES.meadow;
  const biome = (v) => { const src = v && (v.battlePre || v.m), mp = src && Game.mapOf(src); return biomeOf(mp && mp.id); };

  // ---------- loading ----------
  const FOLIAGE = /Leaves|Leaf|Grass|Flowers/;
  let lib = null; // name -> { h, r, parts: [{ geo, mat }] }
  const mats = [];
  const meshes = [];
  async function load() {
    let buf;
    if (window.PB_SCENERY) { const s = atob(window.PB_SCENERY); buf = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i); buf = buf.buffer; }
    else buf = await (await fetch(opts.url || 'models/scenery.bin')).arrayBuffer();
    const dv = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'PBSC') throw new Error('scenery.bin: not a scenery file');
    const hl = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    const base = 8 + hl + ((4 - ((8 + hl) % 4)) % 4);
    const texs = await Promise.all(head.tex.map(async (t) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(buf, base + t.off, t.len)], { type: 'image/webp' }));
      const tx = new THREE.Texture(bmp); tx.colorSpace = THREE.SRGBColorSpace; tx.flipY = false; tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
      tx.anisotropy = 4; tx.needsUpdate = true;
      const mat = new THREE.MeshLambertMaterial({ map: tx, side: THREE.DoubleSide, alphaTest: t.alpha ? 0.45 : 0 });
      // leaves and blades are lit the same on both faces (three.js turns a back face's normal around, which leaves it black)
      // and every colour is pulled a quarter of the way to grey: dusty, as the art direction asks
      const leafy = FOLIAGE.test(t.name);
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), 0.25);');
        if (leafy) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
      };
      mat.customProgramCacheKey = () => leafy ? 'pb-leaf' : 'pb-scenery';
      mats.push(mat); return mat;
    }));
    lib = {};
    for (const [name, md] of Object.entries(head.models)) {
      lib[name] = { h: md.h, r: md.r, parts: md.parts.map((p) => {
        const geo = new THREE.BufferGeometry();
        const qp = new Int16Array(buf, base + p.pos, p.n * 3), pos = new Float32Array(p.n * 3);
        for (let i = 0; i < pos.length; i++) { const d = i % 3; pos[i] = p.plo[d] + (qp[i] + 32767) / 65534 * (p.phi[d] - p.plo[d]); }
        const qu = new Uint16Array(buf, base + p.uv, p.n * 2), uv = new Float32Array(p.n * 2);
        for (let i = 0; i < uv.length; i++) { const d = i % 2; uv[i] = p.ulo[d] + qu[i] / 65535 * (p.uhi[d] - p.ulo[d]); }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const nrm = new Int8Array(buf, base + p.nrm, p.n * 4).slice();
        if (FOLIAGE.test(head.tex[p.tex].name)) for (let i = 0; i < nrm.length; i += 4) { // leaves and blades: normals bent up, so their backs aren't black
          const x = nrm[i] * 0.35, y = nrm[i + 1] * 0.35 + 127, z = nrm[i + 2] * 0.35, l = Math.hypot(x, y, z) / 127;
          nrm[i] = x / l; nrm[i + 1] = y / l; nrm[i + 2] = z / l;
        }
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 4, true));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, base + p.idx, p.ni).slice(), 1));
        geo.computeBoundingSphere();
        return { geo, mat: texs[p.tex] };
      }) };
    }
  }
  const ready = load().then(() => { key = ''; opts.onReady && opts.onReady(); }).catch((e) => console.warn('No Mans Land: no 3D scenery', e));

  // ---------- layout ----------
  let key = null, castShadows = true;
  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), upY = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();
  function clear() { for (const m of meshes) { scene.remove(m); m.dispose(); } meshes.length = 0; }
  // what goes where. Each pick is [model, weight]; scale is [lo, hi].
  const LOW = [['Bush_Common_Flowers', 3], ['Fern_1', 2], ['Rock_Medium_1', 0.6], ['Rock_Medium_2', 0.6], ['Rock_Medium_3', 0.6], ['Plant_1_Big', 1.5], ['Grass_Wispy_Short', 2], ['Grass_Common_Tall', 3]];
  const TUFT = [['Grass_Common_Short', 6], ['Grass_Wispy_Short', 4], ['Grass_Common_Tall', 2], ['Clover_1', 2], ['Flower_3_Group', 1], ['Flower_4_Group', 1], ['Pebble_Round_1', 1], ['Pebble_Round_2', 1], ['Mushroom_Common', 0.5]];
  const DRESS = [['Grass_Common_Short', 6], ['Grass_Wispy_Short', 3], ['Clover_1', 2], ['Flower_3_Group', 1], ['Pebble_Round_1', 1.5], ['Pebble_Round_2', 1.5], ['Pebble_Square_2', 1]];
  const PEBBLES = [['Pebble_Round_1', 1], ['Pebble_Round_2', 1], ['Pebble_Square_2', 1], ['Mushroom_Common', 0.3]];
  const ROCKS = [['Rock_Medium_1', 1], ['Rock_Medium_2', 1], ['Rock_Medium_3', 1], ['Pebble_Square_2', 0.5]];
  function update(v, groundY, BW, BD, T) {
    if (!lib || !v || !v.m) return;
    const src = v.battlePre || v.m, mp = Game.mapOf(src), id = (mp && mp.id) || 'standard';
    const k = [id, v.me, Game.COLS, Game.ROWS, castShadows].join('|');
    if (k === key) return;
    key = k; clear();
    const bi = biomeOf(id), hF = v.me === 1 ? -1 : 1;
    // seeded per map, not per side: both players get the same land, each seeing it from their own end
    let sd = 0; for (const ch of id) sd = (sd * 31 + ch.charCodeAt(0)) % 2147483647; sd = sd || 7;
    const rr = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const pickOf = (list) => { let s = 0; for (const [, w] of list) s += w; let x = rr() * s; for (const [n, w] of list) { if ((x -= w) <= 0) return n; } return list[0][0]; };
    const hw = BW / 2, hd = BD / 2;
    // model (+ '~' when too far out for its shadow to reach the board) -> [[x, y, z, ang, s, shade]]
    const placed = new Map();
    const put = (name, x, z, s, y = 0) => { if (!lib[name]) return; const k = name + (outside(x, z) > 16 ? '~' : ''); (placed.get(k) || placed.set(k, []).get(k)).push([x, y, z, rr() * Math.PI * 2, s, 0.85 + rr() * 0.3]); };
    const low = () => bi.low === 'rocks' ? pickOf(ROCKS) : pickOf(LOW), tuft = () => bi.low === 'rocks' ? pickOf(PEBBLES) : pickOf(TUFT);
    const outside = (x, z) => Math.max(Math.abs(x) - hw, Math.abs(z) - hd, 0) > 0 ? Math.hypot(Math.max(0, Math.abs(x) - hw), Math.max(0, Math.abs(z) - hd)) : 0;
    // 1. the edge: a frame of bushes, rocks and tall grass hugging the board, so its edge doesn't end in a hard line
    for (let s = 0; s < 2 * (BW + BD); s += 2.6) {
      if (rr() > 0.8 * bi.grow) continue;
      let x, z; const off = 0.8 + rr() * 2.8;
      if (s < BW) { x = -hw + s; z = -hd - off; } else if (s < BW + BD) { x = hw + off; z = -hd + (s - BW); }
      else if (s < 2 * BW + BD) { x = hw - (s - BW - BD); z = hd + off; } else { x = -hw - off; z = hd - (s - 2 * BW - BD); }
      const near = z > hd; // your end: keep it low so it never hides your own squads from the angled view
      put(low(), x, z, (near ? 0.8 : 1) * (1 + rr() * 0.8));
    }
    // 2. the land around: trees thicken with distance; your end gets only low things (the angled view looks over it)
    const CELL = 9.5; // trees are the heavy part (about 4000 triangles each): a tree at most every 9 m
    for (let gx = -hw - 50; gx < hw + 50; gx += CELL) for (let gz = -hd - 70; gz < hd + 40; gz += CELL) {
      const x = gx + rr() * CELL, z = gz + rr() * CELL, d = outside(x, z);
      if (d < 4) continue;
      const behindMe = z > hd - 4 && Math.abs(x) < hw + 14;
      if (behindMe) { if (d < 22 && rr() < 0.35 * bi.grow) put(low(), x, z, 0.9 + rr() * 0.8); continue; }
      const p = Math.min(1, (d - 3) / 10) * 0.8 * bi.grow;
      if (rr() > p) { if (d < 16 && rr() < 0.6) put(low(), x, z, 0.9 + rr() * 0.9); continue; }
      if (!bi.trees.length || rr() < 0.12) { put(pickOf(ROCKS), x, z, 1.6 + rr() * 2.2); continue; } // a boulder now and then
      put(bi.trees[Math.floor(rr() * bi.trees.length)], x, z, 1.6 + rr() * 0.9);
      if (rr() < 0.5) put(low(), x + (rr() - 0.5) * 4, z + (rr() - 0.5) * 4, 0.9 + rr() * 0.6); // undergrowth
    }
    // 3. grass round the board's edge, out in the open land
    for (let n = 0; n < 300 * bi.grow; n++) {
      const x = (rr() * 2 - 1) * (hw + 24), z = (rr() * 2 - 1) * (hd + 24), d = outside(x, z);
      if (d > 0.3 && d < 22) put(tuft(), x, z, 1.1 + rr() * 0.9);
    }
    // 4. on the board: a light dressing of small plants (not on walls or water), low enough to stay out of the way
    if (bi.dress) {
      const n = Math.round(Game.COLS * Game.ROWS * 1.2 * bi.dress);
      for (let i = 0; i < n; i++) {
        const x = (rr() - 0.5) * BW, z = (rr() - 0.5) * BD;
        const c = Math.floor((x + hw) / T), r = Math.floor((z + hd) / T);
        const col = hF === 1 ? c : Game.COLS - 1 - c, row = hF === 1 ? r : Game.ROWS - 1 - r;
        const tl = mp && mp.terrain ? Game.terrainTile(src, col, row) : null;
        if (tl && '#~s'.includes(tl.ch)) continue;
        put(pickOf(DRESS), x, z, 0.55 + rr() * 0.45, groundY(x, z));
      }
    }
    // the meshes: one per model part, holding every placement of that model
    for (const [k, list] of placed) {
      const md = lib[k.replace('~', '')], tall = md.h > 3 && !k.endsWith('~');
      for (const part of md.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach(([x, y, z, ang, s, sh], i) => {
          tmpP.set(x, y, z); tmpQ.setFromAxisAngle(upY, ang); tmpS.set(s, s * (0.9 + (sh - 0.85) * 0.6), s);
          im.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
          im.setColorAt(i, tmpC.setRGB(bi.tint[0] * sh, bi.tint[1] * sh, bi.tint[2] * sh));
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = castShadows && tall; im.receiveShadow = false;
        im.computeBoundingSphere(); im.raycast = () => {}; // scenery never takes a touch
        scene.add(im); meshes.push(im);
      }
    }
  }
  function shadows(on) { if (on !== castShadows) { castShadows = on; key = ''; } }
  function dispose() { clear(); for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); } if (lib) for (const md of Object.values(lib)) for (const p of md.parts) p.geo.dispose(); }
  return { _lib: () => lib, update, biome, shadows, dispose, ready, count: () => meshes.reduce((s, m) => s + m.count, 0) };
};

// The meadow floor under the zones, for maps that have no painted ground of their own (the 3D board only): dusty
// greens with darker and lighter patches, and trampled earth across no man's land. Cached per size.
Scenery3D.meadow = (() => {
  let cache = null;
  return (ctx, W, H, t) => {
    const key = W + 'x' + H + ':' + Game.ROWS + ':' + Game.ZONE;
    if (!cache || cache.key !== key) {
      const oc = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
      oc.width = Math.round(W * dpr); oc.height = Math.round(H * dpr);
      const c = oc.getContext('2d'); c.scale(dpr, dpr);
      let sd = 99991; const rr = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
      c.fillStyle = '#71875A'; c.fillRect(0, 0, W, H);
      const blob = (x, y, rx, ry, col, a) => { const g = c.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); g.addColorStop(0, col); g.addColorStop(1, col + '00');
        c.globalAlpha = a; c.fillStyle = g; c.beginPath(); c.ellipse(x, y, rx, ry, rr() * 3, 0, Math.PI * 2); c.fill(); };
      for (let k = 0; k < 70; k++) blob(rr() * W, rr() * H, t * (0.8 + rr() * 2.2), t * (0.6 + rr() * 1.6), ['#7E9563', '#657D51', '#869A66', '#5F7650'][k % 4], 0.55);
      // no man's land: trampled, earthy
      const y0 = Game.ZONE * t, y1 = (Game.ROWS - Game.ZONE) * t;
      for (let k = 0; k < 55; k++) blob(rr() * W, y0 + rr() * (y1 - y0), t * (0.6 + rr() * 1.5), t * (0.4 + rr() * 0.8), ['#8E8160', '#7F7556', '#97896A'][k % 3], 0.5);
      // painted grass strokes
      c.lineCap = 'round';
      for (let k = 0; k < W * H / (t * t) * 14; k++) {
        const x = rr() * W, y = rr() * H, l = t * (0.06 + rr() * 0.1);
        c.globalAlpha = 0.25 + rr() * 0.25; c.strokeStyle = rr() < 0.5 ? '#8DA36E' : '#566C47'; c.lineWidth = 0.8 + rr() * 0.8;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rr() - 0.5) * l * 0.6, y - l); c.stroke();
      }
      c.globalAlpha = 1;
      cache = { key, cv: oc };
    }
    ctx.drawImage(cache.cv, 0, 0, W, H);
    return true;
  };
})();
