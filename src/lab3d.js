// ===== 3D test page: real battles from the engine on the 3D board, to try the camera, the models and the renderer =====
// The page only runs the match; the drawing is src/render3d.js, which sees it through view() just as the game's 2D
// board does. Battle effects (fx) are made the same way as in the game.
const $ = (id) => document.getElementById(id);
const units = Shapes.assign(DATA.units).map(u => ({ ...Engine.withTraits(u), level: 0, bodies: Math.max(1, Math.round(u.bodies)), skillDefs: Engine.SLOTS.map(() => null) }));
const touch = matchMedia('(pointer: coarse)').matches;

// ---------- the match: AI armies on both sides; a fight is the engine's real battle ----------
let m = null, bt = null, phase = 'deploy', fx = [], acc = 0, result = null, hoverTile = null;
const DT = Game.SETTINGS.dt;
function newMatch() {
  m = Game.createMatch(units, DATA.matrix, (Math.random() * 1e9) >>> 0, $('map').value);
  deploy();
}
function deploy() {
  for (const s of [0, 1]) { Game.aiDeploy(m, s); Game.ensureTower(m, s); Game.ensurePack(m, s); }
  Game.settleTowerPicks(m);
  phase = 'deploy'; bt = null; fx = []; result = null;
  msg(`Round ${m.round} · deploy`);
}
// as the game's absorb(): this tick's shots and deaths become effects
function absorb() {
  for (const s of bt.lastShots()) if (s[8] > 0) fx.push({ kind: 'flame', x1: s[0], y1: s[1], x2: s[2], y2: s[3], side: s[4], half: s[8], age: 0, life: 0.3 });
  else if (s[10] === 1) fx.push({ kind: 'bolt', x1: s[0], y1: s[1], x2: s[2], y2: s[3], side: s[4], age: 0, life: 0.22 });
  else fx.push({ kind: s[7] === 1 ? 'heal' : 'shot', x1: s[0], y1: s[1], x2: s[2], y2: s[3], side: s[4], age: 0, life: s[7] === 1 ? 0.35 : 0.18 });
  for (const b of bt.bodies) if (!b.alive && !b._gone) { b._gone = true; fx.push({ kind: 'death', x: b.x, y: b.y, u: b.u, side: b.side, age: 0, life: 0.5 }); }
}
$('fight').addEventListener('click', () => {
  if (phase !== 'deploy') deploy();
  bt = Game.startBattle(m); phase = 'battle'; acc = 0; fx = []; msg('');
});
$('next').addEventListener('click', () => {
  if (phase === 'deploy') bt = Game.startBattle(m);
  if (!result) { while (bt.step()) {} result = bt.result(); }
  Game.resolve(m, result);
  if (m.over) { newMatch(); return; }
  deploy();
});
$('new').addEventListener('click', newMatch);
$('map').addEventListener('change', newMatch);

// ---------- the board ----------
const board = Render3D(THREE, $('view'), () => ({ m, me: 0, phase, units, mode: 'ai', bt, battlePre: m, fx, selected: null, moving: null, drag: null, hoverTile,
  editable: false, placingUnit: null, placingElf: false, placingTower: false }), {
  // a tap in the strategic view marks a tile, in the game's own column / row numbers
  onTap: (t) => { hoverTile = t; if (t) msg(`Tapped tile: column ${t.col + 1}, row ${t.row + 1}`); },
  onLevel: (lv) => { if (lv) hoverTile = null; },
});
function showLevel() { [...$('levels').children].forEach((c, k) => c.classList.toggle('on', k === board.camera.level())); }
$('help').textContent = touch
  ? 'Spread two fingers to go in · drag to look around · twist two fingers to rotate · tap to go back'
  : 'Scroll to go in or out · drag to look around · hold the right or middle button and drag to rotate (or Q / E) · click or Esc to go back';
let msgTimer = 0;
function msg(t) { $('msg').textContent = t; $('msg').hidden = !t; clearTimeout(msgTimer); if (t && t.startsWith('Tapped')) msgTimer = setTimeout(() => msg(''), 1800); }
window.addEventListener('resize', () => board.size());

// ---------- the loop ----------
let last = 0, fpsT = 0, fpsN = 0;
function frame(ts) {
  const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016; last = ts;
  if (phase === 'battle') {
    const speed = bt.time() > 20 ? 3 : 1.5;
    acc += dt * speed;
    while (acc >= DT) { acc -= DT; if (!bt.step()) break; absorb(); }
    for (const e of fx) e.age += dt * speed;
    fx = fx.filter(e => e.age < e.life);
    if (bt.isOver()) {
      result = bt.result(); phase = 'result'; fx = [];
      msg(result.winner === 0 ? `Round ${m.round}: blue wins` : result.winner === 1 ? `Round ${m.round}: red wins` : `Round ${m.round}: draw`);
    }
  }
  board.draw();
  showLevel();
  fpsN++; fpsT += dt;
  if (fpsT >= 0.5) {
    const n = bt ? bt.bodies.filter(b => b.alive).length : 0;
    $('stats').textContent = `${Math.round(fpsN / fpsT)} fps · ${n} bodies · ${board.info().calls} draws`; fpsN = 0; fpsT = 0;
  }
  requestAnimationFrame(frame);
}
board.size();
newMatch();
requestAnimationFrame(frame);
window.__lab3d = { board, get m() { return m; }, get bt() { return bt; }, get phase() { return phase; } }; // for tests
