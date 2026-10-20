// Headless checks of the Mechites' Factory: placing it, building it in fights, making units, losing it, leveling it.
// Run from the repo root (after node tools/counter-table.js): node tools/tests/factory.js
const assert = require('assert');
const E = require('../../src/engine.js'), Game = require('../../src/game.js');
const F = require('../../src/faction-units.json');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
Game.setFactions(F.factions); Game.setBuildings(F.buildings);
const units = F.units.map(u => ({ ...E.withTraits(u), skillDefs: E.SLOTS.map(k => (u.skills && F.skills.find(s => s.id === u.skills[k])) || null) }));
const UI = (n) => units.findIndex(u => u.name === n);
const cb = UI('Cog Builder'), guards = UI('Mechite Guards');
const fac = F.buildings.find(b => b.id === 'factory');
function match(seed = 3) {
  const m = Game.createMatch(units, F.matrix, seed, null, null, [], { factions: [['mechites'], ['mechites']] });
  for (const sd of [0, 1]) { m.gold[sd] = 5000; m.pack[sd] = 0; m.chars[sd] = null; units.forEach((u, i) => { m.unlocks[sd][i] = 1; }); }
  return m;
}
const fight = (m) => { const bt = Game.startBattle(m); while (bt.step()); return { bt, sum: Game.resolve(m, bt.result()) }; };
const zone = (sd, k) => Game.zoneRows(sd)[k];

