// Headless check of the 2026-10-28 tower changes: Keep (Muster, Brute guards 400), Sniper tower (Mark Bounty, airship
// 400 shooting like a level 3 Sniper), Bastion (Fortify, Vault), and Overwatch seeing stealthed units.
// Run from the repo root: node tools/tests/towers-1028.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const demo = require('../../src/demo-units.json');
const roster = require('../../src/default-roster.json');
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: (u.skills || []).map(id => (roster.skills || []).find(s => s.id === id) || null) }));
const ui = (name) => units.findIndex(u => u.name === name);
const mk = (type, map = 'standard', seed = 77) => {
  const m = Game.createMatch(units, demo.matrix, seed, map);
  m.round = Game.TOWER_PICK_ROUND; m.towers[0].type = type; m.towers[1].type = 'keep'; m.gold = [2000, 2000];
  return m;
};
const sq = (m, side, name, col, row, round) => { const s = { id: m.nextId[side]++, unit: ui(name), col, row, level: 0, xp: 0, round, cost: units[ui(name)].cost }; m.armies[side].push(s); return s; };
const T = Game.TOWER_TYPES;

// Keep: Muster gives the extra deployment every round on its own (nothing to buy); Brute guards cost 400
let m = mk('keep');
assert.strictEqual(T.find(t => t.id === 'keep').skill2.cost, 400);
const base = Game.CONFIG.deploysPerRound;
assert.strictEqual(Game.deploysAllowed(m, 0), base + 1, 'Muster: +1 deployment');
assert.ok(!Game.deployBuyable(m, 0) && !Game.buyDeploy(m, 0), 'nothing to buy with Muster');
m.towers[1].type = 'sniper'; assert.strictEqual(Game.deploysAllowed(m, 1), base); assert.ok(Game.deployBuyable(m, 1));
const g0 = m.gold[1]; assert.ok(Game.buyDeploy(m, 1)); assert.strictEqual(m.gold[1], g0 - Game.CONFIG.extraDeployCost);

// Sniper tower: airship 400, shooting like a level 3 Sniper
assert.strictEqual(T.find(t => t.id === 'sniper').skill2.cost, 400);
m = mk('sniper');
Game.buyTowerSkill2(m, 0);
let b = Game.bodiesFor(m, 0).find(x => x.squad === -4);
const sn = units[ui('Sniper')];
assert.ok(b && Math.abs(b.u.hit - sn.hit * 3) < 1e-9 && b.u.aps === sn.aps && b.u.range === sn.range, 'airship: a level 3 Sniper\'s attack');

// Mark Bounty: 50 once, only an enemy squad from an earlier round, can't be moved, free again once the squad is sold
m = mk('sniper');
const s1 = sq(m, 0, 'Sniper', 5, 13, 1), fresh = sq(m, 1, 'Brute', 5, 3, m.round), old = sq(m, 1, 'Goblin Swarm', 6, 2, 1), old2 = sq(m, 1, 'Wisps', 7, 2, 1);
assert.ok(!Game.placeMark(m, 0, fresh.id), 'not a squad placed this round');
assert.ok(!Game.canMark(m, 1), 'the keep has no mark');
assert.ok(Game.placeMark(m, 0, old.id)); assert.strictEqual(m.gold[0], 1950);
assert.ok(!Game.placeMark(m, 0, old2.id), 'the mark can\'t be moved');
let bs = Game.bodiesFor(m, 0).filter(x => x.squad === s1.id);
assert.ok(bs.every(x => x.sniperMark === Game.MARK.hit), 'Snipers hunt the mark');
assert.ok(Game.bodiesFor(m, 1).filter(x => x.squad === old.id).every(x => x.marked), 'the marked squad');
assert.ok(!Game.bodiesFor(m, 1).some(x => x.squad === old2.id && x.marked));
assert.ok(Game.markShown(m, 0, true, 0) && !Game.markShown(m, 1, true, 0) && Game.markShown(m, 1, false, 0), 'hidden from them until the fight');
m.armies[1] = m.armies[1].filter(x => x.id !== old.id); // sold
assert.ok(Game.markLost(m, 0) && Game.markCost(m, 0) === 0 && Game.placeMark(m, 0, old2.id) && m.gold[0] === 1950, 'again for free');

