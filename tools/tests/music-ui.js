const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.goto('http://127.0.0.1:8766/'); await sleep(800);
  const playing = () => p.evaluate(() => window.__music ? !window.__music.paused : null);
  await p.evaluate(() => { const o = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__music = this; return o.call(this); }; });
  await p.mouse.click(5, 5); await sleep(800);
  console.log('after first tap, playing:', await playing());
  await p.click('#go'); await sleep(1500);
  console.log('in match, playing:', await playing());
  await p.goto('http://127.0.0.1:8766/'); await sleep(500);
  await p.click('#settings summary'); await p.click('[data-mu="0"]'); await sleep(1500);
  await p.reload(); await sleep(500);
  console.log('off remembered:', await p.getAttribute('[data-mu="0"]', 'aria-pressed'));
  await b.close();
})();
