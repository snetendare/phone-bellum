// Headless checks of the Mechites' Altar of Build: placing it on a 2x2 block, building it (with a Cog Builder, or by
// itself, slowly), its three skills (Blessing of the Cycle, Cogbot Defensive Force, Core Awoken), turrets that keep away
// and shell the back line, leveling it. Run from the repo root (after node tools/counter-table.js): node tools/tests/altar.js
const assert = require('assert');
const E = require('../../src/engine.js'), Game = require('../../src/game.js');
const F = require('../../src/faction-units.json');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
Game.setFactions(F.factions); Game.setBuildings(F.buildings);
const units = F.units.map(u => ({ ...E.withTraits(u), skillDefs: E.SLOTS.map(k => (u.skills && F.skills.find(s => s.id === u.skills[k])) || null) }));
const UI = (n) => units.findIndex(u => u.name === n);
const altar = UI('Altar of Build'), cb = UI('Cog Builder'), guards = UI('Mechite Guards');
const AL = F.buildings.find(b => b.id === 'altar');
const zone = (sd, k) => Game.zoneRows(sd)[k];
function match(seed = 5) {
  const m = Game.createMatch(units, F.matrix, seed, null, null, [], { factions: [['mechites'], ['mechites']] });
  m.packages = [[], []]; m.pack = [null, null]; // no starting package squads
  for (const sd of [0, 1]) { m.gold[sd] = 9000; m.chars[sd] = null; m.extraDeploys[sd] = 5; units.forEach((u, i) => { m.unlocks[sd][i] = 1; }); }
  return m;
}
const settle = (m, bt) => { while (bt.step()); return Game.resolve(m, bt.result()); };

