// Move ability sounds (2026-10-29): a paid move makes the buy sound, a drag that can't move makes "nope";
// also checks the unlock sheet has a text for every unit and the Keep shows no +1 button.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); bad++; });
  await p.addInitScript(() => { window.__sfxLog = []; });
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(800);
  await p.mouse.click(5, 5); await sleep(500);
  await p.click('[data-pack="all"]'); await sleep(200);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('pb-off-chars') || '[]').length === 0), 'All units: every leader in');
  await p.click('#go'); await sleep(1500);
  await p.dblclick('[data-pack="0"]'); await sleep(500);
  // unlock sheets: no empty texts
  const tiers = await p.locator('[data-add]').count();
  let empty = [];
  for (let k = 0; k < tiers; k++) {
    await p.locator('[data-add]').nth(k).click(); await sleep(200);
    empty = empty.concat(await p.$$eval('#sheet .info2', bs => bs.filter(b => !b.querySelector('span').textContent.replace(/[.\s]/g, '')).map(b => b.querySelector('b').textContent)));
    await p.click('#close'); await sleep(150);
  }
  ok(tiers > 0 && empty.length === 0, `unlock sheets have texts (${tiers} tiers)${empty.length ? ': missing ' + empty.join(', ') : ''}`);
  // a squad, then a fight, then round 2
  await p.locator('.uc2:not([aria-disabled="true"])').first().click(); await sleep(200);
  await ctx2d.tap(p, 5, 13); await sleep(300);
  await p.evaluate(() => { const { m } = window.__pb(); });
  await p.click('#fight'); await sleep(500);
  for (let i = 0; i < 120; i++) { const ph = await p.evaluate(() => document.querySelector('#next, #continue') ? 1 : 0); if (ph) break; await sleep(500); }
  const nx = p.locator('#next, #continue').first(); if (await nx.count()) await nx.click(); await sleep(1500);
  const r = await p.evaluate(() => { const { m, me } = window.__pb(); const s = m.armies[me].find(q => q.round < m.round); return s && { round: m.round, col: s.col, row: s.row, flip: me === 1 }; });
  if (!r) { ok(false, 'no older squad in round 2'); await b.close(); process.exit(1); }
  const bb = await p.locator('#board').boundingBox(); const at = (c, rr) => [bb.x + (c + .5) * bb.width / 12, bb.y + (rr + .5) * bb.height / 16];
  const free = await p.evaluate(() => { const { m, me } = window.__pb(); for (let c = 0; c < 12; c++) for (const rr of [12, 13, 14, 15, 11, 10]) if (!m.armies[me].some(s => s.col === c && s.row === rr) && Game.canPlaceAt(m, me, c, rr, 0)) return [c, rr]; });
  const drag = async (from, to) => { await p.mouse.move(...at(...from)); await p.mouse.down(); await sleep(80); await p.mouse.move(...at(...to), { steps: 6 }); await p.mouse.up(); await sleep(400); };
  // no gold: nope, nothing moves
  const gold = await p.evaluate(() => { const { m, me } = window.__pb(); const g = m.gold[me]; m.gold[me] = 0; return g; });
  await p.evaluate(() => window.__sfxLog.splice(0));
  await drag([r.col, r.row], free);
  let log = await p.evaluate(() => window.__sfxLog.splice(0).map(s => s.replace('?', '')));
  ok(log.includes('nope') && await p.evaluate((rr) => { const { m, me } = window.__pb(); return m.armies[me].some(s => s.col === rr.col && s.row === rr.row); }, r), 'drag with no gold: nope, stays put (' + log.join(', ') + ')');
  await p.evaluate((g) => { const { m, me } = window.__pb(); m.gold[me] = g; }, gold);
  await drag([r.col, r.row], free);
  log = await p.evaluate(() => window.__sfxLog.splice(0).map(s => s.replace('?', '')));
  ok(log.includes('skill'), 'paid move: buy sound (' + log.join(', ') + ')');
  await b.close(); process.exit(bad ? 1 : 0);
})();
