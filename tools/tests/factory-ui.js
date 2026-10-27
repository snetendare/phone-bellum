// The Mechites' Factory in the game, on the 2D board and on the 3D board (?board=3d): the Mechites loaded with Load
// units, a Cog Builder placed, Build factory bought from its sheet and placed with a tap, the factory's sheet, a fight
// in which it gets built, then a Cogbot Fighter bought from the factory's sheet and made in the next fight.
// Needs the game served on port 8766. Screenshots go to the current folder.
// Headless Chromium needs software WebGL for 3D (the args below).
const { chromium } = require('playwright-core');
const dock = require('./dock'); // the phone layout's deploy drawer: put it down before tapping the board
const R = require('../../src/default-roster.json'), F = require('../../src/factions.json');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  for (const board of ['2d', '3d']) {
    console.log(`--- ${board} board`);
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    // the middle of a tile (model columns / rows) on the screen, on either board
    const at = (c, r) => p.evaluate(([c, r]) => {
      const { board3d, me } = window.__pb();
      if (!board3d) { const bx = document.getElementById('board').getBoundingClientRect(), sc = me === 1 ? Game.COLS - 1 - c : c, sr = me === 1 ? Game.ROWS - 1 - r : r; return [bx.left + (sc + 0.5) * bx.width / Game.COLS, bx.top + (sr + 0.5) * bx.height / Game.ROWS]; }
      const el = document.querySelector('.board3d canvas'), bx = el.getBoundingClientRect(); let sx = 0, sy = 0, n = 0;
      for (let y = bx.top; y < bx.bottom; y += 4) for (let x = bx.left; x < bx.right; x += 4) { const t = board3d.tileAt(x, y); if (t && t.col === c && t.row === r) { sx += x; sy += y; n++; } }
      return n ? [sx / n, sy / n] : null;
    }, [c, r]);
    const tap = async (c, r) => { await dock.down(p); const pt = await at(c, r); if (!pt) throw new Error(`tile ${c},${r} not on screen`); await p.mouse.click(...pt); await p.waitForTimeout(250); };
    const sheet = async () => (await p.locator('#sheet-back').isVisible()) ? (await p.locator('#sheet-h').textContent()).trim() : null;
    const closeSheet = async () => { if (await sheet()) { await p.click('#sheet #close'); await p.waitForTimeout(150); } };
    const pb = (fn, arg) => p.evaluate(fn, arg);
    // a free tile of your zone the camera shows
    const freeTile = async (rows) => {
      const all = await pb((rows) => { const { m, me } = window.__pb(), out = []; for (const k of rows) for (let col = 2; col < Game.COLS - 2; col++) { const row = Game.zoneRows(me)[k]; if (!Game.occupied(m, me, col, row) && Game.canPlaceAt(m, me, col, row)) out.push([col, row]); } return out; }, rows);
      for (const t of all) if (await at(...t)) return t;
      return null;
    };
    const fight = async (shot, mid) => {
      await p.click('#fight');
      await p.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 20000 });
      await p.waitForTimeout(board === '3d' ? 6000 : 4000);
      if (mid) await mid();
      await p.screenshot({ path: shot });
      await p.click('#skip').then(() => p.click('#skip')).catch(() => {});
      await p.waitForTimeout(800);
      const res = (await p.locator('#overlay').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const next = p.locator('#overlay button').first(); if (await next.count()) await next.click().catch(() => {});
      await p.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 20000 });
      await p.waitForTimeout(400);
      return res;
    };

    await p.goto(`http://127.0.0.1:8766/?test${board === '3d' ? '&board=3d' : ''}`);
    if (board === '3d') await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    // the Mechites and Skeleton Archers, loaded as Counter Lab units
    const roster = { goldCosts: true, settings: R.settings, skills: R.skills.concat(F.skills), units: [...F.factions[0].units, R.units.find(u => u.name === 'Skeleton Archers')] };
    await p.evaluate(() => document.getElementById('load-units').click()); await p.waitForTimeout(200);
    await p.fill('#roster-in', JSON.stringify(roster)); await p.click('#use-roster');
    await p.waitForSelector('#go', { timeout: 60000 }); await p.waitForFunction(() => document.getElementById('sheet-back').hidden, null, { timeout: 180000 }); // the AI's counter table for the loaded units is built first await p.waitForTimeout(300);
    await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(400);
    await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(800);
    // a Cog Builder of our own (gold and the unlock given, so the test doesn't depend on the package dealt)
    const cbAt = await freeTile([0, 1]);
    const cb = await pb((t) => { const { m, me } = window.__pb(), ui = m.units.findIndex(u => u.name === 'Cog Builder'); m.gold[me] = 3000; m.unlocks[me][ui] = 1; Game.place(m, me, ui, t[0], t[1]).round = 0; return ui; }, cbAt); // from an earlier round: a tap opens its sheet
    await tap(...cbAt);
    check(/Cog Builder/.test(await sheet() || ''), `tap on the Cog Builder opens its sheet (${await sheet()})`);
    const place = p.locator('#sheet [data-bplace="0"]');
    check(await place.count() === 1 && /Place · 200 gold/.test(await place.textContent()), 'Build factory offers "Place · 200 gold"');
    await place.click(); await p.waitForTimeout(250);
    check(/place your Factory/.test(await p.locator('#panel').innerText()), 'the panel says where to tap');
    const fAt = await freeTile([4, 3]);
    await tap(...fAt);
    const bl = await pb(() => { const { m, me } = window.__pb(); return Game.buildingsOf(m, me); });
    check(bl.length === 1 && bl[0].col === fAt[0] && bl[0].row === fAt[1] && !bl[0].built, `factory placed at ${fAt}`);
    if (board === '3d') { await p.waitForFunction(() => window.__pb().board3d.drawn().some(x => x.building), null, { timeout: 5000 }).catch(() => {}); const d = await pb(() => window.__pb().board3d.drawn().filter(x => x.building)); check(d.length === 1 && d[0].look === 'glass', `3D: the factory is drawn as a scaffold (${JSON.stringify(d.map(x => x.look))})`); }
    await p.screenshot({ path: `factory-${board}-1-placed.png` });
    await tap(...fAt);
    check(/Your Factory · Not built yet/.test(await sheet() || ''), `tap on it opens its sheet (${await sheet()})`);
    check(await p.locator('#sheet [data-bskill]').count() === 3 && await p.locator('#sheet [data-bskill]:disabled').count() === 3, 'its units can\'t be bought before it is built');
    await closeSheet();

    // round 1's fight: the builder walks over and builds it
    let res = await fight(`factory-${board}-2-building.png`, board === '3d' ? async () => { const d = await pb(() => window.__pb().board3d.drawn().filter(x => x.building)); check(d.length === 1, '3D: the site stands in the fight'); } : null);
    console.log('   result:', res.slice(0, 160));
    let st = await pb(() => { const { m, me } = window.__pb(); return Game.buildingsOf(m, me)[0]; });
    console.log('   factory after round 1:', JSON.stringify(st));
    check(st.built || st.progress > 0, 'the factory was worked on in the fight');
    if (!st.built) await pb(() => { const { m, me } = window.__pb(), b = Game.buildingsOf(m, me)[0]; b.built = true; b.progress = 1; }); // the AI knocked it down: carry on with a built one
    await pb(() => { const { m, me } = window.__pb(); m.gold[me] = Math.max(m.gold[me], 1000); });

    // round 2: buy a Cogbot Fighter from its sheet
    await tap(...fAt);
    check(/Your Factory · Built/.test(await sheet() || ''), `its sheet says built (${await sheet()})`);
    await p.click('#sheet [data-bskill="fighter"]'); await p.waitForTimeout(250);
    check(await pb(() => { const { m, me } = window.__pb(); return Game.bskillOf(m, me, 'factory'); }) === 'fighter', 'Cogbot Fighter bought for this round');
    check(/This round/.test(await p.locator('#sheet').innerText()), 'the sheet shows it');
    await closeSheet();
    await p.screenshot({ path: `factory-${board}-3-built.png` });
    res = await fight(`factory-${board}-4-fighter.png`, board === '3d' ? async () => { let d = []; for (let k = 0; k < 80 && !d.includes('Cogbot Fighter'); k++) { d = await pb(() => window.__pb().board3d.drawn().map(x => x.name)); if (!d.includes('Cogbot Fighter')) await p.waitForTimeout(500); } check(d.includes('Cogbot Fighter'), '3D: the Cogbot Fighter is in the fight'); } : null); // fights run at 1x and software WebGL is slow: wait for it to come out
    console.log('   result:', res.slice(0, 160));
    const last = await pb(() => { const { m } = window.__pb(); return m.history[m.history.length - 1]; });
    const fr = last.dealtBy[0].find(r => r.key === 'b:factory');
    check(!!fr && fr.name === 'Factory', `damage stats list what the factory made (${fr ? fr.dealt : 'none'})`);
    await p.close();
  }
  await b.close();
  console.log(fails ? `${fails} failed` : 'factory-ui ok');
  process.exit(fails ? 1 : 0);
})();
