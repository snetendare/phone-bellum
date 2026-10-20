// Headless checks of the Mechites' fight mechanics: rolling, building turrets, linked health, the healbot,
// skills that need other skills. Run from the repo root (after node tools/counter-table.js): node tools/tests/mechites.js
const assert = require('assert');
const E = require('../../src/engine.js'), Game = require('../../src/game.js');
const F = require('../../src/faction-units.json');
const g = { ...Game.SETTINGS };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const skill = (id) => F.skills.find(s => s.id === id);
const unit = (name, ...skills) => E.applySkills({ ...E.withTraits(F.units.find(u => u.name === name)), cost: 1 }, skills.map(skill), F.units);
// a target that never moves and never hurts anyone
const DUMMY = E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp: 1e6, hit: 0, aps: 0.01, range: 0.5, speed: 0, splash: 0 });
const squad = (u, side, x, y, id, level) => E.buildSquad(u, side, x, y, id, Game.TILE, id * 10, level || 0);
const run = (bt, secs) => { for (let k = 0; k < secs / g.dt - 1e-9 && bt.step(); k++); };

// ---------- Rollers ----------
{
  // speed climbs from 1 to 7 m/s over 2 s
  const [r] = squad({ ...unit('Rollers'), bodies: 1 }, 0, 0, -30, 1);
  const bt = E.createBattle([r], squad(DUMMY, 1, 0, 30, 2), g);
  run(bt, 1); near(r.rollV, 4, 0.2, 'roller at 1 s');
  run(bt, 1.2); near(r.rollV, 7, 1e-9, 'roller at full speed');
  // it rolls through the dummy, carries on a tile past it and stops
  let passed = null;
  for (let k = 0; k < 400 && bt.step(); k++) if (r.y > 30 && r.rollV <= E.ROLL_START + 1e-9) { passed = r.y; break; }
  assert.ok(passed != null, 'roller stopped past its target');
  near(passed - 30, E.ROLL_PAST, 1, 'stops about a tile past its target');
  assert.ok(bt.bodies[1].hp < 1e6, 'the dummy was run over');
}
{
  // Momentum: full speed twice as fast
  const [r] = squad({ ...unit('Rollers', 'rollerMomentum'), bodies: 1 }, 0, 0, -30, 1);
  const bt = E.createBattle([r], squad(DUMMY, 1, 0, 30, 2), g);
  run(bt, 1.05); near(r.rollV, 7, 1e-9, 'momentum: full speed after 1 s');
  // Stone plating: +4 armor, +15% health
  const p = unit('Rollers', 'rollerPlating');
  assert.strictEqual(p.bonusArmor, 4); near(p.hp, 400 * 1.15, 1e-9, 'plating health');
}
{
  // a roller nearly one-shots a Skeleton Archer and keeps coming back
  const demo = require('../../src/demo-units.json'), sa = E.withTraits(demo.units.find(u => u.name === 'Skeleton Archers'));
  const res = E.battle(unit('Rollers'), sa, { ...g, budget: 1, distance: 42 });
  console.log('Rollers vs Skeleton Archers (100 gold each): winner', res.winner, 'time', res.time.toFixed(1));
}

