// Menu music: starts on the first tap, stops in a match. The cog (in a match) and Match settings (on the menu)
// open the sound sheet, and its settings stick.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.addInitScript(() => { const o = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__music = this; return o.call(this); }; });
  const playing = () => p.evaluate(() => window.__music ? !window.__music.paused : null);
  await p.goto('http://127.0.0.1:8766/'); await sleep(800);
  await p.mouse.click(5, 5); await sleep(800);
  console.log('menu, after first tap, playing:', await playing(), await p.evaluate(() => window.__music.src.split('/').pop()));
  await p.click('#go'); await sleep(1500);
  console.log('in match, playing:', await playing());
  await p.click('#cog'); await sleep(300);
  console.log('sound sheet open:', await p.isVisible('#vol'));
  await p.screenshot({ path: process.argv[2] || 'sound-sheet.png' });
  await p.fill('#vol', '30'); await p.click('[data-mute="1"]');
  await p.reload(); await sleep(500);
  console.log('saved:', await p.evaluate(() => localStorage.getItem('phonebellum.sound.v1')));
  await p.mouse.click(5, 5); await sleep(800);
  console.log('menu while muted, playing:', await playing());
  await p.click('#settings summary'); await p.click('#sound-open'); await p.click('[data-mute="0"]'); await sleep(500);
  console.log('unmuted, playing:', await playing());
  await p.evaluate(() => { const a = window.__music; a.currentTime = a.duration - 0.5; }); await sleep(2000);
  console.log('after a track ends, playing:', await playing(), await p.evaluate(() => window.__music.src.split('/').pop()));
  await b.close();
})();
