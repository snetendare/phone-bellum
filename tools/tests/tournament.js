// Tournament logic (src/tournament.js): Swiss pairings without rematches, byes, standings, playoffs, single elimination.
const Tour = require('../../src/tournament.js');
const assert = (c, msg) => { if (!c) { console.log('FAIL', msg); process.exitCode = 1; } else console.log('ok  ', msg); };
const r = Tour.rng(5);
function run(n, settings, label) {
  const t = Tour.create('ABCDE', 'Test cup', settings);
  for (let k = 0; k < n; k++) Tour.join(t, 'p' + k, 'Player ' + k);
  let guard = 0, rematch = false;
  while (t.status !== 'done' && guard++ < 30) {
    assert(Tour.advance(t, r) || t.status === 'done', `${label}: round ${t.rounds.length} starts`);
    if (t.status === 'done') break;
    const rd = Tour.current(t);
    for (const mt of rd.matches) {
      if (mt.b == null) continue;
      const before = t.rounds.slice(0, -1).flatMap(x => x.matches);
      if (rd.stage === 'swiss' && before.some(o => (o.a === mt.a && o.b === mt.b) || (o.a === mt.b && o.b === mt.a))) rematch = true;
      // the lower player number wins, so the standings are predictable
      const w = +mt.a.slice(1) < +mt.b.slice(1) ? 'a' : 'b';
      Tour.report(t, mt.id, w, w === 'a' ? [40, 0] : [0, 40], 7, 'auto');
    }

  }
  return { t, rematch };
}
for (const n of [6, 7, 8, 9, 12]) {
  const { t, rematch } = run(n, { format: 'swiss' }, `swiss ${n}`);
  const swiss = t.rounds.filter(x => x.stage === 'swiss').length, po = t.rounds.filter(x => x.stage === 'playoff').length;
  console.log(`  ${n} players: ${swiss} Swiss rounds + ${po} playoff rounds, champion ${Tour.nameOf(t, t.champion)}, top: ${Tour.placings(t).slice(0, 4).map(x => x.name).join(', ')}`);
  assert(!rematch, `swiss ${n}: no rematches`);
  assert(t.champion === 'p0', `swiss ${n}: the best player wins`);
  if (n % 2) { const got = t.rounds.filter(x => x.stage === 'swiss').map(x => x.matches.find(mt => mt.b == null).a); assert(new Set(got).size === got.length, `swiss ${n}: no one gets two byes`); }
}
for (const n of [6, 8, 11]) {
  const { t } = run(n, { format: 'elim' }, `elim ${n}`);
  console.log(`  elim ${n}: ${t.rounds.length} rounds: ${Tour.bracket(t).map(b => b.name).join(' > ')}`);
  assert(t.champion === 'p0', `elim ${n}: the best player wins`);
}
// a playoff draw holds the round until the organizer replays it or sets a winner
{
  const t = Tour.create('X', 'Cup', { format: 'elim' });
  for (let k = 0; k < 4; k++) Tour.join(t, 'p' + k, 'P' + k);
  Tour.advance(t, r);
  const [m1, m2] = Tour.current(t).matches;
  Tour.report(t, m1.id, 'draw', [0, 0], 5, 'auto'); Tour.report(t, m2.id, 'a', [10, 0], 5, 'auto');
  assert(!Tour.roundDone(Tour.current(t)), 'playoff draw: round not done');
  const code = m1.code; assert(Tour.replay(t, m1.id, r) && m1.code !== code && !m1.result, 'replay gives a new code');
  Tour.report(t, m1.id, 'b', [0, 9], 5, 'auto'); Tour.report(t, m1.id, 'a', [9, 0], 5, 'auto');
  assert(m1.conflict, 'phones that disagree mark the match');
  Tour.report(t, m1.id, 'a', [9, 0], 5, 'org');
  assert(!m1.conflict && m1.result.by === 'org', 'organizer settles it');
  assert(!Tour.report(t, m1.id, 'b', [0, 9], 5, 'auto') && m1.result.winner === 'a', 'phones cannot overwrite the organizer');
  assert(Tour.advance(t, r) && Tour.current(t).matches.length === 1, 'final');
}
// names: cleaned, unique, locked after the start
{
  const t = Tour.create('X', 'Cup', {});
  Tour.join(t, 'a', '  <Vilhelm>  '); Tour.join(t, 'b', 'vilhelm'); Tour.join(t, 'c', '');
  assert(t.players.map(p => p.name).join('|') === 'Vilhelm|vilhelm 2|Player 3', 'names cleaned and unique: ' + t.players.map(p => p.name).join('|'));
  Tour.join(t, 'd', 'D'); Tour.advance(t, r);
  assert(!Tour.join(t, 'e', 'Late'), 'no joining after the start');
  Tour.join(t, 'a', 'NewName'); assert(Tour.player(t, 'a').name === 'Vilhelm', 'names locked after the start');
}
// mirror rolls in a match (src/game.js): the same packages, the same tower offer, Zoe's tiles straight across
{
  global.Engine = require('../../src/engine.js'); global.Shapes = require('../../src/shapes.js');
  const Game = require('../../src/game.js');
  const roster = require('../../src/default-roster.json');
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100 }));
  const M = units.map(() => units.map(() => 0));
  let same = 0, towers = 0, zoe = 0, zoeTried = 0, sizes = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const m = Game.createMatch(units, M, seed, 'standard', null, [], { mirror: true, packOptions: 4 + (seed % 2) });
    sizes.add(m.packages[0].length);
    if (JSON.stringify(m.packages[0]) === JSON.stringify(m.packages[1])) same++;
    m.round = 3; m.towers.forEach(t => delete t.type);
    if (Game.towerChoices(m, 0).map(x => x.id).join() === Game.towerChoices(m, 1).map(x => x.id).join()) towers++;
    m.round = 2; const z = m.packages[0].findIndex(p => p.char === 'zoe');
    if (z >= 0) { zoeTried++; m.round = 1; Game.choosePack(m, 0, z); Game.choosePack(m, 1, z); if (JSON.stringify(m.buff[0].map(t => [t.col, Game.ROWS - 1 - t.row])) === JSON.stringify(m.buff[1].map(t => [t.col, t.row]))) zoe++; }
  }
  assert(same === 40, `mirror: same packages in ${same}/40 matches`);
  assert(towers === 40, `mirror: same tower offer in ${towers}/40`);
  assert(zoe === zoeTried, `mirror: Zoe's tiles straight across in ${zoe}/${zoeTried}`);
  assert(sizes.has(4) && sizes.has(5), 'packOptions: ' + [...sizes].join(', ') + ' options');
  const plain = Game.createMatch(units, M, 7, 'standard', null, [], {});
  assert(plain.packages[0].length === 3 && !plain.mirror, 'default: 3 options, own rolls');
}
