const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n) => { const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); p.on('pageerror', e => console.log(`[${n}] PAGE ERROR`, e.message)); return p; };
  const hint = (p) => p.locator('#panel .hint').first().textContent();
  // vs bot: pick each map on the start screen
  const p = await mk('ai');
  for (const id of ['standard', 'forest', 'cavern', 'ice']) {
    await p.goto('http://127.0.0.1:8766/'); await sleep(400);
    await p.click(`[data-map="${id}"]`); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
    console.log('ai', id, '->', (await hint(p)).match(/Map: <?b?>?([A-Z][a-z]+( [A-Z][a-z]+)?)/)[1]);
  }
  await p.goto('http://127.0.0.1:8766/'); await sleep(400); await p.screenshot({ path: 'map-start.png' });
  // multiplayer: host picks in the lobby, guest gets the same map
  const host = await mk('host'), guest = await mk('guest');
  const BASE = 'http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto(await host.locator('#link').textContent());
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('[data-map="cavern"]'); await host.screenshot({ path: 'map-lobby.png' });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  await sleep(300);
  console.log('mp host ->', (await hint(host)).match(/Map: <?b?>?([A-Z][a-z]+( [A-Z][a-z]+)?)/)[1], '| guest ->', (await hint(guest)).match(/Map: <?b?>?([A-Z][a-z]+( [A-Z][a-z]+)?)/)[1]);
  await b.close();
})();
