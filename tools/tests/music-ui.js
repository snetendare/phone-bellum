// Music: the menu playlist starts on the first tap, the deployment phase playlist takes over while deploying
// (starter pack choice included) and both are silent during the fight. The cog (in a match) and Match settings
// (on the menu) open the music sheet, its settings stick, and a picked menu song replaces the menu playlist.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.addInitScript(() => { window.__els = new Set(); const o = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__els.add(this); return o.call(this); }; });
  // the tracks playing right now
  const playing = () => p.evaluate(() => [...window.__els].filter(a => !a.paused).map(a => a.src.split('/').pop()).join(', ') || 'nothing');
  await p.goto('http://127.0.0.1:8766/'); await sleep(800);
  await p.mouse.click(5, 5); await sleep(800);
  console.log('menu:', await playing());
  await p.click('#go'); await sleep(1500);
  console.log('starter pack choice:', await playing());
  const tap = async (c, r) => { const bb = await p.locator('#board').boundingBox(); await p.mouse.click(bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16); };
  await p.dblclick('[data-pack="0"]'); await sleep(200); await tap(1, 15); await sleep(200);
  await p.click('.ucard:not([data-locked])'); await tap(5, 13); await p.click('#fight'); await sleep(1500);
  console.log('fight:', await playing());
  await p.click('#skip'); await sleep(800);
  await p.click('#next').catch(() => {}); await sleep(1500);
  console.log('round 2 deploy:', await playing());
  await p.click('#cog'); await sleep(300);
  console.log('sound sheet open:', await p.isVisible('#vol'));
  await p.fill('#vol', '30'); await p.click('[data-mute="1"]'); await sleep(1000);
  console.log('muted in deploy:', await playing());
  await p.reload(); await sleep(500);
  console.log('saved:', await p.evaluate(() => localStorage.getItem('phonebellum.sound.v1')));
  await p.mouse.click(5, 5); await sleep(800);
  console.log('menu while muted:', await playing());
  await p.click('#music-open'); await p.click('[data-mute="0"]'); await sleep(500);
  console.log('unmuted on menu:', await playing());
  await p.evaluate(() => [...window.__els].find(x => !x.paused).dispatchEvent(new Event('ended'))); await sleep(1500); // python's server can't seek
  console.log('after a menu track ends:', await playing());
  await p.screenshot({ path: process.argv[2] || 'menu.png' });
  await p.click('[data-song="bulgaria"]'); await sleep(800);
  console.log('picked Bulgaria for the menu:', await playing());
  await p.screenshot({ path: (process.argv[2] || 'menu.png').replace('.png', '-sheet.png') });
  await p.reload(); await sleep(500); await p.mouse.click(5, 5); await sleep(800);
  console.log('after reload:', await playing());
  await b.close();
})();
