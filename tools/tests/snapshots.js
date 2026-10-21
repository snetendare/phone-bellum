// Board snapshots: a fixed set of moments drawn exactly the same every run, to check that a change to the drawing
// code (or a move of code between files) didn't change what the players see. Math.random is seeded, the clocks are
// frozen and requestAnimationFrame is driven by hand, so a run gives byte-identical pictures every time.
//
//   node tools/tests/snapshots.js before            (before the change)
//   node tools/tests/snapshots.js after before      (after it: also compares with the "before" run)
//
// Each run writes <dir>/<moment>.png for every picture and <dir>/hashes.txt. Covered on each of the 4 maps: the start
// screen, the map thumbnails and coats of arms, the package pick, a selected unit, a placed squad, the first fight at
// 6 moments, round 2, the round 3 tower pick (and its icons), and a fight with the picked tower. If the peer server
// is up (node tools/peer-server.js), also the guest's board in a live match: the board turned around for side 1.
// Only compare runs from the same machine: another browser version or font can change pixels. Game on port 8766.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const [out, against] = process.argv.slice(2);
if (!out) { console.log('usage: node tools/tests/snapshots.js <dir> [dir to compare with]'); process.exit(1); }
const BASE = 'http://127.0.0.1:8766/', CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(out, { recursive: true });
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
// runs in the page before its own scripts
const freeze = ({ seed, frameClock }) => {
  let s = seed;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  Date.now = () => 1700000000000;
  if (!frameClock) return;
  let perf = 1000, q = [], id = 0;
  performance.now = () => perf;
  window.requestAnimationFrame = (cb) => { q.push([++id, cb]); return id; };
  window.cancelAnimationFrame = (k) => { q = q.filter(e => e[0] !== k); };
  window.__raf = (n) => { for (let i = 0; i < n; i++) { perf += 16; const run = q; q = []; run.forEach(e => e[1](perf)); } };
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const hashes = [];
  const errors = [];
  const page = async (seed, frameClock) => {
    const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(freeze, { seed, frameClock });
    return p;
  };
  const snap = async (p, name) => {
    const buf = Buffer.from((await p.evaluate(() => document.getElementById('board').toDataURL())).split(',')[1], 'base64');
    fs.writeFileSync(path.join(out, name + '.png'), buf);
    hashes.push(name + ' ' + md5(buf));
  };
  const frames = (p, n) => p.evaluate((k) => window.__raf(k), n);
  const tap = async (p, c, r) => { const bb = await p.locator('#board').boundingBox(); await p.mouse.click(bb.x + (c + 0.5) * bb.width / 12, bb.y + (r + 0.5) * bb.height / 16); };
  try {
    for (const map of ['standard', 'forest', 'cavern', 'ice']) {
      const p = await page(12345, true);
      await p.goto(BASE + '?test'); await p.waitForTimeout(300);
      await snap(p, map + '-0start');
      await p.click('#settings summary'); await p.waitForTimeout(200);
      const imgs = await p.evaluate(() => [...document.querySelectorAll('img')].map(i => i.src).join('|'));
      hashes.push(`${map}-0images ${md5(imgs)}`);
      await p.click(`[data-map="${map}"]`); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(200);
      await snap(p, map + '-1pack');
      await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(200);
      await snap(p, map + '-2deploy');
      await p.click('.ucard:not([data-locked]) >> nth=0'); await p.waitForTimeout(100);
      await snap(p, map + '-2selected');
      await tap(p, 5, 13); await p.waitForTimeout(150);
      await p.keyboard.press('Escape'); await p.waitForTimeout(100);
      await snap(p, map + '-3placed');
      await p.click('#fight', { timeout: 5000 }); await p.waitForTimeout(200);
      for (const n of [5, 40, 150, 400]) { await frames(p, n); await snap(p, `${map}-4battle${n}`); }
      await frames(p, 3000); await p.waitForTimeout(100);
      await snap(p, map + '-5after');
      const next = async () => { await p.click('#next', { timeout: 5000 }); await p.waitForTimeout(200); };
      await next(); await snap(p, map + '-6round2');
      await p.click('#fight', { timeout: 5000 }); await p.waitForTimeout(100); await frames(p, 3500); await p.waitForTimeout(100);
      await next(); await snap(p, map + '-7round3');
      const icons = await p.evaluate(() => [...document.querySelectorAll('[data-ticon]')].map(c => c.toDataURL()).join('|'));
      hashes.push(`${map}-7towericons ${md5(icons)}`);
      await p.click('[data-opt] >> nth=1', { timeout: 5000 }); await p.click('#pick-go', { timeout: 5000 }); await p.waitForTimeout(150);
      await snap(p, map + '-8picked');
      await p.click('#fight', { timeout: 5000 }); await p.waitForTimeout(100);
      for (const n of [60, 200]) { await frames(p, n); await snap(p, `${map}-9battle${n}`); }
      await p.close();
    }
    // the guest's board in a live match (needs the peer server); real clocks here, so the connection works
    const peerUp = await fetch('http://127.0.0.1:9000/').then(() => true, () => false);
    if (!peerUp) console.log('peer server not running: guest board skipped');
    else {
      const host = await page(111, false), guest = await page(222, false), MP = BASE + '?peerhost=127.0.0.1&peerport=9000';
      await host.goto(MP); await host.click('#friend');
      await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
      await guest.goto(await host.locator('#link').textContent());
      await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
      await host.click('#settings summary'); await host.click('[data-map="cavern"]'); await host.click('#start');
      await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy'); await guest.waitForTimeout(400);
      await snap(host, 'live-host'); await snap(guest, 'live-guest');
      await guest.dblclick('[data-pack="0"]'); await guest.waitForTimeout(300);
      await snap(guest, 'live-guest-packed');
    }
  } catch (e) { console.log('FAILED:', e.message.split('\n')[0]); process.exitCode = 1; }
  await b.close();
  fs.writeFileSync(path.join(out, 'hashes.txt'), hashes.join('\n') + '\n');
  errors.forEach(e => console.log('PAGE ERROR', e));
  console.log(`${hashes.length} snapshots in ${out}`);
  if (against) {
    const read = (d) => Object.fromEntries(fs.readFileSync(path.join(d, 'hashes.txt'), 'utf8').trim().split('\n').map(l => l.split(' ')));
    const a = read(against), now = read(out), names = [...new Set([...Object.keys(a), ...Object.keys(now)])];
    const diff = names.filter(n => a[n] !== now[n]);
    console.log(diff.length ? `${diff.length} differ from ${against}: ${diff.join(' ')}` : `all ${names.length} identical to ${against}`);
    if (diff.length) process.exitCode = 1;
  }
})();
