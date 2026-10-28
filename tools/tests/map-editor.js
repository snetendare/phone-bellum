// The map editor (editor.html): painting with the mirror, ground height, flanks, moving towers, resizing, saving.
// Run from the repo root after `node src/build.js`:  node tools/tests/map-editor.js
const { chromium } = require('playwright-core');
const path = require('path');
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); process.exitCode = 1; });
  p.on('dialog', d => d.accept());
  await p.goto('file://' + path.resolve('editor.html'));
  const map = () => p.evaluate(() => JSON.parse(JSON.stringify(Editor.map)));
  // tap the middle of a tile
  const tap = async (col, row) => { await p.locator('#board').scrollIntoViewIfNeeded(); const m = await map(), r = await p.locator('#board').boundingBox(); await p.mouse.click(r.x + (col + 0.5) * r.width / m.cols, r.y + (row + 0.5) * r.height / m.rows); };
  const dragTiles = async (from, to) => {
    await p.locator('#board').scrollIntoViewIfNeeded();
    const m = await map(), r = await p.locator('#board').boundingBox(), at = (t) => [r.x + (t[0] + 0.5) * r.width / m.cols, r.y + (t[1] + 0.5) * r.height / m.rows];
    await p.mouse.move(...at(from)); await p.mouse.down(); await p.mouse.move(...at(to), { steps: 8 }); await p.mouse.up();
  };

  let m = await map();
  ok(m.cols === 12 && m.rows === 16 && m.zone === 6 && m.symmetry === 'mirror', 'starts on the Standard board, 12 by 16, mirrored across');
  ok(m.flank.every(r => r[0] === 'F' && r[11] === 'F' && !r.slice(1, 11).includes('F')), 'flanks on the edge columns');

  // solid wall, mirrored straight across
  await tap(3, 7); m = await map();
  ok(m.tiles[7][3] === '#' && m.tiles[8][3] === '#', 'a solid wall and its mirror');
  // tapping it again: corner, line, diagonal, block (the mirror turned over); Rotate turns it
  const forms = [];
  for (let k = 0; k < 5; k++) { await tap(3, 7); m = await map(); forms.push(m.shape[7][3] + m.shape[8][3]); }
  ok(forms.join(' ') === '└┌ ── ╱╲ ▔▁ ..' && m.tiles[7][3] === '#', 'forms cycle: ' + forms.join(' '));
  await tap(3, 7); await p.click('[data-tool="rotate"]'); await tap(3, 7); m = await map();
  ok(m.shape[7][3] === '┌' && m.shape[8][3] === '└', 'rotated corner, mirror kept');
  await tap(3, 7); await tap(3, 7); await tap(3, 7); m = await map();
  ok(m.shape[7][3] === '└' && m.shape[8][3] === '┌', 'four turns go round');
  await p.click('[data-tool="#"]'); for (let k = 0; k < 4; k++) await tap(3, 7); m = await map();
  ok(m.shape[7][3] === '.', 'back to a block');
  await dragTiles([3, 7], [4, 7]); m = await map();
  ok(m.tiles[7][4] === '#' && m.shape[7][3] === '.', 'a drag from a wall paints on, without changing its form');
  await p.click('[data-tool="erase"]'); await tap(4, 7); await p.click('[data-tool="#"]');
  // water, dragged along a row
  await p.click('[data-tool="~"]'); await dragTiles([2, 9], [6, 9]); m = await map();
  ok(m.tiles[9].slice(2, 7) === '~~~~~' && m.tiles[6].slice(2, 7) === '~~~~~', 'water dragged along a row, mirrored');
  await p.click('[data-tool="s"]'); await tap(9, 10); m = await map();
  ok(m.tiles[10][9] === 's' && m.tiles[5][9] === 's', 'shallow water');
  await dragTiles([9, 10], [8, 14]); // a tower may stand in shallow water
  m = await map(); ok(m.buildings.some(x => x.kind === 'tower' && x.side === 0 && x.col === 8 && x.row === 14), 'painting doesn’t move the tower');
  await p.click('[data-tool="O"]'); await tap(5, 8); m = await map();
  ok(m.tiles[8][5] === 'O' && m.tiles[7][5] === 'O', 'objective');
  await p.click('[data-tool="p"]'); await tap(4, 12); m = await map();
  ok(m.tiles[12][4] === 'p' && m.tiles[3][4] === 'p', 'mushroom tile');
  // ground: one step per tap, at most 2
  await p.click('[data-tool="raise"]'); await tap(1, 10); await tap(1, 10); await tap(1, 10); m = await map();
  ok(m.height[10][1] === 'H' && m.height[5][1] === 'H', 'raised to +2 and no further');
  await p.click('[data-tool="lower"]'); await tap(8, 11); m = await map();
  ok(m.height[11][8] === 'l', 'lowered');
  await p.click('[data-tool="b"]'); await tap(2, 4); m = await map();
  ok(m.tiles[4][2] === 'b' && m.tiles[11][2] === 'b', 'bush');
  // flanks: off, then back on
  await p.click('[data-tool="flank"]'); await tap(0, 2); m = await map();
  ok(m.flank[2][0] === '.' && m.flank[13][0] === '.', 'flank tile removed (and its mirror)');
  await tap(4, 4); m = await map();
  ok(m.flank[4][4] === 'F', 'flank tile added');
  // undo / redo
  // no man's land: painted into a zone, and back
  ok(m.nml[6].replace(/N/g, '').length === 0 && m.nml[5] === '.'.repeat(12), 'no man’s land on the rows between the zones');
  await p.click('[data-tool="nml"]'); await dragTiles([5, 5], [6, 5]); m = await map();
  ok(m.nml[5].slice(5, 7) === 'NN' && m.nml[10].slice(5, 7) === 'NN', 'no man’s land painted into the enemy zone, mirrored into yours');
  await tap(6, 5); m = await map();
  ok(m.nml[5][6] === '.' && m.nml[10][6] === '.', 'and back to zone');
  await tap(4, 7); m = await map();
  ok(m.nml[7][4] === '.' && m.nml[8][4] === '.', 'a no man’s land tile made zone');
  await tap(4, 7); m = await map();
  await p.click('[data-tool="flank"]'); await tap(4, 4); await tap(4, 4); m = await map();
  await p.click('#undo'); m = await map(); ok(m.flank[4][4] === '.', 'undo');
  await p.click('#redo'); m = await map(); ok(m.flank[4][4] === 'F', 'redo');
  // move your tower: the enemy's follows across
  await dragTiles([8, 14], [3, 13]); m = await map();
  const tw = (s) => m.buildings.find(x => x.kind === 'tower' && x.side === s);
  ok(tw(0).col === 3 && tw(0).row === 13 && tw(1).col === 3 && tw(1).row === 2, 'tower moved, the enemy tower mirrored');
  await p.click('[data-tool="#"]'); await tap(5, 13); for (let k = 0; k < 4; k++) await tap(5, 13);
  await p.click('[data-tool="rotate"]'); await tap(5, 13); m = await map();
  ok(m.shape[13][5] === '▕' && m.shape[2][5] === '▕', 'edge wall turned to the right side, mirrored across');
  await dragTiles([3, 13], [5, 13]); m = await map();
  ok(tw(0).col === 5 && tw(0).row === 13, 'a tower can stand on a tile with an edge wall');
  await dragTiles([5, 13], [3, 13]); m = await map();
  await dragTiles([3, 13], [3, 3]); m = await map();
  ok(tw(0).row === 13, 'a tower can’t leave its own half');
  // resize: more columns keeps the edges
  await p.click('[data-k="cols"][data-d="1"]'); await p.click('[data-k="cols"][data-d="1"]'); m = await map();
  ok(m.cols === 14 && m.tiles[7][3] === '#' && m.flank.every((r, i) => r[13] === 'F' || i === 2 || i === 13), 'two more columns, walls and edge flanks kept');
  await p.click('[data-k="nml"][data-d="2"]'); m = await map();
  ok(m.rows === 18 && m.tiles[7][3] === '#' && m.tiles[10][3] === '#' && tw(0).row === 15, 'more no man’s land: rows added in the middle');
  // treasuries and elf tower
  await p.click('[data-ps="0"][data-pk="treasury"][data-pd="1"]'); await p.click('#t-elf'); m = await map();
  ok(m.buildings.filter(x => x.kind === 'treasury').length === 2 && m.buildings.some(x => x.kind === 'elf'), 'treasuries and an elf tower added');
  // save, start over, open it again
  await p.fill('#name', 'Test arena'); await p.click('#save');
  await p.click('[data-base="testgrid"]'); m = await map();
  ok(m.cols === 14 && m.rows === 18 && m.zone === 7 && m.symmetry === 'point' && m.buildings.length === 4, 'Test map: 14 by 18, rotated, towers and treasuries');
  const t0 = m.buildings.find(x => x.kind === 'treasury' && x.side === 0), t1 = m.buildings.find(x => x.kind === 'treasury' && x.side === 1);
  ok(t0.col === 4 && t0.row === 15 && t1.col === 9 && t1.row === 2, 'treasuries where the game puts them');
  await p.click('[data-load="Test arena"]'); m = await map();
  ok(m.name === 'Test arena' && m.cols === 14 && m.tiles[7][3] === '#' && m.buildings.length === 5, 'saved map opened again');
  ok(await p.evaluate(() => Editor.validMap(Editor.map)), 'the map is valid');
  // more players, more towers and treasuries
  const count = (side, kind) => m.buildings.filter(x => x.side === side && x.kind === kind).length;
  await p.click('#add-player'); m = await map();
  ok(m.players === 3 && count(2, 'tower') === 1, 'a third player with a tower');
  await p.click('[data-ps="2"][data-pk="tower"][data-pd="1"]'); await p.click('[data-ps="2"][data-pk="treasury"][data-pd="1"]'); m = await map();
  ok(count(2, 'tower') === 2 && count(2, 'treasury') === 1, 'player 3: two towers and a treasury');
  await p.click('[data-ps="0"][data-pk="tower"][data-pd="1"]'); m = await map();
  const t2 = m.buildings.filter(x => x.kind === 'tower' && x.side < 2);
  ok(count(0, 'tower') === 2 && count(1, 'tower') === 2 && t2[2].col === (m.symmetry === 'point' ? m.cols - 1 - t2[3].col : t2[3].col) && t2[2].row === m.rows - 1 - t2[3].row, 'a second tower for you, and its mirror for the enemy');
  await p.click('#add-player'); await p.click('[data-del="2"]'); m = await map();
  ok(m.players === 3 && count(2, 'tower') === 1 && count(2, 'treasury') === 0 && count(3, 'tower') === 0, 'player 3 removed, player 4 is player 3 now');
  await p.click('[data-ps="1"][data-pk="tower"][data-pd="-1"]'); m = await map();
  ok(count(0, 'tower') === 1 && count(1, 'tower') === 1, 'one tower fewer each');
  ok(await p.evaluate(() => Editor.validMap(Editor.map)), 'still valid');
  await p.screenshot({ path: process.env.SHOT || '/tmp/map-editor.png', fullPage: true });
  await b.close();
})();
