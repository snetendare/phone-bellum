// Headless check of the Shiv and the Water Mage, bleed, the Steel and Earth Wizard skills, either-or skills, the
// heal cut while poisoned and the Test Grid's range and speed. Run from the repo root: node tools/tests/shiv-water.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
const roster = require('../../src/default-roster.json');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };
const unit = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
const skill = (id) => roster.skills.find(s => s.id === id);
const withSkills = (n, ids) => E.applySkills(unit(n), ids.map(skill), roster.units);
const body = (u, side, x, y) => E.buildSquad(u, side, x, y, side * 10, 6)[0];
const dummy = (hp, extra) => E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra });
const steps = (bt, s) => { for (let k = 0; k < Math.round(s / G.dt); k++) bt.step(); };

// bleed: every second knife on the same target is a stack; 3 health a pulse for 2.5 s, doubled per stack
{
  const shiv = body(unit('Shiv'), 0, 0, -10), d = body(dummy(100000), 1, 0, 5);
  const bt = E.createBattle([shiv], [d], G);
  for (let k = 0; k < 400 && !d.bleed; k++) bt.step();
  assert.ok(d.bleed, 'the dummy bleeds');
  assert.strictEqual(shiv.knives.get(d), 2, 'the second knife brings the first stack');
  assert.strictEqual(d.bleed.n, 1);
  steps(bt, 8);
  assert.strictEqual(d.bleed.n, E.BLEED.max, 'stacks top out at ' + E.BLEED.max);
  assert.ok(d.bleed.t <= E.BLEED.secs + 1e-9, 'a stack lasts ' + E.BLEED.secs + ' s');
  assert.ok(E.BLEED.dmg === 3 && E.BLEED.secs === 2.5 && E.BLEED.pulse === 0.5, 'bleed: 3 a pulse, twice a second, for 2.5 s');
  // a lone stack: 5 pulses of 3 over 2.5 s, then it is gone
  const v = body(dummy(1000), 1, 0, 0), src = body(dummy(1000), 0, 0, -30); // a source that never attacks: only the bleed hurts v
  const bt2 = E.createBattle([src], [v], G);
  const bleed = (n) => { v.bleed = { n, t: E.BLEED.secs, pulse: E.BLEED.pulse, src, noHeal: false }; };
  bleed(1); steps(bt2, 3.5);
  assert.ok(Math.abs(v.hp - 985) < 1e-6, `1 stack: 15 damage in all (${v.hp})`);
  assert.strictEqual(v.bleed, null, 'and then it stops');
  v.hp = 1000; bleed(4); steps(bt2, 3.5);
  assert.ok(Math.abs(v.hp - (1000 - 5 * 24 - 2.5 * 2 / 100 * 1000)) < 1e-6, `4 stacks: 24 a pulse and 2% of max health a second (${v.hp})`);
  v.hp = 1000; bleed(5); steps(bt2, 3.5);
  assert.ok(Math.abs(v.hp - (1000 - 5 * 48 - 2.5 * 5 / 100 * 1000)) < 1e-6, `5 stacks: 48 a pulse and 5% of max health a second (${v.hp})`);
}
// Anemia stuns at 5 stacks; Too deep stops regeneration and lasts a second longer
{
  const d = body(dummy(100000, { regen: 5 }), 1, 0, 5);
  const s = body(withSkills('Shiv', ['anemia', 'tooDeep']), 0, 0, -10);
  const bt = E.createBattle([s], [d], G);
  let stunned = false, regenWhileBleeding = false, maxT = 0;
  for (let k = 0; k < 600; k++) {
    const hp = d.hp; bt.step();
    if (d.stunT > 0) stunned = true;
    if (d.bleed) maxT = Math.max(maxT, d.bleed.t);
    if (d.bleed && d.bleed.noHeal && d.hp > hp + 1e-9) regenWhileBleeding = true;
  }
  assert.ok(stunned, 'Anemia: stunned at 5 stacks');
  assert.ok(!regenWhileBleeding, 'Too deep: no regeneration while it bleeds');
  assert.ok(maxT > E.BLEED.secs + 0.5, 'Too deep: bleed lasts a second longer');
}
// poisoned bodies heal half as much
{
  const a = body(dummy(1000, { regen: 10 }), 0, 0, -5), foe = body(dummy(1000), 1, 0, 30);
  const bt = E.createBattle([a], [foe], G);
  a.hp = 500; bt.step(); const clean = a.hp - 500;
  a.hp = 500; a.poison = [{ src: null, dps: 0, t: 5 }]; bt.step(); const poisoned = a.hp - 500;
  assert.ok(Math.abs(poisoned - clean * E.POISON_HEAL / 100) < 1e-9, `poisoned: ${poisoned} vs ${clean}`);
}
// Water Mage: its splash heals allies; with no enemy in reach it shoots the most wounded ally
{
  const wm = body(unit('Water Mage'), 0, 0, -10), ally = body(dummy(1000), 0, 4, -10), foe = body(dummy(1000), 1, 0, 60);
  ally.hp = 400;
  const bt = E.createBattle([wm, ally], [foe], { ...G, sight: 0, minSight: 0 });
  wm.u = { ...wm.u, speed: 0 };
  steps(bt, 4);
  assert.ok(ally.hp > 400 + unit('Water Mage').hit, `the ally was healed (${ally.hp})`);
}
// Pool shaper leaves pools that don't overlap; Flow state stacks while it stands still
{
  const r = E.battle(withSkills('Water Mage', ['poolShaper']), unit('Goblin Swarm'), G, { record: false });
  assert.ok(r.time > 0);
  const wm = body(withSkills('Water Mage', ['poolShaper', 'flowState'].slice(0, 1)), 0, 0, -10), foes = E.buildSquad(unit('Brute'), 1, 0, 14, 1, 6);
  const bt = E.createBattle([wm], foes, G);
  let most = 0;
  while (bt.step()) { const ps = bt.pools(); most = Math.max(most, ps.length); for (const p of ps) for (const q of ps) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= p.r + q.r - 1e-9, 'pools never overlap'); }
  assert.ok(most >= 1, 'pools were made');
  const fl = body(withSkills('Water Mage', ['flowState']), 0, 0, -10), golem = E.buildSquad(unit('Ether Golem'), 1, 0, 30, 1, 6);
  const bt2 = E.createBattle([fl], golem, G);
  let top = 0; while (bt2.step()) top = Math.max(top, fl.flow || 0);
  assert.strictEqual(top, 5, 'Flow state tops out at 5 stacks');
}
// Steel Wizard: 6 armor; Reforge's aura; Titanium spears cost armor and bleed
{
  const sw = unit('Steel Wizard');
  assert.strictEqual(sw.defense, 'armor'); assert.strictEqual(sw.defVal, 6);
  const sp = body(withSkills('Steel Wizard', ['titanSpears']), 0, 0, -6), bru = E.buildSquad(unit('Brute'), 1, 0, 6, 1, 6);
  const bt = E.createBattle([sp], bru, G);
  let thrown = 0, bled = false;
  while (bt.step()) { thrown = Math.max(thrown, -(sp.u.bonusArmor || 0)); if (bru.some(b => b.bleed)) bled = true; }
  assert.ok(thrown >= 2 && thrown <= 6, `spears spend armor (${thrown})`);
  assert.ok(bled, 'a spear makes its target bleed');
  const rf = body(withSkills('Steel Wizard', ['reforge']), 0, 0, -10), gob = E.buildSquad(unit('Goblin Swarm'), 0, 0, -6, 2, 6), far = E.buildSquad(unit('Goblin Swarm'), 0, 30, -10, 3, 6);
  const bt2 = E.createBattle([rf, ...gob, ...far], [body(dummy(1e6), 1, 0, 40)], G);
  bt2.step();
  assert.ok(gob.every(b => b.auraHit === 20 && Math.abs(b.auraAps - 0.1) < 1e-9), 'allies near it get the aura');
  assert.ok(far.every(b => !b.auraHit) && !rf.auraHit, 'not those far away, nor itself');
  rf.alive = false; bt2.step();
  assert.ok(gob.every(b => !b.auraHit && !b.auraAps), 'the aura goes when the Steel Wizard falls');
}
// Earth Wizard: Living armor slams a cone and stuns; Stone spikes shoots twice
{
  const la = withSkills('Earth Wizard', ['livingArmor']);
  assert.strictEqual(la.hit, 200); assert.strictEqual(la.range, unit('Earth Wizard').range - 13);
  assert.ok(la.flame === 25 && unit('Flame Wizard').flame === 30, 'Living armor: its own 25° cone, narrower than the Flame Wizard’s 30°'); assert.ok(la.flame > 0 && la.stunHit === 1 && la.bonusArmor === 8);
  const ew = body(la, 0, 0, -6), bru = E.buildSquad(unit('Brute'), 1, 0, 8, 1, 6);
  const bt = E.createBattle([ew], bru, G);
  let stun = false; while (bt.step()) if (bru.some(b => b.alive && b.stunT > 0)) stun = true;
  assert.ok(stun, 'the slam stuns');
  const ss = withSkills('Earth Wizard', ['stoneSpikes']);
  assert.strictEqual(ss.burst, 2); assert.strictEqual(ss.range, unit('Earth Wizard').range + 5);
  assert.ok(Math.abs(ss.aps - unit('Earth Wizard').aps * 0.8) < 1e-9, 'Stone spikes: 20% slower');
}
console.log('engine: bleed, Anemia, Too deep, poison heal cut, Waterhealing, pools, Flow state, Steel and Earth Wizard skills ok');

