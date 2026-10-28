// Selling in a live match: a squad the guest sells stays on the host's board until the fight (the host takes the guest's
// army as sent, so the sale has to be noted there), and one the host sells stays on the guest's board, also after the
// guest reloads the page and rejoins. Gone for both once the fight starts.
// Needs the peer server (node tools/peer-server.js, port 9000) and the game on port 8766.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const errors = [];
  const ctxs = {};
  const mk = async (n) => { const c = ctxs[n] = await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }); const p = await c.newPage(); p.on('pageerror', e => { errors.push(e.message); console.log(`[${n}] PAGE ERROR`, e.message); }); return p; };
  const host = await mk('host');
  let guest = await mk('guest');
  const BASE = 'http://127.0.0.1:8766/?test&peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  const link = (await host.locator('#link').textContent()).replace('?', '?test&');
  await guest.goto(link);
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  await sleep(300);
  await host.dblclick('[data-pack="0"]'); await guest.dblclick('[data-pack="0"]'); await sleep(600);
  // round 1's fight, then round 2
  await guest.click('#ready'); await host.click('#ready');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 8000 });
  for (const p of [host, guest]) await p.click('#skip').then(() => p.click('#skip')).catch(() => {});
  await sleep(800);
  for (const p of [host, guest]) await p.click('#next').catch(() => {});
  await guest.waitForFunction(() => window.__pb().phase === 'deploy' && window.__pb().m.round === 2, null, { timeout: 10000 });
  await host.waitForFunction(() => window.__pb().phase === 'deploy' && window.__pb().m.round === 2, null, { timeout: 10000 });
  await sleep(300);
  // where a squad of `side` is drawn on page p (the guest's board is turned around)
  const tileOf = async (p, sq) => { const flip = await p.evaluate(() => window.__pb().me === 1); return [flip ? 11 - sq.col : sq.col, flip ? 15 - sq.row : sq.row]; };
  const shot = async (p, [c, r]) => { const bb = await p.locator('#board').boundingBox(); return p.screenshot({ clip: { x: bb.x + c * bb.width / 12, y: bb.y + r * bb.height / 16, width: bb.width / 12, height: bb.height / 16 } }); };
  const sellOwn = async (p) => {
    const sq = await p.evaluate(() => { const { m, me } = window.__pb(); return m.armies[me].find(q => q.round < m.round && !Game.isRider(q) && q.in == null); });
    assert.ok(sq, 'a squad from round 1 to sell');
    await ctx2d.tap(p, ...(await tileOf(p, sq))); await sleep(250);
    await p.click('[data-act="sell"]'); await sleep(80); await p.click('[data-act="sell"]'); await sleep(400);
    assert.ok(await p.evaluate((id) => { const { m, me } = window.__pb(); return !m.armies[me].some(q => q.id === id); }, sq.id), 'sold');
    return sq;
  };

  // the guest sells: the host still sees it
  const gs = await guest.evaluate(() => { const { m } = window.__pb(); return m.armies[1].find(q => q.round < m.round && !Game.isRider(q) && q.in == null); });
  const hostTile = await tileOf(host, gs), before = await shot(host, hostTile);
  const sold1 = await sellOwn(guest);
  assert.strictEqual(sold1.id, gs.id);
  await host.waitForFunction((id) => !window.__pb().m.armies[1].some(q => q.id === id), sold1.id, { timeout: 5000 });
  await sleep(300);
  const h = await host.evaluate((id) => { const { m } = window.__pb(); return { shown: Game.shownArmy(m, 1).some(q => q.id === id) }; }, sold1.id);
  assert.ok(h.shown, 'the host keeps the guest\'s sold squad on its board');
  assert.ok(before.equals(await shot(host, hostTile)), 'drawn on the host\'s board as before');
  console.log('guest sold', sold1.id, '-> host still shows it');

  // the host sells: the guest still sees it, also after reloading and rejoining
  const hs = await host.evaluate(() => { const { m } = window.__pb(); return m.armies[0].find(q => q.round < m.round && !Game.isRider(q) && q.in == null); });
  const gTile = await tileOf(guest, hs), gBefore = await shot(guest, gTile);
  const sold0 = await sellOwn(host);
  await sleep(300);
  assert.ok(gBefore.equals(await shot(guest, gTile)), 'the guest\'s board as before');
  await guest.close();
  guest = await ctxs.guest.newPage(); guest.on('pageerror', e => { errors.push(e.message); console.log('[guest] PAGE ERROR', e.message); });
  await guest.goto(link);
  await guest.waitForFunction(() => { const x = window.__pb && window.__pb(); return x && x.phase === 'deploy' && x.m && x.m.round === 2; }, null, { timeout: 20000 });
  await sleep(500);
  const g = await guest.evaluate((id) => { const { m } = window.__pb(); return m.armies[0].some(q => q.id === id); }, sold0.id);
  assert.ok(g, 'after rejoining, the guest still has the host\'s sold squad on the board');
  assert.ok(gBefore.equals(await shot(guest, gTile)), 'drawn as before');
  console.log('host sold', sold0.id, '-> guest still shows it, after a rejoin too');

  // the fight: gone on both
  await guest.click('#ready'); await host.click('#ready');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 8000 });
  await sleep(300);
  const inFight = await Promise.all([host, guest].map(p => p.evaluate((ids) => window.__pb().bt.bodies.some(x => (x.side === 1 && x.squad === ids[1]) || (x.side === 0 && x.squad === ids[0])), [sold0.id, sold1.id])));
  assert.deepStrictEqual(inFight, [false, false], 'no sold squad in the fight');
  assert.deepStrictEqual(errors, []);
  console.log('sold mp ok');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
