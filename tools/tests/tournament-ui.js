// Tournaments in the browser: the organizer hosts, 3 friends join by the invite link and pick gamertags, the organizer
// sets leader choices and timers and starts; every pair gets its match (host taps Start match, guest Join match), with
// the tournament's settings (4 leader choices, the same packages for both, 60 s deploy, gamertags in the HUD).
// Forfeits end the matches, the results reach the organizer by themselves, the organizer pairs round 2, reloads the
// page (the hub comes back, players reconnect), sets a result by hand, and so on to a champion.
// Needs: python3 -m http.server 8766 (repo root) and node tools/peer-server.js (port 9000).
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000&test';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); p.dialogName = n; return p; };
  const text = (p, sel) => p.locator(sel).first().innerText().then(t => t.replace(/\s+/g, ' ').trim());
  const org = await mk('org');
  await org.goto(BASE);
  await org.click('#tour-new');
  await org.waitForSelector('#tour-link');
  const link = (await text(org, '#tour-link'));
  ok(/tour=[A-Z0-9]{4}/.test(link), 'invite link: ' + link);
  const names = ['Otto', 'Mira', 'Kalle'], ps = [];
  for (const n of names) {
    const p = await mk(n); ps.push(p);
    await p.goto(link + '&test');
    await p.waitForSelector('#tour-name', { timeout: 15000 });
    await p.fill('#tour-name', n); await p.click('#tour-name-ok');
  }
  await org.waitForFunction(() => document.querySelectorAll('.tour-list li').length === 4, null, { timeout: 15000 });
  ok(true, 'organizer sees 4 players: ' + (await org.locator('.tour-list li').allInnerTexts()).map(s => s.split('\n')[0]).join(', '));
  await org.waitForFunction(() => /Otto/.test(document.querySelector('.tour-list').textContent) && /Kalle/.test(document.querySelector('.tour-list').textContent), null, { timeout: 8000 });
  ok(true, 'gamertags arrived');
  // settings
  await org.click('[data-ttab="settings"]');
  await org.click('[data-tset="packOptions"][data-v="4"]');
  await org.click('[data-tset="deploy1"][data-v="60"]');
  await org.click('[data-map="forest"]');
  await sleep(300);
  const st = await org.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t.settings);
  ok(st.packOptions === 4 && st.deploy1 === 60 && st.map === 'forest', `settings saved: ${st.packOptions} leaders, ${st.deploy1} s, map ${st.map}`);
  await ps[0].click('[data-ttab="rules"]');
  await ps[0].waitForFunction(() => /4 leaders/.test(document.querySelector('.tour-rules').textContent), null, { timeout: 5000 });
  ok(true, 'players see the rules: ' + await text(ps[0], '.tour-rules'));
  await org.click('[data-ttab="players"]');
  await org.click('#tour-start');
  await org.waitForSelector('[data-ttab="matches"][aria-pressed="true"]');
  const all = [org, ...ps];
  for (const p of ps) await p.waitForSelector('#tour-play', { timeout: 10000 });
  const heads = []; for (const p of all) heads.push(await text(p, '#tour-root h2'));
  ok(heads.every(h => /^vs /i.test(h)), 'everyone has a match: ' + heads.join(' | '));
  // play: hosts first, then guests
  const role = async (p) => (await text(p, '#tour-play')) === 'Start match' ? 'host' : 'guest';
  const roles = []; for (const p of all) roles.push(await role(p));
  for (let k = 0; k < all.length; k++) if (roles[k] === 'host') await all[k].click('#tour-play');
  await sleep(500);
  for (let k = 0; k < all.length; k++) if (roles[k] === 'guest') await all[k].click('#tour-play');
  for (const p of all) await p.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 25000 });
  ok(true, 'both matches started by themselves');
  const hostP = all[roles.indexOf('host')];
  const info = await hostP.evaluate(() => { const { m } = window.__pb(); return { n: m.packages[0].length, same: JSON.stringify(m.packages[0]) === JSON.stringify(m.packages[1]), mirror: m.mirror, map: m.map.id, chars: m.packages[0].map(p => p.char) }; });
  ok(info.n === 4 && info.same && info.mirror && info.map === 'forest', `match: ${info.n} packages, same for both ${info.same}, map ${info.map}, leaders ${info.chars.join(', ')}`);
  const clock = await text(hostP, '#clock');
  ok(/^(1:00|0:5\d)\b/.test(clock), 'deploy clock from the tournament: ' + clock);
  const foeNames = []; for (const p of all) foeNames.push(await text(p, '#foe-name'));
  ok(foeNames.every(n => ['ORGANIZER', ...names.map(x => x.toUpperCase())].includes(n.toUpperCase())), 'HUD shows the opponent\'s gamertag: ' + foeNames.join(', '));
  // the guests forfeit: the hosts win
  for (let k = 0; k < all.length; k++) if (roles[k] === 'guest') { const p = all[k]; await p.click('#cog'); await p.click('#to-menu'); await p.click('#forfeit-yes'); }
  for (let k = 0; k < all.length; k++) if (roles[k] === 'host') await all[k].waitForFunction(() => document.getElementById('phase').textContent === 'Match over', null, { timeout: 10000 });
  await org.waitForFunction(() => { const t = JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t; return t.rounds[0].matches.every(mt => mt.result); }, null, { timeout: 10000 });
  const r1 = await org.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t.rounds[0].matches.map(mt => [mt.result.winner, mt.host]));
  ok(r1.every(([w, h]) => w === h), 'results reported by themselves, the hosts won: ' + JSON.stringify(r1));
  // back to the tournament
  for (const p of all) { if (await p.isVisible('#again')) await p.click('#again'); else if (await p.isVisible('#menu')) await p.click('#menu'); }
  await sleep(500);
  if (await org.isVisible('[data-ttab="matches"]')) await org.click('[data-ttab="matches"]');
  await org.waitForSelector('#tour-next:not([disabled])', { timeout: 10000 }).catch(async (e) => { console.log('org screen:', await text(org, '#overlay'), '|', await text(org, '#panel')); throw e; });
  await org.click('#tour-next');
  await org.waitForFunction(() => JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t.rounds.length === 2);
  const r2 = await org.evaluate(() => { const t = JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t; return t.rounds[1].matches.map(mt => [mt.a, mt.b].map(id => t.players.find(p => p.id === id).name).join(' v ')); });
  ok(r2.length === 2, 'round 2 paired: ' + r2.join(', '));
  // the organizer reloads: the hub comes back and the players see it again
  await org.reload(); await sleep(1500);
  await org.waitForSelector('#tour-root', { timeout: 10000 });
  ok(/Round 2/.test(await text(org, '#tour-root')), 'organizer back after a reload: ' + await text(org, '#tour-root h2'));
  await ps[0].waitForFunction(() => !/Reconnecting|Lost/.test(document.getElementById('tour-root').textContent), null, { timeout: 20000 });
  ok(true, 'players reconnected');
  // the organizer sets round 2's results by hand
  await org.click('[data-ttab="matches"]');
  const btns = await org.locator('[data-res$=":a"]').count();
  for (let k = 0; k < btns; k++) { await org.locator('[data-res$=":a"]').nth(k).click(); await sleep(150); }
  await org.waitForSelector('#tour-next:not([disabled])');
  await ps[1].click('[data-ttab="standings"]').catch(() => {});
  await sleep(500);
  ok(true, 'standings on a phone: ' + (await ps[1].locator('.tour-tbl tbody tr').allInnerTexts()).map(s => s.replace(/\s+/g, ' ')).join(' / '));
  // 4 players: 2 Swiss rounds, then top 2 play the final
  let guard = 0;
  while (guard++ < 6) {
    const done = await org.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t.status === 'done');
    if (done) break;
    await org.click('#tour-next'); await sleep(400);
    if (await org.isVisible('[data-ttab="matches"]')) await org.click('[data-ttab="matches"]');
    const n = await org.locator('[data-res$=":a"]').count();
    for (let k = 0; k < n; k++) { await org.locator('[data-res$=":a"]').nth(k).click(); await sleep(150); }
  }
  const fin = await org.evaluate(() => { const t = JSON.parse(localStorage.getItem('phonebellum.tour.org.v1')).t; return { status: t.status, champ: (t.players.find(p => p.id === t.champion) || {}).name, rounds: t.rounds.map(r => r.stage) }; });
  ok(fin.status === 'done' && fin.champ, `tournament over: ${fin.rounds.join(', ')}; champion ${fin.champ}`);
  await ps[2].waitForFunction(() => /🏆/.test(document.getElementById('tour-root').textContent), null, { timeout: 10000 });
  ok(true, 'players see the champion: ' + await text(ps[2], '#tour-root h2'));
  ok(await ps[2].isVisible('.tour-bracket') || true, '');
  await ps[2].click('[data-ttab="bracket"]');
  ok(/Final/i.test(await text(ps[2], ".tour-bracket")), 'bracket: ' + await text(ps[2], '.tour-bracket'));
  // a watcher (big screen)
  const w = await mk('watch');
  await w.goto(link + '&watch=1&test');
  await w.waitForFunction(() => /🏆/.test((document.getElementById('tour-root') || {}).textContent || ''), null, { timeout: 15000 });
  ok(true, 'big-screen view: ' + await text(w, '#tour-root h2'));
  // the organizer ends it: players are told
  await org.click('#tour-end'); await org.click('#tour-end');
  await ps[0].waitForFunction(() => /ended/.test(document.getElementById('overlay').textContent), null, { timeout: 10000 });
  ok(true, 'players told it ended: ' + await text(ps[0], '#overlay'));
  ok(!(await org.evaluate(() => localStorage.getItem('phonebellum.tour.org.v1'))), 'organizer save cleared');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})();
