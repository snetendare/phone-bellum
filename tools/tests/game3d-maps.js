// The game on the 3D board (?board=3d), map features and Charisma through the 3D board's taps:
// - Forest Clearing: a tap on the elf tower opens its sheet, Bribe; after 10 bribes, the next round, buying an elf
//   tower of your own and placing it with a tap on a tile of your zone (drawn as your spire), and a tap on it opens
//   the sheet again.
// - Frozen Peak (its extras switched back on for the check), round 2: a tap on the middle of the board opens the altar, ice walls and a Snowgre bought there (the
//   Snowgre drawn on your side).
// - Matteo: Give Charisma, then a tap on one of your squads gives it the first stack.
// Screenshots go to the current folder. Headless Chromium needs software WebGL (the args below), about 5-10 fps.
const { chromium } = require('playwright-core');
const dock = require('./dock'); // the phone layout's deploy drawer
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };

  async function game(map) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    await p.goto('http://127.0.0.1:8766/?test&board=3d');
    await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    await p.click('#settings summary'); await p.click(`[data-map="${map}"]`); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(400);
    await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(800);
    // the screen point at the middle of a tile (model columns / rows), found by asking the 3D board which tile is where
    const at = (c, r) => p.evaluate(([c, r]) => {
      const bd = window.__pb().board3d, el = document.querySelector('.board3d canvas'), bx = el.getBoundingClientRect(); let sx = 0, sy = 0, n = 0;
      for (let y = bx.top; y < bx.bottom; y += 4) for (let x = bx.left; x < bx.right; x += 4) { const t = bd.tileAt(x, y); if (t && t.col === c && t.row === r) { sx += x; sy += y; n++; } }
      return n ? [sx / n, sy / n] : null;
    }, [c, r]);
    const tap = async (c, r) => { await dock.down(p); const [x, y] = await at(c, r); await p.mouse.click(x, y); await p.waitForTimeout(300); };
    const sheet = async () => (await p.locator('#sheet-back').isVisible()) ? (await p.locator('#sheet-h').textContent()).trim() : null;
    const closeSheet = async () => { await p.click('#sheet #close'); await p.waitForTimeout(150); };
    const pb = (f, a) => p.evaluate(f, a);
    // a whole fight, then the next round
    const nextRound = async () => {
      await p.click('#fight'); await p.waitForTimeout(1000);
      if (await p.locator('#skip').count()) await p.click('#skip').then(() => p.click('#skip'));
      await p.waitForSelector('#next', { timeout: 60000 }); await p.click('#next'); await p.waitForTimeout(800);
    };
    // what the 3D board drew last frame
    const drawn = () => pb(() => { const bd = window.__pb().board3d; bd.draw(); return bd.drawn(); });
    return { p, at, tap, sheet, closeSheet, pb, nextRound, drawn };
  }

  // ---------- Forest Clearing: the elf tower ----------
  {
    const { p, tap, sheet, closeSheet, pb, nextRound, drawn } = await game('forest');
    // the elf tower stands on the line between the two middle rows; a tap on either of them counts
    const elf = await pb(() => ({ col: Game.elfSpot(window.__pb().m).col, row: Game.ROWS / 2 }));
    await tap(elf.col, elf.row);
    check(/Forest/.test(await sheet() || ''), `tap on the elf tower opens its sheet (${await sheet()})`);
    await pb(() => { const { m, me } = window.__pb(); m.gold[me] += 5000; });
    for (let k = 0; k < 10; k++) { await p.click('#bribe'); await p.waitForTimeout(80); }
    check(await pb(() => { const { m, me } = window.__pb(); return Game.bribeCount(m, me); }) === 10, 'bribed the elves 10 times from the sheet');
    await closeSheet();
    await nextRound();
    await tap(elf.col, elf.row);
    check(await p.locator('#buyelf').isEnabled().catch(() => false), 'round 2: the sheet offers an elf tower of your own');
    await p.click('#buyelf'); await p.waitForTimeout(300);
    if (await sheet()) await closeSheet();
    const spot = await pb(() => { const { m, me } = window.__pb(); for (const row of Game.zoneRows(me)) for (let c = 1; c < Game.COLS - 1; c++) if (Game.elfOwnSpotOk(m, me, c, row)) return [c, row]; return null; });
    await tap(...spot);
    const own = await pb(() => { const { m, me } = window.__pb(); return Game.elfOwnOf(m, me); });
    check(!!own && own.col === spot[0] && own.row === spot[1], `elf tower placed with a tap at ${spot}`);
    const me = await pb(() => window.__pb().me);
    check((await drawn()).some(s => s.spire && s.side === me), 'the 3D board draws your elf spire');
    await tap(...spot);
    check(/Forest/.test(await sheet() || ''), `a tap on your elf tower opens the sheet (${await sheet()})`);
    await p.screenshot({ path: 'game3d-maps-1-elf.png' });
    await p.context().close();
  }

  // ---------- Frozen Peak: the altar in round 2 ----------
  {
    const { p, tap, sheet, closeSheet, pb, nextRound, drawn } = await game('ice');
    await pb(() => { Game.MAPS.find(x => x.id === 'ice').iceOff = false; }); // switched off in the game for now (iceOff); on for this check
    await nextRound();
    check(await pb(() => Game.altarRound(window.__pb().m)), 'round 2: the altar is up');
    await pb(() => { const { m, me } = window.__pb(); m.gold[me] += 5000; });
    // the altar stands where four tiles meet in the middle; tap the one of them that's free
    const mid = await pb(() => { const { m, me } = window.__pb(); for (const [c, r] of [[5, 7], [6, 7], [5, 8], [6, 8]]) if (!Game.occupied(m, me, c, r) && !Game.hailTiles(m).some(h => h.col === c && h.row === r)) return [c, r]; return [5, 7]; });
    await tap(...mid);
    check(/altar/i.test(await sheet() || ''), `tap on the middle opens the altar (${await sheet()})`);
    await p.click('[data-altar="walls"]'); await p.waitForTimeout(200);
    await p.click('[data-altar="snowgre"]'); await p.waitForTimeout(200);
    const bought = await pb(() => { const { m, me } = window.__pb(); return ['walls', 'snowgre'].map(a => Game.altarCount(m, me, a)); });
    check(bought[0] === 1 && bought[1] === 1, `bought ice walls and a Snowgre (${bought})`);
    await closeSheet();
    const me = await pb(() => window.__pb().me);
    check((await drawn()).some(s => s.name === 'Snowgre' && s.side === me), 'the 3D board draws your Snowgre');
    await p.screenshot({ path: 'game3d-maps-2-altar.png' });
    await p.context().close();
  }

  // ---------- Matteo: Give Charisma ----------
  {
    const { p, tap, pb } = await game('standard');
    const sq = await pb(() => { const { m, me } = window.__pb(); m.chars[me] = 'matteo'; return m.armies[me].map(q => [q.col, q.row, q.id]); });
    // the panel was drawn before Matteo was forced in: pick a shop unit and drop it again to redraw it
    await dock.up(p); const u = p.locator('[data-i]:not([data-locked])').first(); await u.click(); await p.waitForTimeout(100); await p.click('#task-x'); await p.waitForTimeout(150);
    await dock.up(p); await p.click('#charm-btn'); await p.waitForTimeout(150);
    await tap(sq[0][0], sq[0][1]);
    const charm = await pb(() => { const { m, me } = window.__pb(); return m.armies[me].map(q => [q.id, q.charm || 0]); });
    check(charm.some(([id, c]) => id === sq[0][2] && c > 0) && await p.locator('#charm-undo').count() === 1, `Give Charisma, then a tap on a squad: ${JSON.stringify(charm)}`);
    await p.screenshot({ path: 'game3d-maps-3-charm.png' });
    await p.context().close();
  }

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
