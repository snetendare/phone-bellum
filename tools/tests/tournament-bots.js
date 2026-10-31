// Practice tournament: Practice vs bots on the start screen makes a tournament of you and 7 bots. Bot against bot is
// played out by the AI on the organizer's phone; your match against a bot is an AI match here, with the tournament's
// settings and the bot's name. Goes through to a champion (forfeiting your own matches).
// Needs: python3 -m http.server 8766 (repo root) and node tools/peer-server.js (port 9000).
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const T = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
  await p.goto('http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000&test');
  await p.click('#tour-practice');
  await p.waitForSelector('#tour-start');
  let t = await T(p);
  ok(t.players.length === 8 && t.players.filter(x => x.bot).length === 7, 'practice: you and 7 bots: ' + t.players.map(x => x.name).join(', '));
  await p.click('#tour-start');
  for (let round = 1; round < 10; round++) {
    await p.waitForSelector('#tour-root');
    t = await T(p);
    if (t.status === 'done') break;
    const r = t.rounds[t.rounds.length - 1];
    const mine = r.matches.find(mt => mt.a === t.org || mt.b === t.org);
    if (mine && mine.b != null && !mine.result) {
      const label = await p.locator('#tour-play').innerText();
      await p.click('#tour-play');
      await p.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 15000 });
      const info = await p.evaluate(() => { const { m } = window.__pb(); return { n: m.packages[0].length, mirror: m.mirror, foe: document.getElementById('foe-name').textContent, clock: document.getElementById('clock').textContent }; });
      if (round === 1) ok(info.mirror && info.n === 3 && /Bot/.test(info.foe) && /\d:\d\d/.test(info.clock), `${label}: AI match with the tournament's rules (${info.n} packages, mirror ${info.mirror}, vs ${info.foe}, clock ${info.clock})`);
      await p.click('#cog'); await p.click('#to-menu'); await p.click('#forfeit-yes');
      await p.waitForSelector('#tour-root');
    }
    await p.waitForFunction(() => { const t = JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t; const r = t.rounds[t.rounds.length - 1]; return r.matches.every(mt => mt.b == null || mt.result); }, null, { timeout: 120000 });
    t = await T(p);
    const rr = t.rounds[t.rounds.length - 1], nm = (id) => (t.players.find(x => x.id === id) || { name: 'bye' }).name;
    console.log(`  ${rr.stage} ${rr.n}: ` + rr.matches.map(mt => mt.b == null ? `${nm(mt.a)} bye` : `${nm(mt.a)} v ${nm(mt.b)} -> ${mt.result.winner} ${mt.result.hp.join('-')} (${mt.result.rounds} rounds)`).join('; '));
    if (await p.isVisible('[data-ttab="matches"]')) await p.click('[data-ttab="matches"]');
    await p.click('#tour-next');
    await sleep(300);
  }
  t = await T(p);
  ok(t.status === 'done' && t.champion, 'champion: ' + (t.players.find(x => x.id === t.champion) || {}).name);
  const botGames = t.rounds.flatMap(r => r.matches).filter(mt => mt.b != null && t.players.find(x => x.id === mt.a).bot && t.players.find(x => x.id === mt.b).bot);
  ok(botGames.every(mt => mt.result && mt.result.rounds > 0), `bot matches played out for real (${botGames.length}, ${botGames.map(mt => mt.result.rounds).join('/')} rounds)`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})();