// the engine: +15% from Snipers on the mark, Snipers see a stealthed mark, and the bounty for the last body
const plain = (u) => Engine.withTraits({ ...u, skills: undefined, skillDefs: undefined });
const g = { ...Game.SETTINGS };
const shoot = (marked) => {
  const [a] = Engine.buildSquad(plain(sn), 0, 0, -20, 1, 6, 0); a.sniperMark = 15;
  const [v] = Engine.buildSquad(plain({ ...units[ui('Brute')], hp: 1e6, defense: 'none', defVal: 0 }), 1, 0, 0, 2, 6, 1); v.marked = marked;
  const sim = Engine.createBattle([a], [v], g); for (let k = 0; k < 400 && sim.step(); k++) {}
  return 1e6 - v.hp;
};
const hitPlain = shoot(false), hitMarked = shoot(true);
assert.ok(hitPlain > 0 && Math.abs(hitMarked / hitPlain - 1.15) < 0.02, `+15%: ${hitPlain} -> ${hitMarked}`);
const stealthy = (marked, trueSight) => {
  const [a] = Engine.buildSquad(plain({ ...sn, trueSight }), 0, 0, -20, 1, 6, 0); if (marked) a.sniperMark = 15;
  const [v] = Engine.buildSquad(plain({ ...units[ui('Goblin Swarm')], bodies: 1, hp: 5, stealth: true, speed: 0 }), 1, 0, 0, 2, 6, 1); v.marked = marked;
  const sim = Engine.createBattle([a], [v], g); for (let k = 0; k < 600 && sim.step(); k++) {}
  return { dead: !v.alive, res: sim.result() };
};
assert.ok(!stealthy(false, false).dead, 'a Sniper can\'t see a stealthed unit');
const mk1 = stealthy(true, false);
assert.ok(mk1.dead && mk1.res.markKill[0] && !mk1.res.markKill[1], 'it sees the mark and finishes it: bounty');
assert.ok(stealthy(false, true).dead, 'Overwatch sees stealthed units in its range');
assert.ok(Engine.describeSkill({ type: 'overwatch', params: { hp: 200 } }).includes('stealthed'));
// the bounty is paid out by resolve
m = mk('sniper'); sq(m, 1, 'Brute', 5, 3, 1); const sim2 = Game.startBattle(m); while (sim2.step()) {}
const r2 = sim2.result(); r2.markKill = [true, false]; const gb = m.gold.slice();
const sum2 = Game.resolve(m, r2);
assert.deepStrictEqual(sum2.markBounty, [Game.MARK.bounty, 0]);

// Bastion: Fortify, 50 a round, one wall for this fight, gone next round, taken back for a refund
m = mk('bastion');
const t = m.towers[0];
assert.ok(Game.canFortify(m, 0) && !Game.canFortify(m, 1));
assert.ok(Game.fortify(m, 0, t.col, t.row - 1, 'n') && m.gold[0] === 1950);
assert.ok(!Game.canFortify(m, 0), 'once a round');
assert.ok(Game.bodiesFor(m, 0).some(x => x.u.kind === 'wall'), 'the wall stands in this fight');
assert.strictEqual(Game.bwallsLeft(m, 0), 0, 'no Defensive walls without the skill');
assert.ok(Game.unplaceBwall(m, 0, t.col, t.row - 1, 'n') && m.gold[0] === 2000, 'taken back');
Game.fortify(m, 0, t.col, t.row - 1, 'n');
const sim3 = Game.startBattle(m); while (sim3.step()) {} Game.resolve(m, sim3.result());
assert.ok(!m.over && !Game.bwallsOf(m, 0).length && !Game.bodiesFor(m, 0).some(x => x.u.kind === 'wall'), 'gone next round');
// Vault: the treasury's armor, and half the raid
m = mk('bastion', 'testgrid');
const tb = Game.bodiesFor(m, 0).find(x => x.squad === Game.TREASURY_SQ), tk = Game.bodiesFor(m, 1).find(x => x.squad === Game.TREASURY_SQ);
assert.ok(tb.u.defense === 'armor' && tb.u.defVal === Game.VAULT.armor && !(tk.u.defVal > 0));
assert.ok(Game.vaultOn(m, 0) && !Game.vaultOn(m, 1));
assert.strictEqual(Game.treasurySteal(800, true), 100); assert.strictEqual(Game.treasurySteal(800), 200);
console.log('towers 2026-10-28 ok');
