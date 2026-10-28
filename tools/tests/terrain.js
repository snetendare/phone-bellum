// Headless check of map terrain (the Bridge map, made in the map editor; TERRAIN in src/game.js, the engine's terrain):
// water can't be stood on or placed on, bodies walk round it (never into it), walls block sight and shots, higher
// ground reaches further and hits harder, and the fights stay quick. Run from the repo root: node tools/tests/terrain.js
const assert = require('assert');
const Game = require('../../src/game.js');
const E = require('../../src/engine.js');
const demo = require('../../src/demo-units.json');
const mk = (seed) => Game.createMatch(demo.units, demo.matrix, seed, 'bridge');

// ---------- the map ----------
const m = mk(3);
assert.strictEqual(m.map.id, 'bridge');
assert.strictEqual(Game.COLS, 14); assert.strictEqual(Game.ROWS, 18);
const ed = Game.EDITOR_MAPS.bridge;
// its buildings are where the game puts them
assert.deepStrictEqual(m.towers, ed.buildings.filter(b => b.kind === 'tower').map(b => ({ col: b.col, row: b.row })));
for (const b of ed.buildings.filter(b => b.kind === 'treasury')) assert.deepStrictEqual(Game.treasurySpot(m, b.side), { col: b.col, row: b.row });
assert.deepStrictEqual(Game.terrainTile(m, 5, 11), { ch: '~', shape: '.', h: 0 });
assert.deepStrictEqual(Game.terrainTile(m, 6, 8), { ch: '.', shape: '.', h: 2 });
assert.strictEqual(Game.terrainTile(m, 7, 12).h, 1);
// nothing goes on the water (rows 6 and 11 are in the zones)
assert.ok(!Game.canPlaceAt(m, 0, 5, 11, 0) && !Game.canPlaceAt(m, 0, 8, 11, 0), 'no squad on the water');
assert.ok(Game.canPlaceAt(m, 0, 6, 11, 0) && Game.canPlaceAt(m, 0, 4, 11, 0), 'the bridge and the bank are fine');
// the ground rises smoothly: flat far off, a ramp up the h tile, the full height on the bridge
const T = Game.TILE, at = (col, row) => Game.tileToWorld(col, row);
assert.strictEqual(Game.groundHeight(m, at(6, 15).x, at(6, 15).y), 0);
assert.strictEqual(Game.groundHeight(m, at(6, 8).x, at(6, 8).y), 2 * Game.TERRAIN.step);
const ramp = [4, 4.5, 5, 5.5, 6].map(r => Game.groundHeight(m, at(6, 0).x, at(6, 0).y - r * T));
for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i] > ramp[i - 1], 'the ramp climbs: ' + ramp.join(' '));
const ter = Game.terrainOf(m);
assert.strictEqual(ter.cols, 14 * Game.TERRAIN.sub);
assert.ok(ter.block.some(v => v) && !ter.sight.some(v => v), 'water blocks walking, not sight');

// ---------- AI against AI: nobody ever stands in the water, and it doesn't take long ----------
const cellOf = (x, y) => { const c = Math.floor((x - ter.x0) / ter.cell), r = Math.floor((ter.y1 - y) / ter.cell); return c < 0 || r < 0 || c >= ter.cols || r >= ter.rows ? -1 : r * ter.cols + c; };
let fights = 0, ticks = 0, crossed = 0, wet = 0;
const t0 = Date.now();
for (let seed = 1; seed <= 6; seed++) {
  const mm = mk(seed);
  for (let guard = 0; !mm.over && guard < 30; guard++) {
    Game.aiDeploy(mm, 0); Game.aiDeploy(mm, 1);
    const sim = Game.startBattle(mm), start = new Map(sim.bodies.map(b => [b, b.y]));
    while (sim.step()) {
      ticks++;
      for (const b of sim.bodies) if (b.alive && !b.u.aloft && !b.boarded && ter.block[cellOf(b.x, b.y)]) wet++;
    }
    for (const b of sim.bodies) if (!b.u.aloft && start.has(b) && Math.sign(b.y) !== Math.sign(start.get(b)) && Math.abs(b.y) > T) crossed++;
    Game.resolve(mm, sim.result()); fights++;
  }
}
const ms = Date.now() - t0;
console.log(`${fights} fights, ${ticks} ticks in ${ms} ms (${(ms / ticks).toFixed(2)} ms a tick), ${crossed} bodies crossed no man's land, ${wet} body-ticks in water`);
assert.strictEqual(wet, 0, 'nobody stands in the water');
assert.ok(crossed > 0);

