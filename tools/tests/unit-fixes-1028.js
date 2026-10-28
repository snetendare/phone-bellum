// Headless check of the 2026-10-28 unit fixes: the Frost Wizard keeps its beam on one enemy, the awakened Obelisk
// poisons, Obelisk lifesteal and level health, Aeroblades, Meteor Caller, and the War Mammoth's reworked charge
// (cooldown, no stun, longer and faster run, stomp round itself). Run from the repo root: node tools/tests/unit-fixes-1028.js
const assert = require('assert');
const E = require('../../src/engine.js');
const roster = require('../../src/default-roster.json');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };
const unit = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
const skill = (id) => roster.skills.find(x => x.id === id);
const body = (u, side, x, y, sq = side * 10) => E.buildSquad(u, side, x, y, sq, 6)[0];
const dummy = (hp, extra) => E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra });

// Frost Wizard: the beam stays on its target while a closer enemy walks up; the shot records name shooter and target
{
  const fw = body(unit('Frost Wizard'), 0, 0, -20), a = body(dummy(1e6), 1, 0, 2), b = body(dummy(1e6), 1, 0, 30, 11);
  const bt = E.createBattle([fw], [a, b], G, { record: true });
  const seen = new Set();
  for (let k = 0; k < 120; k++) { bt.step(); if (k === 40) { b.x = 0; b.y = -12; } for (const s of bt.lastShots()) if (s[13] === 1) { assert.ok(s[14] === fw, 'shooter recorded'); seen.add(s[15]); } }
  assert.ok(seen.size === 1 && seen.has(a), 'one target the whole time, even with a closer enemy');
}
// awakened Obelisk poisons
{
  const eye = E.applySkills(unit('Obelisk'), [skill('obeliskEye')], roster.units);
  assert.ok(eye.eye && eye.poisonPct === 50 && eye.poisonDur === 4, 'Eye of the Obelisk: 50% poison over 4 s');
  assert.ok(!(E.applySkills(unit('Obelisk'), [], roster.units).poisonPct > 0), 'no poison asleep');
  const o = unit('Obelisk');
  assert.strictEqual(o.lifesteal, 20);
  assert.ok(Math.abs(E.leveled(o, 1).hp - o.hp * 1.75) < 1e-6 && Math.abs(E.leveled(o, 1).hit - o.hit * 2) < 1e-6, 'level: +75% health, +100% hit');
  const d = body(dummy(1e6), 1, 0, 0), ob = body(eye, 0, 0, -15);
  const bt = E.createBattle([ob], [d], G);
  for (let k = 0; k < 200 && !(d.poison && d.poison.length); k++) bt.step();
  assert.ok(d.poison && d.poison.length, 'its gaze poisons');
}
// Aeroblades and Meteor Caller
assert.strictEqual(skill('aeroblades').params.hit, 15);
{ const m = unit('Meteor Caller'); assert.ok(m.hit === 105 && m.minRange === 16); }
// War Mammoth: charges, isn't stunned, can't charge again for 10 s, runs 14 m on, stomps everything within 3.5 m
{
  const wm = unit('War Mammoth');
  assert.ok(wm.chargeStun === 0 && wm.chargeCd === 10 && wm.trampleRun === 14 && wm.stomp === 3.5);
  const m = body(wm, 0, 0, -30), foes = [body(dummy(1e6), 1, -1.5, 0), body(dummy(1e6), 1, 1.5, 0, 11), body(dummy(1e6), 1, 0, 25, 12)];
  const bt = E.createBattle([m], foes, G);
  let charges = 0, stunned = false, far = -Infinity, prevAt = 0;
  for (let k = 0; k < Math.round(25 / G.dt); k++) {
    bt.step();
    if (m.stunT > 0) stunned = true;
    if ((m.chargeAt || 0) !== prevAt) { charges++; if (charges === 2) assert.ok(m.chargeAt - prevAt >= 10 - 1e-6, '10 s between charges'); prevAt = m.chargeAt; }
    far = Math.max(far, m.y);
  }
  assert.ok(charges >= 1 && !stunned, 'charges, never stunned');
  assert.ok(far > 10, 'runs well past its first target');
}
{ // standing still between two enemies: every attack hits both
  const m = body({ ...unit('War Mammoth'), speed: 0 }, 0, 0, -2), f = [body(dummy(1e6), 1, -1.5, 0), body(dummy(1e6), 1, 1.5, 0, 11)];
  const bt = E.createBattle([m], f, G);
  for (let k = 0; k < 60; k++) bt.step();
  assert.ok(f[0].hp < 1e6 && f[1].hp === f[0].hp, 'stomp hits both, each for the full hit');
}
console.log('unit fixes 2026-10-28: ok');
