// The Mechites' Factory in a live match: the host on the 2D board (with the Mechites loaded through Load units), the
// guest on the 3D board. The guest places a Cog Builder and a Factory; the host keeps the new factory hidden while
// deploying; after the fight both phones agree on how far it is built; then the guest buys a Cogbot Fighter from it
// and the host's fight makes it.
// Needs the peer server (node tools/peer-server.js, port 9000) and the game on port 8766. Screenshots go to the
// current folder. Headless Chromium needs software WebGL (the args below).
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
  const fight = async (during) => {
    await guest.click('#ready'); await host.click('#ready');
    await inPhase(guest, 'Battle', 15000);
    if (during) await during();
    await host.click('#skip').catch(() => {}); await guest.click('#skip').catch(() => {});
    await guest.waitForFunction(() => document.getElementById('phase').textContent !== 'Battle', null, { timeout: 60000 });
    await sleep(500);
    await host.click('#next').catch(() => {}); await guest.click('#next').catch(() => {});
    await inPhase(guest, 'Deploy', 40000); await inPhase(host, 'Deploy', 40000); await sleep(600);
  };
  const factory = (p, side) => p.evaluate((side) => JSON.stringify(Game.buildingsOf(window.__pb().m, side).map(b => ({ id: b.id, col: b.col, row: b.row, built: b.built, progress: Math.round(b.progress * 1000) / 1000 }))), side);

  // the host loads the Mechites (and Skeleton Archers) and opens a lobby; the units go to the guest with the match
  await host.goto(BASE);
  const roster = { goldCosts: true, settings: R.settings, skills: R.skills.concat(F.skills), units: [...F.factions[0].units, { ...R.units.find(u => u.name === 'Skeleton Archers'), hit: 14 }] }; // archers at their old hit: the round 2 fight lasts long enough for the Cogbot to fight
  await host.evaluate(() => document.getElementById('load-units').click()); await sleep(200);
  await host.fill('#roster-in', JSON.stringify(roster)); await host.click('#use-roster');
  await host.waitForSelector('#friend', { timeout: 60000 }); await sleep(300);
  await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto((await host.locator('#link').textContent()).replace('?', '?test&board=3d&'));
  await guest.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 20000 });
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#settings summary'); await host.click('[data-map="standard"]'); await host.click('#start');
  await inPhase(guest, 'Deploy'); await sleep(400);
  await host.dblclick('[data-pack="0"]'); await guest.dblclick('[data-pack="0"]'); await sleep(600);

  // the guest: a Cog Builder, then the Factory on a back tile
  const placed = await guest.evaluate(() => {
    const { m, me } = window.__pb(), ui = m.units.findIndex(u => u.name === 'Cog Builder');
    m.gold[me] += 3000; Game.unlock(m, me, ui);
    let sq = null;
    for (const row of Game.zoneRows(me).slice(0, 2)) for (let col = 2; col < Game.COLS - 2 && !sq; col++) if (!Game.occupied(m, me, col, row)) sq = Game.place(m, me, ui, col, row);
    for (const row of Game.zoneRows(me).slice(4)) for (let col = 2; col < Game.COLS - 2; col++) if (Game.buyBuilding(m, me, ui, 0, col, row)) return [col, row];
    return null;
  });
  check(!!placed, `the guest placed a factory at ${placed}`);
  await guest.evaluate(() => document.getElementById('ready').click()); await sleep(800); // send the side
  await guest.evaluate(() => document.getElementById('ready').click()); await sleep(800); // and not ready again
  const onHost = await factory(host, 1);
  check(/"col":/.test(onHost), `the host has the guest's factory (${onHost})`);
  check(await host.evaluate(() => { const { m } = window.__pb(), b = Game.buildingsOf(m, 1)[0]; return !!b && !Game.buildingShown(m, 0, true, 1, b); }), 'the host doesn\'t show it while deploying');
  await guest.screenshot({ path: 'factory-mp-1-guest.png' });

  await fight();
  const [h1, g1] = [await factory(host, 1), await factory(guest, 1)];
  check(h1 === g1 && /"progress":(0\.\d|1)/.test(h1), `after the fight both agree: ${h1}`);
  const built = JSON.parse(h1)[0].built;
  check(built, 'built in the fight (it survived and its builder worked on it)');

  // round 2: the guest buys a Cogbot Fighter from it; the host's fight makes it
  if (built) {
    check(await guest.evaluate(() => { const { m, me } = window.__pb(); m.gold[me] += 500; return Game.buyBuildingSkill(m, me, 'factory', 'fighter'); }), 'the guest buys a Cogbot Fighter');
    await fight(async () => {
      let names = []; // fights run at 1x and software WebGL is slow: wait for the Cogbot to come out
      for (let k = 0; k < 80 && !names.includes('Cogbot Fighter'); k++) { await sleep(500); names = await guest.evaluate(() => window.__pb().board3d.drawn().filter(x => x.side === 1).map(x => x.name)); }
      check(names.includes('Cogbot Fighter') && names.includes('Factory'), `the guest's 3D board shows its Factory and Cogbot Fighter (${[...new Set(names)].join(', ')})`);
      await guest.screenshot({ path: 'factory-mp-2-fighter.png' });
    });
    const last = await host.evaluate(() => { const { m } = window.__pb(); const h = m.history[m.history.length - 1]; return { round: h.round, dealt: h.dealtBy[1], made: Game.buildingsOf(m, 1)[0] }; });
    console.log('   host, round', last.round, 'guest dealt', JSON.stringify(last.dealt), 'factory', JSON.stringify(last.made));
    check(last.round === 2 && (last.dealt.some(r => r.key === 'b:factory') || last.made.xp > 0), 'the host\'s fight made the guest\'s Cogbot Fighter (it shows in the damage stats, or the factory earned XP)');
  }
  await b.close();
  console.log(fails ? `${fails} failed` : 'factory-mp ok');
  process.exit(fails ? 1 : 0);
})();
