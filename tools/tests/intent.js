// Headless check of intent and the one-Awaken-type rule. Run from the repo root: node tools/tests/intent.js
// - The engine keeps whom a body walks to (b.intent) apart from whom it attacks (b.lock).
// - Game.intentPreview plays the real engine from what the player can see: with nothing hidden it picks exactly what the
//   real fight's bodies first walk to; squads the opponent placed this round never show up in it; it gives two
//   arrows at most; a Goblin Swarm with Tacticalness (spread) runs out to its spots first and still gets its picks.
// - Awareness is on in every gamemode.
// - A player awakens one unit type a match.
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
const roster = require('../../src/default-roster.json');
const skill = (id) => roster.skills.find(x => x.id === id);
// with their skills (the page attaches them the same way when it loads a roster)
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
const ix = (n) => { const i = units.findIndex(u => u.name === n); assert.ok(i >= 0, n); return i; };
const clone = (m) => ({ ...JSON.parse(JSON.stringify({ ...m, units: null, matrix: null })), units: m.units, matrix: m.matrix });

// the engine: intent (whom it walks to) and lock (whom it attacks) are two things
{
  const G = { dt: 0.05, timeCap: 60, spacing: 3.5, minDmgPct: 15, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 };
  const archer = E.buildSquad(E.withTraits({ name: 'A', cost: 1, bodies: 1, hp: 5000, hit: 1, aps: 1, range: 20, speed: 2, splash: 0 }), 0, 0, 0, 1, 6)[0];
  const near = E.buildSquad(E.withTraits({ name: 'N', cost: 1, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true }), 1, 0, 15, 2, 6)[0];
  const bt = E.createBattle([archer], [near], G);
  for (let k = 0; k < 10; k++) bt.step();
  assert.strictEqual(archer.lock, near, 'it attacks the enemy in reach');
  assert.strictEqual(archer.intent, near, 'standing in reach: it stays at that one');
  const far = E.buildSquad(E.withTraits({ name: 'F', cost: 1, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true }), 1, 0, 40, 3, 6)[0];
  const lone = E.buildSquad(E.withTraits({ name: 'A', cost: 1, bodies: 1, hp: 5000, hit: 1, aps: 1, range: 5, speed: 2, splash: 0 }), 0, 0, 0, 1, 6)[0];
  const bt2 = E.createBattle([lone], [far], G);
  bt2.step();
  assert.ok(!lone.intent && !lone.lock, 'nothing in sight: it marches ahead with no target');
  for (let k = 0; k < 400 && !lone.intent; k++) bt2.step();
  assert.strictEqual(lone.intent, far, 'then it walks to what it spotted');
  assert.ok(!lone.lock, '...before it can attack it');
}

// awareness is on in every gamemode
{
  const m = Game.createMatch(units, null, 3, 'standard');
  assert.ok(Game.battleSetup(m).g.aware2 === true, 'standard');
}

// the preview picks what the real fight picks, when nothing is hidden
let compared = 0, split = 0, named = 0, ways = 0;
const order = (list) => list.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
for (const seed of [3, 7, 11]) {
  const m = Game.createMatch(demo.units, demo.matrix, seed, 'standard'); // the AI needs the counter table
  for (let rd = 0; rd < 4 && !m.over; rd++) {
    Game.aiDeploy(m, 0); Game.aiDeploy(m, 1); Game.aiLevel(m, 0); Game.aiLevel(m, 1);
    const bt = Game.startBattle(m); while (bt.step()); Game.resolve(m, bt.result());
  }
  if (m.over) continue;
  Game.aiDeploy(m, 0); // only side 0 acts this round: everything of side 1 is from earlier rounds, all in sight
  const mm = clone(m), real = Game.startBattle(mm); // (startBattle settles the match: walls, packages)
  const first = new Map(), held = new Map();
  for (let k = 0; k < Math.round(Game.INTENT.secs / Game.SETTINGS.dt); k++) {
    if (!real.step()) break;
    for (const b of real.bodies) {
      if (b.side !== 0 || b.squad < 0 || first.has(b)) continue;
      if (!b.alive) { first.set(b, null); continue; }
      if (!b.intent) { held.delete(b); continue; }
      const n = (held.get(b) || 0) + 1; held.set(b, n);
      if (n > Game.INTENT.settle) first.set(b, b.intent.side + ':' + b.intent.squad);
    }
  }
  for (const sq of mm.armies[0]) {
    const pv = Game.intentPreview(mm, 0, { id: sq.id });
    if (!pv || !pv.moves) continue;
    const by = {};
    for (const [b, k] of first) if (b.squad === sq.id && k) by[k] = (by[k] || 0) + 1;
    assert.deepStrictEqual(order(pv.picks), order(Object.entries(by)), `seed ${seed} squad ${sq.id} (${demo.units[sq.unit].name})`);
    assert.ok(pv.groups.length + (pv.ahead ? 1 : 0) <= 2, 'two arrows at most');
    for (const g of pv.groups) assert.ok(pv.picks.some(([k, n]) => k === g.side + ':' + g.squad && n >= g.n), 'a named arrow is one of its picks');
    compared++; if (pv.picks.length > 1) split++; named += pv.groups.length; if (pv.ahead) ways++;
  }
}
assert.ok(compared >= 10, `compared ${compared}`);
console.log(`preview = real fight for ${compared} squads (${split} split; ${named} named arrows, ${ways} squads with a way only)`);