// ---------- a 2x2 block of your zone ----------
{
  const m = match();
  assert.ok(units[altar].noPack && units[altar].noFlank, 'never in a package, never on a flank');
  // side 0's zone: rows 10..15, front row 10. A block from row 15 would leave the board
  assert.ok(!Game.place(m, 0, altar, 4, 15), 'not past the edge of the zone');
  const sq = Game.place(m, 0, altar, 4, 13);
  assert.ok(sq, 'placed on the block 4-5, 13-14');
  for (const [c, r] of [[4, 13], [5, 13], [4, 14], [5, 14]]) assert.ok(Game.occupied(m, 0, c, r) && Game.squadAt(m, 0, c, r) === sq, `it takes tile ${c},${r}`);
  assert.ok(!Game.occupied(m, 0, 6, 13), 'and no more');
  assert.ok(!Game.place(m, 0, guards, 5, 14), 'no squad on its block');
  assert.ok(!Game.place(m, 0, altar, 5, 12), 'no altar overlapping it');
  assert.ok(!Game.canMove(m, 0, sq), 'a building never moves');
  sq.round = 0; assert.ok(!Game.canMove(m, 0, sq), 'not even with the paid Move');
  const r = Game.recordOf(m, 0, 'sq' + sq.id);
  assert.ok(r && r.id === 'altar' && r.size === 2, 'a building record');
  const w = Game.recordWorld(r), a = Game.tileToWorld(4, 13), b = Game.tileToWorld(5, 14);
  near(w.x, (a.x + b.x) / 2, 1e-9, 'it stands where the four tiles meet'); near(w.y, (a.y + b.y) / 2, 1e-9, 'y');
}
// ---------- built by its builder, or by itself at a fifth of the speed ----------
{
  const m = match();
  const sq = Game.place(m, 0, altar, 4, 13);
  Game.place(m, 0, guards, 6, zone(0, 0)); // something to fight with, that doesn't build
  Game.place(m, 1, guards, 6, zone(1, 0));
  let bt = Game.startBattle(m);
  const site = bt.bodies.find(b => b.u.building === 'altar');
  assert.ok(site && site.site && site.site.self === AL.selfBuild && site.u.hp === AL.hp, 'a site with 4000 health that builds itself');
  for (let k = 0; k < 10 / Game.SETTINGS.dt; k++) bt.step();
  near(site.site.work, bt.time() * AL.selfBuild, 0.06, 'no builder: 0.2 s of work a second');
  assert.ok(bt.time() > 5, 'the fight went on');
  settle(m, bt);
  assert.ok(!sq.built && sq.progress > 0, 'not built: the work isn\'t done (an altar doesn\'t finish just by surviving)');
  // with a Cog Builder it goes faster; nearly done, it finishes mid-fight
  Game.place(m, 0, cb, 4, 11);
  sq.progress = 0.9;
  bt = Game.startBattle(m);
  const s2 = bt.bodies.find(b => b.u.building === 'altar'), bl = bt.bodies.find(b => b.u.name === 'Cog Builder');
  assert.strictEqual(bl.siteJob, s2, 'the builder takes the altar');
  for (let k = 0; k < 400 && bt.step() && s2.site.work < s2.site.need; k++);
  assert.ok(s2.site.work >= s2.site.need, 'finished in the fight');
  const sum = settle(m, bt);
  assert.ok(sq.built, 'built');
  assert.deepStrictEqual(sum.buildings[0], [{ id: 'altar', built: true }]);
  assert.ok(Game.isReady(m, { ...sq, xp: 1e9 }), 'a built altar can level up');
  assert.ok(!Game.isReady(m, { ...sq, built: false, xp: 1e9 }), 'a site can\'t');
}
// ---------- its skills ----------
function builtAltar(m) { const sq = Game.place(m, 0, altar, 4, 13); sq.built = true; sq.progress = 1; return 'sq' + sq.id; }
{
  const m = match(), key = builtAltar(m);
  assert.ok(Game.canBuyBuildingSkill(m, 0, key, 'blessing'));
  const g0 = m.gold[0];
  assert.ok(Game.buyBuildingSkill(m, 0, key, 'awoken') && m.gold[0] === g0 - 800);
  assert.ok(Game.buyBuildingSkill(m, 0, key, 'blessing') && m.gold[0] === g0 - 200, 'one a round: swapping pays back');
  // Blessing of the Cycle: turrets, healbots, the factory's units and the buildings themselves
  Game.place(m, 0, cb, 4, 11);
  m.tech[0][cb] = [1, 0, 0];
  m.buildings[0].push({ id: 'factory', col: 8, row: 13, round: 0, progress: 1, built: true, xp: 0, level: 0 });
  Game.buyBuildingSkill(m, 0, 'factory', 'fighter');
  m.tech[0][guards] = [0, 0, 1]; Game.place(m, 0, guards, 2, 10);
  const bodies = Game.bodiesFor(m, 0);
  const builder = bodies.find(b => b.u.name === 'Cog Builder'), fac = bodies.find(b => b.u.building === 'factory'), alt = bodies.find(b => b.u.building === 'altar');
  near(builder.u.build.unit.hp, 125, 1e-9, 'turret +25% health'); near(builder.u.build.unit.aps, 1.5 * 1.15, 1e-9, 'turret +15% fire rate'); assert.strictEqual(builder.u.build.unit.regen, 2);
  near(builder.u.build.time, 1.5 / 1.25, 1e-9, 'turrets built 25% faster'); near(builder.u.buildSpeed, 1.25, 1e-9, 'buildings too');
  const fu = fac.produce.units[0];
  near(fu.hp, 1500 * 1.25, 1e-9, 'Cogbot Fighter +25% health'); near(fu.speed, 3 * 1.15, 1e-9, '+15% speed'); assert.strictEqual(fu.regen, 2);
  near(fac.produce.time, 2 / 1.25, 1e-9, 'made 25% sooner');
  near(alt.u.hp, AL.hp * 1.25, 1e-9, 'the altar itself'); assert.strictEqual(alt.u.regen, 2);
  const hb = Game.unitFor(m, 0, guards);
  assert.ok(hb.escort, 'guards with a healbot');
  // the healbot is blessed in the fight (bodiesFor builds it from the squad's unit)
  const bt = E.createBattle(bodies, [], { ...Game.SETTINGS });
  near(bt.bodies.find(b => b.u.name === 'Healbot').u.hp, 300 * 1.25, 1e-9, 'the healbot +25% health');
}
{
  // Cogbot Defensive Force: 2 Fighters and 2 Machinegunners, 4 s into the fight, credited to the altar
  const m = match(), key = builtAltar(m);
  Game.buyBuildingSkill(m, 0, key, 'defense');
  Game.place(m, 0, guards, 6, zone(0, 0)); // a building alone isn't an army: the fight would be over at once
  Game.place(m, 1, guards, 6, zone(1, 0));
  const bt = Game.startBattle(m);
  for (let k = 0; k < 4 / Game.SETTINGS.dt + 2; k++) bt.step();
  const made = bt.bodies.filter(b => b.credit && b.credit.u.building === 'altar').map(b => b.u.name).sort();
  assert.deepStrictEqual(made, ['Cogbot Fighter', 'Cogbot Fighter', 'Cogbot Machinegunner', 'Cogbot Machinegunner']);
  const sq = m.armies[0].find(q => q.unit === altar);
  settle(m, bt);
  assert.ok(sq.xp > 0, 'the altar squad earns their XP');
}
{
  // Core Awoken: the factory and the altar become units, turrets get wheels and a mortar
  const m = match(), key = builtAltar(m);
  Game.buyBuildingSkill(m, 0, key, 'awoken');
  m.buildings[0].push({ id: 'factory', col: 8, row: 13, round: 0, progress: 1, built: true, xp: 0, level: 0 });
  m.buildings[0].push({ id: 'nope', col: 9, row: 13, round: 0, progress: 0, built: false, xp: 0, level: 0 }); // unknown kinds are left out
  Game.place(m, 0, cb, 4, 11);
  const bodies = Game.bodiesFor(m, 0);
  const fac = bodies.find(b => b.u.building === 'factory'), alt = bodies.find(b => b.u.building === 'altar'), bl = bodies.find(b => b.u.name === 'Cog Builder');
  assert.ok(fac.u.awake && !fac.u.idle && !fac.u.noCount && fac.u.speed === 2 && fac.u.hit === 220, 'a tank');
  assert.ok(alt.u.awake && alt.u.beams === 6 && alt.u.spinUp === 50 && alt.u.speed > 0, 'a walking altar with 6 beams');
  const tu = bl.u.build.unit;
  assert.ok(tu.awake && tu.speed === 4 && tu.flee > 0 && tu.backline && tu.lob && tu.minRange > 0 && tu.splash > 0, 'turrets on wheels with a mortar');
  // a site doesn't wake
  const m2 = match(), k2 = builtAltar(m2); Game.buyBuildingSkill(m2, 0, k2, 'awoken');
  m2.buildings[0].push({ id: 'factory', col: 8, row: 13, round: 0, progress: 0.2, built: false, xp: 0, level: 0 });
  assert.ok(Game.bodiesFor(m2, 0).find(b => b.u.building === 'factory').u.idle, 'an unbuilt factory stays a site');
  // in a fight: the altar walks and fires its beams at several enemies
  Game.place(m, 1, UI('Rollers'), 4, zone(1, 0)); Game.place(m, 1, UI('Rollers'), 6, zone(1, 0)); Game.place(m, 1, guards, 8, zone(1, 0));
  const bt = Game.startBattle(m), a2 = bt.bodies.find(b => b.u.building === 'altar'), y0 = a2.y;
  for (let k = 0; k < 400 && bt.step(); k++);
  assert.ok(a2.y !== y0 || !a2.alive, 'the altar walked');
  assert.ok((a2.dealt || 0) > 0 || !a2.alive, 'and fought');
}
// ---------- a turret on wheels keeps away and shells the back line ----------
{
  const tu = E.withTraits({ name: 'Cog Turret', cost: 0, bodies: 1, hp: 1e6, hit: 28, aps: 0.75, range: 35, minRange: 8, splash: 3, projSpeed: 22, speed: 4, flee: 14, backline: true, lob: true });
  const near_ = E.withTraits({ name: 'Chaser', cost: 1, bodies: 1, hp: 1e6, hit: 0, aps: 0.01, range: 1, speed: 1, splash: 0 });
  const far_ = E.withTraits({ name: 'Back', cost: 1, bodies: 1, hp: 1e6, hit: 0, aps: 0.01, range: 1, speed: 0, splash: 0 });
  const A = E.buildSquad(tu, 0, 0, 0, 1, 6), B = E.buildSquad(near_, 1, 0, 10, 2, 6).concat(E.buildSquad(far_, 1, 0, 22, 3, 6)); // both in mortar range at first
  const bt = E.createBattle(A, B, { ...Game.SETTINGS });
  for (let k = 0; k < 3 / Game.SETTINGS.dt; k++) bt.step();
  assert.ok(A[0].y < -2, `it backs away from the chaser (y ${A[0].y.toFixed(1)})`);
  assert.ok((B[1].hp < 1e6) && B[0].hp === 1e6, 'it shells the far one, not the near one');
}
// ---------- AI ----------
{
  // whole AI matches: where it puts an altar, it sits on a free 2x2 block of its zone
  const games = [1, 2, 3, 4].map(seed => {
    const mm = match(seed);
    for (let rd = 0; rd < 8 && !mm.over; rd++) { Game.aiDeploy(mm, 0); Game.aiDeploy(mm, 1); Game.aiLevel(mm, 0); Game.aiLevel(mm, 1); const bt = Game.startBattle(mm); while (bt.step()); Game.resolve(mm, bt.result()); }
    return mm;
  });
  const altars = games.flatMap(g => [0, 1].flatMap(sd => g.armies[sd].filter(q => q.unit === altar)));
  for (const g of games) for (const sd of [0, 1]) for (const q of g.armies[sd]) if (q.unit === altar) assert.ok(Game.blockOf(g, altar, q.col, q.row).every(([c, rr]) => Game.inZone(sd, rr) && c >= 0 && c < Game.COLS), 'the AI\'s altar sits inside its zone');
  console.log('AI altars placed:', altars.length, 'built:', altars.filter(q => q.built).length);
}
console.log('altar ok');
