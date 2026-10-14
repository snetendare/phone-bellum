// After editing src/default-roster.json: recompute the unit counter table (src/demo-units.json)
// and print each unit's average score old -> new. Run from the repo root: node tools/counter-table.js
const fs = require('fs'); const E = require('../src/engine.js');
const old = JSON.parse(fs.readFileSync('src/demo-units.json', 'utf8')); const oldAvg = {};
old.units.forEach((u, i) => oldAvg[u.name] = old.matrix[i].reduce((a, b) => a + b, 0) / (old.units.length - 1));
const r = JSON.parse(fs.readFileSync('src/default-roster.json', 'utf8'));
const units = r.units.map(({ skillsOn, ...u }) => ({ ...u, cost: u.cost / 100 }));
const g = { budget: E.fairBudget(units.map(u => u.cost), 2), distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 12, flameReach: 1.2 };
const bu = units.map(u => E.innateUnit(u, r.skills, units));
const n = units.length, M = units.map(() => Array(n).fill(0));
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const s = +E.battle(bu[i], bu[j], g).score.toFixed(3); M[i][j] = s; M[j][i] = -s; }
console.log('counter table gold per side:', g.budget * 100);
fs.writeFileSync('src/demo-units.json', JSON.stringify({ units, matrix: M, skills: r.skills }));
units.forEach((u, i) => { const a = M[i].reduce((x, y) => x + y, 0) / (n - 1); console.log(u.name.padEnd(18), (oldAvg[u.name] != null ? String(Math.round(oldAvg[u.name] * 100)) : 'new').padStart(4), '->', String(Math.round(a * 100)).padStart(4)); });
