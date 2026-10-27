// Matteo in a live match: the guest gives the first Charisma stack, the host takes it, and the stacks after the
// fight (worked out on the host) reach the guest. The host's stack given this round stays hidden from the guest.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage(); p.on('pageerror', e => console.log(`[${n}] PAGE ERROR`, e.message)); return p; };
  const host = await mk('host'), guest = await mk('guest');
  const BASE = 'http://127.0.0.1:8766/?test&peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto((await host.locator('#link').textContent()).replace('?', '?test&'));
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  await sleep(300);
  await host.dblclick('[data-pack="0"]'); await guest.dblclick('[data-pack="0"]'); await sleep(600);
  // both players are Matteo (forced on both phones)
  for (const p of [host, guest]) await p.evaluate(() => { const { m } = window.__pb(); m.chars = ['matteo', 'matteo']; });
  const redraw = async (p) => { const u = p.locator('[data-i]:not([data-locked])').first(); await u.click(); await sleep(80); await p.click('#task-x'); await sleep(150); };
  await redraw(host); await redraw(guest);
  const giveFirst = async (p) => {
    const sq = await p.evaluate(() => { const { m, me } = window.__pb(); return m.armies[me][0]; });
    await p.click('#charm-btn'); await sleep(100);
    const bb = await p.locator('#board').boundingBox(), flip = await p.evaluate(() => window.__pb().me === 1);
    const c = flip ? 11 - sq.col : sq.col, r = flip ? 15 - sq.row : sq.row;
    await p.mouse.click(bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16); await sleep(300);
    return sq.id;
  };
  console.log('host gave to', await giveFirst(host), '| guest gave to', await giveFirst(guest));
  await sleep(800);
  console.log('host sees guest charm:', JSON.stringify(await host.evaluate(() => window.__pb().m.armies[1].map(q => [q.id, q.charm || 0]))));
  console.log('guest sees host charm:', JSON.stringify(await guest.evaluate(() => window.__pb().m.armies[0].map(q => [q.id, q.charm || 0]))));
  await guest.click('#ready'); await host.click('#ready');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 5000 });
  await host.click('#skip').then(() => host.click('#skip')).catch(() => {}); await guest.click('#skip').then(() => guest.click('#skip')).catch(() => {}); await sleep(600);
  const hs = await host.evaluate(() => window.__pb().m.armies.map(a => a.map(q => q.charm || 0)));
  const gs = await guest.evaluate(() => window.__pb().m.armies.map(a => a.map(q => q.charm || 0)));
  console.log('after fight host:', JSON.stringify(hs), '| guest:', JSON.stringify(gs), JSON.stringify(hs) === JSON.stringify(gs) ? 'SAME' : 'DIFFERENT');
  await b.close();
})();
