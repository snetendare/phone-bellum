// ===== Match rules and AI (shared by headless tests and the page) =====
const Game = (() => {
  const E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');

  const COLS = 12, ROWS = 16, TILE = 6, ZONE = 5; // each side builds in ZONE rows; the rows between are no man's land
  const START_HP = 40, START_GOLD = 250, INCOME = 250, LOSER_BONUS = 50;
  const SQUAD_COST = 100, SQUAD_POINTS = 2;
  const SETTINGS = { dt: 0.05, timeCap: 60, spacing: 3.5, minDmgPct: 15, absorbXp: 1, sight: 12 };
  // XP a squad needs in total to reach level 1, 2, 3, as multiples of its own starting health.
  // XP = damage dealt + damage absorbed + bounty for killing leveled bodies.
  const XP_STEPS = [5, 12, 24];
  const xpNeeded = (unit, level) => unit.bodies * unit.hp * XP_STEPS[level];
  // deployments: how many new squads a side may place per round; extra ones can be bought for the round
  const CONFIG = { incomeStep: 100, levelCostPerTier: 50, firstRoundDeploys: 3, deploysPerRound: 2, extraDeployCost: 50, deployCap: true };
  // Gold both players get at the start of a round: 250 going into round 2, then 100 more each round (like Mechabellum)
  const incomeFor = (round) => INCOME + CONFIG.incomeStep * Math.max(0, round - 2);
  const deploysAllowed = (m, side) => CONFIG.deployCap
    ? (m.round === 1 ? CONFIG.firstRoundDeploys : CONFIG.deploysPerRound) + m.extraDeploys[side]
    : Infinity;
  const deployedThisRound = (m, side) => m.armies[side].filter(s => s.round === m.round && !s.free).length; // package squads don't count
  const deploysLeft = (m, side) => deploysAllowed(m, side) - deployedThisRound(m, side);
  // A unit's `cost` is in lab units: 1 = one standard squad (SQUAD_COST gold)
  const unitCostOf = (unit) => Math.max(10, Math.round((unit.cost || 1) * SQUAD_COST / 10) * 10);
  // Upgrades cost half the unit's price at the default setting (50 for a 100-gold squad)
  const levelCost = (unit) => Math.max(10, Math.round(CONFIG.levelCostPerTier * (unit.cost || 1) / 5) * 5);
  // Each player has one tower, placed before anything else in round 1, on either side of their zone
  // (not in the middle columns). It has a short, light attack. If it falls, that player's army is
  // crippled for a few seconds (see Engine.TOWER_DOWN). It is rebuilt for every round.
  const TOWER = { name: 'Tower', cost: 0, bodies: 1, hp: 650, hit: 30, aps: 1.2, range: 8, speed: 0, splash: 0, structure: true, shape: 'square', color: '#C9B79C' };
  const TOWER_MID = [4, 7]; // columns the tower can't stand in
  const towerColOk = (col) => col >= 0 && col < COLS && (col < TOWER_MID[0] || col > TOWER_MID[1]);
  const AI = { levelPolicy: 'smart', maxExtraDeploys: 3, skills: true }; // levelPolicy: smart | never | all (for experiments)

  // rows 0-4: enemy zone (row 4 is its front), rows 5-10: no man's land, rows 11-15: player zone (row 11 is its front)
  const zoneRows = (side) => Array.from({ length: ZONE }, (_, i) => side === 0 ? ROWS - ZONE + i : ZONE - 1 - i); // front row first
  const inZone = (side, row) => side === 0 ? row >= ROWS - ZONE && row < ROWS : row >= 0 && row < ZONE;
  // Flank columns: the two edge columns of the ENEMY's half of the board (their half of no man's land
  // plus their whole zone). From round 3 you may deploy there; the matching columns on your half are the
  // enemy's and never yours, so you have to guard your own edges.
  const FLANK = { round: 3, cols: [0, COLS - 1], delay: 3 }; // delay: seconds a squad stands still in the first fight after it was placed on a flank
  // the rows of the enemy's half: their zone from its front row to its back row, then their half of no man's land
  const flankRows = (side) => {
    const half = ROWS / 2, zone = Array.from({ length: ZONE }, (_, i) => side === 0 ? ZONE - 1 - i : ROWS - ZONE + i);
    const nml = Array.from({ length: half - ZONE }, (_, i) => side === 0 ? ZONE + i : ROWS - ZONE - 1 - i);
    return zone.concat(nml);
  };
  const flankOpen = (m) => !!m && m.round >= FLANK.round;
  const isFlank = (side, col, row) => FLANK.cols.includes(col) && flankRows(side).includes(row);
  // a tile the other player already holds with a squad (or tower) you can see
  const enemyHolds = (m, side, col, row) => !!m && (m.armies[1 - side].some(s => s.col === col && s.row === row && s.round < m.round) ||
    (m.round > 1 && m.towers && m.towers[1 - side] && m.towers[1 - side].col === col && m.towers[1 - side].row === row));
  // the edge tiles of your zone that are the enemy's flank are reserved for them for the whole match
  const reserved = (side, col, row) => isFlank(1 - side, col, row);
  const canPlaceAt = (m, side, col, row) => col >= 0 && col < COLS && !reserved(side, col, row) &&
    (inZone(side, row) || (flankOpen(m) && isFlank(side, col, row))) && !enemyHolds(m, side, col, row);
  const tileToWorld = (col, row) => ({ x: (col - (COLS - 1) / 2) * TILE, y: ((ROWS - 1) / 2 - row) * TILE });

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // ---------- starting packages ----------
  // Before round 1 each player picks one of 3 packages (their own, not mirrored): two tier 1-2 unit types,
  // both unlocked for free, plus free squads of them worth exactly PACKAGE.value gold.
  const PACKAGE = { value: 300, maxPrice: 200, options: 3 };
  function allPackages(units) {
    const out = [], ok = units.map((u, i) => unitCostOf(u) <= PACKAGE.maxPrice ? i : -1).filter(i => i >= 0);
    for (const a of ok) for (const b of ok) {
      if (a === b) continue;
      const ca = unitCostOf(units[a]), cb = unitCostOf(units[b]);
      for (let na = 1; na * ca < PACKAGE.value; na++) {
        const rest = PACKAGE.value - na * ca;
        if (rest % cb !== 0 || rest / cb < 1) continue;
        const nb = rest / cb;
        if (na < nb || (na === nb && a > b)) continue; // list each package once: the unit with more squads first
        out.push({ units: [a, b], squads: Array(na).fill(a).concat(Array(nb).fill(b)) });
      }
    }
    return out;
  }
  function dealPackages(units, r) {
    const all = allPackages(units), pick = [];
    for (let guard = 0; pick.length < Math.min(PACKAGE.options, all.length) && guard < 200; guard++) {
      const p = all[Math.floor(r() * all.length)];
      // three different packages, and no unit type in more than one of them where possible
      if (pick.includes(p) || (guard < 120 && pick.some(q => q.units.some(u => p.units.includes(u))))) continue;
      pick.push(p);
    }
    return pick;
  }
  const packOf = (m, side) => m.packages && m.pack && m.pack[side] != null ? m.packages[side][m.pack[side]] : null;
  const needsPack = (m, side) => !!(m.packages && m.packages[side] && m.packages[side].length && m.pack[side] == null);
  // package squads still waiting to be placed
  function freeLeft(m, side) {
    const p = packOf(m, side);
    if (!p || m.round !== 1) return []; // package squads go down in round 1
    const left = p.squads.slice();
    for (const s of m.armies[side]) if (s.free) { const k = left.indexOf(s.unit); if (k >= 0) left.splice(k, 1); }
    return left;
  }
  function choosePack(m, side, k) {
    if (m.round !== 1 || !needsPack(m, side) || !(k >= 0 && k < m.packages[side].length)) return false;
    m.pack[side] = k;
    if (!m.unlocks) m.unlocks = [{}, {}];
    for (const ui of m.packages[side][k].units) m.unlocks[side][ui] = m.round;
    return true;
  }
  // before a fight: pick the first package for a player who didn't choose, and put unplaced package squads down
  function ensurePack(m, side) {
    if (needsPack(m, side)) choosePack(m, side, 0);
    const r = rng(m.seed + 4242 + side);
    for (const ui of freeLeft(m, side)) {
      const spot = aiSpot(m, side, ui, [], r);
      if (!spot || !place(m, side, ui, spot.col, spot.row)) break;
    }
  }

  function createMatch(units, matrix, seed) {
    const r = rng((seed >>> 0) + 777);
    return {
      units, matrix, seed: seed >>> 0,
      round: 1, hp: [START_HP, START_HP], gold: [START_GOLD, START_GOLD],
      armies: [[], []], nextId: [1, 1], history: [], over: false, winner: -1,
      extraDeploys: [0, 0],
      tech: [{}, {}], // skills bought per unit type: tech[side][unitIdx] = [round bought or 0, round bought or 0]
      towers: [null, null], // { col, row } of each player's tower
      unlocks: [{}, {}], // units unlocked per player: unlocks[side][unitIdx] = round it was unlocked
      packages: [dealPackages(units, r), dealPackages(units, r)], // each player's 3 starting package options
      pack: [null, null], // which one each player picked
    };
  }

  // ---------- skills (bought per unit type, for all squads of that type) ----------
  // m.units[i].skillDefs = [def or null, def or null], resolved from the unit's two skill slots
  const skillDef = (m, ui, k) => (m.units[ui].skillDefs || [])[k] || null;
  const skillCost = (m, ui, k) => { const d = skillDef(m, ui, k); return d ? Math.max(0, Math.round(+d.cost || 0)) : 0; };
  // a built-in skill (skillsInnate on the unit) is always on, free and visible
  const isInnate = (m, ui, k) => !!(skillDef(m, ui, k) && Array.isArray(m.units[ui].skillsInnate) && m.units[ui].skillsInnate[k]);
  const hasSkill = (m, side, ui, k) => isInnate(m, ui, k) || !!(m.tech && m.tech[side] && m.tech[side][ui] && m.tech[side][ui][k] > 0);
  // a skill bought this round is hidden from the opponent until the fight
  const skillVisible = (m, side, ui, k) => isInnate(m, ui, k) || (hasSkill(m, side, ui, k) && m.tech[side][ui][k] < m.round);
  function unitFor(m, side, ui) {
    const base = m.units[ui];
    const defs = [0, 1].filter(k => hasSkill(m, side, ui, k)).map(k => skillDef(m, ui, k));
    return defs.length ? E.applySkills(base, defs, m.units) : base;
  }
  // ---------- unlocks (like Mechabellum: some units start unlocked, the rest cost gold once per match) ----------
  const unlockCost = (m, ui) => Math.max(0, Math.round(+m.units[ui].unlock || 0));
  const isUnlocked = (m, side, ui) => unlockCost(m, ui) === 0 || !!(m.unlocks && m.unlocks[side] && m.unlocks[side][ui] > 0);
  // an unlock bought this round is hidden from the opponent until the fight
  const unlockVisible = (m, side, ui) => unlockCost(m, ui) === 0 || (isUnlocked(m, side, ui) && m.unlocks[side][ui] < m.round);
  function unlock(m, side, ui) {
    if (ui < 0 || ui >= m.units.length || isUnlocked(m, side, ui)) return false;
    const cost = unlockCost(m, ui);
    if (m.gold[side] < cost) return false;
    if (!m.unlocks) m.unlocks = [{}, {}];
    m.gold[side] -= cost;
    m.unlocks[side][ui] = m.round;
    return true;
  }
  // take back an unlock bought this round, as long as no squad of that unit was placed with it
  function undoUnlock(m, side, ui) {
    if (!m.unlocks || !(m.unlocks[side][ui] === m.round)) return false;
    const p = packOf(m, side); if (p && p.units.includes(ui)) return false; // package units stay unlocked
    if (m.armies[side].some(s => s.unit === ui)) return false;
    delete m.unlocks[side][ui];
    m.gold[side] += unlockCost(m, ui);
    return true;
  }

  function canBuySkill(m, side, ui, k) {
    const d = skillDef(m, ui, k);
    if (!d || hasSkill(m, side, ui, k)) return false;
    if (!m.armies[side].some(s => s.unit === ui)) return false; // needs a squad of that type on the board
    return m.gold[side] >= skillCost(m, ui, k);
  }
  function buySkill(m, side, ui, k) {
    if (!canBuySkill(m, side, ui, k)) return false;
    m.gold[side] -= skillCost(m, ui, k);
    if (!m.tech) m.tech = [{}, {}];
    const t = m.tech[side][ui] || (m.tech[side][ui] = [0, 0]);
    t[k] = m.round;
    return true;
  }
  function undoSkill(m, side, ui, k) {
    const t = m.tech && m.tech[side][ui];
    if (!t || t[k] !== m.round) return false;
    t[k] = 0;
    m.gold[side] += skillCost(m, ui, k);
    return true;
  }

  // ---------- selling ----------
  // Squads from earlier rounds sell for half the unit's price (squads placed this round are taken back in full)
  const sellValue = (m, sq) => Math.floor(unitCostOf(m.units[sq.unit]) / 2 / 5) * 5;
  function sell(m, side, sqId) {
    const i = m.armies[side].findIndex(s => s.id === sqId && s.round < m.round);
    if (i < 0) return 0;
    const [sq] = m.armies[side].splice(i, 1);
    const v = sellValue(m, sq);
    m.gold[side] += v;
    return v;
  }

  function buyDeploy(m, side) {
    if (!CONFIG.deployCap || m.gold[side] < CONFIG.extraDeployCost) return false;
    m.gold[side] -= CONFIG.extraDeployCost;
    m.extraDeploys[side]++;
    return true;
  }

  // Refund an extra deployment bought this round that hasn't been used
  function refundDeploy(m, side) {
    if (m.extraDeploys[side] <= 0 || deploysLeft(m, side) <= 0) return false;
    m.extraDeploys[side]--;
    m.gold[side] += CONFIG.extraDeployCost;
    return true;
  }

  const towerAt = (m, side, col, row) => !!(m.towers && m.towers[side] && m.towers[side].col === col && m.towers[side].row === row);
  const occupied = (m, side, col, row) => towerAt(m, side, col, row) || m.armies[side].some(s => s.col === col && s.row === row);
  const needsTower = (m, side) => !!(m.towers && !m.towers[side]);
  // the tower can be placed (or moved) during round 1 only
  function placeTower(m, side, col, row) {
    if (!m.towers) m.towers = [null, null];
    if (m.round !== 1 || !inZone(side, row) || !towerColOk(col) || reserved(side, col, row)) return false;
    if (m.armies[side].some(s => s.col === col && s.row === row)) return false;
    m.towers[side] = { col, row };
    return true;
  }
  // a player who never placed a tower gets one in the back corner on the left
  function ensureTower(m, side) {
    if (!m.towers) m.towers = [null, null];
    if (m.towers[side]) return;
    const rows = zoneRows(side), back = rows[rows.length - 1];
    for (const col of [1, 10, 0, 11, 2, 9, 3, 8]) for (const row of [back, rows[rows.length - 2]]) if (placeTower(m, side, col, row)) return;
  }

  function place(m, side, unitIdx, col, row) {
    if (!canPlaceAt(m, side, col, row)) return null;
    if (needsTower(m, side)) return null; // the tower goes down first
    if (!isUnlocked(m, side, unitIdx)) return null;
    if (occupied(m, side, col, row)) return null;
    if (freeLeft(m, side).includes(unitIdx)) { // a package squad: no gold, no deployment
      const sq = { id: m.nextId[side]++, unit: unitIdx, col, row, round: m.round, xp: 0, level: 0, cost: 0, free: true };
      m.armies[side].push(sq);
      return sq;
    }
    const cost = unitCostOf(m.units[unitIdx]);
    if (m.gold[side] < cost) return null;
    if (deploysLeft(m, side) <= 0) return null;
    const sq = { id: m.nextId[side]++, unit: unitIdx, col, row, round: m.round, xp: 0, level: 0, cost };
    m.armies[side].push(sq);
    m.gold[side] -= cost;
    return sq;
  }

  // Only squads bought this round can be taken back
  function unplace(m, side, col, row) {
    const i = m.armies[side].findIndex(s => s.col === col && s.row === row && s.round === m.round);
    if (i < 0) return false;
    const [sq] = m.armies[side].splice(i, 1);
    m.gold[side] += sq.cost;
    return true;
  }

  function bodiesFor(m, side) {
    const out = [];
    let idx = 0;
    for (const sq of m.armies[side]) {
      const w = tileToWorld(sq.col, sq.row);
      const b = E.buildSquad(unitFor(m, side, sq.unit), side, w.x, w.y, sq.id, TILE, idx, sq.level);
      if (isFlank(side, sq.col, sq.row) && sq.round === m.round) for (const x of b) x.delay = FLANK.delay; // only in its first fight
      idx += b.length;
      out.push(...b);
    }
    const t = m.towers && m.towers[side];
    if (t) { const w = tileToWorld(t.col, t.row); out.push(...E.buildSquad(TOWER, side, w.x, w.y, -2, TILE, idx)); }
    return out;
  }

  function startBattle(m) {
    ensureTower(m, 0); ensureTower(m, 1);
    ensurePack(m, 0); ensurePack(m, 1);
    return E.createBattle(bodiesFor(m, 0), bodiesFor(m, 1), SETTINGS, { record: true });
  }

  // Damage a side deals = points of its squads, scaled by how much of each squad is still alive
  function survivorDamage(m, res, side) {
    let sum = 0;
    for (const k in res.squads) {
      const s = res.squads[k];
      if (s.side !== side || s.alive <= 0 || s.squad < 0) continue; // spawned bodies don't count
      const sq = m.armies[side].find(q => q.id === s.squad);
      const value = sq ? (m.units[sq.unit].cost || 1) : 1; // pricier squads hit harder, like their price
      sum += SQUAD_POINTS * value * s.alive / s.total;
    }
    return sum > 0 ? Math.max(1, Math.round(sum)) : 0;
  }

  // Apply a finished battle to the match. Returns a summary for the results screen.
  function resolve(m, res) {
    const dmg = [0, 0]; // damage taken by each side
    let roundWinner = res.winner;
    if (res.timeout) {
      dmg[0] = survivorDamage(m, res, 1);
      dmg[1] = survivorDamage(m, res, 0);
    } else if (res.winner === 0) dmg[1] = survivorDamage(m, res, 0);
    else if (res.winner === 1) dmg[0] = survivorDamage(m, res, 1);
    m.hp[0] = Math.max(0, m.hp[0] - dmg[0]);
    m.hp[1] = Math.max(0, m.hp[1] - dmg[1]);
    // experience carries over between rounds; squads that reach the next threshold become ready to level up
    const newlyReady = [[], []];
    for (let side = 0; side < 2; side++) {
      for (const sq of m.armies[side]) {
        const r = res.squads[side + ':' + sq.id];
        if (!r) continue;
        const was = isReady(m, sq);
        sq.xp += r.xp;
        if (!was && isReady(m, sq)) newlyReady[side].push({ id: sq.id, unit: sq.unit, level: sq.level + 1 });
      }
    }
    // how each squad did: share of bodies left and damage dealt (for reports and Claude)
    const squads = [[], []];
    for (let side = 0; side < 2; side++) for (const sq of m.armies[side]) {
      const r = res.squads[side + ':' + sq.id];
      if (r) squads[side].push({ id: sq.id, unit: sq.unit, level: sq.level, left: r.alive / r.total, dealt: Math.round(r.dealt || 0) });
    }
    const towerFell = [0, 1].map(sd => { const q = res.squads[sd + ':-2']; return !!(q && q.alive === 0); });
    const summary = { round: m.round, winner: roundWinner, timeout: res.timeout, dmg, time: res.time, newlyReady, squads, towerFell };
    m.history.push(summary);
    if (m.hp[0] <= 0 || m.hp[1] <= 0) {
      m.over = true;
      m.winner = m.hp[0] > 0 ? 0 : m.hp[1] > 0 ? 1 : -1;
      return summary;
    }
    // next round
    m.round++;
    m.extraDeploys = [0, 0];
    const income = incomeFor(m.round);
    m.gold[0] += income; m.gold[1] += income;
    summary.income = income;
    const loser = dmg[0] > dmg[1] ? 0 : dmg[1] > dmg[0] ? 1 : -1;
    if (loser >= 0) m.gold[loser] += LOSER_BONUS;
    summary.bonusTo = loser;
    return summary;
  }

  // ---------- leveling (manual, costs gold) ----------
  const isReady = (m, sq) => sq.level < E.MAX_LEVEL && sq.xp >= xpNeeded(m.units[sq.unit], sq.level);

  function levelUp(m, side, sqId) {
    const sq = m.armies[side].find(s => s.id === sqId);
    if (!sq || !isReady(m, sq)) return false;
    const cost = levelCost(m.units[sq.unit]);
    if (m.gold[side] < cost) return false;
    m.gold[side] -= cost;
    sq.level++;
    (sq.boughtLevels = sq.boughtLevels || {})[m.round] = ((sq.boughtLevels || {})[m.round] || 0) + 1;
    return true;
  }

  // Undo a level bought this round (full refund)
  function undoLevel(m, side, sqId) {
    const sq = m.armies[side].find(s => s.id === sqId);
    if (!sq || !sq.boughtLevels || !sq.boughtLevels[m.round]) return false;
    sq.boughtLevels[m.round]--;
    sq.level--;
    m.gold[side] += levelCost(m.units[sq.unit]);
    return true;
  }

  // AI levels up at fight time, using only what it knew at the start of the round.
  // It skips chaff (8+ bodies): feeding leveled chaff to the enemy gives away XP.
  function aiLevel(m, side) {
    const done = [];
    if (AI.levelPolicy === 'never') return done;
    const ready = m.armies[side].filter(s => isReady(m, s))
      .sort((a, b) => E.withTraits(m.units[b.unit]).range - E.withTraits(m.units[a.unit]).range);
    for (const sq of ready) {
      const u = m.units[sq.unit];
      if (AI.levelPolicy === 'smart' && u.bodies >= 8) continue;
      while (isReady(m, sq) && levelUp(m, side, sq.id)) done.push({ id: sq.id, unit: sq.unit, level: sq.level });
    }
    return done;
  }

  // ---------- AI ----------
  // Buys units that counter the opponent's army as it stood at the start of the round,
  // using the counter table, with a nudge toward variety and a little randomness.
  function aiDeploy(m, side) {
    const r = rng(m.seed + m.round * 7919 + side * 104729);
    if (needsPack(m, side)) { // the package whose units do best against the whole roster
      let bk = 0, bs = -Infinity;
      m.packages[side].forEach((p, k) => {
        let s = 0;
        for (const ui of p.squads) s += m.matrix[ui].reduce((a, b) => a + b, 0) * unitCostOf(m.units[ui]);
        s += (r() - 0.5) * 50;
        if (s > bs) { bs = s; bk = k; }
      });
      choosePack(m, side, bk);
    }
    if (needsTower(m, side)) { // tower first: a back corner, left or right
      const rows = zoneRows(side);
      const col = r() < 0.5 ? 1 + Math.floor(r() * 2) : 9 + Math.floor(r() * 2);
      if (!placeTower(m, side, col, rows[3 + Math.floor(r() * 2)])) ensureTower(m, side);
    }
    const opp = 1 - side;
    const oppArmy = m.armies[opp].filter(s => s.round < m.round);
    for (const ui of freeLeft(m, side)) { const spot = aiSpot(m, side, ui, oppArmy, r); if (spot) place(m, side, ui, spot.col, spot.row); }
    const oppCount = {};
    for (const s of oppArmy) oppCount[s.unit] = (oppCount[s.unit] || 0) + 1;
    const own = {};
    for (const s of m.armies[side]) own[s.unit] = (own[s.unit] || 0) + 1;
    const bought = [];
    // keep gold back for the level-ups it will buy at fight time
    let reserve = 0;
    if (AI.levelPolicy !== 'never') {
      for (const sq of m.armies[side]) {
        if (!isReady(m, sq)) continue;
        if (AI.levelPolicy === 'smart' && m.units[sq.unit].bodies >= 8) continue;
        reserve += levelCost(m.units[sq.unit]);
      }
    }
    const minCost = Math.min(...m.units.map(unitCostOf));
    // skills: for unit types it has 2 or more squads of, sometimes buy a skill if a squad is still affordable after
    if (AI.skills) {
      const types = Object.keys(own).map(Number).filter(ui => own[ui] >= 2).sort((a, b) => own[b] - own[a]);
      for (const ui of types) for (const k of [0, 1]) {
        if (!skillDef(m, ui, k) || hasSkill(m, side, ui, k)) continue;
        if (m.gold[side] - reserve - skillCost(m, ui, k) < minCost) continue;
        if (r() < 0.5) buySkill(m, side, ui, k);
      }
    }
    let guard = 0;
    while (m.gold[side] - reserve >= minCost && guard++ < 60) {
      if (deploysLeft(m, side) <= 0) {
        // out of deployments: buy one more only if a squad is still affordable after it
        if (m.extraDeploys[side] >= AI.maxExtraDeploys || m.gold[side] - reserve < minCost + CONFIG.extraDeployCost) break;
        if (!buyDeploy(m, side)) break;
      }
      const budget = m.gold[side] - reserve;
      let best = -1, bs = -Infinity;
      m.units.forEach((u, i) => {
        const extra = isUnlocked(m, side, i) ? 0 : unlockCost(m, i); // a locked unit costs its unlock on top
        if (unitCostOf(u) + extra > budget) return;
        let s = 0, tot = 0;
        for (const t in oppCount) { s += oppCount[t] * (m.matrix[i][t] || 0); tot += oppCount[t]; }
        s = tot ? s / tot : 0;
        s -= 0.2 * extra / SQUAD_COST; // unlocking is a one-off, so lean a little toward units already open
        s -= 0.12 * (own[i] || 0);
        s += (r() - 0.5) * 0.35;
        if (s > bs) { bs = s; best = i; }
      });
      if (best < 0) break;
      const spot = aiSpot(m, side, best, oppArmy, r);
      if (!spot) break;
      if (!isUnlocked(m, side, best) && !unlock(m, side, best)) break;
      const sq = place(m, side, best, spot.col, spot.row);
      if (!sq) break;
      own[best] = (own[best] || 0) + 1;
      bought.push(sq);
    }
    return bought;
  }

  function aiSpot(m, side, unitIdx, oppArmy, r) {
    const u = E.withTraits(m.units[unitIdx]);
    const rows = zoneRows(side);
    const band = u.range <= 12 ? [0, 1] : u.range <= 22 ? [1, 2] : u.range <= 30 ? [2, 3] : [3, 4]; // rows counted from the front
    // aim at the columns of the enemy squads this unit counters
    let wsum = 0, csum = 0;
    for (const s of oppArmy) {
      const w = Math.max(0, m.matrix[unitIdx][s.unit] || 0);
      wsum += w; csum += w * s.col;
    }
    const target = wsum > 0 ? csum / wsum : (COLS - 1) / 2 + (r() - 0.5) * 6;
    // fast melee units sometimes take a flank column, on the side of the enemy tower when it is known
    if (flankOpen(m) && u.range <= 5 && u.speed >= 6 && r() < 0.5) {
      const et = m.towers && m.towers[1 - side];
      const cols = et ? FLANK.cols.slice().sort((a, b) => Math.abs(a - et.col) - Math.abs(b - et.col)) : (r() < 0.5 ? FLANK.cols.slice() : FLANK.cols.slice().reverse());
      for (const col of cols) for (const row of flankRows(side)) if (!occupied(m, side, col, row) && canPlaceAt(m, side, col, row)) return { col, row };
    }
    let best = null, bc = Infinity;
    for (let zi = 0; zi < rows.length; zi++) {
      for (let col = 0; col < COLS; col++) {
        const row = rows[zi];
        if (occupied(m, side, col, row) || !canPlaceAt(m, side, col, row)) continue;
        const rowCost = band.includes(zi) ? 0 : 3 * Math.min(Math.abs(zi - band[0]), Math.abs(zi - band[1]));
        const c = Math.abs(col - target) + rowCost + r() * 0.8;
        if (c < bc) { bc = c; best = { col, row }; }
      }
    }
    return best;
  }

  return {
    COLS, ROWS, TILE, ZONE, START_HP, START_GOLD, INCOME, incomeFor, LOSER_BONUS, SQUAD_COST, SQUAD_POINTS, SETTINGS, XP_STEPS, xpNeeded, unitCostOf,
    levelCost, isReady, levelUp, undoLevel, aiLevel, AI, CONFIG,
    deploysAllowed, deploysLeft, deployedThisRound, buyDeploy, refundDeploy,
    PACKAGE, allPackages, packOf, needsPack, freeLeft, choosePack, ensurePack,
    unlockCost, isUnlocked, unlockVisible, unlock, undoUnlock,
    skillDef, skillCost, isInnate, hasSkill, skillVisible, unitFor, canBuySkill, buySkill, undoSkill, sellValue, sell,
    TOWER, TOWER_MID, towerColOk, towerAt, needsTower, placeTower, ensureTower,
    FLANK, flankRows, flankOpen, isFlank, reserved, canPlaceAt, enemyHolds,
    zoneRows, inZone, tileToWorld, createMatch, place, unplace, bodiesFor, startBattle, resolve, aiDeploy, occupied,
  };
})();
if (typeof module !== 'undefined') module.exports = Game;
