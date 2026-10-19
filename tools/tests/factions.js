// Headless check of the Factions gamemode framework: draft, faction rosters, towers, AI rounds.
// Uses six throwaway test factions made from the standard roster. Run from the repo root: node tools/tests/factions.js
const assert = require('assert');
const E = require('../../src/engine.js'), Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
// six test factions of three standard units each
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const list = ids.map((id, k) => ({ id, name: 'Test ' + id.toUpperCase(), color: '#88AA66', theme: 'test', trait: k === 0 ? { name: 'Tough', text: '+20% health', hp: 20 } : null,
  tower: { name: 'Tower ' + id, text: 'test tower', unit: { hp: 600 + k * 10, range: 10 } }, units: demo.units.slice(k * 3, k * 3 + 3).map(u => u.name) }));
Game.setFactions(list);
const all = { units: [], matrix: null, skills: demo.skills };
const keep = [];
list.forEach((f, k) => demo.units.slice(k * 3, k * 3 + 3).forEach((u, j) => { all.units.push({ ...u, faction: f.id }); keep.push(k * 3 + j); }));
all.matrix = keep.map(i => keep.map(j => demo.matrix[i][j]));

assert.ok(Game.draftPossible());
// draft: snake order, A B B A
const d = Game.createDraft(1);
assert.deepStrictEqual(Game.draftTurn(d), { side: 1, act: 'pick' });
assert.ok(!Game.draftAct(d, 0, 'a'), 'not your turn');
assert.ok(Game.draftAct(d, 1, 'a'));
assert.ok(!Game.draftAct(d, 0, 'a'), 'already taken');
assert.strictEqual(Game.draftTurn(d).side, 0);
for (let guard = 0; !Game.draftDone(d) && guard < 10; guard++) { const t = Game.draftTurn(d); assert.ok(Game.draftAct(d, t.side, Game.aiDraftChoice(d, t.side, all, 99))); }
assert.ok(Game.draftDone(d));
assert.strictEqual(d.picks[0].length, 2); assert.strictEqual(d.picks[1].length, 2);
assert.strictEqual(new Set([...d.picks[0], ...d.picks[1]]).size, 4);
console.log('draft', JSON.stringify(d.picks));

// the match roster: the four drafted factions' units
const set = Game.factionSet(all, [...d.picks[0], ...d.picks[1]]);
assert.strictEqual(set.units.length, 12); assert.strictEqual(set.matrix.length, 12);
const units = set.units.map(u => E.withTraits(u));
for (let seed = 1; seed <= 6; seed++) {
  const m = Game.createMatch(units, set.matrix, seed, 'forest', null, [], { factions: d.picks });
  assert.strictEqual(m.map.id, 'standard', 'Factions mode is on the standard map');
  for (const sd of [0, 1]) {
    for (const p of m.packages[sd]) for (const ui of p.units) assert.ok(d.picks[sd].includes(units[ui].faction), 'package unit of own faction');
    units.forEach((u, ui) => assert.strictEqual(Game.isOff(m, ui, sd), !d.picks[sd].includes(u.faction)));
  }
  for (let round = 0; round < 12 && !m.over; round++) {
    Game.aiDeploy(m, 0); Game.aiDeploy(m, 1);
    if (m.round === Game.TOWER_PICK_ROUND) {
      for (const sd of [0, 1]) assert.deepStrictEqual(Game.towerChoices(m, sd).map(t => t.faction), d.picks[sd]);
      assert.ok(!Game.setTowerType(m, 0, 'keep'), 'no standard towers in Factions mode');
    }
    for (const sd of [0, 1]) for (const s of m.armies[sd]) assert.ok(d.picks[sd].includes(units[s.unit].faction), 'squad of own faction');
    Game.aiLevel(m, 0); Game.aiLevel(m, 1);
    const sim = Game.startBattle(m); while (sim.step()) {}
    Game.resolve(m, sim.result());
    if (m.round > Game.TOWER_PICK_ROUND) for (const sd of [0, 1]) assert.ok(Game.towerType(m, sd).faction, 'a faction tower');
  }
  console.log('seed', seed, 'round', m.round, 'hp', m.hp.join('/'), 'towers', Game.towerType(m, 0).name, '/', Game.towerType(m, 1).name);
}
// the trait: faction a has +20% health
const ua = all.units.findIndex(u => u.faction === 'a');
const ma = Game.createMatch(all.units, all.matrix, 1, null, null, [], { factions: [['a', 'b'], ['c', 'd']] });
assert.ok(Math.abs(Game.unitFor(ma, 0, ua).hp - all.units[ua].hp * 1.2) < 1e-9);
// a normal match is unchanged: no factions, every unit open to both
const mn = Game.createMatch(demo.units, demo.matrix, 5);
assert.strictEqual(mn.factions, null); assert.ok(!Game.isOff(mn, 0, 0) && !Game.isOff(mn, 0, 1));
console.log('factions ok');
