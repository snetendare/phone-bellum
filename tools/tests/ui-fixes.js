// UI fixes 2026-10-28: Flanks open banner (round 3), + ALL level button, Undo all, Look at board shows the last
// fight's starting board, music sheet without the long text. Run with the repo root served on 8766.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = process.env.SHOTS || '/tmp';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8766/?test'); await p.click('#go'); await sleep(800);
  // pick the first package
  const pk = p.locator('#pick button[data-pack], #pick .pack, [data-pack]').first();
  if (await pk.count()) { await pk.click(); await sleep(300); }
  const conf = p.locator('#pick-go, [data-act="pick-go"]').first(); if (await conf.count()) { await conf.click().catch(() => {}); await sleep(300); }
  const st = () => p.evaluate(() => { const { m, me, phase } = window.__pb(); return { round: m.round, phase, gold: m.gold[me], n: m.armies[me].length, needsPack: !!(m.pack && m.pack[me] == null) }; });
  console.log('start', await st());
  // fight rounds until round 3 by pressing Fight and skipping
  for (let r = 0; r < 2; r++) {
    await p.evaluate(() => { const t = document.querySelector('#tpick button, [data-tower]'); if (t) t.click(); });
    await p.click('#fight'); await p.waitForFunction(() => window.__pb().phase === 'result' || window.__pb().phase === 'end', null, { timeout: 120000 });
    await sleep(300);
    const nx = p.locator('#next'); if (await nx.count()) await nx.click();
    await p.waitForFunction(() => window.__pb().phase === 'deploy', null, { timeout: 20000 }).catch(() => {});
    console.log('after fight', r + 1, await st());
  }
  await sleep(400);
  // round 3: choose a tower first (the banner comes after)
  await p.locator('#pick button').first().click().catch(() => {}); await sleep(200);
  await p.locator('#pick button:has-text("Choose")').click().catch(() => {}); await sleep(600);
  const ban = await p.evaluate(() => { const e = document.getElementById('banner'); return e && !e.hidden ? e.innerText : null; });
  console.log('round 3 banner:', JSON.stringify(ban));
  await p.screenshot({ path: OUT + '/banner.png' });
  // Undo all: buy something, check the button, undo
  const before = await st();
  await p.evaluate(() => { const { m, me } = window.__pb(); m.gold[me] += 2000; window.__pbRedraw(); });
  const card = p.locator('.uc2:not([disabled])').first();
  const g0 = (await st()).gold;
  await p.evaluate(() => { const c = document.querySelector('.uc2'); }); 
  // place via the game API through the page: tap a card then a tile
  await card.click(); await sleep(200);
  const box = await p.locator('#board').boundingBox();
  await p.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.88); await sleep(300);
  const mid = await st();
  console.log('placed:', mid.n > before.n, 'gold', g0, '->', mid.gold, '| Undo all shown:', await p.isVisible('#undo-all'));
  await p.screenshot({ path: OUT + '/undo.png' });
  if (await p.isVisible('#undo-all')) { await p.click('#undo-all'); await sleep(300); }
  const aft = await st();
  console.log('after undo all: squads', aft.n, '(was', before.n + ')', 'gold', aft.gold, '(was', g0 + ')', '| button gone:', !(await p.isVisible('#undo-all')));
  // + ALL: give XP to two squads, open a sheet
  const lv = await p.evaluate(() => { const { m, me } = window.__pb(); const by = {}; for (const s of m.armies[me]) (by[s.unit] = by[s.unit] || []).push(s); const u = Object.keys(by).find(k => by[k].length >= 2); if (u == null) return null; for (const s of by[u]) s.xp = 1e6; window.__pbRedraw(); return +u; });
  console.log('unit with 2+ squads:', lv);
  // end the match: set foe hp low and fight
  await p.evaluate(() => { const { m, me } = window.__pb(); m.hp[1 - me] = 1; m.hp[me] = 1; window.__pbRedraw(); });
  await p.click('#fight'); await p.waitForFunction(() => window.__pb().phase === 'end', null, { timeout: 120000 }).catch(() => {});
  await sleep(500);
  console.log('phase', (await st()).phase);
  if (await p.isVisible('#look')) {
    await p.click('#look'); await sleep(400);
    const v = await p.evaluate(() => document.querySelector('#panel .hint') && document.querySelector('#panel .hint').innerText);
    console.log('look note:', v);
    await p.screenshot({ path: OUT + '/look.png' });
  }
  // music sheet
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(500);
  const mb = p.locator('#music, button:has-text("Music")').first(); if (await mb.count()) { await mb.click(); await sleep(300); await p.screenshot({ path: OUT + '/music.png' }); console.log('music sheet text:', (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ').slice(0, 300)); }
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
})();
