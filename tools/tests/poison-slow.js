// Headless check of the poison slow: a poisoned body moves POISON_SLOW % slower while the poison lasts, back to full
// speed when it wears off; slime units (they drink poison) aren't slowed. Run from the repo root: node tools/tests/poison-slow.js
const assert = require('assert');
const E = require('../../src/engine.js');
const G = { dt: 0.05, timeCap: 60, spacing: 3.5, minDmgPct: 15, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 };
assert.strictEqual(E.POISON_SLOW, 20);
// a long-range poisoner that can't move, and a walker heading for it from far away
function run(extra) {
  const shooter = E.buildSquad(E.withTraits({ name: 'P', cost: 1, bodies: 1, hp: 1e6, hit: 1, aps: 1, range: 60, speed: 0, splash: 0, poisonPct: 100, poisonDur: 2 }), 0, 0, 0, 1, 6)[0];
  const walker = E.buildSquad(E.withTraits({ name: 'W', cost: 1, bodies: 1, hp: 1e6, hit: 1, aps: 1, range: 1, speed: 4, splash: 0, ...extra }), 1, 0, 55, 2, 6)[0];
  const bt = E.createBattle([shooter], [walker], G);
  const steps = [];
  for (let k = 0; k < 60; k++) { const y = walker.y; bt.step(); steps.push({ d: Math.abs(walker.y - y), poisoned: !!(walker.poison && walker.poison.length) }); }
  return steps;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;
const full = 4 * G.dt;
const st = run({});
const pois = st.filter(s => s.poisoned && s.d > 0);
assert.ok(pois.length > 5, 'it walks while poisoned');
// (the first steps after the poison lands are still at full speed: the slow takes hold in the ongoing effects that follow)
assert.ok(pois.slice(2).every(s => near(s.d, full * 0.8)), 'poisoned: 20% slower ' + JSON.stringify(pois.slice(0, 4)));
const slime = run({ slime: true }).filter(s => s.poisoned && s.d > 0);
assert.ok(slime.length > 5 && slime.every(s => near(s.d, full)), 'slime units drink poison: no slow');
const zerk = run({ unstoppable: true }).filter(s => s.poisoned && s.d > 0);
assert.ok(zerk.length > 5 && zerk.every(s => near(s.d, full)), 'Berserkers: no slow');
console.log('poison slow ok');
