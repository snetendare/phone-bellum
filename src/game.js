// ===== Match rules and AI (shared by headless tests and the page) =====
const Game = (() => {
  const E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');

  const COLS = 12, ROWS = 16, TILE = 6, ZONE = 6; // each side builds in ZONE rows; the rows between are no man's land
  const START_HP = 60, MAX_ROUND_DMG = 20, START_GOLD = 250, INCOME = 250, LOSER_BONUS = 50;
  const SQUAD_COST = 100, SQUAD_POINTS = 2;
  const SETTINGS = { dt: 0.05, timeCap: 60, spacing: 3.5, minDmgPct: 15, absorbXp: 1, armorXp: 0.5, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 }; // sight: metres beyond range a unit notices an enemy (at least minSight), drift: it leans toward one this much further out. flameReach: flame cones reach 1.2x the unit's range
  // XP a squad needs in total to reach level 1, 2, 3, as multiples of its own starting health.
  // XP = damage dealt + damage absorbed + bounty for killing leveled bodies.
  const XP_STEPS = [5, 12, 24];
  const xpNeeded = (unit, level) => unit.bodies * unit.hp * XP_STEPS[level];
  // deployments: how many new squads a side may place per round; extra ones can be bought for the round
  const CONFIG = { incomeStep: 100, levelCostPerTier: 50, firstRoundDeploys: 3, deploysPerRound: 2, extraDeployCost: 50, maxExtraDeploys: 1, deployCap: true, moveCost: 50 }; // maxExtraDeploys: per round
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
  // Tower types. Until TOWER_PICK_ROUND every player has the Outpost, a weaker keep (about 60%). At the start of
  // that round, before the deploy countdown runs, each player picks one of the offered types (towerChoices); the pick
  // can't be changed and stays for the rest of the match.
  const TOWER_PICK_ROUND = 3, TOWER_OFFER = 3;
  const OUTPOST = { id: 'outpost', name: 'Outpost', text: 'A small watchtower that holds the line until round 3, when you pick your real tower.', unit: { ...TOWER, name: 'Outpost', kind: 'outpost', hp: 400, hit: 18, color: '#A88E6E' } };
  const TOWER_TYPES = [
    { id: 'keep', name: 'Keep', text: 'The standard tower: steady, light shots at short range.', unit: { ...TOWER, hp: 700 },
      skill: { name: 'Guards', text: 'Every fight, 4 guards (reskinned Wisps, without Wisp skills) stand by the keep for 5 s, shooting anything that comes close, then march on the enemy.' },
      skill2: { name: 'Brute guards', cost: 500, needs: true, text: 'Your guards are Brutes instead of Wisps: 4 of them, with every skill you have bought for Brutes. Needs Guards.' } },
    { id: 'sniper', name: 'Sniper tower', text: 'Shoots across most of the board, slowly, for double damage.', unit: { ...TOWER, name: 'Sniper Tower', kind: 'sniper', hp: 500, hit: 60, aps: 0.4, range: 32, color: '#B9C7D6' },
      skill: { name: 'Eagle eye', text: 'The sniper tower and all your Sniper squads get +3 m range and +10% attack speed.' },
      skill2: { name: 'Deploy airship', cost: 500, text: 'Every fight, an airship takes off from the tower. It can’t be shot down. It flies toward the enemy, shoots like the sniper tower (Eagle eye included) and drops a paratrooper (a guard, like the keep’s) every 5 s, up to 6 at once. Passive: your sniper tower, the airship and all your Sniper squads deal +30 damage per hit.' } },
    { id: 'bastion', name: 'Bastion', text: 'Much tougher, with a shorter, slower attack that splashes the units around its target.', unit: { ...TOWER, name: 'Bastion', kind: 'bastion', hp: 1000, aps: 0.8, range: 5, splash: 2, color: '#B79C8A' },
      skill: { name: 'Home ground', text: 'In fights, your units get +2 armor and +10% health while they stand in your own zone. They lose it in no man’s land and get it back if they return.' },
      skill2: { name: 'Moats', cost: 250, text: 'A ring of fire around the bastion: 12 damage 4 times a second to every enemy within 5 m, like a Flame Wizard’s flames.' } },
    { id: 'mage', name: 'Mage tower', text: 'A small sun-priest beam: it locks onto one enemy and hits harder and faster the longer it stays on it. Slow against swarms, but melts big units after a few seconds.', unit: { ...TOWER, name: 'Mage Tower', kind: 'mage', hit: 14, aps: 1.5, range: 12, spinUp: 50, spinHit: 50, color: '#A493DE' },
      generals: true }, // no once-per-match skill: a mage general can be called every round instead (MAGE_GENERALS)
    { id: 'bank', name: 'Bank tower', text: 'Sturdy, with an attack between the keep and the sniper tower: medium range, medium fire rate.', unit: { ...TOWER, name: 'Bank Tower', kind: 'bank', hp: 700, hit: 45, aps: 0.8, range: 18, color: '#D9B95B' },
      loan: true, // a loan can be taken every round (LOAN)
      skill2: { name: 'Major investment', cost: 500, noFree: true, text: 'Pay 500 gold now and get 1000 gold at the start of next round. Once per match.' } }, // see resolve
    { id: 'slime', name: 'Slime tower', text: 'Lobs splashing slime globs like one Slimeshots body, with 5 m more range.', unit: { ...TOWER, name: 'Slime Tower', kind: 'slime', hit: 7, aps: 0.8, range: 26, splash: 3, projSpeed: 30, spinUp: 0.1, color: '#7BD93F' },
      passive: { name: 'Slime lore', text: 'Every skill you buy for Slime Wizards or Slimeshots works on the slime tower too.' } }, // see slimeTowerUnit
  ];
  // a picked type, or the Outpost until the pick is made (a match saved without a pick past it gets the Keep)
  const towerType = (m, side) => {
    const t = m && m.towers && m.towers[side];
    if (!m || m.round < TOWER_PICK_ROUND || needsTowerPick(m, side)) return OUTPOST;
    return TOWER_TYPES.find(x => x.id === (t && t.type)) || TOWER_TYPES[0];
  };
  // the types a player is offered: all of them while there are TOWER_OFFER or fewer, else a seeded draw
  function towerChoices(m, side) {
    if (TOWER_TYPES.length <= TOWER_OFFER) return TOWER_TYPES.slice();
    const r = rng(m.seed + side * 4241 + 17), pool = TOWER_TYPES.slice(), out = [];
    while (out.length < TOWER_OFFER) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  }
  const needsTowerPick = (m, side) => !!(m && m.round === TOWER_PICK_ROUND && m.towers && m.towers[side] && !m.towers[side].type);
  // a player who didn't pick in time gets the first type on offer (the Keep)
  function settleTowerPicks(m) { for (const sd of [0, 1]) if (needsTowerPick(m, sd)) m.towers[sd].type = towerChoices(m, sd)[0].id; }
  function setTowerType(m, side, id) {
    if (!needsTowerPick(m, side) || !towerChoices(m, side).some(x => x.id === id)) return false;
    m.towers[side].type = id;
    return true;
  }
  // Each tower type has one skill, bought once per match after the pick (TOWER_SKILL gold); it stays hidden from the
  // opponent until the fight of the round it was bought in. m.towerSkill[side] = round it was bought (0 = not)
  const TOWER_SKILL = { cost: 100, guards: 4, guardHold: 5, eagleRange: 3, eagleAps: 10, homeArmor: 2, homeHp: 10 };
  const GUARD = { name: 'Wisps', cost: 1, bodies: 2, hp: 80, hit: 75, aps: 0.8, range: 19, speed: 4, splash: 0, projSpeed: 20 }; // used when the roster has no Wisps
  const towerSkillOf = (m, side) => !!(m && m.towerSkill && m.towerSkill[side] > 0);
  const towerSkillVisible = (m, side) => towerSkillOf(m, side) && m.towerSkill[side] < m.round;
  const towerPicked = (m, side) => !!(m && m.round >= TOWER_PICK_ROUND && m.towers && m.towers[side] && m.towers[side].type);
  const canBuyTowerSkill = (m, side) => towerPicked(m, side) && !!towerType(m, side).skill && !towerSkillOf(m, side) && m.gold[side] >= towerSkillCost(m, side);
  function buyTowerSkill(m, side) {
    if (!canBuyTowerSkill(m, side)) return false;
    if (!m.towerSkill) m.towerSkill = [0, 0];
    const cost = towerSkillCost(m, side);
    if (mapFreeLeft(m, side)) useMapFree(m, side, { kind: 'tskill' });
    m.gold[side] -= cost;
    m.towerSkill[side] = m.round;
    return true;
  }
  function undoTowerSkill(m, side) {
    if (!(m.towerSkill && m.towerSkill[side] === m.round)) return false;
    // a second skill that needs this one goes with it
    if (towerType(m, side).skill2 && towerType(m, side).skill2.needs && m.towerSkill2 && m.towerSkill2[side] === m.round) undoTowerSkill2(m, side);
    if (towerSkill2Of(m, side) && towerType(m, side).skill2.needs) return false;
    const cost = towerSkillCost(m, side), wasFree = isMapFree(m, side, { kind: 'tskill' });
    m.towerSkill[side] = 0;
    m.gold[side] += cost;
    if (wasFree) passMapFree(m, side);
    return true;
  }
  // Some tower types have a second skill (skill2), bought once per match for its own price, like the first.
  // m.towerSkill2[side] = round it was bought (0 = not). skill2.needs: the first skill must be bought first.
  // Blixten: the first tower or map purchase each round is free (skill2.noFree: never free)
  const towerSkillCost = (m, side) => (m.towerSkill && m.towerSkill[side] === m.round ? isMapFree(m, side, { kind: 'tskill' }) : mapFreeLeft(m, side)) ? 0 : TOWER_SKILL.cost;
  const towerSkill2Of = (m, side) => !!(m && m.towerSkill2 && m.towerSkill2[side] > 0);
  const towerSkill2Visible = (m, side) => towerSkill2Of(m, side) && m.towerSkill2[side] < m.round;
  const towerSkill2Cost = (m, side) => { const sk = towerType(m, side).skill2; if (!sk) return 0; return !sk.noFree && (m.towerSkill2 && m.towerSkill2[side] === m.round ? isMapFree(m, side, { kind: 'tskill2' }) : mapFreeLeft(m, side)) ? 0 : sk.cost; };
  const canBuyTowerSkill2 = (m, side) => { const sk = towerType(m, side).skill2; return towerPicked(m, side) && !!sk && !towerSkill2Of(m, side) && (!sk.needs || towerSkillOf(m, side)) && m.gold[side] >= towerSkill2Cost(m, side); };
  function buyTowerSkill2(m, side) {
    if (!canBuyTowerSkill2(m, side)) return false;
    if (!m.towerSkill2) m.towerSkill2 = [0, 0];
    const cost = towerSkill2Cost(m, side);
    if (!towerType(m, side).skill2.noFree && mapFreeLeft(m, side)) useMapFree(m, side, { kind: 'tskill2' });
    m.gold[side] -= cost;
    m.towerSkill2[side] = m.round;
    return true;
  }
  function undoTowerSkill2(m, side) {
    if (!(m.towerSkill2 && m.towerSkill2[side] === m.round)) return false;
    const cost = towerSkill2Cost(m, side), wasFree = isMapFree(m, side, { kind: 'tskill2' });
    m.towerSkill2[side] = 0;
    m.gold[side] += cost;
    if (wasFree) passMapFree(m, side);
    return true;
  }
  const towerSkill2On = (m, side, id) => towerSkill2Of(m, side) && towerType(m, side).id === id && (!towerType(m, side).skill2.needs || towerSkillOf(m, side));
  const MOAT = { hit: 12, aps: 4, range: 5 };
  // Deploy airship (sniper tower): squad id -4, can't be hit (Engine: aloft), stops hover m short of its target;
  // drops one paratrooper every `every` s, up to `max` alive; +sniperHit damage per hit for the tower, the airship and Snipers
  const AIRSHIP = { speed: 3, hover: 14, every: 5, max: 6, sniperHit: 30 };
  const INVEST = { gold: 1000 }; // Major investment (bank): paid back at the start of the next round
  // Mage tower: each round its owner may call one mage general, who swaps the tower's attack for that round's fight
  // only, and/or the teleport general (extra: called on top of another general, or alone).
  // m.mageGen[side] = { round, id, tp }: id = the general (or null), tp = teleport called; it counts only in the round
  // it was bought. Hidden from the opponent until the fight.
  const MAGE_GENERALS = [
    { id: 'meteor', name: 'Meteor mage general', cost: 100, text: 'The tower calls down meteors like a Meteor Caller, with its range and minimum range, but at 25% of its damage and half its fire rate.' },
    { id: 'lightning', name: 'Lightning mage general', cost: 50, text: 'Lightning at the tower’s normal range: 100 damage to the first enemy, then it jumps up to 5 times to the nearest enemy not hit yet within 6 m, for 60 each.' },
    { id: 'water', name: 'Water mage general', cost: 50, text: 'The tower stops attacking and heals instead: 100 health to your most wounded unit within 40 m, 0.8 times a second.' },
    { id: 'teleport', name: 'Teleport mage general', cost: 100, extra: true, text: 'Can be called on top of another general. The tower keeps its attack. When it falls, your army isn’t crippled: instead the tower teleports to a random tile anywhere on the board with 1 health.' },
  ];
  const MAGE = { meteorHit: 25, meteorAps: 50, boltHit: 100, boltAps: 0.8, jumps: 5, jumpHit: 60, jumpReach: 6, waterHeal: 100, waterAps: 0.8, waterRange: 40 };
  const METEOR = { hit: 114, aps: 0.3, range: 50, minRange: 12, burst: 3, splash: 6, windUp: 2, projSpeed: 22 }; // used when the roster has no Meteor Caller
  const mageGenInfo = (id) => MAGE_GENERALS.find(x => x.id === id) || null;
  const isExtraGen = (id) => !!(mageGenInfo(id) || {}).extra;
  // what the player called this round: { id, tp } or null (an old save's { id: 'teleport' } counts as tp)
  const mageCalled = (m, side) => {
    const g = m && m.mageGen && m.mageGen[side];
    if (!g || g.round !== m.round || towerType(m, side).id !== 'mage') return null;
    return isExtraGen(g.id) ? { id: null, tp: true } : { id: g.id || null, tp: !!g.tp };
  };
  const mageGenOf = (m, side) => (mageCalled(m, side) || {}).id || null; // the general called this round (not teleport)
  const mageTpOf = (m, side) => !!(mageCalled(m, side) || {}).tp;       // the teleport general called this round
  const mageGenCost = (id) => (mageGenInfo(id) || {}).cost || 0;
  const setMageGen = (m, side, id, tp) => { if (!m.mageGen) m.mageGen = [null, null]; m.mageGen[side] = id || tp ? { round: m.round, id: id || null, tp: !!tp } : null; };
  // Blixten: a general can take the round's free purchase ({ kind: 'mgen' }, or { kind: 'mtp' } for teleport); swapping generals keeps it
  const mageGenFree = (m, side) => !!mageGenOf(m, side) && isMapFree(m, side, { kind: 'mgen' });
  const mageTpFree = (m, side) => mageTpOf(m, side) && isMapFree(m, side, { kind: 'mtp' });
  // what calling id costs a player now (a free general swapped for another stays free)
  const mageGenPrice = (m, side, id) => isExtraGen(id) ? (mageTpFree(m, side) || (!mageTpOf(m, side) && mapFreeLeft(m, side)) ? 0 : mageGenCost(id))
    : mageGenFree(m, side) || (!mageGenOf(m, side) && mapFreeLeft(m, side)) ? 0 : mageGenCost(id);
  // a general already called this round is swapped out and paid back
  const canBuyMageGen = (m, side, id) => !!mageGenInfo(id) && towerPicked(m, side) && towerType(m, side).id === 'mage' && (isExtraGen(id)
    ? !mageTpOf(m, side) && m.gold[side] >= mageGenPrice(m, side, id)
    : mageGenOf(m, side) !== id && m.gold[side] + (mageGenFree(m, side) ? 0 : mageGenCost(mageGenOf(m, side))) >= mageGenPrice(m, side, id));
  function buyMageGen(m, side, id) {
    if (!canBuyMageGen(m, side, id)) return false;
    if (isExtraGen(id)) {
      const free = mapFreeLeft(m, side);
      if (free) useMapFree(m, side, { kind: 'mtp' });
      m.gold[side] -= free ? 0 : mageGenCost(id);
      setMageGen(m, side, mageGenOf(m, side), true);
      return true;
    }
    const cur = mageGenOf(m, side), free = mageGenFree(m, side) || (!cur && mapFreeLeft(m, side));
    if (cur && !mageGenFree(m, side)) m.gold[side] += mageGenCost(cur);
    if (free && !mageGenFree(m, side)) useMapFree(m, side, { kind: 'mgen' });
    m.gold[side] -= free ? 0 : mageGenCost(id);
    setMageGen(m, side, id, mageTpOf(m, side));
    return true;
  }
  // send back the general called this round (id: 'teleport' for the teleport general)
  function undoMageGen(m, side, id) {
    const tp = isExtraGen(id), cur = tp ? (mageTpOf(m, side) ? id : null) : mageGenOf(m, side);
    if (!cur) return false;
    const wasFree = tp ? mageTpFree(m, side) : mageGenFree(m, side);
    m.gold[side] += wasFree ? 0 : mageGenCost(cur);
    setMageGen(m, side, tp ? mageGenOf(m, side) : null, tp ? false : mageTpOf(m, side));
    if (wasFree) passMapFree(m, side);
    return true;
  }
  // the mage tower's unit with general id's attack (meteor, lightning or water; anything else: the tower's own)
  function generalUnit(m, base, id) {
    const plain = { ...base, spinUp: 0, spinHit: 0 };
    if (id === 'meteor') {
      const mc = (m.units || []).find(x => x && x.name === 'Meteor Caller') || METEOR;
      return { ...plain, hit: mc.hit * MAGE.meteorHit / 100, aps: mc.aps * MAGE.meteorAps / 100, range: mc.range, minRange: mc.minRange || 0, burst: mc.burst || 1, splash: mc.splash || 0, windUp: mc.windUp || 0, projSpeed: mc.projSpeed || 0, general: id };
    }
    if (id === 'lightning') return { ...plain, hit: MAGE.boltHit, aps: MAGE.boltAps, chain: { jumps: MAGE.jumps, hit: MAGE.jumpHit, reach: MAGE.jumpReach }, general: id };
    if (id === 'water') return { ...plain, hit: 0, mend: MAGE.waterHeal, aps: MAGE.waterAps, range: MAGE.waterRange, general: id };
    return base;
  }
  // the tower's unit for this round's fight, with a mage general's attack if one was called, and teleport on top
  function mageTowerUnit(m, side, base) {
    const id = mageGenOf(m, side);
    let u = generalUnit(m, base, id);
    if (mageTpOf(m, side)) { // a random tile anywhere on the board, the same on both phones
      const r = rng(m.seed + m.round * 4931 + side * 811 + 7), w = tileToWorld(Math.floor(r() * COLS), Math.floor(r() * ROWS));
      u = { ...u, teleport: { x: w.x, y: w.y }, general: id || 'teleport' };
    }
    return u;
  }
  // Bank tower: once a round, a loan of LOAN.gold right away; the next round's gold (income, loser bonus and
  // the rest) is LOAN.payback less, never below nothing. m.loan[side] = the round the last loan was taken in.
  const LOAN = { gold: 200, payback: 300 };
  const loanNow = (m, side) => !!(m && m.loan && m.loan[side] === m.round);
  const canTakeLoan = (m, side) => towerPicked(m, side) && towerType(m, side).id === 'bank' && !loanNow(m, side);
  function takeLoan(m, side) {
    if (!canTakeLoan(m, side)) return false;
    if (!m.loan) m.loan = [0, 0];
    m.loan[side] = m.round;
    m.gold[side] += LOAN.gold;
    return true;
  }
  function undoLoan(m, side) {
    if (!loanNow(m, side) || m.gold[side] < LOAN.gold) return false;
    m.loan[side] = 0;
    m.gold[side] -= LOAN.gold;
    return true;
  }
  // Slime tower: the skills bought for Slime Wizards and Slimeshots work on it too
  const SLIME_UNITS = ['Slime Wizard', 'Slimeshots'];
  // the skills bought for slime units (except unit type skipUi)
  function slimeSkillDefs(m, side, skipUi) {
    const defs = [];
    (m.units || []).forEach((u, ui) => { if (u && ui !== skipUi && SLIME_UNITS.includes(u.name)) for (const k of E.SLOTS) if (hasSkill(m, side, ui, k) && !isInnate(m, ui, k)) defs.push(skillDef(m, ui, k)); });
    return defs;
  }
  function slimeTowerUnit(m, side, base) {
    const defs = slimeSkillDefs(m, side);
    return defs.length ? E.applySkills(base, defs, m.units) : base;
  }
  // the skill in force for a fight: the tower's type and whether it was bought
  const towerSkillOn = (m, side, id) => towerSkillOf(m, side) && towerType(m, side).id === id;
  const TOWER_MID = [4, 7]; // columns the tower can't stand in
  const TOWER_SPOT = [{ col: 8, row: ROWS - 2 }, { col: 8, row: 1 }];

  // ---------- characters ----------
  // Each starting package comes with a character, who gives that player a passive ability for the whole match.
  const CHARACTERS = [
    { id: 'cage', name: 'Frickolas Cage', ability: 'All your units have 10% more health.' },
    { id: 'zoe', name: 'Zoe', ability: 'Every round, 2 random tiles in your zone become buff tiles. A squad that starts the fight on one gets +20% damage, +20% health and +10% attack speed for the whole fight.' },
    { id: 'emile', name: 'Emile', ability: 'Tier 1 units are free to unlock.' },
    { id: 'wilhelm', name: 'Wilhelm', ability: 'Your squads on flank tiles and in no man’s land get +4 armor, and flank squads start twice as fast.' },
    { id: 'blixten', name: 'Blixten', ability: 'Your first map or tower purchase each round is free: a bribe, an offering at the altar of ice, your own elf tower, removing a mushroom tile, a tower skill or a mage general (not the bank’s Major investment).' },
    { id: 'noah', name: 'Noah - The Bog', ability: 'Squads you buy in the shop start at level 2. Each costs its price plus one upgrade. All your units have 10% less health and damage.' },
    { id: 'phil', name: 'Phil', ability: 'Tier 4 units are 100 gold cheaper to unlock.' },
    { id: 'yotyot', name: 'Yot-Yot', ability: 'Every fight, Ember Imps pop up on random free tiles on your side of the board (your zone, no man’s land and, once open, your flank tiles): 1 in round 1, 2 in round 2, and so on. From round 3 they are level 2, from round 6 level 3. They get the skills you bought for Ember Imps.' },
    { id: 'mubarak', name: 'Mubarak - Slime Lord', ability: 'Your slime units (Slime Wizards and Slimeshots) get every skill you buy for any slime unit, not just their own.' },
    { id: 'felix', name: 'Felix', ability: 'From round 3 on, you get 50 more gold every round.' },
    { id: 'enzo', name: 'Enzo', ability: 'You can’t buy unit skills, but each unit type comes with one random skill, for free, picked at the start of the match and the same for all your squads of it all match (see it under the unit’s i button). All your units have 10% less health and damage.' },
    { id: 'matteo', name: 'Matteo - the Gentleman', ability: 'Give one of your squads a stack of Charisma. When a squad with Charisma kills an enemy, it gains a stack and gives one to a squad of yours without any. At 5 stacks a squad is a Gentleman: the first enemy it would kill each fight joins your side for that fight instead, at half health.' },
  ];
  const CHAR = { cageHp: 10, zoeTiles: 2, zoeDmg: 20, zoeHp: 20, zoeAps: 10, wilhelmArmor: 4, wilhelmDelay: 0.5, noahLevel: 1, noahCut: 10, enzoCut: 10, philTier: 4, philOff: 100, yotUnit: 'Ember Imps', yotLv2: 3, yotLv3: 6, felixRound: 3, felixGold: 50 };
  // ---------- Matteo's charisma ----------
  // sq.charm = Charisma stacks on a squad, kept between rounds; they grow in fights (see Engine: opts.charm).
  // Matteo gives the first stack to a squad of his choice (again whenever none of his squads has any, e.g. after
  // selling it); sq.charmGiven = the round he gave it. If he hasn't by the fight, his priciest squad gets it.
  const charmOf = (sq) => (sq && sq.charm) || 0;
  const isGentleman = (sq) => charmOf(sq) >= E.CHARM_MAX;
  const canGiveCharm = (m, side) => charOf(m, side) === 'matteo' && !m.armies[side].some(q => q.charm > 0);
  function giveCharm(m, side, sqId) {
    const sq = m.armies[side].find(q => q.id === sqId);
    if (!sq || !canGiveCharm(m, side)) return false;
    sq.charm = 1; sq.charmGiven = m.round;
    return true;
  }
  // take back the first stack, given this round (to give it to another squad)
  function undoCharm(m, side, sqId) {
    const sq = m.armies[side].find(q => q.id === sqId);
    if (!sq || sq.charmGiven !== m.round || sq.charm !== 1) return false;
    delete sq.charm; delete sq.charmGiven;
    return true;
  }
  function ensureCharm(m, side) {
    if (!canGiveCharm(m, side)) return;
    let best = null;
    for (const q of m.armies[side]) if (!best || (m.units[q.unit].cost || 0) > (m.units[best.unit].cost || 0)) best = q;
    if (best) giveCharm(m, side, best.id);
  }
  const charmMap = (m, side) => charOf(m, side) === 'matteo' ? Object.fromEntries(m.armies[side].map(q => [q.id, charmOf(q)])) : null;
  const charOf = (m, side) => (m && m.chars && m.chars[side]) || null;
  const charInfo = (id) => CHARACTERS.find(c => c.id === id) || null;
  // Blixten: the first map or tower purchase each round is free. m.mapFree[side][round] = the purchase that got it:
  // { kind: 'bribe' } (the round's first bribe), { kind: 'altar', type }, { kind: 'shroom', col, row }, { kind: 'elf' },
  // { kind: 'tskill' }, { kind: 'tskill2' } (not Major investment), { kind: 'mgen' } (a mage general) or { kind: 'mtp' } (the teleport general)
  const mapFreeOf = (m, side) => (m && m.mapFree && m.mapFree[side] && m.mapFree[side][m.round]) || null;
  const mapFreeLeft = (m, side) => side != null && charOf(m, side) === 'blixten' && !mapFreeOf(m, side);
  const isMapFree = (m, side, rec) => { const f = mapFreeOf(m, side); return !!f && f.kind === rec.kind && f.type === rec.type && f.col === rec.col && f.row === rec.row; };
  function useMapFree(m, side, rec) {
    if (!m.mapFree) m.mapFree = [{}, {}];
    m.mapFree[side][m.round] = rec;
  }
  // the free purchase was taken back: the free slot passes to another map purchase of this round, if there is one, refunding it
  function passMapFree(m, side) {
    delete m.mapFree[side][m.round];
    const alt = altarBuys(m).find(b => b.side === side && b.round === m.round);
    const rm = (m.map && m.map.removed || []).find(x => x.side === side && x.round === m.round);
    const e = elfOwnOf(m, side);
    let rec = null, back = 0;
    if (bribeNow(m, side) > 0) { rec = { kind: 'bribe' }; back = BRIBE_COST; }
    else if (alt) { rec = { kind: 'altar', type: alt.type }; back = altarBase(m, side, alt.type); }
    else if (rm) { rec = { kind: 'shroom', col: rm.col, row: rm.row }; back = SHROOM_REMOVE; }
    else if (e && e.round === m.round) { rec = { kind: 'elf' }; back = ELF_OWN.cost; }
    else if (m.towerSkill && m.towerSkill[side] === m.round) { rec = { kind: 'tskill' }; back = TOWER_SKILL.cost; }
    else if (m.towerSkill2 && m.towerSkill2[side] === m.round && !(towerType(m, side).skill2 || {}).noFree) { rec = { kind: 'tskill2' }; back = towerType(m, side).skill2.cost; }
    else if (mageGenOf(m, side)) { rec = { kind: 'mgen' }; back = mageGenCost(mageGenOf(m, side)); }
    else if (mageTpOf(m, side)) { rec = { kind: 'mtp' }; back = mageGenCost('teleport'); }
    if (rec) { useMapFree(m, side, rec); m.gold[side] += back; }
  }
  // ---------- maps ----------
  // Each match is fought on one map, picked by the host when the match is created (or at random). A map can change the
  // rules of every fight. Elf tower: a neutral tower standing on the centre line of no man's land, the same
  // distance from both zones, in a random column that stays for the whole match. It can't be attacked. It sides
  // with whoever has bribed the elves the most times (see the bribe-off below); with nobody ahead, it shoots both sides in turn.
  const MAPS = [
    { id: 'standard', name: 'Standard', short: 'No special rules.', text: 'No special rules.', plain: true }, // only when picked, never random
    { id: 'forest', name: 'Forest Clearing', short: 'Bribe the elf tower to fight for you.', text: 'Ents and Earth Wizards have 15% more health. Healing and regeneration are 1.5× as strong. A neutral elf tower in no man’s land sides with whoever has bribed the elves the most times: it heals their units and shoots the other player’s. With bribes level, it shoots both. Bribe as often as you like: 50 gold, and 50 more for each extra bribe in the same round. Totals stay secret; the flag on the tower shows who is ahead. After round 5 the elves hit and heal twice as hard. From the round after 10 bribes have been paid in all, each player who has bribed can buy one elf tower of their own for 400 gold.', boostHp: 15, boostUnits: ['Ent', 'Earth Wizard'], healMul: 1.5, elfTower: true },
    { id: 'cavern', name: 'Mushroom Cavern', short: 'Shorter range. Mushroom tiles buff, speed up or poison.', text: 'All units have 25% less range (units with 5 m range or less keep theirs). Stealth units deal 20% more damage. Glowing mushroom tiles stay on the same tiles all match, mirrored on both halves. Purple: a squad that starts the fight there gets +10% damage, +10% health and +5% attack speed. Yellow: a unit that starts on it or walks over it moves 30% faster for the rest of the fight. Green: a unit that starts on it or walks over it is poisoned and slowed. Yellow and green work once per unit, for both sides. Either player can remove a mushroom tile for 50 gold.', stealthDmg: 20, rangeCut: 25, rangeKeep: 5, shrooms: true, pointMirror: true },
    { id: 'ice', name: 'Frozen Peak', short: 'Hail from round 2. An ice altar rises on even rounds.', text: 'Every fight from round 2: a hailstorm drops 10 hail tiles in the storm band (no man’s land at first); units standing in hail take 20 damage per second. Even rounds: the altar of ice rises in the middle of the board. Tap it to buy ice walls for your tower, push the storm band toward your opponent, or summon a Snowgre.', ice: true },
  ];
  // ---------- Frozen Peak: hailstorm and the altar of ice ----------
  // The storm band is 4 rows deep: no man's land to start with. Each push moves it ICE.push rows toward the other
  // player, for the rest of the match (side 0 pushes toward row 0, side 1 toward the last row); it never leaves the board.
  const ICE = { hailTiles: 10, hailDps: 20, push: 2, wallHits: 10, costs: { walls: 50, push: 100, snowgre: 150 }, snowStep: 50, snowFirst: 0.25 };
  // what the altar sells, cheapest first
  const ALTAR = [
    { id: 'walls', name: 'Ice walls', text: `Ice walls rise around your tower for this round’s fight. Each of the 4 walls blocks the first 10 hits coming from its side.` },
    { id: 'push', name: 'Push the hailstorm', text: `Moves the storm band 2 rows toward your opponent for the rest of the match, starting with the next hailstorm. Buy it as many times as you like. Your opponent can push it back.`, repeat: true },
    { id: 'snowgre', name: 'Summon a Snowgre', text: 'A white golem made of snow joins your army for the rest of the match. It stands in your half of no man’s land at the start of every fight and doesn’t mind hail. The first is 25% as strong as an Ether Golem, and each one after is twice as strong as the last.' },
  ];
  // the Ether Golem a Snowgre is modelled on (taken from the roster when it has one)
  const GOLEM = { name: 'Ether Golem', cost: 5, bodies: 1, hp: 3450, hit: 69, aps: 0.6, range: 5, speed: 2.5, splash: 3, defense: 'armor', defVal: 6 };
  const isIce = (m) => !!(mapOf(m) && mapOf(m).ice);
  const hailRound = (m) => isIce(m) && m.round >= 2;
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
  const altarBase = (m, side, type) => type === 'snowgre' ? ICE.costs.snowgre + ICE.snowStep * altarBuys(m).filter(b => b.side === side && b.type === 'snowgre' && b.round < m.round).length : ICE.costs[type];
  const altarRepeat = (type) => !!(ALTAR.find(a => a.id === type) || {}).repeat; // the push can be bought any number of times a round
  const altarCount = (m, side, type) => altarBuys(m).filter(b => b.side === side && b.type === type && b.round === m.round).length;
  // an offering's price for a player: what they paid if they bought it this round, else (or for one more push) what it costs them now
  const altarCost = (m, side, type) => {
    const c = altarBase(m, side, type);
    if (c == null) return c;
    return (altarBought(m, side, type) && !altarRepeat(type) ? isMapFree(m, side, { kind: 'altar', type }) : mapFreeLeft(m, side)) ? 0 : c;
  };
  // what taking back this round's last one of an offering gives back (Blixten's free one gives nothing)
  const altarRefund = (m, side, type) => { const n = altarCount(m, side, type); return !n || (n === 1 && isMapFree(m, side, { kind: 'altar', type })) ? 0 : altarBase(m, side, type); };
  // whether one more push would still move the band: it stops at the edge of the opponent's zone
  const pushRoom = (m, side) => { const off = stormShift(m, m.round + 1); return side === 0 ? off < ZONE : off > -ZONE; };
  const altarBought = (m, side, type) => altarBuys(m).some(b => b.side === side && b.type === type && b.round === m.round);
  // a Snowgre's spot: a random tile in its owner's half of no man's land, picked when it is summoned
  function snowSpot(m, side, k) {
    const r = rng(m.seed + side * 7717 + k * 313 + 3);
    const rows = Array.from({ length: ROWS / 2 - ZONE }, (_, i) => side === 0 ? ROWS / 2 + i : ROWS / 2 - 1 - i);
    return { col: Math.floor(r() * COLS), row: rows[Math.floor(r() * rows.length)] };
  }
  // add a purchase without paying (paying is buyAltar's job; the host also uses this for the guest's purchases)
  function addAltar(m, side, type) {
    if (!altarRound(m) || !ALTAR.some(a => a.id === type) || (altarBought(m, side, type) && !altarRepeat(type))) return false;
    if (type === 'push' && !pushRoom(m, side)) return false;
    if (!m.altar) m.altar = [];
    const b = { side, round: m.round, type };
    if (type === 'snowgre') { const k = altarBuys(m).filter(x => x.side === side && x.type === 'snowgre').length; Object.assign(b, snowSpot(m, side, k)); }
    m.altar.push(b);
    return true;
  }
  function buyAltar(m, side, type) {
    const cost = altarCost(m, side, type);
    const free = mapFreeLeft(m, side);
    if (!(cost >= 0) || m.gold[side] < cost || !addAltar(m, side, type)) return false;
    m.gold[side] -= cost;
    if (free) useMapFree(m, side, { kind: 'altar', type });
    return true;
  }
  // take back a purchase made this round, for a full refund
  function undoAltar(m, side, type) {
    const i = altarBuys(m).map(b => b.side === side && b.type === type && b.round === m.round).lastIndexOf(true);
    if (i < 0) return false;
    const cost = altarRefund(m, side, type), wasFree = altarCount(m, side, type) === 1 && isMapFree(m, side, { kind: 'altar', type });
    m.altar.splice(i, 1);
    m.gold[side] += cost;
    if (wasFree) passMapFree(m, side);
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
  // healHit/healAps/healSplash: the small splash heal it throws on the units of the player ahead in the bribe-off
  const ELF_TOWER = { name: 'Elf Tower', cost: 0, bodies: 1, hp: 1, hit: 20, aps: 0.5, range: 12, speed: 0, splash: 0, structure: true, healHit: 15, healAps: 0.4, healSplash: 2.5 };
  // The bribe-off: either player can bribe the elves any number of times. The first bribe in a round costs BRIBE_COST
  // gold and each further one that round BRIBE_COST more (50, 100, 150, ...). In every fight the
  // elf tower sides with whoever has bribed it the most times over the whole match (not the most gold): it never shoots their units and heals them,
  // and shoots only the other player's. With totals level (none at all included) it shoots both sides in turn.
  // How often each player bribed stays hidden; the flag on the tower shows only who is ahead. This round's bribes stay
  // hidden from the opponent (and out of the flag) until the fight, and can be taken back (full refund) in the round.
  // m.bribe[side]: the round of each bribe that player paid, one entry per bribe
  const BRIBE_COST = 50;
  const bribeList = (m, side) => { const b = m && m.bribe && m.bribe[side]; return Array.isArray(b) ? b : b > 0 ? [b] : []; }; // (older saves: one round number)
  // gold a player has paid the elves; public = only bribes from earlier rounds (what the opponent may know of)
  const bribeGold = (m, side, pub) => {
    const per = {}; // bribes per round: n of them cost BRIBE_COST * (1 + 2 + ... + n)
    for (const r of bribeList(m, side)) if (!pub || r < m.round) per[r] = (per[r] || 0) + 1;
    const free = Object.keys(per).filter(r => ((m.mapFree && m.mapFree[side]) || {})[r]?.kind === 'bribe').length; // Blixten's free first bribes
    return Object.values(per).reduce((a, n) => a + BRIBE_COST * n * (n + 1) / 2, 0) - BRIBE_COST * free;
  };
  // how many times a player has bribed; pub = only bribes from earlier rounds
  const bribeCount = (m, side, pub) => bribeList(m, side).filter(r => !pub || r < m.round).length;
  const bribeNow = (m, side) => bribeList(m, side).filter(r => r === m.round).length; // bribes paid this round
  const bribeCost = (m, side) => bribeNow(m, side) === 0 && mapFreeLeft(m, side) ? 0 : BRIBE_COST * (bribeNow(m, side) + 1); // what the next bribe this round costs
  // what taking back this round's last bribe gives back: the last one bought was the dearest (Blixten's free one gives nothing)
  const bribeRefund = (m, side) => bribeNow(m, side) === 1 && isMapFree(m, side, { kind: 'bribe' }) ? 0 : BRIBE_COST * bribeNow(m, side);
  // who is ahead in the bribe-off: 0, 1, or -1 when level. pub: counting earlier rounds only (as the flag shows it while deploying)
  const bribeLeader = (m, pub) => { const a = bribeCount(m, 0, pub), b = bribeCount(m, 1, pub); return a > b ? 0 : b > a ? 1 : -1; };
  const canBribe = (m, side) => !!elfSpot(m) && m.gold[side] >= bribeCost(m, side);
  function bribe(m, side) {
    if (!canBribe(m, side)) return false;
    if (!m.bribe) m.bribe = [[], []];
    if (bribeNow(m, side) === 0 && mapFreeLeft(m, side)) useMapFree(m, side, { kind: 'bribe' });
    else m.gold[side] -= bribeCost(m, side);
    m.bribe[side] = bribeList(m, side).concat(m.round);
    return true;
  }
  function undoBribe(m, side) {
    const list = bribeList(m, side), k = list.lastIndexOf(m.round);
    if (k < 0) return false;
    const wasFree = bribeNow(m, side) === 1 && isMapFree(m, side, { kind: 'bribe' });
    m.gold[side] += bribeRefund(m, side);
    m.bribe[side] = list.filter((r, j) => j !== k);
    if (wasFree) passMapFree(m, side);
    return true;
  }
  // After round 5 the elves hit and heal ELF_POWER.mul times as hard (the map's tower and the players' own)
  const ELF_POWER = { fromRound: 6, mul: 2 };
  const elfPowered = (m) => !!m && m.round >= ELF_POWER.fromRound;
  const elfUnit = (m) => E.withTraits(elfPowered(m) ? { ...ELF_TOWER, hit: ELF_TOWER.hit * ELF_POWER.mul, healHit: ELF_TOWER.healHit * ELF_POWER.mul, strong: true } : ELF_TOWER);
  // A player's own elf tower: once ELF_OWN.unlock bribes have been paid in all (both players, earlier rounds only, so
  // this round's hidden bribes give nothing away), each player may buy one for ELF_OWN.cost gold and place it on a free
  // tile of their zone, as long as they have bribed the elves at least once themselves. It stays all match, can't be attacked, shoots only the opponent's units and heals its owner's.
  // Like a bribe, it stays hidden from the opponent until the fight and can be taken back in the round it was bought.
  const ELF_OWN = { cost: 400, unlock: 10 };
  const elfOwnOf = (m, side) => (m && m.elfOwn && m.elfOwn[side]) || null;
  const elfOwnAt = (m, side, col, row) => { const e = elfOwnOf(m, side); return !!e && e.col === col && e.row === row; };
  const elfOwnUnlocked = (m) => !!elfSpot(m) && bribeCount(m, 0, true) + bribeCount(m, 1, true) >= ELF_OWN.unlock;
  // offered to a player only if they have bribed the elves themselves (in an earlier round too)
  const elfOwnOffered = (m, side) => elfOwnUnlocked(m) && bribeCount(m, side, true) > 0;
  // what it costs a player: what they paid if they bought it this round, else what it costs them now
  const elfOwnCost = (m, side) => { const e = elfOwnOf(m, side); return (e && e.round === m.round ? isMapFree(m, side, { kind: 'elf' }) : mapFreeLeft(m, side)) ? 0 : ELF_OWN.cost; };
  const canBuyElfOwn = (m, side) => elfOwnOffered(m, side) && !elfOwnOf(m, side) && m.gold[side] >= elfOwnCost(m, side);
  const elfOwnSpotOk = (m, side, col, row) => col >= 0 && col < COLS && inZone(side, row) && !reserved(side, col, row) && !occupied(m, side, col, row);
  function buyElfOwn(m, side, col, row) {
    if (!canBuyElfOwn(m, side) || !elfOwnSpotOk(m, side, col, row)) return false;
    if (!m.elfOwn) m.elfOwn = [null, null];
    const free = mapFreeLeft(m, side);
    m.gold[side] -= elfOwnCost(m, side);
    m.elfOwn[side] = { col, row, round: m.round };
    if (free) useMapFree(m, side, { kind: 'elf' });
    return true;
  }
  function undoElfOwn(m, side) {
    const e = elfOwnOf(m, side);
    if (!e || e.round !== m.round) return false;
    const cost = elfOwnCost(m, side), wasFree = isMapFree(m, side, { kind: 'elf' });
    m.elfOwn[side] = null;
    m.gold[side] += cost;
    if (wasFree) passMapFree(m, side);
    return true;
  }
  const ELF_COLS = [2, 9]; // the elf tower's column is picked from these (never the flank edges)
  // Random never gives Standard, nor the map of the last match (lastId), so a rematch is on a new map
  function rollMap(seed, mapId, lastId) {
    const r = rng(seed + 31337);
    const pool = MAPS.filter(x => !x.plain && x.id !== lastId);
    const roll = pool[Math.floor(r() * pool.length)];
    const mp = MAPS.find(x => x.id === mapId) || roll; // the roll still happens, so the rest of the map rolls the same way
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
  // what removing a tile costs a player; with col, row of a tile they removed this round: what they paid for it
  const shroomCost = (m, side, col, row) => {
    const mine = col != null && (m.map && m.map.removed || []).some(x => x.col === col && x.row === row && x.side === side && x.round === m.round);
    return (mine ? isMapFree(m, side, { kind: 'shroom', col, row }) : mapFreeLeft(m, side)) ? 0 : SHROOM_REMOVE;
  };
  // (both players may pick the same tile in the same round, since neither can see the other's choice; both pay)
  function removeShroom(m, side, col, row) {
    if (!shroomTileAt(m, col, row) || m.gold[side] < shroomCost(m, side)) return false;
    if ((m.map.removed || []).some(x => x.col === col && x.row === row && (x.round < m.round || x.side === side))) return false;
    if (!m.map.removed) m.map.removed = [];
    const free = mapFreeLeft(m, side);
    m.gold[side] -= shroomCost(m, side);
    m.map.removed.push({ col, row, side, round: m.round });
    if (free) useMapFree(m, side, { kind: 'shroom', col, row });
    return true;
  }
  function undoRemoveShroom(m, side, col, row) {
    const x = (m.map && m.map.removed || []).find(q => q.col === col && q.row === row && q.side === side && q.round === m.round);
    if (!x) return false;
    const cost = shroomCost(m, side, col, row), wasFree = isMapFree(m, side, { kind: 'shroom', col, row });
    m.map.removed.splice(m.map.removed.indexOf(x), 1);
    m.gold[side] += cost;
    if (wasFree) passMapFree(m, side);
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
  const canPlaceAt = (m, side, col, row, ui) => col >= 0 && col < COLS && !reserved(side, col, row) && !(ui != null && isOff(m, ui)) &&
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
  const BOUNDS = { x0: -COLS * TILE / 2, x1: COLS * TILE / 2, y0: -ROWS * TILE / 2, y1: ROWS * TILE / 2 }; // the board in world metres

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // ---------- starting packages ----------
  // Before round 1 each player picks one of 3 packages (their own, not mirrored): two tier 1-2 unit types,
  // both unlocked for free, plus free squads of them worth exactly PACKAGE.value gold. Units with noPack are never in one.
  const PACKAGE = { value: 300, maxPrice: 200, options: 3 };
  // off (optional): indexes of units left out of the match
  function allPackages(units, off) {
    const out = [], ok = units.map((u, i) => unitCostOf(u) <= PACKAGE.maxPrice && !u.noPack && !(off || []).includes(i) ? i : -1).filter(i => i >= 0);
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
  function dealPackages(units, r, offChars, off) {
    const all = allPackages(units, off), pick = [];
    for (let guard = 0; pick.length < Math.min(PACKAGE.options, all.length) && guard < 200; guard++) {
      const p = all[Math.floor(r() * all.length)];
      // three different packages, and no unit type in more than one of them where possible
      if (pick.includes(p) || (guard < 120 && pick.some(q => q.units.some(u => p.units.includes(u))))) continue;
      pick.push(p);
    }
    // a random character for each package, never the same one twice among a player's options
    let ids = CHARACTERS.map(c => c.id).filter(id => !(offChars || []).includes(id));
    if (!ids.length) ids = CHARACTERS.map(c => c.id);
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

  // offChars (optional): character ids left out of the pool (at least one always stays in)
  // opts (optional): { offUnits: unit indexes left out of the match (at least two stay in), rules: roster rules for the fights (see Engine.RULES) }
  function createMatch(units, matrix, seed, mapId, lastMapId, offChars, opts) {
    const r = rng((seed >>> 0) + 777);
    let off = ((opts && opts.offUnits) || []).filter((ui, k, a) => Number.isInteger(ui) && ui >= 0 && ui < units.length && a.indexOf(ui) === k);
    if (units.length - off.length < 2) off = [];
    const rules = opts && opts.rules && typeof opts.rules === 'object' ? { ...opts.rules } : null;
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
      off, // units left out of this match: they can't be unlocked, placed or dealt in a package
      rules, // roster rules for the fights (null = all on)
      packages: [dealPackages(units, r, offChars, off), dealPackages(units, r, offChars, off)], // each player's 3 starting package options, each with a different random character
      pack: [null, null], // which one each player picked
      map: rollMap(seed >>> 0, mapId, lastMapId), // { id, elfCol }: the map this match is fought on (mapId picks it; otherwise random)
      bribe: [[], []], // the round of each bribe each player paid the elves (see the bribe-off)
      elfOwn: [null, null], // each player's own elf tower: { col, row, round bought }
      towerSkill: [0, 0], // round each player bought their tower's skill in (0 = not bought)
      towerSkill2: [0, 0], // ...and its second skill (keep, bastion, bank)
      loan: [0, 0], // the round each player last took a bank loan in (Bank tower)
      mageGen: [null, null], // the mage generals each player called this round: { round, id, tp } (Mage tower)
      mapFree: [{}, {}], // Blixten's free map purchase per round (see mapFreeOf)
    };
    m.towers = [towerSpot(m, 0), towerSpot(m, 1)];
    return m;
  }

  // a unit left out of this match (match settings on the menu)
  const isOff = (m, ui) => !!(m && Array.isArray(m.off) && m.off.includes(ui));

  // ---------- skills (bought per unit type, for all squads of that type) ----------
  // m.units[i].skillDefs = [def or null, ...], one per skill slot (Engine.SKILL_SLOTS)
  const skillDef = (m, ui, k) => (m.units[ui].skillDefs || [])[k] || null;
  const skillCost = (m, ui, k) => { const d = skillDef(m, ui, k); return d ? Math.max(0, Math.round(+d.cost || 0)) : 0; };
  // a built-in skill (skillsInnate on the unit) is always on, free and visible
  const isInnate = (m, ui, k) => !!(skillDef(m, ui, k) && Array.isArray(m.units[ui].skillsInnate) && m.units[ui].skillsInnate[k]);
  const hasSkill = (m, side, ui, k) => isInnate(m, ui, k) || !!(m.tech && m.tech[side] && m.tech[side][ui] && m.tech[side][ui][k] > 0);
  // a skill bought this round is hidden from the opponent until the fight
  const skillVisible = (m, side, ui, k) => isInnate(m, ui, k) || (hasSkill(m, side, ui, k) && m.tech[side][ui][k] < m.round);
  // Enzo: each of his unit types has one random non-built-in skill (slot index, or null if the unit has none), the same
  // for all his squads of it. Drawn from the match seed and the unit, so both phones get the same one without sending it.
  function enzoSkill(m, side, sq) {
    if (!sq || charOf(m, side) !== 'enzo' || !m.units[sq.unit]) return null;
    const ks = E.SLOTS.filter(k => skillDef(m, sq.unit, k) && !isInnate(m, sq.unit, k));
    return ks.length ? ks[Math.floor(rng(m.seed + side * 6151 + sq.unit * 7919 + 313)() * ks.length)] : null;
  }
  // sq (optional): the squad, for a skill of its own (Enzo's)
  function unitFor(m, side, ui, sq) {
    const base = m.units[ui], ek = enzoSkill(m, side, sq);
    const defs = E.SLOTS.filter(k => hasSkill(m, side, ui, k) || k === ek).map(k => skillDef(m, ui, k));
    // Mubarak: a slime unit also gets the skills bought for the other slime units
    if (charOf(m, side) === 'mubarak' && base && SLIME_UNITS.includes(base.name)) defs.push(...slimeSkillDefs(m, side, ui));
    let u = defs.length ? E.applySkills(base, defs, m.units) : base;
    if (base && SLIME_UNITS.includes(base.name)) u = { ...u, slime: true }; // poison heals slime units
    if (charOf(m, side) === 'noah' || charOf(m, side) === 'enzo') { // Noah and Enzo: 10% less health and damage, spawned ones too
      const k = 1 - (charOf(m, side) === 'noah' ? CHAR.noahCut : CHAR.enzoCut) / 100;
      u = { ...u, hp: u.hp * k, hit: u.hit * k };
      if (u.spawn) u.spawn = { ...u.spawn, unit: { ...u.spawn.unit, hp: u.spawn.unit.hp * k, hit: u.spawn.unit.hit * k } };
    }
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
  // tiers by squad price: the cheapest price in the roster is tier 1, the next one tier 2, and so on
  const tierOf = (units, ui) => [...new Set(units.map(unitCostOf))].sort((a, b) => a - b).indexOf(unitCostOf(units[ui])) + 1;
  // side (optional): that player's price, so Emile's tier 1 unlocks are free and Phil's tier 4 ones cheaper
  const unlockCost = (m, ui, side) => {
    const base = Math.max(0, Math.round(+m.units[ui].unlock || 0)), ch = side != null ? charOf(m, side) : null;
    if (ch === 'emile' && isTier1(m, ui)) return 0;
    if (ch === 'phil' && tierOf(m.units, ui) === CHAR.philTier) return Math.max(0, base - CHAR.philOff);
    return base;
  };
  const isUnlocked = (m, side, ui) => unlockCost(m, ui, side) === 0 || !!(m.unlocks && m.unlocks[side] && m.unlocks[side][ui] > 0);
  // an unlock bought this round is hidden from the opponent until the fight
  const unlockVisible = (m, side, ui) => unlockCost(m, ui, side) === 0 || (isUnlocked(m, side, ui) && m.unlocks[side][ui] < m.round);
  function unlock(m, side, ui) {
    if (ui < 0 || ui >= m.units.length || isOff(m, ui) || isUnlocked(m, side, ui)) return false;
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
    if (charOf(m, side) === 'enzo') return false; // Enzo's squads come with their skill instead
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
  // Squads from earlier rounds sell for half their worth: the unit's price plus its upgrades (squads placed this round are taken back in full)
  const sellValue = (m, sq) => Math.floor((unitCostOf(m.units[sq.unit]) + (sq.level || 0) * levelCost(m.units[sq.unit])) / 2 / 5) * 5;
  function sell(m, side, sqId) {
    const i = m.armies[side].findIndex(s => s.id === sqId && s.round < m.round);
    if (i < 0) return 0;
    const [sq] = m.armies[side].splice(i, 1);
    syncRiders(m, side); // a sold carrier's rider steps out onto the tile
    const v = sellValue(m, sq);
    m.gold[side] += v;
    return v;
  }

  const canBuyDeploy = (m, side) => CONFIG.deployCap && m.extraDeploys[side] < CONFIG.maxExtraDeploys && m.gold[side] >= CONFIG.extraDeployCost;
  function buyDeploy(m, side) {
    if (!canBuyDeploy(m, side)) return false;
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
  const occupied = (m, side, col, row) => towerAt(m, side, col, row) || elfOwnAt(m, side, col, row) || m.armies[side].some(s => s.col === col && s.row === row);
  const needsTower = (m, side) => !!(m.towers && !m.towers[side]);
  // the tower can be placed (or moved) during round 1 only
  function placeTower(m, side, col, row) {
    if (!m.towers) m.towers = [null, null];
    if (m.round !== 1 || !inZone(side, row) || !towerColOk(col) || reserved(side, col, row)) return false;
    if (m.armies[side].some(s => s.col === col && s.row === row)) return false;
    m.towers[side] = { col, row, ...(m.towers[side] && m.towers[side].type ? { type: m.towers[side].type } : {}) };
    return true;
  }
  // a match without a tower (saved before towers were fixed) gets the fixed one
  function ensureTower(m, side) {
    if (!m.towers) m.towers = [null, null];
    if (m.towers[side]) return;
    m.towers[side] = towerSpot(m, side);
  }

  // what a squad costs a player in the shop, and the level it starts at: Noah's start CHAR.noahLevel levels up, paying for them
  const startLevel = (m, side) => charOf(m, side) === 'noah' ? CHAR.noahLevel : 0;
  const shopCost = (m, side, ui) => unitCostOf(m.units[ui]) + startLevel(m, side) * levelCost(m.units[ui]);
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
    const cost = shopCost(m, side, unitIdx), level = startLevel(m, side);
    if (m.gold[side] < cost) return null;
    if (deploysLeft(m, side) <= 0) return null;
    // a squad that starts leveled up starts with the XP of that level, so the next one is as far off as usual
    const sq = { id: m.nextId[side]++, unit: unitIdx, col, row, round: m.round, xp: level ? xpNeeded(m.units[unitIdx], level - 1) : 0, level, cost, ...ride };
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
    // tower skills in force: Eagle eye (sniper tower), Home ground (bastion: a band across this side's zone)
    const eagle = towerSkillOn(m, side, 'sniper'), airship = towerSkill2On(m, side, 'sniper');
    const home = towerSkillOn(m, side, 'bastion') ? (() => {
      const ys = zoneRows(side).map(r => tileToWorld(0, r).y);
      return { y0: Math.min(...ys) - TILE / 2, y1: Math.max(...ys) + TILE / 2, armor: TOWER_SKILL.homeArmor, hpPct: TOWER_SKILL.homeHp, on: false };
    })() : null;
    for (const sq of m.armies[side]) {
      const w = tileToWorld(sq.col, sq.row);
      const ch = charOf(m, side), forward = isFlank(side, sq.col, sq.row) || inNoMans(sq.row);
      let u = unitFor(m, side, sq.unit, sq);
      const mp = mapOf(m);
      if (mp && mp.stealthDmg && u.stealth) u = { ...u, hit: u.hit * (1 + mp.stealthDmg / 100) }; // the map favours stealth units
      if (mp && mp.boostHp && (mp.boostUnits || []).includes(m.units[sq.unit].name)) u = { ...u, hp: u.hp * (1 + mp.boostHp / 100) }; // ...or these units by name
      const purple = (shroomAt(m, sq.col, sq.row) || {}).type === 'purple'; // a purple mushroom tile: half a Zoe buff
      if (purple) u = { ...u, hit: u.hit * (1 + SHROOM.purpleDmg / 100), hp: u.hp * (1 + SHROOM.purpleHp / 100), aps: u.aps * (1 + SHROOM.purpleAps / 100) };
      if (ch === 'wilhelm' && forward) u = { ...u, bonusArmor: (u.bonusArmor || 0) + CHAR.wilhelmArmor };
      // Zoe: a squad that starts the fight on a buff tile keeps the bonus for the whole fight
      const zoe = onBuffTile(m, side, sq.col, sq.row);
      if (zoe) u = { ...u, hit: u.hit * (1 + CHAR.zoeDmg / 100), hp: u.hp * (1 + CHAR.zoeHp / 100), aps: u.aps * (1 + CHAR.zoeAps / 100) };
      if (eagle && u.name === 'Sniper') u = { ...u, range: u.range + TOWER_SKILL.eagleRange, aps: u.aps * (1 + TOWER_SKILL.eagleAps / 100) };
      if (mp && mp.rangeCut && u.range > mp.rangeKeep) u = { ...u, range: Math.max(mp.rangeKeep, u.range * (1 - mp.rangeCut / 100)) }; // the map shortens reach (never below rangeKeep)
      const b = E.buildSquad(u, side, w.x, w.y, sq.id, TILE, idx, sq.level);
      if (airship && u.name === 'Sniper') { const su = { ...b[0].u, hit: b[0].u.hit + AIRSHIP.sniperHit }; for (const x of b) x.u = su; } // flat, after levels
      if (home) for (const x of b) x.band = { ...home };
      if (zoe) for (const x of b) x.zoe = true; // for the rising-stars effect
      if (purple) for (const x of b) x.shroom = true; // for the drifting spores effect
      if (isFlank(side, sq.col, sq.row) && (sq.round === m.round || sq.movedRound === m.round)) for (const x of b) x.delay = FLANK.delay * (ch === 'wilhelm' ? CHAR.wilhelmDelay : 1); // only in its first fight
      if (isFlank(side, sq.col, sq.row)) for (const x of b) x.march = [w.x < 0 ? 1 : -1, 0]; // a flank squad marches in toward the middle until it spots an enemy
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
      let tu = mageTowerUnit(m, side, towerType(m, side).unit);
      if (towerType(m, side).id === 'slime') tu = { ...slimeTowerUnit(m, side, tu), slime: true };
      if (towerSkill2On(m, side, 'bastion')) tu = { ...tu, moat: { ...MOAT } };
      if (eagle) tu = { ...tu, range: tu.range + TOWER_SKILL.eagleRange, aps: tu.aps * (1 + TOWER_SKILL.eagleAps / 100) };
      if (airship) tu = { ...tu, hit: tu.hit + AIRSHIP.sniperHit };
      const w = tileToWorld(t.col, t.row), tb = E.buildSquad(tu, side, w.x, w.y, -2, TILE, idx);
      if (altarBought(m, side, 'walls')) for (const x of tb) x.walls = [ICE.wallHits, ICE.wallHits, ICE.wallHits, ICE.wallHits];
      idx += tb.length; out.push(...tb);
      // Guards (keep): reskinned Wisps (base stats, no skills) a tile in front of the keep, holding there for a while
      // Brute guards (keep's second skill): Brutes with the skills bought for Brutes instead
      if (towerSkillOn(m, side, 'keep')) {
        const bi = (m.units || []).findIndex(x => x && x.name === 'Brute');
        const brutes = towerSkill2On(m, side, 'keep') && bi >= 0;
        const src = brutes ? unitFor(m, side, bi) : (m.units || []).find(x => x && x.name === 'Wisps') || GUARD;
        const { skills, skillDefs, skillsOn, skillsInnate, skillMods, ...plain } = src;
        const gu = E.withTraits({ ...plain, name: brutes ? 'Brute Guard' : 'Guard', level: 0, bodies: TOWER_SKILL.guards, ...(brutes ? {} : { shape: 'diamond' }), color: '#E2D3A6' });
        const gb = E.buildSquad(gu, side, w.x, w.y + (side === 0 ? 1 : -1) * TILE, -3, TILE, idx);
        for (const x of gb) x.holdT = TOWER_SKILL.guardHold;
        idx += gb.length; out.push(...gb);
      }
      // Deploy airship (sniper tower's second skill): flies from the tower, shoots like it, drops guards as paratroopers
      if (airship) {
        const { skills, skillDefs, skillsOn, skillsInnate, skillMods, ...plain } = (m.units || []).find(x => x && x.name === 'Wisps') || GUARD;
        const para = E.withTraits({ ...plain, name: 'Paratrooper', level: 0, bodies: 1, shape: 'diamond', color: '#E2D3A6' });
        const au = E.withTraits({ ...tu, name: 'Airship', kind: 'airship', structure: false, aloft: true, hp: 1, speed: AIRSHIP.speed, hover: AIRSHIP.hover,
          spawn: { unit: para, count: 1, every: AIRSHIP.every, max: AIRSHIP.max, waves: 0 } });
        const ab = E.buildSquad(au, side, w.x, w.y, -4, TILE, idx);
        idx += ab.length; out.push(...ab);
      }
    }
    // Snowgres stand on their own tiles in no man's land; squad ids -10, -11, ... (not squads in the army)
    snowgres(m, side).forEach((sg, k) => {
      const w = tileToWorld(sg.col, sg.row), b = E.buildSquad(snowgreUnit(m, sg.strength), side, w.x, w.y, -10 - k, TILE, idx);
      idx += b.length; out.push(...b);
    });
    // Yot-Yot's imps: single Ember Imp bodies on random free tiles, squad id YOT_SQUAD (not squads in the army)
    const yot = yotImps(m, side);
    if (yot.length) {
      const ui = m.units.findIndex(u => u && u.name === CHAR.yotUnit);
      const iu = { ...unitFor(m, side, ui), bodies: 1 };
      for (const t of yot) {
        const w = tileToWorld(t.col, t.row), b = E.buildSquad(iu, side, w.x, w.y, YOT_SQUAD, TILE, idx, yotLevel(m));
        idx += b.length; out.push(...b);
      }
    }
    return out;
  }

  // ---------- Yot-Yot's imps ----------
  // At the start of every fight, one Ember Imp per round number on random free tiles on the player's side of the
  // board: their zone, all of no man's land and (once flanks are open) their own flank tiles. Seeded from the
  // match and round, so both phones get the same tiles.
  const YOT_SQUAD = -100;
  const yotLevel = (m) => m.round >= CHAR.yotLv3 ? 2 : m.round >= CHAR.yotLv2 ? 1 : 0;
  function yotImps(m, side) {
    if (charOf(m, side) !== 'yotyot' || !m.units.some(u => u && u.name === CHAR.yotUnit)) return [];
    const taken = (col, row) => [0, 1].some(sd => occupied(m, sd, col, row)) || snowgres(m, 0).concat(snowgres(m, 1)).some(g => g.col === col && g.row === row);
    const spots = [];
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      if (reserved(side, col, row) || taken(col, row)) continue;
      if (inZone(side, row) || inNoMans(row) || (flankOpen(m) && isFlank(side, col, row))) spots.push({ col, row });
    }
    const r = rng(m.seed + m.round * 7307 + side * 2903 + 41), out = [];
    for (let k = 0; k < m.round && spots.length; k++) out.push(spots.splice(Math.floor(r() * spots.length), 1)[0]);
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
    settleTowerPicks(m);
    ensurePack(m, 0); ensurePack(m, 1);
    ensureCharm(m, 0); ensureCharm(m, 1);
    const mp = mapOf(m), elf = elfSpot(m);
    let g = { ...SETTINGS, bounds: BOUNDS, ...(mp && mp.healMul ? { healMul: mp.healMul } : {}) };
    if (m.rules) g = { ...g, rules: m.rules }; // the roster's rules (a Counter Lab roster can switch mechanics off)
    const T2 = TILE / 2, tiles = [];
    if (mp && mp.shrooms) for (const t of m.map.tiles || []) {
      if (t.type === 'purple' || shroomRemoval(m, t.col, t.row)) continue; // purple only counts for squads that start there (see bodiesFor)
      const w = tileToWorld(t.col, t.row);
      tiles.push(t.type === 'yellow' ? { type: 'speed', speed: SHROOM.speed, x0: w.x - T2, x1: w.x + T2, y0: w.y - T2, y1: w.y + T2 }
        : { type: 'toxic', poisonPct: SHROOM.poisonPct, poisonDur: SHROOM.poisonDur, slowMove: SHROOM.slowMove, slowAtk: SHROOM.slowAtk, slowDur: SHROOM.slowDur, x0: w.x - T2, x1: w.x + T2, y0: w.y - T2, y1: w.y + T2 });
    }
    for (const h of hailTiles(m)) { const w = tileToWorld(h.col, h.row); tiles.push({ type: 'hail', dps: ICE.hailDps, x0: w.x - T2, x1: w.x + T2, y0: w.y - T2, y1: w.y + T2 }); }
    const neutrals = elf ? [{ u: elfUnit(m), x: elf.x, y: elf.y, friends: [bribeLeader(m) === 0, bribeLeader(m) === 1] }] : [];
    for (const side of [0, 1]) { const e = elfOwnOf(m, side); if (e) { const w = tileToWorld(e.col, e.row); neutrals.push({ u: elfUnit(m), x: w.x, y: w.y, friends: [side === 0, side === 1], side }); } }
    return E.createBattle(bodiesFor(m, 0), bodiesFor(m, 1), g, { record: true, tiles, neutrals, charm: [charmMap(m, 0), charmMap(m, 1)] });
  }

  // Damage a side deals = points of its squads, scaled by how much of each squad is still alive
  function survivorDamage(m, res, side) {
    let sum = 0;
    for (const k in res.squads) {
      const s = res.squads[k];
      if (s.side !== side || s.alive <= 0) continue;
      if (s.squad <= -10 && s.squad > YOT_SQUAD) { const sg = snowgres(m, side)[-10 - s.squad]; if (sg) sum += SQUAD_POINTS * GOLEM.cost * sg.strength * s.alive / s.total; continue; } // a Snowgre
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
    // Matteo: the squads keep the charisma they ended the fight with; note the ones that became Gentlemen
    const gentlemen = [[], []];
    for (let side = 0; side < 2; side++) {
      const c = res.charm && res.charm[side];
      if (!c) continue;
      for (const sq of m.armies[side]) {
        const was = isGentleman(sq);
        if (c[sq.id] > 0) sq.charm = c[sq.id];
        if (!was && isGentleman(sq)) gentlemen[side].push({ id: sq.id, unit: sq.unit });
      }
    }
    // damage each side dealt in the fight, by unit type ('u' + unit index) and by what isn't a squad: 'tower' (with its
    // name, as it was in this fight), 'guards', 'airship', 'snowgre', 'yot' (Yot-Yot's imps), 'won' (bodies won over
    // by a Gentleman) and 'spawn' (anything spawned in the fight). For the damage stats dropdown.
    const dealtBy = [0, 1].map(sd => {
      const by = {};
      for (const k in res.squads) {
        const q = res.squads[k];
        if (q.side !== sd) continue;
        const sq = q.squad >= 0 && m.armies[sd].find(x => x.id === q.squad);
        const key = sq ? 'u' + sq.unit : q.squad === -2 ? 'tower' : q.squad === -3 ? 'guards' : q.squad === -4 ? 'airship' : q.squad === YOT_SQUAD ? 'yot'
          : q.squad === E.CONVERT_SQUAD ? 'won' : q.squad <= -10 && q.squad > YOT_SQUAD ? 'snowgre' : q.squad < 0 ? 'spawn' : null;
        if (!key || (!sq && !(q.dealt > 0))) continue; // squads always show; the rest only if they dealt damage
        by[key] = (by[key] || 0) + (q.dealt || 0);
      }
      return Object.keys(by).map(key => ({ key, dealt: Math.round(by[key]), ...(key === 'tower' ? { name: towerType(m, sd).name } : {}) }));
    });
    const summary = { round: m.round, winner: roundWinner, timeout: res.timeout, dmg, time: res.time, newlyReady, squads, towerFell, gentlemen, converted: res.converted || [0, 0], dealtBy };
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
    const income = incomeFor(m.round), before = m.gold.slice();
    m.gold[0] += income; m.gold[1] += income;
    summary.income = income;
    summary.felix = [0, 1].map(sd => felixGold(m, sd));
    for (const sd of [0, 1]) m.gold[sd] += summary.felix[sd];
    const loser = dmg[0] > dmg[1] ? 0 : dmg[1] > dmg[0] ? 1 : -1;
    if (loser >= 0) m.gold[loser] += LOSER_BONUS;
    summary.bonusTo = loser;
    // Major investment (bank) bought in the round just fought pays out now
    summary.invest = [0, 1].map(sd => m.towerSkill2 && m.towerSkill2[sd] === m.round - 1 && towerType(m, sd).id === 'bank' ? INVEST.gold : 0);
    for (const sd of [0, 1]) m.gold[sd] += summary.invest[sd];
    // a bank loan taken in the round just fought is paid back out of this round's gold (never below nothing)
    summary.loan = [0, 1].map(sd => {
      if (!(m.loan && m.loan[sd] === m.round - 1)) return 0;
      const cut = Math.min(LOAN.payback, m.gold[sd] - before[sd]);
      m.gold[sd] -= cut;
      return cut;
    });
    return summary;
  }

  // Felix: extra gold every round from CHAR.felixRound on (on top of the income)
  const felixGold = (m, side, round = m.round) => charOf(m, side) === 'felix' && round >= CHAR.felixRound ? CHAR.felixGold : 0;

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
    if (needsTowerPick(m, side)) { const ch = towerChoices(m, side); setTowerType(m, side, ch[Math.floor(rng(m.seed + side * 7477)() * ch.length)].id); } // own stream: the rest of the AI rolls stay as they were
    if (canBuyTowerSkill(m, side) && rng(m.seed + m.round * 331 + side * 17)() < 0.5) buyTowerSkill(m, side); // own stream, as above
    if (canBuyTowerSkill2(m, side) && m.gold[side] - towerSkill2Cost(m, side) >= SQUAD_COST && rng(m.seed + m.round * 347 + side * 19)() < 0.35) buyTowerSkill2(m, side);
    if (canTakeLoan(m, side) && m.gold[side] < SQUAD_COST * 3 && rng(m.seed + m.round * 613 + side * 37)() < 0.4) takeLoan(m, side); // short on gold: sometimes a loan
    if (towerPicked(m, side) && towerType(m, side).id === 'mage') { // a mage general most rounds, if it leaves gold for a squad
      const q = rng(m.seed + m.round * 577 + side * 29), g = MAGE_GENERALS[Math.floor(q() * MAGE_GENERALS.length)];
      if (q() < 0.6 && m.gold[side] - g.cost >= SQUAD_COST) buyMageGen(m, side, g.id);
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
    const minCost = Math.min(...m.units.map((u, i) => isOff(m, i) ? Infinity : shopCost(m, side, i)));
    // the elf tower: from round 2, sometimes bribe it while a squad is still affordable after; more often when not ahead
    if (m.round >= 2) for (let k = 0; k < 3; k++) {
      if (!canBribe(m, side) || m.gold[side] - reserve - bribeCost(m, side) < minCost || r() >= (bribeLeader(m, true) === side ? 0.2 : 0.5)) break;
      bribe(m, side);
    }
    // its own elf tower once the elves offer it: a free back-row tile, if a squad is still affordable after
    if (canBuyElfOwn(m, side) && m.gold[side] - reserve - elfOwnCost(m, side) >= minCost) {
      const spots = [];
      for (const row of zoneRows(side).slice(3)) for (let col = 1; col < COLS - 1; col++) if (elfOwnSpotOk(m, side, col, row)) spots.push({ col, row });
      if (spots.length) { const sp = spots[Math.floor(r() * spots.length)]; buyElfOwn(m, side, sp.col, sp.row); }
    }
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
      if (sh && sh.type === 'green' && m.gold[side] - reserve - shroomCost(m, side) >= minCost && r() < 0.4) removeShroom(m, side, col, row);
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
        if (isOff(m, i)) return;
        const extra = isUnlocked(m, side, i) ? 0 : unlockCost(m, i, side); // a locked unit costs its unlock on top
        if (shopCost(m, side, i) + extra > budget) return;
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
    deploysAllowed, deploysLeft, deployedThisRound, canBuyDeploy, buyDeploy, refundDeploy,
    PACKAGE, allPackages, packOf, needsPack, freeLeft, choosePack, ensurePack,
    unlockCost, tierOf, startLevel, shopCost, mapFreeOf, mapFreeLeft, isUnlocked, unlockVisible, unlock, undoUnlock,
    skillDef, skillCost, isInnate, hasSkill, skillVisible, unitFor, canBuySkill, buySkill, undoSkill, sellValue, sell,
    isRider, hiddenFromFoe, isCarrier, riderOf, carrierOf, squadAt, boardable, unplaceSquad,
    TOWER, TOWER_TYPES, OUTPOST, TOWER_PICK_ROUND, towerType, towerChoices, needsTowerPick, setTowerType, settleTowerPicks, TOWER_SKILL, towerSkillOf, towerSkillVisible, towerPicked, canBuyTowerSkill, buyTowerSkill, undoTowerSkill, towerSkillCost, towerSkill2Of, towerSkill2Visible, towerSkill2Cost, canBuyTowerSkill2, buyTowerSkill2, undoTowerSkill2, towerSkill2On, AIRSHIP, MOAT, INVEST, MAGE_GENERALS, mageGenPrice, MAGE, mageGenInfo, mageGenOf, mageTpOf, isExtraGen, mageGenCost, canBuyMageGen, buyMageGen, undoMageGen, mageTowerUnit, generalUnit, LOAN, loanNow, canTakeLoan, takeLoan, undoLoan, SLIME_UNITS, slimeTowerUnit, slimeSkillDefs, TOWER_MID, towerColOk, towerAt, needsTower, placeTower, ensureTower,
    FLANK, flankRows, flankOpen, isFlank, reserved, canPlaceAt, isOff, enemyHolds, inNoMans, hasSkillType,
    ICE, ALTAR, GOLEM, isIce, hailRound, altarRound, stormShift, stormRows, hailTiles, altarCost, altarRefund, altarCount, pushRoom, altarBought, addAltar, buyAltar, undoAltar, snowgres, snowgreUnit,
    MAPS, ELF_TOWER, SHROOM, SHROOM_SPLIT, shroomAt, shroomTileAt, shroomRemoval, SHROOM_REMOVE, shroomCost, removeShroom, undoRemoveShroom, mapOf, elfSpot, rollMap, BRIBE_COST, bribeList, bribeGold, bribeCount, bribeNow, bribeCost, bribeRefund, ELF_POWER, elfPowered, elfUnit, ELF_OWN, elfOwnCost, elfOwnOf, elfOwnAt, elfOwnUnlocked, elfOwnOffered, canBuyElfOwn, elfOwnSpotOk, buyElfOwn, undoElfOwn, bribeLeader, canBribe, bribe, undoBribe,
    CHARACTERS, CHAR, charOf, charInfo, enzoSkill, charmOf, isGentleman, canGiveCharm, giveCharm, undoCharm, ensureCharm, felixGold, isTier1, rollBuffTiles, onBuffTile, yotImps, yotLevel, TOWER_SPOT, towerSpot,
    zoneRows, inZone, tileToWorld, createMatch, place, unplace, bodiesFor, startBattle, resolve, aiDeploy, occupied,
  };
})();
if (typeof module !== 'undefined') module.exports = Game;
