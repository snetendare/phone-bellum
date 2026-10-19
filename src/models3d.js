// ===== Low-poly unit models for the 3D board =====
// Models3D(THREE) -> { kindOf(u), parts(kind), height(kind) }.
// kindOf picks a figure from a unit's stats (rosters are custom, so names can't be relied on): towers (one per tower
// type), the elf spire, airships (aloft), the horse and spider shapes, fliers, then archers / casters for ranged
// units and goblins / brutes / soldiers for melee ones. height(kind): the top of the model, for markers above it.
// parts(kind) gives up to three geometries, drawn as separate instanced meshes so each can be coloured per body:
//   tint  - takes the unit's own colour (its clothes or hide), as the 2D board fills the shape with it
//   team  - takes the side's colour (shields, banners, sashes)
//   fixed - its own colours, from vertex colours (skin, wood, metal)
// Sizes are for a body of radius 1 metre standing on y = 0 and facing -z; the renderer scales them like the 2D board.
const Models3D = (THREE) => {
  const SKIN = '#D9A27A', DARK = '#2B2F33', METAL = '#B8C0C8', WOOD = '#8A5A32', BONE = '#E9E3CF', GLOW = '#FFE9A8';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, n = 6) => new THREE.CylinderGeometry(rt, rb, h, n);
  const cone = (r, h, n = 6) => new THREE.ConeGeometry(r, h, n);
  const ball = (r) => new THREE.IcosahedronGeometry(r, 0);
  // a part: geometry, colour ('tint', 'team' or a hex colour), position, rotation (radians), scale
  const P = (g, col, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0], sc) => {
    g.applyMatrix4(m4.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), sc ? s.set(...sc) : s.set(1, 1, 1)));
    return { g, col };
  };
  // join the parts of one colour into a single flat-shaded geometry
  function merge(list, colored) {
    if (!list.length) return null;
    const pos = [], col = [], c = new THREE.Color();
    for (const { g, col: hex } of list) {
      const a = g.toNonIndexed().getAttribute('position');
      if (colored) c.set(hex);
      for (let i = 0; i < a.count; i++) { pos.push(a.getX(i), a.getY(i), a.getZ(i)); if (colored) col.push(c.r, c.g, c.b); }
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (colored) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.computeVertexNormals();
    out.computeBoundingSphere();
    return out;
  }
  const legs = (h = 0.8, gap = 0.2, w = 0.24) => [P(box(w, h, w), DARK, [-gap, h / 2, 0]), P(box(w, h, w), DARK, [gap, h / 2, 0])];

  const BUILD = {
    // sword and shield
    soldier: () => [...legs(),
      P(cyl(0.34, 0.42, 0.8), 'tint', [0, 1.2, 0]),
      P(ball(0.27), SKIN, [0, 1.85, 0]),
      P(cone(0.32, 0.4), METAL, [0, 2.1, 0]),
      P(box(0.12, 0.85, 0.65), 'team', [-0.55, 1.2, -0.1]),
      P(box(0.08, 1.0, 0.08), METAL, [0.5, 1.45, -0.35], [-0.5, 0, 0]),
      P(box(0.3, 0.06, 0.1), DARK, [0.5, 1.05, -0.12], [-0.5, 0, 0])],
    // hooded, a bow held out in front, a quiver on the back
    archer: () => [...legs(0.75, 0.18, 0.2),
      P(cyl(0.28, 0.36, 0.8), 'tint', [0, 1.15, 0]),
      P(cyl(0.38, 0.38, 0.12, 8), 'team', [0, 1.0, 0]),
      P(ball(0.24), SKIN, [0, 1.75, 0]),
      P(cone(0.3, 0.55), 'tint', [0, 1.95, 0.04]),
      P(new THREE.TorusGeometry(0.55, 0.035, 3, 8, Math.PI), WOOD, [-0.2, 1.35, -0.5], [0, 0, Math.PI / 2]),
      P(cyl(0.1, 0.1, 0.7), WOOD, [0.15, 1.3, 0.38], [0.35, 0, 0])],
    // a long robe, a pointed hat and a staff with a glowing orb
    caster: () => [
      P(cone(0.6, 1.5, 7), 'tint', [0, 0.75, 0]),
      P(ball(0.25), SKIN, [0, 1.6, 0]),
      P(cyl(0.5, 0.5, 0.06, 8), 'team', [0, 1.78, 0]),
      P(cone(0.32, 0.8, 7), 'tint', [0, 2.2, 0.05], [0.15, 0, 0]),
      P(cyl(0.05, 0.05, 2.2, 5), WOOD, [0.55, 1.1, -0.15]),
      P(ball(0.17), GLOW, [0.55, 2.3, -0.15])],
    // small, a big head with pointed ears, a spear and a round shield
    goblin: () => [...legs(0.45, 0.16, 0.18),
      P(cyl(0.28, 0.36, 0.55), 'tint', [0, 0.72, 0]),
      P(ball(0.3), 'tint', [0, 1.25, -0.04]),
      P(cone(0.09, 0.4, 4), 'tint', [-0.32, 1.32, 0], [0, 0, 1.2]),
      P(cone(0.09, 0.4, 4), 'tint', [0.32, 1.32, 0], [0, 0, -1.2]),
      P(cyl(0.3, 0.3, 0.08, 7), 'team', [-0.4, 0.8, -0.05], [0, 0, Math.PI / 2]),
      P(cyl(0.035, 0.035, 1.8, 4), WOOD, [0.4, 0.9, -0.25], [-0.9, 0, 0]),
      P(cone(0.08, 0.25, 4), METAL, [0.4, 1.55, -0.95], [-0.9 - Math.PI, 0, 0])],
    // wide and heavy, thick arms and a club
    brute: () => [...legs(0.7, 0.3, 0.36),
      P(box(1.2, 0.95, 0.75), 'tint', [0, 1.2, 0]),
      P(box(1.25, 0.18, 0.8), 'team', [0, 0.78, 0]),
      P(ball(0.3), SKIN, [0, 1.85, -0.1]),
      P(cyl(0.18, 0.15, 0.9), SKIN, [-0.75, 1.15, 0], [0, 0, 0.25]),
      P(cyl(0.18, 0.15, 0.9), SKIN, [0.75, 1.15, 0], [0.6, 0, -0.2]),
      P(cyl(0.24, 0.1, 1.2, 6), WOOD, [0.85, 1.25, -0.65], [-1.1, 0, 0])],
    // a winged imp or wisp, hovering
    flier: () => [
      P(ball(0.45), 'tint', [0, 1.3, 0]),
      P(cone(0.08, 0.3, 4), DARK, [-0.2, 1.75, -0.05], [0, 0, 0.3]),
      P(cone(0.08, 0.3, 4), DARK, [0.2, 1.75, -0.05], [0, 0, -0.3]),
      P(cone(0.35, 1.1, 3), 'team', [-0.75, 1.4, 0.1], [0, 0, Math.PI / 2 + 0.3], [1, 1, 0.15]),
      P(cone(0.35, 1.1, 3), 'team', [0.75, 1.4, 0.1], [0, 0, -Math.PI / 2 - 0.3], [1, 1, 0.15]),
      P(ball(0.08), GLOW, [-0.15, 1.38, -0.4]), P(ball(0.08), GLOW, [0.15, 1.38, -0.4])],
    horse: () => [
      P(box(0.7, 0.7, 1.6), 'tint', [0, 1.15, 0]),
      P(box(0.74, 0.12, 0.7), 'team', [0, 1.55, 0.05]),
      P(box(0.35, 0.8, 0.4), 'tint', [0, 1.65, -0.85], [0.6, 0, 0]),
      P(box(0.32, 0.32, 0.6), 'tint', [0, 1.95, -1.15], [0.25, 0, 0]),
      ...[[-0.24, -0.6], [0.24, -0.6], [-0.24, 0.6], [0.24, 0.6]].map(([x, z]) => P(box(0.16, 0.85, 0.16), DARK, [x, 0.42, z])),
      P(box(0.12, 0.6, 0.12), DARK, [0, 1.1, 0.9], [-0.5, 0, 0])],
    spider: () => [
      P(ball(0.6), 'tint', [0, 0.7, 0.45], [0, 0, 0], [1, 0.8, 1.1]),
      P(ball(0.38), 'tint', [0, 0.6, -0.35]),
      P(cyl(0.22, 0.22, 0.05, 6), 'team', [0, 1.18, 0.45]),
      P(ball(0.07), GLOW, [-0.12, 0.72, -0.68]), P(ball(0.07), GLOW, [0.12, 0.72, -0.68]),
      ...[-0.55, -0.2, 0.15, 0.5].flatMap((z) => [-1, 1].flatMap((sd) => [
        P(box(0.7, 0.08, 0.08), DARK, [sd * 0.5, 0.82, z - 0.1], [0, sd * z * 0.6, sd * 0.6]),
        P(box(0.08, 0.75, 0.08), DARK, [sd * 0.95, 0.42, z - 0.1], [0, 0, sd * 0.25])]))],
    // the sniper tower's airship: a blimp in the team colour (drawn see-through), fins and a gondola
    airship: () => [
      P(ball(1), 'team', [0, 1.4, 0], [0, 0, 0], [0.75, 0.75, 1.9]),
      P(cone(0.5, 0.9, 3), 'team', [0, 1.4, 1.75], [-Math.PI / 2, 0, 0], [1, 1, 0.2]),
      P(cone(0.5, 0.9, 3), 'team', [0, 1.4, 1.75], [-Math.PI / 2, 0, Math.PI / 2], [1, 1, 0.2]),
      P(box(0.45, 0.3, 0.9), DARK, [0, 0.55, 0])],
    // a thrown spear, flying toward -z: the shaft takes the unit's colour
    spear: () => [P(cyl(0.06, 0.06, 2.4, 4), 'tint', [0, 0, 0.3], [Math.PI / 2, 0, 0]), P(cone(0.14, 0.5, 4), METAL, [0, 0, -1.1], [-Math.PI / 2, 0, 0])],
    // a neutral elf spire: pale stone, a roof in its own colour (green, gilded once the elves grow strong), a flag
    spire: () => [
      P(cyl(0.7, 1.0, 5.2, 6), '#CFC6A8', [0, 2.6, 0]),
      P(cone(1.2, 2.2, 6), 'tint', [0, 6.3, 0]),
      P(box(0.35, 0.6, 0.1), '#FFE27A', [0, 3.8, -0.75]),
      P(cyl(0.04, 0.04, 1.6, 4), WOOD, [0, 8.0, 0]),
      P(box(0.05, 0.5, 0.9), 'team', [0, 8.5, 0.45])],
  };

  // the tower types (Game.TOWER_TYPES and the outpost): the walls take the type's colour, as on the 2D board
  const crown = (r, y, n = 8) => [...Array(n)].map((_, k) => P(box(r * 0.3, 0.55, 0.45), 'tint', [Math.sin((k + 0.5) * Math.PI * 2 / n) * r, y, Math.cos((k + 0.5) * Math.PI * 2 / n) * r], [0, (k + 0.5) * Math.PI * 2 / n, 0]));
  const door = (z, w = 0.9, h = 1.2) => P(box(w, h, 0.2), DARK, [0, h / 2, z]);
  const flagOn = (y) => [P(cyl(0.05, 0.05, 1.6, 4), WOOD, [0, y + 0.8, 0]), P(box(0.05, 0.5, 0.9), 'team', [0, y + 1.3, 0.45])];
  const TOWERS = {
    keep: () => [P(cyl(1.9, 2.3, 4.6, 8), 'tint', [0, 2.3, 0]), P(cyl(2.3, 2.1, 0.6, 8), 'tint', [0, 4.9, 0]), ...crown(2.05, 5.5),
      P(cone(1.7, 2.2, 8), 'team', [0, 6.3, 0]), ...flagOn(7.1), door(-2.05)],
    outpost: () => [...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => P(box(0.3, 3.4, 0.3), WOOD, [x * 1.1, 1.7, z * 1.1])),
      P(box(2.8, 1.1, 2.8), 'tint', [0, 3.6, 0]), P(cone(2.2, 1.4, 4), 'team', [0, 4.85, 0], [0, Math.PI / 4, 0]), ...flagOn(5.3)],
    sniper: () => [P(cyl(1.1, 1.5, 7.5, 6), 'tint', [0, 3.75, 0]), P(cyl(1.15, 1.15, 0.6, 6), '#F2C94C', [0, 6.2, 0]),
      P(box(0.3, 1.0, 0.2), 'team', [0, 4.6, -1.25]), P(cyl(1.5, 1.2, 0.6, 6), 'tint', [0, 7.8, 0]), ...crown(1.35, 8.35, 6), ...flagOn(8.3), door(-1.4, 0.7, 1.1)],
    bastion: () => [P(cyl(2.9, 3.2, 3.2, 8), 'tint', [0, 1.6, 0]), P(cyl(3.2, 3.0, 0.5, 8), 'tint', [0, 3.45, 0]), ...crown(3.0, 3.95, 10),
      P(box(1.6, 1.9, 0.25), 'team', [0, 1.7, -3.05]), P(box(0.25, 1.2, 0.3), 'tint', [0, 1.75, -3.15]), P(box(1.0, 0.25, 0.3), 'tint', [0, 2.0, -3.15]), ...flagOn(3.7)],
    mage: () => [P(cyl(1.6, 1.9, 4.2, 7), 'tint', [0, 2.1, 0]), P(cone(2.0, 4.0, 7), 'team', [0, 6.2, 0]), P(ball(0.45), '#F2C94C', [0, 6.6, -1.0]),
      P(cyl(0.12, 0.12, 0.8, 4), WOOD, [0, 8.6, 0]), door(-1.75, 0.8, 1.4)],
    bank: () => [P(box(4.2, 3.6, 3.6), 'tint', [0, 1.8, 0]), ...[-1.6, -0.55, 0.55, 1.6].map(x => P(box(0.6, 0.55, 0.45), 'tint', [x, 3.85, -1.6])),
      P(cyl(0.9, 0.9, 0.25, 10), 'team', [0, 2.4, -1.85], [Math.PI / 2, 0, 0]), P(cyl(0.6, 0.6, 0.3, 10), '#F2C94C', [0, 2.4, -1.9], [Math.PI / 2, 0, 0]), door(-1.85), ...flagOn(3.6)],
    slime: () => [P(cyl(1.8, 2.2, 4.4, 7), 'tint', [0, 2.2, 0]), P(cyl(2.2, 2.0, 0.6, 7), 'tint', [0, 4.7, 0]), ...crown(1.95, 5.25, 7),
      ...[...Array(7)].map((_, k) => P(cone(0.35, 1.2, 5), '#3FA81E', [Math.sin(k * 0.9) * 2.15, 3.9 - (k % 2) * 0.4, Math.cos(k * 0.9) * 2.15], [Math.PI, 0, 0])),
      P(ball(0.85), '#3FA81E', [0, 5.6, 0]), P(cyl(0.65, 0.65, 0.2, 8), 'team', [0, 0.65, -2.0], [Math.PI / 2, 0, 0]), ...flagOn(5.4)],
  };
  for (const [k, f] of Object.entries(TOWERS)) BUILD['tower:' + k] = f;

  const RANGED = 12; // metres: from this range on, a unit is drawn as an archer or a caster
  function kindOf(u) {
    if (u.spire) return 'spire';
    if (u.structure) return TOWERS[u.kind] ? 'tower:' + u.kind : 'tower:keep';
    if (u.aloft) return 'airship';
    if (u.shape === 'horse') return 'horse';
    if (u.shape === 'spider') return 'spider';
    if (u.shape === 'imp' || u.shape === 'ring') return 'flier';
    const n = Math.round(u.bodies || 1);
    if (u.range >= RANGED) return n >= 3 ? 'archer' : 'caster';
    if (n >= 5) return 'goblin';
    return u.hp >= 1000 ? 'brute' : 'soldier';
  }
  const cache = {};
  function parts(kind) {
    if (cache[kind]) return cache[kind];
    const list = (BUILD[kind] || BUILD.soldier)();
    return (cache[kind] = {
      tint: merge(list.filter(p => p.col === 'tint'), false),
      team: merge(list.filter(p => p.col === 'team'), false),
      fixed: merge(list.filter(p => p.col !== 'tint' && p.col !== 'team'), true),
    });
  }
  // the top of each model (metres, for a body of radius 1), found once from its geometry
  const tops = {};
  function height(kind) {
    if (tops[kind] == null) {
      const p = parts(kind); let top = 0;
      for (const g of [p.tint, p.team, p.fixed]) if (g) { g.computeBoundingBox(); top = Math.max(top, g.boundingBox.max.y); }
      tops[kind] = top;
    }
    return tops[kind];
  }
  return { kindOf, parts, height, KINDS: Object.keys(BUILD) };
};
