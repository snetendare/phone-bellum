// Headless check of the Standard pack (units, leaders and towers left out), the bank's one action a round and
// Frozen Peak with its hailstorm and altar switched off. Run from the repo root: node tools/tests/standard-pack.js
const assert = require('assert');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
const units = demo.units, SP = Game.STANDARD_PACK;

// every unit and leader in the pack exists, and the pack still deals starting packages
for (const n of SP.units) assert.ok(units.some(u => u.name === n), `pack unit ${n} is in the roster`);
for (const id of SP.chars) assert.ok(Game.charInfo(id), `pack leader ${id} exists`);
const off = units.map((u, i) => SP.units.includes(u.name) ? -1 : i).filter(i => i >= 0);
const offChars = Game.CHARACTERS.map(c => c.id).filter(id => !SP.chars.includes(id));
for (let seed = 1; seed <= 40; seed++) {
  const m = Game.createMatch(units, demo.matrix, seed * 7919, 'standard', null, offChars, { offUnits: off, offTowers: SP.offTowers });
  for (const sd of [0, 1]) {
    assert.strictEqual(m.packages[sd].length, Game.PACKAGE.options, 'three packages to pick from');
    for (const p of m.packages[sd]) {
      assert.ok(SP.chars.includes(p.char), `package leader ${p.char} is in the pack`);
      for (const ui of p.units) assert.ok(SP.units.includes(units[ui].name), `package unit ${units[ui].name} is in the pack`);
    }
  }
  m.round = Game.TOWER_PICK_ROUND;
  for (const sd of [0, 1]) for (const t of Game.towerChoices(m, sd)) assert.ok(!SP.offTowers.includes(t.id), `no ${t.id} tower on offer`);
  assert.ok(Game.isOff(m, units.findIndex(u => u.name === 'Slime Wizard')), 'Slime Wizard is out');
}
// the Shiv is never in a starting package, with or without the pack; each tier of the pack has five or four units
const shiv = units.findIndex(u => u.name === 'Shiv');
assert.ok(units[shiv].noPack && !Game.allPackages(units).some(p => p.units.includes(shiv)), 'no Shiv in starting packages');
assert.deepStrictEqual([1, 2, 3, 4].map(t => SP.units.filter(n => Game.tierOf(units, units.findIndex(u => u.name === n)) === t).length), [5, 5, 4, 4], 'units a tier');
// without the pack, every tower can be on offer
const seen = new Set();
for (let seed = 1; seed <= 40; seed++) { const m = Game.createMatch(units, demo.matrix, seed, 'standard'); m.round = Game.TOWER_PICK_ROUND; Game.towerChoices(m, 0).forEach(t => seen.add(t.id)); }
assert.strictEqual(seen.size, Game.TOWER_TYPES.length, 'all towers without the pack');
console.log('standard pack: units, leaders, packages and towers ok');

// the bank: a loan or the Major investment in a round, not both
const bankMatch = () => {
  const m = Game.createMatch(units, demo.matrix, 4242, 'standard');
  m.round = Game.TOWER_PICK_ROUND; m.towers[0].type = 'bank'; m.gold[0] = 2000;
  return m;
};
let m = bankMatch();
assert.ok(Game.takeLoan(m, 0), 'loan taken');
assert.ok(!Game.canBuyTowerSkill2(m, 0) && !Game.buyTowerSkill2(m, 0), 'no investment after a loan this round');
assert.ok(Game.undoLoan(m, 0), 'loan paid back');
assert.ok(Game.buyTowerSkill2(m, 0), 'investment once the loan is paid back');
assert.ok(!Game.canTakeLoan(m, 0) && !Game.takeLoan(m, 0), 'no loan after the investment this round');
m.round++;
assert.ok(Game.takeLoan(m, 0), 'a loan again the next round');
// the other towers' second skills don't care about loans
m = bankMatch(); m.towers[0].type = 'bastion';
assert.ok(Game.buyTowerSkill2(m, 0), 'bastion Moats as usual');
console.log('bank: one action a round ok');

// Frozen Peak: the floor stays, the hailstorm and the altar are off
m = Game.createMatch(units, demo.matrix, 99, 'ice');
assert.strictEqual(Game.mapOf(m).id, 'ice');
for (let r = 1; r <= 6; r++) { m.round = r; assert.ok(!Game.isIce(m) && !Game.hailRound(m) && !Game.altarRound(m), `no hail or altar in round ${r}`); }
console.log('Frozen Peak: no map extras ok');