// what the opponent placed this round stays out of it; the preview never changes the match
{
  const m = Game.createMatch(units, null, 5, 'standard');
  m.round = 2; m.gold = [5000, 5000]; m.armies = [[], []]; m.chars = [null, null];
  for (const n of ['Brute', 'Fire Mage', 'Goblin Swarm']) { m.unlocks[0][ix(n)] = 1; m.unlocks[1][ix(n)] = 1; }
  m.extraDeploys = [Game.CONFIG.maxExtraDeploys, 0]; m.unlocks[0][ix('Sniper')] = 1;
  const mine = Game.place(m, 0, ix('Brute'), 3, 11);
  const old = Game.place(m, 1, ix('Brute'), 3, 4); old.round = 1;
  const now = Game.place(m, 1, ix('Fire Mage'), 2, 5); // closer still, placed this round: unseen
  const before = JSON.stringify(m.armies);
  const pv = Game.intentPreview(m, 0, { id: mine.id });
  assert.strictEqual(JSON.stringify(m.armies), before, 'the match is left as it was');
  assert.ok(pv.picks.length === 1 && pv.picks[0][0] === '1:' + old.id, 'only what it can see: ' + JSON.stringify(pv.picks));
  assert.ok(!Game.seenBy(m, 0).armies[1].some(s => s.id === now.id), 'seenBy leaves it out');
  // the Brute (melee, 18 m of awareness) starts 42 m from it: too far to name, only the way it walks (ahead)
  assert.ok(pv.groups.length === 0 && pv.ahead && pv.ahead.n === 1 && pv.ahead.dy > 0.9, 'far: a way, not a unit: ' + JSON.stringify(pv));
  // a Sniper (29 m of range, 44 m of awareness) 36 m from it: that one, by name
  const sn = Game.intentPreview(m, 0, { unit: ix('Sniper'), col: 3, row: 10 });
  assert.ok(sn.groups.length === 1 && sn.groups[0].squad === old.id && !sn.ahead, 'near: the unit itself: ' + JSON.stringify(sn));
  // a unit about to be placed, and a squad about to be moved
  const hyp = Game.intentPreview(m, 0, { unit: ix('Fire Mage'), col: 8, row: 11 });
  assert.ok(hyp && hyp.total === 1 && !hyp.picks.some(([k]) => k === '1:' + now.id), 'a shop pick over a tile');
  const mv = Game.intentPreview(m, 0, { id: mine.id, col: 10, row: 11 });
  assert.ok(mv && mv.total === 1 && !mv.picks.some(([k]) => k === '1:' + now.id), 'a squad about to be moved');
  // a Goblin Swarm with Tacticalness runs out to its spots first: its picks still come
  m.tech[0][ix('Goblin Swarm')] = [2, 2, 0, 0];
  const gob = Game.intentPreview(m, 0, { unit: ix('Goblin Swarm'), col: 6, row: 11 });
  assert.ok(gob.total === 15 && gob.groups.length + (gob.ahead ? 1 : 0) >= 1 && gob.groups.length + (gob.ahead ? 1 : 0) <= 2 && gob.groups.reduce((a, g) => a + g.n, 0) + (gob.ahead ? gob.ahead.n : 0) <= 15, JSON.stringify(gob));
  // the same board, the same answer
  assert.deepStrictEqual(Game.intentPreview(m, 0, { id: mine.id }), pv);
}

// one Awaken unit type a match
{
  const m = Game.createMatch(units, null, 9, 'standard');
  m.round = 2; m.gold = [9000, 9000]; m.armies = [[], []]; m.chars = [null, null];
  const lw = ix('Leaf Wizard'), imps = ix('Ember Imps');
  for (const i of [lw, imps]) m.unlocks[0][i] = 1;
  m.extraDeploys = [Game.CONFIG.maxExtraDeploys, 0];
  const a = Game.place(m, 0, lw, 2, 11), b = Game.place(m, 0, lw, 4, 11), c = Game.place(m, 0, imps, 6, 11);
  assert.ok(Game.awakenSlot(m, lw) >= 0 && Game.awakenSlot(m, imps) >= 0, 'both units have an Awaken skill');
  Game.buySkill(m, 0, lw, 2); Game.buySkill(m, 0, imps, 2);
  assert.ok(Game.canAwaken(m, 0, a.id) && Game.canAwaken(m, 0, c.id), 'either type, before any awakening');
  assert.ok(Game.awaken(m, 0, a.id));
  assert.strictEqual(Game.wokeUnit(m, 0), lw);
  assert.ok(Game.canAwaken(m, 0, b.id), 'another squad of the same type');
  assert.strictEqual(Game.awakenBlock(m, 0, c), 'type', 'not another type');
  assert.ok(!Game.awaken(m, 0, c.id));
  assert.ok(Game.undoAwaken(m, 0, a.id) && Game.wokeUnit(m, 0) == null && Game.canAwaken(m, 0, c.id), 'taken back this round: free to choose again');
  assert.ok(Game.awaken(m, 0, a.id));
  // from the fight on it holds, even once those squads are gone
  m.armies[1] = [];
  const bt = Game.startBattle(m); while (bt.step()); Game.resolve(m, bt.result());
  assert.ok(m.woke && m.woke[0] === lw, 'kept after the fight');
  m.armies[0] = m.armies[0].filter(s => s.unit !== lw);
  assert.strictEqual(Game.awakenBlock(m, 0, m.armies[0].find(s => s.id === c.id)), 'type', 'still only Leaf Wizards, with none left');
  assert.strictEqual(Game.wokeUnit(m, 1), null, 'the other player chooses their own');
}
console.log('intent ok');
