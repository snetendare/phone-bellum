// Knockout best of 3, the bracket and spectating: 4 players, Bo3 knockout. A big-screen viewer sees the bracket and
// watches a semifinal: the board while they deploy (without the squads placed this round), the fight itself and the
// result. Each game of a series is its own match with its own code; the series ends at 2 wins.
// Needs: python3 -m http.server 8766 (repo root) and node tools/peer-server.js (port 9000).
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000&test';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const T = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t);
const phaseIs = (p, ph, ms = 20000) => p.waitForFunction((ph) => document.getElementById('phase').textContent === ph, ph, { timeout: ms });
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n, w = 390, h = 844) => { const p = await (await ctx2d(b, { viewport: { width: w, height: h } })).newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); return p; };
  const text = (p, sel) => p.locator(sel).first().innerText().then(t => t.replace(/\s+/g, ' ').trim());
  const org = await mk('org');
  await org.goto(BASE); await org.click('#tour-new'); await org.waitForSelector('#tour-link');
  const link = await text(org, '#tour-link');
  const ps = [];
  for (const n of ['Otto', 'Mira', 'Kalle']) { const p = await mk(n); ps.push(p); p.nm = n; await p.goto(link + '&test'); await p.waitForSelector('#tour-name', { timeout: 15000 }); await p.fill('#tour-name', n); await p.click('#tour-name-ok'); }
  org.nm = 'Organizer';
  await org.waitForFunction(() => document.querySelectorAll('.tour-list li').length === 4, null, { timeout: 15000 });
  await org.click('[data-ttab="settings"]');
  await org.click('[data-tset="format"][data-v="elim"]');
  await org.click('[data-tset="bestOf"][data-v="3"]');
  await sleep(300);
  ok((await T(org)).settings.bestOf === 3, 'knockout, best of 3');
  await org.click('[data-ttab="players"]'); await org.click('#tour-start');
  await sleep(800);
  let t = await T(org);
  ok(t.rounds[0].matches.every(mt => mt.bo === 3), 'semifinals are best of 3');
  // the big screen: bracket with Final TBD
  const tv = await mk('tv', 1280, 800);
  await tv.goto(link + '&watch=1&test');
  await tv.waitForSelector('.tbr svg', { timeout: 15000 });
  const svgText = await tv.locator('.tbr svg').first().textContent();
  ok(/Semifinals/i.test(svgText) && /Final/.test(svgText) && /TBD/.test(svgText), 'big screen shows the bracket: ' + svgText.slice(0, 120));
  // the semifinal without the organizer gets watched
  const all = [org, ...ps], byId = new Map(t.players.map(p => [p.id, p.name]));
  const semi = t.rounds[0].matches.find(mt => mt.a !== t.org && mt.b !== t.org) || t.rounds[0].matches[0];
  const hostName = byId.get(semi[semi.host]), guestName = byId.get(semi[semi.host === 'a' ? 'b' : 'a']);
  const host = all.find(p => p.nm === hostName), guest = all.find(p => p.nm === guestName);
  // the TV page shows no tabs in its card; the panel has Matches
  await tv.click('[data-ttab="matches"]');
  await tv.click(`[data-watch="${semi.id}"]`);
  await tv.waitForFunction(() => /Spectating/.test(document.getElementById('overlay').textContent), null, { timeout: 5000 });
  ok(true, 'spectator waiting: ' + await text(tv, '#overlay'));
  await host.click('#tour-play'); await sleep(400); await guest.click('#tour-play');
  await phaseIs(host, 'Deploy'); await phaseIs(guest, 'Deploy');
  await phaseIs(tv, 'Deploy');
  ok((await text(tv, '#you-name')).toLowerCase() === hostName.toLowerCase() && (await text(tv, '#foe-name')).toLowerCase() === guestName.toLowerCase(), `spectator HUD: ${await text(tv, '#you-name')} vs ${await text(tv, '#foe-name')}`);
  await host.dblclick('[data-pack="0"]'); await guest.dblclick('[data-pack="0"]'); await sleep(1500);
  const seen = await tv.evaluate(() => { const { m } = window.__pb(); return [m.armies[0].length, m.armies[1].length]; });
  const real = await host.evaluate(() => { const { m } = window.__pb(); return [m.armies[0].length, m.armies[1].length]; });
  ok(seen[0] === 0 && seen[1] === 0 && real[0] > 0, `spectator doesn't see this round's squads (sees ${seen}, the host has ${real})`);
  ok(!(await tv.isVisible('#ready')) && !(await tv.isVisible('#fight')), 'spectator has no controls');
  await guest.click('#ready'); await host.click('#ready');
  await phaseIs(tv, 'Battle', 15000);
  ok(true, 'spectator watches the fight');
  await tv.waitForFunction(() => /round 1/i.test(document.getElementById('overlay').textContent), null, { timeout: 90000 });
  ok(true, 'spectator result: ' + await text(tv, '#overlay h2'));
  await tv.click('#spec-leave');
  // game 1: the guest forfeits; game 2 gets a new code
  await host.waitForFunction(() => ['Result', 'Match over'].includes(document.getElementById('phase').textContent), null, { timeout: 90000 });
  if (await guest.isVisible('#cog')) { await guest.click('#cog'); await guest.click('#to-menu'); await guest.click('#forfeit-yes'); }
  await org.waitForFunction((id) => { const t = JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t; return t.rounds[0].matches.find(mt => mt.id === id).games.length === 1; }, semi.id, { timeout: 15000 });
  t = await T(org); const s1 = t.rounds[0].matches.find(mt => mt.id === semi.id);
  ok(s1.code !== semi.code && !s1.result, `game 1 in (${s1.games.map(g => g.winner)}), game 2 has a new code`);
  for (const p of [host, guest]) { if (await p.isVisible('#menu')) await p.click('#menu'); if (await p.isVisible('#again')) await p.click('#again'); }
  await guest.waitForFunction(() => /Game 2/.test(document.getElementById('tour-root').textContent), null, { timeout: 10000 });
  ok(true, 'guest card: ' + await text(guest, '#tour-root h2'));
  await host.click('#tour-play'); await sleep(400); await guest.click('#tour-play');
  await phaseIs(host, 'Deploy'); await phaseIs(guest, 'Deploy');
  await guest.click('#cog'); await guest.click('#to-menu'); await guest.click('#forfeit-yes');
  await org.waitForFunction((id) => !!JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t.rounds[0].matches.find(mt => mt.id === id).result, semi.id, { timeout: 15000 });
  t = await T(org); const s2 = t.rounds[0].matches.find(mt => mt.id === semi.id);
  ok(s2.result.score.join('-') === (semi.host === 'a' ? '2-0' : '0-2'), `series over ${s2.result.score.join('-')}, ${byId.get(s2[s2.result.winner])} goes through`);
  // the other semifinal: the organizer sets it game by game
  await org.click('[data-ttab="matches"]');
  const other = t.rounds[0].matches.find(mt => mt.id !== semi.id);
  await org.click(`[data-res="${other.id}:a"]`); await sleep(200); await org.click(`[data-res="${other.id}:a"]`); await sleep(300);
  t = await T(org);
  ok(t.rounds[0].matches.every(mt => mt.result), 'organizer settled the other semifinal 2-0');
  for (const p of ps) { if (await p.isVisible('#menu')) await p.click('#menu'); if (await p.isVisible('#again')) await p.click('#again'); }
  const loser = all.find(p => p.nm === guestName);
  await loser.waitForSelector('.tbr svg', { timeout: 10000 });
  ok(true, 'between rounds the bracket comes up by itself: ' + (await loser.locator('.tbr svg').first().textContent()).slice(0, 100));
  await org.click('#tour-next'); await sleep(500);
  await tv.waitForFunction(() => /playing|game 1/.test(document.querySelector('.tbr svg').textContent), null, { timeout: 10000 });
  ok(true, 'big screen: the final is on: ' + (await tv.locator('.tbr svg').first().textContent()).slice(0, 140));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})();
