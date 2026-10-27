// Headless check of the unit rework: the Assassin, burn, Grasping roots, Bullhead, Rampager, More where that came from,
// Flare, the Hellfiend portal, Overwatch, Spirit walk, Awaken skills (a 4th slot that needs skill 2 or 3, always its
// own price) and either-or. Run from the repo root: node tools/tests/rework.js
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

// the roster: stats and skills as asked
{
  assert.strictEqual(E.SKILL_SLOTS, 4);
  assert.strictEqual(unit('Rogue').speed, 5.5);
  assert.strictEqual(unit('Skeleton Archers').projSpeed, 30);
  const ent = unit('Ent'); assert.ok(ent.flame === 0 && ent.splash === 2, 'Ent: a 2 m splash');
  const a = unit('Assassin');
  assert.ok(a.cost === 5 && a.bodies === 1 && a.hit === 500 && a.hp === 350 && a.aps === 0.35 && a.speed === 6 && a.stealth && a.dash === 10 && a.bldgPct === 50);
  const sn = withSkills('Sniper', ['assaultgunner']);
  assert.ok(near(sn.aps, 1) && sn.range === 24 && near(sn.hit, 105), 'Assaultgunner: 1 attack a second');
  const de = withSkills('Sniper', ['deadeye']); assert.ok(de.range === 34 && near(de.hit, 252));
  const sk = withSkills('Skeleton Archers', ['graverot']); assert.ok(near(sk.aps, 0.6) && sk.poisonPct === 150);
  const dr = withSkills('Skeleton Archers', ['dreadRangers']); assert.ok(dr.shield === 1 && dr.range === 20);
  const gb = withSkills('Goblin Swarm', ['aaargh', 'tacticalness']); assert.ok(near(gb.speed, 8.3) && near(gb.aps, 1.5) && gb.bodies === 15 && gb.spread);
  const ws = withSkills('Wisps', ['sightweavers', 'shadowborn']); assert.ok(ws.range === 21 && ws.shrinkM === 2 && ws.stealth && ws.firstHit === 25);
  const im = withSkills('Ember Imps', ['hellfiend']).portal.unit;
  assert.ok(im.name === 'Hellfiend' && im.hp === 2200 && im.hit === 196 && im.speed === 4.5 && im.flame === 90, 'Hellfiend: a level 2 Brute');
  assert.ok(withSkills('Brute', ['tuffSkin']).bonusArmor === 4 && withSkills('Brute', ['bullhead']).bonusArmor === 4);
}
// burn: half the hit at once, half over 3 s (50%, 33%, 17% of it); a new burn adds to it and starts again
{
  const imp = body({ ...withSkills('Ember Imps', ['spitfire']), bodies: 1, splash: 0 }, 0, 0, -9), d = body(dummy(10000), 1, 0, 0);
  const bt = E.createBattle([imp], [d], G);
  for (let k = 0; k < 400 && !d.burn; k++) bt.step();
  assert.ok(d.burn && near(10000 - d.hp, 10) && near(d.burn.left, 10), `half at once, half burning (${10000 - d.hp})`);
  imp.u = { ...imp.u, aps: 0.01 }; imp.cd = 1000; // no more attacks
  const hp0 = d.hp;
  steps(bt, 1.01); assert.ok(near(hp0 - d.hp, 5, 1e-3), `first tick: half (${hp0 - d.hp})`);
  steps(bt, 1); assert.ok(near(hp0 - d.hp, 5 + 10 / 3, 1e-3), 'second: a third');
  steps(bt, 1); assert.ok(near(hp0 - d.hp, 10, 1e-3) && !d.burn, 'third: the rest');
}
// Grasping roots: grabs an enemy 5-13 m away, drags it in, 10 damage a second, then fights it
{
  const ent = body(withSkills('Ent', ['graspingRoots']), 0, 0, 0), v = body(dummy(5000, { idle: false, speed: 0 }), 1, 0, 10);
  const bt = E.createBattle([ent], [v], G);
  bt.step();
  assert.strictEqual(ent.rootTgt, v, 'grabbed');
  steps(bt, 1);
  assert.ok(v.y < 10 && near(5000 - v.hp, 10.5, 0.6), `dragged and hurt (${v.y.toFixed(2)}, ${5000 - v.hp})`);
  steps(bt, 6);
  assert.ok(!ent.rootTgt && ent.lock === v, 'in reach: it lets go and fights it');
  const far = body(dummy(5000), 1, 0, 20), close = body(dummy(5000), 1, 3, 2), e2 = body(withSkills('Ent', ['graspingRoots']), 0, 0, 0);
  const bt2 = E.createBattle([e2], [far, close], G); bt2.step();
  assert.ok(!e2.rootTgt, 'nothing between 5 and 13 m: nothing grabbed');
}
// the Assassin: dashes in hidden, strikes, 50% against buildings, kill stacks
{
  const a = body(unit('Assassin'), 0, 0, -12), v = body(dummy(400, { idle: true }), 1, 0, 0);
  const bt = E.createBattle([a], [v], G);
  let dashed = false, hiddenDash = true;
  for (let k = 0; k < 200 && v.alive; k++) { bt.step(); if (a.dashing && !(a.lastAtk > 0)) { dashed = true; hiddenDash = hiddenDash && a.hidden; } }
  assert.ok(dashed && hiddenDash, 'it dashes, hidden');
  assert.ok(!v.alive && a.kills === 1, 'one blow kills');
  assert.ok(near(bt.bodies[0].u.speed + a.kills * 0.1, 6.1), 'a kill stack');
  const a2 = body(unit('Assassin'), 0, 0, -1.5), tw = body(dummy(2000, { structure: true }), 1, 0, 0);
  const bt2 = E.createBattle([a2], [tw, body(dummy(10), 1, 40, 40, 19)], G); // a structure alone isn't an army: someone far off
  for (let k = 0; k < 100 && tw.hp === 2000; k++) bt2.step();
  assert.ok(near(2000 - tw.hp, 250), `half damage to a building (${2000 - tw.hp})`);
  // Silent blade: still hidden after the first strike, seen after the second
  const s = body(withSkills('Assassin', ['silentBlade']), 0, 0, -1.5), big = body(dummy(5000), 1, 0, 0);
  const bt3 = E.createBattle([s], [big], G);
  for (let k = 0; k < 100 && big.hp === 5000; k++) bt3.step();
  assert.ok(big.hp < 5000 && s.hidden, 'Silent blade: hidden after its first attack');
  for (let k = 0; k < 100 && big.hp > 4000; k++) bt3.step();
  assert.ok(!s.hidden, 'the second gives it away');
}
// Death Flurry: three blows of 200; a kill leaps it to the next target within 10 m
{
  const a = body(withSkills('Assassin', ['deathFlurry']), 0, 0, -1.5);
  const v1 = body(dummy(150), 1, 0, 0, 11), v2 = body(dummy(1000), 1, 7, 0, 12);
  const bt = E.createBattle([a], [v1, v2], G);
  steps(bt, 2);
  assert.ok(!v1.alive && near(1000 - v2.hp, 400), `the 2nd and 3rd blows on the next target (${1000 - v2.hp})`);
  assert.ok(Math.hypot(a.x - v2.x, a.y - v2.y) < 2, 'it leapt there');
}
// Shadow hunter: a lone target over one in a crowd
{
  const a = body(withSkills('Assassin', ['shadowHunter']), 0, 0, -6);
  const crowd = [0, 1, 2].map(k => body(dummy(1000), 1, -1 + k, 0, 20 + k)), lone = body(dummy(1000), 1, 14, 8, 30);
  const bt = E.createBattle([a], [...crowd, lone], G);
  for (let k = 0; k < 300 && lone.hp === 1000 && crowd.every(c => c.hp === 1000); k++) bt.step();
  assert.ok(lone.hp < 1000 && crowd.every(c => c.hp === 1000), 'it goes for the lone one');
  const b = body(withSkills('Assassin', ['shadowHunter']), 0, 0, -6), c2 = [0, 1].map(k => body(dummy(1000), 1, k, 0, 40 + k));
  const bt2 = E.createBattle([b], c2, G);
  steps(bt2, 5.2);
  assert.ok(b.hunt === false, 'no lone target for 5 s: it gives up');
}
// Bullhead: the first attack charges through, 100 to each in the line and a tile of knockback; armor while charging
{
  const br = body(withSkills('Brute', ['bullhead']), 0, 0, -1.8);
  const vs = [0, 3].map((y, k) => body(dummy(1000, { idle: false }), 1, 0, y, 50 + k));
  const bt = E.createBattle([br], vs, G);
  let charged = false, armorWhile = 0;
  for (let k = 0; k < 40; k++) { bt.step(); if (br.charging) { charged = true; armorWhile = E.TOWER_DOWN && br.u.bull.armor; } }
  assert.ok(charged && armorWhile === 4, 'a charge on its first attack');
  assert.ok(vs[1].hp <= 1000 - 100 + 1e-6, `the one behind takes the charge (${1000 - vs[1].hp})`);
}
// Rampager: up to 4 stacks
{
  const br = body(withSkills('Brute', ['rampager']), 0, 0, -1.5);
  const vs = [0, 1, 2, 3, 4, 5].map(k => body(dummy(50), 1, (k % 3) * 1.5 - 1.5, Math.floor(k / 3) * 1.5, 60 + k));
  const bt = E.createBattle([br], vs, G);
  steps(bt, 12);
  assert.ok(vs.every(v => !v.alive) && br.kills === 4, `4 stacks at most (${br.kills})`);
}
// More where that came from: a kill makes a new goblin
{
  const gs = body({ ...withSkills('Goblin Swarm', ['moreGoblins']), bodies: 1 }, 0, 0, -1.5), v = body(dummy(10), 1, 0, 0);
  const bt = E.createBattle([gs], [v], G);
  steps(bt, 2);
  assert.ok(!v.alive && bt.bodies.filter(b => b.side === 0 && b.u.name === 'Goblin Swarm').length === 2, 'a second goblin');
}
// Flare: after waiting, the first attack fires the stored shots in a burst
{
  const imp = body({ ...withSkills('Ember Imps', ['flare']), bodies: 1, splash: 0 }, 0, 0, -30), v = body(dummy(100000), 1, 0, 0);
  const bt = E.createBattle([imp], [v], G);
  let shots = 0;
  for (let k = 0; k < 400 && !(imp.lastAtk > 0); k++) bt.step();
  const waited = imp.lastAtk;
  assert.ok(waited > 2.5, 'it walked a while first');
  assert.strictEqual(imp.burstLeft, Math.floor(Math.min(100, 10 * waited) / 25 + 1e-9), 'one extra shot per 25% stored');
}
// Summon hellfiend: the imps hold still for 3 s at their portal, then sacrifice themselves and one hellfiend per
// squad walks out, levelled like it
{
  const u = withSkills('Ember Imps', ['hellfiend']);
  const imps = E.buildSquad(u, 0, 0, -10, 1, 6, 0, 1), y0 = imps.map(b => b.y);
  const bt = E.createBattle(imps.slice(), [body(dummy(1e6), 1, 0, 30)], G); // the battle adds its summons to the list it's given
  const hf = () => bt.bodies.filter(b => b.u.name === 'Hellfiend');
  bt.step(); assert.strictEqual(bt.portals().length, 1);
  assert.strictEqual(hf().length, 0, 'no hellfiend while the imps summon');
  steps(bt, 2.5);
  assert.ok(imps.every((b, i) => b.alive && Math.abs(b.y - y0[i]) < 0.5 && !(b.lastAtk > 0)), 'the imps hold still while they summon');
  steps(bt, 0.6);
  assert.strictEqual(bt.portals().length, 0, 'the portal closes after 3 s');
  assert.ok(imps.every(b => !b.alive && b.sacrificed), 'the imps are sacrificed');
  assert.ok(hf().length === 1 && hf()[0].u.hp === 4400 && hf()[0].credit === imps[0] && hf()[0].alive, 'one level 2 hellfiend for a level 2 squad');
  // a squad that falls before the summon is done brings nothing
  const imps2 = E.buildSquad(u, 0, 0, -10, 1, 6, 0, 0);
  const bt2 = E.createBattle(imps2, [body(dummy(1e6), 1, 0, 30)], G);
  bt2.step(); for (const b of imps2) { b.hp = 0; b.alive = false; }
  steps(bt2, 3.5); assert.ok(!bt2.bodies.some(b => b.u.name === 'Hellfiend'), 'no hellfiend once the imps fell');
}
// either-or, Awaken: needs skill 2 or 3, always 300 gold, doesn't make the others dearer
{
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const m = Game.createMatch(units, null, 3, 'standard');
  const sn = units.findIndex(u => u.name === 'Sniper');
  m.gold = [5000, 5000]; m.unlocks[0][sn] = 1;
  Game.ensureTower(m, 0);
  assert.ok(Game.place(m, 0, sn, 2, 13));
  assert.ok(!Game.canBuySkill(m, 0, sn, 3), 'Overwatch needs Deadeye or Assaultgunner');
  assert.deepStrictEqual(Game.skillNeedsMissing(m, 0, sn, 3), [1, 2]);
  assert.ok(Game.buySkill(m, 0, sn, 2) && !Game.canBuySkill(m, 0, sn, 1), 'either or');
  assert.strictEqual(Game.skillCost(m, sn, 3, 0), 300);
  assert.ok(Game.buySkill(m, 0, sn, 3));
  assert.strictEqual(Game.skillCost(m, sn, 0, 0), 150, 'the awaken skill makes no other dearer (only Assaultgunner: +50)');
  assert.ok(!Game.undoSkill(m, 0, sn, 2), 'Assaultgunner stays while Overwatch needs it');
  // Overwatch: a squad goes into the tower; in a fight it can't be hit until the tower falls
  const t = m.towers[0];
  assert.ok(Game.garrisonFree(m, 0, t.col, t.row, sn) && Game.place(m, 0, sn, t.col, t.row), 'placed in the tower');
  assert.ok(!Game.garrisonFree(m, 0, t.col, t.row, sn), 'one squad per building');
  assert.ok(!Game.undoSkill(m, 0, sn, 3), 'no taking Overwatch back with a squad in the tower');
  const bodies = Game.bodiesFor(m, 0), inT = bodies.find(b => b.squad === m.armies[0][1].id), out = bodies.find(b => b.squad === m.armies[0][0].id);
  const tower = bodies.find(b => b.squad === -2), watch = bodies.find(b => b.u.kind === 'watchtower');
  assert.ok(inT.inside === tower && out.inside === watch && watch.u.hp === 200, 'one in the tower, the other in a watchtower');
  const foe = body(E.withTraits({ name: 'Foe', cost: 1, bodies: 1, hp: 1e6, hit: 1000, aps: 2, range: 40, speed: 0, splash: 0 }), 1, tower.x, tower.y + 20);
  const bt = E.createBattle(bodies, [foe], G);
  let hitWhileUp = false;
  for (let k = 0; k < 400 && watch.alive; k++) { bt.step(); if (out.hp < out.u.hp && watch.alive) hitWhileUp = true; }
  assert.ok(!watch.alive && !hitWhileUp, 'safe until its watchtower fell');
  // Spirit walk: Wisps from an earlier round move for free, as often as you like; the opponent sees the old tile
  const ws = units.findIndex(u => u.name === 'Wisps');
  m.unlocks[0][ws] = 1;
  const sq = Game.place(m, 0, ws, 8, 13);
  m.round++;
  for (const k of [0, 1]) assert.ok(Game.buySkill(m, 0, ws, k));
  m.round++; // Spirit walk needs skill 2 or 3; skills 2 and 3 are either-or
  assert.ok(Game.buySkill(m, 0, ws, 3));
  const g0 = m.gold[0];
  assert.ok(Game.moveSquad(m, 0, sq.id, 9, 13) && Game.moveSquad(m, 0, sq.id, 10, 12) && m.gold[0] === g0 && Game.movedId(m, 0) == null, 'free moves, not the round\'s one paid move');
  assert.deepStrictEqual([Game.seenAt(m, sq).col, Game.seenAt(m, sq).row], [8, 13], 'the opponent sees it where it was');
  assert.ok(!Game.undoSkill(m, 0, ws, 3), 'Spirit walk stays once used this round');
  // taking back a squad placed this round: a full refund
  const g1 = m.gold[0], nsq = Game.place(m, 0, sn, 3, 12);
  assert.ok(nsq && Game.unplaceSquad(m, 0, nsq.id) && m.gold[0] === g1);
}
console.log('rework: Assassin, burn, roots, Bullhead, Rampager, goblin spawns, Flare, Hellfiend, Overwatch, Spirit walk, Awaken skills ok');
