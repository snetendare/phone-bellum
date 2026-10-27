// Headless check that the host (side 0) and the guest (side 1) have equal chances: a fight between mirrored armies
// (side 1's the reflection of side 0's) comes out as an exact mirror, and two identical units that hit each other at the
// same moment trade evenly. The engine lets the sides take turns going first each tick, moves both from where everyone
// stood when the tick began, and lets heals, Glut, range cuts, knockback, stealth reveals and a fallen tower's penalty
// take hold once the tick's attacks have all landed (see `first` and healsLand in src/engine.js).
// Run from the repo root: node tools/tests/fairness.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');
const skill = (id) => roster.skills.find(x => x.id === id);
const G = { ...Game.SETTINGS, bounds: { x0: -36, x1: 36, y0: -48, y1: 48 }, aware2: true };
const base = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
const mirrorFight = (u, xo, yo, n) => {
  const A = [], B = [];
  for (let k = 0; k < n; k++) {
    A.push(...E.buildSquad(u, 0, xo + k * 6, -yo, k, 6, A.length));
    B.push(...E.buildSquad(u, 1, xo + k * 6, yo, k, 6, B.length));
  }
  const bt = E.createBattle(A, B, G);
  while (bt.step()) {}
  return bt.result();
};
const isMirror = (r) => r.winner === -1 && Math.abs(r.frac[0] - r.frac[1]) < 1e-9;
const SPOTS = [[0, 9], [3, 15], [-12, 21], [9, 27]];

// a squad's bodies stand mirrored: side 1's front row is side 0's front row
{
  const u = base('Goblin Swarm'), a = E.buildSquad(u, 0, 0, -20, 1, 6), b = E.buildSquad(u, 1, 0, 20, 1, 6);
  a.forEach((x, i) => assert.ok(Math.abs(x.x - b[i].x) < 1e-9 && Math.abs(x.y + b[i].y) < 1e-9 && x.cd === b[i].cd, 'body ' + i + ' mirrored, same reload'));
}

// every unit as it comes, mirrored: an exact mirror (a draw with the same health left on both sides)
{
  let n = 0;
  for (const u0 of roster.units) for (const [x, y] of SPOTS) for (const k of [1, 2]) {
    const r = mirrorFight(base(u0.name), x, y, k);
    assert.ok(isMirror(r), `${u0.name} x${k} at ${x},${y}: a mirror (winner ${r.winner}, ${r.frac.map(f => f.toFixed(3))}, ${r.time.toFixed(2)} s)`);
    n++;
  }
  console.log(`ok  ${n} mirrored duels of every unit: all exact mirrors`);
}

// with skills: exact mirrors too (each side draws its dodges and random heals from its own stream), except for a few
// skills that still act on the other side in turn (roots dragging, Berserkers' charges, a Leafblade dodging away, a
// healer's pick among wounded allies); those come out either way, not leaning to one side
{
  const inTurn = /windWalk|healer|graspingRoots|berserkers/;
  let n = 0, odd = 0, host = 0, guest = 0;
  for (const b of roster.units) {
    const ids = (b.skills || []).filter(Boolean);
    const variants = ids.map(i => [i]);
    if (ids.length >= 3) variants.push([ids[0], ids[1]], [ids[0], ids[2]]);
    if (ids.length >= 4) variants.push([ids[0], ids[1], ids[3]], [ids[0], ids[2], ids[3]]);
    for (const v of variants) {
      const u = E.applySkills(base(b.name), v.map(skill).filter(Boolean), roster.units);
      for (const [x, y] of SPOTS.slice(0, 3)) {
        const r = mirrorFight(u, x, y, 1);
        n++;
        if (isMirror(r)) continue;
        assert.ok(inTurn.test(v.join()), `${b.name} [${v}] at ${x},${y}: a mirror (winner ${r.winner}, ${r.frac.map(f => f.toFixed(3))})`);
        odd++; if (r.winner === 0) host++; else if (r.winner === 1) guest++;
      }
    }
  }
  assert.ok(Math.abs(host - guest) <= Math.max(4, (host + guest) * 0.3), `those don't lean to one side (host ${host}, guest ${guest})`);
  console.log(`ok  ${n} mirrored duels with skills: ${n - odd} exact mirrors; the ${odd} others: host ${host}, guest ${guest}`);
}

