// Builds models/scenery.bin, the 3D board's scenery (trees, bushes, rocks, grass, flowers), from the
// Quaternius "Stylized Nature MegaKit" (CC0) glTF files, plus the palm trees of Quaternius' "Ultimate Stylized Nature"
// (CC0; its OBJ files with their textures from its glTF folder: palms in one folder, maples and birches in another).
//   node tools/scenery/build-scenery.js <MegaKit glTF folder> <palm folder> <autumn folder>
// Needs (in tools/scenery): npm i @gltf-transform/core @gltf-transform/functions meshoptimizer sharp
//
// The file is one binary: 'PBSC', a u32 header length, the header (JSON), then the data, each piece 4-byte aligned.
// header = { tex: [{ name, off, len, alpha }], models: { name: { h, r, parts: [{ tex, n, ni, pos, nrm, uv, idx }] } } }
// pos Int16 x3 over the part's box (plo..phi), nrm Int8 x4 (normalized, the 4th unused), uv Uint16 x2 over ulo..uhi,
// idx Uint16. Offsets count from the start of the data (after the header and its padding). Each model stands on y = 0,
// its node transforms baked in. Textures are WebP (alpha-masked ones keep alpha), normal maps dropped.
const path = require('path'), fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { weld, simplify, dedup } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');
const sharp = require('sharp');

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node build-scenery.js <MegaKit glTF folder>'); process.exit(1); }
const OBJS = [[process.argv[3], [1, 2, 3, 4, 5].map((k) => 'PalmTree_' + k)],
  [process.argv[4], ['MapleTree_1', 'MapleTree_2', 'MapleTree_4', 'MapleTree_5', 'BirchTree_1', 'BirchTree_4', 'BirchTree_5']]];
const OUT = path.join(__dirname, '..', '..', 'models', 'scenery.bin');
// models made from another one with a different texture: name -> [model, texture name, texture file (from the MegaKit)]
const RETEX = {
  DesertRock_1: ['Rock_Medium_1', 'Rocks_Desert', '../Textures/Rocks_Desert_Diffuse.png'],
  DesertRock_2: ['Rock_Medium_2', 'Rocks_Desert', '../Textures/Rocks_Desert_Diffuse.png'],
  DesertRock_3: ['Rock_Medium_3', 'Rocks_Desert', '../Textures/Rocks_Desert_Diffuse.png'],
};
// OBJ material -> [texture file, alpha-masked]
const OBJ_TEX = { PalmTree_Leaves: ['PalmTree_Leaves.png', true], PalmTree_Trunk: ['PalmTree_Trunk.jpg', false],
  MapleTree_Leaves: ['MapleTree_Leaves.png', true], MapleTree_Bark: ['MapleTree_Bark.jpg', false], BirchTree_Leaves: ['BirchTree_Leaves.png', true], BirchTree_Bark: ['BirchTree_Bark.jpg', false] };
// a small OBJ reader: groups by material, uv v flipped to glTF's (top-down) convention
function readObj(file) {
  const V = [], T = [], N = [], groups = new Map(); let g = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const a = line.trim().split(/\s+/);
    if (a[0] === 'v') V.push(a.slice(1, 4).map(Number)); else if (a[0] === 'vt') T.push([+a[1], 1 - +a[2]]); else if (a[0] === 'vn') N.push(a.slice(1, 4).map(Number));
    else if (a[0] === 'usemtl') { g = groups.get(a[1]) || { pos: [], nrm: [], uv: [], idx: [], keys: new Map() }; groups.set(a[1], g); }
    else if (a[0] === 'f') {
      const ids = a.slice(1).map((c) => { let k = g.keys.get(c); if (k === undefined) { const [vi, ti, ni] = c.split('/').map((x) => +x - 1); k = g.pos.length / 3; g.keys.set(c, k);
        g.pos.push(...V[vi]); g.uv.push(...(T[ti] || [0, 0])); const n = N[ni] || [0, 1, 0]; g.nrm.push(n[0], n[1], n[2]); } return k; });
      for (let i = 2; i < ids.length; i++) g.idx.push(ids[0], ids[i - 1], ids[i]);
    }
  }
  return groups;
}

