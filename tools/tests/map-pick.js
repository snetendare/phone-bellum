const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n) => { const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); p.on('pageerror', e => console.log(`[${n}] PAGE ERROR`, e.message)); return p; };
  const mapOf = (p) => p.evaluate(() => (document.body.innerText.match(/Map: (Standard|Forest Clearing|Mushroom Cavern|Frozen Peak)/) || [])[1]);
  // vs bot: pick each map on the start screen
  const p = await mk('ai');
  for (const id of ['standard', 'forest', 'cavern', 'ice']) {
    await p.goto('http://127.0.0.1:8766/'); await sleep(400);
    await p.click(`[data-map="${id}"]`); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
    console.log('ai', id, '->', await mapOf(p));
  }
  // in the browser: Random never gives Standard nor the last match's map
  const rolls = await p.evaluate(() => { const out = {}; let last = null, repeats = 0; for (let s = 0; s < 3000; s++) { const id = Game.rollMap(s, '', last).id; out[id] = (out[id] || 0) + 1; if (id === last) repeats++; last = id; } return { out, repeats }; });
  console.log('random rolls', JSON.stringify(rolls));
  // multiplayer: host picks in the lobby, guest gets the same map; with Random, each rematch rolls a new map
  const host = await mk('host'), guest = await mk('guest');
  const BASE = 'http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto(await host.locator('#link').textContent());
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('[data-map="cavern"]');
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  await sleep(300);
  console.log('mp host ->', await mapOf(host), '| guest ->', await mapOf(guest));
  await b.close();
})();
