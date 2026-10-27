// Headless check of the Leaf Wizard rework (single sharp leaves, Wind walk, Bouncing blade, Petalburst, the Leafblade
// Awaken skill), Awaken skills bought one squad at a time, Master skills (Overwatch, Spirit walk, the Brute's
// Berserkers) and Berserkers in a fight. Run from the repo root: node tools/tests/leaf-brute.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };
const unit = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
const skill = (id) => { const s = roster.skills.find(x => x.id === id); assert.ok(s, id); return s; };
const withSkills = (n, ids) => E.applySkills(unit(n), ids.map(skill), roster.units);
const body = (u, side, x, y, sq = side * 10) => E.buildSquad(u, side, x, y, sq, 6)[0];
const dummy = (hp, extra) => E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra });
const steps = (bt, s) => { for (let k = 0; k < Math.round(s / G.dt); k++) bt.step(); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// the Leaf Wizard: single leaves at 1.2 attacks a second, a little less health; its skills
{
  const lw = unit('Leaf Wizard');
  assert.ok(lw.burst === 1 && lw.pellets === 1 && lw.aps === 1.2 && lw.hp === 210 && lw.hit === 95 && lw.windUp === 0, 'single shots, 1.2 a second');
  assert.deepStrictEqual(lw.skills, ['windWalk', 'bouncingBlade', 'petalburst', 'leafblade']);
  assert.deepStrictEqual(lw.skillOr, [[1, 2]], 'Bouncing blade or Petalburst');
  assert.deepStrictEqual(lw.skillNeedsAny, [null, null, null, [1, 2]], 'Leafblade needs one of them');
  assert.deepStrictEqual(['windWalk', 'bouncingBlade', 'petalburst', 'leafblade'].map(id => skill(id).cost), [100, 150, 150, 300]);
  const ww = withSkills('Leaf Wizard', ['windWalk']); assert.ok(ww.dodge === 33 && ww.windWalk === 6, 'Wind walk: 33% dodge, a tile back');
  const pb = withSkills('Leaf Wizard', ['petalburst']); assert.ok(near(pb.aps, 2.4) && near(pb.range, lw.range / 2), 'Petalburst: +100% attack speed, -50% range');
  const bb = withSkills('Leaf Wizard', ['bouncingBlade']); assert.deepStrictEqual(bb.bounce, { n: 2, pct: 30, reach: 10 });
  const lb = withSkills('Leaf Wizard', ['petalburst', 'leafblade']);
  assert.ok(lb.mech && lb.spinBlade && lb.flame === 180 && lb.range === 3 && lb.projSpeed === 0 && lb.dash === 8 && near(lb.aps, 2.4), 'Leafblade: a 360 spin in melee that dashes, Petalburst still speeds it up');
  assert.deepStrictEqual(lb.missiles, { n: 2, every: 10, hit: 150, splash: 2.5, speed: 25 });
  assert.strictEqual(E.leveled(lb, 1).missiles.hit, 300, 'missiles grow with the level');
  assert.ok(E.describeSkill(skill('leafblade')).length > 50 && E.describeSkill(skill('berserkers')).length > 50 && E.describeSkill(skill('windWalk')) && E.describeSkill(skill('bouncingBlade')));
}
// one leaf a shot (no volleys): a dummy in reach takes 95 a leaf
{
  const lw = body(unit('Leaf Wizard'), 0, 0, -10), d = body(dummy(1e6), 1, 0, 10);
  const bt = E.createBattle([lw], [d], G);
  let most = 0;
  for (let k = 0; k < 200; k++) { bt.step(); most = Math.max(most, bt.projectiles().length); }
  assert.ok(most === 1, 'one leaf in the air at a time');
  assert.ok(near((d.u.hp - d.hp) % 95, 0, 1e-6) && d.hp < d.u.hp, 'whole leaves of 95');
}
// Wind walk: a dodged hit sends it a tile straight back from the attacker
{
  const lw = body({ ...withSkills('Leaf Wizard', ['windWalk']), dodge: 90, speed: 0, aps: 0.01 }, 0, 0, 0);
  const foe = body(E.withTraits({ name: 'F', cost: 1, bodies: 1, hp: 1e6, hit: 1, aps: 1, range: 30, speed: 0, splash: 0 }), 1, 0, 20);
  const bt = E.createBattle([lw], [foe], G);
  let y0 = lw.y;
  for (let k = 0; k < 100 && lw.y === y0; k++) bt.step();
  assert.ok(near(lw.y, y0 - 6, 1e-6) && near(lw.x, 0), `dashed 6 m back: ${lw.y}`);
  // without Wind walk a dodge doesn't move it
  const plain = body({ ...withSkills('Leaf Wizard', []), dodge: 90, speed: 0, aps: 0.01 }, 0, 0, 0), f2 = body(foe.u, 1, 0, 20);
  const bt2 = E.createBattle([plain], [f2], G); steps(bt2, 3);
  assert.ok(plain.y === 0 && bt2.result().stats[1].missed > 0);
}
// Bouncing blade: the leaf bounces on to two more enemies for 30% each, each body once
{
  const lw = body({ ...withSkills('Leaf Wizard', ['bouncingBlade']), speed: 0 }, 0, 0, -10);
  const ds = [0, 4, 8, 12].map(x => body(dummy(1e6), 1, x, 10, 20 + x));
  const bt = E.createBattle([lw], ds, G);
  for (let k = 0; k < 400 && ds[0].hp === ds[0].u.hp; k++) bt.step();
  steps(bt, 0.6);
  const took = ds.map(d => d.u.hp - d.hp);
  assert.ok(took[0] >= 95 && took[1] > 0 && took[2] > 0 && took[3] === 0, `two bounces, no more: ${took}`);
  assert.ok(near(took[1] % 28.5, 0, 1e-6) || near(took[1] % 28.5, 28.5, 1e-6), `30% of 95 a bounce: ${took[1]}`);
}
// Leafblade: spins hit everything around it, it dashes the last 8 m, two missiles at the start and every 10 s
{
  const lb = body({ ...withSkills('Leaf Wizard', ['bouncingBlade', 'leafblade']), speed: 5 }, 0, 0, -20);
  const ds = [-1.5, 1.5].map((x, k) => body(dummy(1e6), 1, x, 0, 30 + k));
  const bt = E.createBattle([lb], ds, G);
  bt.step();
  const ms = bt.projectiles().filter(p => p.missile);
  assert.ok(ms.length === 2 && ms[0].homing !== ms[1].homing, 'two missiles at the start, at different enemies');
  let dashed = false;
  for (let k = 0; k < 200; k++) { bt.step(); if (lb.dashing) dashed = true; }
  assert.ok(dashed, 'it dashed in');
  assert.ok(ds.every(d => d.hp < d.u.hp), 'both hit');
  const fired = () => bt.projectiles().filter(p => p.missile).length;
  let again = 0;
  for (let k = 0; k < 220; k++) { bt.step(); again = Math.max(again, fired()); }
  assert.strictEqual(again, 2, 'a second salvo after 10 s');
}
// Berserkers: can't be slowed or knocked back; the roar slows enemies' attacks and speeds allies, up to 25%
{
  const br = withSkills('Brute', ['berserkers']);
  assert.ok(br.unstoppable && br.roar.radius === 8 && br.roar.attack === 5 && br.roar.speed === 5 && br.roar.max === 25);
  const brutes = [0, 1, 2, 3, 4, 5].map(k => body(br, 0, k * 1.2 - 3, 0, k));
  const ally = body(unit('Sniper'), 0, 0, -4, 9);
  const foe = body(E.withTraits({ name: 'F', cost: 1, bodies: 1, hp: 1e6, hit: 5, aps: 1, range: 2, speed: 0, splash: 0, knockback: 5, slowMove: 50, slowAtk: 50, slowDur: 3 }), 1, 0, 5);
  const far = body(dummy(1e6), 1, 0, 40, 12);
  const bt = E.createBattle([...brutes, ally], [foe, far], G);
  bt.step();
  assert.strictEqual(foe.roarAtk, 25, 'six roars, capped at 25%');
  assert.strictEqual(ally.roarSpd, 25, 'the Sniper moves 25% faster');
  assert.strictEqual(brutes[0].roarSpd, 25, 'brutes speed each other up');
  assert.ok(!far.roarAtk, 'out of reach');
  const before = brutes.map(b => [b.x, b.y]);
  steps(bt, 3);
  assert.ok(brutes.every(b => !(b.slowT > 0)), 'not slowed');
  void before;
  // knockback: an ordinary Brute is pushed, a Berserker isn't
  const push = E.withTraits({ name: 'P', cost: 1, bodies: 1, hp: 1e6, hit: 900, aps: 1, range: 30, speed: 0, splash: 0, knockback: 6 });
  for (const [u, moves] of [[unit('Brute'), true], [br, false]]) {
    const b = body({ ...u, speed: 0, aps: 0.01 }, 0, 0, 0), p = body(push, 1, 0, 20);
    const t = E.createBattle([b], [p], G); steps(t, 2);
    assert.strictEqual(b.y !== 0, moves, `${u.name}: pushed ${moves}`);
  }
}
// Awaken skills: bought for one squad at a time, after skill 2 or 3; Master skills for all squads
{
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const m = Game.createMatch(units, null, 3, 'standard');
  const lw = units.findIndex(u => u.name === 'Leaf Wizard'), bi = units.findIndex(u => u.name === 'Brute'), sn = units.findIndex(u => u.name === 'Sniper'), ws = units.findIndex(u => u.name === 'Wisps'), en = units.findIndex(u => u.name === 'Ent');
  m.gold = [5000, 5000]; m.unlocks[0][lw] = 1; m.unlocks[0][bi] = 1;
  assert.ok(Game.isAwaken(m, lw, 3) && !Game.isMaster(m, lw, 3), 'Leafblade: an Awaken skill');
  for (const [ui, k] of [[bi, 3], [sn, 3], [ws, 3], [en, 3]]) assert.ok(Game.isMaster(m, ui, k) && !Game.isAwaken(m, ui, k), `${units[ui].name}: a Master skill`);
  const a = Game.place(m, 0, lw, 2, 13), b = Game.place(m, 0, lw, 3, 13);
  assert.ok(!Game.canBuySkill(m, 0, lw, 3), 'not bought for the unit');
  assert.ok(!Game.canAwaken(m, 0, a.id) && Game.awakenBlock(m, 0, a) === 'needs', 'needs Bouncing blade or Petalburst first');
  assert.ok(Game.buySkill(m, 0, lw, 2));
  const g0 = m.gold[0];
  assert.ok(Game.awaken(m, 0, a.id) && m.gold[0] === g0 - 300 && a.awaken === m.round, '300 gold, this squad');
  assert.ok(!Game.canAwaken(m, 0, a.id), 'once');
  assert.ok(Game.unitFor(m, 0, lw, a).mech && !Game.unitFor(m, 0, lw, b).mech && !Game.unitFor(m, 0, lw).mech, 'only the awakened squad');
  assert.strictEqual(Game.skillCost(m, lw, 0, 0), 150, 'it makes no other skill dearer (only Petalburst: +50)');
  assert.ok(!Game.undoSkill(m, 0, lw, 2), 'Petalburst stays while an awakened squad needs it');
  const fight = Game.bodiesFor(m, 0);
  assert.ok(fight.find(x => x.squad === a.id).u.mech && !fight.find(x => x.squad === b.id).u.mech, 'in the fight too');
  assert.ok(Game.undoAwaken(m, 0, a.id) && m.gold[0] === g0 && !a.awaken, 'taken back this round');
  assert.ok(Game.undoSkill(m, 0, lw, 2), 'then Petalburst can go');
  // a squad taken back takes its awakening with it; sold later, it counts for half
  Game.buySkill(m, 0, lw, 2);
  assert.ok(Game.awaken(m, 0, b.id));
  const g1 = m.gold[0];
  assert.ok(Game.unplaceSquad(m, 0, b.id) && m.gold[0] === g1 + b.cost + 300, 'a full refund with the awakening');
  Game.awaken(m, 0, a.id);
  m.round++;
  assert.ok(!Game.undoAwaken(m, 0, a.id) && Game.seenAwake(m, a), 'last round\'s awakening stays, and the opponent knows of it');
  assert.strictEqual(Game.sellValue(m, a), Math.floor((200 + 300) / 2 / 5) * 5);
  // the opponent doesn't see an awakening bought this round
  const c = Game.place(m, 0, lw, 4, 13); Game.awaken(m, 0, c.id);
  assert.ok(!Game.seenAwake(m, c));
  // Berserkers: a Master skill, for every Brute squad (and the guards the keep makes of Brutes)
  const b1 = Game.place(m, 0, bi, 5, 13), b2 = Game.place(m, 0, bi, 6, 13);
  assert.ok(!Game.canBuySkill(m, 0, bi, 3), 'needs Rampager or Bullhead');
  assert.ok(Game.buySkill(m, 0, bi, 1) && Game.buySkill(m, 0, bi, 3));
  assert.ok(Game.unitFor(m, 0, bi, b1).unstoppable && Game.unitFor(m, 0, bi, b2).unstoppable && Game.unitFor(m, 0, bi).roar, 'all Brutes');
  // the AI buys Awaken skills for squads too, and never for a whole unit
  const m2 = Game.createMatch(units, require('../../src/demo-units.json').matrix, 11, 'standard');
  let woke = 0;
  for (let r = 1; r <= 8; r++) { m2.round = r; m2.gold[1] = 3000; m2.unlocks[1][lw] = 1; Game.aiDeploy(m2, 1); woke += m2.armies[1].filter(s => s.awaken > 0).length; }
  assert.ok(Object.values(m2.tech[1]).every(t => units.every((u, ui) => !(m2.tech[1][ui] && Game.isAwaken(m2, ui, 3) && m2.tech[1][ui][3] > 0))), 'no unit-wide Awaken');
  console.log('AI awakened squads (summed over rounds):', woke);
}
console.log('leaf-brute: Leaf Wizard, Wind walk, Bouncing blade, Petalburst, Leafblade, Berserkers, Awaken per squad, Master skills ok');
