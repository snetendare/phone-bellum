// The game on the 3D board (?board=3d): the game's own board input through render3d.js. Package squads dragged,
// a unit placed from the shop and taken back, the tower and unit sheets, the paid Move ability in round 2 (tap and
// drag), an enemy squad's sheet, and placing in the angled view; there a drag on an older squad doesn't slide the
// view, and a press on a model's body (above its tile) drags its squad. Also that the board idles in the shop, the meter
// (frame rate, quality steps, the last fight's summary). Screenshots go to the current folder.
// Headless Chromium needs software WebGL (the args below) and runs at about 10-15 fps.
const { chromium } = require('playwright-core');
const dock = require('./dock'); // the phone layout's deploy drawer
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
  // the screen point at the middle of a tile (model columns / rows), found by asking the 3D board which tile a touch
  // picks where (in the angled view a model standing in front can cover a tile)
  const at = (c, r) => p.evaluate(([c, r]) => {
    const bd = window.__pb().board3d, el = document.querySelector('.board3d canvas'), bx = el.getBoundingClientRect(); let sx = 0, sy = 0, n = 0;
    for (let y = bx.top; y < bx.bottom; y += 4) for (let x = bx.left; x < bx.right; x += 4) { const t = bd.pickAt(x, y); if (t && t.col === c && t.row === r) { sx += x; sy += y; n++; } }
    return n ? [sx / n, sy / n] : null;
  }, [c, r]);
  const tap = async (c, r) => { await dock.down(p); const [x, y] = await at(c, r); await p.mouse.click(x, y); await p.waitForTimeout(200); };
  const dragT = async (c1, r1, c2, r2) => { await dock.down(p); const [x1, y1] = await at(c1, r1), [x2, y2] = await at(c2, r2); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await p.mouse.move(x2, y2, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(500); };
  const st = () => p.evaluate(() => { const { m, me } = window.__pb(); return { round: m.round, gold: m.gold[me], tower: m.towers[me], moved: m.moved[me], army: m.armies[me].map(s => ({ id: s.id, col: s.col, row: s.row, round: s.round, unit: s.unit })) }; });
  // free tiles in your zone where unit ui may go, and that the camera shows
  const freeTiles = async (ui) => {
    const all = await p.evaluate((ui) => { const { m, me } = window.__pb(), out = []; for (const row of Game.zoneRows(me)) for (let col = 1; col < Game.COLS - 1; col++) if (!Game.occupied(m, me, col, row) && Game.canPlaceAt(m, me, col, row, ui)) out.push([col, row]); return out; }, ui);
    const seen = []; for (const t of all) { if (seen.length < 3 && await at(...t)) seen.push(t); } return seen;
  };
  const sheet = async () => (await p.locator('#sheet-back').isVisible()) ? (await p.locator('#sheet-h').textContent()).trim() : null;
  const closeSheet = async () => { await p.click('#sheet #close'); await p.waitForTimeout(150); };

  await p.goto('http://127.0.0.1:8766/?test&board=3d');
  await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
  check(await p.locator('#board').isHidden() && await p.locator('.board3d canvas').isVisible(), '3D board in place of the 2D canvas');
  await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(400);
  await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(800);
  let s = await st();
  console.log('round', s.round, 'tower', JSON.stringify(s.tower), 'package', JSON.stringify(s.army.map(q => [q.col, q.row])));
  await p.screenshot({ path: 'game3d-1-start.png' });

  // drag a package squad (boardPress / boardDrag / boardDrop)
  const pk = s.army[0], [to] = await freeTiles(pk.unit);
  await dragT(pk.col, pk.row, ...to);
  s = await st(); check(s.army.some(q => q.id === pk.id && q.col === to[0] && q.row === to[1]), `package squad dragged to ${to}`);

  // the tower sheet: tap your tower (boardTap)
  await tap(s.tower.col, s.tower.row);
  check(/Your tower/.test(await sheet() || ''), `tap on your tower opens its sheet (${await sheet()})`);
  if (await sheet()) await closeSheet();
  // the unit sheet of a squad from this round's package... is a take-back tap; a pick from the shop, then a tap places it
  const card = p.locator('#shop .ucard[aria-disabled="false"]:not([data-locked])').first();
  await dock.up(p); const ui = +(await card.getAttribute('data-i')); await card.click(); await p.waitForTimeout(150);
  const [a] = await freeTiles(ui), g0 = s.gold;
  await tap(...a);
  s = await st(); const placed = s.army.find(q => q.col === a[0] && q.row === a[1] && q.unit === ui);
  check(!!placed && s.gold < g0, `shop pick placed at ${a}, gold ${g0} -> ${s.gold}`);
  await p.evaluate(() => { const card = document.querySelector('#shop .ucard[aria-pressed="true"]'); if (card) card.click(); }); await p.waitForTimeout(150); // drop the pick
  await tap(...a);
  s = await st(); check(placed && !s.army.some(q => q.id === placed.id) && s.gold === g0, `tap takes it back, gold ${s.gold}`);

  // idle: nothing moves in the shop, so the board stops drawing (the meter counts frames drawn in the last second)
  const fps = async () => +(await p.locator('.meter3d').textContent()).split(' fps')[0];
  await p.mouse.move(5, 5); await p.waitForTimeout(4000); // software WebGL: a frame can take half a second
  check(await fps() === 0, `idle in the shop: ${await fps()} frames in the last second`);
  // the meter steps the quality: high -> medium -> low -> high
  const q = async () => (await p.locator('.meter3d').textContent()).split('\n')[0].split(' · ')[2];
  const q0 = await q(); await p.click('.meter3d'); const q1 = await q(); await p.click('.meter3d'); const q2 = await q(); await p.click('.meter3d');
  check(/^high/.test(q0) && /^medium/.test(q1) && /^low ×1$/.test(q2) && /^high/.test(await q()), `quality: ${q0} -> ${q1} -> ${q2} -> ${await q()}`);
  // a fight draws every frame, and the meter sums it up afterwards
  await p.click('#fight'); await p.waitForTimeout(2200);
  check(await fps() > 0, `fight: ${await fps()} frames in the last second`);
  if (await p.locator('#skip').count()) await p.click('#skip');
  await p.waitForFunction(() => /last fight/.test(document.querySelector('.meter3d').textContent), null, { timeout: 15000 }).catch(() => {});
  const sum = (await p.locator('.meter3d').textContent()).split('\n')[1] || '';
  check(/^last fight \d+ fps · slowest second \d+ · \d+ bodies$/.test(sum), `after the fight: ${sum}`);

  // round 2: Move ability (50 gold) by tap, undo, then by drag
  await p.click('#next'); await p.waitForTimeout(800);
  s = await st(); check(s.round === 2, 'round 2');
  await p.screenshot({ path: 'game3d-2-round2.png' });
  const old = s.army.find(q => q.round < 2);
  // the unit sheet: tap an old squad outside any ability
  await tap(old.col, old.row);
  check(!!(await sheet()), `tap on an older squad opens its sheet (${await sheet()})`);
  if (await sheet()) await closeSheet();
  await dock.up(p); await p.click('#move-btn'); await p.waitForTimeout(150);
  await tap(old.col, old.row);
  const [mv] = await freeTiles(old.unit);
  await tap(...mv);
  s = await st(); check(s.army.some(q => q.id === old.id && q.col === mv[0] && q.row === mv[1]) && s.moved === old.id, `Move by tapping: ${old.col},${old.row} -> ${mv}, gold ${s.gold}`);
  await dock.up(p); await p.click('#undo-move'); await p.waitForTimeout(200);
  s = await st(); check(s.army.some(q => q.id === old.id && q.col === old.col && q.row === old.row), 'undo move');
  await dock.up(p); await p.click('#move-btn'); await p.waitForTimeout(150);
  const [mv2] = await freeTiles(old.unit);
  await dragT(old.col, old.row, ...mv2);
  s = await st(); check(s.army.some(q => q.id === old.id && q.col === mv2[0] && q.row === mv2[1]), `Move by dragging -> ${mv2}`);

  // an enemy squad from round 1: its sheet
  const foe = await p.evaluate(() => { const { m, me } = window.__pb(); const q = m.armies[1 - me].find(s => s.round < m.round && !Game.hiddenFromFoe(m, s)); if (!q) return null; const t = Game.seenAt(m, q); return [t.col, t.row]; });
  if (foe && await at(...foe)) { await tap(...foe); check(!!(await sheet()), `tap on an enemy squad opens its sheet (${await sheet()})`); if (await sheet()) await closeSheet(); }
  else console.log('skip: no visible enemy squad on screen');

  // the angled view takes taps while deploying: place from the shop there
  await p.evaluate(() => window.__pb().board3d.camera.setLevel(1));
  await p.waitForFunction(() => window.__pb().board3d.camera.handsOn(), null, { timeout: 15000 }); await p.waitForTimeout(300);
  const card2 = p.locator('#shop .ucard[aria-disabled="false"]:not([data-locked])').first();
  await dock.up(p); const ui2 = +(await card2.getAttribute('data-i')); await card2.click(); await p.waitForTimeout(150);
  const [c] = await freeTiles(ui2);
  if (c) { await tap(...c); s = await st(); check(s.army.some(q => q.col === c[0] && q.row === c[1] && q.round === 2), `angled view: placed at ${c}`); }
  else check(false, 'angled view: no free tile on screen');
  await p.screenshot({ path: 'game3d-3-angled.png' });
  check(await p.evaluate(() => window.__pb().board3d.camera.level()) === 1, 'still in the angled view');

  // angled view: a press on a squad never slides the view, and a press on a model's body (above its tile) picks its squad
  const scr = (c, r, h) => p.evaluate(([c, r, h]) => window.__pb().board3d.screenAt(c, r, h), [c, r, h]);
  const pull = async ([x1, y1], [x2, y2]) => { await dock.down(p); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await p.mouse.move(x2, y2, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(600); };
  // a point on a squad's model that picks it (another model in front may cover part of it); above: over another tile's ground
  const bodyAt = (c, r, above) => p.evaluate(([c, r, above]) => {
    const bd = window.__pb().board3d;
    for (const h of [1.6, 1.3, 1.9, 1.0, 2.2]) { const [x, y] = bd.screenAt(c, r, h), g = bd.tileAt(x, y), t = bd.pickAt(x, y); if (t && t.col === c && t.row === r && !(above && g && g.col === c && g.row === r)) return [x, y]; }
    return bd.screenAt(c, r, 1.6);
  }, [c, r, above]);
  s = await st();
  const still = s.army.find(q => q.round < 2 && q.id !== s.moved), ref = await scr(5, 7, 0);
  if (still) {
    const from = await bodyAt(still.col, still.row, false);
    await pull(from, [from[0], from[1] - 80]);
    const now = await scr(5, 7, 0), s2 = await st();
    check(Math.hypot(now[0] - ref[0], now[1] - ref[1]) < 1 && s2.army.some(q => q.id === still.id && q.col === still.col && q.row === still.row), `dragging an older squad doesn't slide the view (moved ${Math.round(Math.hypot(now[0] - ref[0], now[1] - ref[1]))} px)`);
  } else console.log('skip: no older squad to press');
  const fresh = c && s.army.find(q => q.col === c[0] && q.row === c[1] && q.round === 2);
  if (fresh) {
    const [dest] = (await freeTiles(fresh.unit)).filter(t => t[0] !== c[0] || t[1] !== c[1]);
    await pull(await bodyAt(fresh.col, fresh.row, true), await at(...dest));
    s = await st(); check(s.army.some(q => q.id === fresh.id && q.col === dest[0] && q.row === dest[1]), `a press on the model's body drags its squad: -> ${dest}`);
  }

  await b.close();
  console.log(fails ? `${fails} failed` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
