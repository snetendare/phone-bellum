// The carry cap's warning before a fight, and the shutdown streak badge in the HUD.
const assert = require('assert');
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(800);
  await p.click('#go'); await sleep(1500);
  await p.dblclick('[data-pack="0"]'); await sleep(500);
  // under the cap: Fight goes straight to the battle; set a streak first so the badge shows
  await p.evaluate(() => { const { m, me } = window.__pb(); m.gold[me] = 900; m.streak = [0, 0]; m.streak[1 - me] = 4; });
  await p.click('#fight'); await sleep(400);
  assert.ok(await p.locator('#cap-go').isVisible(), 'warning shows with 900 gold');
  const text = await p.locator('#sheet').innerText();
  console.log('warning:', text.replace(/\s+/g, ' '));
  assert.ok(/900 gold.*500.*400 will be lost/.test(text.replace(/\s+/g, ' ')));
  await p.click('#close'); await sleep(200);
  assert.ok(!(await p.locator('#cap-go').count()) || !(await p.locator('#cap-go').isVisible()), 'Keep shopping closes it');
  await p.click('#fight'); await sleep(300); await p.click('#cap-go'); await sleep(600);
  const ph = await p.evaluate(() => document.getElementById('phase').textContent);
  assert.ok(ph === 'Battle' || ph === 'Result', 'fight anyway starts the fight: ' + ph);
  const badge = await p.locator('#streak-foe').innerText();
  assert.ok(badge.includes('4') && await p.locator('#streak-foe').isVisible(), 'foe streak badge: ' + badge);
  assert.ok(!(await p.locator('#streak-you').isVisible()), 'no badge without a streak');
  assert.deepStrictEqual(errs, []);
  console.log('carry cap ui ok');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