// two identical units hitting each other at the same moment trade evenly
{
  const duel = (name, d, extra = {}) => {
    const u = { ...base(name), ...extra };
    const a = E.buildSquad(u, 0, 0, -d / 2, 1, 6)[0], b = E.buildSquad(u, 1, 0, d / 2, 1, 6)[0];
    const bt = E.createBattle([a], [b], G);
    while (bt.step()) {}
    return [a, b, bt.result()];
  };
  let [a, b, r] = duel('Sniper', 20); // one shot kills: both set up and fire on the same tick
  assert.ok(!a.alive && !b.alive && r.winner === -1 && a.diedTick === b.diedTick, 'Sniper vs Sniper: both fall, on the same tick');
  [a, b, r] = duel('Sniper', 28.9); // just in range at the start
  assert.ok(!a.alive && !b.alive && r.winner === -1, 'Sniper vs Sniper at the edge of range: both fall');
  [a, b, r] = duel('Just a horse', 30); // rams: each reaches the other on the same tick
  assert.ok(!a.alive && !b.alive && Math.abs(a.hp - b.hp) < 1e-9 && r.winner === -1, 'two rams meeting: both fall');
  [a, b, r] = duel('Skeleton Archers', 30, { bodies: 1, hp: 20 }); // arrows in flight land on the same tick
  assert.ok(!a.alive && !b.alive && r.winner === -1, 'two archers: both arrows land');
  [a, b, r] = duel('Obelisk', 10); // lifesteal and Glut wait for the tick's attacks
  assert.ok(isMirror(r), 'two Obelisks: a mirror (lifesteal and eating land after the tick\'s attacks)');
  console.log('ok  simultaneous hits trade evenly: Snipers, rams, arrows, Obelisks');
}

// whole game fights on the standard map: random armies from every unit, side 1's the mirror of side 0's
{
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const pick = units.map((u, i) => i).filter(i => !units[i].building && !units[i].idle);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const N = 150;
  let host = 0, guest = 0, exact = 0;
  for (let n = 0; n < N; n++) {
    const m = Game.createMatch(units, null, 1000 + n, 'standard');
    m.round = 1 + Math.floor(rnd() * 2); // (from round 3 the towers differ: each side's pick)
    m.packages = [[], []]; m.pack = [null, null]; m.chars = [null, null];
    const army = [], used = new Set(), k = 2 + Math.floor(rnd() * 5);
    for (let j = 0; j < k; j++) {
      let col, row;
      do { col = Math.floor(rnd() * Game.COLS); row = Game.ROWS - 1 - Math.floor(rnd() * 6); } while (used.has(col + ',' + row) || (col === 8 && row === Game.ROWS - 2));
      used.add(col + ',' + row);
      army.push({ id: j + 1, unit: pick[Math.floor(rnd() * pick.length)], col, row, round: 1, xp: 0, level: Math.floor(rnd() * 2), cost: 1 });
    }
    m.armies = [army, army.map(s => ({ ...s, row: Game.ROWS - 1 - s.row }))];
    const bt = Game.startBattle(m);
    while (bt.step()) {}
    const r = bt.result();
    if (isMirror(r)) exact++; else if (r.winner === 0) host++; else if (r.winner === 1) guest++;
  }
  assert.ok(exact >= N * 0.95, `mirrored game fights: ${exact} of ${N} exact mirrors`);
  assert.ok(Math.abs(host - guest) <= 5, `the rest don't lean to one side (host ${host}, guest ${guest})`);
  console.log(`ok  ${N} mirrored game fights: ${exact} exact mirrors, host ${host}, guest ${guest}`);
}
console.log('fairness ok');
