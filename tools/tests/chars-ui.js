// Characters: package cards show them, the tower sheet shows yours and (after the first fight) theirs,
// towers are fixed, Zoe's buff tiles are drawn, and multiplayer hides the host's character in round 1.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); p.on('pageerror', e => console.log(`[${n}] PAGE ERROR`, e.message)); return p; };
  // screen tile -> click (the guest's board is rotated, so callers pass screen coordinates)
  const tap = async (p, c, r) => { const b2 = await p.locator('#board').boundingBox(); await p.mouse.click(b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16); };
  const hint = (p) => p.locator('#panel .hint').first().textContent();
  const sheet = async (p) => { const t = (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ').slice(0, 140); await p.click('#close').catch(() => {}); await sleep(150); return t; };
  const packs = (p) => p.$$eval('[data-pack]', bs => bs.map(x => x.textContent.replace(/\s+/g, ' ').trim()));

  // vs bot, pick Zoe
  const p = await mk('ai');
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(500);
  await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
  console.log('hint:', await hint(p));
  const ps = await packs(p);
  console.log('packs:', ps.length, ps.map(t => t.match(/(Frickolas Cage|Zoe|Emile|Wilhelm)/)?.[1]).join(', '));
  await p.screenshot({ path: 'chars-packs.png' });
  await p.dblclick(`[data-pack="${Math.max(0, ps.findIndex(t => /Zoe/.test(t)))}"]`); await sleep(300);
  console.log('after pick:', (await hint(p)).slice(0, 160));
  const st = await p.evaluate(() => { const { m, me } = window.__pb(); return { towers: m.towers, buff: m.buff[me], chars: m.chars, needsTower: Game.needsTower(m, me) }; });
  console.log('state:', JSON.stringify(st));
  await p.screenshot({ path: 'chars-zoe.png' });
  await tap(p, 8, 14); await sleep(200); console.log('own tower sheet:', await sheet(p));
  await tap(p, 8, 1); await sleep(200); console.log('enemy tower sheet r1:', await sheet(p));
  await p.click('#fight'); await sleep(500); await p.click('#skip'); await sleep(300);
  await p.click('#next').catch(() => {}); await sleep(400);
  const r2 = await p.evaluate(() => { const { m } = window.__pb(); return { round: m.round, buff: m.buff[0] }; });
  console.log('round 2:', JSON.stringify(r2));
  await tap(p, 8, 1); await sleep(200); console.log('enemy tower sheet r2:', await sheet(p));

  // multiplayer: host Emile, guest Wilhelm
  const host = await mk('host'), guest = await mk('guest');
  const BASE = 'http://127.0.0.1:8766/?test&peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto((await host.locator('#link').textContent()).replace('?', '?test&'));
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  await sleep(300);
  const hp = await packs(host), gp = await packs(guest);
  await host.dblclick(`[data-pack="${Math.max(0, hp.findIndex(t => /Emile/.test(t)))}"]`);
  await guest.dblclick(`[data-pack="${Math.max(0, gp.findIndex(t => /Wilhelm/.test(t)))}"]`);
  await sleep(600);
  const gs = await guest.evaluate(() => { const { m } = window.__pb(); return { towers: m.towers, chars: m.chars }; });
  const hs = await host.evaluate(() => { const { m } = window.__pb(); return { chars: m.chars }; });
  console.log('guest sees:', JSON.stringify(gs), '| host sees:', JSON.stringify(hs));
  await tap(guest, 3, 14); await sleep(200); console.log('guest own tower:', await sheet(guest));
  await tap(guest, 3, 1); await sleep(200); console.log('guest taps host tower r1:', await sheet(guest));
  await guest.screenshot({ path: 'chars-guest.png' });
  await guest.click('#ready'); await host.click('#ready');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 5000 });
  await host.click('#skip'); await guest.click('#skip'); await sleep(400);
  await host.click('#next').catch(() => {}); await guest.click('#next').catch(() => {});
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 8000 }).catch(() => console.log('guest not back in deploy'));
  await sleep(400);
  await tap(guest, 3, 1); await sleep(200); console.log('guest taps host tower r2:', await sheet(guest));
  await b.close();
})();
