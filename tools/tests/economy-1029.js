// Headless check of the 2026-10-29 economy: the 500-gold carry cap and the shutdown bounty for breaking a win streak.
// Run from the repo root: node tools/tests/economy-1029.js
const assert = require('assert');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
const mk = (seed) => Game.createMatch(demo.units, demo.matrix, seed, 'standard');
const fight = (m) => { const sim = Game.startBattle(m); while (sim.step()) {} return sim.result(); };

assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(Game.shutdownGold), [0, 0, 0, 100, 150, 200]);

// the carry cap: gold over CARRY_CAP is lost before the new round's gold comes in
let m = mk(3);
Game.aiDeploy(m, 0); Game.aiDeploy(m, 1);
m.gold[0] = 800; m.gold[1] = 120;
let sum = Game.resolve(m, fight(m));
assert.deepStrictEqual(sum.capLost, [300, 0]);
const extra = (sd) => sum.income + (sum.bonusTo === sd ? Game.LOSER_BONUS : 0) + sum.shutdown[sd] + (sum.felix[sd] || 0) + sum.treasury[sd].gold + (sum.treasury[sd].stole || 0) - sum.treasury[sd].lost + sum.objective[sd] + sum.markBounty[sd] + sum.invest[sd] - sum.loan[sd];
assert.strictEqual(m.gold[0], Game.CARRY_CAP + extra(0));
assert.strictEqual(m.gold[1], 120 + extra(1));

// streaks and the shutdown bounty, played out over real bot matches
let paid = 0;
for (let seed = 1; seed <= 25; seed++) {
  const mm = mk(seed);
  for (let guard = 0; !mm.over && guard < 20; guard++) {
    const st = mm.streak.slice();
    Game.aiDeploy(mm, 0); Game.aiDeploy(mm, 1);
    const s = Game.resolve(mm, fight(mm));
    if (mm.over) break;
    const w = s.dmg[0] < s.dmg[1] ? 0 : s.dmg[1] < s.dmg[0] ? 1 : -1;
    for (const sd of [0, 1]) {
      assert.strictEqual(mm.streak[sd], sd === w ? st[sd] + 1 : 0, `streak seed ${seed}`);
      assert.strictEqual(s.shutdown[sd], sd === w ? Game.shutdownGold(st[1 - sd]) : 0, `bounty seed ${seed}`);
      paid += s.shutdown[sd];
    }
  }
}
assert.ok(paid > 0, 'some streak got shut down');
console.log('economy 2026-10-29 ok');
