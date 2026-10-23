// Headless checks of the Mechites' Mecha Tower: its drone (circles the tower, does the shooting, falls with it), the
// minebots and their mines, the repairbots, buying the bots every round, and the tower driving under Core Awoken.
// Run from the repo root (after node tools/counter-table.js): node tools/tests/mecha-tower.js
const assert = require('assert');
const E = require('../../src/engine.js'), Game = require('../../src/game.js');
const F = require('../../src/faction-units.json');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
Game.setFactions(F.factions); Game.setBuildings(F.buildings);
const units = F.units.map(u => ({ ...E.withTraits(u), skillDefs: E.SLOTS.map(k => (u.skills && F.skills.find(s => s.id === u.skills[k])) || null) }));
const UI = (n) => units.findIndex(u => u.name === n);
const altar = UI('Altar of Build'), guards = UI('Mechite Guards'), rollers = UI('Rollers');
const MT = F.factions.find(f => f.id === 'mechites').tower;
const zone = (sd, k) => Game.zoneRows(sd)[k];
const dt = Game.SETTINGS.dt;
function match(seed = 5) {
  const m = Game.createMatch(units, F.matrix, seed, null, null, [], { factions: [['mechites'], ['mechites']] });
  m.packages = [[], []]; m.pack = [null, null];
  for (const sd of [0, 1]) { m.gold[sd] = 9000; m.chars[sd] = null; m.extraDeploys[sd] = 5; units.forEach((u, i) => { m.unlocks[sd][i] = 1; }); }
  m.round = Game.TOWER_PICK_ROUND;
  for (const sd of [0, 1]) { Game.ensureTower(m, sd); m.towers[sd].type = 'f-mechites'; }
  return m;
}
const tower = (bt, sd) => bt.bodies.find(b => b.side === sd && b.u.structure);
const run = (bt, secs) => { for (let k = 0; k < secs / dt && bt.step(); k++); };

