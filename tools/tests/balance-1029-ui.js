// The 2026-10-29 changes on the page (vs AI, 2D board): an Obelisk's sheet shows Eye of the Obelisk as an Evolve skill
// (nothing to buy, "Evolves at 15 Glut", then "Evolved" once its Glut fills in a fight); with the Keep the tray has
// 3 deployments and no +1 chip. Screenshots go to the current folder.
// Run from the repo root with the game served on port 8766: node tools/tests/balance-1029-ui.js
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  await p.goto('http://127.0.0.1:8766/?test&board=2d'); await sleep(500);
  await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
  await p.dblclick('[data-pack="0"]'); await sleep(300);
  const ids = await p.evaluate(() => {
    const { m, me } = window.__pb(), ob = m.units.findIndex(u => u.name === 'Obelisk');
    m.gold[me] = 3000; m.unlocks[me][ob] = 1; m.extraDeploys[me] = Game.CONFIG.maxExtraDeploys;
    const row = me === 0 ? 11 : 4;
    m.armies[me] = m.armies[me].filter(s => s.row !== row);
    const sq = Game.place(m, me, ob, 3, row); sq.glut = 9;
    return { id: sq.id, ob, row, me };
  });
  const tapSq = async (col) => { await ctx2d.tap(p, ids.me === 1 ? 11 - col : col, ids.me === 1 ? 15 - ids.row : ids.row); await sleep(300); };
  await tapSq(3);
  let sheet = (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ');
  assert.ok(/Evolve: Eye of the Obelisk/.test(sheet) && /Evolves at 15 Glut \(9 now\)/.test(sheet), sheet.slice(0, 700));
  assert.ok(!/Awaken ·/.test(sheet), 'nothing to buy');
  assert.strictEqual(await p.locator('#sheet [data-act="awaken"]').count(), 0);
  await p.click('#sheet #close'); await sleep(200);
  // its Glut fills: it evolves by itself after the fight
  await p.evaluate(({ id }) => { const { m, me } = window.__pb(); const sq = m.armies[me].find(s => s.id === id); sq.glut = 15; sq.evolved = m.round; }, ids);
  await tapSq(3);
  sheet = (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ');
  assert.ok(/Evolve: Eye of the Obelisk/.test(sheet) && /Evolved/.test(sheet), sheet.slice(0, 700));
  await p.screenshot({ path: 'balance-1029-obelisk.png' });
  await p.click('#sheet #close'); await sleep(200);
  // the Keep: 3 deployments a round, no +1 to buy
  const keep = await p.evaluate(({ me }) => {
    const { m } = window.__pb();
    m.round = Game.TOWER_PICK_ROUND; m.towers[me].type = 'keep'; m.extraDeploys[me] = 0;
    return { allowed: Game.deploysAllowed(m, me), base: Game.CONFIG.deploysPerRound, canBuy: Game.canBuyDeploy(m, me) };
  }, ids);
  assert.ok(keep.allowed === keep.base + 1 && !keep.canBuy, JSON.stringify(keep));
  await p.evaluate(() => window.__pbRedraw()); await sleep(300); // the tray, after setting up the state
  assert.strictEqual(await p.locator('#buy-deploy').count(), 0, 'no +1 chip with the Keep');
  assert.strictEqual(await p.getAttribute('.pips', 'aria-label'), `${keep.allowed} of ${keep.allowed} deployments left`);
  await p.screenshot({ path: 'balance-1029-keep.png' });
  assert.strictEqual(errors.length, 0);
  console.log('balance 2026-10-29 ui ok');
  await b.close();
})();
