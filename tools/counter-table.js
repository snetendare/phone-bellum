// After editing src/default-roster.json or src/factions.json: recompute the unit counter tables
// (src/demo-units.json for the standard roster, src/faction-units.json for the Factions gamemode)
// and print each unit's average score old -> new. Run from the repo root: node tools/counter-table.js
const fs = require('fs'); const E = require('../src/engine.js');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 };
// units: gold costs (100 = one squad), as in the roster files. Writes { units, matrix, skills, ...extra } to out.
function table(label, out, rosterUnits, skills, extra) {
  const old = fs.existsSync(out) ? read(out) : { units: [], matrix: [] }; const oldAvg = {};
  old.units.forEach((u, i) => oldAvg[u.name] = old.matrix[i].reduce((a, b) => a + b, 0) / Math.max(1, old.units.length - 1));
  const units = rosterUnits.map(({ skillsOn, ...u }) => ({ ...u, cost: u.cost / 100 }));
  const n = units.length, M = units.map(() => Array(n).fill(0));
  if (n) {
    const g = { ...G, budget: E.fairBudget(units.map(u => u.cost), 2) };
    const bu = units.map(u => E.innateUnit(u, skills, units));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const s = +E.battle(bu[i], bu[j], g).score.toFixed(3); M[i][j] = s; M[j][i] = -s; }
    console.log(`${label}: counter table gold per side:`, g.budget * 100);
  } else console.log(`${label}: no units`);
  fs.writeFileSync(out, JSON.stringify({ ...extra, units, matrix: M, skills }));
  units.forEach((u, i) => { const a = M[i].reduce((x, y) => x + y, 0) / Math.max(1, n - 1); console.log(u.name.padEnd(18), (oldAvg[u.name] != null ? String(Math.round(oldAvg[u.name] * 100)) : 'new').padStart(4), '->', String(Math.round(a * 100)).padStart(4)); });
  return { units, M };
}
const r = read('src/default-roster.json');
table('standard roster', 'src/demo-units.json', r.units, r.skills);
// Factions: each faction's units get its id in `faction`. Skills: the standard roster's, plus the factions' own (same id: the faction's wins).
const f = read('src/factions.json');
const fSkills = r.skills.filter(sk => !(f.skills || []).some(x => x.id === sk.id)).concat(f.skills || []);
const fUnits = [], meta = [];
for (const fc of f.factions || []) {
  const { units = [], ...rest } = fc;
  meta.push({ ...rest, units: units.map(u => u.name) });
  for (const u of units) fUnits.push({ ...u, faction: fc.id });
}
// neutral units (the Factions devtest): names from the standard roster, or full units; faction 'neutral'
const nt = f.neutral || {};
for (const x of nt.units || []) {
  const u = typeof x === 'string' ? r.units.find(y => y.name === x) : x;
  if (!u) throw new Error(`neutral unit ${x} isn't in src/default-roster.json`);
  fUnits.push({ ...u, faction: 'neutral' });
}
const names = fUnits.map(u => u.name), dup = names.find((x, i) => names.indexOf(x) !== i);
if (dup) throw new Error(`two faction units are called ${dup}: unit names must be unique across factions and the neutral units`);
const ft = table('factions', 'src/faction-units.json', fUnits, fSkills, { factions: meta, neutral: { buildings: nt.buildings || [], powers: nt.powers || [] }, spells: f.spells || [] });
// each faction's average against every other faction
meta.forEach((a) => {
  const A = ft.units.map((u, i) => u.faction === a.id ? i : -1).filter(i => i >= 0);
  const row = meta.filter(b => b.id !== a.id).map(b => {
    const B = ft.units.map((u, i) => u.faction === b.id ? i : -1).filter(i => i >= 0);
    let s = 0; for (const i of A) for (const j of B) s += ft.M[i][j];
    return `${b.name} ${A.length && B.length ? Math.round(s / (A.length * B.length) * 100) : '-'}`;
  });
  console.log(`${a.name.padEnd(18)} vs ${row.join(', ') || '(no other factions)'}`);
});
