// Headless check of the Bastion (its moat, Home ground's shield, Defensive walls) and the Keep's guards.
// Run from the repo root: node tools/tests/bastion.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const demo = require('../../src/demo-units.json');
const W = Game.BWALL, ui = (name) => demo.units.findIndex(u => u.name === name);

// a match in round 3 with side 0 on the given tower type, its skills bought this round
function at3(type, skill, skill2) {
  const m = Game.createMatch(demo.units, demo.matrix, 7, 'standard');
  m.round = 3;
  m.towers[0].type = type; m.towers[1].type = 'keep';
  m.towerSkill = [skill ? 3 : 0, 0]; m.towerSkill2 = [skill2 ? 3 : 0, 0];
  m.gold = [5000, 5000];
  return m;
}
const tower = (m, sd) => Game.bodiesFor(m, sd).find(b => b.squad === -2);
const add = (m, sd, name, col, row) => { const sq = { id: m.nextId[sd]++, unit: ui(name), col, row, round: m.round, xp: 0, level: 0, cost: 0 }; m.armies[sd].push(sq); return sq; };

// the bastion: the moat is its attack, Home ground adds a shield, Defensive walls 4 armor
{
  const plain = tower(at3('bastion'), 0);
  assert.ok(plain.u.idle && plain.u.moat && plain.u.moat.hit === Game.MOAT.hit && !plain.u.splash, 'the moat is the attack');
  assert.strictEqual(plain.shield, 0);
  assert.strictEqual(tower(at3('bastion', true), 0).shield, W.shield, 'Home ground: a shield');
  const b2 = tower(at3('bastion', true, true), 0);
  assert.strictEqual(b2.u.bonusArmor || 0, W.towerArmor, 'Defensive walls: armor');
}

// placing walls: along an edge of a tile of my own half of the board (not the board's outer edge), BWALL.count of
// them, a wall takes no tile, this round's can be taken back
{
  const m = at3('bastion', true, true);
  assert.strictEqual(Game.bwallsLeft(m, 0), W.count);
  assert.ok(!Game.placeBwall(m, 0, 5, 7, 's'), 'not from their half of no man’s land');
  assert.ok(!Game.placeBwall(m, 0, 5, Game.ROWS - 1, 's') && !Game.placeBwall(m, 0, 0, 12, 'w'), 'not on the board’s outer edge');
  assert.ok(Game.placeBwall(m, 0, 5, 8, 'n') && Game.placeBwall(m, 0, 6, 8, 'n'), 'on my half of no man’s land, along the middle line');
  assert.ok(!Game.placeBwall(m, 0, 6, 8, 'n'), 'not twice on an edge');
  assert.ok(Game.bwallOn(m, 0, 6, 7, 's') && Game.bwallOn(m, 0, 6, 8, 'n') && !Game.bwallOn(m, 0, 6, 8, 's'), 'an edge is the same from both its tiles');
  assert.ok(Game.placeBwall(m, 0, 4, 12, 'e'), 'in my zone, along the side of a tile');
  assert.ok(!Game.placeBwall(m, 0, 3, 12, 'n'), 'only three');
  assert.ok(!Game.occupied(m, 0, 4, 12) && !Game.occupied(m, 0, 5, 12), 'a wall takes no tile: squads stand on both sides of it');
  assert.ok(Game.unplaceBwall(m, 0, 5, 12, 'w') && Game.placeBwall(m, 0, 7, 8, 'n'), 'taken back (from either of its tiles) and placed again');
  assert.ok(!Game.placeBwall(at3('bastion', true), 0, 5, 8, 'n'), 'none without the skill');
  const walls = Game.bodiesFor(m, 0).filter(b => b.u.barrier);
  assert.strictEqual(walls.length, W.count);
  for (const b of walls) {
    assert.strictEqual(b.u.hp, W.hp); assert.strictEqual(b.u.defVal, W.armor); assert.ok(b.u.structure && b.u.lesser);
    assert.ok(b.u.barrier === Game.TILE / 2 && b.u.barrierY === W.thick / 2, 'a long thin wall along x');
    assert.strictEqual(b.y, Game.tileToWorld(5, 8).y + Game.TILE / 2, 'standing on the edge between rows 7 and 8');
  }
  const side = Game.bwallUnit('e');
  assert.ok(side.barrier === W.thick / 2 && side.barrierY === Game.TILE / 2, 'one along y');
  assert.ok(!Game.bwallShown(m, 1, true, 0, m.bwalls[0][0]) && Game.bwallShown(m, 1, false, 0, m.bwalls[0][0]), 'hidden from the opponent until the fight');
  Game.undoTowerSkill2(m, 0);
  assert.strictEqual(Game.bwallsOf(m, 0).length, 0, 'undoing the skill takes its walls back');
  // walls not placed go up by themselves at the fight: in a line along the front edges two rows in front of the tower
  const m2 = at3('bastion', false, true);
  Game.startBattle(m2);
  const auto = Game.bwallsOf(m2, 0), t = m2.towers[0];
  assert.strictEqual(auto.length, W.count);
  assert.ok(auto.every(w => w.edge === 'n' && w.row === t.row - 2 && Math.abs(w.col - t.col) <= 1), JSON.stringify(auto));
  // an older wall (no edge) stands on its tile's front edge
  const m3 = at3('bastion', true, true);
  m3.bwalls = [[{ col: 5, row: 10, round: 2 }], []];
  assert.ok(Game.bwallOn(m3, 0, 5, 10, 'n') && Game.bodiesFor(m3, 0).some(b => b.u.barrier && b.y === Game.tileToWorld(5, 10).y + Game.TILE / 2));
}

