// ===== Match rules and AI (shared by headless tests and the page) =====
const Game = (() => {
  const E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');

  const COLS = 12, ROWS = 16, TILE = 6, ZONE = 6; // each side builds in ZONE rows; the rows between are no man's land
  const START_HP = 60, MAX_ROUND_DMG = 20, START_GOLD = 250, INCOME = 250, LOSER_BONUS = 50;
  const SQUAD_COST = 100, SQUAD_POINTS = 2;
  const SETTINGS = { dt: 0.05, timeCap: 60, spacing: 3.5, minDmgPct: 15, absorbXp: 1, armorXp: 0.5, sight: 12, flameReach: 1.2 }; // flameReach: flame cones reach 1.2x the unit's range
  // XP a squad needs in total to reach level 1, 2, 3, as multiples of its own starting health.
  // XP = damage dealt + damage absorbed + bounty for killing leveled bodies.
  const XP_STEPS = [5, 12, 24];
  const xpNeeded = (unit, level) => unit.bodies * unit.hp * XP_STEPS[level];
  // deployments: how many new squads a side may place per round; extra ones can be bought for the round
  const CONFIG = { incomeStep: 100, levelCostPerTier: 50, firstRoundDeploys: 3, deploysPerRound: 2, extraDeployCost: 50, deployCap: true, moveCost: 50 };
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
  // Each player has one tower. It stands on a fixed tile (TOWER_SPOT): column 8, second row from the back,
  // and the opponent's sits straight across the board from it (on the Mushroom Cavern, mirrored as each player sees it: see towerSpot). It has a short, light attack. If it falls, that player's army is
  // crippled for a few seconds (see Engine.TOWER_DOWN). It is rebuilt for every round.
  const TOWER = { name: 'Tower', cost: 0, bodies: 1, hp: 650, hit: 30, aps: 1.2, range: 8, speed: 0, splash: 0, structure: true, shape: 'square', color: '#C9B79C' };
  const TOWER_MID = [4, 7]; // columns the tower can't stand in
  const TOWER_SPOT = [{ col: 8, row: ROWS - 2 }, { col: 8, row: 1 }];

  // ---------- characters ----------
  // Each starting package comes with a character, who gives that player a passive ability for the whole match.
  const CHARACTERS = [
    { id: 'cage', name: 'Frickolas Cage', ability: 'All your units have 10% more health.' },
    { id: 'zoe', name: 'Zoe', ability: 'Every round, 2 random tiles in your zone become buff tiles. A squad that starts the fight on one gets +20% damage, +20% health and +10% attack speed for the whole fight.' },
    { id: 'emile', name: 'Emile', ability: 'Tier 1 units are free to unlock.' },
    { id: 'wilhelm', name: 'Wilhelm', ability: 'Your squads on flank tiles and in no man’s land get +4 armor, and flank squads start twice as fast.' },
  ];
  const CHAR = { cageHp: 10, zoeTiles: 2, zoeDmg: 20, zoeHp: 20, zoeAps: 10, wilhelmArmor: 4, wilhelmDelay: 0.5 };
  const charOf = (m, side) => (m && m.chars && m.chars[side]) || null;
  const charInfo = (id) => CHARACTERS.find(c => c.id === id) || null;
  // ---------- maps ----------
  // Each match is fought on one map, picked at random when the match is created. A map can change the
  // rules of every fight. Elf tower: a neutral tower standing on the centre line of no man's land, the same
  // distance from both zones, in a random column that stays for the whole match. It can't be attacked, and
  // its shots alternate between the two sides.
  const MAPS = [
    { id: 'forest', name: 'Forest Clearing', text: 'Stealth units deal 20% more damage. Healing and regeneration are 1.5× as strong. A neutral elf tower in no man’s land shoots at both sides in turn; tap it to bribe the elves for 50 gold, and from then on it heals your units instead.', stealthDmg: 20, healMul: 1.5, elfTower: true },
    { id: 'cavern', name: 'Mushroom Cavern', text: 'Glowing mushroom tiles stay on the same tiles all match, mirrored on both halves. Purple: a squad that starts the fight there gets +10% damage, +10% health and +5% attack speed. Yellow: a unit that starts on it or walks over it moves 30% faster for the rest of the fight. Green: a unit that starts on it or walks over it is poisoned and slowed. Yellow and green work once per unit, for both sides. Either player can remove a mushroom tile for 50 gold.', shrooms: true, pointMirror: true },
    { id: 'ice', name: 'Frozen Peak', text: 'Odd rounds from round 3: a hailstorm drops 10 hail tiles in the storm band (no man’s land at first); units standing in hail take 5 damage per second. Even rounds: the altar of ice rises in the middle of the board. Tap it to buy ice walls for your tower, push the storm band toward your opponent, or summon a Snowgre.', ice: true },
  ];
  // ---------- Frozen Peak: hailstorm and the altar of ice ----------
  // The storm band is 4 rows deep: no man's land to start with. Each push moves it ICE.push rows toward the other
  // player, for the rest of the match (side 0 pushes toward row 0, side 1 toward the last row); it never leaves the board.
  const ICE = { hailTiles: 10, hailDps: 5, push: 2, wallHits: 10, costs: { walls: 50, push: 100, snowgre: 150 }, snowStep: 50, snowFirst: 0.25 };
  // what the altar sells, cheapest first
  const ALTAR = [
    { id: 'walls', name: 'Ice walls', text: `Ice walls rise around your tower for this round’s fight. Each of the 4 walls blocks the first 10 hits coming from its side.` },
    { id: 'push', name: 'Push the hailstorm', text: `Moves the storm band 2 rows toward your opponent for the rest of the match, starting with the next hailstorm. Your opponent can push it back.` },
    { id: 'snowgre', name: 'Summon a Snowgre', text: 'A white golem made of snow joins your army for the rest of the match. It stands in your half of no man’s land at the start of every fight and doesn’t mind hail. The first is 25% as strong as an Ether Golem, and each one after is twice as strong as the last.' },
  ];
  // the Ether Golem a Snowgre is modelled on (taken from the roster when it has one)
  const GOLEM = { name: 'Ether Golem', cost: 5, bodies: 1, hp: 3450, hit: 69, aps: 0.6, range: 5, speed: 2.5, splash: 3, defense: 'armor', defVal: 15 };
  const isIce = (m) => !!(mapOf(m) && mapOf(m).ice);
  const hailRound = (m) => isIce(m) && m.round >= 3 && m.round % 2 === 1;
  const altarRound = (m) => isIce(m) && m.round % 2 === 0;
  const altarBuys = (m) => (m && m.altar) || [];
  // how far the storm band has been pushed (rows toward row 0) by purchases made before round `round`
  function stormShift(m, round) {
    let off = 0;
    for (const b of altarBuys(m)) if (b.type === 'push' && b.round < round) off = Math.max(-ZONE, Math.min(ZONE, off + (b.side === 0 ? ICE.push : -ICE.push))); // the band stays on the board
    return off; // positive: toward side 1 (row 0)
  }
  // rows of the storm band in a given round
  const stormRows = (m, round) => { const off = stormShift(m, round == null ? m.round : round); return Array.from({ length: ROWS - 2 * ZONE }, (_, i) => ZONE + i - off); };
  // this round's hail tiles (none outside hail rounds), the same on both phones
  function hailTiles(m) {
    if (!hailRound(m)) return [];
    const r = rng(m.seed + m.round * 9137 + 55), spots = [];
    for (const row of stormRows(m)) for (let col = 0; col < COLS; col++) spots.push({ col, row });
    const out = [];
    for (let k = 0; k < ICE.hailTiles && spots.length; k++) out.push(spots.splice(Math.floor(r() * spots.length), 1)[0]);
    return out;
  }
  const altarCost = (m, side, type) => type === 'snowgre' ? ICE.costs.snowgre + ICE.snowStep * altarBuys(m).filter(b => b.side === side && b.type === 'snowgre' && b.round < m.round).length : ICE.costs[type];
  const altarBought = (m, side, type) => altarBuys(m).some(b => b.side === side && b.type === type && b.round === m.round);
  // a Snowgre's spot: a random tile in its owner's half of no man's land, picked when it is summoned
  function snowSpot(m, side, k) {
    const r = rng(m.seed + side * 7717 + k * 313 + 3);
    const rows = Array.from({ length: ROWS / 2 - ZONE }, (_, i) => side === 0 ? ROWS / 2 + i : ROWS / 2 - 1 - i);
    return { col: Math.floor(r() * COLS), row: rows[Math.floor(r() * rows.length)] };
  }
  // add a purchase without paying (paying is buyAltar's job; the host also uses this for the guest's purchases)
  function addAltar(m, side, type) {
    if (!altarRound(m) || !ALTAR.some(a => a.id === type) || altarBought(m, side, type)) return false;
    if (!m.altar) m.altar = [];
    const b = { side, round: m.round, type };
    if (type === 'snowgre') { const k = altarBuys(m).filter(x => x.side === side && x.type === 'snowgre').length; Object.assign(b, snowSpot(m, side, k)); }
    m.altar.push(b);
    return true;
  }
  function buyAltar(m, side, type) {
    const cost = altarCost(m, side, type);
    if (!(cost > 0) || m.gold[side] < cost || !addAltar(m, side, type)) return false;
    m.gold[side] -= cost;
    return true;
  }
  // take back a purchase made this round, for a full refund
  function undoAltar(m, side, type) {
    const i = altarBuys(m).findIndex(b => b.side === side && b.type === type && b.round === m.round);
    if (i < 0) return false;
    const cost = altarCost(m, side, type);
    m.altar.splice(i, 1);
    m.gold[side] += cost;
    return true;
  }
  // a player's Snowgres, oldest first: { col, row, strength, round }
  const snowgres = (m, side) => altarBuys(m).filter(b => b.side === side && b.type === 'snowgre').map((b, k) => ({ col: b.col, row: b.row, round: b.round, strength: ICE.snowFirst * Math.pow(2, k) }));
  function snowgreUnit(m, strength) {
    const g = (m.units || []).find(u => u && u.name === GOLEM.name) || GOLEM;
    const { skills, skillDefs, skillsOn, skillsInnate, skillMods, ...plain } = g;
    return E.withTraits({ ...plain, name: 'Snowgre', level: 0, hp: plain.hp * strength, hit: plain.hit * strength, shape: 'square', color: '#F2F6FA', hailImmune: true, snowgre: strength });
  }
  // Mushroom Cavern tiles. Each player's half of the board gets SHROOM_SPLIT of them; the other half is the mirror image
  // as each player sees it (column and row both flipped: a tile on your right is a tile on their right). purple: half a Zoe buff for squads that start there (never on the flank
  // columns); yellow: move speed (only on the flank columns or in no man's land); green: poison and slow (anywhere).
  const SHROOM_SPLIT = { purple: 2, yellow: 1, green: 2 };
  const SHROOM = { purpleDmg: 10, purpleHp: 10, purpleAps: 5, speed: 30, poisonPct: 3, poisonDur: 4, slowMove: 40, slowAtk: 20, slowDur: 3 }; // poisonPct: % of max health per second
  // healHit/healAps/healSplash: the small splash heal it throws on the units of a player who bribed it
  const ELF_TOWER = { name: 'Elf Tower', cost: 0, bodies: 1, hp: 1, hit: 20, aps: 0.5, range: 12, speed: 0, splash: 0, structure: true, healHit: 15, healAps: 0.4, healSplash: 2.5 };
  // Bribing the elves: once per match, for BRIBE_COST gold. From the next fight on, the elf tower never shoots
  // that player's units again and heals them instead. A bribe stays hidden from the opponent until the fight,
  // and can be taken back (full refund) in the round it was bought.
  const BRIBE_COST = 50;
  const bribed = (m, side) => !!(m && m.bribe && m.bribe[side] > 0);
  const bribeVisible = (m, side) => bribed(m, side) && m.bribe[side] < m.round;
  const canBribe = (m, side) => !!elfSpot(m) && !bribed(m, side) && m.gold[side] >= BRIBE_COST;
  function bribe(m, side) {
    if (!canBribe(m, side)) return false;
    if (!m.bribe) m.bribe = [0, 0];
    m.gold[side] -= BRIBE_COST;
    m.bribe[side] = m.round;
    return true;
  }
  function undoBribe(m, side) {
    if (!m.bribe || m.bribe[side] !== m.round) return false;
    m.bribe[side] = 0;
    m.gold[side] += BRIBE_COST;
    return true;
  }
  const ELF_COLS = [2, 9]; // the elf tower's column is picked from these (never the flank edges)
  function rollMap(seed) {
    const r = rng(seed + 31337);
    const mp = MAPS[Math.floor(r() * MAPS.length)];
    const out = { id: mp.id };
    if (mp.elfTower) out.elfCol = ELF_COLS[0] + Math.floor(r() * (ELF_COLS[1] - ELF_COLS[0] + 1));
    if (mp.shrooms) {
      // rolled on side 0's half (rows ROWS/2 .. ROWS-1), then mirrored onto side 1's
      const used = new Set([TOWER_SPOT[0].col + ',' + TOWER_SPOT[0].row]), half = [];
      const edge = (col) => col === 0 || col === COLS - 1;
      const ok = { purple: (c, rw) => !edge(c), yellow: (c, rw) => edge(c) || inNoMans(rw), green: () => true };
      for (const type of ['yellow', 'purple', 'green']) for (let k = 0; k < SHROOM_SPLIT[type]; k++) {
        const spots = [];
        for (let row = ROWS / 2; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (!used.has(col + ',' + row) && ok[type](col, row)) spots.push({ col, row });
        const sp = spots[Math.floor(r() * spots.length)];
        used.add(sp.col + ',' + sp.row);
        half.push({ col: sp.col, row: sp.row, type });
      }
      out.tiles = half.concat(half.map(t => ({ ...t, col: COLS - 1 - t.col, row: ROWS - 1 - t.row })));
    }
    return out;
  }
  // the mushroom tile on a square, if it is still there (removed tiles are gone for the rest of the match)
  const shroomTileAt = (m, col, row) => { const mp = mapOf(m); return mp && mp.shrooms && m.map.tiles ? (m.map.tiles.find(t => t.col === col && t.row === row) || null) : null; };
  const shroomRemoval = (m, col, row) => (m && m.map && m.map.removed || []).find(x => x.col === col && x.row === row) || null;
  const shroomAt = (m, col, row) => shroomRemoval(m, col, row) ? null : shroomTileAt(m, col, row);
  // Removing a mushroom tile: SHROOM_REMOVE gold, any tile, either player. It is gone from the next fight on.
  // Like a bribe, a removal stays hidden from the opponent until the fight and can be taken back in the same round.
  const SHROOM_REMOVE = 50;
  // (both players may pick the same tile in the same round, since neither can see the other's choice; both pay)
  function removeShroom(m, side, col, row) {
    if (!shroomTileAt(m, col, row) || m.gold[side] < SHROOM_REMOVE) return false;
    if ((m.map.removed || []).some(x => x.col === col && x.row === row && (x.round < m.round || x.side === side))) return false;
    if (!m.map.removed) m.map.removed = [];
    m.gold[side] -= SHROOM_REMOVE;
    m.map.removed.push({ col, row, side, round: m.round });
    return true;
  }
  function undoRemoveShroom(m, side, col, row) {
    const x = (m.map && m.map.removed || []).find(q => q.col === col && q.row === row && q.side === side && q.round === m.round);
    if (!x) return false;
    m.map.removed.splice(m.map.removed.indexOf(x), 1);
    m.gold[side] += SHROOM_REMOVE;
    return true;
  }
  // Where a player's tower stands. On a pointMirror map the board is mirrored as each player sees it, so the
  // second tower moves to the flipped column too (on your right for you means on their right for them).
  const towerSpot = (m, side) => {
    const t = TOWER_SPOT[side], mp = mapOf(m);
    return side === 1 && mp && mp.pointMirror ? { col: COLS - 1 - t.col, row: t.row } : { ...t };
  };
  const mapOf = (m) => (m && m.map && MAPS.find(x => x.id === m.map.id)) || null;
  // where the elf tower stands (world coordinates), or null: on its column, on the line between the two middle rows
  const elfSpot = (m) => { const mp = mapOf(m); return mp && mp.elfTower && m.map.elfCol != null ? { x: tileToWorld(m.map.elfCol, 0).x, y: 0, col: m.map.elfCol } : null; };
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
  // Where the other player sees a squad: a squad moved this round still shows on its old tile until the fight
  const seenAt = (m, sq) => sq.from && sq.movedRound === m.round ? sq.from : sq;
  const enemyHolds = (m, side, col, row) => !!m && (m.armies[1 - side].some(s => { const p = seenAt(m, s); return !hiddenFromFoe(m, s) && p.col === col && p.row === row && s.round < m.round; }) ||
    (m.round > 1 && m.towers && m.towers[1 - side] && m.towers[1 - side].col === col && m.towers[1 - side].row === row));
  // the edge tiles of your zone that are the enemy's flank are reserved for them for the whole match
  const reserved = (side, col, row) => isFlank(1 - side, col, row);
  // no man's land: the rows between the two zones. A unit with the Forward planting skill may be placed there.
  const inNoMans = (row) => row >= ZONE && row < ROWS - ZONE;
  const hasSkillType = (m, side, ui, type) => !!m && ui != null && !!m.units[ui] && E.SLOTS.some(k => hasSkill(m, side, ui, k) && skillDef(m, ui, k).type === type);
  // ui (optional): the unit being placed, for unit-specific tiles
  const canPlaceAt = (m, side, col, row, ui) => col >= 0 && col < COLS && !reserved(side, col, row) &&
    !(ui != null && m && m.units[ui] && m.units[ui].noFlank && isFlank(side, col, row)) &&
    (inZone(side, row) || (flankOpen(m) && isFlank(side, col, row)) || (inNoMans(row) && hasSkillType(m, side, ui, 'forward'))) && !enemyHolds(m, side, col, row);
  // ---------- carriers (Just a horse) ----------
  // A squad of a carrier unit can hold one squad of any other unit inside. The rider is an ordinary squad in the
  // army (it levels, sells and counts like any other) with `in` = the carrier's squad id, on the carrier's tile.
  // The opponent never sees it on the board; in a fight it stays inside until the carrier dies (see Engine).
  const isRider = (sq) => !!sq && sq.in != null;
  // what the opponent can't see on the board: riders, and a squad that stepped out of a carrier this round (it is
  // still inside as far as they know)
  const hiddenFromFoe = (m, s) => isRider(s) || !!(s.from && s.movedRound === m.round && s.from.in != null);
  const isCarrier = (m, ui) => !!(m && m.units[ui] && m.units[ui].carrier);
  const riderOf = (m, side, sq) => sq ? m.armies[side].find(s => s.in === sq.id) || null : null;
  const carrierOf = (m, side, sq) => isRider(sq) ? m.armies[side].find(s => s.id === sq.in) || null : null;
  // the squad standing on a tile (a carrier, never its rider)
  const squadAt = (m, side, col, row) => m.armies[side].find(s => !isRider(s) && s.col === col && s.row === row) || null;
  // the carrier on a tile that has room for a squad of unit ui
  function boardable(m, side, col, row, ui) {
    const c = squadAt(m, side, col, row);
    return c && isCarrier(m, c.unit) && !isCarrier(m, ui) && !riderOf(m, side, c) ? c : null;
  }
  // riders follow their carrier's tile
  const syncRiders = (m, side) => { for (const s of m.armies[side]) if (isRider(s)) { const c = carrierOf(m, side, s); if (c) { s.col = c.col; s.row = c.row; } else delete s.in; } };
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
    // a random character for each package, never the same one twice among a player's options
    const ids = CHARACTERS.map(c => c.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    return pick.map((p, k) => ({ ...p, char: ids[k % ids.length] }));
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
    if (!m.chars) m.chars = [null, null];
    m.chars[side] = m.packages[side][k].char || null;
    rollBuffTiles(m, side);
    if (!m.unlocks) m.unlocks = [{}, {}];
    for (const ui of m.packages[side][k].units) m.unlocks[side][ui] = m.round;
    placeFree(m, side);
    return true;
  }
  // package squads go straight onto the board (before the tower); the player can drag them elsewhere
  function placeFree(m, side) {
    const r = rng(m.seed + 4242 + side);
    for (const ui of freeLeft(m, side)) {
      const spot = aiSpot(m, side, ui, [], r);
      if (!spot) break;
      m.armies[side].push({ id: m.nextId[side]++, unit: ui, col: spot.col, row: spot.row, round: m.round, xp: 0, level: 0, cost: 0, free: true });
    }
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
    const m = {
      units, matrix, seed: seed >>> 0,
      round: 1, hp: [START_HP, START_HP], gold: [START_GOLD, START_GOLD],
      armies: [[], []], nextId: [1, 1], history: [], over: false, winner: -1,
      extraDeploys: [0, 0],
      moved: [null, null], // id of the squad each player moved this round (one move per round, CONFIG.moveCost gold)
      tech: [{}, {}], // skills bought per unit type: tech[side][unitIdx] = [round bought or 0, round bought or 0]
      towers: null, // { col, row } of each player's tower (fixed; set below, as it depends on the map)
      chars: [null, null], // each player's character id (comes with the package)
      buff: [[], []], // Zoe's buff tiles for this round: [{ col, row }, ...]
      unlocks: [{}, {}], // units unlocked per player: unlocks[side][unitIdx] = round it was unlocked
      packages: [dealPackages(units, r), dealPackages(units, r)], // each player's 3 starting package options, each with a different random character
      pack: [null, null], // which one each player picked
      map: rollMap(seed >>> 0), // { id, elfCol }: the map this match is fought on
      bribe: [0, 0], // round each player bribed the elf tower in (0 = not bribed)
    };
    m.towers = [towerSpot(m, 0), towerSpot(m, 1)];
    return m;
  }

  // ---------- skills (bought per unit type, for all squads of that type) ----------
  // m.units[i].skillDefs = [def or null, ...], one per skill slot (Engine.SKILL_SLOTS)
  const skillDef = (m, ui, k) => (m.units[ui].skillDefs || [])[k] || null;
  const skillCost = (m, ui, k) => { const d = skillDef(m, ui, k); return d ? Math.max(0, Math.round(+d.cost || 0)) : 0; };
  // a built-in skill (skillsInnate on the unit) is always on, free and visible
  const isInnate = (m, ui, k) => !!(skillDef(m, ui, k) && Array.isArray(m.units[ui].skillsInnate) && m.units[ui].skillsInnate[k]);
  const hasSkill = (m, side, ui, k) => isInnate(m, ui, k) || !!(m.tech && m.tech[side] && m.tech[side][ui] && m.tech[side][ui][k] > 0);
  // a skill bought this round is hidden from the opponent until the fight
  const skillVisible = (m, side, ui, k) => isInnate(m, ui, k) || (hasSkill(m, side, ui, k) && m.tech[side][ui][k] < m.round);
  function unitFor(m, side, ui) {
    const base = m.units[ui];
    const defs = E.SLOTS.filter(k => hasSkill(m, side, ui, k)).map(k => skillDef(m, ui, k));
    let u = defs.length ? E.applySkills(base, defs, m.units) : base;
    if (charOf(m, side) === 'cage') { // Frickolas Cage: +10% health for every unit, spawned ones too
      const k = 1 + CHAR.cageHp / 100;
      u = { ...u, hp: u.hp * k };
      if (u.spawn) u.spawn = { ...u.spawn, unit: { ...u.spawn.unit, hp: u.spawn.unit.hp * k } };
    }
    return u;
  }
  // ---------- unlocks (like Mechabellum: some units start unlocked, the rest cost gold once per match) ----------
  // tier 1 = the cheapest price in the roster
  const isTier1 = (m, ui) => unitCostOf(m.units[ui]) === Math.min(...m.units.map(unitCostOf));
  // side (optional): that player's price, so Emile's tier 1 unlocks are free
  const unlockCost = (m, ui, side) => side != null && charOf(m, side) === 'emile' && isTier1(m, ui) ? 0 : Math.max(0, Math.round(+m.units[ui].unlock || 0));
  const isUnlocked = (m, side, ui) => unlockCost(m, ui, side) === 0 || !!(m.unlocks && m.unlocks[side] && m.unlocks[side][ui] > 0);
  // an unlock bought this round is hidden from the opponent until the fight
  const unlockVisible = (m, side, ui) => unlockCost(m, ui, side) === 0 || (isUnlocked(m, side, ui) && m.unlocks[side][ui] < m.round);
  function unlock(m, side, ui) {
    if (ui < 0 || ui >= m.units.length || isUnlocked(m, side, ui)) return false;
    const cost = unlockCost(m, ui, side);
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
    m.gold[side] += unlockCost(m, ui, side);
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
    const t = m.tech[side][ui] || (m.tech[side][ui] = E.SLOTS.map(() => 0));
    t[k] = m.round;
    return true;
  }
  function undoSkill(m, side, ui, k) {
    const t = m.tech && m.tech[side][ui];
    if (!t || t[k] !== m.round) return false;
    // Forward planting can't be taken back while a squad of that unit stands in no man's land
    const d = skillDef(m, ui, k);
    if (d && d.type === 'forward' && m.armies[side].some(s => s.unit === ui && inNoMans(s.row))) return false;
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
    syncRiders(m, side); // a sold carrier's rider steps out onto the tile
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

  // ---------- moving squads ----------
  // Squads placed this round can be moved freely. Once per round a player may also move one squad from an
  // earlier round, for CONFIG.moveCost gold. Moving it back to where it was refunds the gold.
  const movedId = (m, side) => (m.moved && m.moved[side] != null) ? m.moved[side] : null;
  const canMove = (m, side, sq) => !!sq && (sq.round === m.round ||
    (movedId(m, side) == null ? m.gold[side] >= CONFIG.moveCost : movedId(m, side) === sq.id));
  function moveSquad(m, side, sqId, col, row) {
    const sq = m.armies[side].find(s => s.id === sqId);
    if (!sq || (sq.col === col && sq.row === row) || !canMove(m, side, sq)) return false;
    // a squad can move onto a free tile, or into a carrier with room (a rider can also step out, or change carriers)
    const into = boardable(m, side, col, row, sq.unit);
    if (into && into.id === sq.in) return false;
    if (!canPlaceAt(m, side, col, row, sq.unit) || (occupied(m, side, col, row) && !into)) return false;
    if (sq.round !== m.round && movedId(m, side) == null) {
      if (!m.moved) m.moved = [null, null];
      m.gold[side] -= CONFIG.moveCost;
      m.moved[side] = sq.id;
      sq.from = { col: sq.col, row: sq.row, ...(isRider(sq) ? { in: sq.in } : {}) };
      sq.movedRound = m.round;
    }
    sq.col = col; sq.row = row;
    if (into) sq.in = into.id; else delete sq.in;
    syncRiders(m, side);
    if (sq.from && sq.movedRound === m.round && sq.from.col === col && sq.from.row === row && sq.from.in === sq.in) undoMove(m, side);
    return true;
  }
  // put this round's moved squad back on its old tile and refund the move
  function undoMove(m, side) {
    const id = movedId(m, side);
    const sq = id != null && m.armies[side].find(s => s.id === id);
    if (!sq || !sq.from) return false;
    const back = sq.from.in != null ? m.armies[side].find(s => s.id === sq.from.in) : null;
    if (sq.from.in != null ? !(back && back.col === sq.from.col && back.row === sq.from.row && (sq.in === back.id || !riderOf(m, side, back)))
      : (sq.col !== sq.from.col || sq.row !== sq.from.row) && occupied(m, side, sq.from.col, sq.from.row)) return false;
    sq.col = sq.from.col; sq.row = sq.from.row;
    if (back) sq.in = back.id; else delete sq.in;
    delete sq.from; delete sq.movedRound;
    syncRiders(m, side);
    m.moved[side] = null;
    m.gold[side] += CONFIG.moveCost;
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
  // a match without a tower (saved before towers were fixed) gets the fixed one
  function ensureTower(m, side) {
    if (!m.towers) m.towers = [null, null];
    if (m.towers[side]) return;
    m.towers[side] = towerSpot(m, side);
  }

  function place(m, side, unitIdx, col, row) {
    if (!canPlaceAt(m, side, col, row, unitIdx)) return null;
    if (needsTower(m, side)) return null; // the tower goes down first
    if (!isUnlocked(m, side, unitIdx)) return null;
    const into = boardable(m, side, col, row, unitIdx); // a carrier with room: the new squad rides inside
    if (occupied(m, side, col, row) && !into) return null;
    const ride = into ? { in: into.id } : {};
    if (freeLeft(m, side).includes(unitIdx)) { // a package squad: no gold, no deployment
      const sq = { id: m.nextId[side]++, unit: unitIdx, col, row, round: m.round, xp: 0, level: 0, cost: 0, free: true, ...ride };
      m.armies[side].push(sq);
      return sq;
    }
    const cost = unitCostOf(m.units[unitIdx]);
    if (m.gold[side] < cost) return null;
    if (deploysLeft(m, side) <= 0) return null;
    const sq = { id: m.nextId[side]++, unit: unitIdx, col, row, round: m.round, xp: 0, level: 0, cost, ...ride };
    m.armies[side].push(sq);
    m.gold[side] -= cost;
    return sq;
  }

  // Only squads bought this round can be taken back (by tile: the squad standing there, not a rider inside it).
  // A carrier taken back leaves its rider standing on the tile.
  function unplace(m, side, col, row) {
    const sq = squadAt(m, side, col, row);
    return !!sq && unplaceSquad(m, side, sq.id);
  }
  function unplaceSquad(m, side, id) {
    const i = m.armies[side].findIndex(s => s.id === id && s.round === m.round);
    if (i < 0) return false;
    const [sq] = m.armies[side].splice(i, 1);
    m.gold[side] += sq.cost;
    syncRiders(m, side);
    return true;
  }

  function bodiesFor(m, side) {
    const out = [];
    let idx = 0;
    for (const sq of m.armies[side]) {
      const w = tileToWorld(sq.col, sq.row);
      const ch = charOf(m, side), forward = isFlank(side, sq.col, sq.row) || inNoMans(sq.row);
      let u = unitFor(m, side, sq.unit);
      const mp = mapOf(m);
      if (mp && mp.stealthDmg && u.stealth) u = { ...u, hit: u.hit * (1 + mp.stealthDmg / 100) }; // the map favours stealth units
      const purple = (shroomAt(m, sq.col, sq.row) || {}).type === 'purple'; // a purple mushroom tile: half a Zoe buff
      if (purple) u = { ...u, hit: u.hit * (1 + SHROOM.purpleDmg / 100), hp: u.hp * (1 + SHROOM.purpleHp / 100), aps: u.aps * (1 + SHROOM.purpleAps / 100) };
      if (ch === 'wilhelm' && forward) u = { ...u, bonusArmor: (u.bonusArmor || 0) + CHAR.wilhelmArmor };
      // Zoe: a squad that starts the fight on a buff tile keeps the bonus for the whole fight
      const zoe = onBuffTile(m, side, sq.col, sq.row);
      if (zoe) u = { ...u, hit: u.hit * (1 + CHAR.zoeDmg / 100), hp: u.hp * (1 + CHAR.zoeHp / 100), aps: u.aps * (1 + CHAR.zoeAps / 100) };
      const b = E.buildSquad(u, side, w.x, w.y, sq.id, TILE, idx, sq.level);
      if (zoe) for (const x of b) x.zoe = true; // for the rising-stars effect
      if (purple) for (const x of b) x.shroom = true; // for the drifting spores effect
      if (isFlank(side, sq.col, sq.row) && (sq.round === m.round || sq.movedRound === m.round)) for (const x of b) x.delay = FLANK.delay * (ch === 'wilhelm' ? CHAR.wilhelmDelay : 1); // only in its first fight
      idx += b.length;
      out.push(...b);
    }
    // riders sit inside their carrier's first body until it dies
    for (const sq of m.armies[side]) {
      if (!isRider(sq)) continue;
      const c = out.find(x => x.squad === sq.in);
      for (const x of out) if (x.squad === sq.id) { if (c) { x.boarded = true; x.alive = false; x.carrier = c; x.x = c.x; x.y = c.y; x.delay = 0; } }
    }
    const t = m.towers && m.towers[side];
    if (t) {
      const w = tileToWorld(t.col, t.row), tb = E.buildSquad(TOWER, side, w.x, w.y, -2, TILE, idx);
      if (altarBought(m, side, 'walls')) for (const x of tb) x.walls = [ICE.wallHits, ICE.wallHits, ICE.wallHits, ICE.wallHits];
      idx += tb.length; out.push(...tb);
    }
    // Snowgres stand on their own tiles in no man's land; squad ids -10, -11, ... (not squads in the army)
    snowgres(m, side).forEach((sg, k) => {
      const w = tileToWorld(sg.col, sg.row), b = E.buildSquad(snowgreUnit(m, sg.strength), side, w.x, w.y, -10 - k, TILE, idx);
      idx += b.length; out.push(...b);
    });
    return out;
  }

  // ---------- Zoe's buff tiles ----------
  // Rolled at the start of every round (and when Zoe is picked): random free-standing tiles in her zone,
  // never the tower's tile. Seeded from the match, so both phones get the same tiles.
  function rollBuffTiles(m, side) {
    if (!m.buff) m.buff = [[], []];
    m.buff[side] = [];
    if (charOf(m, side) !== 'zoe') return;
    const r = rng(m.seed + m.round * 6151 + side * 3571 + 99);
    const spots = [];
    for (const row of zoneRows(side)) for (let col = 0; col < COLS; col++) if (!reserved(side, col, row) && !towerAt(m, side, col, row) && !shroomAt(m, col, row)) spots.push({ col, row });
    for (let k = 0; k < CHAR.zoeTiles && spots.length; k++) m.buff[side].push(spots.splice(Math.floor(r() * spots.length), 1)[0]);
  }
  const onBuffTile = (m, side, col, row) => charOf(m, side) === 'zoe' && !!(m.buff && m.buff[side] || []).some(t => t.col === col && t.row === row);

  function startBattle(m) {
    ensureTower(m, 0); ensureTower(m, 1);
    ensurePack(m, 0); ensurePack(m, 1);
    const mp = mapOf(m), elf = elfSpot(m);
    const g = mp && mp.healMul ? { ...SETTINGS, healMul: mp.healMul } : SETTINGS;
    const T2 = TILE / 2, tiles = [];
    if (mp && mp.shrooms) for (const t of m.map.tiles || []) {
      if (t.type === 'purple' || shroomRemoval(m, t.col, t.row)) continue; // purple only counts for squads that start there (see bodiesFor)
      const w = tileToWorld(t.col, t.row);
      tiles.push(t.type === 'yellow' ? { type: 'speed', speed: SHROOM.speed, x0: w.x - T2, x1: w.x + T2, y0: w.y - T2, y1: w.y + T2 }
        : { type: 'toxic', poisonPct: SHROOM.poisonPct, poisonDur: SHROOM.poisonDur, slowMove: SHROOM.slowMove, slowAtk: SHROOM.slowAtk, slowDur: SHROOM.slowDur, x0: w.x - T2, x1: w.x + T2, y0: w.y - T2, y1: w.y + T2 });
    }
    for (const h of hailTiles(m)) { const w = tileToWorld(h.col, h.row); tiles.push({ type: 'hail', dps: ICE.hailDps, x0: w.x - T2, x1: w.x + T2, y0: w.y - T2, y1: w.y + T2 }); }
    return E.createBattle(bodiesFor(m, 0), bodiesFor(m, 1), g, { record: true, tiles, neutrals: elf ? [{ u: E.withTraits(ELF_TOWER), x: elf.x, y: elf.y, friends: [bribed(m, 0), bribed(m, 1)] }] : [] });
  }

  // Damage a side deals = points of its squads, scaled by how much of each squad is still alive
  function survivorDamage(m, res, side) {
    let sum = 0;
    for (const k in res.squads) {
      const s = res.squads[k];
      if (s.side !== side || s.alive <= 0) continue;
      if (s.squad <= -10) { const sg = snowgres(m, side)[-10 - s.squad]; if (sg) sum += SQUAD_POINTS * GOLEM.cost * sg.strength * s.alive / s.total; continue; } // a Snowgre
      if (s.squad < 0) continue; // spawned bodies don't count
      const sq = m.armies[side].find(q => q.id === s.squad);
      const value = sq ? (m.units[sq.unit].cost || 1) : 1; // pricier squads hit harder, like their price
      sum += SQUAD_POINTS * value * s.alive / s.total;
    }
    return sum > 0 ? Math.min(MAX_ROUND_DMG, Math.max(1, Math.round(sum))) : 0; // at most MAX_ROUND_DMG per round
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
    m.moved = [null, null];
    for (const a of m.armies) for (const sq of a) { delete sq.from; delete sq.movedRound; }
    rollBuffTiles(m, 0); rollBuffTiles(m, 1);
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
    // the elf tower: from round 2, sometimes bribe it while a squad is still affordable after
    if (m.round >= 2 && canBribe(m, side) && m.gold[side] - reserve - BRIBE_COST >= minCost && r() < 0.5) bribe(m, side);
    // the altar of ice: walls now and then, push the storm away when it sits on its side, a Snowgre when gold allows
    if (altarRound(m)) {
      const spare = (c) => m.gold[side] - reserve - c >= minCost;
      if (spare(altarCost(m, side, 'walls')) && r() < 0.4) buyAltar(m, side, 'walls');
      const off = stormShift(m, m.round + 1);
      if ((side === 0 ? off <= 0 : off >= 0) && spare(altarCost(m, side, 'push')) && r() < 0.4) buyAltar(m, side, 'push');
      if (m.gold[side] - reserve - altarCost(m, side, 'snowgre') >= minCost * 2 && r() < 0.4) buyAltar(m, side, 'snowgre');
    }
    // mushroom tiles: sometimes clear a green one out of its own zone
    for (const row of zoneRows(side)) for (let col = 0; col < COLS; col++) {
      const sh = shroomAt(m, col, row);
      if (sh && sh.type === 'green' && m.gold[side] - reserve - SHROOM_REMOVE >= minCost && r() < 0.4) removeShroom(m, side, col, row);
    }
    // skills: for unit types it has 2 or more squads of, sometimes buy a skill if a squad is still affordable after
    if (AI.skills) {
      const types = Object.keys(own).map(Number).filter(ui => own[ui] >= 2).sort((a, b) => own[b] - own[a]);
      for (const ui of types) for (const k of E.SLOTS) {
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
        const extra = isUnlocked(m, side, i) ? 0 : unlockCost(m, i, side); // a locked unit costs its unlock on top
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
        const sh = (shroomAt(m, col, row) || {}).type;
        const c = Math.abs(col - target) + rowCost + r() * 0.8 + (sh === 'purple' ? -1.5 : sh === 'green' ? 4 : 0);
        if (c < bc) { bc = c; best = { col, row }; }
      }
    }
    return best;
  }

  return {
    MAX_ROUND_DMG, seenAt, movedId, canMove, moveSquad, undoMove,
    COLS, ROWS, TILE, ZONE, START_HP, START_GOLD, INCOME, incomeFor, LOSER_BONUS, SQUAD_COST, SQUAD_POINTS, SETTINGS, XP_STEPS, xpNeeded, unitCostOf,
    levelCost, isReady, levelUp, undoLevel, aiLevel, AI, CONFIG,
    deploysAllowed, deploysLeft, deployedThisRound, buyDeploy, refundDeploy,
    PACKAGE, allPackages, packOf, needsPack, freeLeft, choosePack, ensurePack,
    unlockCost, isUnlocked, unlockVisible, unlock, undoUnlock,
    skillDef, skillCost, isInnate, hasSkill, skillVisible, unitFor, canBuySkill, buySkill, undoSkill, sellValue, sell,
    isRider, hiddenFromFoe, isCarrier, riderOf, carrierOf, squadAt, boardable, unplaceSquad,
    TOWER, TOWER_MID, towerColOk, towerAt, needsTower, placeTower, ensureTower,
    FLANK, flankRows, flankOpen, isFlank, reserved, canPlaceAt, enemyHolds, inNoMans, hasSkillType,
    ICE, ALTAR, GOLEM, isIce, hailRound, altarRound, stormShift, stormRows, hailTiles, altarCost, altarBought, addAltar, buyAltar, undoAltar, snowgres, snowgreUnit,
    MAPS, ELF_TOWER, SHROOM, SHROOM_SPLIT, shroomAt, shroomTileAt, shroomRemoval, SHROOM_REMOVE, removeShroom, undoRemoveShroom, mapOf, elfSpot, rollMap, BRIBE_COST, bribed, bribeVisible, canBribe, bribe, undoBribe,
    CHARACTERS, CHAR, charOf, charInfo, isTier1, rollBuffTiles, onBuffTile, TOWER_SPOT, towerSpot,
    zoneRows, inZone, tileToWorld, createMatch, place, unplace, bodiesFor, startBattle, resolve, aiDeploy, occupied,
  };
})();
if (typeof module !== 'undefined') module.exports = Game;