// model -> how much of its triangles to keep (1 = all). Trees are the heavy ones.
const PICK = {
  CommonTree_1: 0.3, CommonTree_2: 0.3, CommonTree_3: 0.35, CommonTree_4: 0.35, CommonTree_5: 0.4,
  Pine_1: 0.35, Pine_2: 0.35, Pine_3: 0.3, Pine_5: 0.5,
  TwistedTree_1: 0.2,
  DeadTree_1: 0.25, DeadTree_3: 0.25,
  Bush_Common: 0.7, Bush_Common_Flowers: 0.7, Fern_1: 1, Plant_1_Big: 1, Plant_7_Big: 1,
  Grass_Common_Short: 1, Grass_Common_Tall: 1, Grass_Wispy_Short: 1,
  Flower_3_Group: 1, Flower_4_Group: 0.8, Clover_1: 1, Mushroom_Common: 0.8,
  Rock_Medium_1: 1, Rock_Medium_2: 1, Rock_Medium_3: 1,
  Pebble_Round_1: 1, Pebble_Round_2: 1, Pebble_Square_2: 1,
};
// texture -> longest side in pixels
const TEX_SIZE = { Bark_NormalTree: 256, Bark_TwistedTree: 256, Bark_DeadTree: 256, Rocks_Diffuse: 512, Rocks_Desert: 512, Leaves: 512, Flowers: 256, Mushrooms: 256, PalmTree_Leaves: 512, MapleTree_Leaves: 512, BirchTree_Leaves: 512 };