// ---------- Cog Builder ----------
{
  const b = squad(unit('Cog Builder'), 0, 0, -40, 1);
  const bt = E.createBattle(b, squad(DUMMY, 1, 0, 30, 2), g);
  let startT = null, doneT = null;
  for (let k = 0; k < 600 && bt.step(); k++) {
    if (startT == null && b[0].buildT > 0) { startT = bt.time(); assert.ok(30 - b[0].y <= 24.01, 'starts building within range'); }
    if (doneT == null && b[0].built) { doneT = bt.time(); break; }
  }
  near(doneT - startT, 1.5, 0.06, 'one builder builds in 1.5 s');
  bt.step();
  const t = bt.bodies.filter(x => x.u.name === 'Cog Turret');
  assert.strictEqual(t.length, 1, 'one turret');
  assert.ok(t[0].u.construct && t[0].u.noCount && t[0].credit === b[0], 'a construct, credited to its builder');
  assert.strictEqual(t[0].u.hp, 100); assert.strictEqual(t[0].u.range, 25); assert.strictEqual(t[0].u.aps, 1.5);
  const y0 = b[0].y; run(bt, 1); assert.ok(b[0].y > y0, 'the builder walks on after building');
  run(bt, 3);
  assert.ok(t[0].dealt > 0, 'the turret shoots');
  const res = bt.result();
  assert.ok(res.squads['0:1'].xp > 0, 'turret XP goes to the builder squad');
}
{
  // Twin turrets: two, a tile apart across the enemy's direction; Master engineering: half the build time, better turrets
  const b = squad(unit('Cog Builder', 'twinTurrets', 'masterEngineering'), 0, 0, -40, 1, 1);
  const bt = E.createBattle(b, squad(DUMMY, 1, 0, 30, 2), g);
  let startT = null;
  for (let k = 0; k < 600 && bt.step(); k++) { if (startT == null && b[0].buildT > 0) startT = bt.time(); if (b[0].built) break; }
  near(bt.time() - startT, 0.75, 0.06, 'master engineering builds in 0.75 s');
  bt.step();
  const t = bt.bodies.filter(x => x.u.name === 'Cog Turret');
  assert.strictEqual(t.length, 2, 'twin turrets');
  near(Math.abs(t[0].x - t[1].x), E.BUILD_GAP, 1e-6, 'a tile apart');
  near(t[0].u.aps, 1.8, 1e-9, '+20% attack speed'); assert.strictEqual(t[0].shield, 2); assert.strictEqual(t[0].u.bonusArmor, 2);
  near(t[0].u.hp, 200, 1e-9, 'a level 2 builder builds level 2 turrets');
}
{
  // two builders side by side help each other: 1.5x
  const u = unit('Cog Builder');
  const A = squad(u, 0, -3, -40, 1).concat(squad(u, 0, 3, -40, 2));
  const bt = E.createBattle(A, squad(DUMMY, 1, 0, 30, 3), g);
  let startT = null;
  for (let k = 0; k < 600 && bt.step(); k++) { if (startT == null && A[0].buildT > 0) startT = bt.time(); if (A[0].built) break; }
  near(bt.time() - startT, 1, 0.06, 'two builders together build in 1 s');
}
{
  // a turret alone doesn't keep a side in the fight
  const b = squad(unit('Cog Builder'), 0, 0, -40, 1);
  const bt = E.createBattle(b, squad(DUMMY, 1, 0, 30, 2), g);
  for (let k = 0; k < 600 && bt.step() && !b[0].built; k++);
  bt.step();
  b[0].hp = 0; b[0].alive = false;
  assert.ok(!bt.step(), 'fight over once only constructs are left');
  assert.strictEqual(bt.result().winner, 1);
}

// ---------- Mechite Guards ----------
{
  // Linked cores: one hit is shared by all three bodies, and they fall together
  const G = squad(unit('Mechite Guards', 'guardLink'), 1, 0, 30, 1);
  const hitter = E.withTraits({ name: 'Hitter', cost: 1, bodies: 1, hp: 1e6, hit: 102, aps: 1, range: 60, speed: 0, splash: 0 });
  const bt = E.createBattle(squad(hitter, 0, 0, -10, 2), G, g);
  for (let k = 0; k < 400 && bt.step() && G[0].hp === G[0].u.hp; k++);
  const max = 340 * 1.15, lost = 100 / 3; // 102 hit − 2 armor, split three ways
  for (const x of G) near(x.hp, max - lost, 1e-6, 'shared damage');
  for (let k = 0; k < 4000 && bt.step(); k++);
  const ticks = new Set(G.map(x => x.diedTick));
  assert.ok(G.every(x => !x.alive) && ticks.size === 1, 'they fall together');
}
{
  // Healbot: stands behind its squad, follows it, heals 4% a second, never attacks
  const G = squad(unit('Mechite Guards', 'guardHealbot'), 0, 0, -30, 1);
  const bt = E.createBattle(G, squad(DUMMY, 1, 0, 30, 2), g);
  const hb = bt.bodies.find(x => x.u.name === 'Healbot');
  assert.ok(hb && hb.follow.length === 3 && hb.u.noCount && hb.u.construct, 'a healbot with the squad');
  G[0].hp = 100;
  run(bt, 1);
  near(G[0].hp, 100 + 340 * 0.04, 0.5, 'heals 4% a second');
  run(bt, 5);
  assert.ok(Math.abs(hb.y - G[0].y) < 6, 'follows its squad');
  assert.ok(!hb.dealt, 'never attacks');
}
{
  // Oiled pumps: +25% attack speed, range kept
  const u = unit('Mechite Guards', 'guardRapid');
  near(u.aps, 0.375, 1e-9, 'fire rate'); assert.strictEqual(u.range, 10);
}

