// Awaken and Master skills on the page (vs AI, 2D board, then the 3D board): a Leaf Wizard squad is awakened from its
// own sheet (Leafblade, after Petalburst), only that squad; the shop sheet says Awaken skills are bought per squad;
// the Brute's sheet shows Berserkers as a Master skill; the fight has the leaf-mech. Screenshots go to the current folder.
// Run from the repo root with the game served on port 8766: node tools/tests/awaken-ui.js
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const errors = [];
  for (const board of ['2d', '3d']) {
    const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    p.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
    await p.goto(`http://127.0.0.1:8766/?test${board === '3d' ? '&board=3d' : ''}`); await sleep(board === '3d' ? 1500 : 500);
    await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(300);
    await p.dblclick('[data-pack="0"]'); await sleep(300);
    // two Leaf Wizard squads and a Brute, Petalburst bought, gold to spare
    const ids = await p.evaluate(() => {
      const { m, me } = window.__pb(), lw = m.units.findIndex(u => u.name === 'Leaf Wizard'), bi = m.units.findIndex(u => u.name === 'Brute');
      m.gold[me] = 3000; m.unlocks[me][lw] = 1; m.unlocks[me][bi] = 1; m.extraDeploys[me] = Game.CONFIG.maxExtraDeploys;
      const row = me === 0 ? 11 : 4;
      m.armies[me] = m.armies[me].filter(s => s.row !== row); // a free row for them
      const a = Game.place(m, me, lw, 3, row), c = Game.place(m, me, lw, 5, row), br = Game.place(m, me, bi, 7, row);
      Game.buySkill(m, me, lw, 2);
      return { a: a.id, c: c.id, br: br.id, lw, bi, row, me };
    });
    const tapSq = async (col) => { if (board === '2d') await ctx2d.tap(p, ids.me === 1 ? 11 - col : col, ids.me === 1 ? 15 - ids.row : ids.row); else { const [x, y] = await p.evaluate(([c, r]) => window.__pb().board3d.screenAt(c, r, 0), [col, ids.row]); await p.mouse.click(x, y); } await sleep(300); };
    await tapSq(3);
    let sheet = (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ');
    assert.ok(/Awaken: Leafblade/.test(sheet) && /Awaken · 300 gold/.test(sheet), sheet.slice(0, 600));
    assert.ok(/one squad at a time/.test(await p.locator('#sheet').textContent())); // in the row's details (shown when held)
    await p.click('[data-act="awaken"]'); await sleep(200);
    const st = await p.evaluate(([a, c]) => { const { m, me } = window.__pb(), sa = m.armies[me].find(s => s.id === a), sc = m.armies[me].find(s => s.id === c); return { a: sa.awaken, c: sc.awaken || 0, mech: Game.unitFor(m, me, sa.unit, sa).mech, gold: m.gold[me] }; }, [ids.a, ids.c]);
    console.log(board, 'after awaken:', JSON.stringify(st));
    assert.ok(st.a === 1 && st.c === 0 && st.mech, 'only that squad');
    sheet = (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ');
    assert.ok(/Awakened/.test(sheet) && /Undo/.test(sheet));
    await p.click('#sheet #close'); await sleep(200);
    // the Brute's sheet: Berserkers is a Master skill
    await tapSq(7);
    sheet = (await p.locator('#sheet').textContent()).replace(/\s+/g, ' '); // with the rows' details (shown when held)
    assert.ok(/Master: Berserkers/.test(sheet) && /all your squads/.test(sheet), sheet.slice(0, 600));
    await p.click('#sheet #close'); await sleep(200);
    await p.screenshot({ path: `awaken-${board}-deploy.png` });
    await p.click('#fight'); await sleep(board === '3d' ? 4000 : 2500);
    const fight = await p.evaluate(() => { const { bt } = window.__pb(); return bt ? { mech: bt.bodies.filter(x => x.u.mech).length, missiles: bt.projectiles().filter(x => x.missile).length, t: bt.time() } : null; });
    console.log(board, 'fight:', JSON.stringify(fight));
    assert.ok(fight && fight.mech === 1, 'one leaf-mech in the fight');
    await p.screenshot({ path: `awaken-${board}-fight.png` });
    await p.close();
  }
  assert.strictEqual(errors.length, 0);
  console.log('awaken ui ok');
  await b.close();
})();