// ---------- the tower and its drone ----------
{
  const m = match();
  assert.strictEqual(Game.towerType(m, 0).name, 'Mecha Tower');
  Game.place(m, 1, guards, 6, zone(1, 0)); Game.place(m, 0, guards, 3, zone(0, 2));
  const bt = Game.startBattle(m);
  const t0 = tower(bt, 0), d = bt.bodies.find(b => b.side === 0 && b.u.kind === 'drone');
  assert.ok(t0.u.idle && t0.u.hp === MT.unit.hp, 'the tower itself never shoots');
  assert.ok(d && d.orbit && d.orbit.anchor === t0 && d.u.aloft, 'a drone that circles it, out of reach');
  near(d.u.hit, 30, 1e-9, 'a Keep\'s hit'); assert.ok(d.u.aps > 1.2, 'at a higher rate than a Keep');
  const p0 = { x: d.x, y: d.y };
  for (let k = 0; k < 40; k++) { bt.step(); near(Math.hypot(d.x - t0.x, d.y - t0.y), MT.unit.drone.orbit, 1e-6, 'stays on its circle'); }
  assert.ok(Math.hypot(d.x - p0.x, d.y - p0.y) > 1, 'and goes round');
  // it shoots what comes near; it falls with the tower
  const foe = bt.bodies.find(b => b.side === 1 && !b.u.structure && !b.u.aloft);
  foe.x = t0.x; foe.y = t0.y + 6;
  const hp = foe.hp; run(bt, 1.5);
  assert.ok(foe.hp < hp && d.dealt > 0, 'the drone hits an enemy that comes close');
  t0.hp = 0; t0.alive = false; bt.step();
  assert.ok(!d.alive, 'no drone without its tower');
}
// ---------- buying the bots: every round, hidden till the fight ----------
{
  const m = match();
  const g0 = m.gold[0];
  assert.ok(Game.canBuyTround(m, 0, 'minebots'));
  assert.ok(Game.buyTround(m, 0, 'minebots') && m.gold[0] === g0 - 100);
  assert.ok(!Game.buyTround(m, 0, 'minebots'), 'once a round');
  assert.ok(Game.buyTround(m, 0, 'repairbots') && m.gold[0] === g0 - 150, 'both in one round');
  assert.ok(Game.undoTround(m, 0, 'repairbots') && m.gold[0] === g0 - 100, 'undo pays back');
  m.round++;
  assert.ok(!Game.troundOn(m, 0, 'minebots') && Game.canBuyTround(m, 0, 'minebots'), 'next round: bought again');
  const k = match(); k.round = Game.TOWER_PICK_ROUND; k.towers[0].type = 'keep';
  assert.ok(!Game.canBuyTround(k, 0, 'minebots'), 'only the Mecha Tower has them');
}
// ---------- minebots and mines ----------
{
  const m = match();
  Game.buyTround(m, 0, 'minebots');
  Game.place(m, 1, rollers, 5, zone(1, 0)); Game.place(m, 1, rollers, 7, zone(1, 0)); Game.place(m, 0, guards, 3, zone(0, 2));
  const bt = Game.startBattle(m);
  const bots = bt.bodies.filter(b => b.side === 0 && b.u.bot === 'mine');
  assert.strictEqual(bots.length, 2, '2 minebots');
  assert.ok(bots.every(b => b.u.hp === 100 && b.plant.spots.length === 3), '100 health, 3 mines each');
  const spots = bots.flatMap(b => b.plant.spots.slice());
  const noMans = (y) => { const r = Math.round((Game.ROWS - 1) / 2 - y / Game.TILE); return Game.inNoMans(r); };
  assert.ok(spots.every(s => noMans(s.y)), 'all in no man\'s land');
  let planted = 0, blasts = 0;
  for (let k = 0; k < 60 / dt && bt.step(); k++) { planted = Math.max(planted, bt.mines().length); }
  const res = bt.result();
  assert.ok(planted > 0, `mines were planted (${planted})`);
  console.log('mines planted', planted, 'left', bt.mines().length, 'winner', res.winner);
  // a mine only goes off for enemies: 200 damage within 7 m
  const m2 = match(); Game.place(m2, 1, guards, 6, zone(1, 0)); Game.place(m2, 0, guards, 6, zone(0, 0));
  const b2 = Game.startBattle(m2, { record: true });
  const me = b2.bodies.find(b => b.side === 0 && b.u.name === 'Mechite Guards'), them = b2.bodies.filter(b => b.side === 1 && b.u.name === 'Mechite Guards');
  b2.mines().push({ x: 0, y: 0, side: 0, owner: me, hit: 200, radius: 7 });
  me.x = 0.5; me.y = 0; b2.step();
  assert.strictEqual(b2.mines().length, 1, 'your own units walk over it');
  them[0].x = 1; them[0].y = 0; them[1].x = 5; them[1].y = 0; them[2].x = 9; them[2].y = 0;
  const hp = them.map(b => b.hp);
  b2.step();
  assert.strictEqual(b2.mines().length, 0, 'an enemy sets it off');
  assert.ok(them[0].hp < hp[0] - 150 && them[1].hp < hp[1] - 150, 'everyone within 7 m is hit');
  assert.ok(Math.abs(them[2].hp - hp[2]) < 60, 'no one farther away (bar ordinary shots)');
}
// ---------- repairbots ----------
{
  const m = match();
  Game.buyTround(m, 0, 'repairbots');
  const sq = Game.place(m, 0, altar, 4, 13); sq.built = true; sq.progress = 1;
  Game.place(m, 1, guards, 6, zone(1, 0)); Game.place(m, 0, guards, 3, zone(0, 2));
  const bt = Game.startBattle(m);
  const bots = bt.bodies.filter(b => b.side === 0 && b.u.bot === 'repair');
  assert.strictEqual(bots.length, 2, '2 repairbots');
  const al = bt.bodies.find(b => b.u.building === 'altar'), t0 = tower(bt, 0);
  al.hp = al.u.hp / 2; t0.hp = t0.u.hp - 100;
  run(bt, 3);
  assert.ok(al.hp > al.u.hp / 2 + 1 || t0.hp > t0.u.hp - 100 + 1, 'they mend what is damaged');
  // one builder's speed: a whole building's health in its build time
  const a0 = al.hp; run(bt, 1);
  const rate = al.hp - a0, one = al.u.hp / al.u.buildSecs;
  assert.ok(rate <= 2 * one + 1e-6 && rate >= 0, `about a builder each (${rate.toFixed(1)}/s, one is ${one.toFixed(1)})`);
  // a site: one second of work a second each
  const m2 = match(); Game.buyTround(m2, 0, 'repairbots');
  const s2 = Game.place(m2, 0, altar, 4, 13); Game.place(m2, 1, guards, 6, zone(1, 0)); Game.place(m2, 0, guards, 3, zone(0, 2));
  const b2 = Game.startBattle(m2), site = b2.bodies.find(b => b.u.building === 'altar');
  run(b2, 8);
  assert.ok(site.site.work > 8 * site.site.self + 2, `bots build the site (${site.site.work.toFixed(2)} s of work)`);
  assert.ok(s2);
}
// ---------- Core Awoken: the tower drives ----------
{
  const m = match();
  const sq = Game.place(m, 0, altar, 4, 13); sq.built = true; sq.progress = 1;
  assert.ok(Game.buyBuildingSkill(m, 0, 'sq' + sq.id, 'awoken'));
  Game.place(m, 1, guards, 6, zone(1, 0)); Game.place(m, 0, guards, 3, zone(0, 2));
  const bt = Game.startBattle(m);
  const t0 = tower(bt, 0), d = bt.bodies.find(b => b.side === 0 && b.u.kind === 'drone');
  assert.ok(t0.u.awake && !t0.u.idle && t0.u.speed === 5 && t0.u.lob && t0.u.backline && t0.u.stay, 'wheels and a mortar');
  const y0 = t0.y, foe = bt.bodies.find(b => b.side === 1 && b.u.name === 'Mechite Guards');
  foe.x = t0.x; foe.y = t0.y + (t0.side === 0 ? 6 : -6);
  run(bt, 1);
  assert.ok(Math.abs(t0.y - y0) > 2, 'it drives away from an enemy close by');
  near(Math.hypot(d.x - t0.x, d.y - t0.y), MT.unit.drone.orbit, 1e-6, 'its drone keeps circling it');
  // turrets keep their wheels too
  assert.ok(Game.buildingEffects(m, 0).awake.built.speed > 0, 'turrets still get wheels');
}
// ---------- the AI buys bots now and then; whole matches run ----------
{
  let bought = 0;
  for (const seed of [4, 5, 6]) {
    const m = Game.createMatch(units, F.matrix, seed, null, null, [], { factions: [['mechites'], ['mechites']] });
    for (let r = 0; r < 12 && !m.over; r++) {
      for (const sd of [0, 1]) { if (Game.needsTowerPick(m, sd)) Game.setTowerType(m, sd, 'f-mechites'); Game.aiDeploy(m, sd); }
      for (const sd of [0, 1]) bought += Object.keys((m.tround && m.tround[sd]) || {}).filter(id => m.tround[sd][id] === m.round).length;
      const bt = Game.startBattle(m); while (bt.step()); Game.resolve(m, bt.result());
    }
    console.log(`seed ${seed} round ${m.round} hp ${m.hp.join('/')}`);
  }
  assert.ok(bought > 0, `the AI bought bots (${bought})`);
}
console.log('mecha tower ok');
