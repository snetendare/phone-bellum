// Fight playback: switching away (tab or app) pauses the fight and coming back goes on from where it was, vs the AI and
// in a live match; and in a live match a faster speed takes both players (one asks, the other agrees), a slower one
// takes hold on both at once, and both phones play at the same speed.
// Needs the game on port 8766 and tools/peer-server.js on 9000 (PB_PORT and PB_PEER_PORT change them).
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PORT = process.env.PB_PORT || 8766, PEER = process.env.PB_PEER_PORT || 9000;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); return p; };
  const st = (p) => p.evaluate(() => { const s = window.__pb(); return { phase: s.phase, t: s.bt ? s.bt.time() : null, over: s.bt ? s.bt.isOver() : null, live: s.liveSpeed, speed: s.playSpeed }; });
  // the page goes into the background and comes back (as a phone or a tab switch does it)
  const setHidden = (p, hidden) => p.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const btn = (p, s) => p.evaluate((s) => { const x = document.querySelector(`[data-s="${s}"]`); return x ? { pressed: x.getAttribute('aria-pressed') === 'true', asked: x.classList.contains('asked'), offer: x.classList.contains('offer') } : null; }, s);
  const ask = (p) => p.evaluate(() => { const e = document.getElementById('speed-ask'); return e && !e.hidden ? e.textContent : ''; });

  // ---- vs AI: the fight pauses in the background and goes on from there ----
  {
    const p = await mk('ai');
    await p.goto(`http://127.0.0.1:${PORT}/?test`); await p.click('#go'); await sleep(600);
    await p.dblclick('[data-pack="0"]'); await sleep(300);
    await p.click('#fight'); await sleep(300);
    await p.waitForFunction(() => window.__pb().phase === 'battle', null, { timeout: 5000 });
    await sleep(1200);
    let s = await st(p);
    check(s.phase === 'battle' && s.t > 0.5, `vs AI: the fight plays (${s.t && s.t.toFixed(2)} s)`);
    await setHidden(p, true); const t0 = (await st(p)).t;
    await sleep(1500);
    s = await st(p);
    check(s.phase === 'battle' && !s.over && Math.abs(s.t - t0) < 1e-9, `vs AI: in the background the fight waits (still ${s.t.toFixed(2)} s, not skipped to the result)`);
    await setHidden(p, false); await sleep(800);
    s = await st(p);
    check(s.phase === 'battle' && s.t > t0 && s.t < t0 + 2.5, `vs AI: back again it goes on from there (${t0.toFixed(2)} -> ${s.t.toFixed(2)} s)`);
    await p.click('[data-s="2"]'); await sleep(100);
    check((await st(p)).speed === 2 && (await btn(p, 2)).pressed, 'vs AI: 2x takes at once, no asking');
    await p.close();
  }

  // ---- a live match ----
  const BASE = `http://127.0.0.1:${PORT}/?peerhost=127.0.0.1&peerport=${PEER}&test`;
  const host = await mk('host'), guest = await mk('guest');
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto((await host.locator('#link').textContent()) + '&test');
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 10000 });
  for (const pg of [host, guest]) { await pg.dblclick('[data-pack="0"]'); await sleep(300); }
  await guest.click('#ready'); await sleep(300); await host.click('#ready');
  for (const pg of [host, guest]) await pg.waitForFunction(() => window.__pb().phase === 'battle', null, { timeout: 8000 });
  await sleep(300);
  let h = await st(host), g = await st(guest);
  check(h.speed === 1 && g.speed === 1, 'live: both start at 1x');
  // the host asks for 2x: nothing changes until the guest agrees
  await host.click('[data-s="2"]'); await sleep(500);
  h = await st(host); g = await st(guest);
  check(h.speed === 1 && g.speed === 1, `live: a faster pick alone changes nothing (${h.speed}, ${g.speed})`);
  check((await btn(host, 2)).asked && /You asked for 2×/.test(await ask(host)), `live: the host sees its request waiting ("${await ask(host)}")`);
  check((await btn(guest, 2)).offer && /Opponent wants 2×/.test(await ask(guest)), `live: the guest sees it, the 2x button glowing ("${await ask(guest)}")`);
  await guest.click('[data-s="2"]'); await sleep(500);
  h = await st(host); g = await st(guest);
  check(h.speed === 2 && g.speed === 2 && (await btn(host, 2)).pressed && (await btn(guest, 2)).pressed && !(await ask(host)) && !(await ask(guest)), 'live: the guest agrees: both play at 2x');
  // both phones keep the same pace
  const a0 = [(await st(host)).t, (await st(guest)).t]; await sleep(1500); const a1 = [(await st(host)).t, (await st(guest)).t];
  const rate = [a1[0] - a0[0], a1[1] - a0[1]];
  check(!(await st(host)).over && Math.abs(rate[0] - rate[1]) < 0.6, `live: both phones play at the same speed (${rate.map(x => x.toFixed(2)).join(' / ')} s of fight in 1.5 s)`);
  // slowing down: at once, for both
  await guest.click('[data-s="1"]'); await sleep(500);
  h = await st(host); g = await st(guest);
  check(h.speed === 1 && g.speed === 1, 'live: a slower pick slows both at once');
  check((await btn(host, 2)).asked && /Opponent wants 2×/.test(await ask(guest)), 'live: the host\'s 2x stays asked, the guest sees it again');
  // the guest goes into the background: its replay waits, the host's goes on; back again it goes on from there
  await setHidden(guest, true); const gt0 = (await st(guest)).t, ht0 = (await st(host)).t;
  await sleep(1200);
  g = await st(guest); h = await st(host);
  check(g.phase === 'battle' && Math.abs(g.t - gt0) < 1e-9 && (h.t > ht0 || h.phase !== 'battle'), `live: the guest's fight waits in the background (${g.t.toFixed(2)} s), the host's goes on (${h.t != null ? h.t.toFixed(2) : h.phase})`);
  await setHidden(guest, false); await sleep(600);
  g = await st(guest);
  check(g.phase === 'battle' && g.t > gt0 && g.t < gt0 + 2, `live: back again, the guest's fight goes on from there (${gt0.toFixed(2)} -> ${g.t.toFixed(2)} s)`);
  // a long time away in a live match: the rest is played out on return, so the other player doesn't wait long
  await setHidden(guest, true);
  await guest.evaluate(() => { window.__pb().away.at -= 60000; });
  await setHidden(guest, false); await sleep(400);
  g = await st(guest);
  check(g.phase === 'result' || g.phase === 'end', `live: back after more than a while away, the guest's fight is played out (${g.phase})`);
  // and the next round starts for both as usual (the host plays its fight out the same way)
  if ((await st(host)).phase === 'battle') { await setHidden(host, true); await host.evaluate(() => { window.__pb().away.at -= 60000; }); await setHidden(host, false); }
  await host.waitForFunction(() => window.__pb().phase === 'result', null, { timeout: 5000 });
  await guest.click('#next'); await host.click('#next');
  for (const pg of [host, guest]) await pg.waitForFunction(() => window.__pb().phase === 'deploy' && window.__pb().m.round === 2, null, { timeout: 8000 });
  check(true, 'live: round 2 starts on both');
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
