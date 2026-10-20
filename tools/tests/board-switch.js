// The Board setting (2D / 3D in the in-match Settings) and the 3D board's fall back to 2D. 2D by default; the switch
// starts and stops the 3D board mid-match (stopping frees its WebGL context) and is saved on this device; the 3D
// quality in Settings; a lost WebGL context, fights that are too slow (quality steps down first) and no WebGL at all
// each go back to 2D with one line on the board; ?board=3d still forces 3D, with the speed meter.
// Headless Chromium needs software WebGL (the args below): about 5-10 fps at high and medium quality, 25 at low.
const { chromium } = require('playwright-core');
const URL = 'http://127.0.0.1:8766/?test';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const open = async (init) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    return p;
  };
  const is3d = (p) => p.evaluate(() => !!window.__pb().board3d);
  const on3d = (p) => p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
  const on2d = (p) => p.waitForFunction(() => window.__pb && !window.__pb().board3d, null, { timeout: 60000 });
  const stored = (p) => p.evaluate(() => [localStorage.getItem('phone-bellum-board'), localStorage.getItem('phone-bellum-3d-quality')]);
  const note = async (p) => (await p.locator('#note3d').isVisible()) ? (await p.locator('#note3d').textContent()) : '';
  const solo = async (p) => { await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(400); await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(800); };
  const settings = async (p) => { await p.click('#cog'); await p.waitForTimeout(150); };
  // a whole fight: Fight, then wait for the round's result
  const fight = async (p) => { await p.click('#fight'); await p.waitForSelector('#next', { timeout: 120000 }); await p.waitForTimeout(300); };

  // 2D by default, then 3D and back from Settings
  let p = await open();
  await p.goto(URL); await p.waitForFunction(() => window.__pb, null, { timeout: 15000 }); await p.waitForTimeout(500);
  check(!(await is3d(p)) && await p.locator('#board').isVisible() && !(await p.locator('.board3d').count()), '2D board by default');
  await solo(p);
  await settings(p);
  check((await p.locator('#sheet-h').textContent()).trim() === 'Settings' && await p.locator('[data-board="2d"][aria-pressed="true"]').isVisible(), 'Settings: Board 2D pressed');
  check(await p.locator('#q3d-bar').isHidden(), 'no 3D quality while on 2D');
  await p.click('[data-board="3d"]'); await on3d(p);
  check(await p.locator('#board').isHidden() && await p.locator('.board3d canvas').isVisible(), '3D on mid-match: 3D board in place of the canvas');
  check(!(await p.locator('.meter3d').count()), 'no speed meter in the setting');
  check(await p.locator('#q3d-bar').isVisible() && await p.locator('[data-q3d="high"][aria-pressed="true"]').count() === 1, '3D quality shown, high');
  check((await stored(p))[0] === '3d', 'saved: 3d');
  await p.click('[data-q3d="medium"]');
  check(await p.evaluate(() => window.__pb().board3d.pixelRatio()) === 1.5 && (await stored(p))[1] === 'medium', 'quality medium: 1.5 pixels per CSS pixel, saved');
  await p.evaluate(() => { window.__gl = document.querySelector('.board3d canvas').getContext('webgl2'); });
  await p.click('[data-board="2d"]'); await on2d(p);
  check(await p.locator('#board').isVisible() && !(await p.locator('.board3d').count()) && await p.locator('#q3d-bar').isHidden(), '3D off: back to the 2D canvas');
  check(await p.evaluate(() => window.__gl.isContextLost()), 'its WebGL context freed');
  check((await stored(p))[0] === '2d', 'saved: 2d');
  // the 2D board still takes the game's input: a shop pick placed on the canvas
  const placed = await p.evaluate(() => { const { m, me } = window.__pb(); return m.armies[me].length; });
  await p.click('#close');
  await p.locator('#shop .ucard[aria-disabled="false"]:not([data-locked])').first().click();
  const box = await p.locator('#board').boundingBox(), tile = box.width / 12;
  for (let c = 1; c < 11; c++) { await p.mouse.click(box.x + (c + 0.5) * tile, box.y + 10.5 * tile); if (await p.evaluate((n) => { const { m, me } = window.__pb(); return m.armies[me].length > n; }, placed)) break; }
  check(await p.evaluate((n) => { const { m, me } = window.__pb(); return m.armies[me].length > n; }, placed), 'the 2D board places squads again');

  // a lost WebGL context: back to 2D with a line, the setting stays 3D
  await settings(p); await p.click('[data-board="3d"]'); await on3d(p); await p.click('#close');
  await p.evaluate(() => document.querySelector('.board3d canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await on2d(p);
  check(/stopped/.test(await note(p)) && await p.locator('#board').isVisible(), `context lost -> 2D: "${await note(p)}"`);
  check((await stored(p))[0] === '3d', 'the setting stays 3D');
  await p.click('#note3d');
  check(!(await note(p)), 'a tap closes the line');
  // saved 3D starts at load
  await p.reload(); await on3d(p);
  check(await is3d(p), 'saved 3D: the 3D board starts at load');

  // too slow: a fight under 20 fps steps the quality down (medium -> low), the next one at low goes back to 2D
  await solo(p);
  await fight(p);
  check(await is3d(p) && (await stored(p))[1] === 'low' && await p.evaluate(() => window.__pb().board3d.pixelRatio()) === 1, `slow fight at medium: still 3D, quality now ${(await stored(p))[1]}`);
  await p.click('#next'); await p.waitForTimeout(800);
  // at low quality headless runs about 25 fps, so a slow phone is played: each frame takes 60 ms more
  await p.evaluate(() => { const raf = window.requestAnimationFrame; window.requestAnimationFrame = (cb) => raf((t) => { const e = performance.now() + 60; while (performance.now() < e); cb(t); }); });
  await fight(p); await on2d(p).catch(() => {});
  check(!(await is3d(p)) && /too slow/.test(await note(p)), `slow fight at low -> 2D: "${await note(p)}"`);
  check((await stored(p))[0] === '2d', 'the setting goes back to 2D');
  await p.screenshot({ path: 'board-switch-slow.png' });
  await p.context().close();

  // no WebGL: the setting says 3D, the board can't start, so 2D with a line, and the setting goes back to 2D
  p = await open(() => {
    try { localStorage.setItem('phone-bellum-board', '3d'); } catch (e) {}
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (k, ...a) { return /webgl/.test(k) ? null : get.call(this, k, ...a); };
  });
  await p.goto(URL); await p.waitForFunction(() => window.__pb, null, { timeout: 15000 });
  await p.waitForSelector('#note3d', { timeout: 15000 }).catch(() => {});
  check(!(await is3d(p)) && /can’t run/.test(await note(p)) && await p.locator('#board').isVisible(), `no WebGL -> 2D: "${await note(p)}"`);
  check(await p.evaluate(() => localStorage.getItem('phone-bellum-board')) === '2d', 'the setting goes back to 2D');
  await p.context().close();

  // ?board=3d forces 3D over a saved 2D, with the speed meter
  p = await open(() => { try { localStorage.setItem('phone-bellum-board', '2d'); } catch (e) {} });
  await p.goto(URL + '&board=3d'); await on3d(p);
  check(await p.locator('.meter3d').isVisible(), '?board=3d: 3D with the speed meter');
  await p.context().close();

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
