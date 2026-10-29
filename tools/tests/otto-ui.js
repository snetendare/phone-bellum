// Otto - The Gambler (2026-10-29): the Slots button opens the slot machine, a spin pays out, the reels and crest draw
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); bad++; });
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(800);
  await p.mouse.click(5, 5); await sleep(500);
  await p.click('[data-pack="all"]'); await sleep(200);
  await p.click('#go'); await sleep(1500);
  await p.dblclick('[data-pack="0"]'); await sleep(500);
  await p.evaluate(() => { const { m, me } = window.__pb(); m.chars[me] = 'otto'; m.gold[me] = 1000; });
  await p.locator('.uc2').first().click(); await sleep(100); await p.locator('.uc2').first().click(); await sleep(200); // refresh the panel
  ok(await p.locator('#slot-open').count() === 1, 'Slots button in the tray');
  await p.click('#slot-open'); await sleep(300);
  ok(await p.locator('#reels .reel svg').count() === 3, 'three reels');
  await p.screenshot({ path: process.argv[2] || 'otto-sheet.png' });
  const before = await p.evaluate(() => { const { m, me } = window.__pb(); return { g: m.gold[me], hp: m.hp[me] }; });
  await p.click('#slot-spin'); await sleep(2200);
  const after = await p.evaluate(() => { const { m, me } = window.__pb(); return { g: m.gold[me], hp: m.hp[me], n: Game.slotSpins(m, me).length, rec: Game.slotSpins(m, me)[0] }; });
  ok(after.n === 1, 'one spin recorded: ' + JSON.stringify(after.rec));
  const exp = { coin: 50, chest: 450 }[after.rec.win] ?? -50;
  ok(after.g - before.g === exp, `gold ${before.g} -> ${after.g}`);
  ok(/spin|luck|Winner|Ouch/i.test(await p.textContent('#slot-res')), 'result line: ' + await p.textContent('#slot-res'));
  await p.click('#slot-spin'); await sleep(2200); await p.click('#slot-spin'); await sleep(2200);
  ok(await p.locator('#slot-spin[disabled]').count() === 1, 'no 4th spin');
  await p.screenshot({ path: (process.argv[2] || 'otto-sheet.png').replace('.png', '-2.png') });
  await b.close(); process.exit(bad ? 1 : 0);
})();