// ---------- in a match ----------
Game.setFactions(F.factions); Game.setBuildings(F.buildings);
const mu = F.units.map(u => ({ ...E.withTraits(u), skillDefs: E.SLOTS.map(k => (u.skills && F.skills.find(s => s.id === u.skills[k])) || null) })); // as the page resolves them
const mm = Game.createMatch(mu, F.matrix, 7, null, null, [], { factions: [['mechites'], ['mechites']] });
const cb = mu.findIndex(u => u.name === 'Cog Builder');
mm.gold[0] = 5000; mm.unlocks[0][cb] = 1;
assert.ok(Game.place(mm, 0, cb, 5, Game.zoneRows(0)[0]), 'place a cog builder');
assert.ok(!Game.canBuySkill(mm, 0, cb, 2), 'Master engineering needs Twin turrets first');
assert.deepStrictEqual(Game.skillNeedsMissing(mm, 0, cb, 2), [0, 1]);
assert.ok(!Game.buySkill(mm, 0, cb, 0), 'Build factory needs a tile');
const row0 = Game.zoneRows(0)[4];
assert.ok(!Game.buyBuilding(mm, 0, cb, 0, 5, Game.zoneRows(0)[0]), 'not on a squad');
assert.ok(Game.buyBuilding(mm, 0, cb, 0, 3, row0), 'Build factory placed');
assert.ok(Game.occupied(mm, 0, 3, row0) && !Game.place(mm, 0, cb, 3, row0), 'its tile is taken');
assert.ok(!Game.canBuyBuilding(mm, 0, cb, 0), 'one factory');
assert.ok(Game.buySkill(mm, 0, cb, 1) && Game.buySkill(mm, 0, cb, 2), 'Twin turrets, then Master engineering');
assert.ok(!Game.undoSkill(mm, 0, cb, 1) && !Game.undoSkill(mm, 0, cb, 0), 'skills stay while Master engineering is owned');
assert.ok(Game.undoSkill(mm, 0, cb, 2) && Game.undoSkill(mm, 0, cb, 1) && Game.undoSkill(mm, 0, cb, 0), 'undo in order');
assert.strictEqual(Game.buildingsOf(mm, 0).length, 0, 'taking back Build factory takes the factory back');
// Frickolas Cage's +10% health reaches the turret too
mm.chars[0] = 'cage';
near(Game.unitFor(mm, 0, cb).build.unit.hp, 110, 1e-9, 'Cage: tougher turrets');
// a whole fight runs the same way twice (both phones must agree)
const fight = () => {
  const m = Game.createMatch(mu, F.matrix, 11, null, null, [], { factions: [['mechites'], ['mechites']] });
  for (let r = 0; r < 4 && !m.over; r++) { Game.aiDeploy(m, 0); Game.aiDeploy(m, 1); const bt = Game.startBattle(m); while (bt.step()); Game.resolve(m, bt.result()); }
  return JSON.stringify([m.hp, m.history.map(h => [h.winner, h.time, h.dmg])]);
};
assert.strictEqual(fight(), fight(), 'deterministic');
console.log('mechites ok', fight());
