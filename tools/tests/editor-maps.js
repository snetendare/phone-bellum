// Headless check of maps made in the map editor (EDITOR_MAPS, editorMap in src/game.js): each takes its grid, its
// towers' and treasuries' tiles and its flank tiles from the editor's JSON, and AI matches on it play to the end.
// Run from the repo root: node tools/tests/editor-maps.js
const assert = require('assert');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');
for (const [id, ed] of Object.entries(Game.EDITOR_MAPS)) {
  const m = Game.createMatch(demo.units, demo.matrix, 3, id);
  assert.deepStrictEqual([Game.COLS, Game.ROWS, Game.ZONE], [ed.cols, ed.rows, ed.zone], id + ': grid');
  for (const b of ed.buildings) {
    const at = { col: b.col, row: b.row };
    if (b.kind === 'tower') assert.deepStrictEqual(m.towers[b.side], at, id + ': tower ' + b.side);
    if (b.kind === 'treasury') assert.deepStrictEqual(Game.treasurySpot(m, b.side), at, id + ': treasury ' + b.side);
  }
  // flank tiles: an F on side 1's half (the top) is side 0's to deploy on, and the other way round
  for (let row = 0; row < ed.rows; row++) for (let col = 0; col < ed.cols; col++) {
    const f = ed.flank[row][col] === 'F', side = row < ed.rows / 2 ? 0 : 1;
    assert.strictEqual(Game.isFlank(side, col, row), f, `${id}: flank ${col},${row}`);
    assert.strictEqual(Game.isFlank(1 - side, col, row), false);
  }
  // no man's land is where the editor marked it
  if (ed.nml) for (let row = 0; row < ed.rows; row++) assert.strictEqual(Game.inNoMans(row), ed.nml[row].includes('N'), `${id}: no man's land row ${row}`);
  let fights = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const x = Game.createMatch(demo.units, demo.matrix, seed, id);
    for (let g = 0; !x.over && g < 30; g++) { Game.aiDeploy(x, 0); Game.aiDeploy(x, 1); const s = Game.startBattle(x); while (s.step()) {} Game.resolve(x, s.result()); fights++; }
    assert.ok(x.over, id + ': the match ends');
  }
  console.log(id, 'ok,', fights, 'fights');
}
// the other maps keep the game's own spots and edge flanks
const t = Game.createMatch(demo.units, demo.matrix, 3, 'testgrid');
assert.deepStrictEqual(t.towers, [{ col: 10, row: 16 }, { col: 3, row: 1 }]);
assert.ok(Game.isFlank(0, 0, 3) && !Game.isFlank(0, 1, 0));
console.log('editor maps ok');
