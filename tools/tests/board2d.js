// For the checks written for the 2D board (they tap #board by grid position, and snapshots.js hashes it): a browser
// context whose pages start on the 2D board, as if the player had chosen 2D in Settings. Needed since 3D is the
// default; it also covers a guest opening the host's invite link, which carries no board= of its own.
// PB_BOARD=3d in the environment starts them on the 3D board instead, to see which checks hold there too (those that
// tap #board by grid position won't).
//   const ctx2d = require('./board2d');  ...  const p = await (await ctx2d(b, { viewport: ... })).newPage();
// ctx2d.tap(p, c, r) clicks the tile at screen grid column c, row r (0..11 left to right, 0..15 top to bottom, as the
// player sees it) on either board.
module.exports = async (browser, opts) => {
  const ctx = await browser.newContext(opts);
  // the checks were written for every unit, leader and tower, so they play with All units, not the Standard pack
  await ctx.addInitScript((b) => { try { localStorage.setItem('phone-bellum-board', b); if (!localStorage.getItem('pb-unit-pack')) localStorage.setItem('pb-unit-pack', 'all'); } catch (e) {} }, process.env.PB_BOARD === '3d' ? '3d' : '2d');
  return ctx;
};
module.exports.tap = async (p, c, r) => {
  const bb = await p.locator('#board').boundingBox();
  if (bb) return p.mouse.click(bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16);
  const [x, y] = await p.evaluate(([c, r]) => { const { me, board3d } = window.__pb(), f = me === 1; return board3d.screenAt(f ? Game.COLS - 1 - c : c, f ? Game.ROWS - 1 - r : r, 0); }, [c, r]);
  return p.mouse.click(x, y);
};
