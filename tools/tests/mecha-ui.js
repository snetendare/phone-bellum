// The Mechites' Mecha Tower in the game, on the 2D board and on the 3D board (?board=3d): its sheet with the
// minebots and repairbots, bought for a round; a fight with the drone, the bots and their mines; then a fight under
// Core Awoken, with the tower on wheels. Needs the game served on port 8766. Screenshots go to the current folder.
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
    const pb = (fn, arg) => p.evaluate(fn, arg);
    const fight = async (shot, mid) => {
      await p.click('#fight');
      await p.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 20000 });
      await p.waitForTimeout(board === '3d' ? 7000 : 5000);
      if (mid) await mid();
      await p.screenshot({ path: shot });
      await p.click('#skip').then(() => p.click('#skip')).catch(() => {});
      await p.waitForTimeout(800);
      const next = p.locator('#overlay button').first(); if (await next.count()) await next.click().catch(() => {});
      await p.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 20000 });
      await p.waitForTimeout(400);
    };
    await p.goto(`http://127.0.0.1:8766/?test${board === '3d' ? '&board=3d' : ''}`);
    if (board === '3d') await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    const roster = { goldCosts: true, settings: R.settings, skills: R.skills.concat(F.skills), units: [...F.factions[0].units, R.units.find(u => u.name === 'Skeleton Archers')] };
    await p.evaluate(() => document.getElementById('load-units').click()); await p.waitForTimeout(200);
    await p.fill('#roster-in', JSON.stringify(roster)); await p.click('#use-roster');
    await p.waitForSelector('#go', { timeout: 90000 }); await p.waitForFunction(() => document.getElementById('sheet-back').hidden, null, { timeout: 180000 }); // the AI's counter table for the loaded units is built first await p.waitForTimeout(300);
    await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(400);
    await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(800);
    // straight to round 3 with the Mecha Tower picked, gold, and some Mechite Guards
    await pb(() => {
      const { m, me } = window.__pb();
      m.round = Game.TOWER_PICK_ROUND; Game.ensureTower(m, me); m.towers[me].type = 'f-mechites';
      m.gold[me] = 3000; m.extraDeploys[me] = 3;
      const g = m.units.findIndex(u => u.name === 'Mechite Guards'); m.unlocks[me][g] = 1;
      for (const row of Game.zoneRows(me).slice(0, 2)) for (const col of [4, 7]) if (Game.spotFree(m, me, col, row)) Game.place(m, me, g, col, row);
    });
    // the tower's sheet: tap the tower
    await dock.down(p);
    for (let k = 0; k < 3 && await p.evaluate(() => { const t = document.getElementById('dock-toggle'); return !document.getElementById("panel").classList.contains("shut") && !!t && !t.hidden; }); k++) { await p.click('#dock-toggle'); await p.waitForTimeout(400); } // the round was changed behind the page's back: the drawer comes up again for the "new" round once, so put it down until it stays down
    { // tap it on the board
      const pt = await pb(() => {
        const { m, me, board3d } = window.__pb(), t = m.towers[me];
        if (!board3d) { const bx = document.getElementById('board').getBoundingClientRect(), sc = me === 1 ? Game.COLS - 1 - t.col : t.col, sr = me === 1 ? Game.ROWS - 1 - t.row : t.row; return [bx.left + (sc + 0.5) * bx.width / Game.COLS, bx.top + (sr + 0.5) * bx.height / Game.ROWS]; }
        const el = document.querySelector('.board3d canvas'), bx = el.getBoundingClientRect(); let sx = 0, sy = 0, n = 0;
        for (let y = bx.top; y < bx.bottom; y += 4) for (let x = bx.left; x < bx.right; x += 4) { const q = board3d.tileAt(x, y); if (q && q.col === t.col && q.row === t.row) { sx += x; sy += y; n++; } }
        return n ? [sx / n, sy / n] : null;
      });
      await p.mouse.click(...pt); await p.waitForTimeout(300);
    }
    const txt = await p.locator('#sheet').innerText().catch(() => '');
    check(/Mecha Tower/.test(txt) && /Minebots/.test(txt) && /Repairbots/.test(txt), 'the tower sheet shows the Mecha Tower and its bots' + (/Minebots/.test(txt) ? '' : ' (' + txt.replace(/\s+/g, ' ').slice(0, 300) + ')'));
    await p.screenshot({ path: `mecha-${board}-1-sheet.png` });
    await p.click('#sheet [data-tround="minebots"]'); await p.waitForTimeout(250);
    await p.click('#sheet [data-tround="repairbots"]'); await p.waitForTimeout(250);
    check(await pb(() => { const { m, me } = window.__pb(); return Game.troundOn(m, me, 'minebots') && Game.troundOn(m, me, 'repairbots'); }), 'both bought for this round');
    if (await p.locator('#sheet-back').isVisible()) { await p.click('#sheet #close'); await p.waitForTimeout(150); }
    await fight(`mecha-${board}-2-bots.png`, async () => {
      const s = await pb(() => { const { bt, me } = window.__pb(); return { drone: bt.bodies.some(x => x.side === me && x.u.kind === 'drone' && x.alive), bots: bt.bodies.filter(x => x.side === me && x.u.bot).length, mines: bt.mines().length }; });
      check(s.drone && s.bots === 4, `drone and 4 bots in the fight (${JSON.stringify(s)})`);
      if (board === '3d') check(await pb(() => window.__pb().board3d.drawn().some(x => x.kind === 'drone')), '3D: the drone is drawn');
    });
    // Core Awoken: an altar, built, with the skill bought
    await pb(() => {
      const { m, me } = window.__pb(), ui = m.units.findIndex(u => u.name === 'Altar of Build');
      m.unlocks[me][ui] = 1; m.gold[me] = 3000; m.extraDeploys[me] = 3;
      let sq = null;
      for (const row of Game.zoneRows(me).slice(2)) for (let col = 1; col < Game.COLS - 2 && !sq; col++) if (Game.canPlaceAt(m, me, col, row, ui) && Game.spotFree(m, me, col, row, ui)) sq = Game.place(m, me, ui, col, row);
      sq.built = true; sq.progress = 1;
      Game.buyBuildingSkill(m, me, 'sq' + sq.id, 'awoken');
    });
    await fight(`mecha-${board}-3-awoken.png`, async () => {
      const s = await pb(() => { const { bt, me } = window.__pb(); const t = bt.bodies.find(x => x.side === me && x.u.structure); return { awake: !!t.u.awake, speed: t.u.speed }; });
      check(s.awake && s.speed === 5, `the tower drives (${JSON.stringify(s)})`);
    });
    await p.close();
  }
  await b.close();
  console.log(fails ? `${fails} failed` : 'mecha-ui ok');
  process.exit(fails ? 1 : 0);
})();
