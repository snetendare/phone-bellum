// ===== 3D board scenery: the land around the board (trees, bushes, rocks) and small dressing on it (grass, flowers) =====
// Scenery3D(THREE, scene, opts) loads models/scenery.bin (built by tools/scenery/build-scenery.js from the Quaternius
// Stylized Nature MegaKit, CC0) or, in a build that inlined it, window.PB_SCENERY (base64), and lays the models out once
// per map and side: instanced, one mesh per model part, so the whole scenery costs a few dozen draw calls.
// Purely visual: nothing here touches the game, and it is placed with its own seeded random numbers, so both players
// see the same land (each from their own side: the world always has your side toward +z).
// opts.onReady(): the models have loaded (the page draws a frame). opts.url: where scenery.bin is. opts.renderer: the
// WebGLRenderer, for baking the impostors.
// Keeping it cheap (a phone draws the whole scenery for well under 200 000 triangles): only trees and bushes near the
// board are real models (they cast real shadows onto it); everything further out is an impostor, a flat card facing
// the camera with a picture of that model, baked once at load from three heights (8°, 40° and straight down) and
// blended by the angle the camera sees it from, with a soft round shadow on the ground under it.
// Calls: update(v, groundY, BW, BD, T): lay out the scenery for this view's map and side (cheap when nothing changed);
// biome(v) -> the look for this map { sky, land } (colours); shadows(on); dispose().
// The floor itself (the meadow under the zones) is painted by meadow() below, through the 2D renderer's ground hook.
const Scenery3D = (THREE, scene, opts = {}) => {
  // ---------- looks per map: the colour of the sky and the land around the board, what grows there ----------
  // trees: which tree models; tint: a colour every model is multiplied by (1 = as painted); grow: how much of the
  // space round the board gets something (0 to 1); dress: small plants on the board itself.
  const BIOMES = {
    meadow: { sky: '#A3B6B4', land: '#64764D', tint: [1, 1, 1], trees: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'Pine_1', 'Pine_3'], grow: 1.2, dress: 1 },
    forest: { sky: '#1D2B22', land: '#16271B', tint: [0.55, 0.68, 0.58], trees: ['CommonTree_1', 'CommonTree_2', 'CommonTree_4', 'Pine_1', 'Pine_2', 'Pine_3', 'TwistedTree_1'], grow: 1.25, dress: 0 },
    ice: { sky: '#26323A', land: '#1C2830', tint: [0.62, 0.72, 0.82], low: 'rocks', trees: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_5', 'DeadTree_1', 'DeadTree_3'], grow: 0.8, dress: 0 },
    cavern: { sky: '#120E17', land: '#17121D', tint: [0.42, 0.36, 0.5], low: 'rocks', trees: [], grow: 0.7, dress: 0 },
  };
  BIOMES.testgrid = BIOMES.ice; // the Test Grid has Frozen Peak's look (its floor too: Render3D's floorAs)
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
  const ready = load().then(() => { if (opts.renderer) bake(opts.renderer); key = ''; opts.onReady && opts.onReady(); }).catch((e) => console.warn('No Mans Land: no 3D scenery', e));

  // ---------- impostors: pictures of the far trees and bushes, baked into one atlas ----------
  const ELEV = [8, 40, 90], ICELL = 256, IGRID = 8; // views per model, cell size in pixels, cells per atlas row
  let atlas = null, impIndex = null, impMat = null, impGeo = null, blobMat = null, blobGeo = null;
  function bake(renderer) {
    const names = Object.keys(lib).filter((n) => lib[n].h > 2.5 || /^Bush/.test(n));
    impIndex = {};
    const rows = Math.ceil(names.length * ELEV.length / IGRID);
    atlas = new THREE.WebGLRenderTarget(IGRID * ICELL, rows * ICELL, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const bs = new THREE.Scene();
    bs.add(new THREE.HemisphereLight('#cfe3ff', '#20262a', 1.6));
    const lamp = new THREE.DirectionalLight('#fff3dc', 2.0); bs.add(lamp); bs.add(lamp.target);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
    names.forEach((name, mi) => {
      const md = lib[name], rad = Math.max(md.r, 0.3);
      const S = 1.06 * Math.max(md.h, 2 * rad, md.h * Math.cos(0.7) + 2 * rad * Math.sin(0.7)); // the picture's side (m)
      impIndex[name] = { i: mi, S };
      const group = new THREE.Group(); for (const p of md.parts) group.add(new THREE.Mesh(p.geo, p.mat)); bs.add(group);
      ELEV.forEach((e, vi) => {
        const c = mi * ELEV.length + vi, a = e * Math.PI / 180;
        Object.assign(cam, { left: -S / 2, right: S / 2, top: S / 2, bottom: -S / 2 }); cam.updateProjectionMatrix();
        cam.up.set(0, e === 90 ? 0 : 1, e === 90 ? -1 : 0);
        cam.position.set(0, md.h / 2 + Math.sin(a) * 150, Math.cos(a) * 150); cam.lookAt(0, md.h / 2, 0);
        lamp.position.set(-40, 80, 60); // light from up front-left, as the board's sun
        atlas.viewport.set((c % IGRID) * ICELL, Math.floor(c / IGRID) * ICELL, ICELL, ICELL); atlas.scissor.copy(atlas.viewport); atlas.scissorTest = true;
        renderer.setRenderTarget(atlas); renderer.clear(); renderer.render(bs, cam);
      });
      bs.remove(group);
    });
    renderer.setRenderTarget(prevTarget); renderer.autoClear = prevAuto; renderer.setClearColor(prevCol, prevA);
    impGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    impMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uGrid: { value: new THREE.Vector2(IGRID, rows) } }]),
      fog: true,
      vertexShader: `
        attribute vec3 iPos; attribute float iSize; attribute float iModel; attribute vec3 iTint; attribute float iFlip;
        uniform vec2 uGrid;
        varying vec2 vUv0; varying vec2 vUv1; varying float vMix; varying vec3 vTint;
        #include <fog_pars_vertex>
        vec2 cellUv(float c, vec2 uv) { return (vec2(mod(c, uGrid.x), floor(c / uGrid.x)) + uv) / uGrid; }
        void main() {
          vec3 toCam = normalize(cameraPosition - iPos);
          float elev = degrees(asin(clamp(toCam.y, -1.0, 1.0)));
          float i0 = elev < 40.0 ? 0.0 : 1.0;
          vMix = elev < 40.0 ? clamp((elev - 8.0) / 32.0, 0.0, 1.0) : clamp((elev - 40.0) / 50.0, 0.0, 1.0);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = iPos + (right * position.x + up * position.y) * iSize;
          vec2 uv = vec2(position.x * iFlip + 0.5, position.y + 0.5);
          float c0 = iModel * 3.0 + i0;
          vUv0 = cellUv(c0, uv); vUv1 = cellUv(c0 + 1.0, uv); vTint = iTint;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas;
        varying vec2 vUv0; varying vec2 vUv1; varying float vMix; varying vec3 vTint;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = mix(texture2D(uAtlas, vUv0), texture2D(uAtlas, vUv1), vMix);
          if (c.a < 0.4) discard;
          gl_FragColor = vec4(c.rgb / c.a * vTint, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    impMat.uniforms.uAtlas.value = atlas.texture;
    // a soft round shadow, for the ground under an impostor
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const g = sc.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), color: '#1A2414', transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }
  // the impostors and their shadows for one layout: list of [name, x, y, z, s, shade, flip]
  function impostors(list, tint) {
    const n = list.length; if (!n || !impMat) return;
    const geo = impGeo.clone(); geo.instanceCount = n;
    const P = new Float32Array(n * 3), Z = new Float32Array(n), M = new Float32Array(n), C = new Float32Array(n * 3), F = new Float32Array(n);
    const blobs = new THREE.InstancedMesh(blobGeo, blobMat, n);
    list.forEach(([name, x, y, z, s, sh, flip], i) => {
      const md = lib[name], im = impIndex[name];
      P.set([x, y + md.h * s / 2, z], i * 3); Z[i] = im.S * s; M[i] = im.i; F[i] = flip;
      C.set([tint[0] * sh, tint[1] * sh, tint[2] * sh], i * 3);
      const b = Math.max(1.5, md.r * s * 1.6);
      blobs.setMatrixAt(i, tmpM.compose(tmpP.set(x + b * 0.15, y + 0.02, z + b * 0.1), tmpQ.identity(), tmpS.set(b, 1, b)));
    });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(P, 3)); geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(Z, 1));
    geo.setAttribute('iModel', new THREE.InstancedBufferAttribute(M, 1)); geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(C, 3));
    geo.setAttribute('iFlip', new THREE.InstancedBufferAttribute(F, 1));
    const mesh = new THREE.Mesh(geo, impMat); mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.name = 'impostors'; mesh.count = n;
    blobs.instanceMatrix.needsUpdate = true; blobs.computeBoundingSphere(); blobs.raycast = () => {}; blobs.name = 'blobs';
    scene.add(mesh, blobs); meshes.push(mesh, blobs);
  }

  // ---------- layout ----------
  let key = null, castShadows = true;
  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), upY = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();
  function clear() { for (const m of meshes) { scene.remove(m); if (m.isInstancedMesh) m.dispose(); else m.geometry.dispose(); } meshes.length = 0; }
  // what goes where. Each pick is [model, weight]; scale is [lo, hi].
  const LOW = [['Bush_Common_Flowers', 1.2], ['Fern_1', 2.5], ['Rock_Medium_1', 0.6], ['Rock_Medium_2', 0.6], ['Rock_Medium_3', 0.6], ['Plant_1_Big', 1.5], ['Grass_Wispy_Short', 1], ['Grass_Common_Tall', 3]];
  const TUFT = [['Grass_Common_Short', 7], ['Grass_Wispy_Short', 1], ['Grass_Common_Tall', 2], ['Clover_1', 2], ['Flower_3_Group', 1], ['Pebble_Round_1', 1], ['Pebble_Round_2', 1], ['Mushroom_Common', 0.5]];
  const DRESS = [['Grass_Common_Short', 7], ['Grass_Wispy_Short', 1], ['Clover_1', 1], ['Flower_3_Group', 1], ['Pebble_Round_1', 1.5], ['Pebble_Round_2', 1.5], ['Pebble_Square_2', 1]];
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
    // model (+ '~' when far out: no shadow, an impostor if it has one; bushes from 6 m) -> [[x, y, z, ang, s, shade]]
    const placed = new Map();
    const put = (name, x, z, s, y = 0) => { if (!lib[name]) return; const d = outside(x, z), k = name + (d > 16 || (d > 6 && /^Bush/.test(name)) ? '~' : ''); (placed.get(k) || placed.set(k, []).get(k)).push([x, y, z, rr() * Math.PI * 2, s, 0.85 + rr() * 0.3]); };
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
    const CELL = 8; // a tree at most every 8 m (near the board a real model of about 4000 triangles, further out an impostor)
    for (let gx = -hw - 50; gx < hw + 50; gx += CELL) for (let gz = -hd - 70; gz < hd + 40; gz += CELL) {
      const x = gx + rr() * CELL, z = gz + rr() * CELL, d = outside(x, z);
      if (d < 4) continue;
      const nearBoard = d < 16; // real models here: keep them fewer
      const behindMe = z > hd - 4 && Math.abs(x) < hw + 14;
      if (behindMe) { if (d < 22 && rr() < 0.35 * bi.grow) put(low(), x, z, 0.9 + rr() * 0.8); continue; }
      const p = Math.min(1, (d - 3) / 10) * (nearBoard ? 0.55 : 0.85) * bi.grow;
      if (rr() > p) { if (d < 16 && rr() < 0.6) put(low(), x, z, 0.9 + rr() * 0.9); continue; }
      if (!bi.trees.length || rr() < 0.12) { put(pickOf(ROCKS), x, z, 1.6 + rr() * 2.2); continue; } // a boulder now and then
      let tree = bi.trees[Math.floor(rr() * bi.trees.length)];
      if (nearBoard && /^Twisted/.test(tree)) tree = bi.trees[0]; // the big twisted trees (9000 triangles) only stand far out, as impostors
      put(tree, x, z, 1.6 + rr() * 0.9);
      if (nearBoard && rr() < 0.5) put(low(), x + (rr() - 0.5) * 4, z + (rr() - 0.5) * 4, 0.9 + rr() * 0.6); // undergrowth
    }
    // 3. grass round the board's edge, out in the open land
    for (let n = 0; n < 220 * bi.grow; n++) {
      const x = (rr() * 2 - 1) * (hw + 24), z = (rr() * 2 - 1) * (hd + 24), d = outside(x, z);
      if (d > 0.3 && d < 14) put(tuft(), x, z, 1.1 + rr() * 0.9);
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
    // far trees and bushes: impostors
    const far = [];
    for (const [k, list] of [...placed]) {
      const name = k.replace('~', '');
      if (!k.endsWith('~') || !impIndex || !impIndex[name]) continue;
      for (const [x, y, z, ang, s, sh] of list) far.push([name, x, y, z, s, sh, ang < Math.PI ? 1 : -1]);
      placed.delete(k);
    }
    impostors(far, bi.tint);
    // the rest: one mesh per model part, holding every placement of that model
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
        im.name = k; scene.add(im); meshes.push(im);
      }
    }
  }
  function shadows(on) { if (on !== castShadows) { castShadows = on; key = ''; } }
  function dispose() { clear(); if (atlas) { atlas.dispose(); impMat.dispose(); impGeo.dispose(); blobMat.map.dispose(); blobMat.dispose(); blobGeo.dispose(); } for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); } if (lib) for (const md of Object.values(lib)) for (const p of md.parts) p.geo.dispose(); }
  return { _lib: () => lib, _meshes: () => meshes, update, biome, shadows, dispose, ready, count: () => meshes.reduce((s, m) => s + m.count, 0) };
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
      c.fillStyle = '#5F714C'; c.fillRect(0, 0, W, H);
      const blob = (x, y, rx, ry, col, a) => { const g = c.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); g.addColorStop(0, col); g.addColorStop(1, col + '00');
        c.globalAlpha = a; c.fillStyle = g; c.beginPath(); c.ellipse(x, y, rx, ry, rr() * 3, 0, Math.PI * 2); c.fill(); };
      for (let k = 0; k < 70; k++) blob(rr() * W, rr() * H, t * (0.8 + rr() * 2.2), t * (0.6 + rr() * 1.6), ['#6A7D53', '#556944', '#718156', '#506343'][k % 4], 0.55);
      // no man's land: trampled, earthy
      const y0 = Game.ZONE * t, y1 = (Game.ROWS - Game.ZONE) * t;
      for (let k = 0; k < 55; k++) blob(rr() * W, y0 + rr() * (y1 - y0), t * (0.6 + rr() * 1.5), t * (0.4 + rr() * 0.8), ['#776C51', '#6B6248', '#7F7359'][k % 3], 0.5);
      // painted grass strokes
      c.lineCap = 'round';
      for (let k = 0; k < W * H / (t * t) * 14; k++) {
        const x = rr() * W, y = rr() * H, l = t * (0.06 + rr() * 0.1);
        c.globalAlpha = 0.25 + rr() * 0.25; c.strokeStyle = rr() < 0.5 ? '#76895C' : '#485B3C'; c.lineWidth = 0.8 + rr() * 0.8;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rr() - 0.5) * l * 0.6, y - l); c.stroke();
      }
      c.globalAlpha = 1;
      cache = { key, cv: oc };
    }
    ctx.drawImage(cache.cv, 0, 0, W, H);
    return true;
  };
})();
