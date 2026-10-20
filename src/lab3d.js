// ===== 3D test page: real battles from the engine on the 3D board, to try the camera, the models and the renderer =====
// The page only runs the match; the drawing is src/render3d.js, which sees it through view() just as the game's 2D
// board does. Battle effects (fx) are made the same way as in the game.
// You deploy blue (or leave it to the AI): pick a unit in the shop and tap a tile in the strategic view, tap a squad
// from this round to take it back, drag it to move it, and in round 1 place the tower first. Red is always the AI.
const $ = (id) => document.getElementById(id);
const units = Shapes.assign(DATA.units).map(u => ({ ...Engine.withTraits(u), level: 0, bodies: Math.max(1, Math.round(u.bodies)), skillDefs: Engine.SLOTS.map(() => null) }));
const touch = matchMedia('(pointer: coarse)').matches;

// ---------- the match: AI armies on both sides; a fight is the engine's real battle ----------
let m = null, bt = null, phase = 'deploy', fx = [], acc = 0, result = null, hoverTile = null;
let extra = {}; // for tests: view fields to set (selected, placingUnit, placingTower, ...)
let player = true;  // you deploy blue; false: the AI deploys both sides
const RICH = 1e6;   // blue's gold while you deploy: as good as unlimited, kept topped up (the AI plays red as usual)
let selected = null, drag = null, dragEndAt = 0; // the shop pick, and a squad being dragged to another tile
const DT = Game.SETTINGS.dt;
function newMatch() {
  m = Game.createMatch(units, DATA.matrix, (Math.random() * 1e9) >>> 0, $('map').value);
  deploy();
}
function deploy() {
  for (const s of player ? [1] : [0, 1]) aiSide(s);
  if (player && Game.needsPack(m, 0)) Game.choosePack(m, 0, 0); // the first package: its squads go straight on the board
  phase = 'deploy'; bt = null; fx = []; result = null; selected = null; drag = null;
  msg(`Round ${m.round} · deploy`);
  shop();
}
function aiSide(s) { Game.aiDeploy(m, s); Game.ensureTower(m, s); Game.ensurePack(m, s); }
// before a fight: whatever blue left undone (the tower, package squads) is filled in, and tower types settle
function fight() {
  if (phase !== 'deploy') deploy();
  Game.ensureTower(m, 0); Game.ensurePack(m, 0); Game.settleTowerPicks(m);
  selected = null; drag = null;
  bt = Game.startBattle(m);
}
// as the game's absorb(): this tick's shots and deaths become effects
function absorb() {
  for (const s of bt.lastShots()) if (s[8] > 0) fx.push({ kind: 'flame', x1: s[0], y1: s[1], x2: s[2], y2: s[3], side: s[4], half: s[8], age: 0, life: 0.3 });
  else if (s[10] === 1) fx.push({ kind: 'bolt', x1: s[0], y1: s[1], x2: s[2], y2: s[3], side: s[4], age: 0, life: 0.22 });
  else fx.push({ kind: s[7] === 1 ? 'heal' : 'shot', x1: s[0], y1: s[1], x2: s[2], y2: s[3], side: s[4], age: 0, life: s[7] === 1 ? 0.35 : 0.18 });
  for (const b of bt.bodies) if (!b.alive && !b._gone) { b._gone = true; fx.push({ kind: 'death', x: b.x, y: b.y, u: b.u, side: b.side, age: 0, life: 0.5 }); }
}
$('fight').addEventListener('click', () => {
  fight(); phase = 'battle'; acc = 0; fx = []; msg(''); shop();
});
$('next').addEventListener('click', () => {
  if (phase === 'deploy') fight();
  if (!result) { while (bt.step()) {} result = bt.result(); }
  Game.resolve(m, result);
  if (m.over) { newMatch(); return; }
  deploy();
});
$('new').addEventListener('click', newMatch);
$('map').addEventListener('change', newMatch);
$('who').addEventListener('change', () => { player = $('who').value === 'you'; newMatch(); });
$('auto').addEventListener('click', () => { if (phase === 'deploy') { aiSide(0); selected = null; shop(); } });