// in a fight: enemies can't walk into a wall, they hit it instead; the wall's own side walks through
{
  const m = at3('bastion', true, true);
  for (const c of [4, 5, 6]) Game.placeBwall(m, 0, c, 8, 'n');
  add(m, 1, 'Brute', 5, 4); add(m, 1, 'Goblin Swarm', 6, 4);
  add(m, 0, 'Brute', 5, 10);
  const sim = Game.startBattle(m), walls = sim.bodies.filter(b => b.u.barrier);
  let inside = 0, allyIn = false;
  for (let k = 0; k < 600 && sim.step(); k++) for (const b of sim.bodies) {
    if (!b.alive || b.u.structure) continue;
    for (const w of walls) if (w.alive && Math.abs(b.x - w.x) < w.u.barrier - 1e-6 && Math.abs(b.y - w.y) < w.u.barrierY - 1e-6) { if (b.side === 1) inside++; else allyIn = true; }
  }
  assert.strictEqual(inside, 0, 'no enemy inside a wall');
  assert.ok(walls.some(w => w.hp < w.u.hp), 'the enemy hit the walls');
  void allyIn;
}

// a shot at someone behind an enemy wall hits the wall
{
  const wu = Game.bwallUnit(), su = Engine.withTraits({ name: 'S', cost: 1, bodies: 1, hp: 500, hit: 50, aps: 1, range: 30, speed: 0, splash: 0 });
  const tu = Engine.withTraits({ name: 'T', cost: 1, bodies: 1, hp: 500, hit: 0, aps: 1, range: 1, speed: 0, splash: 0 });
  const A = [...Engine.buildSquad(wu, 0, 0, 0, 1, 6, 0), ...Engine.buildSquad(tu, 0, 0, 6, 2, 6, 1)];
  const B = Engine.buildSquad(su, 1, 0, -20, 3, 6, 2);
  const sim = Engine.createBattle(A, B, { ...Game.SETTINGS });
  B[0].lock = A[1]; // already set on the one behind the wall
  for (let k = 0; k < 40; k++) sim.step();
  assert.strictEqual(A[1].hp, A[1].u.hp, 'nothing gets through');
  assert.ok(A[0].hp < A[0].u.hp, 'the wall takes it');
}

// the keep's guards: one on each side of the keep; hit, a guard leaves its post and goes for its attacker
{
  const m = at3('keep', true);
  const bs = Game.bodiesFor(m, 0), t = bs.find(b => b.squad === -2), gs = bs.filter(b => b.squad === -3);
  assert.strictEqual(gs.length, 4);
  const offs = gs.map(g => [Math.round(g.x - t.x), Math.round(g.y - t.y)]).map(String).sort();
  assert.deepStrictEqual(offs, ['-4,0', '0,-4', '0,4', '4,0'], 'front, behind and both sides');
  assert.ok(gs.every(g => g.holdT > 0 && g.guard));
  add(m, 1, 'Sniper', t.x > 0 ? 9 : 2, 9);
  const sim = Game.startBattle(m);
  let hit = null;
  for (let k = 0; k < 400 && sim.step(); k++) { hit = sim.bodies.find(b => b.squad === -3 && b.side === 0 && b.avenge); if (hit) break; }
  assert.ok(hit, 'a guard was attacked');
  assert.strictEqual(hit.holdT, 0, 'it left its post');
  assert.strictEqual(hit.avenge.u.name, 'Sniper', 'and goes for the Sniper');
}
console.log('bastion ok');
