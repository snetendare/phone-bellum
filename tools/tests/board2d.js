// For the checks written for the 2D board (they tap #board by grid position, and snapshots.js hashes it): a browser
// context whose pages start on the 2D board, as if the player had chosen 2D in Settings. Needed since 3D is the
// default; it also covers a guest opening the host's invite link, which carries no board= of its own.
//   const ctx2d = require('./board2d');  ...  const p = await (await ctx2d(b, { viewport: ... })).newPage();
module.exports = async (browser, opts) => {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('phone-bellum-board', '2d'); } catch (e) {} });
  return ctx;
};
