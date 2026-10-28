// Headless check of three fixes: a squad sold this round still stands for the opponent until the fight; bleed and
// poison don't take on buildings; an ally's aura (Reforge) and skill armor show where the sheets read them.
// Run from the repo root: node tools/tests/sold-afflict-aura.js
const assert = require('assert');
const Game = require('../../src/game.js');
const E = require('../../src/engine.js');
const demo = require('../../src/demo-units.json');
const roster = require('../../src/default-roster.json');
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: (u.skills || []).map(id => (roster.skills || []).find(s => s.id === id) || null) }));
const ui = (name) => units.findIndex(u => u.name === name);
const sq = (m, side, name, col, row, round, extra) => { const s = { id: m.nextId[side]++, unit: ui(name), col, row, level: 0, xp: 0, round, cost: units[ui(name)].cost, ...extra }; m.armies[side].push(s); return s; };
const skillAt = (name, id) => units[ui(name)].skills.indexOf(id);
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };

// ---- selling: the opponent keeps seeing the squad where it stood until the fight ----
{
  const m = Game.createMatch(units, demo.matrix, 11, 'standard');
  m.round = 3; m.gold = [1000, 1000];
  const old = sq(m, 1, 'Brute', 0, 4, 2), fresh = sq(m, 1, 'Fire Mage', 6, 2, 3);
  const g = m.gold[1];
  assert.ok(Game.sell(m, 1, old.id) > 0 && m.gold[1] > g, 'sold for gold');
  assert.ok(!m.armies[1].some(s => s.id === old.id), 'gone from their army');
  assert.deepStrictEqual(Game.shownArmy(m, 1).map(s => s.id), [fresh.id, old.id], 'still shown to the opponent');
  assert.ok(Game.enemyHolds(m, 0, 0, 4), 'its flank tile still looks held');
  assert.ok(Game.seenBy(m, 0).armies[1].some(s => s.id === old.id), 'the intent preview still has it');
  assert.ok(!Game.sell(m, 1, fresh.id), 'a squad placed this round is taken back, not sold');
  // a squad moved this round, then sold: shown on its old tile
  const moved = sq(m, 1, 'Sniper', 3, 1, 2);
  moved.from = { col: 4, row: 1 }; moved.movedRound = m.round;
  Game.sell(m, 1, moved.id);
  const ghost = Game.shownArmy(m, 1).find(s => s.id === moved.id), at = Game.seenAt(m, ghost);
  assert.deepStrictEqual([at.col, at.row], [4, 1], 'where they last saw it');
  // the fight and the next round: gone for real
  m.armies[0].push({ id: m.nextId[0]++, unit: ui('Brute'), col: 5, row: 12, level: 0, xp: 0, round: 3, cost: 2 });
  const sim = Game.startBattle(m);
  assert.ok(!sim.bodies.some(b => b.side === 1 && (b.squad === old.id || b.squad === moved.id)), 'a sold squad doesn\'t fight');
  for (let k = 0; k < 20000 && sim.step(); k++) {}
  Game.resolve(m, sim.result());
  assert.ok(!Game.shownArmy(m, 1).some(s => s.id === old.id || s.id === moved.id), 'next round: gone');
}
// a carrier sold: its rider steps out, but to the opponent it is still inside
{
  const carrier = units.findIndex(u => u.carrier);
  if (carrier >= 0) {
    const m = Game.createMatch(units, demo.matrix, 12, 'standard');
    m.round = 3;
    const c = { id: m.nextId[1]++, unit: carrier, col: 5, row: 3, level: 0, xp: 0, round: 2, cost: 1 };
    m.armies[1].push(c);
    const r = sq(m, 1, 'Shiv', 5, 3, 2, { in: c.id });
    Game.sell(m, 1, c.id);
    assert.ok(!Game.isRider(r) && r.freed === 3, 'it stepped out');
    assert.ok(Game.hiddenFromFoe(m, r), 'hidden from the opponent until the fight');
    assert.ok(!Game.seenBy(m, 0).armies[1].some(s => s.id === r.id));
    m.round = 4;
    assert.ok(!Game.hiddenFromFoe(m, r), 'the next round it shows');
  }
}
// Mark Bounty on a squad sold this round: still on until the next round, so the sale stays hidden
{
  const m = Game.createMatch(units, demo.matrix, 13, 'standard');
  m.round = Game.TOWER_PICK_ROUND; m.towers[0].type = 'sniper'; m.gold = [2000, 2000];
  const t = sq(m, 1, 'Brute', 5, 3, 1);
  assert.ok(Game.placeMark(m, 0, t.id));
  Game.sell(m, 1, t.id);
  assert.ok(!Game.markLost(m, 0) && !Game.canMark(m, 0), 'no free mark again while the sale is hidden');
  m.round++; m.sold = [[], []];
  assert.ok(Game.markLost(m, 0) && Game.canMark(m, 0), 'the next round it can be placed again');
}