// ---------- deploying blue: the shop and the board input (as the game's, without its sheets and abilities) ----------
const ME = 0;
const placingTower = () => player && phase === 'deploy' && Game.needsTower(m, ME);
function placingUnit() {
  if (selected !== null) return selected;
  const sq = drag && drag.moved && m.armies[ME].find(s => s.id === drag.id);
  return sq ? sq.unit : null;
}
function shop() {
  const on = player && phase === 'deploy';
  $('shop').hidden = !on; help();
  if (!on) return;
  m.gold[ME] = Math.max(m.gold[ME], RICH);
  const free = Game.freeLeft(m, ME), left = Game.deploysLeft(m, ME);
  $('gold').textContent = `Unlimited gold · ${left} deployment${left === 1 ? '' : 's'} left`;
  $('hint').textContent = placingTower() ? 'Place your tower first: tap a gold tile on the left or right of your zone.'
    : selected !== null ? `Tap a highlighted tile to place ${units[selected].name}.`
    : free.length ? 'Your package squads are on the board: drag them where you want them.'
    : 'Pick a unit, then tap a tile. Tap a new squad to take it back, drag to move it.';
  $('cards').innerHTML = units.map((u, i) => {
    if (Game.isOff(m, i)) return '';
    const locked = !Game.isUnlocked(m, ME, i), n = free.filter(x => x === i).length, cost = Game.shopCost(m, ME, i);
    const can = !placingTower() && (n > 0 || (!locked && m.gold[ME] >= cost && left > 0)) || (locked && m.gold[ME] >= Game.unlockCost(m, i, ME));
    return `<button class="ucard" data-i="${i}" aria-pressed="${selected === i}" aria-disabled="${!can}"${locked ? ' data-locked="1"' : ''}>
      <span class="t"><span style="color:${u.color};display:inline-flex">${Shapes.svg(u.shape, 13)}</span> ${Shapes.tag(u)}</span><span class="n">${u.name}</span>
      <span class="c">${locked ? `Unlock ${Game.unlockCost(m, i, ME)}` : n ? `Free ×${n}` : cost}</span></button>`;
  }).join('');
}
$('cards').addEventListener('click', (e) => {
  const b = e.target.closest('.ucard'); if (!b || phase !== 'deploy') return;
  const i = +b.dataset.i;
  if (b.dataset.locked) { if (Game.unlock(m, ME, i)) selected = i; }
  else if (b.getAttribute('aria-disabled') === 'false') selected = selected === i ? null : i;
  shop();
});
// a tap on the board: as the game's click on its canvas
function tapTile(t) {
  if (!player || phase !== 'deploy' || !t || performance.now() - dragEndAt < 400) return false;
  if (placingTower()) { Game.placeTower(m, ME, t.col, t.row); shop(); return true; }
  const own = Game.squadAt(m, ME, t.col, t.row);
  if (own && selected !== null && Game.boardable(m, ME, t.col, t.row, selected)) placeSel(t); // into a carrier with room
  else if (own) { if (own.round === m.round) Game.unplace(m, ME, t.col, t.row); }
  else if (selected !== null && Game.canPlaceAt(m, ME, t.col, t.row, selected)) placeSel(t);
  else return false;
  shop();
  return true;
}
function placeSel(t) {
  if (!Game.place(m, ME, selected, t.col, t.row)) return;
  if (!Game.freeLeft(m, ME).includes(selected) && (m.gold[ME] < Game.shopCost(m, ME, selected) || Game.deploysLeft(m, ME) <= 0)) selected = null;
}
// a squad from this round can be dragged to another tile
function press(t) {
  if (!player || phase !== 'deploy' || !t || placingTower()) return false;
  const sq = Game.squadAt(m, ME, t.col, t.row);
  if (!sq || sq.round !== m.round || !Game.canMove(m, ME, sq)) return false;
  drag = { id: sq.id, from: t, over: t, moved: false };
  return true;
}
function dragTo(t) { if (drag && t && (t.col !== drag.over.col || t.row !== drag.over.row)) { drag.over = t; drag.moved = true; } }
function drop(t, ended) {
  const d = drag; drag = null;
  if (!d || !ended || !d.moved) return;
  dragEndAt = performance.now(); // the tap that follows a drag is not a tap
  const to = t || d.over;
  if (to.col !== d.from.col || to.row !== d.from.row) Game.moveSquad(m, ME, d.id, to.col, to.row);
  shop();
}
// ---------- the board ----------
const board = Render3D(THREE, $('view'), () => ({ m, me: ME, phase, units, mode: 'ai', bt, battlePre: m, fx, selected, moving: null, drag, hoverTile,
  editable: player && phase === 'deploy', placingUnit: placingUnit(), placingElf: false, placingTower: placingTower(), ...extra }), {
  // a tap in the strategic view deploys; anywhere else it marks a tile, in the game's own column / row numbers
  onTap: (t) => { if (tapTile(t)) return; hoverTile = t; if (t && !(player && phase === 'deploy')) msg(`Tapped tile: column ${t.col + 1}, row ${t.row + 1}`); },
  onPress: press, onDrag: dragTo, onDrop: drop,
  onHover: (t) => { hoverTile = t; },
  placing: () => player && phase === 'deploy', // you can place in the angled view too
  onLevel: (lv) => { if (lv > 1 || !(player && phase === 'deploy')) hoverTile = null; help(lv); },
});
// the level chips switch views (in the angled view a tap places, so it no longer goes back)
[...$('levels').children].forEach((c, k) => c.addEventListener('click', () => board.camera.setLevel(k)));
function showLevel() { [...$('levels').children].forEach((c, k) => c.classList.toggle('on', k === board.camera.level())); }
// the help line for a view: none in the strategic view while deploying (the shop says what to do)
function help(lv = board.camera.level()) {
  const deploying = player && phase === 'deploy';
  $('help').hidden = deploying && lv === 0;
  $('help').textContent = deploying && lv === 1
    ? (touch ? 'Tap a tile to place · drag a new squad to move it · drag elsewhere to look around · pinch or tap Strategic to go back'
      : 'Click a tile to place · drag a new squad to move it · drag elsewhere to look around · scroll, Esc or Strategic to go back')
    : touch ? 'Spread two fingers to go in · drag to look around · twist two fingers to rotate · tap to go back'
    : 'Scroll to go in or out · drag to look around · hold the right or middle button and drag to rotate (or Q / E) · click or Esc to go back';
}
let msgTimer = 0;
function msg(t) { $('msg').textContent = t; $('msg').hidden = !t; clearTimeout(msgTimer); if (t && t.startsWith('Tapped')) msgTimer = setTimeout(() => msg(''), 1800); }
new ResizeObserver(() => board.size()).observe($('view')); // the bars change height as the shop comes and goes

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
      result = bt.result(); phase = 'result'; fx = []; shop();
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
window.__lab3d = { board, get m() { return m; }, get bt() { return bt; }, get phase() { return phase; }, view(x) { extra = x || {}; },
  get selected() { return selected; }, set selected(i) { selected = i; shop(); } }; // for tests
