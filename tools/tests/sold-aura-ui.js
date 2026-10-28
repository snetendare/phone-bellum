// On the page (vs AI, 2D board, a PC window): a squad the opponent sold this round still stands on their side, drawn
// and tappable, until the fight; a Brute next to your Steel Wizard (Reforge) shows the aura on its sheet, the wizard
// its armor with Heavy metal and Reforge, and in the fight the Brute's card shows its hit with the aura.
// Run from the repo root with the game served on port 8766: node tools/tests/sold-aura-ui.js
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  const p = await (await ctx2d(b, { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })).newPage();
  p.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(500);
  await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
  await p.dblclick('[data-pack="0"]'); await sleep(300);
  const ids = await p.evaluate(() => {
    const { m, me } = window.__pb(), foe = 1 - me, ix = (n) => m.units.findIndex(u => u.name === n);
    m.round = 2; m.gold[me] = 5000; m.gold[foe] = 5000; m.extraDeploys[me] = Game.CONFIG.maxExtraDeploys;
    m.armies = [[], []]; m.chars = [null, null];
    for (const n of ['Steel Wizard', 'Brute', 'Fire Mage']) { m.unlocks[me][ix(n)] = 1; m.unlocks[foe][ix(n)] = 1; }
    const sw = ix('Steel Wizard'), sk = (id) => m.units[sw].skills.indexOf(id);
    m.tech[me][sw] = Engine.SLOTS.map(k => k === sk('heavyMetal') || k === sk('reforge') ? 1 : 0);
    const row = me === 0 ? 11 : 4, frow = me === 0 ? 4 : 11;
    const w = Game.place(m, me, sw, 5, row), br = Game.place(m, me, ix('Brute'), 6, row);
    const eb = Game.place(m, foe, ix('Brute'), 3, frow), fm = Game.place(m, foe, ix('Fire Mage'), 9, frow);
    for (const s of [w, br, eb, fm]) s.round = 1;
    window.__pbRedraw();
    return { w: w.id, br: br.id, fm: fm.id, row, frow, me };
  });
  const tile = (c, r) => p.locator('#board').boundingBox().then(bb => ({ x: bb.x + c * bb.width / 12, y: bb.y + r * bb.height / 16, width: bb.width / 12, height: bb.height / 16 }));
  const sheet = () => p.evaluate(() => document.getElementById('sheet').innerText);
  const close = async () => { await p.evaluate(() => { const c = document.getElementById('close'); if (c) c.click(); }); await sleep(150); };

  // the opponent sells their Fire Mage: it still stands where it was, drawn the same and tappable
  const before = await p.screenshot({ clip: await tile(9, ids.frow) });
  const sold = await p.evaluate((ids) => { const { m, me } = window.__pb(); const v = Game.sell(m, 1 - me, ids.fm); window.__pbRedraw(); return v; }, ids);
  assert.ok(sold > 0, 'sold');
  await sleep(200);
  const after = await p.screenshot({ clip: await tile(9, ids.frow) });
  assert.ok(before.equals(after), 'the sold squad is drawn as before');
  await ctx2d.tap(p, 9, ids.frow); await sleep(250);
  assert.ok(/Fire Mage/.test(await sheet()), 'its sheet still opens');
  await close();

  // your Brute next to the Steel Wizard: the aura on its sheet; the wizard's armor 6 + 4 + 2
  await ctx2d.tap(p, 6, ids.row); await sleep(250);
  let s = await sheet();
  console.log('brute sheet:', s.replace(/\s+/g, ' ').slice(0, 400));
  assert.ok(/Aura from Steel Wizard/.test(s) && /\+20/.test(s), 'the Brute shows the aura');
  await p.locator('#sheet').screenshot({ path: 'sold-aura-1-brute.png' });
  await close();
  await ctx2d.tap(p, 5, ids.row); await sleep(250);
  s = await sheet();
  assert.ok(/Armor 12/.test(s), 'Steel Wizard: Armor 12');
  assert.ok(!/Aura from/.test(s), 'no aura from itself');
  await close();

  // the fight: the Brute's card shows its hit with the aura
  await p.click('#fight'); await sleep(150);
  const at = await p.evaluate((ids) => { const { bt, me } = window.__pb(); const x = bt.bodies.find(q => q.side === me && q.squad === ids.br); return { c: x.x / Game.TILE + (Game.COLS - 1) / 2, r: (Game.ROWS - 1) / 2 - x.y / Game.TILE, hit: x.u.hit, aura: x.auraHit }; }, ids);
  console.log('brute in the fight:', JSON.stringify(at));
  await ctx2d.tap(p, Math.round(at.c - 0.5 + 1e-9), Math.round(at.r - 0.5 + 1e-9)); await sleep(100);
  const card = await p.evaluate(() => { const c = document.getElementById('bcard'); return c ? c.innerText : ''; });
  console.log('card:', card.replace(/\s+/g, ' '));
  assert.ok(/Brute/.test(card), 'the Brute\'s card');
  assert.ok(new RegExp(`Hit\\s*${Math.round(at.hit + 20)}\\b`).test(card), `hit ${Math.round(at.hit)} + 20 on the card`);
  assert.ok(/Aura \+20 hit/.test(card), 'and the aura in its status');
  await p.locator('#bcard').screenshot({ path: 'sold-aura-2-card.png' });
  assert.deepStrictEqual(errors, []);
  console.log('sold-aura ui ok');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