// ---------- a site gets built in a fight it survives ----------
{
  const m = match();
  Game.place(m, 0, cb, 5, zone(0, 1));
  assert.ok(Game.buyBuilding(m, 0, cb, 0, 6, zone(0, 4)), 'factory placed');
  Game.place(m, 1, guards, 6, zone(1, 0)); // something to fight
  const bt = Game.startBattle(m);
  const site = bt.bodies.find(b => b.u.building === 'factory'), builder = bt.bodies.find(b => b.u.name === 'Cog Builder');
  assert.ok(site && site.site && site.u.hp === fac.hp && site.u.noCount, 'a site with its full health');
  assert.strictEqual(builder.siteJob, site, 'the nearest builder takes the job');
  let at = false; for (let k = 0; k < 200 && bt.step(); k++) at = at || builder.siteAt;
  assert.ok(at && site.site.work > 0, 'it walks over and builds');
  assert.ok(!builder.built, 'no turret while it builds');
  while (bt.step());
  const sum = Game.resolve(m, bt.result());
  const b = Game.buildingOf(m, 0, 'factory');
  assert.ok(site.alive && b.built && b.progress === 1, 'built once the site survived the fight');
  assert.deepStrictEqual(sum.buildings[0], [{ id: 'factory', built: true }]);
}
// ---------- a site destroyed keeps its progress; a quick site is done mid-fight and the builder moves on ----------
{
  const m = match();
  Game.place(m, 0, cb, 5, zone(0, 1));
  Game.buyBuilding(m, 0, cb, 0, 6, zone(0, 4));
  Game.place(m, 1, guards, 6, zone(1, 0));
  const bt = Game.startBattle(m);
  const site = bt.bodies.find(b => b.u.building);
  for (let k = 0; k < 200 && bt.step(); k++);
  const work = site.site.work; site.hp = 0; site.alive = false; // knocked down
  while (bt.step());
  Game.resolve(m, bt.result());
  const b = Game.buildingOf(m, 0, 'factory');
  assert.ok(!b.built && Math.abs(b.progress - work / fac.buildSecs) < 1e-9 && b.progress > 0, 'progress kept: ' + b.progress);
  // next fight starts from there; with almost all the work done it finishes mid-fight and the builder goes on to its turret
  b.progress = 0.97;
  const bt2 = Game.startBattle(m), s2 = bt2.bodies.find(x => x.u.building), bl2 = bt2.bodies.find(x => x.u.name === 'Cog Builder');
  near(s2.site.work, 0.97 * fac.buildSecs, 1e-9, 'resumes');
  let doneT = null;
  for (let k = 0; k < 600 && bt2.step(); k++) { if (doneT == null && s2.site.work >= s2.site.need) doneT = bt2.time(); if (bl2.built) break; }
  assert.ok(doneT != null && bl2.built, 'built mid-fight, then the builder builds its turret');
}
// ---------- a built factory makes this round's unit; Master engineering and levels make it stronger ----------
{
  const m = match();
  Game.place(m, 0, cb, 5, zone(0, 1));
  Game.buyBuilding(m, 0, cb, 0, 6, zone(0, 4));
  const b = Game.buildingOf(m, 0, 'factory');
  assert.ok(!Game.canBuyBuildingSkill(m, 0, 'factory', 'fighter'), 'not before it is built');
  b.built = true; b.progress = 1;
  const g0 = m.gold[0];
  assert.ok(Game.buyBuildingSkill(m, 0, 'factory', 'fighter') && m.gold[0] === g0 - 100);
  assert.ok(Game.buyBuildingSkill(m, 0, 'factory', 'cogmech') && m.gold[0] === g0 - 300, 'swapping pays the first back');
  assert.ok(Game.undoBuildingSkill(m, 0, 'factory') && m.gold[0] === g0, 'undo');
  Game.buyBuildingSkill(m, 0, 'factory', 'fighter');
  Game.place(m, 1, guards, 6, zone(1, 0));
  const bt = Game.startBattle(m);
  for (let k = 0; k < 2 / Game.SETTINGS.dt + 2; k++) bt.step();
  const cf = bt.bodies.find(x => x.u.name === 'Cogbot Fighter');
  assert.ok(cf && cf.side === 0 && cf.credit && cf.credit.u.building, 'a Cogbot Fighter after 2 s, credited to the factory');
  assert.strictEqual(cf.u.hp, 1500); assert.strictEqual(cf.shield, 2); assert.strictEqual(cf.u.defVal, 4);
  assert.ok(!cf.u.noCount, 'it fights like a unit');
  assert.strictEqual(bt.bodies.filter(x => x.u.name === 'Cogbot Fighter').length, 1, 'one a fight');
  while (bt.step());
  Game.resolve(m, bt.result());
  assert.ok(b.xp > 0, 'XP from what it made');
  assert.strictEqual(Game.bskillOf(m, 0, 'factory'), null, 'the skill was for that round only');
  // a leveled factory with Master engineering: a level 2 CogMech, faster, with the construct upgrades
  b.xp = Game.buildingXpNeeded('factory', 0); assert.ok(Game.levelBuilding(m, 0, 'factory') && b.level === 1);
  assert.ok(Game.undoLevelBuilding(m, 0, 'factory') && b.level === 0 && Game.levelBuilding(m, 0, 'factory'));
  m.tech[0][cb] = [1, 1, 1];
  Game.buyBuildingSkill(m, 0, 'factory', 'cogmech');
  const [body] = Game.buildingBodies(m, 0, 0);
  near(body.produce.time, 2, 1e-9, 'half the build time');
  const cm = body.produce.unit;
  assert.strictEqual(cm.hp, 4000); assert.strictEqual(cm.level, 1); near(cm.aps, 1.2, 1e-9, '+20% fire rate');
  assert.strictEqual(cm.shield, 5); assert.strictEqual(cm.bonusArmor, 2); assert.strictEqual(cm.turrets, 2);
  near(body.u.hp, 2000, 1e-9, 'a leveled factory is tougher');
}
// ---------- a built factory knocked down starts the next round at 50% ----------
{
  const m = match();
  Game.place(m, 0, cb, 5, zone(0, 1));
  Game.buyBuilding(m, 0, cb, 0, 6, zone(0, 4));
  const b = Game.buildingOf(m, 0, 'factory'); b.built = true; b.progress = 1;
  Game.place(m, 1, guards, 6, zone(1, 0));
  const bt = Game.startBattle(m);
  const fb = bt.bodies.find(x => x.u.building);
  assert.ok(!fb.site, 'a built factory is no site');
  for (let k = 0; k < 20; k++) bt.step();
  fb.hp = 0; fb.alive = false;
  while (bt.step());
  const sum = Game.resolve(m, bt.result());
  assert.ok(!b.built && b.progress === 0.5, 'back to 50%');
  assert.deepStrictEqual(sum.buildings[0], [{ id: 'factory', lost: true }]);
}
// ---------- the Machinegunner winds up from 0.3 to 3 attacks a second ----------
{
  const gu = E.withTraits(fac.skills.find(s => s.id === 'gunner').unit);
  const target = E.withTraits({ name: 'Wall', cost: 1, bodies: 1, hp: 1e7, hit: 0, aps: 0.01, range: 0.5, speed: 0, splash: 0 });
  const bt = E.createBattle(E.buildSquad(gu, 0, 0, -10, 1, 6), E.buildSquad(target, 1, 0, 10, 2, 6), { ...Game.SETTINGS });
  for (let k = 0; k < 10 / Game.SETTINGS.dt; k++) bt.step();
  near(bt.bodies[0].spin, 10, 1e-9, 'spun up to 10x (3 a second)');
}
// ---------- the AI places and uses factories; whole matches run the same twice ----------
{
  const play = (seed) => {
    const m = Game.createMatch(units, F.matrix, seed, null, null, [], { factions: [['mechites'], ['mechites']] });
    let made = 0;
    for (let r = 0; r < 10 && !m.over; r++) {
      Game.aiDeploy(m, 0); Game.aiDeploy(m, 1); Game.aiLevel(m, 0); Game.aiLevel(m, 1);
      const bt = Game.startBattle(m); while (bt.step());
      made += bt.bodies.filter(x => x.credit && x.credit.u.building).length;
      Game.resolve(m, bt.result());
    }
    return { m, made, key: JSON.stringify([m.hp, m.round, m.buildings]) };
  };
  let placed = 0, made = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const a = play(seed), b = play(seed);
    assert.strictEqual(a.key, b.key, 'deterministic');
    placed += a.m.buildings[0].length + a.m.buildings[1].length; made += a.made;
    console.log('seed', seed, 'round', a.m.round, 'hp', a.m.hp.join('/'), 'factories', a.m.buildings.map(x => x.map(b => (b.built ? 'built' : Math.round(b.progress * 100) + '%') + ' L' + (b.level + 1)).join(',') || '-').join(' / '), 'units made', a.made);
  }
  assert.ok(placed > 0 && made > 0, 'the AI builds factories and uses them');
}
console.log('factory ok');