// the game: tiers, unlocks, the Standard pack, either-or skills, the Test Grid's range and speed
const units = demo.units.map(u => ({ ...E.withTraits(u), skillDefs: E.SLOTS.map(k => {
  const base = u.skills && demo.skills.find(s => s.id === u.skills[k]); if (!base) return null;
  const mod = u.skillMods && u.skillMods[k]; return mod ? { ...base, cost: mod.cost != null ? mod.cost : base.cost, params: { ...base.params, ...(mod.params || {}) } } : base;
}) })); // as the page resolves them
const ix = (n) => units.findIndex(u => u.name === n);
{
  const m = Game.createMatch(units, demo.matrix, 7, 'standard');
  assert.strictEqual(Game.tierOf(units, ix('Shiv')), 2); assert.strictEqual(Game.tierOf(units, ix('Water Mage')), 3);
  assert.strictEqual(Game.unlockCost(m, ix('Slimeshots')), Game.unlockCost(m, ix('Brute')), 'Slimeshots unlock like the other tier 2 units');
  assert.strictEqual(units[ix('Slimeshots')].cost, units[ix('Brute')].cost);
  for (const n of ['Shiv', 'Water Mage']) assert.ok(Game.STANDARD_PACK.units.includes(n), n + ' is in the Standard pack');
  // either-or: skill 2 or skill 3, not both
  for (const n of ['Shiv', 'Water Mage', 'Steel Wizard', 'Earth Wizard']) {
    const ui = ix(n), mm = Game.createMatch(units, demo.matrix, 9, 'standard');
    mm.gold[0] = 5000; mm.unlocks[0][ui] = 1;
    assert.ok(Game.place(mm, 0, ui, 5, Game.zoneRows(0)[0]), 'placed ' + n);
    assert.ok(Game.buySkill(mm, 0, ui, 0) && Game.buySkill(mm, 0, ui, 1), n + ': skills 1 and 2');
    assert.ok(!Game.canBuySkill(mm, 0, ui, 2) && !Game.buySkill(mm, 0, ui, 2), n + ': not skill 3 as well');
    assert.deepStrictEqual(Game.skillOrTaken(mm, 0, ui, 2), [1]);
    assert.ok(Game.undoSkill(mm, 0, ui, 1) && Game.buySkill(mm, 0, ui, 2), n + ': skill 3 once skill 2 is taken back');
  }
  const ai = Game.createMatch(units, demo.matrix, 11, 'standard');
  for (let r = 0; r < 12 && !ai.over; r++) { Game.aiDeploy(ai, 0); Game.aiDeploy(ai, 1); const sim = Game.startBattle(ai); while (sim.step()) {} Game.resolve(ai, sim.result()); }
  for (const sd of [0, 1]) for (const ui of [ix('Shiv'), ix('Water Mage'), ix('Steel Wizard'), ix('Earth Wizard')]) assert.ok(!(Game.hasSkill(ai, sd, ui, 1) && Game.hasSkill(ai, sd, ui, 2)), 'the AI keeps to either-or');
}
{
  const m = Game.createMatch(units, demo.matrix, 5, 'testgrid'), row = Game.zoneRows(0)[0];
  m.gold[0] = 5000; m.extraDeploys[0] = 10;
  const at = {};
  ['Fire Mage', 'Goblin Swarm', 'Brute', 'Sniper', 'Shiv', 'Water Mage', 'Ether Golem'].forEach((n, k) => { m.unlocks[0][ix(n)] = 1; assert.ok(Game.place(m, 0, ix(n), 1 + k, row), n); at[n] = m.armies[0][m.armies[0].length - 1].id; });
  const bodies = Game.bodiesFor(m, 0), of = (n) => bodies.find(b => b.squad === at[n]).u, base = (n) => units[ix(n)];
  assert.strictEqual(of('Fire Mage').range, base('Fire Mage').range + 2, 'ranged units: +2 m');
  assert.strictEqual(of('Ether Golem').range, base('Ether Golem').range + 2, '5 m: +2 m');
  assert.strictEqual(of('Goblin Swarm').range, base('Goblin Swarm').range, 'melee keeps its range');
  assert.ok(Math.abs(of('Fire Mage').speed - (base('Fire Mage').speed - 0.2)) < 1e-9, 'speed 3: −0.2');
  assert.ok(Math.abs(of('Goblin Swarm').speed - (base('Goblin Swarm').speed - 0.4)) < 1e-9, 'speed 5 and up: −0.4');
  assert.ok(Math.abs(of('Brute').speed - (base('Brute').speed - 0.4)) < 1e-9, 'speed 5: −0.4');
  assert.strictEqual(of('Sniper').speed, base('Sniper').speed, 'under 3 keeps its speed');
  for (const n of ['Shiv', 'Water Mage']) { assert.strictEqual(of(n).range, base(n).range, n + ' keeps its range'); assert.strictEqual(of(n).speed, base(n).speed, n + ' keeps its speed'); }
  const sq = m.armies[0].find(s => s.id === at['Fire Mage']);
  assert.strictEqual(Game.squadRange(m, 0, sq), base('Fire Mage').range + 2, 'the range ring shows it too');
  const std = Game.createMatch(units, demo.matrix, 5, 'standard'); std.gold[0] = 5000; std.unlocks[0][ix('Fire Mage')] = 1;
  Game.place(std, 0, ix('Fire Mage'), 3, Game.zoneRows(0)[0]);
  assert.strictEqual(Game.bodiesFor(std, 0)[0].u.range, base('Fire Mage').range, 'other maps keep it');
}
console.log('game: tiers, Slimeshots unlock, Standard pack, either-or skills, Test Grid range and speed ok');
