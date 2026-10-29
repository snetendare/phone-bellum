// Sound effects: which sound each action makes (window.__sfxLog; "?" = the sound wasn't loaded yet).
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.addInitScript(() => { window.__sfxLog = []; });
  const log = async (what) => { const l = await p.evaluate(() => window.__sfxLog.splice(0)); console.log(what + ':', l.join(', ') || '(none)'); };
  const tap = (c, r) => ctx2d.tap(p, c, r);
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(800);
  await p.mouse.click(5, 5); await sleep(1500); await log('first tap');
  await p.click('#music-open'); await sleep(200); await log('menu button');
  await p.click('#close'); await sleep(200); await log('close');
  await p.click('#go'); await sleep(1500); await log('start vs AI');
  await p.dblclick('[data-pack="0"]'); await sleep(500); await log('pick package');
  const card = p.locator('.uc2:not([aria-disabled="true"])').first();
  await card.click(); await sleep(200); await log('tap a card');
  await tap(5, 13); await sleep(300); await log('place on own zone');
  await tap(5, 2); await sleep(300); await log('tap enemy zone with a card picked');
  await p.evaluate(() => window.__sfxLog.splice(0));
  const sq = await p.evaluate(() => { const { m, me } = window.__pb(); return m.armies[me].filter(s => s.round === m.round).map(s => [s.col, s.row])[0]; });
  // drag that squad one tile left
  const bb = await p.locator('#board').boundingBox(); const at = (c, r) => [bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16];
  await p.mouse.move(...at(sq[0], sq[1])); await p.mouse.down(); await sleep(100); await p.mouse.move(...at(sq[0] - 1, sq[1]), { steps: 5 }); await p.mouse.up(); await sleep(400);
  await log('drag a squad to another tile');
  await tap(sq[0] - 1, sq[1]); await sleep(400); await log('tap own squad (opens its sheet)');
  const tb = p.locator('#take-back'); if (await tb.count()) { await tb.click(); await sleep(300); await log('take back'); }
  await p.keyboard.press('Escape').catch(() => {}); await p.mouse.click(5, 5); await sleep(200); await p.evaluate(() => window.__sfxLog.splice(0));
  await p.click('#fight'); await sleep(2500); await log('fight');
  await p.click('#cog'); await sleep(300); await p.click('[data-sfx="0"]'); await sleep(200); await p.evaluate(() => window.__sfxLog.splice(0));
  console.log('saved:', await p.evaluate(() => localStorage.getItem('phonebellum.sound.v1')));
  await b.close();
})();
