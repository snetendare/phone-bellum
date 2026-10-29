// Headless check that fast units don't circle their target just out of reach: an Assassin dashing at Ember Imps or a
// Shiv used to orbit one of them about 3.5 m out for the rest of the fight (its smooth turn lagged behind at dash
// speed). A body that for 3 s walks within its reach + 4 m of an enemy, sweeping over 2 radians round it without
// attacking, counts as circling. Run from the repo root: node tools/tests/no-circling.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');
const G = { ...Game.SETTINGS, distance: 42, bounds: { x0: -36, x1: 36, y0: -48, y1: 48 }, aware2: true };
const unit = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };

function circling(an, bn, off) {
  const A = E.buildSquad(unit(an), 0, 0, -21, 0, 6, 0), B = E.buildSquad(unit(bn), 1, off, 21, 10, 6, A.length);
  const bt = E.createBattle(A, B, G), st = new Map(), was = new Map();
  while (bt.step()) {
    for (const b of bt.bodies) {
      const p = was.get(b) || [b.x, b.y], moved = Math.hypot(b.x - p[0], b.y - p[1]);
      was.set(b, [b.x, b.y]);
      if (!b.alive || b.u.structure) { st.delete(b); continue; }
      let f = null, nd = Infinity;
      for (const o of bt.bodies) if (o.alive && o.side !== b.side && !o.u.structure) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < nd) { nd = d; f = o; } }
      if (!(f && nd < Math.max(b.u.range, 2) + 4 && moved > 1e-4 && bt.time() - (b.lastAtk ?? -1e9) > 0.3)) { st.delete(b); continue; }
      const ang = Math.atan2(b.y - f.y, b.x - f.x), s = st.get(b);
      if (!s || s.f !== f) { st.set(b, { f, t: 0, ang, swept: 0 }); continue; }
      let da = ang - s.ang;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      s.swept += da; s.ang = ang; s.t += G.dt;
      if (s.t >= 3 && Math.abs(s.swept) > 2) return `${b.u.name} circled ${f.u.name} at ${nd.toFixed(2)} m (${bt.time().toFixed(1)} s)`;
    }
  }
  return null;
}

for (const [a, b] of [['Assassin', 'Ember Imps'], ['Assassin', 'Shiv'], ['Assassin', 'Slimeshots'], ['Goblin Swarm', 'Truespear'], ['Spiders', 'Frost Wizard']])
  for (const off of [0, 6]) { const c = circling(a, b, off); assert.ok(!c, `${a} vs ${b} (offset ${off}): ${c}`); }
console.log('no circling: ok');
