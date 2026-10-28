// Headless check of the Test Grid map: towers mirrored like the Mushroom Cavern's, and the treasury (TREASURY in
// src/game.js). Run from the repo root: node tools/tests/treasury.js
const assert = require('assert');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
const mk = (seed) => Game.createMatch(demo.units, demo.matrix, seed, 'testgrid');
const T = Game.TREASURY;

const m = mk(5);
assert.strictEqual(Game.COLS, 14);
assert.deepStrictEqual(m.towers, [{ col: 10, row: 16 }, { col: 3, row: 1 }], 'towers mirrored through the middle');
assert.deepStrictEqual(Game.treasurySpot(m, 0), { col: 4, row: 15 }, 'the other side of the zone, one column in, one row forward');
assert.deepStrictEqual(Game.treasurySpot(m, 1), { col: 9, row: 2 });
assert.ok(Game.occupied(m, 0, 4, 15) && Game.occupied(m, 1, 9, 2), 'its tile is kept free from round 1');
assert.ok(Game.treasuryUp(m), 'a treasury from round 1');
assert.strictEqual(Game.treasurySpot(Game.createMatch(demo.units, demo.matrix, 5, 'standard'), 0), null, 'other maps have none');

// AI vs AI to the end: from round 2 every fight has both treasuries, and the gold follows what happened to them
let fell = 0, stood = 0;
for (let seed = 1; seed <= 8; seed++) {
  const mm = mk(seed);
  for (let guard = 0; !mm.over && guard < 30; guard++) {
    Game.aiDeploy(mm, 0); Game.aiDeploy(mm, 1);
    const round = mm.round, sim = Game.startBattle(mm);
    const tb = sim.bodies.filter(b => b.squad === Game.TREASURY_SQ);
    assert.strictEqual(tb.length, round >= T.round ? 2 : 0, 'round ' + round);
    for (const b of tb) { assert.strictEqual(b.u.hp, T.hp); assert.ok(b.u.structure && b.u.lesser); }
    while (sim.step()) {}
    const before = mm.gold.slice(), sum = Game.resolve(mm, sim.result());
    if (mm.over) break;
    for (const sd of [0, 1]) {
      const f = sum.treasuryFell[sd], tr = sum.treasury[sd];
      if (round < T.round) { assert.strictEqual(f, null); assert.strictEqual(tr.gold, 0); continue; }
      if (f) { fell++; assert.strictEqual(tr.gold, 0); assert.ok(tr.lost % 50 === 0 && tr.lost <= T.stealMax, 'steal ' + tr.lost); assert.ok(tr.lost === Game.treasurySteal(before[sd]) || tr.lost < Game.treasurySteal(before[sd]), 'steal ' + tr.lost); assert.strictEqual(sum.treasury[1 - sd].stole, tr.lost); }
      else { stood++; assert.strictEqual(tr.gold, T.gold); assert.strictEqual(tr.lost, 0); }
    }
    assert.ok(mm.gold.every(g => g >= 0) && before.length === 2);
  }
  assert.ok(mm.over, 'match ends');
}
console.log('treasuries stood', stood, 'fell', fell);
assert.ok(stood > 0);

// a destroyed treasury: no gold from it, and the opponent steals a share of its owner's unspent gold
const m3 = mk(11);
Game.aiDeploy(m3, 0); Game.aiDeploy(m3, 1);
let s3 = m3.round === 1 && Game.startBattle(m3); while (s3.step()) {} Game.resolve(m3, s3.result());
Game.aiDeploy(m3, 0); Game.aiDeploy(m3, 1);
s3 = Game.startBattle(m3); while (s3.step()) {}
const r3 = s3.result(), key = '1:' + Game.TREASURY_SQ;
assert.ok(r3.squads[key]); r3.squads[key].alive = 0; r3.squads['0:' + Game.TREASURY_SQ].alive = 1;
const g3 = m3.gold.slice(), sum3 = Game.resolve(m3, r3);
assert.deepStrictEqual(sum3.treasuryFell, [false, true]);
const base = (sd) => g3[sd] + sum3.income + (sum3.bonusTo === sd ? Game.LOSER_BONUS : 0) + sum3.felix[sd] + sum3.invest[sd] - sum3.loan[sd];
const st = Game.treasurySteal(g3[1]); // a share of what side 1 left unspent, to the nearest 50
assert.strictEqual(m3.gold[0], base(0) + T.gold + st);
assert.strictEqual(m3.gold[1], base(1) - st);
// the raid: 25% of unspent gold, to the nearest 50, 50 to 200
assert.deepStrictEqual([0, 150, 300, 500, 700, 2000].map(Game.treasurySteal), [50, 50, 100, 150, 200, 200]);
console.log('treasury ok');
