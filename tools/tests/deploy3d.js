// 3D test page, deploying blue in the strategic view: place from the shop, drag, take back, auto deploy,
// fight, and the next round's deploy. Screenshots go to the current folder.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  // the screen point at the middle of a tile (model columns / rows), found by asking the board which tile is where
  const at = (c, r) => p.evaluate(([c, r]) => {
    const el = document.querySelector('#view canvas'), bx = el.getBoundingClientRect(); let sx = 0, sy = 0, n = 0;
    for (let y = bx.top; y < bx.bottom; y += 4) for (let x = bx.left; x < bx.right; x += 4) { const t = window.__lab3d.board.tileAt(x, y); if (t && t.col === c && t.row === r) { sx += x; sy += y; n++; } }
    return n ? [sx / n, sy / n] : null;
  }, [c, r]);
  const tap = async (c, r) => { const [x, y] = await at(c, r); await p.mouse.click(x, y); await p.waitForTimeout(150); };
  const dragT = async (c1, r1, c2, r2) => { const [x1, y1] = await at(c1, r1), [x2, y2] = await at(c2, r2); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await p.mouse.move(x2, y2, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(500); };
  const st = () => p.evaluate(() => { const m = window.__lab3d.m; return { round: m.round, gold: m.gold[0], tower: m.towers[0], army: m.armies[0].map(s => ({ id: s.id, col: s.col, row: s.row, round: s.round, free: !!s.free })) }; });
  const hint = () => p.locator('#hint').textContent();
  // free tiles in blue's zone (package squads land at random)
  const freeTiles = () => p.evaluate(() => { const m = window.__lab3d.m, out = []; for (const row of Game.zoneRows(0)) for (let col = 1; col < Game.COLS - 1; col++) if (!Game.occupied(m, 0, col, row) && Game.canPlaceAt(m, 0, col, row, 0)) out.push([col, row]); return out; });
  await p.goto('http://127.0.0.1:8766/lab3d.html'); await p.waitForTimeout(1500);
  let s = await st(); console.log('round', s.round, 'tower', JSON.stringify(s.tower), '| package squads', JSON.stringify(s.army.map(q => [q.col, q.row])));
  console.log('hint:', await hint());
  await p.screenshot({ path: 'deploy3d-1-start.png' });
  // pick the first unit card that can be bought, then place it on a free tile
  const card = p.locator('#cards .ucard[aria-disabled="false"]:not([data-locked])').first();
  const ui = +(await card.getAttribute('data-i')); await card.click();
  console.log('picked', ui, '| hint:', await hint());
  await p.screenshot({ path: 'deploy3d-2-picked.png' });
  const [a, c] = await freeTiles();
  const g0 = s.gold; await tap(...a);
  s = await st(); const placed = s.army.find(q => q.col === a[0] && q.row === a[1]); console.log('placed', JSON.stringify(placed), 'gold', g0, '->', s.gold);
  await dragT(...a, ...c);
  s = await st(); console.log('dragged to', c, '->', JSON.stringify(s.army.find(q => q.id === placed.id)));
  await p.screenshot({ path: 'deploy3d-3-dragged.png' });
  await p.evaluate(() => { window.__lab3d.selected = null; });
  await tap(...c);
  s = await st(); console.log('taken back:', !s.army.some(q => q.id === placed.id), 'gold', s.gold);
  // the angled view: placing, dragging and taking back work there too; the Strategic chip goes back
  await p.click('#levels .chip:nth-child(3)'); await p.waitForFunction(() => window.__lab3d.board.camera.handsOn()); await p.waitForTimeout(300);
  const lv = () => p.evaluate(() => window.__lab3d.board.camera.level());
  console.log('angled: level', await lv(), '| help:', await p.locator('#help').textContent());
  await p.evaluate(() => { window.__lab3d.selected = null; });
  await p.locator('#cards .ucard[aria-disabled="false"]:not([data-locked])').first().click();
  const ft = []; for (const t of await freeTiles()) { if (ft.length < 2 && await at(...t)) ft.push(t); }
  await tap(...ft[0]);
  s = await st(); const pa = s.army.find(q => q.col === ft[0][0] && q.row === ft[0][1]); console.log('angled placed at', ft[0], ':', !!pa, '| level', await lv());
  await p.screenshot({ path: 'deploy3d-5-angled.png' });
  await dragT(...ft[0], ...ft[1]);
  s = await st(); console.log('angled dragged to', ft[1], '->', JSON.stringify(s.army.find(q => q.id === pa.id)), '| level', await lv());
  await p.evaluate(() => { window.__lab3d.selected = null; });
  await tap(...ft[1]); s = await st(); console.log('angled taken back:', !s.army.some(q => q.id === pa.id), '| level', await lv());
  await p.click('#levels .chip:nth-child(1)'); await p.waitForTimeout(1500); console.log('Strategic chip -> level', await lv());
  await p.click('#auto'); s = await st(); console.log('auto deploy -> squads', s.army.length, 'gold', s.gold);
  await p.click('#fight'); await p.waitForTimeout(300);
  console.log('phase', await p.evaluate(() => window.__lab3d.phase), '| shop hidden', await p.locator('#shop').isHidden());
  await p.click('#next'); await p.waitForTimeout(300);
  s = await st(); console.log('round', s.round, 'phase', await p.evaluate(() => window.__lab3d.phase), '| shop shown', await p.locator('#shop').isVisible(), '| gold', s.gold, '|', await p.locator('#gold').textContent());
  await p.screenshot({ path: 'deploy3d-4-round2.png' });
  await b.close();
})();
