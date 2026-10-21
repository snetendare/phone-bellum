// The phone layout's deploy drawer (html.dock in the game): in a match on a phone the deploy panel is a drawer docked
// at the bottom that covers the lower part of the board while it's up. Checks that touch the board put it down first,
// and checks that use the shop or the panel's buttons bring it up.
//   const dock = require('./dock');  ...  await dock.down(p); (tap the board)  await dock.up(p); (click a card)
const state = (p) => p.evaluate(() => {
  const t = document.getElementById('dock-toggle'), shut = document.getElementById('panel').classList.contains('shut');
  return { on: document.documentElement.classList.contains('dock'), shut, toggle: !!t && !t.hidden };
});
module.exports = {
  down: async (p) => { const s = await state(p); if (s.on && !s.shut && s.toggle) { await p.click('#dock-toggle'); await p.waitForTimeout(150); } },
  up: async (p) => { const s = await state(p); if (s.on && s.shut && s.toggle) { await p.click('#dock-toggle'); await p.waitForTimeout(150); } },
};
