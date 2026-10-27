// Headless check of the unit rework: the Assassin (Bloodrush bleed; Death Flurry and Shadow hunter ignore the tower), burn, Grasping roots, Bullhead, Rampager, More where that came from,
// Flare, the Hellfiend portal, Overwatch (and leaving it after 10 s without an enemy in sight), Spirit walk, Awaken skills (a 4th slot that needs skill 2 or 3, always its
// own price), either-or, and Enzo's free Forward planting. Run from the repo root: node tools/tests/rework.js
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
// the Assassin: dashes in hidden, strikes, 50% against buildings
{
  const a = body(unit('Assassin'), 0, 0, -12), v = body(dummy(400, { idle: true }), 1, 0, 0);
  const bt = E.createBattle([a], [v], G);
  let dashed = false, hiddenDash = true;
  for (let k = 0; k < 200 && v.alive; k++) { bt.step(); if (a.dashing && !(a.lastAtk > 0)) { dashed = true; hiddenDash = hiddenDash && a.hidden; } }
  assert.ok(dashed && hiddenDash, 'it dashes, hidden');
  assert.ok(!v.alive, 'one blow kills');
  assert.ok(!a.u.killStack && !(a.kills > 0), 'no kill stacks any more (Bloodrush is bleed now)');
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
// Bloodrush: every hit it lands gives the target 2 stacks of bleed (Death Flurry: every blow)
{
  assert.strictEqual(unit('Assassin').bleedHit, 2);
  assert.ok(/2 stacks of bleed/.test(unit('Assassin').trait2.text) && unit('Assassin').trait2.name === 'Bloodrush');
  const a = body({ ...unit('Assassin'), aps: 1 }, 0, 0, -1.5), v = body(dummy(1e5), 1, 0, 0); // quicker, so the bleed is still on at the next hit
  const bt = E.createBattle([a], [v], G);
  for (let k = 0; k < 100 && v.hp === v.u.hp; k++) bt.step();
  assert.ok(v.bleed && v.bleed.n === 2 && v.bleed.src === a, `2 stacks from one hit (${v.bleed && v.bleed.n})`);
  for (let k = 0; k < 200 && v.bleed && v.bleed.n === 2; k++) bt.step();
  assert.ok(v.bleed && v.bleed.n === 4, 'two hits: 4 stacks');
  const f = body(withSkills('Assassin', ['deathFlurry']), 0, 0, -1.5), w = body(dummy(1e5), 1, 0, 0);
  const bt2 = E.createBattle([f], [w], G);
  for (let k = 0; k < 100 && w.hp === w.u.hp; k++) bt2.step();
  assert.strictEqual(w.bleed.n, 2, 'the first blow: 2 stacks');
  steps(bt2, 0.5);
  assert.strictEqual(w.bleed.n, 4, 'the second blow: 4');
  steps(bt2, 0.5);
  assert.strictEqual(w.bleed.n, 5, 'the third: capped at 5');
}
// Death Flurry and Shadow hunter ignore the enemy tower: they go for units, and only hit the tower when nothing else
// is left that they could pick (here: a Sniper safe inside it), so a fight can't stall
{
  const tower = () => body(dummy(3000, { structure: true }), 1, 0, 0, 90);
  for (const ids of [['deathFlurry'], ['shadowHunter'], ['silentBlade', 'deathFlurry']]) {
    const a = body(withSkills('Assassin', ids), 0, 0, -1.5), tw = tower(), far = body(dummy(1e5), 1, 0, 25, 91);
    assert.ok(a.u.noTower, `${ids}: ignores the tower`);
    const bt = E.createBattle([a], [tw, far], G);
    steps(bt, 8);
    assert.ok(tw.hp === 3000 && far.hp < far.u.hp, `${ids}: walks past the tower to the unit (tower ${tw.hp}, unit ${far.u.hp - far.hp})`);
    assert.ok(a.lock === far && a.intent === far);
    // only the tower left to pick (a Sniper sits in it): it attacks the tower
    const b = body(withSkills('Assassin', ids), 0, 0, -1.5), tw2 = tower(), sn = body(unit('Sniper'), 1, 0, 0, 92);
    sn.inside = tw2;
    const bt2 = E.createBattle([b], [tw2, sn], G);
    steps(bt2, 6);
    assert.ok(tw2.hp < 3000, `${ids}: with nothing else to pick it hits the tower (${3000 - tw2.hp})`);
  }
  // a plain Assassin still goes for the nearest, the tower too; lesser structures (treasury, watchtowers) aren't ignored
  const p = body(unit('Assassin'), 0, 0, -1.5), tw = tower(), far = body(dummy(1e5), 1, 0, 25, 91);
  const bt = E.createBattle([p], [tw, far], G); steps(bt, 4);
  assert.ok(tw.hp < 3000, 'without the skills it hits the tower in its way');
  const q = body(withSkills('Assassin', ['deathFlurry']), 0, 0, -1.5), tr = body(dummy(3000, { structure: true, lesser: true }), 1, 0, 0, 93), far2 = body(dummy(1e5), 1, 0, 25, 94);
  const bt3 = E.createBattle([q], [tr, far2], G); steps(bt3, 4);
  assert.ok(tr.hp < 3000, 'a treasury is not the tower');
  // Death Flurry never leaps to the tower: a kill leaps it to the unit beyond
  const c = body(withSkills('Assassin', ['deathFlurry']), 0, 0, -1.5);
  const v1 = body(dummy(150), 1, 0, 0, 95), tw3 = body(dummy(3000, { structure: true }), 1, 3, 0, 96), v2 = body(dummy(1000), 1, 8, 0, 97);
  const bt4 = E.createBattle([c], [v1, tw3, v2], G);
  steps(bt4, 2);
  assert.ok(!v1.alive && tw3.hp === 3000 && v2.hp < 1000, `the leap skips the tower (${3000 - tw3.hp}, ${1000 - v2.hp})`);
}
// Death Flurry: three blows of 200; a kill leaps it to the next target within 10 m
{
  const a = body(withSkills('Assassin', ['deathFlurry']), 0, 0, -1.5);
  const v1 = body(dummy(150), 1, 0, 0, 11), v2 = body(dummy(1000), 1, 7, 0, 12);
  const bt = E.createBattle([a], [v1, v2], G);
  steps(bt, 2);
  assert.ok(!v1.alive && 1000 - v2.hp >= 400 - 1e-6 && 1000 - v2.hp < 450 && v2.bleed && v2.bleed.n === 4, `the 2nd and 3rd blows on the next target, and their bleed (${1000 - v2.hp})`);
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
// Overwatch: a Sniper that sees no enemy for 10 s leaves its building; a watchtower left empty is taken down
{
  assert.strictEqual(E.WATCH_IDLE, 10);
  const sn = withSkills('Sniper', ['rangerScope', 'overwatch']);
  const setup = (host, foeY) => {
    const s = body(sn, 0, 0, 0, 1), foe = body(dummy(1e6), 1, 0, foeY, 50);
    s.inside = host; s.x = host.x; s.y = host.y;
    return { s, foe, bt: E.createBattle([host, s], [foe], G) };
  };
  // in a watchtower, the enemy far out of sight (range + sight): out after 10 s, and the watchtower is gone
  const wt = body(Game.watchUnit(200), 0, 0, 0, Game.WATCH_SQ);
  const a = setup(wt, 150);
  steps(a.bt, 9.9);
  assert.ok(a.s.inside === wt && wt.alive, 'still inside after 9.9 s');
  steps(a.bt, 0.2);
  assert.ok(a.s.inside === null && !wt.alive && wt.removed && a.bt.crippled(0) === 0, 'out after 10 s; the watchtower is taken down (not destroyed)');
  steps(a.bt, 3);
  assert.ok(a.s.y > 1, `and it walks out to fight (${a.s.y.toFixed(1)})`);
  // in the tower: it leaves, the tower stays
  const tw = body(dummy(2000, { structure: true }), 0, 0, 0, -2);
  const b = setup(tw, 150);
  steps(b.bt, 10.1);
  assert.ok(b.s.inside === null && tw.alive && !tw.removed, 'it leaves the tower; the tower stays');
  // an enemy in sight keeps it in (the clock starts over whenever it sees one)
  const wt2 = body(Game.watchUnit(200), 0, 0, 0, Game.WATCH_SQ);
  const c = setup(wt2, 40);
  steps(c.bt, 15);
  assert.ok(c.s.inside === wt2 && wt2.alive, 'it stays while it sees an enemy');
  // the same through the game: a squad's bodies leave together and only then does its watchtower go
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const m = Game.createMatch(units, null, 5, 'standard'), si = units.findIndex(u => u.name === 'Sniper');
  m.gold = [5000, 5000]; m.unlocks[0][si] = 1; Game.ensureTower(m, 0);
  assert.ok(Game.place(m, 0, si, 2, 13) && Game.buySkill(m, 0, si, 1) && Game.buySkill(m, 0, si, 3));
  const bodies = Game.bodiesFor(m, 0), w = bodies.find(x => x.u.kind === 'watchtower'), mine = bodies.filter(x => x.inside === w);
  assert.ok(w && mine.length >= 1);
  const bt = E.createBattle(bodies, [body(dummy(1e6), 1, 0, 300, 60)], G);
  steps(bt, 10.1);
  assert.ok(mine.every(x => x.inside === null) && w.removed, 'the whole squad out, its watchtower gone');
}
// Forward planting with Enzo (each unit type comes with its first skill: the Ent's is Forward planting): his Ents may
// be planted in no man's land in round 1, once the skill works (2 squads; the one being placed counts). The placement
// rule used to look only at skills bought or built in, so Enzo's free Forward planting never let an Ent forward.
{
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const ent = units.findIndex(u => u.name === 'Ent');
  const match = (ch) => { const m = Game.createMatch(units, null, 7, 'standard'); m.chars = [ch, null]; m.gold[0] = 1000; m.unlocks[0][ent] = 1; Game.ensureTower(m, 0); return m; };
  const nm = Game.ROWS - Game.ZONE - 1; // side 0's row of no man's land next to its zone
  assert.ok(Game.inNoMans(nm));
  const m = match('enzo');
  assert.strictEqual(m.round, 1);
  assert.strictEqual(Game.skillDef(m, ent, Game.enzoSkill(m, 0, { unit: ent })).type, 'forward', 'Enzo\'s Ents come with Forward planting');
  const a = Game.place(m, 0, ent, 3, 13);
  assert.ok(a && !Game.enzoActive(m, 0, ent));
  assert.ok(!Game.moveSquad(m, 0, a.id, 3, nm), 'one Ent alone: its skill is off, so it can\'t go forward');
  assert.ok(Game.canPlaceAt(m, 0, 4, nm, ent), 'a second Ent turns it on: it may be placed forward straight away');
  const b = Game.place(m, 0, ent, 4, nm);
  assert.ok(b && b.row === nm && Game.enzoActive(m, 0, ent), 'placed in no man\'s land in round 1');
  assert.ok(Game.moveSquad(m, 0, a.id, 3, nm), 'and the first one can move up too');
  const fb = Game.bodiesFor(m, 0).filter(x => x.squad === a.id);
  assert.ok(fb.length && near(fb[0].u.hp, units[ent].hp * 1.1), 'its +10% health in the fight');
  // without Enzo: only once bought, as before; a player who didn't buy it can't
  const p = match(null), c = Game.place(p, 0, ent, 3, 13);
  assert.ok(!Game.canPlaceAt(p, 0, 4, nm, ent) && !Game.moveSquad(p, 0, c.id, 3, nm), 'not bought: not forward');
  assert.ok(Game.buySkill(p, 0, ent, 0) && Game.moveSquad(p, 0, c.id, 3, nm), 'bought in round 1: forward');
  // another leader can't use Enzo's skill
  const q = match('felix'); Game.place(q, 0, ent, 3, 13);
  assert.ok(!Game.canPlaceAt(q, 0, 4, nm, ent));
}
console.log('rework: Assassin, Bloodrush bleed, no tower for Death Flurry / Shadow hunter, burn, roots, Bullhead, Rampager, goblin spawns, Flare, Hellfiend, Overwatch (and leaving it after 10 s idle), Spirit walk, Awaken skills, Enzo\'s Forward planting ok');
