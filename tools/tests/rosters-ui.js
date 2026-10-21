// Match settings: Leaders and Units open as small menus; units left out never show up in the match (shop,
// packages, a friend's match). Counter Lab: several rosters, a new one starts empty, units import from another
// roster, rules switch mechanics off, and changes are saved per roster or for all; the game loads any saved roster.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const ctx = await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mk = async (n, c = ctx) => { const p = await c.newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); return p; };

  // ---- menu: Leaders and Units menus ----
  const p = await mk('menu');
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(400);
  await p.click('#settings summary');
  check(await p.locator('#pick-menu').isHidden(), 'menus folded away at first');
  await p.click('#pick-chars');
  check(await p.locator('#pick-menu [data-char]').count() > 3, 'Leaders opens the leader list');
  await p.click('#pick-units');
  check(await p.locator('#pick-menu [data-char]').count() === 0 && await p.locator('#pick-menu [data-unit]').count() > 10, 'Units swaps in the unit list');
  check(await p.locator('#pick-menu .units-tier').count() >= 3, 'units grouped by tier');
  await p.locator('#pick-menu').scrollIntoViewIfNeeded(); await p.screenshot({ path: 'units-menu.png' });
  for (const n of ['Goblin Swarm', 'Skeleton Archers', 'Brute']) await p.click(`[data-unit="${n}"]`);
  check((await p.textContent('#units-n')).startsWith(String(await p.locator('[data-unit]').count() - 3)), 'count shows 3 left out');
  await p.click('#pick-units');
  check(await p.locator('#pick-menu').isHidden(), 'tapping Units again folds it');
  await p.click('[data-tm="0"]'); await p.click('#go'); await sleep(400);
  const st = await p.evaluate(() => { const { m } = window.__pb(); const name = (i) => m.units[i].name; return { off: m.off.map(name), packs: m.packages.flat().flatMap(k => k.units.map(name)), shop: [...document.querySelectorAll('#shop .ucard .n')].map(x => x.textContent) }; });
  check(st.off.join() === 'Goblin Swarm,Skeleton Archers,Brute', 'match leaves the 3 units out: ' + st.off.join());
  check(!st.packs.some(n => st.off.includes(n)), 'no package has them');
  await p.dblclick('[data-pack="0"]'); await sleep(300);
  for (const t of await p.$$eval('[data-tier]', bs => bs.map(x => x.dataset.tier))) {
    await p.click(`[data-tier="${t}"]`); await sleep(80);
    const shop = await p.$$eval('#shop .ucard .n', xs => xs.map(x => x.textContent));
    if (shop.some(n => st.off.includes(n))) check(false, 'shop tier ' + t + ' shows a unit left out');
  }
  check(true, 'shop never lists them');
  const placed = await p.evaluate(() => { const { m, me } = window.__pb(); const i = m.units.findIndex(u => u.name === 'Brute'); m.gold[me] = 5000; return [Game.unlock(m, me, i), Game.place(m, me, i, 5, 12)]; });
  check(placed[0] === false && placed[1] === null, 'a unit left out can’t be unlocked or placed');

  // ---- Counter Lab: rosters ----
  const lab = await mk('lab');
  await lab.goto('http://127.0.0.1:8766/lab.html'); await sleep(600);
  check(await lab.locator('#roster-pick option').count() === 1, 'one roster at first');
  check(await lab.isDisabled('#save-one') && await lab.isDisabled('#save-all'), 'nothing to save yet');
  await lab.fill('#s-spacing', '4'); await sleep(100);
  check(await lab.textContent('#roster-status') === 'Unsaved changes' && !(await lab.isDisabled('#save-one')), 'an edit is an unsaved change');
  await lab.click('#roster-new'); await sleep(400);
  check(await lab.locator('#units details.unit').count() === 0, 'a new roster has no units');
  check(/No units yet/.test(await lab.textContent('#status')), 'table says no units yet');
  check(/Roster 1 · unsaved/.test(await lab.textContent('#roster-pick')), 'Roster 1 keeps its unsaved change');
  // import two units from the sample roster
  await lab.selectOption('#imp-from', ''); await lab.selectOption('#imp-unit', 'Rogue'); await lab.click('#imp-go'); await sleep(200);
  await lab.selectOption('#imp-unit', 'War Mammoth'); await lab.click('#imp-go'); await sleep(600);
  check(await lab.locator('#units details.unit').count() === 2, 'imported Rogue and War Mammoth');
  check(/Frenzy/.test(await lab.textContent('#units')), 'Rogue brings its skills (Frenzy)');
  check(/1 fight in/.test(await lab.textContent('#status')), 'table runs with two units: ' + await lab.textContent('#status'));
  await lab.click('[data-rule="stealth"]'); await sleep(400);
  check(!(await lab.isDisabled('#save-all')) && /\(2\)/.test(await lab.textContent('#save-all')), 'save all counts 2 rosters');
  await lab.click('#roster-rename'); await lab.fill('#roster-name', 'No stealth'); await lab.click('#rename-ok');
  await lab.click('#save-all'); await sleep(200);
  check(await lab.textContent('#roster-status') === 'Saved' && !/unsaved/.test(await lab.textContent('#roster-pick')), 'both saved: ' + await lab.textContent('#roster-msg'));
  // discard
  await lab.fill('#s-spacing', '5'); await sleep(100); await lab.click('#discard'); await sleep(300);
  check(await lab.inputValue('#s-spacing') === '3.5' && await lab.textContent('#roster-status') === 'Saved', 'discard goes back to the saved version');
  const book = await lab.evaluate(() => JSON.parse(localStorage.getItem('counterlab.rosters.v1')));
  check(book.rosters.length === 2 && book.rosters[1].saved.settings.rules.stealth === false && book.rosters[0].saved.settings.spacing === 4, 'book saved: 2 rosters, rules on the new one');
  await lab.reload(); await sleep(600);
  check(await lab.locator('#roster-pick option').count() === 2 && !(await lab.isChecked('[data-rule="stealth"]')), 'after reload: still 2 rosters and the rule');
  await lab.locator('#roster-h').scrollIntoViewIfNeeded(); await lab.screenshot({ path: 'lab-roster.png' });

  // ---- game: load a Counter Lab roster, its rules come along ----
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(400);
  await p.click('#settings summary'); await p.click('#load-units'); await sleep(200);
  check(await p.locator('#lab-pick option').count() === 2, 'game lists both Lab rosters');
  await p.selectOption('#lab-pick', { label: 'No stealth · 2 units' }); await p.click('#use-lab');
  await p.waitForFunction(() => /2 Counter Lab units/.test(document.getElementById('panel').textContent), null, { timeout: 10000 });
  await p.click('#settings summary').catch(() => {}); await p.click('[data-tm="0"]').catch(() => {}); await p.click('#go'); await sleep(300);
  const rules = await p.evaluate(() => window.__pb().m.rules);
  check(rules && rules.stealth === false, 'match carries the roster rules');

  // ---- friend match: the guest gets the units left out ----
  const c2 = await ctx2d(b, { viewport: { width: 390, height: 844 } });
  const host = await mk('host'), guest = await mk('guest', c2);
  const BASE = 'http://127.0.0.1:8766/?test&peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.evaluate(() => { localStorage.removeItem('phonebellum.units.v1'); localStorage.setItem('pb-off-units', JSON.stringify(['Brute'])); });
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto((await host.locator('#link').textContent()).replace('?', '?test&'));
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  await sleep(500);
  const gOff = await guest.evaluate(() => { const { m } = window.__pb(); return (m.off || []).map(i => m.units[i].name); });
  check(gOff.join() === 'Brute', 'guest’s match leaves Brute out too');
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
