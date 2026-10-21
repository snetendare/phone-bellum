// The tutorial, on both boards on a phone (390 x 744): the menu leads with it on a first visit; round 1 starts with only
// your tower (and the coach's ring on it), then one card; a pick puts the drawer down, a tap places; taking the squad
// back steps the coach back; the enemy tower shows up with Fight; the hidden archers win round 1 (your health drops);
// round 2 offers Fire Mage and Sniper, Sniper is turned away, Fire Mage wins the fight; the end saves the tutorial as
// done, and the menu then shows it as a small button. Screenshots go to the current folder.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  for (const board of ['2d', '3d']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 744 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    await p.goto(`http://127.0.0.1:8766/?test&board=${board}`);
    if (board === '3d') await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    const coach = () => p.evaluate(() => document.getElementById('coach').hidden ? '' : document.getElementById('coach-text').textContent);
    const st = () => p.evaluate(() => { const { m, me } = window.__pb(); return { round: m.round, hp: m.hp.slice(), mine: m.armies[me].length, foeTower: !!m.towers[1 - me], shut: document.getElementById('panel').classList.contains('shut'), cards: document.querySelectorAll('#shop .ucard').length, ring: !document.getElementById('coach-ring').hidden }; });
    const tap = async (c, r) => {
      if (board === '2d') { const bb = await p.locator('#board').boundingBox(); return p.mouse.click(bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16); }
      const [x, y] = await p.evaluate(([c, r]) => window.__pb().board3d.screenAt(c, r, 0), [c, r]); return p.mouse.click(x, y);
    };
    const wait = (ms = 400) => p.waitForTimeout(ms);
    check(await p.locator('#panel #tutorial.primary').count() === 1, `${board}: a first visit leads the menu with the tutorial`);
    await p.click('#tutorial'); await wait();
    let s = await st();
    check(/your Tower/.test(await coach()) && s.ring && s.mine === 0 && !s.foeTower && await p.evaluate(() => document.getElementById('panel').innerHTML === ''), `${board}: it starts with only your tower, a ring on it, no panel`);
    await p.click('#coach-btns .btn'); await wait();
    s = await st();
    check(/Goblin Swarm/.test(await coach()) && s.cards === 1 && !s.ring && await p.locator('#shop .ucard.tut-glow').count() === 1, `${board}: then one glowing card`);
    await p.click('#shop .ucard'); await wait();
    s = await st();
    check(/tap a tile/.test(await coach()) && s.shut && await p.evaluate(() => document.getElementById('task').hidden && document.getElementById('dock-toggle').hidden), `${board}: a pick puts the drawer down; no task line or pull tab`);
    await tap(5, 11); await wait();
    s = await st();
    check(s.mine === 1 && s.foeTower && /hidden until the fight/.test(await coach()) && await p.locator('#fight.tut-glow').count() === 1, `${board}: placed; the enemy tower and a glowing Fight show up`);
    await tap(5, 11); await wait();
    s = await st();
    check(s.mine === 0 && /Goblin Swarm/.test(await coach()), `${board}: taking the squad back steps the coach back`);
    await p.click('#shop .ucard'); await wait(); await tap(5, 11); await wait();
    await p.screenshot({ path: `tutorial-${board}-1.png` });
    await p.click('#fight'); await wait(600);
    check(await coach() === '', `${board}: no coach during the fight`);
    await p.click('#skip'); await wait();
    s = await st();
    check(s.round === 2 && s.hp[0] < 60 && s.hp[1] === 60 && /Round lost/.test(await coach()) && await p.locator('.hud .side.you.tut-glow').count() === 1, `${board}: round 1 is lost, your health glows (${s.hp})`);
    await p.click('#coach-btns .btn'); await wait();
    s = await st();
    check(s.cards === 2 && /Skeleton Archers/.test(await coach()), `${board}: round 2 offers two cards`);
    await p.click('#shop .ucard >> nth=1'); await wait();
    check(/Try Fire Mage/.test(await coach()) && !(await st()).shut, `${board}: Sniper is turned away with a hint`);
    await p.click('#shop .ucard >> nth=0'); await wait(); await tap(4, 12); await wait();
    await p.screenshot({ path: `tutorial-${board}-2.png` });
    await p.click('#fight'); await wait(600); await p.click('#skip'); await wait();
    s = await st();
    check(s.hp[1] < 60 && /Round won/.test(await coach()) && await p.evaluate(() => localStorage.getItem('phonebellum.tutorial.v1') === 'done'), `${board}: round 2 is won and the tutorial is saved as done (${s.hp})`);
    await p.click('#coach-btns .btn >> nth=0'); await wait();
    check(await coach() === '' && await p.locator('.card #tutorial').count() === 1 && await p.locator('#panel #tutorial').count() === 0, `${board}: Main menu; the tutorial is now a small button`);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
