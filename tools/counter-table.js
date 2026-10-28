// After editing src/default-roster.json or src/factions.json: recompute the unit counter tables
// (src/demo-units.json for the standard roster, src/faction-units.json for the Factions gamemode)
// and print each unit's average score old -> new. Run from the repo root: node tools/counter-table.js
// Fast path: each output file keeps a signature per unit (its battle stats, display text left out) and one for the
// engine and settings. A pair whose two units and engine are unchanged keeps its old score, so a text-only change
// runs no battles and a change to one unit only re-runs that unit's row. The battles left run on every CPU core.
// --full: ignore the saved scores and run every battle.
const fs = require('fs'), crypto = require('crypto'), os = require('os'), path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const E = require('../src/engine.js');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 };
if (!isMainThread) { // a worker: run its share of the battles
  const { bu, g, pairs } = workerData;
  parentPort.postMessage(pairs.map(([i, j]) => +E.battle(bu[i], bu[j], g).score.toFixed(3)));
  return;
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const hash = (x) => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);
const FULL = process.argv.includes('--full');
// --seed: the saved tables are known to be up to date (just computed): only add the signatures, run no battles
const SEED = process.argv.includes('--seed');
const ENGINE = hash(fs.readFileSync(path.join(__dirname, '../src/engine.js'), 'utf8'));
const DISPLAY = new Set(['shape', 'color', 'trait', 'trait2', 'trait3', 'trait4', 'unlock', 'faction', 'noPack']); // never change a fight
const sigOf = (u) => hash(JSON.stringify(u, (k, v) => DISPLAY.has(k) ? undefined : v));
// the battles in pairs, split over the CPU cores
function runPairs(bu, g, pairs) {
  if (!pairs.length) return Promise.resolve([]);
  const k = Math.max(1, Math.min(os.cpus().length, pairs.length));
  const parts = Array.from({ length: k }, (_, w) => pairs.filter((_, n) => n % k === w));
  return Promise.all(parts.map(part => new Promise((ok, no) => {
    const w = new Worker(__filename, { workerData: { bu, g, pairs: part } });
    w.once('message', ok); w.once('error', no);
  }))).then(res => { const out = []; parts.forEach((part, w) => part.forEach((_, n) => { out[pairs.indexOf(part[n])] = res[w][n]; })); return out; });
}
// units: gold costs (100 = one squad), as in the roster files. Writes { units, matrix, skills, ...extra } to out.
async function table(label, out, rosterUnits, skills, extra) {
  const old = fs.existsSync(out) ? read(out) : { units: [], matrix: [] }; const oldAvg = {};
  old.units.forEach((u, i) => oldAvg[u.name] = old.matrix[i].reduce((a, b) => a + b, 0) / Math.max(1, old.units.length - 1));
  const units = rosterUnits.map(({ skillsOn, ...u }) => ({ ...u, cost: u.cost / 100 }));
  const n = units.length, M = units.map(() => Array(n).fill(0));
  let sigs = [], key = '';
  if (n) {
    const g = { ...G, budget: E.fairBudget(units.map(u => u.cost), 2) };
    const bu = units.map(u => E.innateUnit(u, skills, units));
    sigs = bu.map(sigOf); key = hash([ENGINE, g]);
    // old scores by unit signature, if the engine and settings are the same
    const oldAt = {};
    if (!FULL && old.cacheKey === key && Array.isArray(old.sigs)) old.sigs.forEach((s, i) => { oldAt[s] = i; });
    if (SEED && old.units.length === n && old.units.every((u, i) => u.name === units[i].name)) sigs.forEach((s, i) => { oldAt[s] = i; });
    const todo = [];
    // a building bought in the shop (the Altar of Build) doesn't fight on its own: it scores 0 against everything
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (units[i].building || units[j].building) continue;
      const a = oldAt[sigs[i]], b = oldAt[sigs[j]];
      if (a != null && b != null && a !== b) { M[i][j] = old.matrix[a][b]; M[j][i] = -M[i][j]; } else todo.push([i, j]);
    }
    const t0 = Date.now(), res = await runPairs(bu, g, todo);
    todo.forEach(([i, j], k) => { M[i][j] = res[k]; M[j][i] = -res[k]; });
    console.log(`${label}: counter table gold per side: ${g.budget * 100} · ${todo.length} battles run, the rest reused (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } else console.log(`${label}: no units`);
  fs.writeFileSync(out, JSON.stringify({ ...extra, units, matrix: M, skills, cacheKey: key, sigs }));
  units.forEach((u, i) => { const a = M[i].reduce((x, y) => x + y, 0) / Math.max(1, n - 1); console.log(u.name.padEnd(18), (oldAvg[u.name] != null ? String(Math.round(oldAvg[u.name] * 100)) : 'new').padStart(4), '->', String(Math.round(a * 100)).padStart(4)); });
  return { units, M };
}
const r = read('src/default-roster.json');
(async () => {
await table('standard roster', 'src/demo-units.json', r.units, r.skills);
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
const ft = await table('factions', 'src/faction-units.json', fUnits, fSkills, { factions: meta, neutral: { buildings: nt.buildings || [], powers: nt.powers || [] }, spells: f.spells || [], buildings: f.buildings || [] });
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
})().catch(e => { console.error(e); process.exit(1); });
