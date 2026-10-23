// Headless check of the Factions devtest (docs/FACTIONS-DEVTEST.md): shared draft, picks every round, buildings,
// spells, arrows, disguise, and AI-vs-AI matches to the end. Run from the repo root: node tools/tests/devtest.js
const assert = require('assert');
const E = require('../../src/engine.js'), Game = require('../../src/game.js');
const FD = require('../../src/faction-units.json');
Game.setFactions(FD.factions); Game.setDevData(FD);
const ids = FD.factions.map(f => f.id);
// the draft: shared, so two factions are enough for both players
const d = Game.createDraft(0, null, true);
for (let guard = 0; !Game.draftDone(d) && guard < 10; guard++) { const t = Game.draftTurn(d); assert.ok(Game.draftAct(d, t.side, Game.aiDraftChoice(d, t.side, FD, 7))); }
assert.ok(Game.draftDone(d)); assert.deepStrictEqual(d.picks.map(p => p.slice().sort()), [ids.slice().sort(), ids.slice().sort()]);
// the devtest roster: every faction's units and the neutral ones
const units = FD.units.map(u => E.withTraits(u));
const mk = (seed) => Game.createMatch(units, FD.matrix, seed, null, null, [], { factions: d.picks, dev: true });
const m = mk(3);
assert.strictEqual(m.map.id, 'testgrid'); assert.strictEqual(Game.COLS, 14);
const neutral = units.map((u, i) => u.faction === 'neutral' ? i : -1).filter(i => i >= 0);
for (const ui of neutral) assert.ok(Game.isOff(m, ui, 0), 'neutral units start closed');
// round 1: no pick, no tower in the fight
assert.strictEqual(Game.devOffer(m, 0), null);
Game.choosePack(m, 0, 0); Game.choosePack(m, 1, 0);
let bodies = Game.bodiesFor(m, 0);
assert.ok(!bodies.some(b => b.squad === -2), 'no tower in round 1');
// round 2: a building pick
m.round = 2;
const o = Game.devOffer(m, 0);
assert.strictEqual(o.cat, 'building'); assert.strictEqual(o.ids.length, 3);
assert.deepStrictEqual(Game.devOffer(m, 0), o, 'same offer every time');
assert.ok(Game.devPick(m, 0, o.ids[0]));
assert.deepStrictEqual(Game.devOffer(m, 0), o, 'offer stays after picking');
assert.ok(!Game.needsDevPick(m, 0));
const b = Game.unplacedLesser(m, 0); assert.ok(b);
const row = Game.zoneRows(0)[4];
assert.ok(!Game.placeLesser(m, 0, b.key, 3, Game.zoneRows(1)[0]), 'not in the enemy zone');
assert.ok(Game.placeLesser(m, 0, b.key, 3, row));
assert.ok(Game.occupied(m, 0, 3, row), 'a building takes its tile');
assert.ok(Game.undoDevPick(m, 0) && !Game.lessersOf(m, 0).length, 'pick taken back');
assert.ok(Game.devPick(m, 0, 'boiler-works') || Game.devPick(m, 0, o.ids[0]));
// an aura building next to a squad
m.dev.buildings[0] = [{ key: 99, id: 'boiler-works', col: 5, row, round: 2 }];
m.armies[0] = [{ id: 50, unit: units.findIndex(u => u.name === 'Scrap Hounds'), col: 6, row, round: 2, xp: 0, level: 0, cost: 100 }];
bodies = Game.bodiesFor(m, 0);
const hound = bodies.find(x => x.squad === 50), base = Game.unitFor(m, 0, m.armies[0][0].unit);
assert.ok(Math.abs(hound.u.hp - base.hp * 1.15) < 1e-6 && hound.u.bonusArmor === (base.bonusArmor || 0) + 2, 'aura applied');
assert.ok(bodies.some(x => x.squad === Game.LESSER_SQ - 99 && x.u.lesser), 'building in the fight');
// an arrow
assert.ok(Game.setGuide(m, 0, 50, [{ col: 6, row: 9 }, { col: 1, row: 8 }]));
bodies = Game.bodiesFor(m, 0);
assert.strictEqual(bodies.find(x => x.squad === 50).guide.length, 2);
// disguise: the Lure Angler looks like Drowned Swarm to the other player only
const la = units.findIndex(u => u.name === 'Lure Angler'), ds = units.findIndex(u => u.name === 'Drowned Swarm');
assert.strictEqual(Game.shownUnit(m, 1, 0, la), ds); assert.strictEqual(Game.shownUnit(m, 0, 0, la), la);
// a Power with a spell, and the spell
m.round = 4;
m.dev.picks[1].push({ round: 4, cat: 'power', id: 'fire-pots' });
assert.deepStrictEqual(Game.spellsOf(m, 1), ['fire-pot']);
m.gold[1] = 200;
assert.ok(Game.castSpell(m, 1, 'fire-pot', 6, 7)); assert.strictEqual(m.gold[1], 125);
assert.ok(!Game.castSpell(m, 1, 'fire-pot', 6, 7), 'once a round');
const fx = Game.castEffects(m); assert.strictEqual(fx.strikes.length, 1);
// the engine: a strike hurts, a guided body walks its arrow
{
  const g = { ...Game.SETTINGS, bounds: null };
  const dummy = E.withTraits({ name: 'D', cost: 1, bodies: 1, hp: 500, hit: 1, aps: 1, range: 1, speed: 0, splash: 0 });
  const A = E.buildSquad(dummy, 0, 0, 0, 1, 6), B = E.buildSquad(dummy, 1, 30, 30, 2, 6);
  const sim = E.createBattle(A, B, g, { strikes: [{ t: 0.5, x: 0, y: 0, r: 3, dmg: 100, side: 1 }] });
  for (let k = 0; k < 20; k++) sim.step();
  assert.ok(A[0].hp < 500 && B[0].hp === 500, 'strike hit');
  const walker = E.withTraits({ ...dummy, speed: 5 });
  const W = E.buildSquad(walker, 0, 0, 0, 1, 6); W[0].guide = [{ x: -20, y: 0 }];
  const Z = E.buildSquad(dummy, 1, 0, 60, 2, 6);
  const s2 = E.createBattle(W, Z, g, {});
  for (let k = 0; k < 40; k++) s2.step();
  assert.ok(W[0].x < -5 && Math.abs(W[0].y) < 1, 'walks the arrow first');
}
// AI vs AI to the end, a few seeds
for (let seed = 1; seed <= 6; seed++) {
  const mm = mk(seed);
  let rounds = 0;
  while (!mm.over && rounds++ < 25) {
    Game.aiDeploy(mm, 0); Game.aiDeploy(mm, 1);
    Game.aiLevel(mm, 0); Game.aiLevel(mm, 1);
    if (mm.round >= 2 && mm.round !== 3) for (const sd of [0, 1]) assert.ok(!Game.needsDevPick(mm, sd) || !Game.devOffer(mm, sd), 'AI picked');
    const sim = Game.startBattle(mm);
    if (mm.round < 3) assert.ok(!sim.bodies.some(x => x.squad === -2), 'no tower before round 3');
    else assert.ok(sim.bodies.some(x => x.squad === -2), 'tower from round 3');
    while (sim.step()) {}
    Game.resolve(mm, sim.result());
  }
  const sum = (sd) => mm.dev.picks[sd].map(p => p.cat[0] + ':' + p.id).join(' ');
  console.log('seed', seed, 'rounds', mm.round, 'hp', mm.hp.join('/'), '| p0', sum(0), '| casts', mm.dev.casts.length);
  assert.ok(mm.over, 'match ends');
}
console.log('devtest ok');
