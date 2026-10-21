// Package squads pre-placed and draggable; Move a squad (50 gold) from round 2. Screenshots go to the current folder.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const at = async (c, r) => { const b2 = await p.locator('#board').boundingBox(); return [b2.x + (c + .5) * b2.width / 12, b2.y + (r + .5) * b2.height / 16]; };
  const tap = async (c, r) => { const [x, y] = await at(c, r); await p.mouse.click(x, y); await p.waitForTimeout(120); };
  const dragT = async (c1, r1, c2, r2) => { const [x1, y1] = await at(c1, r1), [x2, y2] = await at(c2, r2); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await p.mouse.move(x2, y2, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(150); };
  const st = () => p.evaluate(() => { const { m, me } = window.__pb(); return { gold: m.gold[me], hp: m.hp, moved: m.moved, army: m.armies[me].map(s => ({ id: s.id, col: s.col, row: s.row, round: s.round, free: !!s.free, from: s.from })) }; });
  const hint = async () => (await p.locator('#panel .hint').first().textContent());
  await p.goto('http://127.0.0.1:8766/?test'); await p.waitForTimeout(500);
  await p.click('#settings summary'); await p.click('[data-tm="0"]'); await p.click('#go'); await p.waitForTimeout(300);
  await p.dblclick('[data-pack="0"]'); await p.waitForTimeout(200);
  let s = await st(); console.log('hp', s.hp, '| pre-placed', JSON.stringify(s.army));
  await tap(1, 15);
  console.log('hint:', await hint());
  const a = s.army[0];
  await dragT(a.col, a.row, 9, 14);
  s = await st(); console.log('dragged ->', JSON.stringify(s.army.map(q => [q.col, q.row])), 'gold', s.gold);
  await p.locator('#board').screenshot({ path: 'move-1-dragged.png' });
  await p.click('#fight'); await p.waitForTimeout(400); await p.click('#skip'); await p.waitForTimeout(300); await p.click('#next'); await p.waitForTimeout(300);
  s = await st(); console.log('round 2 hp', s.hp, 'gold', s.gold);
  await p.click('#move-btn'); await p.waitForTimeout(100); console.log('hint:', await hint());
  await tap(9, 14); console.log('hint:', await hint());
  await tap(5, 11);
  s = await st(); console.log('moved', JSON.stringify(s.army.find(q => q.from)), 'gold', s.gold, 'moved', s.moved);
  await p.locator('#board').screenshot({ path: 'move-2-moved.png' });
  await p.click('#undo-move'); s = await st(); console.log('undo -> gold', s.gold, 'moved', s.moved);
  await p.click('#move-btn'); await dragT(9, 14, 2, 12);
  s = await st(); console.log('drag in move mode ->', JSON.stringify(s.army.find(q => q.from)), 'gold', s.gold);
  await dragT(2, 12, 3, 12); s = await st(); console.log('re-drag same squad (free) ->', JSON.stringify(s.army.find(q => q.from)), 'gold', s.gold);
  const other = s.army.find(q => !q.from && q.round < 2);
  await dragT(other.col, other.row, 4, 12); s = await st(); console.log('drag another old squad blocked:', JSON.stringify(s.army.find(q => q.id === other.id)));
  await p.screenshot({ path: 'move-3-panel.png' });
  await b.close();
})();