// ---------- the engine on a made-up grid: a wall with a gap ----------
// a 10 x 10 cell grid, 2 m cells, from (-10, 10): a wall across row 4, cells 0..7 (the gap is cells 8 and 9)
const grid = (wall = true, levels) => {
  const n = 100, block = new Uint8Array(n), sight = new Uint8Array(n), level = new Int8Array(n);
  if (wall) for (let c = 0; c < 8; c++) { block[4 * 10 + c] = 1; sight[4 * 10 + c] = 1; }
  if (levels) levels(level);
  return { cols: 10, rows: 10, cell: 2, x0: -10, y1: 10, block, sight, level };
};
const unit = (o) => E.withTraits({ name: 'U', cost: 1, bodies: 1, hp: 1000, hit: 10, aps: 1, range: 2, speed: 4, splash: 0, ...o });
const g = { dt: 0.05, timeCap: 30, spacing: 3.5, minDmgPct: 15, sight: 15, minSight: 18, drift: 15, bounds: { x0: -10, x1: 10, y0: -10, y1: 10 } };
const one = (u, side, x, y) => E.buildSquad(u, side, x, y, side, 1);
// a walker below the wall goes round through the gap to reach an enemy above it, never through the wall
{
  const a = one(unit({}), 0, -6, -6), z = one(unit({ speed: 0, hit: 0 }), 1, -6, 6);
  const bt = E.createBattle(a, z, g, { terrain: grid() });
  let maxX = -Infinity, inWall = 0, hitAt = -1;
  for (let k = 0; k < 400 && bt.step(); k++) {
    const b = a[0];
    maxX = Math.max(maxX, b.x);
    const c = Math.floor((b.x + 10) / 2), r = Math.floor((10 - b.y) / 2);
    if (r === 4 && c < 8) inWall++;
    if (hitAt < 0 && z[0].hp < z[0].u.hp) hitAt = k;
  }
  assert.strictEqual(inWall, 0, 'never in the wall');
  assert.ok(maxX > 5, 'went round by the gap (x up to ' + maxX.toFixed(1) + ')');
  assert.ok(hitAt > 0, 'and reached its enemy');
}
// a shooter with the range to hit through the wall can't: the wall blocks sight and shots. Without it, it can.
{
  const run = (wall) => {
    const a = one(unit({ range: 20, speed: 0 }), 0, -6, -4), z = one(unit({ speed: 0, hit: 0 }), 1, -6, 4);
    const bt = E.createBattle(a, z, g, { terrain: grid(wall) });
    for (let k = 0; k < 60; k++) bt.step();
    return z[0].u.hp - z[0].hp;
  };
  assert.strictEqual(run(true), 0, 'nothing through the wall');
  assert.ok(run(false) > 0, 'open ground: it shoots');
}
// height: +1 m range and +2% damage per level above the target; 4 levels (+2 over -2): +4 m and +8%; below: as much less
{
  const fight = (hA, hZ, gap) => {
    const a = one(unit({ range: 6, speed: 0, hit: 100 }), 0, 0, -gap / 2), z = one(unit({ speed: 0, hit: 0, hp: 1e6 }), 1, 0, gap / 2);
    const levels = (lv) => { for (let i = 0; i < 100; i++) lv[i] = Math.floor(i / 10) >= 5 ? hA : hZ; }; // rows 5..9 (y < 0) side 0's ground
    const bt = E.createBattle(a, z, g, { terrain: grid(false, levels) });
    for (let k = 0; k < 30; k++) bt.step();
    return z[0].u.hp - z[0].hp;
  };
  assert.strictEqual(fight(0, 0, 9), 0, 'out of range on flat ground');
  assert.ok(fight(2, -2, 9) > 0, '+4 m from the top down');
  assert.strictEqual(fight(2, 1, 9), 0, 'one level is only +1 m');
  const flat = fight(0, 0, 5), up4 = fight(2, -2, 5), up1 = fight(1, 0, 5), down = fight(-2, 2, 5);
  assert.ok(flat > 0);
  assert.ok(Math.abs(up4 / flat - 1.08) < 1e-9, '+8% for 4 levels: ' + up4 / flat);
  assert.ok(Math.abs(up1 / flat - 1.02) < 1e-9, '+2% for 1 level');
  assert.strictEqual(down, 0, 'shooting up 4 levels: 4 m less range, out of reach at 5 m');
  assert.ok(Math.abs(fight(-2, 2, 1.5) / fight(0, 0, 1.5) - 0.92) < 1e-9, '-8% shooting up 4 levels');
  assert.strictEqual(fight(-1, 0, 5.5), 0, 'and 1 m less range a level: out of reach at 5.5 m');
  assert.ok(fight(0, 0, 5.5) > 0);
}
console.log('terrain ok');
// every kind of attack stops at a wall: bursts, pierce, splash, chain lightning, projectiles
{
  const kinds = { burst: { burst: 3 }, pierce: { pierce: 3 }, splash: { splash: 4 }, chain: { chain: { jumps: 3, hit: 50, reach: 12 } }, projectile: { projSpeed: 30 }, flame: { flame: 40 } };
  for (const [k, o] of Object.entries(kinds)) {
    const run = (wall) => {
      // a target in the open (the shooter sees it) and two bodies straight behind the wall from it
      const a = one(unit({ range: 20, speed: 0, ...o }), 0, 9, -6), z = [...one(unit({ speed: 0, hit: 0 }), 1, 9, -2), ...one(unit({ speed: 0, hit: 0 }), 1, 7, 3), ...one(unit({ speed: 0, hit: 0 }), 1, 8, 6)];
      const bt = E.createBattle(a, z, g, { terrain: grid(wall) });
      // the wall: cells 0..7 of row 4 plus the gap, so the line from (9, -6) up is blocked past y = 0
      for (let k = 0; k < 60; k++) bt.step();
      return z.slice(1).reduce((s, b) => s + b.u.hp - b.hp, 0);
    };
    const full = () => { const gr = grid(true); for (let c = 0; c < 10; c++) { gr.block[40 + c] = 1; gr.sight[40 + c] = 1; } return gr; };
    const runFull = () => {
      const a = one(unit({ range: 20, speed: 0, ...o }), 0, 9, -6), z = [...one(unit({ speed: 0, hit: 0 }), 1, 9, -2), ...one(unit({ speed: 0, hit: 0 }), 1, 7, 3), ...one(unit({ speed: 0, hit: 0 }), 1, 8, 6)];
      const bt = E.createBattle(a, z, g, { terrain: full() });
      for (let k = 0; k < 60; k++) bt.step();
      return [z[0].u.hp - z[0].hp, z.slice(1).reduce((s, b) => s + b.u.hp - b.hp, 0)];
    };
    const [front, behind] = runFull();
    assert.ok(front > 0, k + ': hits the one in the open');
    assert.strictEqual(behind, 0, k + ': nothing behind the wall');
  }
}
console.log('terrain: attacks stop at walls ok');
