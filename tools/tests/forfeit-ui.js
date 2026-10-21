// Main menu from the in-match cog: it asks first (No keeps the match), Yes forfeits. Vs the AI the match just ends;
// in a live match the other player wins, and the host's saved match is cleared so the link can't resume it.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage(); p.on('pageerror', e => console.log(`[${n}] PAGE ERROR`, e.message)); return p; };
  const text = (p, sel) => p.locator(sel).innerText().then(t => t.replace(/\s+/g, ' ').trim());
  // vs AI
  const ai = await mk('ai');
  await ai.goto('http://127.0.0.1:8766/'); await ai.click('#go'); await sleep(800);
  await ai.click('#cog');
  console.log('cog sheet:', await text(ai, '#sheet-h'), '| Main menu button:', await ai.isVisible('#to-menu'));
  await ai.click('#to-menu');
  console.log('asks:', await text(ai, '#sheet p'));
  await ai.click('#forfeit-no');
  console.log('No: back to', await text(ai, '#sheet-h'), '| phase', await text(ai, '#phase'));
  await ai.click('#to-menu'); await ai.click('#forfeit-yes'); await sleep(300);
  console.log('Yes vs AI: start screen', await ai.isVisible('#go'), '| sheet closed', !(await ai.isVisible('#sheet')));
  // live match: the host forfeits, the guest wins
  const BASE = 'http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000';
  const live = async () => {
    const host = await mk('host'), guest = await mk('guest');
    await host.goto(BASE); await host.click('#friend');
    await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
    await guest.goto(await host.locator('#link').textContent());
    await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
    await host.click('#start');
    await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
    return { host, guest };
  };
  let { host, guest } = await live();
  console.log('host match saved:', await host.evaluate(() => !!localStorage.getItem('phonebellum.host.v1')));
  await host.click('#cog'); await host.click('#to-menu'); await host.click('#forfeit-yes');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Match over', null, { timeout: 5000 });
  console.log('guest sees:', await text(guest, '#overlay'));
  console.log('host save cleared:', await host.evaluate(() => !localStorage.getItem('phonebellum.host.v1')), '| no Resume button:', !(await host.isVisible('#resume')));
  await guest.click('#menu'); console.log('guest back on the menu:', await guest.isVisible('#go'), '| link no longer rejoins:', !/join=/.test(guest.url()));
  // live match: the guest forfeits, the host wins
  ({ host, guest } = await live());
  await guest.click('#cog'); await guest.click('#to-menu'); await guest.click('#forfeit-yes');
  await host.waitForFunction(() => document.getElementById('phase').textContent === 'Match over', null, { timeout: 5000 });
  console.log('host sees:', await text(host, '#overlay'), '| save cleared:', await host.evaluate(() => !localStorage.getItem('phonebellum.host.v1')));
  console.log('guest on the menu:', await guest.isVisible('#go'));
  await b.close();
})();