(async () => {
  await MeshoptSimplifier.ready;
  const io = new NodeIO();
  const texIndex = new Map(), tex = [], chunks = [], models = {};
  let off = 0;
  const push = (buf) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } const at = off; chunks.push(Buffer.from(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength)); off += buf.byteLength; return at; };
  const texFiles = [];
  const addTex = (tname, alpha, image) => { if (!texIndex.has(tname)) { texIndex.set(tname, tex.length); tex.push({ name: tname, alpha }); texFiles.push(image); } };
  // one model from its groups: texture name -> { pos, nrm (floats), uv, idx }
  function emit(name, byTex) {
    let minY = Infinity, maxY = -Infinity, r = 0;
    for (const g of byTex.values()) for (let i = 0; i < g.pos.length; i += 3) { minY = Math.min(minY, g.pos[i + 1]); maxY = Math.max(maxY, g.pos[i + 1]); r = Math.max(r, Math.hypot(g.pos[i], g.pos[i + 2])); }
    const parts = [];
    for (const [tname, g] of byTex) {
      const pos = g.pos.slice(); for (let i = 1; i < pos.length; i += 3) pos[i] -= minY; // stand on y = 0
      if (pos.length / 3 > 65535) throw new Error(name + ': too many vertices');
      const nrm = []; for (let i = 0; i < g.nrm.length; i += 3) { const l = Math.hypot(g.nrm[i], g.nrm[i + 1], g.nrm[i + 2]) || 1; nrm.push(Math.round(g.nrm[i] / l * 127), Math.round(g.nrm[i + 1] / l * 127), Math.round(g.nrm[i + 2] / l * 127), 0); }
      // positions as Int16 over the part's box, uvs as Uint16 over their range
      const q = (arr, dim, T, span) => { const lo = [], hi = []; for (let d = 0; d < dim; d++) { lo[d] = Infinity; hi[d] = -Infinity; for (let i = d; i < arr.length; i += dim) { lo[d] = Math.min(lo[d], arr[i]); hi[d] = Math.max(hi[d], arr[i]); } }
        const out = new T(arr.length); for (let i = 0; i < arr.length; i++) { const d = i % dim, w = (hi[d] - lo[d]) || 1; out[i] = Math.round((arr[i] - lo[d]) / w * span) - (T === Int16Array ? 32767 : 0); }
        return { out, lo: lo.map(v => +v.toFixed(5)), hi: hi.map(v => +v.toFixed(5)) }; };
      const qp = q(pos, 3, Int16Array, 65534), qu = q(g.uv, 2, Uint16Array, 65535);
      parts.push({ tex: texIndex.get(tname), n: pos.length / 3, ni: g.idx.length, plo: qp.lo, phi: qp.hi, ulo: qu.lo, uhi: qu.hi,
        pos: push(qp.out), nrm: push(new Int8Array(nrm)), uv: push(qu.out), idx: push(new Uint16Array(g.idx)) });
    }
    models[name] = { h: +(maxY - minY).toFixed(2), r: +r.toFixed(2), parts };
    console.log(name.padEnd(22), parts.reduce((s, p) => s + p.ni / 3, 0), 'tris');
  }
  const groupsOf = {};
  for (const [name, keep] of Object.entries(PICK)) {
    const doc = await io.read(path.join(SRC, name + '.gltf'));
    await doc.transform(dedup(), weld());
    if (keep < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: keep, error: 0.1 }));
    const byTex = new Map(); // texture name -> { pos: [], nrm: [], uv: [], idx: [] }
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh(); if (!mesh) continue;
      const M = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial(), img = mat && mat.getBaseColorTexture();
        const tname = img ? path.basename(img.getURI() || img.getName(), '.png').replace(/_C$/, '') : 'none';
        if (img) addTex(tname, mat.getAlphaMode() === 'MASK' && !/^Bark/.test(tname), img.getImage());
        const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), U = prim.getAttribute('TEXCOORD_0'), I = prim.getIndices();
        const g = byTex.get(tname) || { pos: [], nrm: [], uv: [], idx: [] }; byTex.set(tname, g);
        const base = g.pos.length / 3, p = [0, 0, 0], n = [0, 0, 0];
        for (let i = 0; i < P.getCount(); i++) {
          P.getElement(i, p);
          const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], z = M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14];
          g.pos.push(x, y, z);
          N.getElement(i, n);
          g.nrm.push(M[0] * n[0] + M[4] * n[1] + M[8] * n[2], M[1] * n[0] + M[5] * n[1] + M[9] * n[2], M[2] * n[0] + M[6] * n[1] + M[10] * n[2]);
          const u = U ? U.getElement(i, [0, 0]) : [0, 0]; g.uv.push(u[0], u[1]);
        }
        const idx = I ? I.getArray() : Array.from({ length: P.getCount() }, (_, k) => k);
        for (const k of idx) g.idx.push(base + k);
      }
    }
    groupsOf[name] = byTex; emit(name, byTex);
  }
  // retextured copies (desert rocks)
  for (const [name, [from, tname, file]] of Object.entries(RETEX)) {
    addTex(tname, false, fs.readFileSync(path.join(SRC, file)));
    emit(name, new Map([...groupsOf[from].values()].map((g) => [tname, g])));
  }
  // palms, maples and birches (OBJ)
  for (const [dir, names] of OBJS) if (dir) for (const name of names) {
    const byTex = readObj(path.join(dir, name + '.obj'));
    for (const m of byTex.keys()) addTex(m, OBJ_TEX[m][1], fs.readFileSync(path.join(dir, OBJ_TEX[m][0])));
    emit(name, byTex);
  }
  for (let i = 0; i < tex.length; i++) {
    const t = tex[i], size = TEX_SIZE[t.name] || 256;
    const img = sharp(Buffer.from(texFiles[i])).resize(size, size, { fit: 'inside' });
    const buf = await img.webp(t.alpha ? { quality: 82, alphaQuality: 90 } : { quality: 80 }).toBuffer();
    t.off = push(buf); t.len = buf.length;
    console.log('tex', t.name, size, buf.length);
  }
  const head = Buffer.from(JSON.stringify({ tex, models }));
  const pre = Buffer.alloc(8); pre.write('PBSC', 0); pre.writeUInt32LE(head.length, 4);
  const headPad = Buffer.alloc((4 - ((8 + head.length) % 4)) % 4);
  fs.writeFileSync(OUT, Buffer.concat([pre, head, headPad, ...chunks]));
  console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
})();
