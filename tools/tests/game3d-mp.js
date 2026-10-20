// A full round of a live match with both phones on the 3D board, all through the 3D board's taps and drags: each
// player takes a start package, drags a package squad to another tile and places a unit from the shop; the host gets
// the guest's squads where the guest put them; both tap Ready, the fight plays on both phones and ends the same on
// both (health, squads and gold), and Next round brings both to round 2.
// Needs the peer server (node tools/peer-server.js, port 9000) and the game on port 8766. Screenshots go to the
// current folder. Headless Chromium needs software WebGL (the args below) and runs at about 5-10 fps.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const mk = async (n) => { const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); return p; };
  const host = await mk('host'), guest = await mk('guest');
  const inPhase = (p, name, timeout = 30000) => p.waitForFunction((n) => document.getElementById('phase').textContent === n, name, { timeout });

  // the screen point at the middle of a tile (model columns / rows), found by asking that phone's 3D board
  const at = (p, c, r) => p.evaluate(([c, r]) => {
    const bd = window.__pb().board3d, el = document.querySelector('.board3d canvas'), bx = el.getBoundingClientRect(); let sx = 0, sy = 0, n = 0;
    for (let y = bx.top; y < bx.bottom; y += 4) for (let x = bx.left; x < bx.right; x += 4) { const t = bd.tileAt(x, y); if (t && t.col === c && t.row === r) { sx += x; sy += y; n++; } }
    return n ? [sx / n, sy / n] : null;
  }, [c, r]);
  const tap = async (p, c, r) => { const [x, y] = await at(p, c, r); await p.mouse.click(x, y); await sleep(250); };
  const dragT = async (p, c1, r1, c2, r2) => { const [x1, y1] = await at(p, c1, r1), [x2, y2] = await at(p, c2, r2); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await p.mouse.move(x2, y2, { steps: 4 }); await p.mouse.up(); await sleep(500); };
  const army = (p, side) => p.evaluate((sd) => { const { m, me } = window.__pb(); const s = sd == null ? me : sd; return m.armies[s].map(q => ({ id: q.id, unit: q.unit, col: q.col, row: q.row })); }, side);
  const free = (p, ui) => p.evaluate((ui) => { const { m, me } = window.__pb(), out = []; for (const row of Game.zoneRows(me)) for (let col = 1; col < Game.COLS - 1; col++) if (!Game.occupied(m, me, col, row) && Game.canPlaceAt(m, me, col, row, ui)) out.push([col, row]); return out; }, ui);

  // both on 3D
  const BASE = 'http://127.0.0.1:8766/?test&board=3d&peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto((await host.locator('#link').textContent()).replace('?', '?test&board=3d&'));
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#settings summary'); await host.click('[data-map="standard"]'); await host.click('#start');
  await inPhase(guest, 'Deploy'); await sleep(400);
  for (const p of [host, guest]) await p.waitForFunction(() => window.__pb().board3d, null, { timeout: 15000 });
  check(true, 'both phones on the 3D board');

  // each player: a start package, a package squad dragged, a unit from the shop placed with a tap
  const placed = {};
  for (const [name, p] of [['host', host], ['guest', guest]]) {
    await p.dblclick('[data-pack="0"]'); await sleep(800);
    const a = await army(p), pk = a[0];
    const [to] = await free(p, pk.unit);
    await dragT(p, pk.col, pk.row, ...to);
    const a2 = await army(p);
    check(a2.some(q => q.id === pk.id && q.col === to[0] && q.row === to[1]), `${name}: package squad dragged to ${to}`);
    const card = p.locator('#shop .ucard[aria-disabled="false"]:not([data-locked])').first();
    const ui = +(await card.getAttribute('data-i')); await card.click(); await sleep(150);
    const [t] = await free(p, ui);
    await tap(p, ...t);
    await p.evaluate(() => { const c = document.querySelector('#shop .ucard[aria-pressed="true"]'); if (c) c.click(); }); await sleep(150);
    const a3 = await army(p), sq = a3.find(q => q.unit === ui && q.col === t[0] && q.row === t[1]);
    check(!!sq, `${name}: shop unit placed with a tap at ${t}`);
    placed[name] = a3;
  }
  await guest.screenshot({ path: 'game3d-mp-1-guest.png' });
  // the host has the guest's squads where the guest put them
  await sleep(800);
  const atHost = await army(host, 1);
  const same = (x, y) => JSON.stringify(x.map(q => [q.id, q.unit, q.col, q.row]).sort()) === JSON.stringify(y.map(q => [q.id, q.unit, q.col, q.row]).sort());
  check(same(atHost, placed.guest), `the host has the guest's ${placed.guest.length} squads where the guest put them`);

  // Ready on both: the fight plays on both phones and ends the same
  await guest.click('#ready'); await host.click('#ready');
  await inPhase(guest, 'Battle', 15000); await inPhase(host, 'Battle', 15000);
  check(true, 'the fight starts on both phones');
  await sleep(1500);
  await host.screenshot({ path: 'game3d-mp-2-host-fight.png' });
  await host.click('#skip').catch(() => {}); await guest.click('#skip').catch(() => {});
  for (const p of [host, guest]) await p.waitForFunction(() => document.getElementById('phase').textContent !== 'Battle', null, { timeout: 60000 });
  await sleep(800);
  const after = (p) => p.evaluate(() => { const { m } = window.__pb(); return { round: m.round, hp: m.hp, gold: m.gold, armies: m.armies.map(a => a.map(q => [q.id, q.unit, q.col, q.row, q.xp || 0, q.level || 0])) }; });
  const ha = await after(host), ga = await after(guest);
  check(JSON.stringify(ha) === JSON.stringify(ga), `the fight ends the same on both phones: health ${JSON.stringify(ha.hp)}, gold ${JSON.stringify(ha.gold)}`);
  if (JSON.stringify(ha) !== JSON.stringify(ga)) console.log('   host', JSON.stringify(ha), '\n   guest', JSON.stringify(ga));

  // Next round on both
  await host.click('#next').catch(() => {}); await guest.click('#next').catch(() => {});
  await inPhase(guest, 'Deploy', 40000); await inPhase(host, 'Deploy', 40000);
  const rounds = await Promise.all([host, guest].map(p => p.evaluate(() => window.__pb().m.round)));
  check(rounds[0] === 2 && rounds[1] === 2, `both phones in round 2 (${rounds})`);

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