// ---- bleed and poison: units only, never buildings ----
{
  const unit = (n) => ({ ...roster.units.find(x => x.name === n), cost: 1 });
  const skill = (id) => roster.skills.find(s => s.id === id);
  const target = (extra) => E.buildSquad(E.withTraits({ name: 'Target', cost: 1, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra }), 1, 0, 5, 2, 6)[0];
  for (const [att, extra, what] of [['Shiv', [], 'bleed'], ['Skeleton Archers', ['graverot'], 'poison']]) for (const [kind, ex] of [['tower', { structure: true }], ['wall', { structure: true, lesser: true }], ['factory', { building: 'factory' }], ['unit', {}]]) {
    const a = E.buildSquad(E.applySkills(unit(att), extra.map(skill), roster.units), 0, 0, -10, 1, 6)[0];
    const v = target(ex), far = E.buildSquad(E.withTraits({ name: 'Far', cost: 1, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true }), 1, 0, 200, 3, 6)[0]; // keeps the fight going
    const bt = E.createBattle([a], [v, far], G);
    let got = false;
    for (let k = 0; k < 600; k++) { bt.step(); if (what === 'bleed' ? v.bleed : v.poison && v.poison.length) got = true; }
    assert.ok(v.hp < 1e6, `${att} hits the ${kind}`);
    assert.strictEqual(got, kind === 'unit', `${what} on a ${kind}: ${got}`);
  }
}

// ---- Reforge: the engine's aura, the live numbers the fight card reads, and the sheet's (Game.auraNear) ----
{
  const m = Game.createMatch(units, demo.matrix, 14, 'standard');
  m.round = 2;
  m.tech[0][ui('Steel Wizard')] = E.SLOTS.map(k => k === skillAt('Steel Wizard', 'heavyMetal') || k === skillAt('Steel Wizard', 'reforge') ? 1 : 0);
  const w = sq(m, 0, 'Steel Wizard', 5, 12, 1), near = sq(m, 0, 'Brute', 6, 12, 1), far = sq(m, 0, 'Brute', 0, 15, 1);
  sq(m, 1, 'Brute', 5, 2, 1);
  const wu = Game.fieldUnit(m, 0, w);
  assert.ok(wu.aura && wu.aura.hit === 20 && wu.aura.aps === 0.1 && wu.aura.radius === 8, 'Reforge');
  assert.strictEqual(E.armorOf(wu), 6 + 4 + 2, 'Steel armor 6, Heavy metal +4, Reforge +2');
  const a = Game.auraNear(m, 0, near);
  assert.ok(a && a.hit === 20 && a.aps === 0.1 && a.from === ui('Steel Wizard') && a.radius === 8, 'the Brute next to it gets it');
  assert.strictEqual(Game.auraNear(m, 0, far), null, 'the Brute far off doesn\'t');
  assert.strictEqual(Game.auraNear(m, 0, w), null, 'not from itself');
  // fieldUnit is the unit the fight builds (before its level)
  for (const s of m.armies[0]) assert.deepStrictEqual(Game.bodiesFor(m, 0).find(b => b.squad === s.id).u, E.leveled(Game.fieldUnit(m, 0, s), s.level));
  const sim = Game.startBattle(m); sim.step();
  const bn = sim.bodies.find(b => b.squad === near.id), bf = sim.bodies.find(b => b.squad === far.id);
  assert.ok(bn.auraHit === 20 && Math.abs(bn.auraAps - 0.1) < 1e-9, 'in the fight');
  assert.strictEqual(E.liveHit(bn), bn.u.hit + 20, 'the card shows the hit with the aura');
  assert.ok(Math.abs(E.liveAps(bn) - (bn.u.aps + 0.1)) < 1e-9, 'and the attacks a second');
  assert.ok(!(bf.auraHit > 0) && E.liveHit(bf) === bf.u.hit);
  // skill armor and ward
  assert.strictEqual(E.armorOf({ defense: 'armor', defVal: 3, bonusArmor: 4 }), 7);
  assert.strictEqual(E.wardOf({ defense: 'ward', defVal: 60, bonusWard: 40 }), 40);
  assert.strictEqual(E.wardOf({ defense: 'none', defVal: 40, bonusWard: 40 }), 40);
  assert.strictEqual(E.wardOf({ defense: 'none', defVal: 40 }), 0);
}
console.log('sold-afflict-aura: all good');
