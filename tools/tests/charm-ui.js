// Matteo: the Give Charisma button on a squad sheet, the pips on the board, and charisma growing in a fight.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = process.env.OUT || '.';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(500);
  await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
  await p.dblclick('[data-pack="0"]'); await sleep(300);
  // make this player Matteo
  const sq = await p.evaluate(() => { const { m, me } = window.__pb(); m.chars[me] = 'matteo'; return m.armies[me].map(q => ({ id: q.id, col: q.col, row: q.row })); });
  console.log('squads:', JSON.stringify(sq));
  const tap = async (c, r) => { const bb = await p.locator('#board').boundingBox(); await p.mouse.click(bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16); };
  // the panel button, then a squad (round 1 squads are fresh, so their sheets can't be opened)
  // the panel was drawn before Matteo was forced in: pick a shop unit and drop it again to redraw it
  const u = p.locator('[data-i]:not([data-locked])').first(); await u.click(); await sleep(100); await u.click(); await sleep(150);
  console.log('give button:', await p.locator('#charm-btn').count());
  await p.click('#charm-btn'); await sleep(150);
  console.log('hint:', await p.locator('#panel .hint').first().textContent());
  await tap(sq[0].col, sq[0].row); await sleep(200);
  console.log('charm:', JSON.stringify(await p.evaluate(() => { const { m, me } = window.__pb(); return m.armies[me].map(q => q.charm || 0); })), '| take back button:', await p.locator('#charm-undo').count(), '| give button:', await p.locator('#charm-btn').count());
  await p.screenshot({ path: OUT + '/charm-board.png' });
  await p.click('#fight'); await sleep(2500);
  await p.screenshot({ path: OUT + '/charm-battle.png' });
  await p.click('#skip'); await sleep(400);
  console.log('result:', (await p.locator('.card').first().innerText()).replace(/\s+/g, ' ').slice(0, 300));
  console.log('charm after:', JSON.stringify(await p.evaluate(() => { const { m, me } = window.__pb(); return m.armies[me].map(q => q.charm || 0); })));
  await b.close();
})();
