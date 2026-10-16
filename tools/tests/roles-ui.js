// Role symbols and range pips on unit cards and in the info sheet. Screenshots go to the current folder.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const tap = async (c, r) => { const b2 = await p.locator('#board').boundingBox(); await p.mouse.click(b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16); };
  await p.goto('http://127.0.0.1:8766/'); await sleep(500);
  await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
  await p.dblclick('[data-pack="0"]'); await sleep(200); await tap(1, 15); await sleep(200);
  for (const t of [1, 2, 3, 4]) {
    await p.click(`[data-tier="${t}"]`); await sleep(150);
    console.log(`T${t}:`, (await p.$$eval('.ucard', cs => cs.map(c => c.querySelector('.n').textContent + ' = ' + c.querySelector('.roles').title))).join(' | '));
    const shop = p.locator('#shop'); await shop.screenshot({ path: `roles-t${t}.png` });
  }
  await p.click('[data-tier="1"]'); await sleep(150);
  await p.click('[data-info="0"]'); await sleep(200);
  await p.locator('#sheet').screenshot({ path: 'roles-sheet.png' });
  await b.close();
})();
