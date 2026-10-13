const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const tap = async (c, r) => { const b2 = await p.locator('#board').boundingBox(); await p.mouse.click(b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16); };
  const squads = async () => (await p.locator('#panel .hint').last().textContent());
  await p.goto('http://127.0.0.1:8766/'); await p.waitForTimeout(500);
  await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(300);
  await tap(1, 15);
  await p.click('.ucard >> nth=1'); await tap(5, 13);
  for (let round = 1; round <= 2; round++) {
    if (round === 2) { await p.click('.ucard >> nth=0'); await tap(0, 3); console.log('round 2 flank tap ->', await squads()); }
    await p.click('#fight'); await p.waitForTimeout(400); await p.click('#skip'); await p.waitForTimeout(300); await p.click('#next'); await p.waitForTimeout(300);
  }
  console.log('round 3 hint:', await p.locator('#panel .hint').first().textContent());
  await p.click('.ucard >> nth=0'); await tap(0, 13); await p.waitForTimeout(200); console.log('own edge tile ->', await squads()); await tap(0, 6); await p.waitForTimeout(200); await tap(11, 1); await p.screenshot({ path: 'flank-enemyzone.png' }); await p.waitForTimeout(200);
  console.log('after flank tap ->', await squads(), '| gold', await p.locator('.gold').first().textContent());
  await p.click('#fight'); await p.waitForTimeout(1200); await p.screenshot({ path: 'flank-mirror.png' });
  await b.close();
})();
