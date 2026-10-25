// The tutorial, on both boards on a phone (390 x 744), then the range circle on a PC window.
// Tutorial: the menu leads with it on a first visit. Round 1: your zone blinks, then the coach's ring on your tower,
// then one card; a pick puts the drawer down, a tap places; taking the squad back steps the coach back; the enemy
// tower shows up with Fight; the hidden archers win (your health drops). Round 2: Fire Mage and Sniper, Sniper is turned
// away, Fire Mage wins. Round 3: the tower pick, a tap on your tower opens its sheet, a shop of five with the deployment
// cap (a squad picked stays picked); the result names the enemy's hidden Brute. Round 4: a squad ready to level up (the
// ring on it, a touch tap opens its sheet and the click after it doesn't close it, the sheet levels it), the flanks
// blink with the coach line between them and only a flank tile takes the next squad, Fight. Then the
// tutorial is saved as done and Keep playing hands the match to the AI with the full shop.
// Range: with the mouse over a squad (yours or the enemy's) while deploying, and over a body in a fight, a dotted circle
// shows its reach; off it, none. Screenshots go to the current folder.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const open = async (board, pc) => {
    const ctx = await b.newContext(pc ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } : { viewport: { width: 390, height: 744 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    await p.goto(`http://127.0.0.1:8766/?test&board=${board}`);
    if (board === '3d') await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    return { ctx, p };
  };
  const helpers = (p, board) => ({
    coach: () => p.evaluate(() => document.getElementById('coach').hidden ? '' : document.getElementById('coach-text').textContent),
    st: () => p.evaluate(() => { const { m, me } = window.__pb(); return { round: m.round, hp: m.hp.slice(), mine: m.armies[me].length, fresh: m.armies[me].filter(s => s.round === m.round).length, foeTower: !!m.towers[1 - me], shut: document.getElementById('panel').classList.contains('shut'), cards: document.querySelectorAll('#shop .ucard').length, ring: !document.getElementById('coach-ring').hidden, tiles: document.querySelectorAll('#marks .tut-tile').length, sheet: !document.getElementById('sheet-back').hidden, pick: !document.getElementById('pick').hidden }; }),
    pt: (c, r) => board === '2d'
      ? p.locator('#board').boundingBox().then(bb => [bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16])
      : p.evaluate(([c, r]) => window.__pb().board3d.screenAt(c, r, 0), [c, r]),
  });
  const wait = (p, ms = 400) => p.waitForTimeout(ms);

  for (const board of ['2d', '3d']) {
    const { ctx, p } = await open(board, false), { coach, st, pt } = helpers(p, board);
    const tap = async (c, r) => { const [x, y] = await pt(c, r); await p.mouse.click(x, y); await wait(p); };
    check(await p.locator('#panel #tutorial.primary').count() === 1, `${board}: a first visit leads the menu with the tutorial`);
    await p.click('#tutorial'); await wait(p);
    let s = await st();
    check(/deployment zone/.test(await coach()) && s.tiles === 59 && !s.ring && s.mine === 0 && !s.foeTower && await p.evaluate(() => document.getElementById('panel').innerHTML === ''), `${board}: first your zone blinks (${s.tiles} tiles), no panel`);
    await p.screenshot({ path: `tutorial-${board}-zone.png` });
    await p.click('#coach-btns .btn'); await wait(p);
    s = await st();
    check(/^This is your Tower\. Protect it\.$/.test(await coach()) && s.ring && s.tiles === 0 && s.cards === 0, `${board}: then your tower, "Protect it", a ring on it, still no panel`);
    await p.click('#coach-btns .btn'); await wait(p);
    s = await st();
    check(/Goblin Swarm/.test(await coach()) && s.cards === 1 && s.tiles === 0 && await p.locator('#shop .ucard.tut-glow').count() === 1, `${board}: then one glowing card`);
    await p.click('#shop .ucard'); await wait(p);
    s = await st();
    check(/tap a tile/.test(await coach()) && s.shut && await p.evaluate(() => document.getElementById('task').hidden && document.getElementById('dock-toggle').hidden), `${board}: a pick puts the drawer down; no task line or pull tab`);
    await tap(5, 11);
    s = await st();
    check(s.mine === 1 && s.foeTower && /opponent’s board/.test(await coach()), `${board}: placed; the enemy tower and Fight show up`);
    await tap(5, 11);
    check((await st()).mine === 1 && !(await st()).sheet, `${board}: a tap on the new squad doesn't take it back (and opens no sheet in the first rounds)`);
    await p.click('#unx button'); await wait(p);
    check((await st()).mine === 0 && /Goblin Swarm/.test(await coach()), `${board}: its X takes it back and steps the coach back`);
    await p.click('#shop .ucard'); await wait(p); await tap(5, 11);
    await p.click('#fight'); await wait(p, 600);
    check(await coach() === '' && await p.locator('[data-s="1"][aria-pressed="true"]').count() === 1, `${board}: no coach during the fight, which plays at 1x`);
    await p.click('#skip'); await wait(p);
    s = await st();
    check(s.round === 2 && s.hp[0] < 60 && /Round lost/.test(await coach()) && /\+300 gold/.test(await coach()), `${board}: round 1 is lost (${s.hp}), and the gold for next round is explained`);
    await p.click('#coach-btns .btn'); await wait(p);
    await p.click('#shop .ucard >> nth=1'); await wait(p);
    check(/Try Fire Mage/.test(await coach()), `${board}: Sniper is turned away with a hint`);
    await p.click('#shop .ucard >> nth=0'); await wait(p); await tap(4, 12);
    await p.click('#fight'); await wait(p, 600); await p.click('#skip'); await wait(p);
    s = await st();
    check(s.round === 3 && s.hp[1] < 60 && /Round won/.test(await coach()), `${board}: round 2 is won (${s.hp}), on to round 3`);
    // round 3: the tower, the deployment cap
    await p.click('#coach-btns .btn'); await wait(p);
    s = await st();
    check(s.pick && await coach() === '' && /outpost becomes a real tower/.test(await p.textContent('#pick')), `${board}: round 3 opens with the tower pick, its own line saying why`);
    check(await p.locator('[data-opt]').count() === 2 && await p.locator('[data-ttype="bastion"]').count() === 1 && await p.locator('[data-ttype="keep"]').count() === 1, `${board}: the offer is Bastion or Keep`);
    await p.click('[data-opt] >> nth=0'); await wait(p, 300);
    check(/takes more hits/.test(await p.textContent('#pick-det')), `${board}: with a short line on what each is good at`);
    await p.click('[data-opt] >> nth=0'); await wait(p);
    s = await st();
    check(!s.pick && /skill/.test(await coach()) && await p.locator('#t-skill.tut-glow').count() === 1, `${board}: then the tower's skill on a glowing panel button`);
    await p.click('#t-skill'); await wait(p);
    s = await st();
    check(/new squads/.test(await coach()) && s.cards === 5 && await p.locator('#buy-deploy').count() === 1 && await p.locator('#t-skill').count() === 0 && await p.locator('#fight').count() === 1, `${board}: bought; then the shop of five, +1 deployment and Fight`);
    check(/blue tab/.test(await coach()) && await p.locator('#dock-toggle.tut-glow').count() === 1, `${board}: on a phone, the blue tab glows and is explained`);
    await p.click('#shop .ucard >> nth=1'); await wait(p);
    check(await p.evaluate(() => { const t = document.getElementById('task'), row = document.getElementById('panel').lastElementChild; return !t.hidden && t.parentNode === row && row.firstElementChild.textContent.includes('gold') && !!row.querySelector('#task-x'); }), `${board}: a pick in the open shop shows the task line with its X, in the lowered drawer's last row after the gold`);
    await p.click('#task-text'); await wait(p);
    check(await p.evaluate(() => document.getElementById('task').hidden && !document.querySelector('#shop .ucard[aria-pressed="true"]')), `${board}: a tap anywhere on that line (its text, not just the X) stops placing`);
    await p.click('#shop .ucard >> nth=1'); await wait(p);
    await tap(3, 11); await tap(7, 11);
    s = await st();
    check(s.fresh === 2, `${board}: the picked squad stays picked: two placed (${s.fresh})`);
    await p.screenshot({ path: `tutorial-${board}-r3.png` });
    await p.click('#fight'); await wait(p, 600); await p.click('#skip'); await wait(p);
    check(/Brute/.test(await coach()), `${board}: the round 3 result names their hidden Brute`);
    // round 4: level up, flanks
    await p.click('#coach-btns .btn'); await wait(p);
    s = await st();
    check(s.round === 4 && /level up/.test(await coach()) && s.ring, `${board}: round 4: a squad can level up, the ring on it`);
    const ready = await p.evaluate(() => { const { m, me } = window.__pb(); const q = m.armies[me].find(s => Game.isReady(m, s)); return [q.col, q.row]; });
    const [rx, ry] = await pt(...ready);
    await p.evaluate(() => { window.__stray = 0; document.getElementById('sheet-back').addEventListener('click', () => window.__stray++); });
    await p.touchscreen.tap(rx, ry); await wait(p);
    check(await p.evaluate(() => !document.getElementById('sheet-back').hidden && window.__stray === 0), `${board}: a touch tap opens its sheet, and the click after it doesn't reach the sheet`);
    check(await p.locator('[data-act="lvl-up"]').count() === 1 && await p.locator('[data-act="sell"]').count() === 1, `${board}: its sheet has Level up, Move and Sell`);
    await p.click('[data-act="lvl-up"]'); await wait(p); await p.click('#close'); await wait(p);
    check(/Move/.test(await coach()) && /Skills/.test(await coach()), `${board}: then a line on Move, Sell and Skills`);
    await p.click('#coach-btns .btn'); await wait(p);
    s = await st();
    check(/flanks/.test(await coach()) && s.tiles > 0, `${board}: then the flanks blink (${s.tiles} tiles)`);
    const hid = await p.evaluate(() => { const c = document.getElementById('coach').getBoundingClientRect(); return [...document.querySelectorAll('#marks .tut-tile')].filter(t => { const r = t.getBoundingClientRect(); return r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top; }).length; });
    check(hid === 0, `${board}: the coach line covers none of them (${hid})`);
    await p.screenshot({ path: `tutorial-${board}-flank.png` });
    await p.click('#shop .ucard >> nth=0'); await wait(p);
    await tap(5, 12);
    check((await st()).fresh === 0, `${board}: a tile in your zone doesn't take it`);
    await tap(0, 6);
    s = await st();
    check(s.fresh === 1 && /Spend the rest/.test(await coach()), `${board}: a flank tile does (${s.fresh}), and the next line shows`);
    await p.click('#fight'); await wait(p, 600); await p.click('#skip'); await wait(p);
    check(/That’s the basics/.test(await coach()) && await p.evaluate(() => localStorage.getItem('phonebellum.tutorial.v1') === 'done'), `${board}: after round 4 the tutorial is saved as done`);
    await p.click('#coach-btns .btn >> nth=1'); await wait(p, 800);
    s = await st();
    check(s.round === 5 && /unlock for gold/.test(await coach()) && await p.locator('#panel .tiers').count() === 1 && await p.locator('#coach-x').isHidden(), `${board}: Keep playing: round 5 against the AI, the full shop, one line about it`);
    await p.screenshot({ path: `tutorial-${board}-handover.png` });
    await p.click('#coach-btns .btn'); await wait(p);
    check(await coach() === '', `${board}: Got it hides it`);
    await p.click('#shop .ucard[data-locked] >> nth=0'); await wait(p);
    const ub = await p.evaluate(() => { const b = document.getElementById('unlock'), r = b && b.getBoundingClientRect(), sh = document.getElementById('sheet').getBoundingClientRect(); return b ? { primary: b.classList.contains('primary'), h: Math.round(r.height), w: Math.round(r.width), sw: Math.round(sh.width), top: Math.round(r.top - sh.top) } : null; });
    check(!!ub && ub.primary && ub.h >= 40 && ub.w > ub.sw * 0.8 && ub.top < 160, `${board}: a locked card's Unlock is big, gold and near the top (${JSON.stringify(ub)})`);
    await p.click('#unlock'); await wait(p); await p.click('#unlock-yes'); await wait(p);
    check(await p.evaluate(() => /Unlocked/.test(document.getElementById('sheet').textContent)), `${board}: and it unlocks`);
    await p.click('#close'); await wait(p);
    await p.screenshot({ path: `tutorial-${board}-r5.png` });
    await ctx.close();
    const o = await open(board, false);
    await o.p.click('#tutorial'); await wait(o.p);
    await o.p.click('#coach-x'); await wait(o.p);
    check(await o.p.evaluate(() => document.getElementById('phase').textContent === 'Ready' && !!document.getElementById('friend')), `${board}: the X on the coach line leaves the tutorial`);
    await o.ctx.close();
  }

  // the range circle under the mouse, on a PC window
  for (const board of ['2d', '3d']) {
    const { ctx, p } = await open(board, true), { pt } = helpers(p, board);
    const tap = async (c, r) => { const [x, y] = await pt(c, r); await p.mouse.click(x, y); await wait(p); };
    const range = () => p.evaluate(() => { const e = document.querySelector('#marks .range'); if (!e) return null; const b = e.getBBox(); return { w: Math.round(b.width), stroke: e.style.stroke }; });
    const hover = async (c, r) => { const [x, y] = await pt(c, r); await p.mouse.move(x, y, { steps: 3 }); await wait(p, 300); };
    await p.click('#tutorial'); await wait(p); await p.click('#coach-btns .btn'); await wait(p); await p.click('#coach-btns .btn'); await wait(p);
    await p.click('#shop .ucard'); await wait(p); await tap(5, 11);
    await p.click('#fight'); await wait(p, 300); await p.click('#skip'); await wait(p); await p.click('#coach-btns .btn'); await wait(p);
    // round 2: your goblins (2 m reach) and their archers (19 m) in sight
    const tile = await p.evaluate(() => { const r = document.getElementById('wrap').getBoundingClientRect(); return r.width / 12; });
    await hover(5, 11); let g = await range();
    check(!!g && g.w > 0 && g.w < tile * 1.2, `${board}: over your goblins, a small circle (${g && g.w} px, a tile ${Math.round(tile)} px)`);
    await hover(6, 4); const a = await range();
    check(!!a && a.w > tile * 5 && a.stroke !== (g && g.stroke), `${board}: over their archers, a big one in their colour (${a && a.w} px)`);
    await p.screenshot({ path: `range-${board}-deploy.png` });
    await hover(1, 8);
    check(!(await range()), `${board}: over an empty tile, none`);
    await p.click('#shop .ucard >> nth=0'); await wait(p); await tap(4, 12);
    await p.click('#fight'); await p.click('[data-s="1"]'); await wait(p, 600);
    // a live body of yours, as a fractional tile (bodies move: ask for it, then hover it right away)
    const at = await p.evaluate(() => { const { bt, me } = window.__pb(), q = bt.bodies.find(x => x.alive && x.side === me && !x.u.structure); return [q.x / Game.TILE + (Game.COLS - 1) / 2, (Game.ROWS - 1) / 2 - q.y / Game.TILE]; });
    const [hx, hy] = board === '2d' ? await pt(at[0] - 0.5, at[1] - 0.5) : await pt(at[0], at[1]);
    await p.mouse.move(hx, hy); await wait(p, 120);
    const f = await range();
    check(!!f, `${board}: in the fight, over a body, its circle${f ? ` (${f.w} px)` : ''}`);
    await p.screenshot({ path: `range-${board}-fight.png` });
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
