// The Mechites' Altar of Build in the game, on the 2D board and on the 3D board (?board=3d): bought in the shop and
// placed on a 2x2 block with a tap, its unit sheet with the building block, Core Awoken bought for a round, and the
// fight with the awakened buildings. Needs the game served on port 8766. Screenshots go to the current folder.
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
    const fight = async (shot, mid) => {
      await p.click('#fight');
      await p.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 20000 });
      await p.waitForTimeout(board === '3d' ? 7000 : 5000);
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
    const roster = { goldCosts: true, settings: R.settings, skills: R.skills.concat(F.skills), units: [...F.factions[0].units, R.units.find(u => u.name === 'Skeleton Archers')] };
    await p.evaluate(() => document.getElementById('load-units').click()); await p.waitForTimeout(200);
    await p.fill('#roster-in', JSON.stringify(roster)); await p.click('#use-roster');
    await p.waitForSelector('#go', { timeout: 90000 }); await p.waitForFunction(() => document.getElementById('sheet-back').hidden, null, { timeout: 180000 }); // the AI's counter table for the loaded units is built first await p.waitForTimeout(300);
    await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(400);
    await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(800);
    // gold, the altar and a Cog Builder unlocked
    const ai = await pb(() => { const { m, me } = window.__pb(), ui = m.units.findIndex(u => u.name === 'Altar of Build'); m.gold[me] = 3000; m.unlocks[me][ui] = 1; m.unlocks[me][m.units.findIndex(u => u.name === 'Cog Builder')] = 1; return { ui, tier: Game.tierOf(m.units, ui) }; });
    // pick the altar in the shop, then tap the first tile of a free 2x2 block at the back of the zone
    await p.click(`[data-tier="${ai.tier}"]`).catch(() => {}); await p.waitForTimeout(200);
    await p.click(`#shop .ucard[data-i="${ai.ui}"]`); await p.waitForTimeout(200);
    const spot = await pb((ui) => { const { m, me } = window.__pb(); for (const row of Game.zoneRows(me).slice(3)) for (let col = 2; col < Game.COLS - 3; col++) if (Game.canPlaceAt(m, me, col, row, ui) && Game.spotFree(m, me, col, row, ui)) return [col, row]; return null; }, ai.ui);
    await tap(...spot);
    const sq = await pb((ui) => { const { m, me } = window.__pb(); return m.armies[me].find(s => s.unit === ui) || null; }, ai.ui);
    check(!!sq && sq.col === spot[0] && sq.row === spot[1], `altar placed on the block from ${spot}`);
    check(await pb(([ui, c, r]) => { const { m, me } = window.__pb(); return Game.blockOf(m, ui, c, r).every(([x, y]) => Game.occupied(m, me, x, y)); }, [ai.ui, ...spot]), 'its four tiles are taken');
    if (board === '3d') { await p.waitForFunction(() => window.__pb().board3d.drawn().some(x => x.building === 'altar' || x.name === 'Altar of Build'), null, { timeout: 5000 }).catch(() => {}); check(await pb(() => window.__pb().board3d.drawn().some(x => x.name === 'Altar of Build' && x.look === 'glass')), '3D: drawn as a see-through site'); }
    await p.screenshot({ path: `altar-${board}-1-placed.png` });
    // a Cog Builder to build it
    await pb(() => { const { m, me } = window.__pb(), ui = m.units.findIndex(u => u.name === 'Cog Builder'); for (const row of Game.zoneRows(me).slice(1, 3)) for (let col = 2; col < Game.COLS - 2; col++) if (Game.spotFree(m, me, col, row) && Game.place(m, me, ui, col, row)) return; });
    let res = await fight(`altar-${board}-2-building.png`);
    console.log('   result:', res.slice(0, 140));
    const st = await pb((ui) => { const { m, me } = window.__pb(); const s = m.armies[me].find(q => q.unit === ui); return { built: s.built, progress: s.progress }; }, ai.ui);
    console.log('   altar after round 1:', JSON.stringify(st));
    check(st.built || st.progress > 0, 'the altar was worked on');
    await pb((ui) => { const { m, me } = window.__pb(); const s = m.armies[me].find(q => q.unit === ui); s.built = true; s.progress = 1; m.gold[me] = Math.max(m.gold[me], 2000);
      if (!Game.buildingsOf(m, me).length) m.buildings[me].push({ id: 'factory', col: 1, row: Game.zoneRows(me)[4], round: 0, progress: 1, built: true, xp: 0, level: 0 }); }, ai.ui);
    // round 2: its unit sheet has the building block; buy Core Awoken
    await tap(...spot);
    check(/Altar of Build/.test(await sheet() || ''), `tap on it opens its sheet (${await sheet()})`);
    check(/Built/.test(await p.locator('#sheet').innerText()) && await p.locator('#sheet [data-bskill]').count() === 3, 'the sheet shows it built, with its three skills');
    await p.click('#sheet [data-bskill="awoken"]'); await p.waitForTimeout(250);
    check(await pb((ui) => { const { m, me } = window.__pb(); const s = m.armies[me].find(q => q.unit === ui); return Game.bskillOf(m, me, 'sq' + s.id); }, ai.ui) === 'awoken', 'Core Awoken bought for this round');
    await closeSheet();
    res = await fight(`altar-${board}-3-awoken.png`, board === '3d' ? async () => {
      const d = await pb(() => window.__pb().board3d.drawn().filter(x => x.side === window.__pb().me).map(x => x.name));
      check(d.includes('Altar of Build') && d.includes('Factory'), `3D: the altar and the factory fight (${[...new Set(d)].join(', ')})`);
    } : null);
    console.log('   result:', res.slice(0, 140));
    await p.close();
  }
  await b.close();
  console.log(fails ? `${fails} failed` : 'altar-ui ok');
  process.exit(fails ? 1 : 0);
})();
