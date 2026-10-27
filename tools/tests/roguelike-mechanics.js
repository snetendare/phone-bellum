// Headless check of the fight mechanics for the roguelike's enemy units (docs/ROGUELIKE.md): death zones (Plague
// Carriers), the Bannerman's aura, cast walls (Wall Engineers), regrowth stopped by fire (the Hydra), skill copy
// (Mirror Wraith) and raise dead (the Lich). Run from the repo root: node tools/tests/roguelike-mechanics.js
const assert = require('assert');
const E = require('../../src/engine.js');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };
const unit = (name, extra) => E.withTraits({ name, cost: 1, bodies: 1, hp: 1000, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, ...extra });
const dummy = (hp, extra) => unit('Dummy', { hp, idle: true, ...extra });
let nextSq = 1;
const body = (u, side, x, y, squad) => E.buildSquad(u, side, x, y, squad == null ? nextSq++ : squad, 6)[0];
const steps = (bt, s) => { for (let k = 0; k < Math.round(s / G.dt); k++) bt.step(); };
const anchor = () => body(dummy(1e9), 1, 0, 80); // keeps side 1 in the fight, far from everything

// Death zone: where a Plague Carrier falls, its enemies take dps a second for secs seconds; its own side doesn't
{
  const carrier = body(dummy(1, { deathZone: { r: 3, dps: 20, secs: 6 } }), 1, 0, 0);
  const shooter = body(unit('Shooter', { hit: 50, range: 20 }), 0, 0, -12);
  const near = body(dummy(1000), 0, 1, 0), far = body(dummy(1000), 0, 10, 0);
  const friend = body(dummy(1000), 1, -1, 0.5);
  friend.hp = 500;
  const bt = E.createBattle([shooter, near, far], [carrier, friend, anchor()], G);
  for (let k = 0; k < 100 && carrier.alive; k++) bt.step();
  assert.ok(!carrier.alive, 'the carrier falls');
  assert.strictEqual(bt.pools().length, 1, 'a death zone where it fell');
  const before = near.hp;
  steps(bt, 7);
  assert.ok(Math.abs(before - near.hp - 120) < 3, `20 a second for 6 s (${before - near.hp})`);
  assert.strictEqual(far.hp, 1000, 'out of reach: untouched');
  assert.ok(friend.hp <= 500, 'its own side is not healed');
  assert.strictEqual(bt.pools().length, 0, 'it dries up');
}

// The Bannerman's aura: +pct % hit size and +armor for allies within radius
{
  const hitOnce = (withBanner) => {
    const target = body(dummy(1e6), 1, 0, 3);
    const hitter = body(unit('Hitter', { hit: 100, range: 5 }), 0, 0, 0);
    const banner = body(dummy(500, { aura: { radius: 8, hit: 0, aps: 0, pct: 20, armor: 2 } }), 0, 4, -1);
    const bt = E.createBattle(withBanner ? [hitter, banner] : [hitter], [target], G);
    for (let k = 0; k < 100 && target.hp === 1e6; k++) bt.step();
    return 1e6 - target.hp;
  };
  assert.ok(Math.abs(hitOnce(false) - 100) < 1e-6, 'a plain hit');
  assert.ok(Math.abs(hitOnce(true) - 120) < 1e-6, '+20% near the banner');
  const takeOnce = (withBanner) => {
    const ally = body(dummy(1e6), 0, 0, 0), banner = body(dummy(500, { aura: { radius: 8, pct: 0, armor: 2 } }), 0, 4, -1);
    const foe = body(unit('Foe', { hit: 10, range: 5 }), 1, 0, 3);
    const bt = E.createBattle(withBanner ? [ally, banner] : [ally], [foe], G);
    for (let k = 0; k < 100 && ally.hp === 1e6; k++) bt.step();
    return 1e6 - ally.hp;
  };
  assert.ok(Math.abs(takeOnce(false) - 10) < 1e-6 && Math.abs(takeOnce(true) - 8) < 1e-6, '+2 armor near the banner');
}

// Cast walls: each Wall Engineer puts up one wall ahead of itself at its time; enemies can't shoot through it
{
  const eng = body(unit('Wall Engineers', { walls: { at: 1, ahead: 8, hp: 300, armor: 4, half: 3 } }), 0, 0, -20);
  const archer = body(unit('Archer', { hit: 20, range: 30 }), 1, 0, 5);
  const bt = E.createBattle([eng], [archer, anchor()], G);
  steps(bt, 0.5);
  assert.ok(!bt.bodies.some(b => b.u.kind === 'wall'), 'no wall before its time');
  steps(bt, 1);
  const walls = bt.bodies.filter(b => b.u.kind === 'wall');
  assert.strictEqual(walls.length, 1, 'one wall');
  const w = walls[0];
  assert.ok(w.side === 0 && w.u.barrier === 3 && w.u.structure && Math.abs(w.y - -12) < 1e-6 && Math.abs(w.x) < 1e-6, 'its side, 8 m ahead');
  const engHp = eng.hp;
  steps(bt, 3);
  assert.strictEqual(eng.hp, engHp, 'the archer can\'t shoot through the wall');
  assert.ok(w.hp < 300, 'it shoots the wall instead');
  const r = bt.result();
  assert.ok(!Object.values(r.squads).some(s => s.squad === -3000 && s.total > 0), 'the wall is not a squad of its own');
}

