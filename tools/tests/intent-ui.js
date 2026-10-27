// Intent on the page (vs AI, on the 2D and the 3D board, a PC window): a tap on your squad while deploying draws
// arrows from it to the enemy squads it heads for first (Game.intentPreview, from what you can see) and its sheet
// says so; a Goblin Swarm with Tacticalness (spread) splits into at most two arrows with a count on each; a unit
// picked in the shop previews the tile under the mouse; in the fight a tap on a squad shows where it is walking now
// (b.intent), with small rings on whom it attacks. Screenshots go to the current folder.
// Run from the repo root with the game served on port 8766: node tools/tests/intent-ui.js
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const errors = [];
  for (const board of ['2d', '3d']) {
    const p = await (await ctx2d(b, { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })).newPage();
    p.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
    await p.goto(`http://127.0.0.1:8766/?test${board === '3d' ? '&board=3d' : ''}`); await sleep(board === '3d' ? 1500 : 500);
    await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
    await p.dblclick('[data-pack="0"]'); await sleep(300);
    // round 2: your Goblin Swarm (Tacticalness) on the left and a Brute in the middle; the enemy's squads from round 1 in
    // sight: a Brute ahead of the goblins and Skeleton Archers on the right; one placed this round stays hidden
    const ids = await p.evaluate(() => {
      const { m, me } = window.__pb(), foe = 1 - me, ix = (n) => m.units.findIndex(u => u.name === n);
      m.round = 2; m.gold[me] = 5000; m.gold[foe] = 5000; m.extraDeploys[me] = Game.CONFIG.maxExtraDeploys;
      m.armies = [[], []];
      for (const n of ['Goblin Swarm', 'Brute', 'Skeleton Archers', 'Fire Mage']) { m.unlocks[me][ix(n)] = 1; m.unlocks[foe][ix(n)] = 1; }
      const row = me === 0 ? 11 : 4, frow = me === 0 ? 4 : 11;
      const gob = Game.place(m, me, ix('Goblin Swarm'), 2, row), br = Game.place(m, me, ix('Brute'), 6, row);
      m.chars = [null, null]; m.tech[me][ix('Goblin Swarm')] = [2, 2, 0, 0]; // no leaders; AAARGH!, then Tacticalness (spread)
      const eb = Game.place(m, foe, ix('Brute'), 3, frow), ea = Game.place(m, foe, ix('Skeleton Archers'), 9, frow);
      eb.round = 1; ea.round = 1; // from round 1: in sight
      const hid = Game.place(m, foe, ix('Fire Mage'), 2, frow + (me === 0 ? 1 : -1)); // this round's: hidden
      return { gob: gob.id, br: br.id, eb: eb.id, ea: ea.id, hid: hid.id, row, me };
    });
    const at = (c, r) => board === '2d' ? p.locator('#board').boundingBox().then(bb => [bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16]) : p.evaluate(([c, r]) => window.__pb().board3d.screenAt(c, r, 0), [c, r]);
    const marks = () => p.evaluate(() => ({ arrows: document.querySelectorAll('#marks path.intent:not(.ahead)').length, ahead: document.querySelectorAll('#marks path.ahead').length, counts: [...document.querySelectorAll('#marks .intent-n text')].map(t => +t.textContent), rings: document.querySelectorAll('#marks .intent-ring').length, hits: document.querySelectorAll('#marks .intent-hit').length }));
    // the preview itself: the goblins never head for the hidden Fire Mage, the Brute goes for the enemy Brute
    const pv = await p.evaluate((ids) => { const { m, me } = window.__pb(); return { gob: Game.intentPreview(m, me, { id: ids.gob }), br: Game.intentPreview(m, me, { id: ids.br }) }; }, ids);
    console.log(board, 'preview:', JSON.stringify(pv.gob.groups.map(g => [g.squad, g.n])), JSON.stringify(pv.br.groups.map(g => [g.squad, g.n])));
    assert.ok(pv.gob.total === 15 && pv.gob.groups.length >= 1 && pv.gob.groups.length <= 2, 'goblins: one or two targets');
    assert.ok(![...pv.gob.groups, ...pv.br.groups].some(g => g.squad === ids.hid), 'never the squad placed this round');
    assert.ok(pv.br.groups.length === 1 && pv.br.groups[0].n === 1, 'the Brute: one body, one target');
    // a tap on the goblins: arrows and the sheet's line
    let [x, y] = await at(2, ids.row); await p.mouse.click(x, y); await sleep(400);
    const sheet = (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ');
    assert.ok(/Intent: Heads for/.test(sheet), sheet.slice(0, 400));
    await p.click('#sheet #close'); await sleep(300);
    let mk = await marks();
    console.log(board, 'tap goblins:', JSON.stringify(mk));
    assert.ok(mk.arrows >= 1 && mk.arrows <= 2 && mk.rings === mk.arrows, 'arrows to the enemy squads it heads for');
    if (mk.arrows === 2) assert.ok(mk.counts.length === 2 && mk.counts.reduce((a, c) => a + c, 0) <= 15, 'a split shows a count on each');
    await p.screenshot({ path: `intent-${board}-tap.png` });
    // a unit picked in the shop: the tile under the mouse
    await p.locator('#shop .uc2[aria-disabled="false"]').first().click(); await sleep(200);
    assert.ok(await p.locator('#shop .uc2[aria-pressed="true"]').count() === 1, 'a unit picked in the shop');
    [x, y] = await at(9, ids.row); await p.mouse.move(x, y); await sleep(250); [x, y] = await at(9, ids.row); await p.mouse.move(x + 1, y); await sleep(600);
    mk = await marks();
    console.log(board, 'shop pick over a tile:', JSON.stringify(mk));
    assert.ok(mk.arrows >= 1, 'the placing preview shows an arrow');
    await p.screenshot({ path: `intent-${board}-hover.png` });
    await p.keyboard.press('Escape'); await sleep(100);
    // the fight: a tap on the goblins shows where they walk now
    await p.evaluate(() => { const s = document.querySelector('#task'); if (s && !s.hidden) s.click(); });
    await p.click('#fight'); await sleep(board === '3d' ? 2500 : 1800);
    const pos = await p.evaluate((ids) => { const { bt, me } = window.__pb(), bs = bt.bodies.filter(b => b.alive && b.side === me && b.squad === ids.gob); if (!bs.length) return null; const b0 = bs[0]; return { x: b0.x, y: b0.y, intent: bs.filter(b => b.intent).length, lock: bs.filter(b => b.lock).length, n: bs.length }; }, ids);
    assert.ok(pos, 'goblins in the fight');
    console.log(board, 'fight goblins:', JSON.stringify(pos));
    const scr = await p.evaluate(([wx, wy]) => { const T = Game.TILE, c = wx / T + (Game.COLS - 1) / 2, r = (Game.ROWS - 1) / 2 - wy / T, { board3d, me } = window.__pb(); if (board3d) return board3d.screenAt(c, r, 0); const bb = document.getElementById('board').getBoundingClientRect(), f = me === 1; return [bb.left + ((f ? Game.COLS - 1 - c : c) + 0.5) * bb.width / Game.COLS, bb.top + ((f ? Game.ROWS - 1 - r : r) + 0.5) * bb.height / Game.ROWS]; }, [pos.x, pos.y]);
    await p.mouse.click(scr[0], scr[1]); await sleep(120);
    mk = await marks();
    console.log(board, 'fight tap:', JSON.stringify(mk));
    assert.ok(mk.arrows + mk.ahead >= 1, 'in the fight: where it walks now');
    await p.screenshot({ path: `intent-${board}-fight.png` });
    await p.close();
  }
  assert.strictEqual(errors.length, 0);
  console.log('intent ui ok');
  await b.close();
})();
