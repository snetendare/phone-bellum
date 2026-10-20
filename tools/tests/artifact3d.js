// The artifact builds (node tools/build-artifact.js) and the 3D board. phone-bellum.html opens on the 2D board without
// fetching three.js, and the Board setting then imports three.js 0.180.0 from jsDelivr; when that download fails, the
// game stays on 2D with one line and the setting stays 3D. game3d-artifact.html starts on the 3D board with the speed
// meter, three.js from ./vendor/.
// This container can't reach jsDelivr, so its three.js address is answered from vendor/ (the same 0.180.0 files).
// Headless Chromium needs software WebGL (the args below).
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const VENDOR = path.join(__dirname, '..', '..', 'vendor');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  // a page whose three.js requests are logged; cdn: 'serve' answers jsDelivr from vendor/, 'fail' makes it fail
  const open = async (cdn) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage(), three = [];
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    p.on('request', r => { if (/three\.(module|core)\.min\.js/.test(r.url())) three.push(r.url()); });
    await ctx.route(CDN + '*', (r) => cdn === 'fail' ? r.abort() : r.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(VENDOR, path.basename(new URL(r.request().url()).pathname))) }));
    // the artifact pages have no charset of their own (claude.ai wraps them in a page that has one)
    await ctx.route(/\/(phone-bellum|game3d-artifact)\.html/, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(VENDOR, '..', path.basename(new URL(r.request().url()).pathname))) }));
    await ctx.route('https://cdn.jsdelivr.net/npm/peerjs*/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR, '..', 'peerjs.min.js')) }));
    return { p, three };
  };
  const solo = async (p) => { await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(400); await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(800); };
  const is3d = (p) => p.evaluate(() => !!window.__pb().board3d);

  // phone-bellum.html: 2D, no three.js until the setting turns 3D on
  let { p, three } = await open('serve');
  await p.goto('http://127.0.0.1:8766/phone-bellum.html?test'); await p.waitForFunction(() => window.__pb, null, { timeout: 15000 }); await p.waitForTimeout(800);
  check(!(await is3d(p)) && await p.locator('#board').isVisible() && !three.length, 'phone-bellum.html opens on 2D, three.js not fetched');
  check(await p.evaluate(() => typeof Render3D === 'function'), 'the 3D code is inlined');
  await solo(p);
  await p.click('#cog'); await p.click('[data-board="3d"]');
  await p.waitForFunction(() => window.__pb().board3d, null, { timeout: 15000 }).catch(() => {});
  check(await is3d(p) && await p.locator('.board3d canvas').isVisible() && !(await p.locator('.meter3d').count()), '3D from Settings: the 3D board, no meter');
  check(three.length > 0 && three.every(u => u.startsWith(CDN)), `three.js from jsDelivr 0.180.0 (${three.map(u => u.split('/').pop()).join(', ')})`);
  await p.click('#close');
  await p.screenshot({ path: 'artifact3d-1-3d.png' });
  await p.context().close();

  // the download fails: 2D with a line, the setting stays 3D for next time
  ({ p, three } = await open('fail'));
  await p.goto('http://127.0.0.1:8766/phone-bellum.html?test'); await p.waitForFunction(() => window.__pb, null, { timeout: 15000 });
  await solo(p);
  await p.click('#cog'); await p.click('[data-board="3d"]'); await p.click('#close');
  await p.waitForSelector('#note3d', { timeout: 15000 }).catch(() => {});
  const note = (await p.locator('#note3d').count()) ? await p.locator('#note3d').textContent() : '';
  check(!(await is3d(p)) && /couldn’t load/.test(note) && await p.locator('#board').isVisible(), `no download: stays 2D: "${note}"`);
  check(await p.evaluate(() => localStorage.getItem('phone-bellum-board')) === '3d', 'the setting stays 3D');
  await p.context().close();

  // game3d-artifact.html: forced onto 3D with the meter, three.js from ./vendor/
  ({ p, three } = await open('fail'));
  await p.goto('http://127.0.0.1:8766/game3d-artifact.html?test');
  await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 }).catch(() => {});
  check(await is3d(p) && await p.locator('.meter3d').isVisible(), 'game3d-artifact.html starts on 3D with the meter');
  check(three.length > 0 && three.every(u => u.startsWith('http://127.0.0.1:8766/vendor/')), 'three.js from ./vendor/');
  await p.context().close();

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
