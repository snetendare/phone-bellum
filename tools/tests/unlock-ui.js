const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); p.on('pageerror', e => console.log(`[${n}] PAGE ERROR`, e.message)); return p; };
  const tap = async (p, c, r) => { const b2 = await p.locator('#board').boundingBox(); await p.mouse.click(b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16); };
  // multiplayer: guest unlocks Ember Imps and places them
  const host = await mk('host'), guest = await mk('guest');
  const BASE = 'http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto(await host.locator('#link').textContent());
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  for (const pg of [host, guest]) { await pg.dblclick('[data-pack="0"]'); await sleep(150); await tap(pg, 1, 15); await sleep(150); }
  await host.click('.ucard:not([data-locked])'); await tap(host, 5, 12);
  await guest.click('[data-tier="2"]'); await guest.click('.ucard[data-locked] >> nth=0'); await sleep(200);
  await guest.click('#unlock'); await guest.click('#unlock-yes'); await guest.click('#close'); await tap(guest, 6, 12);
  console.log('guest after unlock+place:', await guest.locator('.gold').first().textContent(), '|', await guest.locator('#panel .hint').last().textContent());
  await sleep(500);
  await guest.click('#ready'); await host.click('#ready');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 5000 });
  await host.click('#skip'); await guest.click('#skip'); await sleep(400);
  const hp = (pg) => pg.evaluate(() => document.getElementById('hp-you').textContent + '/' + document.getElementById('hp-foe').textContent);
  console.log('mp hp host', await hp(host), 'guest', await hp(guest));
  console.log('host result:', (await host.locator('#overlay').innerText()).replace(/\s+/g, ' ').slice(0, 100));
  await b.close();
})();