// Regrowth: a Hydra head that falls grows back after secs seconds, unless fire touched the squad in the last block seconds
{
  const hydra = (extra) => [-3, 0, 3].map(x => body(dummy(1000, { name: 'Hydra', regrow: { secs: 2, pct: 50, block: 3, by: ['Torch'] }, ...extra }), 1, x, 10, 77));
  const sniper = () => body(unit('Sniper', { hit: 3000, aps: 0.25, range: 30 }), 0, 0, -10);
  {
    const heads = hydra(), bt = E.createBattle([sniper()], heads, G);
    steps(bt, 7);
    assert.ok(heads.some(h => h.regrown > 0), 'a head grew back');
    const back = heads.find(h => h.regrown > 0);
    assert.ok(back.hp <= 500 + 1e-6, 'at half health');
  }
  {
    const heads = hydra(), torch = body(unit('Torch', { hit: 1, aps: 2, range: 30 }), 0, 2, -10);
    const bt = E.createBattle([sniper(), torch], heads, G);
    steps(bt, 7);
    assert.ok(!heads.some(h => h.regrown > 0), 'fire keeps the heads from growing back');
  }
  {
    const heads = hydra(), flamer = body(unit('Flamer', { hit: 1, aps: 2, range: 30, flame: 10 }), 0, 2, -10);
    const bt = E.createBattle([sniper(), flamer], heads, G);
    steps(bt, 7);
    assert.ok(!heads.some(h => h.regrown > 0), 'so does any flame cone');
  }
}

// Copy skill: the Mirror Wraith takes the first skill it can from the first enemy it hits
{
  const regen = { id: 't-regen', type: 'regen', params: { pct: 2, hp: 20 } }, spawn = { id: 't-spawn', type: 'spawn', params: {} };
  const foe = body(E.applySkills(dummy(1e6), [spawn, regen], []), 1, 0, 3);
  assert.deepStrictEqual(foe.u.skillsHad.map(d => d.type), ['spawn', 'regen'], 'a unit remembers its skills');
  const wraith = body(unit('Mirror Wraith', { hit: 10, range: 5, copySkill: true }), 0, 0, 0);
  wraith.hp = 500; // half its health
  const bt = E.createBattle([wraith], [foe], G);
  for (let k = 0; k < 100 && !wraith.copied; k++) bt.step();
  assert.strictEqual(wraith.copied, 'regen', 'spawn can\'t be copied mid-fight, so regen');
  assert.ok(wraith.u.regen === 2 && Math.abs(wraith.u.hp - 1200) < 1e-6, 'with its effects');
  assert.ok(wraith.hp > 590 && wraith.hp < 620, `the same share of its new max, then regenerating (${wraith.hp})`);
}

// Raise dead: enemies falling near the Lich get up on its side, at most max of them, at pct % health
{
  const lich = body(dummy(1e6, { name: 'Lich', raise: { radius: 15, max: 2, pct: 50 } }), 1, 0, 12);
  const killer = body(unit('Killer', { hit: 100, aps: 2, range: 10 }), 1, 0, 9);
  const victims = [0, 2, 4].map(x => body(dummy(50), 0, x, 4, 3));
  const bt = E.createBattle(victims.slice(), [lich, killer], G); // a copy: bodies that switch sides move between the arrays
  steps(bt, 5);
  const risen = victims.filter(v => v.risen);
  assert.strictEqual(risen.length, 2, 'two raised');
  assert.ok(risen.every(v => v.alive && v.side === 1 && Math.abs(v.hp - 25) < 1e-6), 'on the Lich\'s side at half health');
  assert.ok(victims.some(v => !v.alive && !v.risen), 'the third stays down');
  const r = bt.result();
  assert.strictEqual(r.winner, 1);
  assert.deepStrictEqual(r.converted, [0, 2]);
  const sq = Object.values(r.squads).find(s => s.side === 0 && s.squad === 3);
  assert.ok(sq.total === 3 && sq.alive === 0, 'all three lost for their squad');
}

// Every enemy in src/roguelike-enemies.json loads (spawn names resolved from the roster, apply skills applied) and
// fights a few roster units to the end without errors, from both sides
{
  const roster = require('../../src/default-roster.json').units;
  const data = require('../../src/roguelike-enemies.json');
  const plain = (name) => { const u = roster.find(x => x.name === name) || data.units.find(x => x.name === name); assert.ok(u, 'unknown unit ' + name); const { skills, skillDefs, skillsOn, skillsInnate, skillMods, ...p } = u; return E.withTraits({ ...p, level: 0 }); };
  const load = (d) => {
    const { apply, act, role, twist, place, elite, todo, runSteal, ...u } = d;
    if (u.spawn && typeof u.spawn.unit === 'string') u.spawn = { waves: 0, ...u.spawn, unit: plain(u.spawn.unit) };
    if (u.deathSpawn && !u.deathSpawn.unit) u.deathSpawn = { ...u.deathSpawn, unit: plain(u.deathSpawn.name) };
    return Array.isArray(apply) && apply.length ? E.applySkills(u, apply, roster) : E.withTraits(u);
  };
  const foes = ['Goblin Swarm', 'Fire Mage', 'Brute', 'Sniper'].map(plain);
  for (const d of data.units.concat(data.bosses)) {
    const u = load(d);
    for (const f of foes) for (const side of [0, 1]) {
      const a = E.buildSquad(u, side, 0, side === 0 ? -10 : 10, 1, 6), b = E.buildSquad(f, 1 - side, 0, side === 0 ? 10 : -10, 2, 6);
      const bt = E.createBattle(side === 0 ? a : b, side === 0 ? b : a, G);
      while (bt.step());
      const r = bt.result();
      assert.ok(r.winner >= -1 && (r.time > 0 || u.structure), d.name + ' vs ' + f.name); // a building alone doesn't count as an army: that fight ends at once
    }
  }
}

console.log('roguelike mechanics: all checks passed');
