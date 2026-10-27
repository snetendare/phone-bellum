// Headless check of the Frost Wizard (Frost stacks, Deepfreeze, Multibeam, Glacial gaze, Snow storm) and the Obelisk
// (Glut: eating, the per-round cap, the most stacks, kept between rounds, Gluttony, Hunger's haste, Crushing maw, Eye of
// the Obelisk only at full Glut). Run from the repo root: node tools/tests/frost-obelisk.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
const roster = require('../../src/default-roster.json');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };
const unit = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
const skill = (id) => { const s = roster.skills.find(x => x.id === id); assert.ok(s, id); return s; };
const withSkills = (n, ids) => E.applySkills(unit(n), ids.map(skill), roster.units);
const body = (u, side, x, y, sq = side * 10) => E.buildSquad(u, side, x, y, sq, 6)[0];
const dummy = (hp, extra) => E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra });
const steps = (bt, s) => { for (let k = 0; k < Math.round(s / G.dt); k++) bt.step(); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// the roster
{
  const f = unit('Frost Wizard');
  assert.ok(f.cost === 3 && f.bodies === 1 && f.range === 25 && f.projSpeed === 0 && f.frost && f.frost.every === 2.5 && f.frost.pct.join() === '20,30,40', 'Frost Wizard: a 25 m beam with Frost');
  assert.deepStrictEqual(f.skillOr, [[1, 2]]); assert.deepStrictEqual(f.skillNeedsAny[3], [1, 2]);
  assert.ok(skill(f.skills[3]).master && skill(f.skills[3]).flat, 'Snow storm is a Master skill');
  const o = unit('Obelisk');
  assert.ok(o.cost === 3 && o.bodies === 1 && o.range === 3 && o.glut && o.glut.max === 12 && o.glut.cap === 2, 'Obelisk: melee, Glut up to 12, 2 a round');
  assert.deepStrictEqual(o.skillOr, [[1, 2]]);
  assert.strictEqual(o.lifesteal, 50, 'it heals for 50% of the damage it deals');
  const eye = skill(o.skills[3]); assert.ok(eye.flat && !eye.master && eye.needs === 'glutMax', 'Eye of the Obelisk: an Awaken skill that needs full Glut');
  for (const n of ['Frost Wizard', 'Obelisk']) assert.ok(demo.units.some(u => u.name === n), n + ' is in the counter table');
}
// Frost: a stack on the first hit, another every 2.5 s of beam, up to 3 (20/30/40% slower); melts 2 s after
{
  const fw = body(unit('Frost Wizard'), 0, 0, -20), d = body(dummy(1e6), 1, 0, 0);
  const bt = E.createBattle([fw], [d], G);
  for (let k = 0; k < 200 && !d.frost; k++) bt.step();
  assert.ok(d.frost && d.frost.n === 1, 'the first hit gives a stack');
  assert.ok(d.slowMove === 20 && d.slowAtk === 20 && d.slowT > 0, '1 stack: 20% slower');
  steps(bt, 2.5); assert.strictEqual(d.frost.n, 2); assert.strictEqual(d.slowMove, 30);
  steps(bt, 2.5); assert.strictEqual(d.frost.n, 3); assert.strictEqual(d.slowAtk, 40);
  steps(bt, 5); assert.strictEqual(d.frost.n, 3, 'tops out at 3 without Deepfreeze');
  assert.ok(!(d.stunT > 0), 'no freeze without Deepfreeze');
  fw.stunT = 100; // the beam stops: the frost melts 2 s later
  steps(bt, 1.5); assert.ok(d.frost, 'still frosty after 1.5 s');
  steps(bt, 1); assert.strictEqual(d.frost, null, 'melted after 2 s'); steps(bt, 0.2); assert.ok(!(d.slowT > 0), 'and the slow is gone');
}
// Deepfreeze: the 4th stack freezes it solid for 2 s, and the stacks start over
{
  const fw = body(withSkills('Frost Wizard', ['deepfreeze']), 0, 0, -20), d = body(dummy(1e6), 1, 0, 0);
  const bt = E.createBattle([fw], [d], G);
  let t0 = null, frozeAt = null, stun = 0;
  for (let k = 0; k < 400; k++) { bt.step(); if (d.frost && t0 == null) t0 = bt.time(); if (d.stunT > 0 && frozeAt == null) { frozeAt = bt.time(); stun = d.stunT; } }
  assert.ok(frozeAt != null && Math.abs(frozeAt - t0 - 7.5) < 0.2, `frozen 7.5 s after the first hit (${frozeAt - t0})`);
  assert.ok(near(stun, 2, 0.06), 'for 2 s');
  // an unstoppable unit (Berserkers) keeps its speed but can still be frozen solid
  const fw2 = body(withSkills('Frost Wizard', ['deepfreeze']), 0, 0, -20), b = body(dummy(1e6, { unstoppable: true }), 1, 0, 0);
  const bt2 = E.createBattle([fw2], [b], G); let slowed = false, froze = false;
  for (let k = 0; k < 400; k++) { bt2.step(); if (b.slowT > 0) slowed = true; if (b.stunT > 0) froze = true; }
  assert.ok(!slowed && froze, 'unstoppable: no slow, but frozen solid');
}
// Multibeam: a second beam on a different enemy that stays on it; Glacial gaze: +5 m, +20%, the healthiest enemy
{
  const fw = body(withSkills('Frost Wizard', ['multibeam']), 0, 0, -20);
  const a = body(dummy(1e6), 1, -3, 0), b = body(dummy(1e6), 1, 3, 0), c = body(dummy(1e6), 1, 0, 2);
  const bt = E.createBattle([fw], [a, b, c], G); steps(bt, 3);
  const hit = [a, b, c].filter(x => x.hp < 1e6);
  assert.strictEqual(hit.length, 2, 'two beams, two different enemies');
  const before = hit.map(x => x.hp); steps(bt, 3);
  assert.ok(hit.every((x, k) => x.hp < before[k]) && c.hp === 1e6 || hit.includes(c), 'each beam keeps to its enemy');
  assert.ok(hit.every(x => x.frost && x.frost.n >= 2), 'both build up Frost');
  const gz = withSkills('Frost Wizard', ['glacialGaze']);
  assert.ok(gz.range === 30 && near(gz.hit, unit('Frost Wizard').hit * 1.2) && gz.healthiest);
  const fw2 = body(gz, 0, 0, -20), weak = body(dummy(500), 1, 0, 0), strong = body(dummy(5000), 1, 4, 3), tower = body(dummy(9000, { structure: true }), 1, -4, 3);
  const bt2 = E.createBattle([fw2], [weak, strong, tower], G); steps(bt2, 2);
  assert.ok(strong.hp < 5000 && weak.hp === 500 && tower.hp === 9000, 'it beams the healthiest unit, units before towers');
}
// Snow storm: its hit and Frost to every enemy within 8 m, as often as it attacks
{
  const fw = body(withSkills('Frost Wizard', ['multibeam', 'snowStorm']), 0, 0, 0);
  const near1 = body(dummy(1e6), 1, 5, 0), near2 = body(dummy(1e6), 1, -6, 2), far = body(dummy(1e6), 1, 0, 9.5);
  const bt = E.createBattle([fw], [near1, near2, far], G); steps(bt, 1.2);
  assert.ok(near1.frost && near2.frost, 'the storm frosts every enemy within 8 m');
  const fw2 = body(withSkills('Frost Wizard', ['multibeam', 'snowStorm']), 0, 0, 0), only = body(dummy(1e6), 1, 0, 30);
  const bt2 = E.createBattle([fw2], [only], G); steps(bt2, 1);
  assert.ok(!only.frost, 'not beyond its reach (or its beam)');
  const d = body(dummy(1e6), 1, 0, 6), fw3 = body(withSkills('Frost Wizard', ['multibeam', 'snowStorm']), 0, 0, 0), fw4 = body(unit('Frost Wizard'), 0, 0, 0);
  const s3 = E.createBattle([fw3], [d], G); steps(s3, 4); const withStorm = 1e6 - d.hp;
  const d2 = body(dummy(1e6), 1, 0, 6), s4 = E.createBattle([fw4], [d2], G); steps(s4, 4); const without = 1e6 - d2.hp;
  assert.ok(withStorm > without * 1.8, `beam and storm both hit (${withStorm} vs ${without})`);
}
// Glut: each enemy body it kills, or that falls within a tile of it, is a stack (2 a fight, 12 in all); not buildings
{
  const o = unit('Obelisk'), ob = body(o, 0, 0, 0);
  const prey = [0, 1, 2].map(k => body(dummy(10), 1, (k - 1) * 2, 2.5));
  const bt = E.createBattle([ob], prey, G); steps(bt, 8);
  assert.ok(prey.every(p => !p.alive), 'it kills them all');
  assert.strictEqual(ob.glutN, 2, 'but eats at most 2 in a fight'); assert.strictEqual(ob.glutGain, 2);
  assert.ok(near(ob.u.hp, o.hp * 1.12) && near(ob.u.hit, o.hit * 1.12), '+6% health and hit a stack');
  assert.strictEqual(bt.result().squads['0:0'].glut, 2, 'the result says what it ate');
  // Devour: it heals for half the damage it deals
  const ob5 = body(o, 0, 0, 0), sack = body(dummy(1e6), 1, 0, 2.5), bt5 = E.createBattle([ob5], [sack], G);
  ob5.hp = 100; steps(bt5, 3);
  assert.ok(near(ob5.hp - 100, (1e6 - sack.hp) / 2, 1e-3), `heals half its damage (${ob5.hp - 100} of ${1e6 - sack.hp})`);
  const ob2 = body(o, 0, 0, 0), tw = body(dummy(5, { structure: true }), 1, 0, 2.5), cn = body(dummy(5, { construct: true, noCount: true }), 1, 1, 2.5), real = body(dummy(1e6), 1, 0, 30);
  const bt2 = E.createBattle([ob2], [tw, cn, real], G); steps(bt2, 4);
  assert.ok(!tw.alive && !cn.alive && !(ob2.glutN > 0), 'towers and constructs are not food');
  // a body an ally kills within 6 m is eaten too; farther away it isn't
  const ob3 = body(o, 0, 0, -30), ally = body(E.withTraits({ name: 'Archer', cost: 1, bodies: 1, hp: 1e6, hit: 100, aps: 5, range: 60, speed: 0, splash: 0 }), 0, 0, -40);
  const v1 = body(dummy(50), 1, 0, -25), v2 = body(dummy(50), 1, 20, -20);
  const bt3 = E.createBattle([ob3, ally], [v1, v2], G); steps(bt3, 2);
  assert.ok(!v1.alive && !v2.alive && ob3.glutN === 1, 'it eats what falls next to it, not far away');
  // at its most it eats no more
  const ob4 = body(E.glutUnit(o, 12), 0, 0, 0); ob4.glutN = 12;
  const bt4 = E.createBattle([ob4], [body(dummy(10), 1, 0, 2.5)], G); steps(bt4, 3);
  assert.strictEqual(ob4.glutN, 12);
}
// skills: Gluttony (one more a round), Hunger's haste (speed and a little attack speed a stack), Crushing maw (3 m splash),
// Eye of the Obelisk (18 m, ranged)
{
  assert.strictEqual(withSkills('Obelisk', ['gluttony']).glut.cap, 3);
  const h = withSkills('Obelisk', ['hungerHaste']), g6 = E.glutUnit(h, 6);
  assert.ok(near(g6.speed, h.speed + 0.6) && near(g6.aps, h.aps * 1.09), 'Hunger’s haste: +0.1 m/s and +1.5% attack speed a stack');
  assert.strictEqual(withSkills('Obelisk', ['crushingMaw']).splash, 3);
  const eye = withSkills('Obelisk', ['obeliskEye']); assert.ok(eye.range === 18 && eye.projSpeed > 0 && eye.eye);
}
// the match: Glut is kept on the squad, is in its stats, and the Eye can only be bought at full Glut
{
  const units = demo.units.map(u => ({ ...u, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const m = Game.createMatch(units, demo.matrix, 11, 'standard');
  const ui = m.units.findIndex(u => u.name === 'Obelisk');
  m.gold[0] = 5000; Game.unlock(m, 0, ui);
  const sq = Game.place(m, 0, ui, 5, Game.zoneRows(0)[0]); assert.ok(sq, 'an Obelisk on the board');
  const base = Game.unitFor(m, 0, ui, sq);
  assert.strictEqual(Game.awakenBlock(m, 0, sq), 'glut', 'no Eye without full Glut');
  // a fight it ate 2 in: the squad keeps them, and they are in its stats next time
  const sum = Game.resolve(m, { winner: 0, timeout: false, time: 10, frac: [1, 0], squads: { ['0:' + sq.id]: { side: 0, squad: sq.id, total: 1, alive: 1, xp: 0, dealt: 0, glut: 2 } }, charm: [null, null], converted: [0, 0], buildings: [] });
  assert.strictEqual(Game.glutOf(sq), 2); assert.ok(sum.glut[0].length === 1 && sum.glut[0][0].gained === 2);
  assert.ok(near(Game.unitFor(m, 0, ui, sq).hp, base.hp * 1.12), 'its Glut is in its stats');
  const bodies = Game.bodiesFor(m, 0).filter(b => b.squad === sq.id);
  assert.ok(bodies.length === 1 && bodies[0].glutN === 2, 'it starts the fight with its Glut');
  sq.glut = 11; Game.resolve(m, { winner: 0, timeout: false, time: 10, frac: [1, 0], squads: { ['0:' + sq.id]: { side: 0, squad: sq.id, total: 1, alive: 1, xp: 0, dealt: 0, glut: 2 } }, charm: [null, null], converted: [0, 0], buildings: [] });
  assert.strictEqual(Game.glutOf(sq), 12, 'never past 12');
  m.gold[0] = 5000;
  assert.strictEqual(Game.awakenBlock(m, 0, sq), '', 'full Glut: it can be awakened');
  assert.ok(Game.awaken(m, 0, sq.id) && Game.unitFor(m, 0, ui, sq).range === 18, 'Eye of the Obelisk: 18 m');
  // a real fight in a match plays through
  Game.aiDeploy(m, 1); const fight = Game.startBattle(m); while (fight.step()); Game.resolve(m, fight.result());
}
console.log('frost-obelisk: all checks passed');
