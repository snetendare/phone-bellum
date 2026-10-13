const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  let box, tap = async (pg, bx, c, r) => { const b2 = await pg.locator('#board').boundingBox(); return pg.mouse.click(b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16); };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // 1) vs AI: placement flow
  const p = await ctx.newPage(); if (process.env.SKIPAI) { } else {
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.goto('http://127.0.0.1:8766/'); await p.waitForTimeout(500);
  await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(300);
  box = await p.locator('#board').boundingBox();
  console.log('hint:', (await p.locator('#panel .hint').first().textContent()));
  console.log('goblin card disabled:', await p.locator('.ucard >> nth=0').getAttribute('aria-disabled'));
  await p.screenshot({ path: 'tw-1-place.png' });
  await tap(p, box, 5, 15); console.log('after middle tap still placing:', (await p.locator('#panel .hint').first().textContent()).startsWith('First'));
  await tap(p, box, 1, 15); console.log('after side tap hint:', await p.locator('#panel .hint').first().textContent());
  await tap(p, box, 1, 15); console.log('picked up again:', (await p.locator('#panel .hint').first().textContent()).startsWith('First'));
  await tap(p, box, 10, 14);
  await p.click('.ucard >> nth=0'); await tap(p, box, 10, 11);
  await p.click('.ucard >> nth=1'); await tap(p, box, 5, 13);
  await p.screenshot({ path: 'tw-2-deployed.png' });
  await p.click('#fight'); await p.waitForTimeout(2500); await p.screenshot({ path: 'tw-3-battle.png' });
  await p.click('#skip').catch(() => {}); await p.waitForTimeout(400);
  console.log('result:', (await p.locator('#overlay').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  await p.click('#next'); await p.waitForTimeout(300);
  console.log('round 2 hint:', await p.locator('#panel .hint').first().textContent());
  box = await p.locator('#board').boundingBox();
  await tap(p, box, 10, 14); await p.waitForTimeout(300);
  console.log('tower sheet:', (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ').slice(0, 200));
  await p.screenshot({ path: 'tw-4-round2.png' }); }
  // 2) mocked Claude: flank their tower
  const q = await ctx.newPage();
  q.on('pageerror', e => console.log('PAGE2 ERROR', e.message));
  q.on('console', m => { if (m.text().startsWith('PROMPT')) require('fs').writeFileSync('tw-prompt.txt', m.text().slice(7)); });
  await q.addInitScript(() => {
    const answer = (prompt) => { console.log('PROMPT ' + prompt); return Promise.resolve({ tower: { col: 1, row: 0 }, place: [{ unit: 'Fire Mage', col: 6, row: 3 }, { unit: 'Goblin Swarm', col: 7, row: 4 }], say: 'Come at me.' }); };
    const fn = (pr) => answer(pr).then(o => ({ text: JSON.stringify(o) })); fn.json = answer;
    const db = { doc: () => ({ set: async () => {} }) };
    window.claude = { use: async (n) => n === 'sample' ? fn : n === 'db' ? db : null };
  });
  await q.goto('http://127.0.0.1:8766/'); await q.waitForTimeout(800);
  await q.click('[data-tm="0"]'); await q.click('#vs-claude'); await q.waitForTimeout(500);
  box = await q.locator('#board').boundingBox();
  await tap(q, box, 10, 15); await q.waitForTimeout(300);
  console.log('claude-mode hint after tower tap:', await q.locator('#panel .hint').first().textContent());
  await q.screenshot({ path: 'tw-c-pre.png' });
  const cards = await q.$$eval('.ucard', cs => cs.map(c => c.textContent));
  const bi = cards.findIndex(t => /Brute/.test(t));
  await q.click(`.ucard >> nth=${bi}`); console.log('bi', bi, 'after card:', await q.locator('#panel .hint').first().textContent());
  console.log('elem at point:', await q.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.className || e.tagName); }, [box.x + 0.5 * box.width / 12, box.y + 11.5 * box.height / 16]), JSON.stringify(box));
  await tap(q, box, 0, 11); console.log('after tap:', await q.locator('#panel .hint').first().textContent(), await q.locator('.gold').first().textContent());
  await q.click('.ucard >> nth=0'); await tap(q, box, 1, 11);
  await q.click('#fight');
  for (let k = 0; k < 12; k++) { await q.waitForTimeout(1500); await q.screenshot({ path: `tw-c-${k}.png` }); if (await q.locator('#overlay:not([hidden])').count()) break; }
  console.log('claude result:', (await q.locator('#overlay').innerText()).replace(/\s+/g, ' ').slice(0, 200));
  await b.close();
})();
