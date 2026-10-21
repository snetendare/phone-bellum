const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const tap = async (c, r) => { const b2 = await p.locator('#board').boundingBox(); await p.mouse.click(b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16); };
  await p.goto('http://127.0.0.1:8766/'); await sleep(500);
  await p.click('#settings summary'); await p.click('[data-tm="1"]'); await p.click('#go'); await sleep(1200);
  console.log('round 1 timer:', await p.locator('#timer').textContent());
  await p.dblclick('[data-pack="0"]'); await sleep(200); await tap(1, 15); await sleep(200);
  await p.click('.ucard:not([data-locked])'); await tap(5, 13); await p.click('#fight'); await sleep(500); await p.click('#skip'); await sleep(800);
  await p.click('#next').catch(e => console.log('no #next', e.message.slice(0, 60))); await sleep(1200);
  console.log('round 2 timer:', await p.locator('#timer').textContent(), '| phase', await p.locator('#phase').textContent());
  await b.close();
})();
