// Headless check of the tutorial's scripted fights (TUT in src/site-template.html): round 1 (your Goblin Swarm
// against their hidden Skeleton Archers) is lost wherever in your zone you place it, and round 2 (Fire Mage added,
// the goblins where they stood) is won wherever you place the Fire Mage. Run it after changing those units or the
// engine. Run from the repo root: node tools/tests/tutorial.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const DATA = require('../../src/demo-units.json');
// the units as the page loads them (useSet with the built-in set)
const units = DATA.units.map(u => ({ ...E.withTraits(u), level: 0, bodies: Math.max(1, Math.round(u.bodies)),
  skillDefs: E.SLOTS.map(k => (Array.isArray(u.skills) && (DATA.skills || []).find(sk => sk.id === u.skills[k])) || null) }));
const ix = (n) => { const i = units.findIndex(u => u.name === n); assert.ok(i >= 0, n); return i; };
const TUT = { start: 'Goblin Swarm', foe: 'Skeleton Archers', foeAt: [6, 4], counter: 'Fire Mage' }; // as in TUT
const clone = (m) => ({ ...JSON.parse(JSON.stringify({ ...m, units: null, matrix: null })), units: m.units, matrix: m.matrix });

// the match as startTutorial makes it, with the player's goblins placed on (col, row)
function round1(col, row) {
  const m = Game.createMatch(units, DATA.matrix, 1, 'standard');
  m.packages = [[], []];
  m.unlocks[0][ix(TUT.start)] = 1; m.unlocks[0][ix(TUT.counter)] = 1;
  m.unlocks[1][ix(TUT.foe)] = 1; m.gold[1] = Game.SQUAD_COST * 9; Game.place(m, 1, ix(TUT.foe), ...TUT.foeAt); m.gold[1] = 0;
  m.towers[1] = null;
  m.gold[0] = Game.SQUAD_COST;
  if (!Game.place(m, 0, ix(TUT.start), col, row)) return null;
  return m;
}
// the fight as runFight plays it
function fight(m) {
  const bt = Game.startBattle(m);
  while (bt.step()) {}
  return Game.resolve(m, bt.result());
}
const zone = [];
for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) if (Game.inZone(0, r)) zone.push([c, r]);
let n1 = 0, n2 = 0;
for (const [c, r] of zone) {
  const m = round1(c, r);
  if (!m) continue;
  const s1 = fight(m);
  n1++;
  assert.strictEqual(s1.winner, 1, `round 1 with the goblins on ${c},${r}: the archers win (${JSON.stringify(s1.winner)})`);
  assert.ok(m.hp[0] < Game.START_HP, 'and you take damage');
  if ((c + r) % 3) continue; // round 2 from a third of the goblins' tiles, the Fire Mage on every tile
  for (const [c2, r2] of zone) {
    const m2 = clone(m);
    m2.gold[0] = Math.max(m2.gold[0], Game.SQUAD_COST * 3);
    if (!Game.place(m2, 0, ix(TUT.counter), c2, r2)) continue;
    const s2 = fight(m2);
    n2++;
    assert.strictEqual(s2.winner, 0, `round 2 with the goblins on ${c},${r} and the Fire Mage on ${c2},${r2}: you win (${s2.winner})`);
  }
}
assert.ok(n1 > 50 && n2 > 500, `enough placements tried (${n1}, ${n2})`);
console.log(`tutorial ok: round 1 lost from ${n1} tiles, round 2 won in ${n2} placements`);
