// The Bastion's Defensive walls on the page (vs AI, 2D board): bought from the tower's sheet, placed by tapping tiles
// of your own half, taken back with a tap; a placed squad shows its range at once. Screenshots go to the current folder.
// Run from the repo root with the game served on port 8766: node tools/tests/bastion-ui.js
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errors = [];
  p.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  const tap = async (c, r) => { const b2 = await p.locator('#board').boundingBox(); await p.mouse.click(b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16); await sleep(150); };
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(500);
  await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
  await p.dblclick('[data-pack="0"]'); await sleep(200);
  // a placed squad shows its range at once: the ring is drawn over the board
  const before = await p.locator('#board').screenshot();
  const name = (await p.locator('.ucard:not([data-locked]) .n').first().innerText()).trim();
  await p.click('.ucard:not([data-locked]) >> nth=0'); await sleep(200);
  const free = await p.evaluate(([name]) => { const { m, me } = window.__pb(); const ui = m.units.findIndex(u => u.name === name); for (let c = 0; c < Game.COLS; c++) if (Game.canPlaceAt(m, me, c, 12, ui) && Game.spotFree(m, me, c, 12, ui)) return c; return -1; }, [name]);
  await tap(free, 12);
  const placed = await p.evaluate(([c]) => { const { m, me } = window.__pb(); return !!Game.squadAt(m, me, c, 12); }, [free]);
  assert.ok(placed, 'placed');
  await p.locator('#board').screenshot({ path: 'bastion-range-placed.png' });
  assert.ok(!before.equals(await p.locator('#board').screenshot()));
  await tap(free, 12);
  assert.ok(await p.evaluate(([c]) => { const { m, me } = window.__pb(); return !!Game.squadAt(m, me, c, 12); }, [free]), 'the first tap after placing keeps it');
  // jump to round 3 on the bastion, with Home ground bought and gold for the walls
  await p.evaluate(() => { const { m, me } = window.__pb(); m.round = 3; m.towers[me].type = 'bastion'; m.towers[1 - me].type = 'keep'; m.towerSkill = [0, 0]; m.towerSkill[me] = 3; m.gold[me] = 2000; });
  const tw = await p.evaluate(() => { const { m, me } = window.__pb(); return m.towers[me]; });
  await tap(tw.col, tw.row); await sleep(200);
  const sheet = await p.locator('#sheet').innerText();
  console.log('tower sheet:', sheet.replace(/\s+/g, ' ').slice(0, 400));
  assert.ok(/moat of fire/.test(sheet) && /Defensive walls/.test(sheet) && /shield/.test(sheet));
  await p.click('#tskill2'); await sleep(200);
  console.log('hint:', await p.locator('#task').innerText().catch(() => ''));
  await p.locator('#board').screenshot({ path: 'bastion-walls-placing.png' });
  // not in their half; then three tiles of my half
  await tap(5, 6);
  let walls = await p.evaluate(() => { const { m, me } = window.__pb(); return Game.bwallsOf(m, me).length; });
  assert.strictEqual(walls, 0, 'not in their half');
  await p.click('#close').catch(() => {});
  await tap(tw.col, tw.row); await sleep(150); await p.click('#bwall'); await sleep(150);
  for (const c of [4, 5, 6]) await tap(c, 8);
  walls = await p.evaluate(() => { const { m, me } = window.__pb(); return Game.bwallsOf(m, me).map(w => [w.col, w.row]); });
  console.log('walls:', JSON.stringify(walls));
  assert.deepStrictEqual(walls, [[4, 8], [5, 8], [6, 8]]);
  await p.locator('#board').screenshot({ path: 'bastion-walls-placed.png' });
  await tap(5, 8); // taken back, and placing again
  walls = await p.evaluate(() => { const { m, me } = window.__pb(); return Game.bwallsOf(m, me).length; });
  assert.strictEqual(walls, 2, 'a tap takes this round’s wall back');
  await tap(5, 9);
  walls = await p.evaluate(() => { const { m, me } = window.__pb(); return Game.bwallsOf(m, me).length; });
  assert.strictEqual(walls, 3);
  // the fight has them
  await p.click('#fight'); await sleep(600);
  const inFight = await p.evaluate(() => { const { bt } = window.__pb(); return bt ? bt.bodies.filter(x => x.u.barrier).length : -1; });
  console.log('walls in the fight:', inFight);
  assert.strictEqual(inFight, 3);
  await sleep(1500);
  await p.locator('#board').screenshot({ path: 'bastion-walls-fight.png' });
  assert.strictEqual(errors.length, 0);
  console.log('bastion ui ok');
  await b.close();
})();
