// Range rings, Level all, Skip asking first and Look at board, on both boards (a PC window), then
// Level all from a guest in a live match. Screenshots go to the current folder.
// - Range: the ring under the mouse and the ring of a tapped squad are the same circle (Game.squadReach: a Flame
//   Wizard's flame cone reaches 1.2x its range); in a fight a tapped body shows its ring too.
// - Level all: on the sheet when two or more level-ups of a unit's squads are paid for; most XP first, a squad with XP
//   for two levels gets its second on the next pass; it levels as many as the gold covers.
// - Skip to result asks first (a second tap skips); after the last round Look at board hides the end screen and Show
//   result brings it back.
// - Live: the guest's Level all reaches the host as single level-ups do (levels and gold).
// Needs the game on port 8766 and, for the live part, node tools/peer-server.js on port 9000.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const page = async (url, pc) => {
    const ctx = await b.newContext(pc ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { localStorage.setItem('pb-unit-pack', 'all'); } catch (e) {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    await p.goto(url);
    return p;
  };
  // a tile (model column, row) on the screen, on either board and for either side
  const scr = (p, c, r) => p.evaluate(([c, r]) => {
    const { me, board3d } = window.__pb();
    if (board3d) return board3d.screenAt(c, r, 0);
    const bb = document.getElementById('board').getBoundingClientRect(), f = me === 1;
    return [bb.left + ((f ? Game.COLS - 1 - c : c) + 0.5) * bb.width / Game.COLS, bb.top + ((f ? Game.ROWS - 1 - r : r) + 0.5) * bb.height / Game.ROWS];
  }, [c, r]);
  const hover = async (p, c, r) => { const [x, y] = await scr(p, c, r); await p.mouse.move(x, y, { steps: 3 }); await sleep(250); };
  const tapAt = async (p, c, r) => { const [x, y] = await scr(p, c, r); await p.mouse.click(x, y); await sleep(250); };
  // three Flame Wizard squads of yours on free tiles of your zone (unlocked, gold and deployments given), XP to level up
  const inject = (p, n, xps) => p.evaluate(([n, xps]) => {
    const { m, me } = window.__pb(), ui = m.units.findIndex(u => u.name === 'Flame Wizard');
    Game.ensureTower(m, me);
    m.gold[me] = 20000; m.extraDeploys[me] = (m.extraDeploys[me] || 0) + n;
    if (!Game.isUnlocked(m, me, ui)) Game.unlock(m, me, ui);
    const out = [];
    for (const row of Game.zoneRows(me).slice().reverse()) for (let col = 2; col < Game.COLS - 2 && out.length < n; col++) {
      if (!Game.canPlaceAt(m, me, col, row, ui) || !Game.spotFree(m, me, col, row, ui) || Game.towerAt(m, me, col, row)) continue;
      const sq = Game.place(m, me, ui, col, row);
      if (sq) { sq.xp = xps[out.length]; out.push({ id: sq.id, col, row }); }
    }
    return { ui, sq: out, cost: Game.levelCost(m.units[ui]) };
  }, [n, xps]);
  const redraw = async (p) => { await p.evaluate(() => window.__pbRedraw()); await sleep(300); }; // the panel and the board, after setting up a state
  const ring = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBBox(); return { w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
  const st = (p) => p.evaluate(() => { const { m, me } = window.__pb(); return { gold: m.gold[me], phase: document.getElementById('phase').textContent, lv: m.armies[me].map(s => [s.id, s.level]) }; });

  for (const board of ['2d', '3d']) {
    const p = await page(`http://127.0.0.1:8766/?test&board=${board}`, true);
    if (board === '3d') await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(400);
    await p.dblclick('[data-pack="0"]'); await sleep(300);
    const fw = await inject(p, 3, [19000, 18000, 17000]);
    await redraw(p);
    // 1. range: hover and tap give the same circle, a flame cone's reach included
    const [s0] = fw.sq;
    await hover(p, s0.col, s0.row);
    const hv = await ring(p, '#marks .range');
    const want = await p.evaluate(([id]) => { const { m, me } = window.__pb(); return Game.squadReach(m, me, m.armies[me].find(s => s.id === id)); }, [s0.id]);
    if (board === '2d') {
      const px = await p.evaluate(() => document.getElementById('board').getBoundingClientRect().width / (Game.COLS * Game.TILE));
      check(!!hv && Math.abs(hv.w - 2 * want * px) <= 2, `${board}: hover over a Flame Wizard: its reach ${want} m (15 m range × 1.2), ${hv && hv.w} px wide`);
    } else check(!!hv && hv.w > 0, `${board}: hover over a Flame Wizard: a ring (${hv && hv.w} px)`);
    await tapAt(p, s0.col, s0.row);
    check(await p.isVisible('#sheet'), `${board}: a tap opens its sheet`);
    check(await p.locator('#marks .range').count() === 1, `${board}: hovered and tapped: one ring, not two different ones`);
    const lvAll = await p.locator('[data-act="lvl-all"]').textContent().catch(() => null);
    check(/Level all 3 · /.test(lvAll || ''), `${board}: its sheet offers Level all (${lvAll})`);
    await p.click('#close'); await sleep(200);
    await hover(p, 1, 8); // off it: the tapped ring stays
    const tp = await ring(p, '#marks .range.tapped');
    check(!!tp && !!hv && Math.abs(tp.w - hv.w) <= 1 && Math.abs(tp.h - hv.h) <= 1, `${board}: the tapped ring is the hover ring (${tp && tp.w} vs ${hv && hv.w} px)`);
    await p.screenshot({ path: `upgrade-${board}-range.png` });
    // 2. level all: the order, then only as far as the gold goes
    const plan = await p.evaluate(([ids]) => { const { m, me } = window.__pb(); const q = m.armies[me].find(s => s.id === ids[2]); const keep = q.xp; q.xp = 1e9; const r = Game.levelAllPlan(m, me, q.unit); q.xp = keep; return r; }, [fw.sq.map(s => s.id)]);
    const ids = fw.sq.map(s => s.id);
    check(plan.slice(0, 3).join() === [ids[2], ids[0], ids[1]].join() && plan.slice(3).every(id => id === ids[2]) && plan.length > 3, `${board}: most XP first, a pass each; a squad with XP for more levels gets them on later passes (${plan.join(',')})`);
    await p.evaluate(([c]) => { const { m, me } = window.__pb(); m.gold[me] = 2 * c + 10; }, [fw.cost]);
    await redraw(p);
    await tapAt(p, s0.col, s0.row);
    const lv2 = await p.locator('[data-act="lvl-all"]').textContent().catch(() => null);
    check(new RegExp(`Level all 2 of 3 · ${2 * fw.cost} gold`).test(lv2 || ''), `${board}: gold for two of three: "${lv2}"`);
    await p.click('[data-act="lvl-all"]'); await sleep(250);
    let s = await st(p);
    const lvl = (id) => (s.lv.find(x => x[0] === id) || [])[1];
    check(s.gold === 10 && lvl(ids[0]) === 1 && lvl(ids[1]) === 1 && lvl(ids[2]) === 0, `${board}: Level all levels the two with the most XP and spends the gold (${s.gold} left, levels ${ids.map(lvl)})`);
    check(await p.locator('[data-act="lvl-all"]').count() === 0, `${board}: no Level all once the gold covers fewer than two`);
    await p.click('#close'); await sleep(200);
    // 5. skip asks first; a tapped body shows its ring in the fight
    await p.evaluate(() => { const { m } = window.__pb(); m.armies[1] = []; m.hp[1] = 1; }); // an empty enemy army on its last health: this fight ends the match
    await p.click('#fight'); await sleep(500);
    const body = await p.evaluate(() => { const { bt, me } = window.__pb(), q = bt.bodies.find(x => x.alive && x.side === me && x.u.name === 'Flame Wizard'); return [q.x / Game.TILE + (Game.COLS - 1) / 2, (Game.ROWS - 1) / 2 - q.y / Game.TILE]; });
    if (board === '2d') { const [x, y] = await scr(p, body[0] - 0.5, body[1] - 0.5); await p.mouse.click(x, y); } else { const [x, y] = await scr(p, body[0], body[1]); await p.mouse.click(x, y); }
    await sleep(60);
    const fr = await p.evaluate(() => ({ card: !!document.getElementById('bcard'), ring: document.querySelectorAll('#marks .range').length }));
    check(fr.card && fr.ring >= 1, `${board}: in the fight, a tapped body shows its card and its ring (${JSON.stringify(fr)})`);
    await p.click('#skip'); await sleep(150);
    check((await st(p)).phase === 'Battle' && /again/i.test(await p.textContent('#skip')), `${board}: Skip to result asks first ("${await p.textContent('#skip')}")`);
    await p.click('#skip'); await sleep(400);
    s = await st(p);
    check(s.phase === 'Match over' && await p.isVisible('#look'), `${board}: the second tap skips; the match is over, with Look at board`);
    // 4. look at the board, then back
    await p.click('#look'); await sleep(300);
    check(await p.isHidden('#overlay') && await p.isVisible('#end-back'), `${board}: Look at board hides the end screen; Show result is in the panel`);
    await p.screenshot({ path: `upgrade-${board}-look.png` });
    await p.click('#end-back'); await sleep(200);
    check(await p.isVisible('#overlay') && await p.isVisible('#look') && /Victory/.test(await p.textContent('#overlay')), `${board}: Show result brings it back`);
    await p.context().close();
  }

  // live: the guest levels all; the host gets the levels and the gold
  try {
    const BASE = 'http://127.0.0.1:8766/?test&board=2d&peerhost=127.0.0.1&peerport=9000';
    const host = await page(BASE, false);
    await host.click('#friend');
    await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
    const link = (await host.locator('#link').textContent()).replace('?', '?test&board=2d&');
    const guest = await page(link, false);
    await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
    await host.click('#start');
    await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 10000 });
    for (const pg of [host, guest]) {
      const picked = () => pg.evaluate(() => { const { m, me } = window.__pb(); return !!m && !Game.needsPack(m, me) && m.armies[me].length > 0; });
      for (let k = 0; k < 20 && !(await picked()); k++) { await pg.dblclick('[data-pack="0"]', { timeout: 2000 }).catch(() => {}); await sleep(400); }
    }
    await sleep(1500); // the host's picks reach the guest first (a sync would replace what the guest sets up below)
    const fw = await inject(guest, 3, [19000, 18000, 17000]);
    await redraw(guest);
    for (let k = 0; k < 4 && !(await guest.isVisible('[data-act="lvl-all"]')); k++) { // a sync from the host can redraw the board under the first tap
      if (await guest.isVisible('#sheet')) await guest.click('#close');
      await redraw(guest); await tapAt(guest, fw.sq[0].col, fw.sq[0].row);
    }
    await guest.click('[data-act="lvl-all"]'); await sleep(800);
    const g = await st(guest);
    const h = await host.evaluate(([ids]) => { const { m } = window.__pb(); return { gold: m.gold[1], lv: ids.map(id => (m.armies[1].find(s => s.id === id) || {}).level) }; }, [fw.sq.map(s => s.id)]);
    check(h.lv.join() === '1,1,1' && h.gold === g.gold, `live: the guest's Level all reaches the host (levels ${h.lv}, gold ${h.gold} = guest's ${g.gold})`);
    await host.context().close(); await guest.context().close();
  } catch (e) { check(false, 'live: ' + e.message.split('\n').slice(0, 3).join(' ')); }
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
