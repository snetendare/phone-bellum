// Headless check of the 2026-10-28 economy changes: loans for everyone (100, pay back 200), the Bank's Credit line
// (200, pay back 300), Major investment 500 -> 800, no loser gold in rounds 1-2, and a fallen tower costing health.
// Run from the repo root: node tools/tests/economy-1028.js
const assert = require('assert');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
const mk = (seed, map = 'standard') => Game.createMatch(demo.units, demo.matrix, seed, map);
const fight = (m) => { const sim = Game.startBattle(m); while (sim.step()) {} return sim.result(); };

// a loan in round 1, without any tower: +100 now, 200 less next round
let m = mk(7);
const g0 = m.gold[0];
assert.ok(Game.canTakeLoan(m, 0), 'anyone can borrow in round 1');
assert.ok(Game.takeLoan(m, 0));
assert.strictEqual(m.gold[0], g0 + 100);
assert.ok(!Game.canTakeLoan(m, 0), 'once a round');
assert.ok(Game.undoLoan(m, 0) && m.gold[0] === g0, 'undo gives it back');
Game.takeLoan(m, 0);
Game.aiDeploy(m, 0); Game.aiDeploy(m, 1);
let sum = Game.resolve(m, fight(m));
assert.strictEqual(sum.loan[0], 200, 'paid back 200');
assert.strictEqual(sum.loan[1], 0);

// no loser gold in rounds 1 and 2; from round 3 on, as before
assert.strictEqual(sum.round, 1); assert.strictEqual(sum.bonusTo, -1, 'no loser gold in round 1');
for (let seed = 1; seed <= 6; seed++) {
  const mm = mk(seed);
  for (let guard = 0; !mm.over && guard < 12; guard++) {
    Game.aiDeploy(mm, 0); Game.aiDeploy(mm, 1);
    const s = Game.resolve(mm, fight(mm));
    if (mm.over) break;
    if (s.round < Game.LOSER_BONUS_ROUND) assert.strictEqual(s.bonusTo, -1, 'round ' + s.round);
    else assert.strictEqual(s.bonusTo, s.dmg[0] > s.dmg[1] ? 0 : s.dmg[1] > s.dmg[0] ? 1 : -1, 'round ' + s.round);
  }
}

// a fallen tower costs TOWER_FALL_HP on top of the round's damage, but never more than MAX_ROUND_DMG in all
m = mk(9); Game.aiDeploy(m, 0); Game.aiDeploy(m, 1);
const r = fight(m), hp = m.hp.slice();
r.squads['1:-2'].alive = 0; r.squads['0:-2'].alive = 1;
sum = Game.resolve(m, r);
assert.deepStrictEqual(sum.towerFell, [false, true]);
assert.strictEqual(sum.towerHp[1], Math.min(Game.TOWER_FALL_HP, Game.MAX_ROUND_DMG - sum.dmg[1]));
assert.strictEqual(m.hp[1], Math.max(0, hp[1] - sum.dmg[1] - sum.towerHp[1]));
assert.strictEqual(m.hp[0], Math.max(0, hp[0] - sum.dmg[0]));
assert.strictEqual(sum.towerHp[0], 0);
// a round that already costs the cap: the tower costs nothing more; 30 damage: the tower costs 5; 9: all of it
for (const [base, extra] of [[45, 0], [30, 5], [10, Game.TOWER_FALL_HP]]) {
  const mm = mk(9); Game.aiDeploy(mm, 0); Game.aiDeploy(mm, 1);
  const rr = fight(mm), h = mm.hp[1];
  rr.squads['1:-2'].alive = 0; rr.winner = 0; rr.timeout = false;
  // side 0's standing squads: copies of one of its squads, adding up to about base
  for (const k in rr.squads) if (rr.squads[k].side === 0 && rr.squads[k].squad >= 0) rr.squads[k].alive = 0;
  const own = mm.armies[0].find(q => !mm.units[q.unit].building);
  rr.squads['0:' + own.id] = { side: 0, squad: own.id, alive: 1, total: 1, xp: 0 };
  const tier = Game.tierOf(mm.units, own.unit), per = Game.TIER_DMG[Math.min(4, tier)];
  for (let k = 1; per * (k + 1) <= base + 0.01 && k < 40; k++) rr.squads['0:f' + k] = { side: 0, squad: own.id, alive: 1, total: 1, xp: 0 };
  const s = Game.resolve(mm, rr);
  assert.ok(s.dmg[1] + s.towerHp[1] <= Game.MAX_ROUND_DMG, 'round ' + base + ': at most the cap in all');
  assert.strictEqual(mm.hp[1], h - s.dmg[1] - s.towerHp[1]);
  assert.strictEqual(s.towerHp[1], extra, 'round ' + base);
}

// the Bank's Credit line: 200 now, 300 back; Major investment pays 800
m = mk(4242); m.round = Game.TOWER_PICK_ROUND; m.towers[0].type = 'bank'; m.gold[0] = 2000;
assert.strictEqual(Game.loanTerms(m, 0).gold, 200);
assert.strictEqual(Game.loanTerms(m, 1).gold, 100);
assert.ok(Game.takeLoan(m, 0) && m.gold[0] === 2200);
assert.ok(!Game.canBuyTowerSkill2(m, 0), 'a bank still does one thing a round');
Game.aiDeploy(m, 1);
sum = Game.resolve(m, fight(m));
assert.strictEqual(sum.loan[0], 300);
m.gold[0] = 2000; assert.ok(Game.buyTowerSkill2(m, 0));
Game.aiDeploy(m, 1);
sum = Game.resolve(m, fight(m));
assert.strictEqual(sum.invest[0], 800);
console.log('economy 2026-10-28 ok');
