// ===== Low-poly unit models for the 3D board =====
// Models3D(THREE) -> { kindOf(u), parts(kind), height(kind) }.
// kindOf picks a figure from a unit's stats (rosters are custom, so names can't be relied on): towers (one per tower
// type), the elf spire, airships (aloft), the horse and spider shapes, fliers, then archers / casters for ranged
// units and goblins / brutes / soldiers for melee ones. The default roster's tier 4 units, the wizards and a few more
// (Ent, Rogue, Shiv, Assassin, Obelisk, Sniper, Slimeshots, Skeleton Archers, the Hellfiend) have their own models, by name (NAMED); a custom unit with one of
// those names gets that model too. A faction's tower (Factions mode) is one tower model in the faction's colour. height(kind): the top of the model, for markers above it.
// parts(kind) gives up to three geometries, drawn as separate instanced meshes so each can be coloured per body:
//   tint  - takes the unit's own colour (its clothes or hide), as the 2D board fills the shape with it
//   team  - takes the side's colour (shields, banners, sashes)
//   fixed - its own colours, from vertex colours (skin, wood, metal)
// Sizes are for a body of radius 1 metre standing on y = 0 and facing -z; the renderer scales them like the 2D board.
const Models3D = (THREE) => {
  const SKIN = '#D9A27A', DARK = '#2B2F33', METAL = '#B8C0C8', WOOD = '#8A5A32', BONE = '#E9E3CF', GLOW = '#FFE9A8';
  const BRASS = '#C9A24A', IRON = '#55595E', PAPER = '#E8DFC4', HEAL = '#6FD08C';
  const ICE = '#BFEFFF', GLUT = '#B07CFF';
  const STONE = '#6E6A64', ETHER = '#8FE3FF', SUN = '#F7D154', FIRE = '#FF8A3D', EMBER = '#FFD27A', ROCK = '#5A4A42', GHOST = '#7CFF6B';
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
  const obeliskParts = () => [
    P(box(1.6, 0.35, 1.6), STONE, [0, 0.18, 0]), P(box(1.66, 0.12, 1.66), 'team', [0, 0.42, 0]),
    P(cyl(0.42, 0.64, 2.8, 4), 'tint', [0, 1.85, 0], [0, Math.PI / 4, 0]),
    P(cone(0.42, 0.7, 4), 'tint', [0, 3.6, 0], [0, Math.PI / 4, 0]),
    ...[1.5, 2.0, 2.55].map((y, k) => P(box(0.08 + (k % 2) * 0.1, 0.32, 0.05), GLUT, [k === 1 ? 0.1 : -0.06, y, -0.4 + (y - 1.85) * 0.07])),
    P(box(0.52, 0.12, 0.06), DARK, [0, 1.08, -0.47]),
    P(box(0.28, 0.28, 0.28), 'tint', [0.95, 2.3, 0.2], [0.5, 0.5, 0]), P(box(0.2, 0.2, 0.2), 'tint', [-0.85, 1.7, -0.25], [0.3, 0.8, 0])];
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
    // ---------- units of the default roster with their own models (NAMED) ----------
    // Ent: a walking tree, root legs, a band in the team colour, a crown of leaves in the unit's colour, leafy hands
    ent: () => [
      P(cyl(0.18, 0.24, 0.7, 5), WOOD, [-0.25, 0.35, 0]), P(cyl(0.18, 0.24, 0.7, 5), WOOD, [0.25, 0.35, 0]),
      P(cyl(0.38, 0.45, 1.4, 6), WOOD, [0, 1.35, 0]),
      P(cyl(0.47, 0.47, 0.14, 6), 'team', [0, 1.1, 0]),
      P(cyl(0.1, 0.14, 1.0, 5), WOOD, [-0.55, 1.6, -0.1], [0.3, 0, 0.9]), P(cyl(0.1, 0.14, 1.0, 5), WOOD, [0.55, 1.6, -0.1], [0.3, 0, -0.9]),
      P(ball(0.75), 'tint', [0, 2.35, 0.05], [0, 0, 0], [1.1, 0.9, 1.1]),
      P(ball(0.4), 'tint', [-0.95, 2.0, -0.2]), P(ball(0.4), 'tint', [0.95, 2.0, -0.2]),
      P(ball(0.06), GLOW, [-0.14, 1.75, -0.4]), P(ball(0.06), GLOW, [0.14, 1.75, -0.4])],
    // Rogue: slim and hooded, a mask, a cloak in the team colour, a dagger in each hand
    rogue: () => [...legs(0.75, 0.17, 0.2),
      P(cyl(0.26, 0.34, 0.75, 6), 'tint', [0, 1.12, 0]),
      P(cone(0.5, 1.3, 6), 'team', [0, 1.0, 0.14], [-0.12, 0, 0], [1, 1, 0.6]),
      P(ball(0.23), SKIN, [0, 1.7, 0]),
      P(cone(0.32, 0.6, 6), 'tint', [0, 1.88, 0.06], [0.2, 0, 0]),
      P(box(0.3, 0.08, 0.05), DARK, [0, 1.72, -0.21]),
      ...[-1, 1].flatMap(sd => [P(box(0.1, 0.1, 0.18), DARK, [sd * 0.42, 1.0, -0.12]), P(cone(0.05, 0.55, 4), METAL, [sd * 0.42, 1.08, -0.45], [-1.3, 0, 0])])],
    // Assassin: slim, hooded and cloaked in the unit's colour, a sash in the team colour, a curved blade held low and
    // a second one reversed along the forearm
    assassin: () => [...legs(0.78, 0.15, 0.18),
      P(cyl(0.24, 0.3, 0.78, 6), 'tint', [0, 1.14, 0]),
      P(cone(0.55, 1.45, 6), 'tint', [0, 0.95, 0.12], [-0.1, 0, 0], [1, 1, 0.55]),
      P(box(0.1, 0.85, 0.07), 'team', [0, 1.15, -0.28], [0, 0, 0.7]),
      P(ball(0.22), DARK, [0, 1.72, 0]),
      P(cone(0.3, 0.62, 6), 'tint', [0, 1.92, 0.04], [0.25, 0, 0]),
      P(box(0.26, 0.05, 0.04), '#E14B4B', [0, 1.74, -0.2]),
      P(box(0.09, 0.09, 0.16), DARK, [0.4, 0.95, -0.15]), P(cone(0.06, 0.75, 4), METAL, [0.42, 1.0, -0.6], [-1.45, 0, 0.12]),
      P(box(0.09, 0.09, 0.16), DARK, [-0.4, 1.15, -0.05]), P(cone(0.05, 0.55, 4), METAL, [-0.42, 1.35, 0.15], [0.5, 0, 0])],
    // Hellfiend (Ember Imps' summon): a hunched horned brute in the unit's colour, glowing eyes, long clawed arms
    hellfiend: () => [...legs(0.65, 0.3, 0.34),
      P(box(1.25, 0.95, 0.8), 'tint', [0, 1.15, 0.05], [0.25, 0, 0]),
      P(box(1.3, 0.16, 0.85), 'team', [0, 0.72, 0]),
      P(ball(0.34), 'tint', [0, 1.75, -0.35]),
      P(cone(0.1, 0.55, 4), BONE, [-0.25, 2.1, -0.3], [0.3, 0, 0.5]), P(cone(0.1, 0.55, 4), BONE, [0.25, 2.1, -0.3], [0.3, 0, -0.5]),
      P(ball(0.07), FIRE, [-0.12, 1.8, -0.64]), P(ball(0.07), FIRE, [0.12, 1.8, -0.64]),
      ...[-1, 1].flatMap(sd => [P(cyl(0.17, 0.13, 1.2), 'tint', [sd * 0.78, 1.05, -0.2], [0.5, 0, sd * 0.2]), ...[-0.1, 0, 0.1].map(o => P(cone(0.04, 0.3, 4), BONE, [sd * 0.85 + o, 0.45, -0.55], [-1.2, 0, 0]))]),
      P(cone(0.3, 0.6, 5), EMBER, [0, 1.55, 0.45], [1.2, 0, 0])],
    // Shiv: slim and hooded like the Rogue, a sash of throwing knives in the team colour, a knife raised to throw
    shiv: () => [...legs(0.75, 0.17, 0.2),
      P(cyl(0.25, 0.32, 0.75, 6), 'tint', [0, 1.12, 0]),
      P(box(0.1, 0.95, 0.08), 'team', [0, 1.15, -0.3], [0, 0, -0.65]),
      ...[-0.25, 0, 0.25].map(o => P(cone(0.035, 0.28, 4), METAL, [o * 0.9, 1.15 + o * 0.6, -0.36], [Math.PI, 0, -0.65])),
      P(ball(0.22), SKIN, [0, 1.68, 0]),
      P(cone(0.3, 0.55, 6), 'tint', [0, 1.86, 0.05], [0.2, 0, 0]),
      P(box(0.28, 0.07, 0.05), DARK, [0, 1.7, -0.2]),
      P(box(0.1, 0.1, 0.16), DARK, [0.4, 1.75, -0.05]), P(cone(0.05, 0.45, 4), METAL, [0.4, 2.05, -0.08]),
      P(box(0.1, 0.1, 0.16), DARK, [-0.4, 1.0, -0.12])],
    // Sniper: a wide-brimmed hat, a strap in the team colour, a long rifle with a scope
    sniper: () => [...legs(0.8, 0.18, 0.22),
      P(cyl(0.3, 0.36, 0.8, 6), 'tint', [0, 1.2, 0]),
      P(box(0.1, 0.9, 0.08), 'team', [0, 1.25, -0.33], [0, 0, 0.6]),
      P(ball(0.25), SKIN, [0, 1.82, 0]),
      P(cyl(0.38, 0.38, 0.05, 8), 'tint', [0, 1.98, 0]),
      P(cyl(0.2, 0.22, 0.24, 6), 'tint', [0, 2.12, 0]),
      P(cyl(0.045, 0.045, 2.0, 5), DARK, [0.28, 1.5, -0.6], [Math.PI / 2, 0, 0]),
      P(box(0.12, 0.22, 0.6), WOOD, [0.28, 1.42, 0.2]),
      P(cyl(0.07, 0.07, 0.4, 6), METAL, [0.28, 1.65, -0.25], [Math.PI / 2, 0, 0])],
    // Slimeshots: a squat blob of slime with eyes, a ring in the team colour
    slimeshot: () => [
      P(ball(0.6), 'tint', [0, 0.5, 0], [0, 0, 0], [1.1, 0.8, 1.1]),
      P(ball(0.35), 'tint', [0, 0.98, 0.05]),
      P(cyl(0.62, 0.66, 0.1, 8), 'team', [0, 0.2, 0]),
      P(ball(0.08), DARK, [-0.14, 1.02, -0.28]), P(ball(0.08), DARK, [0.14, 1.02, -0.28])],
    // Skeleton Archers: bone legs and spine, ribs in the unit's colour, a skull, a loincloth in the team colour, a bow
    skeleton: () => [
      P(box(0.12, 0.75, 0.12), BONE, [-0.16, 0.38, 0]), P(box(0.12, 0.75, 0.12), BONE, [0.16, 0.38, 0]),
      P(box(0.5, 0.14, 0.26), 'team', [0, 0.8, 0]),
      P(cyl(0.05, 0.05, 0.7, 4), BONE, [0, 1.15, 0.05]),
      ...[0, 1, 2].map(k => P(box(0.5 - k * 0.06, 0.06, 0.3), 'tint', [0, 1.0 + k * 0.16, 0])),
      P(ball(0.24), BONE, [0, 1.65, 0]),
      P(ball(0.05), DARK, [-0.08, 1.67, -0.21]), P(ball(0.05), DARK, [0.08, 1.67, -0.21]),
      P(new THREE.TorusGeometry(0.55, 0.035, 3, 8, Math.PI), WOOD, [-0.2, 1.3, -0.5], [0, 0, Math.PI / 2]),
      P(cyl(0.1, 0.1, 0.7), WOOD, [0.15, 1.25, 0.32], [0.35, 0, 0])],
    // the wizards: a robe and pointed hat in the unit's colour, a beard, a staff topped by their element
    ...Object.fromEntries(Object.entries({
      fire: () => [P(ball(0.17), FIRE, [0.55, 2.3, -0.15]), P(cone(0.12, 0.35, 5), EMBER, [0.55, 2.52, -0.15])],
      flame: () => [P(cone(0.22, 0.6, 6), FIRE, [0.55, 2.5, -0.15]), P(cone(0.12, 0.38, 6), EMBER, [0.55, 2.42, -0.2])],
      leaf: () => [P(ball(0.12), '#A6E36A', [0.55, 2.3, -0.15]), ...[0, 2.1, 4.2].map(a => P(cone(0.1, 0.4, 4), '#3E9B2E', [0.55 + Math.sin(a) * 0.15, 2.42, -0.15 + Math.cos(a) * 0.15], [Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6]))],
      earth: () => [P(ball(0.2), ROCK, [0.55, 2.3, -0.15], [0.4, 0.6, 0]), P(ball(0.08), STONE, [0.3, 2.6, -0.1])],
      steel: () => [P(box(0.3, 0.3, 0.3), METAL, [0.55, 2.3, -0.15], [0.6, 0.6, 0]), ...[-1, 1].map(sd => P(cone(0.06, 0.2, 4), METAL, [0.55 + sd * 0.2, 2.3, -0.15], [0, 0, -sd * Math.PI / 2]))],
      slime: () => [P(ball(0.2), '#7BD93F', [0.55, 2.3, -0.15]), P(cone(0.07, 0.25, 5), '#7BD93F', [0.55, 2.1, -0.15], [Math.PI, 0, 0])],
      water: () => [P(ball(0.19), '#5FB4F0', [0.55, 2.28, -0.15]), P(cone(0.13, 0.32, 6), '#5FB4F0', [0.55, 2.5, -0.15]), P(ball(0.07), '#BDE3FF', [0.3, 2.55, -0.1])],
      frost: () => [P(cone(0.13, 0.6, 4), ICE, [0.55, 2.5, -0.15]), P(cone(0.13, 0.3, 4), ICE, [0.55, 2.06, -0.15], [Math.PI, 0, 0]),
        ...[-1, 1].map(sd => P(cone(0.07, 0.32, 4), ICE, [0.55 + sd * 0.17, 2.3, -0.15], [0, 0, -sd * 1.1])), P(ball(0.06), '#FFFFFF', [0.3, 2.6, -0.1])],
    }).map(([k, top]) => ['wizard:' + k, () => [
      P(cone(0.6, 1.5, 7), 'tint', [0, 0.75, 0]),
      P(ball(0.25), SKIN, [0, 1.6, 0]),
      P(cone(0.13, 0.42, 5), BONE, [0, 1.36, -0.2], [Math.PI - 0.35, 0, 0]),
      P(cyl(0.5, 0.5, 0.06, 8), 'team', [0, 1.78, 0]),
      P(cone(0.32, 0.8, 7), 'tint', [0, 2.2, 0.05], [0.15, 0, 0]),
      P(cyl(0.05, 0.05, 2.2, 5), WOOD, [0.55, 1.1, -0.15]),
      ...top()]])),
    // Obelisk: a tapering stone pillar in the unit's colour on a plinth, a band in the team colour, violet runes and a
    // mouth on its front, a pointed cap and two stones floating round it
    obelisk: () => obeliskParts(),
    // ...awakened (Eye of the Obelisk): a great glowing eye on its front and a crystal on its cap
    'obelisk:eye': () => [...obeliskParts(), P(ball(0.26), GLUT, [0, 2.35, -0.42], [0, 0, 0], [1, 0.7, 0.5]), P(ball(0.11), '#2A0F4A', [0, 2.35, -0.53]), P(cone(0.16, 0.6, 4), GLUT, [0, 3.95, 0])],
    // ---------- the tier 4 units (NAMED) ----------
    // Ether Golem: a hunched heap of boulders in the unit's colour, a glowing core and eye slit, rune shards floating
    golem: () => [
      P(box(0.42, 0.75, 0.42), STONE, [-0.32, 0.38, 0]), P(box(0.42, 0.75, 0.42), STONE, [0.32, 0.38, 0]),
      P(ball(0.72), 'tint', [0, 1.45, 0], [0, 0.3, 0], [1.15, 0.95, 0.85]),
      P(box(1.3, 0.14, 0.9), 'team', [0, 1.0, 0]),
      P(ball(0.24), ETHER, [0, 1.5, -0.6]),
      P(box(0.5, 0.4, 0.45), 'tint', [0, 2.2, -0.12], [0.1, 0, 0]),
      P(box(0.34, 0.06, 0.04), ETHER, [0, 2.24, -0.36]),
      ...[-1, 1].flatMap(sd => [
        P(ball(0.32), 'tint', [sd * 0.95, 1.85, 0]),
        P(box(0.38, 0.75, 0.38), 'tint', [sd * 1.05, 1.3, -0.1], [0.2, 0, sd * -0.15]),
        P(ball(0.34), STONE, [sd * 1.1, 0.8, -0.25])]),
      P(cone(0.12, 0.4, 4), ETHER, [-0.6, 2.7, 0.3]), P(cone(0.12, 0.4, 4), ETHER, [0.6, 2.55, 0.35], [Math.PI, 0, 0])],
    // Sun Priest: a robe and a stole, a gold crown, a sun halo with rays behind the head, a staff with a bright orb
    sunPriest: () => [
      P(cone(0.62, 1.6, 8), 'tint', [0, 0.8, 0]),
      P(cyl(0.2, 0.42, 0.5, 8), 'tint', [0, 1.45, 0]),
      P(box(0.14, 1.3, 0.06), 'team', [0, 1.0, -0.42], [0.27, 0, 0]),
      P(ball(0.24), SKIN, [0, 1.85, 0]),
      P(cyl(0.18, 0.24, 0.3, 6), SUN, [0, 2.12, 0]),
      P(new THREE.TorusGeometry(0.6, 0.06, 4, 16), SUN, [0, 2.0, 0.3]),
      ...[...Array(10)].map((_, k) => { const a = k * Math.PI / 5; return P(cone(0.09, 0.35, 4), SUN, [Math.sin(a) * 0.82, 2.0 + Math.cos(a) * 0.82, 0.3], [0, 0, -a]); }),
      P(cyl(0.045, 0.045, 2.3, 5), '#C9A13B', [0.55, 1.15, -0.15]),
      P(ball(0.17), GLOW, [0.55, 2.35, -0.15])],
    // Meteor Caller: a hooded robe, arms raised to a burning rock with a trail of fire, hanging over its head
    meteor: () => [
      P(cone(0.58, 1.55, 7), 'tint', [0, 0.78, 0]),
      P(cyl(0.5, 0.5, 0.06, 8), 'team', [0, 1.3, 0]),
      P(ball(0.24), SKIN, [0, 1.62, 0]),
      P(cone(0.34, 0.7, 7), 'tint', [0, 1.85, 0.06], [0.25, 0, 0]),
      P(cyl(0.08, 0.1, 0.8, 5), 'tint', [-0.38, 1.75, -0.1], [0, 0, 0.45]),
      P(cyl(0.08, 0.1, 0.8, 5), 'tint', [0.38, 1.75, -0.1], [0, 0, -0.45]),
      P(ball(0.42), ROCK, [0, 2.85, -0.15], [0.4, 0.6, 0]),
      P(cone(0.36, 1.1, 6), FIRE, [0.31, 3.27, 0.02], [0.4, 0, -0.6]),
      P(cone(0.2, 0.7, 6), EMBER, [0.22, 3.12, -0.02], [0.4, 0, -0.6]),
      P(ball(0.06), GLOW, [-0.5, 2.4, -0.3]), P(ball(0.05), GLOW, [0.6, 2.2, -0.2]), P(ball(0.05), GLOW, [-0.3, 3.2, 0.1])],
    // War Mammoth: a big shaggy body in the unit's colour, trunk and curved tusks, ears, a howdah in the team colour
    mammoth: () => [
      P(ball(1), 'tint', [0, 1.75, 0.1], [0, 0, 0], [0.95, 0.85, 1.3]),
      P(ball(0.6), 'tint', [0, 2.1, -1.15]),
      P(ball(0.42), 'tint', [0, 2.55, -0.85]),
      ...[[-0.5, -0.65], [0.5, -0.65], [-0.5, 0.8], [0.5, 0.8]].map(([x, z]) => P(cyl(0.26, 0.3, 1.1, 6), 'tint', [x, 0.55, z])),
      P(cyl(0.2, 0.24, 0.6, 6), 'tint', [0, 1.7, -1.6], [0.5, 0, 0]),
      P(cyl(0.16, 0.2, 0.6, 6), 'tint', [0, 1.2, -1.78], [0.1, 0, 0]),
      P(cyl(0.12, 0.16, 0.45, 6), 'tint', [0, 0.82, -1.72], [-0.5, 0, 0]),
      ...[-1, 1].flatMap(sd => [
        P(cyl(0.09, 0.11, 0.7, 5), BONE, [sd * 0.3, 1.54, -1.78], [-2.2, 0, 0]),
        P(cone(0.09, 0.6, 5), BONE, [sd * 0.3, 1.55, -2.29], [-0.8, 0, 0]),
        P(box(0.08, 0.6, 0.5), 'tint', [sd * 0.6, 2.15, -1.0], [0, 0, sd * 0.2])]),
      P(ball(0.06), DARK, [-0.3, 2.25, -1.62]), P(ball(0.06), DARK, [0.3, 2.25, -1.62]),
      P(box(1.3, 0.15, 1.4), 'team', [0, 2.65, 0.2]),
      P(box(1.2, 0.5, 1.2), WOOD, [0, 2.95, 0.2]),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => P(cyl(0.04, 0.04, 0.6, 4), WOOD, [x * 0.55, 3.5, 0.2 + z * 0.55])),
      P(cone(0.95, 0.6, 4), 'team', [0, 4.1, 0.2], [0, Math.PI / 4, 0]),
      P(cyl(0.05, 0.05, 0.6, 4), 'tint', [0, 1.6, 1.4], [0.4, 0, 0])],
    // Necromancer: a hooded robe in the unit's colour, a skull face with green eyes, bone shoulder spikes, a skull staff
    // with green fire, and wisps
    necro: () => [
      P(cone(0.62, 1.6, 7), 'tint', [0, 0.8, 0]),
      P(cyl(0.62, 0.66, 0.18, 7), DARK, [0, 0.09, 0]),
      P(cyl(0.3, 0.45, 0.45, 7), 'tint', [0, 1.45, 0]),
      P(box(0.1, 1.2, 0.06), 'team', [0, 1.0, -0.42], [0.27, 0, 0]),
      P(cone(0.08, 0.35, 4), BONE, [-0.4, 1.75, 0], [0, 0, 0.5]), P(cone(0.08, 0.35, 4), BONE, [0.4, 1.75, 0], [0, 0, -0.5]),
      P(cone(0.36, 0.85, 7), 'tint', [0, 2.0, 0.05], [0.1, 0, 0]),
      P(ball(0.22), BONE, [0, 1.82, -0.08]),
      P(ball(0.05), GHOST, [-0.08, 1.85, -0.28]), P(ball(0.05), GHOST, [0.08, 1.85, -0.28]),
      P(cyl(0.045, 0.05, 2.3, 5), DARK, [0.58, 1.15, -0.15]),
      P(ball(0.17), BONE, [0.58, 2.4, -0.15]),
      P(cone(0.14, 0.4, 5), GHOST, [0.58, 2.72, -0.15]),
      P(ball(0.09), GHOST, [-0.6, 1.4, -0.3]), P(ball(0.07), GHOST, [-0.75, 2.0, 0.2])],
    // Truespear: armoured, a crested helm, a long spear raised in front, a second spear across the back, a small shield
    truespear: () => [...legs(),
      P(cyl(0.34, 0.4, 0.8, 6), 'tint', [0, 1.2, 0]),
      P(cyl(0.42, 0.42, 0.12, 6), 'team', [0, 0.85, 0]),
      P(box(0.8, 0.45, 0.5), METAL, [0, 1.45, 0]),
      P(ball(0.26), SKIN, [0, 1.88, 0]),
      P(cyl(0.27, 0.3, 0.32, 6), METAL, [0, 2.02, 0]),
      P(box(0.3, 0.07, 0.05), DARK, [0, 1.94, -0.28]),
      P(box(0.08, 0.35, 0.6), 'team', [0, 2.3, 0.05]),
      P(cyl(0.04, 0.04, 3.0, 5), WOOD, [0.48, 1.6, -0.2], [-0.35, 0, 0]),
      P(cone(0.1, 0.45, 4), METAL, [0.48, 3.2, -0.78], [-0.35, 0, 0]),
      P(cyl(0.035, 0.035, 2.4, 5), WOOD, [0, 1.5, 0.38], [0, 0, 0.7]),
      P(cone(0.08, 0.36, 4), METAL, [-0.89, 2.56, 0.38], [0, 0, 0.7]),
      P(cyl(0.35, 0.35, 0.07, 8), 'team', [-0.5, 1.25, -0.1], [0, 0, Math.PI / 2])],
    // ---------- the Mechites (NAMED): rock elementals with clockwork in them, and the rattling machines they build ----------
    // a cog: a disc with teeth, lying in the x-y plane (turn it to face where it should)
    // Rollers: a ball of rock with a brass cog band and a band in the team colour. Built around its middle (ROLL_AT
    // metres up), so the renderer can roll it.
    roller: () => [
      P(ball(0.9), 'tint', [0, 0.9, 0], [0.3, 0.5, 0]),
      P(new THREE.TorusGeometry(0.88, 0.09, 4, 14), BRASS, [0, 0.9, 0], [0, Math.PI / 2, 0]),
      ...[...Array(10)].map((_, k) => { const a = k * Math.PI / 5; return P(box(0.12, 0.2, 0.2), BRASS, [0, 0.9 + Math.cos(a) * 0.98, Math.sin(a) * 0.98], [a, 0, 0]); }),
      P(new THREE.TorusGeometry(0.8, 0.07, 4, 14), 'team', [0, 0.9, 0], [0, 0, 0])],
    // Rollers, unfolded (the Unfold skill): the ball opens into a rock elemental on two stumpy legs, the cog band
    // round its waist, big boulder fists
    'roller:unfolded': () => [
      P(box(0.4, 0.75, 0.42), 'tint', [-0.32, 0.38, 0]), P(box(0.4, 0.75, 0.42), 'tint', [0.32, 0.38, 0]),
      P(ball(0.72), 'tint', [0, 1.4, 0], [0.3, 0.5, 0], [1.1, 0.95, 0.9]),
      P(new THREE.TorusGeometry(0.74, 0.08, 4, 14), BRASS, [0, 1.15, 0], [Math.PI / 2, 0, 0]),
      P(new THREE.TorusGeometry(0.66, 0.06, 4, 14), 'team', [0, 1.6, 0], [Math.PI / 2, 0, 0]),
      P(ball(0.38), 'tint', [-0.95, 1.05, -0.2]), P(ball(0.38), 'tint', [0.95, 1.05, -0.2]),
      P(box(0.26, 0.06, 0.04), ETHER, [0, 1.75, -0.66])],
    // Cog Builder: a squat rock elemental with a backpack full of scrolls and a brass gadget for a right hand
    cogBuilder: () => [
      P(box(0.34, 0.6, 0.34), STONE, [-0.22, 0.3, 0]), P(box(0.34, 0.6, 0.34), STONE, [0.22, 0.3, 0]),
      P(ball(0.62), 'tint', [0, 1.1, 0], [0.2, 0.4, 0], [1.05, 0.95, 0.9]),
      P(box(1.0, 0.12, 0.7), 'team', [0, 0.85, 0]),
      P(ball(0.3), 'tint', [0, 1.8, -0.05], [0.4, 0, 0]),
      P(box(0.22, 0.05, 0.04), ETHER, [0, 1.85, -0.3]),
      P(box(0.7, 0.75, 0.4), WOOD, [0, 1.2, 0.6]),
      ...[-0.2, 0, 0.2].map((x, k) => P(cyl(0.07, 0.07, 0.6 + k * 0.1, 6), PAPER, [x, 1.75, 0.6], [0.2 * (k - 1), 0, 0.2 * (k - 1)])),
      P(ball(0.24), 'tint', [-0.6, 1.0, -0.1]),
      P(cyl(0.12, 0.16, 0.6, 6), BRASS, [0.62, 1.05, -0.2], [-1.2, 0, 0]),
      P(cone(0.12, 0.35, 6), METAL, [0.62, 1.2, -0.62], [-1.2 - Math.PI, 0, 0]),
      P(new THREE.TorusGeometry(0.16, 0.05, 3, 8), BRASS, [0.62, 1.08, -0.15])],
    // Mechite Guards: a heavy rock body under iron plates, a brass shoulder, a short shotgun
    mechGuard: () => [
      P(box(0.36, 0.65, 0.36), STONE, [-0.25, 0.33, 0]), P(box(0.36, 0.65, 0.36), STONE, [0.25, 0.33, 0]),
      P(ball(0.6), 'tint', [0, 1.15, 0], [0, 0.3, 0], [1.1, 1, 0.9]),
      P(box(0.9, 0.55, 0.2), IRON, [0, 1.2, -0.48]),
      P(box(0.5, 0.25, 0.06), 'team', [0, 1.25, -0.6]),
      P(ball(0.34), BRASS, [-0.62, 1.5, 0]), P(ball(0.3), IRON, [0.62, 1.5, 0]),
      P(ball(0.28), 'tint', [0, 1.85, -0.05], [0.4, 0.2, 0]),
      P(box(0.26, 0.06, 0.04), ETHER, [0, 1.88, -0.3]),
      P(cyl(0.09, 0.09, 0.9, 6), DARK, [0.5, 1.1, -0.55], [Math.PI / 2, 0, 0]),
      P(cyl(0.09, 0.09, 0.9, 6), DARK, [0.32, 1.1, -0.55], [Math.PI / 2, 0, 0]),
      P(box(0.35, 0.25, 0.45), WOOD, [0.41, 1.0, 0.0])],
    // Cog Turret: a rattling gun on a tripod, an exhaust pipe at the back
    cogTurret: () => [
      ...[0, 2.1, 4.2].map(a => P(cyl(0.06, 0.08, 1.0, 4), IRON, [Math.sin(a) * 0.35, 0.45, Math.cos(a) * 0.35], [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45])),
      P(box(0.8, 0.5, 0.7), 'tint', [0, 1.05, 0]),
      P(box(0.84, 0.12, 0.74), 'team', [0, 0.85, 0]),
      P(cyl(0.1, 0.1, 0.9, 6), DARK, [0, 1.1, -0.75], [Math.PI / 2, 0, 0]),
      P(cyl(0.07, 0.07, 0.5, 5), IRON, [0.25, 1.5, 0.3]),
      P(new THREE.TorusGeometry(0.2, 0.05, 3, 8), BRASS, [-0.41, 1.05, 0], [0, Math.PI / 2, 0])],
    // Mecha Drone: a little quadcopter, a body in the team colour, four rotors on crossed arms, a gun underneath
    drone: () => [
      P(box(0.9, 0.35, 0.9), 'team', [0, 1.4, 0]),
      P(box(2.4, 0.08, 0.16), IRON, [0, 1.5, 0], [0, Math.PI / 4, 0]), P(box(2.4, 0.08, 0.16), IRON, [0, 1.5, 0], [0, -Math.PI / 4, 0]),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => P(cyl(0.45, 0.45, 0.05, 8), DARK, [x * 0.85, 1.58, z * 0.85])),
      P(cyl(0.07, 0.07, 0.6, 5), DARK, [0, 1.12, -0.35], [Math.PI / 2, 0, 0])],
    // Minebot: a squat crawler carrying a stack of mines, a red lamp on top
    minebot: () => [
      P(box(0.8, 0.4, 0.95), 'tint', [0, 0.45, 0]), P(box(0.84, 0.1, 0.99), 'team', [0, 0.3, 0]),
      P(cyl(0.3, 0.3, 0.12, 8), DARK, [0, 0.72, 0.1]), P(cyl(0.3, 0.3, 0.12, 8), DARK, [0, 0.86, 0.1]),
      P(ball(0.09), '#E2513B', [0, 1.0, -0.3]),
      ...[-1, 1].map(x => P(box(0.14, 0.3, 1.0), DARK, [x * 0.46, 0.18, 0]))],
    // Repairbot: a hovering box with a wrench arm and a rotor, like a healbot in work colours
    repairbot: () => [
      P(box(0.7, 0.5, 0.7), 'tint', [0, 1.2, 0]), P(box(0.74, 0.1, 0.74), 'team', [0, 0.97, 0]),
      P(box(0.08, 0.08, 0.7), IRON, [0.3, 1.1, -0.55]), P(new THREE.TorusGeometry(0.12, 0.04, 3, 6, 4.5), IRON, [0.3, 1.1, -0.92], [Math.PI / 2, 0, 0]),
      P(cyl(0.04, 0.04, 0.3, 4), IRON, [0, 1.6, 0]), P(box(1.2, 0.04, 0.12), IRON, [0, 1.76, 0])],
    // Healbot: a little hovering box with a green cross and a spinning rotor on top
    healbot: () => [
      P(box(0.7, 0.55, 0.7), 'tint', [0, 1.2, 0]),
      P(box(0.74, 0.1, 0.74), 'team', [0, 0.95, 0]),
      P(box(0.42, 0.12, 0.04), HEAL, [0, 1.22, -0.37]), P(box(0.12, 0.42, 0.04), HEAL, [0, 1.22, -0.37]),
      P(cyl(0.04, 0.04, 0.3, 4), IRON, [0, 1.6, 0]),
      P(box(1.2, 0.04, 0.12), IRON, [0, 1.76, 0]),
      P(cone(0.12, 0.3, 4), IRON, [0, 0.82, 0], [Math.PI, 0, 0])],
    // Cogbot Fighter: a boxy riveted brawler with huge fists
    cogFighter: () => [
      P(box(0.32, 0.7, 0.32), IRON, [-0.3, 0.35, 0]), P(box(0.32, 0.7, 0.32), IRON, [0.3, 0.35, 0]),
      P(box(1.2, 1.0, 0.8), 'tint', [0, 1.25, 0]),
      P(box(0.7, 0.35, 0.06), 'team', [0, 1.3, -0.42]),
      P(box(0.5, 0.4, 0.5), 'tint', [0, 1.95, -0.05]),
      P(box(0.34, 0.07, 0.04), '#FF8A3D', [0, 1.98, -0.31]),
      ...[-1, 1].flatMap(sd => [P(cyl(0.12, 0.12, 0.7, 5), IRON, [sd * 0.75, 1.25, -0.1], [0.4, 0, 0]), P(box(0.45, 0.45, 0.45), BRASS, [sd * 0.78, 0.95, -0.4])]),
      P(cyl(0.08, 0.08, 0.5, 5), DARK, [0.4, 2.0, 0.35])],
    // Cogbot Machinegunner: a walker carrying a rotary gun of three barrels
    cogGunner: () => [
      P(box(0.26, 0.8, 0.26), IRON, [-0.28, 0.4, 0]), P(box(0.26, 0.8, 0.26), IRON, [0.28, 0.4, 0]),
      P(box(0.9, 0.7, 0.7), 'tint', [0, 1.15, 0]),
      P(box(0.92, 0.14, 0.72), 'team', [0, 0.85, 0]),
      P(ball(0.25), DARK, [0, 1.7, -0.05]),
      P(cyl(0.22, 0.22, 0.3, 8), BRASS, [0.25, 1.2, -0.45], [Math.PI / 2, 0, 0]),
      ...[0, 2.1, 4.2].map(a => P(cyl(0.05, 0.05, 1.1, 4), DARK, [0.25 + Math.sin(a) * 0.12, 1.2 + Math.cos(a) * 0.12, -1.05], [Math.PI / 2, 0, 0])),
      P(cyl(0.07, 0.07, 0.5, 5), IRON, [-0.3, 1.6, 0.3])],
    // CogMech: a tall two-legged mech with a cockpit and a cannon on each arm (it fires both at once)
    cogMech: () => [
      ...[-1, 1].flatMap(sd => [P(box(0.3, 0.9, 0.35), IRON, [sd * 0.4, 0.45, 0.1]), P(box(0.34, 0.7, 0.34), 'tint', [sd * 0.4, 1.2, -0.05], [0.25, 0, 0])]),
      P(box(1.3, 0.9, 1.0), 'tint', [0, 1.95, 0]),
      P(box(1.34, 0.18, 1.04), 'team', [0, 1.55, 0]),
      P(box(0.6, 0.35, 0.1), ETHER, [0, 2.1, -0.52]),
      ...[-1, 1].flatMap(sd => [P(box(0.35, 0.35, 0.8), BRASS, [sd * 0.88, 1.9, -0.1]), P(cyl(0.11, 0.11, 0.9, 6), DARK, [sd * 0.88, 1.9, -0.85], [Math.PI / 2, 0, 0])]),
      P(cyl(0.08, 0.08, 0.6, 5), IRON, [0.35, 2.65, 0.35]), P(cyl(0.08, 0.08, 0.6, 5), IRON, [-0.35, 2.65, 0.35])],
    // a thrown spear, flying toward -z: the shaft takes the unit's colour
    spear: () => [P(cyl(0.06, 0.06, 2.4, 4), 'tint', [0, 0, 0.3], [Math.PI / 2, 0, 0]), P(cone(0.14, 0.5, 4), METAL, [0, 0, -1.1], [-Math.PI / 2, 0, 0])],
    // a neutral elf spire: pale stone, a roof in its own colour (green, gilded once the elves grow strong), a flag
    spire: () => [
      P(cyl(0.7, 1.0, 5.2, 6), '#CFC6A8', [0, 2.6, 0]),
      P(cone(1.2, 2.2, 6), 'tint', [0, 6.3, 0]),
      P(box(0.35, 0.6, 0.1), '#FFE27A', [0, 3.8, -0.75]),
      P(cyl(0.05, 0.05, 2.4, 4), WOOD, [0, 8.4, 0]),
      P(box(0.06, 0.9, 1.6), 'team', [0, 9.1, 0.8])], // a big flag: whose side the elves are on
  };

  // the tower types (Game.TOWER_TYPES and the outpost): the walls take the type's colour, as on the 2D board
  const crown = (r, y, n = 8) => [...Array(n)].map((_, k) => P(box(r * 0.3, 0.55, 0.45), 'tint', [Math.sin((k + 0.5) * Math.PI * 2 / n) * r, y, Math.cos((k + 0.5) * Math.PI * 2 / n) * r], [0, (k + 0.5) * Math.PI * 2 / n, 0]));
  const door = (z, w = 0.9, h = 1.2) => P(box(w, h, 0.2), DARK, [0, h / 2, z]);
  const flagOn = (y) => [P(cyl(0.05, 0.05, 1.6, 4), WOOD, [0, y + 0.8, 0]), P(box(0.05, 0.5, 0.9), 'team', [0, y + 1.3, 0.45])];
  const mechaTower = (y0 = 0) => lifted([
    P(cyl(2.2, 2.5, 3.2, 10), 'tint', [0, 1.6, 0]),
    P(new THREE.TorusGeometry(2.3, 0.22, 4, 14), BRASS, [0, 2.2, 0], [Math.PI / 2, 0, 0]),
    ...[...Array(10)].map((_, k) => { const a = k * Math.PI / 5; return P(box(0.35, 0.4, 0.35), BRASS, [Math.cos(a) * 2.55, 2.2, Math.sin(a) * 2.55]); }),
    P(cyl(2.4, 2.4, 0.3, 10), IRON, [0, 3.35, 0]),
    P(cyl(1.4, 1.4, 0.08, 10), 'team', [0, 3.55, 0]),
    P(cyl(0.08, 0.08, 1.8, 4), IRON, [1.6, 4.3, 0]), P(ball(0.18), '#F2C94C', [1.6, 5.25, 0]),
    P(cyl(0.3, 0.35, 1.6, 6), DARK, [-1.2, 4.0, 1.4]), P(cyl(0.25, 0.3, 1.2, 6), DARK, [-0.5, 3.8, 1.8]),
    door(-2.3, 0.9, 1.3)], y0);
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
    // the Mechites' Mecha Tower: a squat riveted drum in the faction's colour, a brass cog band, a landing pad for its
    // drone on top with a mast and a lamp, exhaust stacks at the back
    'f-mechites': () => mechaTower(),
    // a faction's tower: a stone hall, a tall round tower and spire in the faction's colour, banners in the team colour
    faction: () => [P(box(3.4, 3.4, 3.4), STONE, [0, 1.7, 0]), ...crown(2.0, 3.65, 8).map(p => ({ g: p.g, col: STONE })),
      P(cyl(1.3, 1.5, 3.2, 8), 'tint', [0, 5.0, 0]), P(cone(1.7, 2.4, 8), 'tint', [0, 7.8, 0]),
      ...[[0, -1], [1, 0], [-1, 0], [0, 1]].map(([x, z]) => P(box(z ? 0.9 : 0.1, 1.6, z ? 0.1 : 0.9), 'team', [x * 1.76, 2.5, z * 1.76])),
      door(-1.75, 0.8, 1.1), ...flagOn(9.0)],
  };
  for (const [k, f] of Object.entries(TOWERS)) BUILD['tower:' + k] = f;
  // Factions devtest: a lesser building (a small workshop in its faction's colour, a roof in the team colour) and a
  // wall raised by a spell (a row of sharpened stakes). Placeholders until the buildings get their own models.
  BUILD.lesser = () => [P(box(3.0, 2.0, 2.6), 'tint', [0, 1.0, 0]), P(cone(2.4, 1.6, 4), 'team', [0, 2.8, 0], [0, Math.PI / 4, 0]),
    P(box(0.7, 1.1, 0.15), DARK, [0, 0.55, -1.32]), P(cyl(0.25, 0.25, 1.2, 6), STONE, [0.9, 3.0, 0.5]), ...flagOn(3.4)];
  // the treasury (Test Grid): a squat vault in gold on a stone plinth, a roof in the team colour and a pile of coins
  BUILD.treasury = () => [P(box(3.0, 0.5, 3.0), STONE, [0, 0.25, 0]), P(box(2.5, 1.7, 2.5), 'tint', [0, 1.35, 0]), P(cone(2.1, 1.2, 4), 'team', [0, 2.8, 0], [0, Math.PI / 4, 0]),
    P(box(0.8, 1.0, 0.15), DARK, [0, 1.0, -1.28]), ...[[-1.0, 1.9], [-0.55, 2.0], [-0.8, 1.6]].map(([x, z], k) => P(cyl(0.3, 0.3, 0.3 + k * 0.15, 8), 'tint', [x - 0.5, 0.65 + k * 0.08, z - 0.3])), ...flagOn(3.6)];
  // Overwatch's watchtower: four posts, a platform with a parapet in the unit's colour, a roof in the team colour
  BUILD.watchtower = () => [...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => P(box(0.25, 3.0, 0.25), WOOD, [x * 0.9, 1.5, z * 0.9])),
    P(box(2.3, 0.2, 2.3), WOOD, [0, 3.0, 0]), ...[[0, -1], [0, 1], [-1, 0], [1, 0]].map(([x, z]) => P(box(x ? 0.12 : 2.3, 0.5, z ? 0.12 : 2.3), 'tint', [x * 1.1, 3.35, z * 1.1])),
    P(cone(1.8, 1.0, 4), 'team', [0, 4.6, 0], [0, Math.PI / 4, 0]), ...[[-1, -1], [1, 1]].map(([x, z]) => P(box(0.1, 1.2, 0.1), WOOD, [x * 1.05, 3.9, z * 1.05]))];
  BUILD.wall = () => [...[-1.5, -0.75, 0, 0.75, 1.5].map((x, k) => P(cyl(0.32, 0.32, 2.2 + (k % 2) * 0.3, 6), WOOD, [x, 1.1 + (k % 2) * 0.15, 0])),
    ...[-1.5, -0.75, 0, 0.75, 1.5].map((x, k) => P(cone(0.32, 0.6, 6), '#B79A6E', [x, 2.5 + (k % 2) * 0.3, 0])), P(box(3.6, 0.25, 0.2), 'team', [0, 1.4, -0.3])];
  // the bastion's defensive wall: a stone wall along one edge of a tile (along x; the renderer turns one along y),
  // battlements along the top and a band in the team colour
  BUILD.stonewall = () => [P(box(6.0, 2.4, 1.2), STONE, [0, 1.2, 0]),
    ...[-2.4, -1.2, 0, 1.2, 2.4].map(x => P(box(0.7, 0.6, 1.2), STONE, [x, 2.7, 0])),
    P(box(6.1, 0.3, 1.3), 'team', [0, 1.9, 0])];
  // Core Awoken: the Mecha Tower on four big wheels
  BUILD['tower:f-mechites:awake'] = () => [...mechaTower(1.0),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => P(cyl(0.95, 0.95, 0.55, 10), DARK, [x * 2.05, 0.95, z * 1.5], [0, 0, Math.PI / 2])),
    P(cyl(0.12, 0.12, 2.0, 6), IRON, [0, 4.4, 0.6], [-0.9, 0, 0])]; // and a mortar barrel
  // buildings (drawn at their real size, like towers): the Mechites' Factory, a brick workshop in the building's colour
  // with a sawtooth roof, a smoking chimney, a big brass cog on its front and banners in the team colour
  const lifted = (list, y0) => { if (!y0) return list; for (const p of list) p.g.translate(0, y0, 0); return list; };
  const factory = (y0 = 0) => lifted([
    P(box(4.0, 2.4, 3.2), 'tint', [0, 1.2, 0]),
    ...[-1.33, 0, 1.33].flatMap(x => [P(box(1.45, 0.12, 3.3), '#5B4A3A', [x - 0.05, 2.75, 0], [0, 0, 0.45]), P(box(0.08, 0.62, 3.3), '#9FC7D9', [x + 0.62, 2.7, 0])]),
    P(cyl(0.35, 0.42, 3.6, 6), DARK, [1.3, 3.6, 0.9]),
    P(cyl(0.45, 0.45, 0.25, 6), BRASS, [1.3, 4.6, 0.9]),
    P(cyl(0.95, 0.95, 0.2, 14), BRASS, [-0.9, 1.4, -1.65], [Math.PI / 2, 0, 0]),
    ...[...Array(10)].map((_, k) => { const a = k * Math.PI / 5; return P(box(0.28, 0.28, 0.2), BRASS, [-0.9 + Math.cos(a) * 1.05, 1.4 + Math.sin(a) * 1.05, -1.65], [0, 0, a]); }),
    P(box(1.0, 1.5, 0.15), DARK, [0.9, 0.75, -1.63]),
    P(box(0.15, 1.3, 0.9), 'team', [-2.05, 1.6, 0.5]), P(box(0.15, 1.3, 0.9), 'team', [2.05, 1.6, -0.5])], y0);
  BUILD['building:factory'] = () => factory();
  // Core Awoken: the factory on caterpillar tracks with a big tank gun on its roof
  BUILD['building:factory:awake'] = () => [...factory(0.7),
    ...[-1, 1].flatMap(sd => [P(box(0.9, 0.8, 3.8), DARK, [sd * 1.75, 0.4, 0]), ...[-1.4, -0.45, 0.45, 1.4].map(z => P(cyl(0.32, 0.32, 0.95, 8), IRON, [sd * 1.75, 0.4, z], [0, 0, Math.PI / 2]))]),
    P(box(1.4, 0.6, 1.4), IRON, [-0.6, 3.75, 0.3]), P(cyl(0.18, 0.2, 3.0, 8), DARK, [-0.6, 3.8, -1.4], [Math.PI / 2, 0, 0])];
  // the Altar of Build: a stone ring where four tiles meet, four pillars with brass caps and banners, and the Cog Spire
  // in its middle: a tall spire ringed by a standing brass cog, an ether crystal on top
  const altar = (y0 = 0) => lifted([
    P(cyl(3.8, 4.0, 0.45, 16), 'tint', [0, 0.22, 0]),
    P(cyl(2.9, 2.9, 0.5, 16), STONE, [0, 0.3, 0]),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([x, z]) => [P(cyl(0.38, 0.45, 2.4, 6), STONE, [x * 2.6, 1.6, z * 2.6]), P(cyl(0.5, 0.5, 0.25, 6), BRASS, [x * 2.6, 2.9, z * 2.6]),
      P(box(0.06, 0.9, 0.55), 'team', [x * 2.6 - x * 0.42, 1.9, z * 2.6])]),
    P(cone(0.9, 5.2, 8), 'tint', [0, 3.0, 0]),
    P(new THREE.TorusGeometry(1.4, 0.18, 4, 16), BRASS, [0, 2.4, 0]),
    ...[...Array(12)].map((_, k) => { const a = k * Math.PI / 6; return P(box(0.3, 0.32, 0.3), BRASS, [Math.cos(a) * 1.62, 2.4 + Math.sin(a) * 1.62, 0], [0, 0, a]); }),
    P(ball(0.5), ETHER, [0, 5.9, 0])], y0);
  BUILD['building:altar'] = () => altar();
  // Core Awoken: the altar rises on four spider legs
  BUILD['building:altar:awake'] = () => [...altar(1.6),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([x, z]) => [P(box(0.3, 2.6, 0.3), IRON, [x * 3.0, 2.0, z * 3.0], [z * 0.5, 0, -x * 0.5]), P(box(0.28, 2.2, 0.28), IRON, [x * 4.1, 0.9, z * 4.1], [-z * 0.25, 0, x * 0.25])])];
  // Core Awoken: a turret on wheels
  BUILD['cogTurret:awake'] = () => [
    P(box(0.8, 0.5, 0.7), 'tint', [0, 0.85, 0]), P(box(0.84, 0.12, 0.74), 'team', [0, 0.65, 0]),
    P(cyl(0.12, 0.12, 0.9, 6), DARK, [0, 1.15, -0.55], [Math.PI / 2 - 0.6, 0, 0]),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => P(cyl(0.28, 0.28, 0.16, 8), DARK, [x * 0.5, 0.28, z * 0.32], [0, 0, Math.PI / 2])),
    P(cyl(0.07, 0.07, 0.5, 5), IRON, [0.25, 1.3, 0.3])];
  BUILD.building = BUILD['building:factory']; // any other building, until it has a model of its own

  // the Leafblade suit (an awakened Leaf Wizard): a leaf-green mech on thick legs, a glowing visor, missile pods on its
  // shoulders and two long leaf blades held out from its arms
  BUILD.leafmech = () => [
    ...[-1, 1].flatMap(sd => [P(box(0.36, 0.9, 0.42), DARK, [sd * 0.32, 0.45, 0]), P(box(0.46, 0.18, 0.6), IRON, [sd * 0.32, 0.09, -0.06])]),
    P(box(1.0, 0.85, 0.75), 'tint', [0, 1.35, 0]),
    P(box(0.6, 0.3, 0.5), IRON, [0, 0.95, 0]),
    P(box(0.5, 0.36, 0.45), 'tint', [0, 1.95, 0.02]),
    P(box(0.42, 0.1, 0.06), GHOST, [0, 1.98, -0.22]),
    ...[-1, 1].flatMap(sd => [
      P(box(0.42, 0.34, 0.6), IRON, [sd * 0.72, 1.82, 0.08]), // missile pod
      ...[-0.12, 0.12].map(o => P(cyl(0.07, 0.07, 0.12, 6), FIRE, [sd * 0.72 + o, 1.82, -0.24], [Math.PI / 2, 0, 0])),
      P(box(0.34, 0.12, 0.5), 'team', [sd * 0.72, 2.03, 0.08]),
      P(box(0.24, 0.62, 0.26), DARK, [sd * 0.68, 1.3, -0.05], [0.35, 0, 0]), // arm
      P(box(0.14, 0.05, 2.0), '#7BE05A', [sd * 0.95, 1.05, -1.05], [0.1, sd * -0.35, sd * 0.25]), // a long leaf blade
      P(box(0.06, 0.07, 1.6), '#2E8B2A', [sd * 0.95, 1.08, -0.95], [0.1, sd * -0.35, sd * 0.25])])];
  const NAMED = { 'Ether Golem': 'golem', 'Sun Priest': 'sunPriest', 'Meteor Caller': 'meteor', 'War Mammoth': 'mammoth', 'Necromancer': 'necro', 'Truespear': 'truespear',
    'Ent': 'ent', 'Rogue': 'rogue', 'Sniper': 'sniper', 'Slimeshots': 'slimeshot', 'Skeleton Archers': 'skeleton',
    'Rollers': 'roller', 'Cog Builder': 'cogBuilder', 'Mechite Guards': 'mechGuard', 'Cog Turret': 'cogTurret', 'Healbot': 'healbot',
    'Minebot': 'minebot', 'Repairbot': 'repairbot', 'Cogbot Fighter': 'cogFighter', 'Cogbot Machinegunner': 'cogGunner', 'CogMech': 'cogMech',
    'Fire Mage': 'wizard:fire', 'Flame Wizard': 'wizard:flame', 'Leaf Wizard': 'wizard:leaf', 'Earth Wizard': 'wizard:earth', 'Steel Wizard': 'wizard:steel', 'Slime Wizard': 'wizard:slime',
    'Water Mage': 'wizard:water', 'Frost Wizard': 'wizard:frost', 'Obelisk': 'obelisk', 'Shiv': 'shiv', 'Assassin': 'assassin', 'Hellfiend': 'hellfiend' };
  const RANGED = 12; // metres: from this range on, a unit is drawn as an archer or a caster
  function kindOf(u) {
    if (u.spire) return 'spire';
    if (u.structure && u.kind === 'wall' && u.barrier) return 'stonewall';
    if (u.structure && (u.kind === 'lesser' || u.kind === 'wall' || u.kind === 'treasury' || u.kind === 'watchtower')) return u.kind;
    if (u.building) { const k = 'building:' + u.building; return u.awake && BUILD[k + ':awake'] ? k + ':awake' : BUILD[k] ? k : 'building'; } // Core Awoken: its walking version
    if (u.structure) { const k = TOWERS[u.kind] ? 'tower:' + u.kind : /^f-/.test(u.kind || '') ? 'tower:faction' : 'tower:keep'; return u.awake && BUILD[k + ':awake'] ? k + ':awake' : k; } // Core Awoken: the Mecha Tower on wheels
    if (u.aloft) return u.kind === 'drone' ? 'drone' : 'airship';
    if (u.mech) return 'leafmech'; // the Leafblade suit
    if (NAMED[u.name]) { const k = NAMED[u.name]; return u.awake && BUILD[k + ':awake'] ? k + ':awake' : u.eye && BUILD[k + ':eye'] ? k + ':eye' : u.unfolded && BUILD[k + ':unfolded'] ? k + ':unfolded' : k; } // Core Awoken, Unfold: their own versions
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
  // models that roll (a roller's ball): the height of their middle, for a body of radius 1
  const ROLL_AT = { roller: 0.9 };
  return { kindOf, parts, height, ROLL_AT, KINDS: Object.keys(BUILD) };
};
