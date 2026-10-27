// Live matches with one phone on the 2D board and the other on the 3D board: the 3D board never shows more of the
// opponent's side than the 2D board does, both ways round (a 3D guest against a 2D host, then a 3D host against a 2D
// guest). At each moment the 3D phone's two boards draw the same view (the 2D one on its hidden canvas), and the
// check compares what each drew of the opponent's side: squad bodies (by colour), stealthed ghosts (by shape), the
// tower's type and every coat of arms.
// Moments: round 1 while deploying (the opponent's new squads and leader hidden) and during the fight (a stealthed
// Rogue: a ghost without markers), round 2 while deploying, round 3, the tower pick, while deploying (the opponent's
// new tower type hidden) and in the fight. Then the guest leaves and opens the invite link again: it rejoins on its
// board, in the same round, and both countdowns agree.
// Needs the peer server (node tools/peer-server.js, port 9000) and the game on port 8766. Screenshots go to the
// current folder. Headless Chromium needs software WebGL (the args below) and runs at about 5-10 fps.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8766/?test&peerhost=127.0.0.1&peerport=9000';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  // the 2D phone has 2D saved (board2d.js); the 3D one forces 3D with ?board=3d
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); return p; };
  const phase = (p) => p.evaluate(() => document.getElementById('phase').textContent);
  const inPhase = (p, name, timeout = 30000) => p.waitForFunction((n) => document.getElementById('phase').textContent === n, name, { timeout });
  const on3d = (p) => p.evaluate(() => !!window.__pb().board3d);

  // what the 3D phone's two boards draw of the opponent's side, right now
  const seen = (p) => p.evaluate(() => {
    const { board, board3d, me } = window.__pb(), foe = 1 - me;
    const norm = (c) => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; return x.fillStyle; };
    const foeCol = norm(Art.teamCol(foe, me));
    const d2 = { bodies: [], ghosts: [], towers: [], crests: [] };
    const sb = Shapes.body, so = Shapes.outline, kp = Art.keep, af = Art.armsFlag;
    Shapes.body = function (ctx, shape, x, y, r, up, fill, team) { if (norm(team) === foeCol) d2.bodies.push(norm(fill)); return sb.apply(this, arguments); };
    Shapes.outline = function (ctx, shape) { if (norm(ctx.strokeStyle) === foeCol) d2.ghosts.push(shape); return so.apply(this, arguments); };
    Art.keep = function (ctx, x, y, s, c, hpr, kind, crest) { if (norm(c) === foeCol) { d2.towers.push(kind || 'keep'); if (crest) d2.crests.push(crest); } return kp.apply(this, arguments); };
    Art.armsFlag = function (g, id, x, y, w, edge) { if (norm(edge) === foeCol) d2.crests.push(id); return af.apply(this, arguments); };
    try { board.draw(); } finally { Shapes.body = sb; Shapes.outline = so; Art.keep = kp; Art.armsFlag = af; }
    board3d.draw();
    const d3 = { bodies: [], ghosts: [], towers: [], crests: [] }, marked = [];
    for (const s of board3d.drawn()) {
      if (s.crest && norm(s.edge) === foeCol) d3.crests.push(s.crest);
      if (s.side !== foe || s.spire || s.aloft) continue;
      if (s.structure) d3.towers.push(s.kind || 'keep');
      else if (s.look === 'ghostFoe') { d3.ghosts.push(s.shape); if (s.marked) marked.push(s.name); }
      else d3.bodies.push(norm(s.color));
    }
    for (const d of [d2, d3]) for (const k in d) d[k].sort();
    return { d2, d3, marked };
  });

  // one match; who: the phone on the 3D board ('guest' or 'host')
  async function match(who) {
    console.log(`--- 3D ${who}, 2D ${who === 'guest' ? 'host' : 'guest'}`);
    const host = await mk('host'), guest = await mk('guest');
    const v = who === 'guest' ? guest : host, o = who === 'guest' ? host : guest; // the 3D phone, its opponent
    const compare = async (what) => {
      const s = await seen(v), same = JSON.stringify(s.d2) === JSON.stringify(s.d3);
      const sum = (d) => `${d.bodies.length} bodies, ${d.ghosts.length} ghosts, tower ${d.towers.join('/') || '-'}, arms ${d.crests.join('/') || '-'}`;
      check(same, `${what}: 3D shows ${sum(s.d3)}${same ? ', as 2D' : `; 2D shows ${sum(s.d2)}`}`);
      if (!same) console.log('   2D', JSON.stringify(s.d2), '\n   3D', JSON.stringify(s.d3));
      if (s.marked.length) check(false, `${what}: markers on stealthed enemies in 3D (${s.marked.join(', ')})`);
      return s;
    };
    // the opponent places a squad of the named unit in its zone (unlocked and paid for here; a guest's side reaches
    // the host when it taps Ready)
    const oppPlaces = (name) => o.evaluate((name) => {
      const { m, me } = window.__pb(), ui = m.units.findIndex(u => u.name === name);
      m.gold[me] += 5000; Game.unlock(m, me, ui);
      for (const row of Game.zoneRows(me)) for (let col = 1; col < Game.COLS - 1; col++) if (!Game.occupied(m, me, col, row) && Game.place(m, me, ui, col, row)) return [col, row];
      return null;
    }, name);
    const fight = async (moments) => {
      await guest.click('#ready'); await host.click('#ready');
      await inPhase(v, 'Battle', 15000);
      for (const [ms, what] of moments) { await sleep(ms); if (await phase(v) === 'Battle') await compare(what); }
      await host.click('#skip').then(() => host.click('#skip')).catch(() => {}); await guest.click('#skip').then(() => guest.click('#skip')).catch(() => {});
      await v.waitForFunction(() => document.getElementById('phase').textContent !== 'Battle', null, { timeout: 60000 });
      await sleep(500);
    };
    const nextRound = async () => {
      await host.click('#next').catch(() => {}); await guest.click('#next').catch(() => {});
      await inPhase(guest, 'Deploy', 40000); await inPhase(host, 'Deploy', 40000); await sleep(600);
    };

    await host.goto(BASE + (who === 'host' ? '&board=3d' : '')); await host.click('#friend');
    await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
    const link = (await host.locator('#link').textContent()).replace('?', who === 'guest' ? '?test&board=3d&' : '?test&');
    await guest.goto(link);
    await v.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 20000 });
    await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
    await host.click('#settings summary'); await host.click('[data-map="standard"]'); await host.click('#start');
    await inPhase(guest, 'Deploy'); await sleep(400);
    check(await on3d(v) && !(await on3d(o)), `${who} on 3D, the other on 2D`);

    // round 1: the opponent's package and a Rogue (stealth) stay hidden while deploying, its leader too
    await host.dblclick('[data-pack="0"]'); await guest.dblclick('[data-pack="0"]'); await sleep(600);
    check(!!(await oppPlaces('Rogue')), 'the opponent placed a Rogue');
    await sleep(400);
    let s = await compare('round 1, deploying');
    check(!s.d3.bodies.length && !s.d3.crests.length, 'round 1, deploying: none of the opponent\'s new squads, no leader arms');
    await v.screenshot({ path: `foe3d-${who}-1-deploy.png` });
    await fight([[300, 'round 1, fight start'], [1500, 'round 1, fight']]);
    s = await compare('round 1, result');
    await v.screenshot({ path: `foe3d-${who}-2-result.png` });

    // round 2: last round's squads show, a new one doesn't
    await nextRound();
    await oppPlaces('Brute');
    await sleep(400);
    s = await compare('round 2, deploying');
    check(s.d3.crests.length > 0, 'round 2, deploying: the opponent\'s leader arms show');
    await fight([[500, 'round 2, fight']]);

    // round 3: both pick a tower; the opponent's type stays hidden while deploying, and shows in the fight
    await nextRound();
    for (const p of [host, guest]) { await p.click('[data-opt] >> nth=1', { timeout: 10000 }); await p.click('#pick-go', { timeout: 5000 }); await sleep(300); }
    await sleep(600);
    const oppType = await o.evaluate(() => { const { m, me } = window.__pb(); return Game.towerType(m, me).id; });
    s = await compare('round 3, deploying');
    check(s.d3.towers.length === 1 && s.d3.towers[0] === 'outpost', `round 3, deploying: the opponent's ${oppType} still looks like an outpost (3D: ${s.d3.towers.join('/')})`);
    await v.screenshot({ path: `foe3d-${who}-3-towers.png` });
    await fight([[500, 'round 3, fight']]);
    s = await compare('round 3, result');
    check(s.d3.towers[0] === oppType, `round 3, after the fight: the opponent's tower shows as ${s.d3.towers.join('/')}`);

    // round 4: the guest leaves and opens the invite link again
    await nextRound();
    const round = await host.evaluate(() => window.__pb().m.round);
    await guest.goto('about:blank'); await sleep(1500);
    await guest.goto(link);
    await guest.waitForFunction((r) => window.__pb && window.__pb().m && window.__pb().m.round === r && document.getElementById('phase').textContent === 'Deploy', round, { timeout: 30000 });
    if (who === 'guest') await guest.waitForFunction(() => window.__pb().board3d, null, { timeout: 15000 });
    await sleep(1500);
    check(await on3d(v) && !(await on3d(o)), `rejoined in round ${round}, each phone on its board`);
    const clocks = async () => Promise.all([host, guest].map(p => p.evaluate(() => { const t = document.getElementById('clock').textContent, k = /(\d+):(\d+)/.exec(t); return k ? +k[1] * 60 + +k[2] : null; })));
    const [hc, gc] = await clocks();
    check(hc != null && gc != null && Math.abs(hc - gc) <= 2, `countdowns agree after the rejoin: host ${hc} s, guest ${gc} s`);
    await compare(`round ${round}, deploying after the rejoin`);
    await host.context().close(); await guest.context().close();
  }

  await match('guest');
  await match('host');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
