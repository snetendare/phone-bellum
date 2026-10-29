// The Factions devtest in the browser (2D board by default; PB_BOARD=3d for the 3D board): the shared draft, no tower
// in rounds 1 and 2, the round 2 building pick and placing, an arrow dragged out of a squad, a spell cast, the round 3
// tower, and fights to the end. Screenshots go to the current folder (devtest-*.png).
// Needs the game served on port 8766 (python3 -m http.server 8766 from the repo root).
const { chromium } = require('playwright-core');
const ctxFor = require('./board2d');
(async () => {
  const exe = [process.env.PW_CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(f => f && require('fs').existsSync(f));
  const b = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await (await ctxFor(b, { viewport: { width: 1280, height: 900 } })).newPage();
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
  await p.goto('http://localhost:8766/index.html?test');
  await p.waitForTimeout(800);
  const st = () => p.evaluate(() => { const { m, me } = window.__pb(); return m && { round: m.round, gold: m.gold[me], picks: m.dev && m.dev.picks[me], b: m.dev && m.dev.buildings[me], army: m.armies[me].map(s => ({ id: s.id, col: s.col, row: s.row, guide: s.guide })), over: m.over }; });
  // the screen point of a tile (model column / row), on either board
  const at = (c, r) => p.evaluate(([c, r]) => {
    const { me, board3d } = window.__pb(), f = me === 1, sc = f ? Game.COLS - 1 - c : c, sr = f ? Game.ROWS - 1 - r : r;
    if (board3d) return board3d.screenAt(sc, sr, 0);
    const bb = document.querySelector('#board').getBoundingClientRect();
    return [bb.left + (sc + .5) * bb.width / Game.COLS, bb.top + (sr + .5) * bb.height / Game.ROWS];
  }, [c, r]);
  const tap = async (c, r) => { const [x, y] = await at(c, r); await p.mouse.click(x, y); await p.waitForTimeout(250); };
  const drag = async (c1, r1, c2, r2) => { const [x1, y1] = await at(c1, r1), [x2, y2] = await at(c2, r2); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x1, (y1 + y2) / 2, { steps: 5 }); await p.mouse.move(x2, (y1 + y2) / 2, { steps: 5 }); await p.mouse.move(x2, y2, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(400); };
  const pickFirst = async () => { const o = p.locator('#pick [data-opt]').first(); await o.click(); await p.waitForTimeout(150); await o.click(); await p.waitForTimeout(300); };
  const phase = () => p.evaluate(() => document.querySelector('#phase').textContent);
  const fight = async () => {
    await p.locator('#fight').click();
    await p.waitForTimeout(200); if (await p.locator('#cap-go').count()) await p.locator('#cap-go').click(); // over the carry cap
    for (let k = 0; k < 400 && (await phase()) === 'Battle'; k++) await p.waitForTimeout(250);
  };
  const next = async () => { if (await p.locator('#next').count()) { await p.locator('#next').click(); await p.waitForTimeout(500); } };

  await p.locator('#devtest-ai').click();
  await p.waitForTimeout(400);
  check(await p.locator('.draft').count() === 1, 'the devtest opens the faction draft');
  for (let k = 0; k < 12 && await p.locator('.draft').count(); k++) {
    const open = p.locator('.fac:not([disabled])');
    if (await p.locator('#draft-go').count() && await open.count()) { await open.first().click(); await p.locator('#draft-go').click(); }
    await p.waitForTimeout(1000);
  }
  let s = await st();
  check(s && s.round === 1, 'the match starts after the draft');
  check(await p.evaluate(() => Game.COLS === 14 && window.__pb().m.map.id === 'testgrid'), 'on the Test Grid');
  await pickFirst(); // the package
  await p.screenshot({ path: 'devtest-1.png' });
  await fight();
  const r1 = await p.evaluate(() => window.__pb().bt && window.__pb().bt.bodies.some(x => x.squad === -2));
  check(!r1, 'no tower in the round 1 fight');
  await next();
  // round 2: a building
  check(await p.locator('#pick [data-opt]').count() === 3, 'round 2: three building cards');
  await pickFirst();
  s = await st();
  check(s.b.length === 1 && s.b[0].col == null, 'picked a building, not placed yet');
  const spot = await p.evaluate(() => { const { m, me } = window.__pb(), rows = Game.zoneRows(me); for (const row of rows.slice(4)) for (let col = 2; col < Game.COLS - 2; col++) if (Game.lesserSpotOk(m, me, Game.devBuilding(m.dev.buildings[me][0].id), col, row, m.dev.buildings[me][0].key)) return [col, row]; });
  await tap(...spot);
  s = await st();
  check(s.b[0].col === spot[0] && s.b[0].row === spot[1], 'building placed on the tapped tile');
  // an arrow dragged out of a squad
  const sq = s.army[0];
  await p.locator('#dev-guide').click();
  await drag(sq.col, sq.row, Math.max(0, sq.col - 3), sq.row - 6);
  s = await st();
  const g = s.army.find(x => x.id === sq.id).guide;
  check(g && g.length >= 1 && g[g.length - 1].col === Math.max(0, sq.col - 3) && g[g.length - 1].row === sq.row - 6, 'arrow drawn: ' + JSON.stringify(g));
  await p.screenshot({ path: 'devtest-2.png' });
  await fight();
  check(await p.evaluate(() => window.__pb().bt.bodies.some(x => x.u.lesser)), 'the building fought');
  await next();
  // round 3: the tower pick, then a spell (given through a Power, for the test)
  check((await p.locator('#pick [data-opt]').count()) >= 1, 'round 3: the tower pick');
  await pickFirst();
  await p.evaluate(() => { const { m, me } = window.__pb(); m.dev.picks[me].push({ round: 1, cat: 'power', id: 'fire-pots' }); m.gold[me] += 200; });
  await p.locator('#fight').hover(); await p.evaluate(() => document.querySelector('#dev-guide').click()); await p.evaluate(() => document.querySelector('#dev-guide').click()); // repaint the panel
  check(await p.locator('#dev-spells').count() === 1, 'Spells button once a Power gives one');
  await p.locator('#dev-spells').click();
  await p.locator('[data-cast]').first().click();
  await tap(6, 8);
  check(await p.evaluate(() => window.__pb().m.dev.casts.length === 1), 'spell cast');
  await p.screenshot({ path: 'devtest-3.png' });
  await p.locator('#fight').click();
  await p.waitForTimeout(200); if (await p.locator('#cap-go').count()) await p.locator('#cap-go').click();
  await p.waitForTimeout(3300);
  await p.screenshot({ path: 'devtest-4.png' });
  for (let k = 0; k < 400 && (await phase()) === 'Battle'; k++) await p.waitForTimeout(250);
  check(await p.evaluate(() => window.__pb().bt.bodies.some(x => x.squad === -2)), 'tower in the round 3 fight');
  // play on to the end: Fight every round (picks fall to the first card)
  for (let k = 0; k < 25 && !(await st()).over; k++) {
    await next();
    if ((await phase()) !== 'Deploy') continue;
    await fight();
  }
  s = await st();
  check(s.over, 'the match ends (round ' + s.round + ')');
  console.log(fails ? `${fails} failed` : 'devtest-ui ok');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
