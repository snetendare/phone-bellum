// Match history: the host posts one row per round of a two-player match; the start screen lists the rows.
// Writes hist-test.html (index.html with HISTORY_URL pointed at a fake sheet the test answers itself) next to
// index.html for the run, and removes it afterwards.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FAKE = 'https://sheet.test/exec';
const TEST_PAGE = path.join(__dirname, '../../hist-test.html');
fs.writeFileSync(TEST_PAGE, fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8').replace(/const HISTORY_URL = '[^']*';/, `const HISTORY_URL = '${FAKE}';`));
process.on('exit', () => { try { fs.unlinkSync(TEST_PAGE); } catch (e) {} });
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const rows = [], posts = { host: 0, guest: 0 };
  const mk = async (n) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.route(FAKE + '**', r => {
      if (r.request().method() === 'POST') { posts[n]++; rows.unshift({ time: new Date().toISOString(), ...JSON.parse(r.request().postData()) }); return r.fulfill({ body: '{"ok":true}' }); }
      return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ rows }) });
    });
    const p = await ctx.newPage(); p.on('pageerror', e => console.log(`[${n}] PAGE ERROR`, e.message)); return p;
  };
  const tap = async (p, c, r) => { const b2 = await p.locator('#board').boundingBox(); await p.mouse.click(b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16); };
  const host = await mk('host'), guest = await mk('guest');
  const BASE = 'http://127.0.0.1:8766/hist-test.html?peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE);
  console.log('button on start screen:', await host.locator('#hist-open').count());
  await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto(await host.locator('#link').textContent());
  console.log('link:', await host.locator('#link').textContent());
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 }).catch(async e => { console.log('guest sees:', (await guest.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)); throw e; });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  for (const pg of [host, guest]) { await pg.dblclick('[data-pack="0"]'); await sleep(150); }
  await guest.click('#ready'); await host.click('#ready');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 5000 });
  await sleep(1000);
  console.log('posts after round 1: host', posts.host, 'guest', posts.guest);
  const r = rows[0] || {};
  console.log('row:', JSON.stringify({ code: r.code, round: r.round, map: r.map, winner: r.winner, dmg: [r.dmgHost, r.dmgGuest], hp: [r.hpHost, r.hpGuest], over: r.over }));
  console.log('armies:', r.hostArmy, '||', r.guestArmy);
  // the list on a fresh start screen
  const viewer = await mk('viewer'); await viewer.goto(BASE); await viewer.click('#hist-open');
  await viewer.waitForFunction(() => !/Loading/.test(document.getElementById('hist-msg').textContent));
  console.log('viewer:', (await viewer.locator('#sheet').innerText()).replace(/\s+/g, ' ').slice(0, 260));
  await b.close();
})().catch(e => { console.log(e); process.exit(1); });
