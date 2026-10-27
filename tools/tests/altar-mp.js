// The Altar of Build in a live match: the host on the 2D board (with the Mechites loaded through Load units), the
// guest on the 3D board. The guest places an altar; the host gets it on the same block and keeps it hidden while
// deploying; after the fight both phones agree on how far it is built; the host's record (built in its fights) wins
// over what the guest sends; then a blessing the guest buys reaches the host.
// Needs the peer server (node tools/peer-server.js, port 9000) and the game on port 8766.
const { chromium } = require('playwright-core');
const R = require('../../src/default-roster.json'), F = require('../../src/factions.json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8766/?test&peerhost=127.0.0.1&peerport=9000';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const mk = async (n) => { const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); return p; };
  const inPhase = (p, name, timeout = 30000) => p.waitForFunction((n) => document.getElementById('phase').textContent === n, name, { timeout });
  const host = await mk('host'), guest = await mk('guest');
  const altarOf = (p) => p.evaluate(() => { const { m } = window.__pb(), s = m.armies[1].find(q => m.units[q.unit].name === 'Altar of Build'); return s ? JSON.stringify({ id: s.id, col: s.col, row: s.row, built: !!s.built, progress: Math.round((s.progress || 0) * 1000) / 1000 }) : null; });
  const send = async () => { await guest.evaluate(() => document.getElementById('ready').click()); await sleep(800); await guest.evaluate(() => document.getElementById('ready').click()); await sleep(800); };

  await host.goto(BASE);
  const roster = { goldCosts: true, settings: R.settings, skills: R.skills.concat(F.skills), units: [...F.factions[0].units, R.units.find(u => u.name === 'Skeleton Archers')] };
  await host.evaluate(() => document.getElementById('load-units').click()); await sleep(200);
  await host.fill('#roster-in', JSON.stringify(roster)); await host.click('#use-roster');
  await host.waitForSelector('#friend', { timeout: 90000 }); await sleep(300);
  await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto((await host.locator('#link').textContent()).replace('?', '?test&board=3d&'));
  await guest.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 20000 });
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#settings summary'); await host.click('[data-map="standard"]'); await host.click('#start');
  await inPhase(guest, 'Deploy'); await sleep(400);
  await host.dblclick('[data-pack="0"]'); await guest.dblclick('[data-pack="0"]'); await sleep(600);

  // the guest: a Cog Builder and an altar on a back block
  const placed = await guest.evaluate(() => {
    const { m, me } = window.__pb(), ix = (n) => m.units.findIndex(u => u.name === n), al = ix('Altar of Build'), cb = ix('Cog Builder');
    m.gold[me] += 3000; Game.unlock(m, me, al); Game.unlock(m, me, cb);
    let has = false;
    for (const row of Game.zoneRows(me).slice(0, 2)) for (let col = 2; col < Game.COLS - 2 && !has; col++) if (Game.spotFree(m, me, col, row) && Game.place(m, me, cb, col, row)) has = true;
    for (const row of Game.zoneRows(me)) for (let col = 1; col < Game.COLS - 2; col++) if (Game.canPlaceAt(m, me, col, row, al) && Game.spotFree(m, me, col, row, al) && Game.place(m, me, al, col, row)) return [col, row];
    return null;
  });
  check(!!placed, `the guest placed an altar at ${placed}`);
  await send();
  const h0 = await altarOf(host);
  check(!!h0 && JSON.parse(h0).col === placed[0] && JSON.parse(h0).row === placed[1], `the host has it on the same block (${h0})`);
  check(await host.evaluate(() => { const { m } = window.__pb(), s = m.armies[1].find(q => m.units[q.unit].name === 'Altar of Build'); return Game.blockOf(m, s.unit, s.col, s.row).every(([c, r]) => Game.occupied(m, 1, c, r)); }), 'its whole block is taken on the host');
  // a guest that claims its altar is built is not believed
  await guest.evaluate(() => { const { m } = window.__pb(); const s = m.armies[1].find(q => m.units[q.unit].name === 'Altar of Build'); s.built = true; s.progress = 1; });
  await send();
  check(!JSON.parse(await altarOf(host)).built, 'the host keeps its own record (not built)');
  await guest.evaluate(() => { const { m } = window.__pb(); const s = m.armies[1].find(q => m.units[q.unit].name === 'Altar of Build'); s.built = false; s.progress = 0; });

  await guest.click('#ready'); await host.click('#ready');
  await inPhase(guest, 'Battle', 15000); await sleep(2000);
  await host.click('#skip').then(() => host.click('#skip')).catch(() => {}); await guest.click('#skip').then(() => guest.click('#skip')).catch(() => {});
  await guest.waitForFunction(() => document.getElementById('phase').textContent !== 'Battle', null, { timeout: 60000 }); await sleep(500);
  // the host marks it built (as if the work was done) before the next round starts, so the guest can use it
  await host.evaluate(() => { const { m } = window.__pb(); const s = m.armies[1].find(q => m.units[q.unit].name === 'Altar of Build'); s.built = true; s.progress = 1; });
  await host.click('#next').catch(() => {}); await guest.click('#next').catch(() => {});
  await inPhase(guest, 'Deploy', 40000); await inPhase(host, 'Deploy', 40000); await sleep(600);
  const [h1, g1] = [await altarOf(host), await altarOf(guest)];
  check(h1 === g1 && JSON.parse(h1).built, `round 2: both agree (${h1})`);
  check(await guest.evaluate(() => { const { m, me } = window.__pb(), s = m.armies[me].find(q => m.units[q.unit].name === 'Altar of Build'); m.gold[me] += 500; return Game.buyBuildingSkill(m, me, 'sq' + s.id, 'blessing'); }), 'the guest buys Blessing of the Cycle');
  await send();
  check(await host.evaluate(() => { const { m } = window.__pb(), s = m.armies[1].find(q => m.units[q.unit].name === 'Altar of Build'); return Game.bskillOf(m, 1, 'sq' + s.id); }) === 'blessing', 'the host has the guest\'s blessing for this round');
  await b.close();
  console.log(fails ? `${fails} failed` : 'altar-mp ok');
  process.exit(fails ? 1 : 0);
})();
