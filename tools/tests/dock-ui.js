// The phone layout and the new 3D camera bits. On a phone (390 x 664) in a match, on both boards: the board fills the
// screen width, the deploy panel is a drawer docked at the bottom, up at the start of the round; a pick from the shop
// puts it down and shows the task line over the board, whose X stops placing (the drawer comes back up); the blue pull tab slides it (held and dragged) or toggles it (a tap) and
// move it; a fight docks the speed bar. On a PC window, none of that (the panel sits beside the board, on 3D too).
// On the 3D board: the Tilted view, one step in from Strategic (the whole board fits, a tap still places a squad there), and the
// battle cam's focus (closer in on its point, then back out). Screenshots go to the current folder.
const { chromium } = require('playwright-core');
const dock = require('./dock');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const open = async (board, vw, vh, touch) => {
    const p = await (await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })).newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    await p.goto(`http://127.0.0.1:8766/?test&board=${board}`);
    if (board === '3d') await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(400);
    await p.dblclick('[data-pack="0"]');
    await p.waitForFunction(() => document.getElementById('pick').hidden && !document.getElementById('panel').classList.contains('shut'), null, { timeout: 10000 }).catch(() => {}); // the package is picked (slow frames on software WebGL)
    await p.waitForTimeout(300);
    return p;
  };
  const lay = (p) => p.evaluate(() => {
    const w = document.getElementById('wrap').getBoundingClientRect(), pn = document.getElementById('panel'), q = pn.getBoundingClientRect(), t = document.getElementById('task');
    return { dock: document.documentElement.classList.contains('dock'), shut: pn.classList.contains('shut'), wrapW: w.width, wrapBottom: w.bottom, panelTop: q.top, panelLeft: q.left, task: !t.hidden, x: !document.getElementById('task-x').hidden, scroll: document.documentElement.scrollHeight - innerHeight };
  });

  for (const board of ['2d', '3d']) {
    const p = await open(board, 390, 664, true);
    let l = await lay(p);
    check(l.dock && !l.shut, `${board}: phone match docks the panel, up at the start of the round${l.dock && !l.shut ? '' : ' ' + JSON.stringify(l)}`);
    check(l.wrapW >= 370, `${board}: the board fills the width (${Math.round(l.wrapW)} px of 390)`);
    check(l.scroll <= 1, `${board}: no page scroll (${l.scroll} px)`);
    await p.screenshot({ path: `dock-${board}-1up.png` });
    await p.locator('#shop .ucard[aria-disabled="false"]:not([data-locked])').first().click(); await p.waitForTimeout(300);
    l = await lay(p);
    check(l.shut && l.task && l.x, `${board}: a pick puts the drawer down and shows the task line with an X`);
    check(l.panelTop >= l.wrapBottom - 1, `${board}: the drawer, down, leaves the whole board in sight`);
    await p.screenshot({ path: `dock-${board}-2pick.png` });
    await p.click('#task-x'); await p.waitForTimeout(300);
    l = await lay(p);
    check(!l.shut && !l.task && await p.evaluate(() => !document.querySelector('#shop .ucard[aria-pressed="true"]')), `${board}: X stops placing, the drawer comes back`);
    const tab = () => p.evaluate(() => { const t = document.getElementById('dock-toggle'), r = t.getBoundingClientRect(), q = document.getElementById('panel').getBoundingClientRect();
      return { text: t.textContent.trim(), up: !!t.querySelector('path[d^="M1 7.5"]'), down: !!t.querySelector('path[d^="M1 1.5"]'), x: r.left + r.width / 2, y: r.top + r.height / 2, onEdge: Math.abs(r.bottom - q.top) < 2, centred: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 }; });
    let tb = await tab();
    check(tb.text === '' && tb.down && tb.onEdge && tb.centred, `${board}: drawer up: the tab sits centred on its top edge, arrows down`);
    const drag = async (dy) => { const t = await tab(); await p.mouse.move(t.x, t.y); await p.mouse.down(); for (let k = 1; k <= 6; k++) await p.mouse.move(t.x, t.y + dy * k / 6); await p.mouse.up(); await p.waitForTimeout(400); };
    await drag(260); l = await lay(p); tb = await tab();
    check(l.shut && tb.text === 'Shop' && tb.up && tb.onEdge, `${board}: sliding the tab down puts the drawer down; the tab says Shop, arrows up`);
    await drag(-260); l = await lay(p);
    check(!l.shut && (await tab()).down, `${board}: sliding it up brings the drawer up`);
    await drag(40); l = await lay(p);
    check(!l.shut, `${board}: a short slide springs back`);
    await dock.down(p); l = await lay(p);
    check(l.shut, `${board}: a tap on the tab puts it down`);
    await dock.up(p); l = await lay(p);
    check(!l.shut, `${board}: a tap brings it up`);
    await p.click('#fight'); await p.waitForTimeout(800);
    l = await lay(p);
    check(l.dock && await p.locator('#panel [data-s]').count() === 3, `${board}: the fight's speed bar is docked`);
    await p.close();
  }

  // PC: the panel beside the board, on both boards
  for (const board of ['2d', '3d']) {
    const p = await open(board, 1440, 900, false), l = await lay(p);
    check(!l.dock && l.panelLeft > 700 && l.wrapW > 500, `${board}: PC layout (board ${Math.round(l.wrapW)} px, panel at x ${Math.round(l.panelLeft)})`);
    await p.screenshot({ path: `pc-${board}.png` });
    await p.close();
  }

  // 3D: the Tilted view, and the battle cam
  const p = await open('3d', 390, 664, true);
  // the wheel steps a level in: Strategic -> Tilted
  const cv = await p.evaluate(() => { const r = document.querySelector('.board3d canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(...cv); await p.mouse.wheel(0, -100);
  await p.waitForFunction(() => window.__pb().board3d.camera.handsOn() && window.__pb().board3d.camera.level() === 1, null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(300);
  check(await p.evaluate(() => window.__pb().board3d.camera.level() === 1), 'one step in from Strategic is the Tilted view');
  const corners = await p.evaluate(() => { const bd = window.__pb().board3d, r = document.querySelector('.board3d canvas').getBoundingClientRect();
    return [[0, 0], [11, 0], [0, 15], [11, 15]].map(([c, w]) => bd.screenAt(c, w, 0)).every(([x, y]) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom); });
  check(corners, 'the tilted view shows the whole board');
  const far = await p.evaluate(() => { const bd = window.__pb().board3d; return bd.screenAt(5, 0, 0)[1] < bd.screenAt(5, 15, 0)[1] && Math.abs(bd.screenAt(0, 0, 0)[0] - bd.screenAt(11, 0, 0)[0]) < Math.abs(bd.screenAt(0, 15, 0)[0] - bd.screenAt(11, 15, 0)[0]); });
  check(far, 'tilted from your side: the enemy end is farther (narrower, higher)');
  const card = p.locator('#shop .ucard[aria-disabled="false"]:not([data-locked])').first(), ui = +(await card.getAttribute('data-i'));
  await card.click(); await p.waitForTimeout(200);
  const spot = await p.evaluate((ui) => { const { m, me } = window.__pb(); for (const row of Game.zoneRows(me)) for (let col = 2; col < Game.COLS - 2; col++) if (!Game.occupied(m, me, col, row) && Game.canPlaceAt(m, me, col, row, ui)) return [col, row]; return null; }, ui);
  const pt = await p.evaluate(([c, r]) => { const bd = window.__pb().board3d, el = document.querySelector('.board3d canvas'), bx = el.getBoundingClientRect(); let sx = 0, sy = 0, n = 0;
    for (let y = bx.top; y < bx.bottom; y += 3) for (let x = bx.left; x < bx.right; x += 3) { const t = bd.pickAt(x, y); if (t && t.col === c && t.row === r) { sx += x; sy += y; n++; } }
    return n ? [sx / n, sy / n] : null; }, spot);
  await p.mouse.click(...pt); await p.waitForTimeout(300);
  check(await p.evaluate(([c, r]) => { const { m, me } = window.__pb(); return m.armies[me].some(s => s.col === c && s.row === r); }, spot), `a tap in the tilted view places a squad (${spot})`);
  await p.screenshot({ path: 'dock-3d-tilted.png' });
  // the battle cam: Camera3D's focus on a point, closer in; then back out once it ends
  const span = () => p.evaluate(() => { const bd = window.__pb().board3d; return Math.abs(bd.screenAt(11, 8, 0)[0] - bd.screenAt(0, 8, 0)[0]); });
  // draw frames until the camera stops moving on its own
  const settle = () => p.evaluate(() => new Promise((done) => { const bd = window.__pb().board3d; let n = 0; const step = () => { bd.draw(); if (bd.still() || ++n > 600) done(); else requestAnimationFrame(step); }; step(); }));
  const s0 = await span();
  await p.evaluate(() => { const { me, board3d } = window.__pb(), f = me === 1 ? -1 : 1, w = Game.tileToWorld(2, 13); board3d.camera.focus(1, w.x * f, -w.y * f); });
  await settle();
  const s1 = await span(), mid = await p.evaluate(() => { const bd = window.__pb().board3d, r = document.querySelector('.board3d canvas').getBoundingClientRect(), [x, y] = bd.screenAt(2, 13, 0); return [x - (r.left + r.width / 2), y - (r.top + r.height / 2)]; });
  check(s1 > s0 * 1.4, `battle cam: the board looks bigger (${Math.round(s0)} -> ${Math.round(s1)} px across)`);
  check(Math.hypot(...mid) < 60, `battle cam: its point is near the middle of the screen (${mid.map(Math.round)})`);
  await p.screenshot({ path: 'dock-3d-battlecam.png' });
  await p.evaluate(() => window.__pb().board3d.camera.focus(0));
  await settle();
  check(Math.abs(await span() - s0) < 2, 'battle cam: back to the home view after');
  await p.evaluate(() => window.__pb().board3d.camera.setLevel(2)); await settle();
  check(await p.evaluate(() => window.__pb().board3d.camera.level() === 2), 'the next step in is Angled');
  await p.keyboard.press('Escape'); await settle();
  check(await p.evaluate(() => window.__pb().board3d.camera.strategic()), 'Esc goes back to Strategic');

  await b.close();
  console.log(fails ? `${fails} failed` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
