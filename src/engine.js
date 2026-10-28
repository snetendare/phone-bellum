// ===== Battle engine (shared by headless tests and the page) =====
const Engine = (() => {
  const TRAIT_DEFAULTS = { burst: 1, pellets: 1, spinUp: 0, spinHit: 0, pierce: 0, projSpeed: 0, minRange: 0, charge: 1, knockback: 0, windUp: 0, flame: 0, trample: 0, chargeStun: 0, chargeCd: 0, trampleRun: 0, trampleSpeed: 0, stomp: 0, levelHp: 0, deathBlast: 0, pctHit: 0, ram: 0, noFlank: 0, carrier: 0, noPack: 0, roll: 0 };
  const BURST_GAP = 0.15;      // seconds between shots in a burst
  const SHOTGUN_COS = Math.sqrt(3) / 2; // pellets spread 30 degrees to each side of the target (cos 30)
  // Only + - * / and sqrt from here on: those give identical results in every browser,
  // so two players' phones run exactly the same battle.
  const hyp = (x, y) => Math.sqrt(x * x + y * y);
  // cosine of an angle in degrees from a Taylor series (Math.cos may differ between browsers)
  function cosDeg(deg) {
    const a = Math.max(0, Math.min(180, deg)) * 3.141592653589793 / 180;
    let term = 1, sum = 1;
    for (let k = 1; k <= 12; k++) { term = -term * a * a / ((2 * k - 1) * (2 * k)); sum += term; }
    return sum;
  }
  const SPIN_CAP = 3;          // spin-up tops out at 3x attack speed (a unit's spinCap can set its own top)
  // damage spin-up (spinHit) ramps hit size the same way, also up to SPIN_CAP
  const CHARGE_RUN = 5;        // metres a unit must run before its next attack counts as a charge
  const TRAMPLE_RUN = 8;       // after a charged hit, a trampler keeps running this far past its target
  const TRAMPLE_WIDTH = 1.5;   // bodies within this distance of a trampler's path get run over
  // chargeCd: seconds after a charge before its next attack can be a charge (0: whenever it has run CHARGE_RUN m again).
  // trampleRun: how far a trampler runs on past its target (0: TRAMPLE_RUN); trampleSpeed: its speed during that run, x its
  // own (0: 1x). stomp: radius (m) round itself that every attack hits, every enemy in it for the full hit (the War Mammoth).
  // levelHp: % of starting health each level adds (0: LEVEL_BONUS, +100%); hit still grows by LEVEL_BONUS.
  // chargeStun: after a charged hit (and the trample run that follows it) the unit is stunned this many seconds:
  // it can't move or attack
  const STEALTH_BACK = 1.5;    // a stealth unit hides again after this many seconds without attacking
  // dash (metres): once its target is this close the unit covers the rest at DASH_SPEED (a stealth unit stays hidden)
  const DASH_SPEED = 30;
  // lone (Shadow hunter): a body hunts lone enemies, bodies with no other body of their side within LONE_R metres (a
  // tile shared with nobody); with none left for lone seconds it fights as usual, until it kills a lone one again
  const LONE_R = 3;
  // noTower (Death Flurry and Shadow hunter give it): the body never picks the enemy tower (a structure that isn't a
  // lesser one: not the treasury, a watchtower, a wall or a building) while any other enemy can be picked: it goes for
  // units. With nothing else left to pick (only bodies it can't reach, like a Sniper safe in that tower or stealthed
  // units) it attacks the tower after all, so a fight never stalls on it.
  // bleedHit (the Assassin's Bloodrush): every hit it lands gives the target that many stacks of bleed (see BLEED).
  // burn (% of each hit): that share of a hit becomes burn instead of landing at once. A burning body takes, once a
  // second, BURN.share[k] of what is left to burn (half, then two thirds, then the rest: 50%, 33%, 17%); a new burn adds
  // to what is left and starts the three ticks again. Burn goes past armor and ward, like poison.
  const BURN = { every: 1, share: [1 / 2, 2 / 3, 1] };
  // roots = { min, max, dps, pull } (Grasping roots): each body grabs one enemy min..max metres away and drags it toward
  // itself at pull m/s (it can still attack, not walk), dps damage a second past armor; once it is in reach the body
  // fights it and grabs another. bull = { every, hit, push, armor, run } (Bullhead): its 1st, (every+1)th, ... attack
  // also sends it charging through its target and run metres on: hit to every enemy body on the way, each pushed push
  // metres along, and armor more while it runs. killStack = { speed, aps, max }: each kill gives the body +speed m/s and
  // +aps attacks a second for the rest of the fight (max stacks, 0 = no cap). killSpawn: each kill makes that many new
  // bodies of the killer. flare = { per, max, shot }: each second without attacking stores per % attack speed (up to
  // max %); its next attack spends it, one extra shot in quick succession per shot %. flurry = { hits, gap, leap }: an
  // attack is hits blows gap s apart; when one kills, the next leaps to the nearest enemy within leap metres. silent:
  // its first attack in a fight doesn't give it away. firstHit (%): its first attack in a fight hits that much harder.
  // bldgPct: its hits on structures deal this % of the damage. portal = { unit, secs }: at the start of a fight each
  // squad opens a portal in front of it and holds still for secs s, then its bodies still standing sacrifice themselves
  // and unit (levelled like the squad) walks out (none if the whole squad fell first).
  // windWalk = { every, step } (Wind walk): it dodges the 1st, (every+1)th, (2*every+1)th ... attack aimed at it (each
  // hit that would land on it counts, the dodged ones too; not poison, bleed or burn ticks), and dashes step metres on
  // a dodge: away from the attacker and 45° to one side, the other side each time (no chance involved).
  // bounce = { n, pct, reach }: a shot that hits one body flies on to the nearest other enemy within reach metres,
  // pct % of the hit, up to n times (each body once per shot).
  // missiles = { n, every, hit, splash, speed, range }: at the start of a fight and every `every` s after, it fires n
  // homing missiles at the nearest enemies within range metres (different ones while there are enough; none in range:
  // it fires as soon as one comes within range): hit to everything within splash of where each lands. A shot with
  // bounce bounces on from there. Their hit grows with the unit's level.
  // spinBlade: its blade swipe (the Leafblade's: flame 90, a half circle facing its target) is drawn as leaf blades.
  // mech: drawn as the Leafblade suit.
  // roar = { radius, attack, speed, max } (Berserkers): when the body starts fighting it roars once: enemies within
  // radius get attack % slower attacks and its allies there speed % faster moves, for the fight; both
  // stack from several roars up to max % per body. unstoppable: it can't be slowed or displaced (slows, roar debuffs,
  // knockback, Bullhead pushes and roots don't take).
  // A body with `inside` (Overwatch; the game sets it) sits in that structure: it can't be hit or targeted, doesn't
  // move and shoots from there, until the structure falls. When it sees no enemy (none it could pick within its
  // sight: range + sight, at least the minimum sight) for WATCH_IDLE s in a row, it leaves and fights on foot; a
  // watchtower (u.kind 'watchtower') is taken down once nobody is left in it (b.removed: gone, not destroyed).
  const WATCH_IDLE = 10;
  // Roster rules (g.rules): optional mechanics a roster can switch off. Missing or true = on.
  //   vision: units march ahead until they spot an enemy (sight). Off: every unit knows where every enemy is from the start.
  //   stealth: the Stealth skill hides units. Off: stealth units can be targeted like any other.
  //   stealthBack: a stealth unit hides again after STEALTH_BACK s without attacking. Off: it stays seen once it attacks.
  //   knockback: hits with knockback push bodies. Off: nothing is pushed.
  const RULES = [
    ['vision', 'Vision', 'Units march straight ahead until an enemy comes within sight (see Sight in Battle settings), then turn to it. Off: every unit knows where every enemy is from the start and heads straight for the nearest one.'],
    ['stealth', 'Stealth', 'Units with the Stealth skill can’t be targeted while hidden. Off: the skill does nothing and they can be targeted like any other unit.'],
    ['stealthBack', 'Stealth returns', `A stealth unit hides again after ${STEALTH_BACK} s without attacking. Off: once it has attacked it stays seen for the rest of the fight.`],
    ['knockback', 'Knockback', 'Hits from units with knockback push the bodies they hit. Off: nothing is pushed.'],
  ];
  const ruleOn = (g, k) => !(g && g.rules && g.rules[k] === false);
  // ram: the unit never attacks; it heads straight for the enemy tower (the nearest enemy once the tower is down),
  // and on reaching it deals its hit to it once and is destroyed. carrier: a squad of another unit can ride inside
  // (see createBattle: bodies with `carrier` set stay out of the fight until that body dies). noFlank: can't be
  // deployed on flank tiles (the game checks it). noPack: never offered in a starting package (the game checks it)
  const RAM_REACH = 2;         // metres from its target at which a ram hits
  // roll (seconds): the unit never stops to attack. It rolls at its target from ROLL_START m/s up to its move speed
  // over this many seconds, running over every enemy body within TRAMPLE_WIDTH of its path for its hit (each body once
  // per pass), carries on ROLL_PAST metres past its target, stops dead and rolls back at it. So how often it hits
  // comes from how fast it gets going, not from its attack speed.
  const ROLL_START = 1;
  const ROLL_PAST = 6;         // a tile
  // unfold (the Rollers' Unfold skill): once a roller has rolled through its first enemy and stopped past it, it folds
  // out for the rest of the fight (u.roll 0, u.unfolded): a walking unit that hits one enemy at a time, same stats.
  // build = { time, range, count, unit }: the unit walks at the enemy until one is within range − 1 m, stands still
  // for `time` seconds building `count` copies of `unit` (BUILD_GAP metres apart, side by side across the enemy's
  // direction), then fights on. Once per fight. Builders building within BUILD_COOP metres of each other speed each
  // other up: 1×, 1.5×, 1.75×, ... What it builds is a construct: it never moves, can't be pushed, doesn't count as
  // a unit left standing (a side whose units are gone is beaten), levels with its builder and earns its builder XP.
  const BUILD_GAP = 6;
  const BUILD_COOP = 7;
  // Buildings (the game sets these up; see Game's buildings). A body with u.idle never moves or attacks.
  //   b.site = { work, need }: seconds of building done and needed. At the start of a fight the nearest builder without
  //   a job walks to it (within SITE_REACH) and builds instead of fighting (u.buildSpeed seconds of work a second) until
  //   it is done or falls; then the builder carries on like any builder (its turret, then melee).
  //   A site nobody is assigned to builds itself at site.self seconds of work a second (0 = not at all).
  //   b.produce = { units: [unit, ...], time }: once built, it makes one body of each after time seconds, side by side a
  //   little in front of it.
  // A unit with flee (metres) keeps away from enemies: whenever one is that close it moves straight away from it (it
  // still shoots). A unit with backline picks the farthest enemy in reach instead of the nearest. A unit with lob fires
  // shells over the heads of whoever is in the way: they only land where they were aimed.
  //   What it makes earns it XP (credit). result().buildings tells the game how each building did.
  const SITE_REACH = 3.5;
  // The Mechites' Mecha Tower (the game sets these up on bodies):
  //   b.orbit = { anchor, r }: a drone circling its anchor (the tower) r metres out at its own speed. It is aloft (can't
  //   be hit) and attacks like any unit; it falls with its anchor.
  //   u.bot = 'mine' | 'repair': a little bot that never attacks.
  //     'mine': b.plant = { spots: [{ x, y }], mine: { hit, radius } }: it walks to each spot in turn and leaves a mine
  //     there. A mine goes off when an enemy body (not aloft) comes within MINE_TRIGGER metres: hit to every enemy
  //     within radius. Then the bot stands still.
  //     'repair': it walks to the nearest of its side's buildings or tower that is damaged or not built yet and works on
  //     it like one builder: a site gets a second of work a second; a damaged one regains its max health /
  //     (u.buildSecs, or REPAIR_SECS) a second.
  // u.stay: the unit never walks toward enemies (a flee unit still keeps away from them).
  const MINE_TRIGGER = 2;
  const REPAIR_SECS = 20;
  // link: the bodies of a squad share one health pool. Damage to any of them is split across all that are alive
  // (by max health), healing is shared the same way, and they all fall together when the pool runs out. Bodies with a
  // linked squad can't be won over by a Gentleman.
  // escort = { unit, pct }: at the start of a fight a construct (the healbot) stands behind each squad, follows it,
  // never attacks, and heals every body of its squad within unit.range by pct % of its max health a second.
  // chain = { jumps, hit, reach }: after each hit the attack jumps on to the nearest enemy body not hit yet within
  // reach metres of the last one, up to jumps times, dealing chain.hit each time (lightning).
  // mend: the body never attacks; each attack heals the most wounded ally in range (not structures) by this much
  // pctHit: every hit also deals this share of the target's max health (not to structures); that part ignores armor (ward still caps the hit)
  // Bleed (u.bleedEvery = n: every n-th hit a body lands on the same target gives it a stack of bleed; Titanium spears
  // give one too). A bleeding body loses BLEED.dmg every BLEED.pulse s for BLEED.secs s (each new stack starts that time
  // again); each stack doubles the damage, up to BLEED.max stacks, and from 4 stacks it also loses a share of its max
  // health a second (BLEED.pct[n] %: 4 stacks, 5 stacks; not structures). Bleed skips armor and ward, like poison. The stacks belong to the target, so
  // every source adds to the same ones. u.bleedLonger: its stacks last that many seconds more; u.bleedNoHeal: a body
  // bleeding from it can't heal or regenerate until the bleed runs out; u.bleedStun: a body it brings to BLEED.max
  // stacks is stunned that many seconds.
  const BLEED = { dmg: 3, pulse: 0.5, secs: 2.5, max: 5, pct: { 4: 2, 5: 5 } };
  // Poisoned bodies heal POISON_HEAL % as much (slime units drink poison and heal fully)
  const POISON_HEAL = 50;
  // waterHeal: allies inside the splash of its attacks heal for its hit; with no enemy in reach it shoots at the most
  // wounded ally in reach instead (structures aren't healed)
  // pools = { pct, speed, secs }: where its attacks land they leave a pool the size of their splash, for the rest of the
  // fight (a new one isn't made where it would overlap a pool already there). Every second enemies in it take pct % of
  // the hit (past armor) and allies in it heal that much, and allies in it move `speed` m/s faster for `secs` s.
  // flow = { aps, range, max }: each attack it makes while standing still adds a stack (up to max): +aps attacks a
  // second and +range metres each. Moving takes all the stacks away.
  // aura = { radius, hit, aps }: other units of its side within radius get +hit on every hit and +aps attacks a second
  // (the strongest aura counts, they don't add up)
  // spear = { forge, speed, hit, bleed }: apart from its own attack, it spends 1 armor to forge a spear (forge s), then
  // throws it at the nearest enemy in reach (speed m/s): hit damage to the first body it reaches and bleed stacks.
  // It forges only while it has armor left and an enemy in reach. The spear's hit grows with the unit's level.
  // stunHit: every hit stuns the target this many seconds (not structures)
  // frost = { every, pct: [..], keep, stun } (the Frost Wizard): its hits put Frost on the target. The first hit gives a
  // stack; while the target keeps being hit with frost (a hit at least every FROST_ON s) it gets another every `every` s,
  // up to pct.length stacks: pct[n - 1] % slower moves and attacks at n stacks. With no frost hit for `keep` s the stacks
  // melt. The stacks are the target's own, so every Frost source adds to the same ones (two beams don't stack faster).
  // stun (Deepfreeze): the stack after the last freezes it solid for that many seconds instead (not structures) and the
  // stacks start over. Units that can't be slowed keep their speed, but can still be frozen solid.
  // beamLock (Multibeam): its extra beams keep to the enemies they are on while those stay in reach.
  // healthiest: it picks the enemy in reach with the most health (units before structures), and keeps to it.
  // storm = { radius }: a snow storm around it: every 1/aps s, its hit and its frost to every enemy within radius.
  const FROST_ON = 1;
  const EAT_R = 6; // metres (a tile): the Obelisk also eats enemy bodies that fall this close to it, whoever killed them
  // glut = { max, cap, hp, hit, speed, aps } (the Obelisk): each enemy body (not a structure or a construct) it kills,
  // or that falls within EAT_R of it, is eaten: a Glut stack, up to `cap` per fight and `max` in all; each stack gives +hp % health, +hit % hit, +speed m/s
  // and +aps % attack speed. b.glutN = the stacks the body starts with (kept by the game between rounds, already in
  // its stats: see glutUnit); result().squads[..].glut = the stacks the squad ate this fight.
  const BLAST_RADIUS = 4;      // a body with deathBlast explodes when it dies, hitting enemies within this distance
  const PIERCE_DEPTH = 10;     // metres a piercing shot travels past its target
  const PIERCE_WIDTH = 1;      // half-width of the pierce corridor (m)
  const APPROACH = 0.5;         // metres a moving unit steps inside its max range
  const PROJ_HIT_RADIUS = 1;   // a projectile hits a body within this distance of where it lands
  // A side whose tower falls is crippled for a while: it deals less damage, walks slower and takes more damage
  const TOWER_DOWN = { secs: 9, attack: 90, move: 70, taken: 50 };
  // Charisma (Matteo): opts.charm = [stacks by squad id or null, same for side 1]. A body of a squad with any
  // charisma that kills an enemy body (not a structure) gives its squad one more stack, up to CHARM_MAX, and one
  // stack to a friendly squad without any (the one with a body nearest the killer). A squad at CHARM_MAX is a
  // Gentleman: the first enemy body it would kill in a fight switches sides instead, at CONVERT_HP % of its max health.
  // A squad gains at most one stack per fight (a stack given to it counts) and gives away at most one.
  const CHARM_MAX = 5;
  const CONVERT_HP = 50;
  const CONVERT_SQUAD = -200;  // squad id of bodies that switched sides (not a squad in either army)
  const TURN = 6;              // how fast a walking body swings to a new heading (share of the turn per second)
  const SIGHT = 15;            // metres beyond its own range at which a unit notices an enemy and turns toward it
  const MIN_SIGHT = 18;        // ...but never less than this many metres from the unit (3 tiles), however short its range
  const DRIFT = 15;            // metres beyond that at which a marching unit starts to lean toward the nearest enemy
  // awareness prototype (g.aware2, the Factions devtest only; docs/AWARENESS.md): once engaged, a body picks whom to walk
  // to by distance plus crowding (melee slots per target) and stays on it unless something clearly better turns up;
  // it only looks within its sight, and new attack targets skip enemies its side is already about to kill
  const AWARE = { step: 2, full: 12, stick: 3, leash: 1.5, melee: 5, lane: 0.5 }; // metres added per melee body on the target already, when its slots are full; kept-target bonus; how far past sight it chases its target; melee reach; extra cost per metre sideways (a squad keeps to its own lane)

  const LEVEL_BONUS = 1;       // each upgrade adds +100% of starting health and hit (2x, then 3x)
  const MAX_LEVEL = 2;         // two upgrades on top of the base unit

  const withTraits = (u) => ({ ...TRAIT_DEFAULTS, defense: 'none', defVal: 0, level: 0, ...u });

  // health multiplier at level L (u.levelHp: % of starting health per level, else LEVEL_BONUS)
  const levelHpK = (u, L) => 1 + (u && u.levelHp > 0 ? u.levelHp / 100 : LEVEL_BONUS) * L;

  // Unit stats at a given level (defaults to the unit's own level field)
  function leveled(unit, level) {
    const u = withTraits(unit);
    const L = Math.max(0, Math.min(MAX_LEVEL, Math.round(level == null ? u.level : level)));
    if (!L) return { ...u, level: 0 };
    const k = 1 + LEVEL_BONUS * L;
    return { ...u, level: L, hp: u.hp * levelHpK(u, L), hit: u.hit * k, ...(u.spear ? { spear: { ...u.spear, hit: u.spear.hit * k } } : {}), ...(u.missiles ? { missiles: { ...u.missiles, hit: u.missiles.hit * k } } : {}) };
  }

  // a unit with u.glut at n stacks of Glut (from its stats at none): more health, hit, move and attack speed
  function glutUnit(u, n) {
    const g = u && u.glut;
    if (!g || !(n > 0)) return u;
    return { ...u, hp: u.hp * (1 + n * (g.hp || 0) / 100), hit: u.hit * (1 + n * (g.hit || 0) / 100), speed: u.speed + n * (g.speed || 0), aps: u.aps * (1 + n * (g.aps || 0) / 100) };
  }

  // ---------- skills ----------
  const SKILL_SLOTS = 4; // skill slots per unit (the 4th is for a Master skill or an Awaken skill)
  const SLOTS = Array.from({ length: SKILL_SLOTS }, (_, k) => k);
  // Each skill type and its settings (key, label, default, step). Shared by Counter Lab and the game.
  const SKILL_TYPES = {
    regen:   { label: 'Regeneration', params: [['pct', 'Health regained per second (% of max)', 2, 0.5], ['hp', 'Health (+%)', 20, 5]] },
    poison:  { label: 'Poison shot', params: [['pct', 'Poison damage (% of hit, in total)', 100, 10], ['duration', 'Poison lasts (s)', 4, 0.5], ['slow', 'Longer time between attacks (%)', 30, 5]] },
    stealth: { label: 'Stealth', params: [] },
    armorHp: { label: 'Armor and health', params: [['armor', 'Armor (blocked from every hit)', 8, 1], ['hp', 'Health (+%)', 25, 5]] },
    spawn:   { label: 'Spawn goblins', params: [['unit', 'Spawns (unit name)', 'Goblin Swarm', null], ['count', 'Bodies per spawn', 2, 1], ['every', 'Every (s)', 4, 0.5], ['max', 'Most alive at once', 6, 1], ['waves', 'Most waves per fight (0 = no limit)', 0, 1]] },
    rapid:   { label: 'Rapid fire', params: [['aps', 'Attack speed (+%)', 50, 5], ['range', 'Range (−%)', 30, 5]] },
    swift:   { label: 'Swift strikes', params: [['speed', 'Move speed (+%)', 30, 5], ['hit', 'Hit size (+%)', 25, 5]] },
    heavy:   { label: 'Heavy shot', params: [['slow', 'Projectile speed (−%)', 40, 5], ['instant', 'Projectile speed if the unit hits instantly (m/s)', 30, 5], ['hit', 'Hit size (+%)', 40, 5]] },
    healer:  { label: 'Healing touch', params: [['pct', 'Heal per attack (% of hit)', 50, 5]] },
    range:   { label: 'Long reach', params: [['m', 'Range (+m)', 5, 1]] },
    shrink:  { label: 'Shortsight', params: [['m', 'Enemy range (−m)', 4, 0.5], ['duration', 'Lasts (s)', 3, 0.5]] },
    ward:    { label: 'Ward', params: [['cap', 'Most damage one hit can deal', 40, 5]] },
    slow:    { label: 'Slow', params: [['move', 'Enemy move speed (−%)', 40, 5], ['attack', 'Enemy attack speed (−%)', 20, 5], ['duration', 'Lasts (s)', 3, 0.5]] },
    forward: { label: 'Forward planting', params: [] },
    split:   { label: 'Split beam', params: [['beams', 'Targets at once', 4, 1], ['range', 'Range (−%)', 30, 5], ['hit', 'Hit per target (−%)', 0, 5]] },
    deathSpawn: { label: 'Spawn on death', params: [['unit', 'Spawns (unit name)', 'Goblin Swarm', null], ['count', 'Bodies per death', 2, 1], ['strength', 'Strength of each spawn (% health and damage; 50 = half)', 100, 10]] },
    shield:  { label: 'Shield', params: [['hits', 'Hits blocked per body', 3, 1]] },
    blast:   { label: 'Death burst', params: [['radius', 'Radius (m)', 7, 0.5], ['pct', 'Damage (% of hit)', 100, 10]] },
    explode: { label: 'Explode on death', params: [['pct', 'Damage (% of its max health)', 30, 5], ['radius', 'Radius (m)', BLAST_RADIUS, 0.5]] },
    dodge:   { label: 'Dodge', params: [['pct', 'Chance to dodge a hit (%)', 33, 1]] },
    lifesteal: { label: 'Lifesteal', params: [['pct', 'Heals itself for (% of damage dealt)', 10, 1]] },
    turret:  { label: 'Extra turret', params: [['turrets', 'Attacks at once (each with its own target and reload)', 2, 1]] },
    frenzy:  { label: 'Frenzy', params: [['pct', 'Attack speed per hit (+% of base)', 10, 1], ['cap', 'Most attacks per second', 2, 0.1]] },
    spread:  { label: 'Spread', params: [['min', 'Least distance (m)', 1, 0.5], ['max', 'Most distance (m)', 6, 0.5]] },
    mortar:  { label: 'Mortar', params: [['range', 'Range (+m)', 15, 1], ['min', 'Minimum range (m)', 5, 0.5], ['aps', 'Attack speed (+ attacks per second)', 0.1, 0.05]] },
    momentum: { label: 'Momentum', params: [['accel', 'Rolling acceleration (+%)', 100, 10]] },
    unfold:  { label: 'Unfold (rolling units walk instead)', params: [] },
    link:    { label: 'Linked health', params: [['hp', 'Health (+%)', 15, 5]] },
    healbot: { label: 'Healbot', params: [['hp', 'Healbot health', 300, 25], ['pct', 'Heals each body (% of max health per second)', 4, 0.5], ['range', 'Heal reach (m)', 8, 1], ['speed', 'Healbot move speed (m/s)', 3, 0.5]] },
    building: { label: 'Building', params: [['building', 'Building (id)', 'factory', null]] },
    builder: { label: 'Construct upgrades', params: [['extra', 'More constructs per build', 0, 1], ['faster', 'Build time (−%)', 0, 5], ['aps', 'Construct attack speed (+%)', 0, 5], ['shield', 'Construct shield (hits blocked)', 0, 1], ['armor', 'Construct armor', 0, 1]] },
    stats:   { label: 'Stat changes', params: [['hp', 'Health (+%)', 0, 5], ['hit', 'Hit size (+%)', 0, 5], ['hitAdd', 'Hit size (+)', 0, 5], ['aps', 'Attacks per second (+)', 0, 0.05], ['apsPct', 'Attack speed (+%)', 0, 5], ['range', 'Range (+m)', 0, 0.5], ['splash', 'Splash (+m)', 0, 0.1], ['armor', 'Armor (+)', 0, 1], ['burst', 'Extra shots in quick succession', 0, 1], ['speed', 'Move speed (+m/s)', 0, 0.1], ['bodies', 'Bodies per squad (+)', 0, 1]] },
    double:  { label: 'Double strike', params: [['every', 'Every this many attacks', 3, 1], ['hit', 'Hit size (+%)', 5, 1]] },
    bleedDeep: { label: 'Deep bleed', params: [['secs', 'Bleed lasts (+s)', 1, 0.5]] },
    bleedStun: { label: 'Bleed stun', params: [['secs', 'Stun (s)', 1.2, 0.1]] },
    pools:   { label: 'Pools', params: [['splash', 'Splash (+m)', 2, 0.5], ['aps', 'Attacks per second (−)', 0.2, 0.05], ['pct', 'Damage / heal per second (% of hit)', 25, 5], ['speed', 'Ally move speed (+m/s)', 0.5, 0.1], ['secs', 'Speed lasts (s)', 2, 0.5]] },
    flow:    { label: 'Flow state', params: [['aps', 'Attacks per second per stack (+)', 0.1, 0.05], ['range', 'Range per stack (+m)', 0.4, 0.1], ['max', 'Most stacks', 5, 1]] },
    aura:    { label: 'Aura', params: [['armor', 'Armor (+)', 2, 1], ['radius', 'Aura radius (m)', 8, 1], ['hit', 'Allies’ hit size (+)', 20, 5], ['aps', 'Allies’ attacks per second (+)', 0.1, 0.05]] },
    spears:  { label: 'Forged spears', params: [['forge', 'Forging time (s)', 1.5, 0.1], ['speed', 'Spear speed (m/s)', 35, 5], ['hit', 'Spear damage', 200, 10], ['bleed', 'Bleed stacks', 1, 1]] },
    slam:    { label: 'Ground slam', params: [['armor', 'Armor (+)', 8, 1], ['range', 'Range (−m)', 10, 1], ['hit', 'Hit size (becomes)', 200, 10], ['stun', 'Stun (s)', 1, 0.1], ['cone', 'Cone (degrees each side)', 30, 5]] },
    burn:    { label: 'Burn', params: [['pct', 'Share of each hit that burns instead (%)', 50, 5]] },
    roots:   { label: 'Grasping roots', params: [['min', 'Least distance (m)', 5, 0.5], ['max', 'Most distance (m)', 13, 0.5], ['dps', 'Damage per second while dragged', 10, 1], ['pull', 'Drag speed (m/s)', 1.5, 0.1]] },
    killStack: { label: 'Stacks on kills', params: [['speed', 'Move speed per kill (+m/s)', 0.4, 0.1], ['aps', 'Attacks per second per kill (+)', 0.2, 0.05], ['max', 'Most stacks (0 = no limit)', 4, 1]] },
    killSpawn: { label: 'Spawn on kills', params: [['count', 'New bodies per kill', 1, 1]] },
    bleedHit: { label: 'Bleed on every hit', params: [['n', 'Bleed stacks per hit', 2, 1]] },
    bull:    { label: 'Charge through', params: [['every', 'Every this many attacks (from the first)', 3, 1], ['hit', 'Charge damage', 100, 10], ['push', 'Knockback (m)', 6, 0.5], ['armor', 'Armor while charging (+)', 4, 1], ['run', 'Runs on past its target (m)', 6, 0.5]] },
    flare:   { label: 'Flare', params: [['per', 'Attack speed stored per second idle (%)', 10, 1], ['max', 'Most stored (%)', 100, 10], ['shot', 'Stored % per extra shot', 25, 5]] },
    portal:  { label: 'Summon portal', params: [['unit', 'Summons (unit name)', 'Brute', null], ['level', 'Its base level (0 = as bought)', 1, 1], ['speed', 'Its move speed (m/s)', 4.5, 0.1], ['cone', 'Its swipe (degrees each side)', 90, 5], ['secs', 'Portal stays (s)', 3, 0.5]] },
    overwatch: { label: 'Overwatch', params: [['hp', 'Watchtower health', 200, 25]] },
    freeMove: { label: 'Free moves', params: [] },
    silent:  { label: 'Silent first strike', params: [] },
    firstHit: { label: 'Opening strike', params: [['pct', 'First attack hit size (+%)', 25, 5]] },
    pctHit:  { label: 'Health cut', params: [['pct', 'Every hit also deals (% of target max health)', 6, 1]] },
    flurry:  { label: 'Flurry', params: [['hits', 'Blows per attack', 3, 1], ['hit', 'Damage per blow (becomes)', 200, 10], ['gap', 'Time between blows (s)', 0.5, 0.05], ['aps', 'Attacks per second (becomes)', 0.2, 0.05], ['leap', 'Leaps to a new target within (m)', 10, 1]] },
    lone:    { label: 'Hunt lone targets', params: [['secs', 'Gives up after (s) without one', 5, 0.5]] },
    windWalk: { label: 'Wind walk', params: [['every', 'Dodges every this many attacks at it (from the first)', 5, 1], ['step', 'Dashes after a dodge (m)', 4, 0.5]] },
    bounce:  { label: 'Bouncing shots', params: [['n', 'Most bounces per shot', 2, 1], ['pct', 'Damage per bounce (% of hit)', 30, 5], ['reach', 'Bounces to an enemy within (m)', 10, 1]] },
    leafblade: { label: 'Leafblade suit', params: [['hp', 'Health (+%)', 150, 10], ['armor', 'Armor (+)', 4, 1], ['hit', 'Hit size (+%)', 50, 5], ['range', 'Range (becomes, m)', 3, 0.5], ['dash', 'Dashes to enemies within (m)', 8, 1],
      ['missiles', 'Missiles per salvo', 2, 1], ['every', 'Salvo every (s)', 10, 1], ['mhit', 'Missile damage', 150, 10], ['msplash', 'Missile blast (m)', 2.5, 0.5], ['mspeed', 'Missile speed (m/s)', 25, 1], ['mrange', 'Missile range (m)', 30, 1], ['cone', 'Blade swipe (degrees each side)', 90, 5]] },
    berserk: { label: 'Berserkers', params: [['radius', 'Roar reach (m)', 8, 1], ['attack', 'Enemy attack speed (−%)', 5, 1], ['speed', 'Ally move speed (+%)', 5, 1], ['max', 'Most per body from roars (%)', 25, 5]] },
    frost:   { label: 'Frost', params: [['every', 'Seconds between stacks', 2.5, 0.5], ['p1', 'Slow at 1 stack (%)', 20, 5], ['p2', 'Slow at 2 stacks (%)', 30, 5], ['p3', 'Slow at 3 stacks (%)', 40, 5], ['keep', 'Stacks melt after (s) without frost', 2, 0.5]] },
    deepfreeze: { label: 'Deepfreeze', params: [['secs', 'Frozen solid (s)', 2, 0.5]] },
    multibeam: { label: 'Multibeam', params: [['beams', 'Beams (each on a different enemy)', 2, 1]] },
    healthiest: { label: 'Target the healthiest', params: [] },
    storm:   { label: 'Snow storm', params: [['radius', 'Storm radius (m)', 8, 1]] },
    glut:    { label: 'Glut', params: [['max', 'Most stacks', 12, 1], ['cap', 'Most stacks eaten per round', 2, 1], ['hp', 'Health per stack (+%)', 5, 1], ['hit', 'Hit per stack (+%)', 5, 1]] },
    glutCap: { label: 'Bigger appetite', params: [['add', 'More stacks eaten per round (+)', 1, 1]] },
    glutSpeed: { label: 'Glut speed', params: [['speed', 'Move speed per stack (+m/s)', 0.05, 0.01], ['aps', 'Attack speed per stack (+%)', 1, 0.5]] },
    ranged:  { label: 'Ranged attack', params: [['range', 'Range (becomes, m)', 18, 1], ['speed', 'Projectile speed (m/s)', 25, 1], ['poison', 'Poison (% of hit, in total; 0 = none)', 50, 10], ['duration', 'Poison lasts (s)', 4, 0.5]] },
  };
  const skillParam = (d, k) => {
    const v = d.params && d.params[k];
    if (v !== undefined && v !== null && v !== '') return v;
    const def = (SKILL_TYPES[d.type].params.find(p => p[0] === k) || [])[2];
    return def;
  };

  // One plain sentence describing what a skill does with its current settings. A skill can carry its own `text`, and
  // `also`: more effects (each { type, params }) that come with it, described after it
  function describeSkill(d) {
    if (!d || !SKILL_TYPES[d.type]) return '';
    if (typeof d.text === 'string' && d.text) return d.text;
    const own = describeOne(d);
    return Array.isArray(d.also) ? [own, ...d.also.map(describeSkill)].filter(Boolean).join(' ') : own;
  }
  function describeOne(d) {
    const P = (k) => skillParam(d, k);
    const n = (k) => { const v = +P(k); return isFinite(v) ? String(Math.round(v * 100) / 100) : '0'; };
    switch (d.type) {
      case 'regen': return +P('hp') ? `+${n('hp')}% health. Regains ${n('pct')}% health a second.` : `Regains ${n('pct')}% health a second.`;
      case 'poison': return `Hits poison: ${n('pct')}% of the hit over ${n('duration')} s, past armor.${+P('slow') ? ` ${n('slow')}% slower attacks.` : ''}`;
      case 'stealth': return `Hidden until it attacks. Hides again after ${STEALTH_BACK} s.`;
      case 'armorHp': return +P('hp') ? `+${n('armor')} armor, +${n('hp')}% health.` : `+${n('armor')} armor.`;
      case 'spawn': return `Spawns ${n('count')} ${String(P('unit'))} every ${n('every')} s (max ${n('max')}${+P('waves') > 0 ? `, ${n('waves')} ${+P('waves') === 1 ? 'wave' : 'waves'}` : ''}).`;
      case 'rapid': return +P('range') ? `+${n('aps')}% attack speed, −${n('range')}% range.` : `+${n('aps')}% attack speed.`;
      case 'swift': return +P('hit') ? `+${n('speed')}% move speed, +${n('hit')}% hit.` : `+${n('speed')}% move speed.`;
      case 'heavy': return `+${n('hit')}% hit, ${n('slow')}% slower shots.`;
      case 'healer': return `Each attack heals an ally for ${n('pct')}% of its hit.`;
      case 'range': return `+${n('m')} m range.`;
      case 'shrink': return `Hits cut enemy range by ${n('m')} m for ${n('duration')} s.`;
      case 'ward': return `Takes at most ${n('cap')} damage per hit.`;
      case 'slow': return `Hits slow: −${n('move')}% move, −${n('attack')}% attack speed for ${n('duration')} s.`;
      case 'forward': return 'Can deploy in no man’s land.';
      case 'split': return `Hits ${n('beams')} enemies at once${+P('hit') > 0 ? `, −${n('hit')}% hit` : ''}. −${n('range')}% range.`;
      case 'deathSpawn': return `Dying bodies become ${n('count')} ${String(P('unit'))}${+P('strength') !== 100 ? ` (${n('strength')}% strength)` : ''}.`;
      case 'blast': return `Explodes on death: ${+P('pct') === 100 ? 'its hit' : `${n('pct')}% of its hit`} within ${n('radius')} m.`;
      case 'explode': return `Explodes on death: ${n('pct')}% of its health within ${n('radius')} m.`;
      case 'dodge': return `${n('pct')}% chance to dodge hits.`;
      case 'lifesteal': return `Heals ${n('pct')}% of damage dealt.`;
      case 'turret': return `Attacks ${n('turrets')} different enemies at once.`;
      case 'frenzy': return `Each hit: +${n('pct')}% attack speed (max ${n('cap')}/s).`;
      case 'spread': return `Bodies scatter ${n('min')}–${n('max')} m at fight start.`;
      case 'mortar': return `+${n('range')} m range, +${n('aps')} attacks/s. Can’t hit within ${n('min')} m.`;
      case 'shield': return `Blocks the first ${+P('hits') === 1 ? 'hit' : `${n('hits')} hits`} each fight.`;
      case 'building': return `Place a ${String(P('building'))}. Builders build it in the fight.`;
      case 'momentum': return `Reaches full roll speed ${n('accel')}% faster.`;
      case 'unfold': return 'After its first roll, unfolds and fights in melee.';
      case 'link': return +P('hp') ? `+${n('hp')}% health. The squad shares one health pool.` : 'The squad shares one health pool.';
      case 'healbot': return `A healbot follows the squad: ${n('pct')}% health a second within ${n('range')} m.`;
      case 'builder': {
        const parts = [];
        if (+P('extra') > 0) parts.push(`+${n('extra')} ${+P('extra') === 1 ? 'construct' : 'constructs'} at once`);
        if (+P('faster') > 0) parts.push(`builds ${n('faster')}% faster`);
        const c = [+P('aps') > 0 && `+${n('aps')}% attack speed`, +P('shield') > 0 && `${n('shield')}-hit shield`, +P('armor') > 0 && `+${n('armor')} armor`].filter(Boolean);
        if (c.length) parts.push(`constructs get ${c.join(', ')}`);
        return parts.length ? parts.join(', ').replace(/^./, s => s.toUpperCase()) + '.' : 'No change.';
      }
      case 'stats': {
        const sg = (k, txt) => +P(k) ? `${+P(k) > 0 ? '+' : '−'}${String(Math.round(Math.abs(+P(k)) * 100) / 100)}${txt}` : null;
        const parts = [sg('hp', '% health'), sg('hit', '% hit'), sg('hitAdd', ' hit'), sg('aps', ' attacks/s'), sg('apsPct', '% attack speed'),
          sg('range', ' m range'), sg('splash', ' m splash'), sg('armor', ' armor'), sg('speed', ' m/s speed'), sg('bodies', +P('bodies') === 1 ? ' body' : ' bodies')].filter(Boolean);
        if (+P('burst') > 0) parts.push(+P('burst') === 1 ? 'double attacks' : `${+P('burst') + 1}× attacks`);
        return parts.length ? parts.join(', ').replace(/^./, s => s.toUpperCase()) + '.' : 'No change.';
      }
      case 'double': return `${+P('hit') ? `+${n('hit')}% hit. ` : ''}Every ${+P('every') === 2 ? '2nd' : +P('every') === 3 ? '3rd' : `${n('every')}th`} attack strikes twice.`;
      case 'bleedDeep': return `Bleed lasts ${n('secs')} s longer and stops healing.`;
      case 'bleedStun': return `${BLEED.max} bleed stacks stun for ${n('secs')} s.`;
      case 'pools': return `Attacks leave pools: they hurt enemies, heal and speed up allies. +${n('splash')} m splash, −${n('aps')} attacks/s.`;
      case 'flow': return `Standing still: each attack +${n('aps')} attacks/s, +${n('range')} m range (max ${n('max')}). Moving resets.`;
      case 'aura': return `${+P('armor') ? `+${n('armor')} armor. ` : ''}Allies within ${n('radius')} m: +${n('hit')} hit, +${n('aps')} attacks/s.`;
      case 'spears': return `Spends armor to throw spears: ${n('hit')} damage${+P('bleed') > 0 ? `, ${n('bleed')} bleed` : ''}.`;
      case 'slam': return `Slams a cone for ${n('hit')} and stuns ${n('stun')} s. +${n('armor')} armor, −${n('range')} m range.`;
      case 'burn': return `Attacks burn: ${n('pct')}% of the hit over 3 s, past armor.`;
      case 'roots': return `Roots drag an enemy ${n('min')}–${n('max')} m away to it, ${n('dps')} damage/s.`;
      case 'killStack': return `Each kill: +${n('speed')} m/s, +${n('aps')} attacks/s${+P('max') > 0 ? ` (max ${n('max')})` : ''}.`;
      case 'killSpawn': return `Each kill adds ${+P('count') === 1 ? 'a body' : `${n('count')} bodies`}.`;
      case 'bleedHit': return `Hits add ${+P('n') === 1 ? '1 bleed' : `${n('n')} bleed`}.`;
      case 'bull': return `Every ${+P('every') === 3 ? '3rd' : `${n('every')}th`} attack charges ${n('run')} m through enemies for ${n('hit')}.`;
      case 'flare': return `Idle time stores attack speed. Next attack fires it as extra shots.`;
      case 'portal': return `Sacrifices itself after ${n('secs')} s to summon a ${String(P('unit')) === 'Brute' ? 'Hellfiend' : String(P('unit'))}.`;
      case 'overwatch': return 'Can garrison a building: untouchable until it falls. Sees stealthed units in its range.';
      case 'freeMove': return 'Moves are free.';
      case 'silent': return 'Its first attack keeps it hidden.';
      case 'firstHit': return `First attack +${n('pct')}% hit.`;
      case 'pctHit': return `Hits deal +${n('pct')}% of target’s max health.`;
      case 'flurry': return `Attacks are ${n('hits')} blows. Leaps ${n('leap')} m on a kill.`;
      case 'windWalk': {
        const e = Math.max(1, Math.round(+P('every')));
        return e === 1 ? 'Dodges every attack.' : `Dodge every ${e === 2 ? '2nd' : e === 3 ? '3rd' : `${e}th`} attack.`;
      }
      case 'bounce': return `Shots bounce ${+P('n') === 1 ? 'once' : `${n('n')} times`} for ${n('pct')}%.`;
      case 'leafblade': return `Becomes a leaf-mech: blade swipes, homing missiles. +${n('hp')}% health, +${n('armor')} armor.`;
      case 'berserk': return `Can’t be slowed or pushed. Roar: enemies near it attack ${n('attack')}% slower.`;
      case 'lone': return 'Hunts lone enemies.';
      case 'frost': return `Hits stack Frost: up to ${n('p3')}% slower.`;
      case 'deepfreeze': return `4th Frost stack freezes for ${n('secs')} s.`;
      case 'multibeam': return `+${+P('beams') - 1} ${+P('beams') === 2 ? 'beam' : 'beams'} on other enemies.`;
      case 'healthiest': return 'Targets the healthiest enemy.';
      case 'storm': return `Hits and frosts all enemies within ${n('radius')} m.`;
      case 'glut': return `Eats kills: +${n('hp')}% health, +${n('hit')}% hit each (max ${n('max')}).`;
      case 'glutCap': return `Eats +${n('add')} a round.`;
      case 'glutSpeed': return `Glut also gives +${n('speed')} m/s, +${n('aps')}% attack speed.`;
      case 'ranged': return `Ranged: ${n('range')} m.${+P('poison') > 0 ? ` Hits poison: ${n('poison')}% over ${n('duration')} s.` : ''}`;
    }
    return '';
  }

  // A unit with skills applied. defs = the skill definitions that are active; roster = all units (for spawns).
  function applySkills(unit, defs, roster) {
    let u = withTraits(unit);
    for (const d of defs || []) {
      if (!d || !SKILL_TYPES[d.type]) continue;
      const P = (k) => { const v = +skillParam(d, k); return isFinite(v) ? v : 0; };
      switch (d.type) {
        case 'regen': u.regen = (u.regen || 0) + Math.max(0, P('pct')); u.hp = u.hp * (1 + P('hp') / 100); break;
        case 'poison':
          u.poisonPct = (u.poisonPct || 0) + Math.max(0, P('pct'));
          u.poisonDur = Math.max(u.poisonDur || 0, Math.max(0.5, P('duration')));
          u.aps = u.aps / (1 + Math.max(0, P('slow')) / 100);
          break;
        case 'stealth': u.stealth = true; break;
        case 'armorHp': u.bonusArmor = (u.bonusArmor || 0) + Math.max(0, P('armor')); u.hp = u.hp * (1 + P('hp') / 100); break;
        case 'spawn': {
          const name = String(skillParam(d, 'unit'));
          const src = (roster || []).find(r => r && r.name === name);
          if (src) {
            const { skills, skillDefs, skillsOn, ...plain } = src;
            u.spawn = { unit: withTraits({ ...plain, level: 0 }), count: Math.max(1, Math.round(P('count'))), every: Math.max(0.5, P('every')), max: Math.max(1, Math.round(P('max'))), waves: Math.max(0, Math.round(P('waves'))) };
          }
          break;
        }
        case 'rapid': u.aps = u.aps * (1 + P('aps') / 100); u.range = Math.max(0.5, u.range * (1 - Math.min(90, P('range')) / 100)); break;
        case 'swift': u.speed = u.speed * (1 + P('speed') / 100); u.hit = u.hit * (1 + P('hit') / 100); break;
        case 'heavy':
          u.projSpeed = u.projSpeed > 0 ? Math.max(2, u.projSpeed * (1 - Math.min(90, P('slow')) / 100)) : Math.max(2, P('instant'));
          u.hit = u.hit * (1 + P('hit') / 100);
          break;
        case 'healer': u.healPct = (u.healPct || 0) + Math.max(0, P('pct')); break;
        case 'range': u.range = u.range + P('m'); break;
        case 'shrink': u.shrinkM = Math.max(u.shrinkM || 0, P('m')); u.shrinkDur = Math.max(u.shrinkDur || 0, Math.max(0.5, P('duration'))); break;
        case 'ward': { const c = Math.max(1, P('cap')); u.bonusWard = u.bonusWard ? Math.min(u.bonusWard, c) : c; break; }
        case 'slow':
          u.slowMove = Math.max(u.slowMove || 0, Math.min(90, P('move')));
          u.slowAtk = Math.max(u.slowAtk || 0, Math.min(90, P('attack')));
          u.slowDur = Math.max(u.slowDur || 0, Math.max(0.5, P('duration')));
          break;
        case 'deathSpawn': {
          const name = String(skillParam(d, 'unit'));
          const src = (roster || []).find(r => r && r.name === name);
          if (src) {
            const { skills, skillDefs, skillsOn, ...plain } = src;
            u.deathSpawn = { name, unit: withTraits({ ...plain, level: 0 }), count: Math.max(1, Math.round(P('count'))), strength: Math.max(1, P('strength')) / 100 };
          }
          break;
        }
        case 'lifesteal': u.lifesteal = (u.lifesteal || 0) + Math.max(0, P('pct')); break;
        case 'turret': u.turrets = Math.max(u.turrets || 1, Math.min(6, Math.round(P('turrets')))); break;
        case 'shield': u.shield = (u.shield || 0) + Math.max(0, Math.round(P('hits'))); break;
        case 'spread': u.spread = [Math.max(0, P('min')), Math.max(0, P('min'), P('max'))]; break;
        case 'mortar': u.range = u.range + P('range'); u.minRange = Math.max(u.minRange || 0, P('min')); u.aps = u.aps + Math.max(0, P('aps')); break;
        case 'frenzy': u.frenzyPct = (u.frenzyPct || 0) + Math.max(0, P('pct')); u.frenzyCap = Math.max(u.frenzyCap || 0, Math.max(0.05, P('cap'))); break;
        case 'explode': u.deathBlast = Math.max(u.deathBlast || 0, Math.max(0, P('pct'))); u.blastAt = Math.max(u.blastAt || 0, Math.max(0, P('radius'))); break;
        case 'dodge': u.dodge = Math.min(90, Math.max(u.dodge || 0, P('pct'))); break;
        case 'blast': u.blastR = Math.max(u.blastR || 0, Math.max(0, P('radius'))); u.blastPct = (u.blastPct || 0) + Math.max(0, P('pct')); break;
        case 'split':
          u.beams = Math.max(u.beams || 1, Math.round(P('beams')));
          u.range = Math.max(0.5, u.range * (1 - Math.min(90, P('range')) / 100));
          u.hit = u.hit * (1 - Math.min(90, P('hit')) / 100);
          break;
        case 'momentum': if (u.roll > 0) u.roll = u.roll / (1 + Math.max(0, P('accel')) / 100); break;
        case 'unfold': if (u.roll > 0) u.unfold = true; break;
        case 'link': u.link = true; u.hp = u.hp * (1 + P('hp') / 100); break;
        case 'healbot':
          u.escort = { pct: Math.max(0, P('pct')), unit: withTraits({ name: 'Healbot', cost: 0, bodies: 1, hp: Math.max(1, P('hp')), hit: 0, aps: 1, range: Math.max(1, P('range')),
            speed: Math.max(0.5, P('speed')), splash: 0, shape: 'diamond', color: '#8FD6A0', construct: true, noCount: true, follow: true }) };
          break;
        case 'stats':
          u.hp = u.hp * (1 + P('hp') / 100);
          u.hit = Math.max(0, u.hit * (1 + P('hit') / 100) + P('hitAdd'));
          u.aps = Math.max(0.05, (u.aps + P('aps')) * (1 + P('apsPct') / 100));
          u.range = Math.max(0.5, u.range + P('range'));
          u.splash = Math.max(0, (u.splash || 0) + P('splash'));
          u.bonusArmor = (u.bonusArmor || 0) + P('armor');
          u.burst = Math.max(1, Math.round(u.burst || 1) + Math.max(0, Math.round(P('burst'))));
          u.speed = Math.max(0, u.speed + P('speed'));
          u.bodies = Math.max(1, Math.round(u.bodies || 1) + Math.round(P('bodies')));
          break;
        case 'burn': u.burn = Math.min(100, Math.max(u.burn || 0, P('pct'))); break;
        case 'roots': u.roots = { min: Math.max(0, P('min')), max: Math.max(P('min'), P('max')), dps: Math.max(0, P('dps')), pull: Math.max(0.1, P('pull')) }; break;
        case 'killStack': u.killStack = { speed: P('speed'), aps: P('aps'), max: Math.max(0, Math.round(P('max'))) }; break;
        case 'killSpawn': u.killSpawn = (u.killSpawn || 0) + Math.max(1, Math.round(P('count'))); break;
        case 'bleedHit': u.bleedHit = Math.max(u.bleedHit || 0, Math.max(0, Math.round(P('n')))); break;
        case 'bull': u.bull = { every: Math.max(1, Math.round(P('every'))), hit: Math.max(0, P('hit')), push: Math.max(0, P('push')), armor: P('armor'), run: Math.max(0, P('run')) }; break;
        case 'flare': u.flare = { per: Math.max(0, P('per')), max: Math.max(0, P('max')), shot: Math.max(1, P('shot')) }; break;
        case 'portal': {
          // the summon: the unit's plain stats at the given level (a level 2 Brute), with its own speed and a swipe
          const name = String(skillParam(d, 'unit')), src = (roster || []).find(r => r && r.name === name);
          const { skills, skillDefs, skillsOn, skillsInnate, skillMods, skillOr, skillNeeds, skillNeedsAny, trait, ...plain } = src || { name, cost: 0, bodies: 1, hp: 1100, hit: 98, aps: 1.1, range: 2, speed: 5, splash: 0, defense: 'armor', defVal: 3 };
          const base = leveled(withTraits({ ...plain, level: 0 }), Math.max(0, Math.round(P('level'))));
          u.portal = { secs: Math.max(0, P('secs')), unit: withTraits({ ...base, level: 0, name: name === 'Brute' ? 'Hellfiend' : name + ' (summoned)', tag: name === 'Brute' ? 'HEL' : plain.tag, bodies: 1, cost: 0, unlock: 0,
            speed: Math.max(0.5, P('speed')), flame: Math.max(1, Math.min(180, P('cone'))), slam: true, pierce: 0, burst: 1, pellets: 1, shape: 'imp', color: '#B3261E', summoned: true }) };
          break;
        }
        case 'overwatch': u.overwatch = { hp: Math.max(1, P('hp')) }; u.trueSight = true; break; // also sees stealthed units within its range
        case 'freeMove': u.freeMove = true; break;
        case 'silent': u.silent = true; break;
        case 'firstHit': u.firstHit = (u.firstHit || 0) + Math.max(0, P('pct')); break;
        case 'pctHit': u.pctHit = Math.min(100, (u.pctHit || 0) + Math.max(0, P('pct'))); break;
        case 'flurry':
          u.flurry = { hits: Math.max(1, Math.round(P('hits'))), gap: Math.max(0.05, P('gap')), leap: Math.max(0, P('leap')) };
          u.hit = Math.max(0, P('hit')); u.aps = Math.max(0.05, P('aps')); u.burst = 1; u.noTower = true;
          break;
        case 'lone': u.lone = Math.max(0.5, P('secs')); u.noTower = true; break;
        case 'windWalk': u.windWalk = { every: Math.max(1, Math.round(P('every'))), step: Math.max(0, P('step')) }; break;
        case 'bounce': u.bounce = { n: Math.max(1, Math.round(P('n'))), pct: Math.max(0, P('pct')), reach: Math.max(1, P('reach')) }; break;
        case 'leafblade':
          u.hp = u.hp * (1 + P('hp') / 100); u.bonusArmor = (u.bonusArmor || 0) + P('armor'); u.hit = u.hit * (1 + P('hit') / 100);
          u.range = Math.max(1, P('range')); u.flame = Math.max(1, Math.min(180, P('cone'))); u.spinBlade = true; u.mech = true; // a blade swipe in front of it (90: a half circle)
          u.projSpeed = 0; u.burst = 1; u.pellets = 1; u.pierce = 0; u.splash = 0; u.windUp = 0; u.minRange = 0;
          u.dash = Math.max(u.dash || 0, Math.max(0, P('dash')));
          if (P('missiles') > 0) u.missiles = { n: Math.round(P('missiles')), every: Math.max(1, P('every')), hit: Math.max(0, P('mhit')), splash: Math.max(0, P('msplash')), speed: Math.max(2, P('mspeed')), range: Math.max(1, P('mrange')) };
          break;
        case 'berserk': u.unstoppable = true; u.roar = { radius: Math.max(0, P('radius')), attack: Math.max(0, P('attack')), speed: Math.max(0, P('speed')), max: Math.max(0, P('max')) }; break;
        case 'frost': u.frost = { ...(u.frost || {}), every: Math.max(0.1, P('every')), pct: [P('p1'), P('p2'), P('p3')].map(x => Math.max(0, Math.min(90, x))), keep: Math.max(0.1, P('keep')) }; break;
        case 'deepfreeze': if (u.frost) u.frost = { ...u.frost, stun: Math.max(u.frost.stun || 0, Math.max(0, P('secs'))) }; break;
        case 'multibeam': u.beams = Math.max(u.beams || 1, Math.round(P('beams'))); u.beamLock = true; break;
        case 'healthiest': u.healthiest = true; break;
        case 'storm': u.storm = { radius: Math.max(0, P('radius')) }; break;
        case 'glut': u.glut = { speed: 0, aps: 0, ...(u.glut || {}), max: Math.max(1, Math.round(P('max'))), cap: Math.max(1, Math.round(P('cap'))), hp: P('hp'), hit: P('hit') }; break;
        case 'glutCap': if (u.glut) u.glut = { ...u.glut, cap: u.glut.cap + Math.max(0, Math.round(P('add'))) }; break;
        case 'glutSpeed': if (u.glut) u.glut = { ...u.glut, speed: (u.glut.speed || 0) + P('speed'), aps: (u.glut.aps || 0) + P('aps') }; break;
        case 'ranged': u.range = Math.max(0.5, P('range')); u.projSpeed = Math.max(2, P('speed')); u.flame = 0; u.slam = false; u.eye = true;
          if (P('poison') > 0) { u.poisonPct = (u.poisonPct || 0) + P('poison'); u.poisonDur = Math.max(u.poisonDur || 0, Math.max(0.5, P('duration') || 4)); }
          break; // eye: drawn awakened (the Obelisk's)
        case 'double': u.hit = u.hit * (1 + P('hit') / 100); u.double = Math.max(2, Math.round(P('every'))); break;
        case 'bleedDeep': u.bleedLonger = (u.bleedLonger || 0) + Math.max(0, P('secs')); u.bleedNoHeal = true; break;
        case 'bleedStun': u.bleedStun = Math.max(u.bleedStun || 0, Math.max(0, P('secs'))); break;
        case 'pools':
          u.splash = Math.max(0, (u.splash || 0) + P('splash'));
          u.aps = Math.max(0.05, u.aps - P('aps'));
          u.pools = { pct: Math.max(0, P('pct')), speed: Math.max(0, P('speed')), secs: Math.max(0, P('secs')) };
          break;
        case 'flow': u.flow = { aps: Math.max(0, P('aps')), range: Math.max(0, P('range')), max: Math.max(1, Math.round(P('max'))) }; break;
        case 'aura': u.bonusArmor = (u.bonusArmor || 0) + P('armor'); u.aura = { radius: Math.max(0, P('radius')), hit: P('hit'), aps: P('aps') }; break;
        case 'spears': u.spear = { forge: Math.max(0.1, P('forge')), speed: Math.max(2, P('speed')), hit: Math.max(0, P('hit')), bleed: Math.max(0, Math.round(P('bleed'))) }; break;
        case 'slam':
          u.bonusArmor = (u.bonusArmor || 0) + P('armor');
          u.range = Math.max(1, u.range - P('range'));
          u.hit = Math.max(0, P('hit'));
          u.flame = Math.max(1, Math.min(180, P('cone'))); u.slam = true; // a cone that lands at once, like a flame (drawn as a slam)
          u.stunHit = Math.max(u.stunHit || 0, Math.max(0, P('stun')));
          u.pierce = 0; u.burst = 1; u.pellets = 1;
          break;
        case 'builder': {
          // buildings go up faster too, and what its buildings make gets the same upgrades (see the game's constructBuff)
          const fast = Math.min(90, Math.max(0, P('faster')));
          if (fast > 0) u.buildSpeed = (u.buildSpeed || 1) / (1 - fast / 100);
          if (u.build && u.build.unit) {
            const c = u.build.unit;
            u.build = { ...u.build, count: Math.max(1, Math.round(u.build.count || 1) + Math.max(0, Math.round(P('extra')))),
              time: (u.build.time || 0) * (1 - Math.min(90, Math.max(0, P('faster'))) / 100),
              unit: { ...c, aps: c.aps * (1 + Math.max(0, P('aps')) / 100), shield: (c.shield || 0) + Math.max(0, Math.round(P('shield'))), bonusArmor: (c.bonusArmor || 0) + Math.max(0, P('armor')) } };
          }
          break;
        }
      }
      if (Array.isArray(d.also) && d.also.length) u = applySkills(u, d.also, roster); // the effects that come with it
    }
    return u;
  }

  // The unit with its built-in skills (slots marked in skillsInnate), resolved from a skill library
  function innateUnit(unit, lib, roster) {
    if (!unit || !Array.isArray(unit.skillsInnate) || !Array.isArray(unit.skills)) return unit;
    const defs = SLOTS.filter(k => unit.skillsInnate[k] && unit.skills[k]).map(k => {
      const base = (lib || []).find(s => s && s.id === unit.skills[k]);
      if (!base) return null;
      const mod = Array.isArray(unit.skillMods) && unit.skillMods[k] && typeof unit.skillMods[k] === 'object' ? unit.skillMods[k] : null;
      return mod ? { ...base, params: { ...base.params, ...(mod.params || {}) } } : base;
    }).filter(Boolean);
    return defs.length ? applySkills(unit, defs, roster) : unit;
  }

  // Gold per side for counter tables: the smallest amount that every unit's price divides evenly
  // (costs in lab units, 1 = 100 gold), so no unit is stuck with leftover gold. Falls back to the priciest unit.
  function fairBudget(costs, min = 2) {
    const top = Math.max(min, ...costs);
    const step = Math.min(...costs.filter(c => c > 0));
    for (let b = top; b <= top * 6 + 1e-9; b += step) {
      if (costs.every(c => c <= 0 || Math.abs(b / c - Math.round(b / c)) < 1e-6)) return b;
    }
    return top;
  }

  function squadsFor(unit, g) {
    return Math.max(1, Math.floor(g.budget / Math.max(0.0001, unit.cost) + 1e-9));
  }

  // Raw strength of what the budget buys: total health x total damage per second
  function rawStrength(unit, g) {
    const u = leveled(unit);
    const s = squadsFor(u, g);
    const n = s * u.bodies;
    const hp = n * u.hp;
    const cycle = 1 / Math.max(0.01, u.aps); // wind-up only happens when the unit sets up after moving, so it isn't counted per attack
    const dps = n * u.hit / cycle * Math.max(1, u.burst) * (u.flame > 0 ? 1 : Math.max(1, u.pellets));
    return { squads: s, bodies: n, hp, dps, strength: hp * dps };
  }

  function damageAfterDefense(hit, target, g) {
    const u = target.u;
    const armor = (u.defense === 'armor' ? u.defVal : 0) + (u.bonusArmor || 0) + (u.bull && target.trampleLeft > 0 ? u.bull.armor : 0); // Bullhead: tougher while it charges
    let d = armor > 0 ? Math.max(hit - armor, hit * g.minDmgPct / 100) : hit;
    if (u.defense === 'ward') d = Math.min(d, u.defVal);
    if (u.bonusWard > 0) d = Math.min(d, u.bonusWard); // ward from a skill; works next to armor
    return d;
  }

  function makeSide(unit, side, g) {
    return makeArmy([{ unit, gold: g.budget }], side, g);
  }

  // An army of one or more unit types, listed front to back. Each entry is a unit, or { unit, gold }
  // to give that unit its own budget (default: the battle budget). Each group stands in its own rows.
  function makeArmy(list, side, g) {
    const bodies = [];
    let depth = 0, idx = 0;
    list.forEach((entry, k) => {
      const e = entry && entry.unit ? entry : { unit: entry, gold: g.budget };
      const u = leveled(e.unit);
      const s = squadsFor(u, { budget: e.gold == null ? g.budget : e.gold });
      const n = s * u.bodies;
      const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * 2.5))));
      const sp = g.spacing;
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        const x = (c - (cols - 1) / 2) * sp;
        const y = (g.distance / 2 + depth + r * sp) * (side === 0 ? -1 : 1);
        bodies.push(newBody(u, side, x, y, list.length === 1 ? i : idx, k));
        idx++;
      }
      depth += Math.ceil(n / cols) * sp + sp; // the next group stands one gap further back
    });
    return bodies;
  }

  // `unit` must already be leveled (see leveled())
  function newBody(unit, side, x, y, i, squad) {
    const u = unit;
    const interval = 1 / Math.max(0.01, u.aps);
    return {
      u, side, x, y, hp: u.hp, alive: true, squad, level: u.level || 0, xp: 0,
      cd: ((i * 7) % 11) / 11 * interval, // deterministic stagger
      moved: 0, firing: -1, burstLeft: 0, burstTimer: 0, burstDir: [0, 1], windTarget: null, windT: 0, setUp: false,
      hidden: !!u.stealth || !!u.aloft, poison: null, shrinkM: 0, shrinkT: 0, slowT: 0, slowMove: 0, slowAtk: 0,
      spawnT: u.spawn ? u.spawn.every : 0, kids: null, orbit: null, plant: null,
      shield: u.shield || 0, // hits left that the Shield skill blocks completely
      frenzy: 0, // hits landed so far (Frenzy skill)
      stunT: 0, lastAtk: 0, // seconds of stun left (chargeStun); fight time of its last attack (stealth returns)
      spreadTo: u.spread ? spreadSpot(x, y, i, u.spread, side) : null, // Spread skill: where it runs to before anything else
      spreadT: null, // ...and the seconds it may spend getting there (set on its first step)
    };
  }
  // Spread: a spot min..max metres from (x, y) in one of 12 directions, picked from the body's index (the same on every device;
  // side 1's mirrored, toward its own front, so both sides spread alike)
  const DIRS12 = [[1, 0], [0.866025, 0.5], [0.5, 0.866025], [0, 1], [-0.5, 0.866025], [-0.866025, 0.5], [-1, 0], [-0.866025, -0.5], [-0.5, -0.866025], [0, -1], [0.5, -0.866025], [0.866025, -0.5]];
  function spreadSpot(x, y, i, [min, max], side) {
    const [dx, dy] = DIRS12[(i * 5) % 12], d = min + (max - min) * ((i * 7) % 12) / 11;
    return { x: x + dx * d, y: y + dy * d * (side === 1 ? -1 : 1) };
  }

  // Bodies of one squad placed around a point on the board (footprint about `size` metres)
  function buildSquad(unit, side, cx, cy, squad, size, startIndex = 0, level = 0) {
    const u = leveled(unit, level);
    const n = Math.max(1, Math.round(u.bodies));
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const sp = n === 1 ? 0 : Math.min(2.2, (size * 0.9) / Math.max(cols, rows));
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      // rows from the side's own front back, so side 1's squad is side 0's mirrored (the same bodies in front)
      out.push(newBody(u, side, cx + (c - (cols - 1) / 2) * sp, cy + (r - (rows - 1) / 2) * sp * (side === 1 ? -1 : 1), startIndex + i, squad));
    }
    return out;
  }

  // Lab battle: one unit type per side in a standard formation
  // Either side may be one unit or an army list (see makeArmy)
  function battle(uA, uB, g, opts = {}) {
    const side = (x, k) => Array.isArray(x) ? makeArmy(x, k, g) : makeSide(x, k, g);
    const bt = createBattle(side(uA, 0), side(uB, 1), g, opts);
    const frames = [];
    while (bt.step()) if (opts.record) frames.push(bt.frame());
    const r = bt.result();
    if (opts.record) frames.push(bt.frame(true));
    r.frames = frames;
    r.shapes = bt.bodies.map(b => b.u.shape || "circle");
    r.colors = bt.bodies.map(b => b.u.color || null);
    return r;
  }

  // A steppable battle between two lists of bodies (side 0 and side 1)
  function createBattle(A, B, g, opts = {}) {
    // linked squads and squads with a healbot: their bodies, in squads of u.bodies (a Counter Lab army puts all its
    // squads under one id; a game squad has exactly u.bodies of them)
    const groups = [];
    for (const list of [A, B]) {
      const open = {};
      for (const b of list) {
        if (!b.u.link && !b.u.escort && !b.u.portal) continue;
        const k = b.squad + ':' + b.u.name;
        if (!open[k] || open[k].length >= Math.max(1, Math.round(b.u.bodies))) groups.push(open[k] = []);
        open[k].push(b);
      }
    }
    for (const grp of groups) if (grp[0].u.link) for (const b of grp) b.link = grp;
    // a healbot behind each squad that brings one (it levels with its squad)
    let escortIdx = A.length + B.length;
    for (const grp of groups) {
      const lead = grp[0], e = lead.u.escort;
      if (!e) continue;
      const hb = newBody(leveled(e.unit, lead.level), lead.side, lead.x, lead.y - (lead.side === 0 ? 1 : -1) * 2.5, escortIdx++, -1);
      hb.follow = grp; hb.healPct = e.pct; hb.credit = lead;
      (lead.side === 0 ? A : B).push(hb);
    }
    // a portal in front of each squad that summons (Ember Imps' Hellfiend): the squad holds still (channel) for the
    // portal's secs, then the bodies still standing are sacrificed and its unit, levelled like the squad, walks out
    const portals = [];
    for (const grp of groups) {
      const lead = grp[0], pt = lead.u.portal;
      if (!pt) continue;
      let cx = 0, cy = 0;
      for (const x of grp) { cx += x.x; cy += x.y; }
      cx /= grp.length; cy = cy / grp.length + (lead.side === 0 ? 1 : -1) * 3;
      if (g.bounds) { cx = Math.max(g.bounds.x0, Math.min(g.bounds.x1, cx)); cy = Math.max(g.bounds.y0, Math.min(g.bounds.y1, cy)); }
      const hf = newBody(leveled(pt.unit, lead.level), lead.side, cx, cy, escortIdx++, -1);
      hf.credit = lead;
      for (const x of grp) x.channel = true;
      portals.push({ x: cx, y: cy, side: lead.side, t0: lead.delay || 0, secs: pt.secs, grp, hf, done: false }); // a flank squad's portal opens when it arrives
    }
    const all = A.concat(B);
    const sides = [A, B];
    const counts = (b) => !(b.u.structure || b.u.aloft || b.u.noCount); // what makes up a side's army (towers, airships and constructs don't)
    const stats = [
      { dealt: 0, wasted: 0, blocked: 0, missed: 0, windLost: 0, winds: 0, totalHp: A.reduce((s, b) => s + (counts(b) ? b.u.hp : 0), 0) },
      { dealt: 0, wasted: 0, blocked: 0, missed: 0, windLost: 0, winds: 0, totalHp: B.reduce((s, b) => s + (counts(b) ? b.u.hp : 0), 0) },
    ];
    const dt = g.dt;
    const stealthOn = ruleOn(g, 'stealth'), stealthBack = ruleOn(g, 'stealthBack'), knockOn = ruleOn(g, 'knockback');
    // without vision every unit sees the whole field: it locks on to the nearest enemy from the first tick
    const sight = !ruleOn(g, 'vision') ? 1e9 : g.sight == null ? SIGHT : g.sight;
    const minSight = g.minSight == null ? MIN_SIGHT : g.minSight;
    const drift = g.drift == null ? DRIFT : g.drift;
    const cripple = [0, 0];      // seconds left of the tower-down penalty for each side
    const downNow = [];          // sides whose tower fell this tick: crippled from the next one
    const towerDown = g.towerDown || TOWER_DOWN;
    // a body died: a fallen tower cripples its side; a body with deathBlast explodes (deathBlast % of its max health)
    const fell = (v) => {
      // a tower with teleport (Teleport mage general): instead of falling it jumps to u.teleport { x, y } with 1 health, once, and its side isn't crippled
      if (v.u.structure && v.u.teleport && !v.teleported) {
        v.teleported = true; v.alive = true; v.hp = 1; v.diedTick = undefined; v.poison = null; v.bleed = null;
        v.x = v.u.teleport.x; v.y = v.u.teleport.y;
        return;
      }
      // a lesser building (Factions devtest) doesn't cripple its side. The penalty starts with the next tick, so the
      // other side's bodies still to act this tick don't get the better of it (see the end of step)
      if (v.u.structure && !v.u.lesser) downNow.push(v.side);
      if (v.u.deathBlast > 0) {
        const dmg = v.u.hp * v.u.deathBlast / 100, rad = v.u.blastAt > 0 ? v.u.blastAt : BLAST_RADIUS;
        if (opts.record) shots.push([v.x, v.y, v.x, v.y, v.side, rad, 1, 0, 0]);
        for (const f of sides[1 - v.side]) if (f.alive && hyp(f.x - v.x, f.y - v.y) <= rad) hurt(v, f, dmg, v.x, v.y);
      }
      // Death burst: its hit to every enemy within blastR (a ram's target already took the ram itself)
      if (v.u.blastR > 0) {
        const dmg = v.u.hit * v.u.blastPct / 100;
        if (opts.record) shots.push([v.x, v.y, v.x, v.y, v.side, v.u.blastR, 1, 0, 0]);
        for (const f of sides[1 - v.side]) if (f.alive && f !== v.rammed && hyp(f.x - v.x, f.y - v.y) <= v.u.blastR) hurt(v, f, dmg, v.x, v.y);
      }
      // a carrier is gone: whoever rode inside jumps out where it fell
      if (v.u.carrier) {
        let k = 0;
        for (const r of sides[v.side]) {
          if (r.carrier !== v || !r.boarded) continue;
          const [ox, oy] = SPAWN_SPOTS[k++ % SPAWN_SPOTS.length], fwd = v.side === 0 ? 1 : -1;
          r.boarded = false; r.alive = true; r.carrier = null;
          r.x = v.x + ox * g.spacing * 0.5; r.y = v.y + oy * fwd * g.spacing * 0.5;
        }
      }
      // Spawn on death: new bodies take its place (they join at the end of this tick).
      // A spawn of the unit itself copies the dead body's stats (level, skills, buffs). Spawns never carry deathSpawn.
      const ds = v.u.deathSpawn;
      if (ds) {
        const base = ds.name === v.u.name ? v.u : ds.unit;
        const { deathSpawn, ...rest } = base;
        const ku = { ...rest, hp: base.hp * ds.strength, hit: base.hit * ds.strength };
        for (let k = 0; k < ds.count; k++) {
          const [ox, oy] = SPAWN_SPOTS[k % SPAWN_SPOTS.length], fwd = v.side === 0 ? 1 : -1;
          pendingKids.push(newBody(ku, v.side, v.x + ox * g.spacing * 0.7, v.y + oy * fwd * g.spacing * 0.7, spawnNo[v.side]++, -1));
        }
      }
    };
    const pendingKids = [];
    const charm = [0, 1].map(k => opts.charm && opts.charm[k] ? { ...opts.charm[k] } : null);
    const charmUsed = [{}, {}]; // Gentleman squads that already won a body over this fight
    const charmGained = [{}, {}], charmGave = [{}, {}]; // squads that already gained / gave a stack this fight
    const turning = [];          // bodies won over this tick: they switch sides at the end of it
    // owner is about to kill v: count the kill for charisma, or win v over instead (returns true; v lives on)
    function finishing(owner, v) {
      const c = charm[owner.side];
      if (!c || v.side === owner.side || v.u.structure || !(c[owner.squad] > 0)) return false;
      if (c[owner.squad] >= CHARM_MAX && !charmUsed[owner.side][owner.squad] && !v.u.carrier && !v.convert && !v.link && !v.u.construct) {
        charmUsed[owner.side][owner.squad] = true;
        v.hp = v.u.hp * CONVERT_HP / 100; v.turning = true; v.poison = null; v.bleed = null; v.burn = null;
        turning.push(v);
        return true;
      }
      const gained = charmGained[owner.side], gave = charmGave[owner.side];
      if (!gained[owner.squad]) { gained[owner.squad] = true; c[owner.squad] = Math.min(CHARM_MAX, c[owner.squad] + 1); }
      if (gave[owner.squad]) return false;
      let to = null, td = Infinity;
      for (const f of sides[owner.side]) {
        if (f.squad < 0 || c[f.squad] > 0) continue;
        const d = f.alive ? dist(f, owner) : Infinity;
        if (to == null || d < td) { to = f.squad; td = d; }
      }
      if (to != null) { c[to] = 1; gained[to] = true; gave[owner.squad] = true; }
      return false;
    }
    // healing and regeneration strength (a map can make them stronger)
    const healMul = g.healMul > 0 ? g.healMul : 1;
    // how much of a heal a body gets: none while it bleeds from Too deep (bleedNoHeal), POISON_HEAL % while poisoned
    // (slime units drink poison, so they heal in full)
    const healK = (v) => v.bleed && v.bleed.noHeal ? 0 : v.poison && v.poison.length && !v.u.slime ? POISON_HEAL / 100 : 1;
    // while a tick's attacks and shots land (healLater is a list), heals wait until they all have, so a heal isn't lost
    // to full health or saves a body just because of who went first; a body that fell meanwhile gets none
    let healLater = null;
    function heal(v, amt) {
      if (healLater) { if (amt > 0) healLater.push(v, amt * healK(v)); return; }
      if (amt > 0 && v.hp < v.u.hp) v.hp = Math.min(v.u.hp, v.hp + amt * healK(v));
    }
    function healsLand() {
      const list = healLater;
      healLater = null;
      for (let i = 0; i < eatLater.length; i += 2) if (hungry(eatLater[i])) eat(eatLater[i], eatLater[i + 1]); // the Obelisk's meals too
      eatLater.length = 0;
      for (const f of hitsLater) f(); // and range cuts and knockbacks
      hitsLater.length = 0;
      for (let i = 0; i < list.length; i += 2) { const v = list[i]; if (v.alive && v.hp < v.u.hp) v.hp = Math.min(v.u.hp, v.hp + list[i + 1]); }
    }
    // attack speed right now: a slow on it at the start of the tick's attacks (one landing during them counts from the next tick)
    const atkMul = (b) => b.atkSlow ? 1 - b.atkSlow / 100 : 1;
    // neutral structures (a map's elf tower): they belong to neither side, can't be hit, and shoot at
    // units of both sides in turn. Each is { u, x, y, friends: [bool, bool] }. A side it is friends with
    // (bribed) is never shot; it gets small splash heals instead (u.healHit, u.healAps, u.healSplash).
    // side (optional): the player it belongs to, so its shots are drawn in their colour. u.strong: drawn as heavier shots.
    const neutrals = (opts.neutrals || []).map(n => ({ ...n, friends: n.friends || [false, false], cd: 1 / Math.max(0.01, n.u.aps), turn: 0, healCd: n.u.healAps > 0 ? 1 / n.u.healAps : 0, healTurn: 0 }));
    // map tiles that act on any unit (either side) that starts on them or walks onto them, once per unit.
    // Each is { x0, x1, y0, y1 (world rectangle), type: 'speed' | 'toxic' | 'hail', ...settings }.
    // 'hail' is different: it hurts every unit standing in it, every tick (dps), unless the unit is hailImmune.
    const tiles = opts.tiles || [];
    // timed strikes (Factions devtest spells): { t, x, y, r, dmg, side }: at fight time t, dmg to every enemy of side
    // within r metres of (x, y), armor counting. Each fires once.
    const strikes = (opts.strikes || []).map(s => ({ ...s, done: false }));
    let projectiles = [];
    let t = 0, shots = [], over = false, tick = 0;
    const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
    // Walls (u.barrier: half their length along x, u.barrierY: half along y, the same when missing; a defensive wall is a
    // long thin one along a tile's edge): the enemy can't walk into one or shoot through it (a lobbed shell flies over);
    // their own side walks and shoots through. How far a body is from a wall is measured to its edge, so units walk up
    // to it and hit it.
    const barriers = all.filter(b => b.u.barrier > 0);
    const halfX = (w) => w.u.barrier, halfY = (w) => w.u.barrierY > 0 ? w.u.barrierY : w.u.barrier;
    const gap = (f, b) => f.u.barrier > 0 ? hyp(Math.max(0, Math.abs(f.x - b.x) - halfX(f)), Math.max(0, Math.abs(f.y - b.y) - halfY(f))) : dist(f, b);
    // the first enemy wall a shot from a to v would run into (not v itself), or null
    function wallBetween(a, v) {
      if (!barriers.length || a.u.lob) return null;
      let best = null, bt = Infinity;
      for (const w of barriers) {
        if (!w.alive || w === v || w.side === a.side) continue;
        const h = halfX(w), hy = halfY(w);
        let t0 = 0, t1 = 1;
        for (const [p, d, lo, hi] of [[a.x, v.x - a.x, w.x - h, w.x + h], [a.y, v.y - a.y, w.y - hy, w.y + hy]]) {
          if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) t0 = 2; continue; }
          let ta = (lo - p) / d, tb = (hi - p) / d;
          if (ta > tb) { const x = ta; ta = tb; tb = x; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        }
        if (t0 <= t1 && t0 < bt) { bt = t0; best = w; }
      }
      return best;
    }
    // current range: shortsight can shrink it for a while, but never below 1 m (or the unit's own range if shorter)
    // Flow state stacks add to it
    const R = (b) => { const r = b.flow > 0 ? b.u.range + b.flow * b.u.flow.range : b.u.range; return b.shrinkT > 0 ? Math.max(Math.min(r, 1), r - b.shrinkM) : r; };
    // move speed: a pool's speed boost adds to it while it lasts
    // ...and kill stacks (Rampager, the Assassin) add to it
    // ...and Berserkers' roars speed it up by a share
    const spd = (b) => ((b.poolFastT > 0 ? b.u.speed + b.poolFast : b.u.speed) + (b.kills > 0 ? b.kills * b.u.killStack.speed : 0)) * (b.roarSpd > 0 ? 1 + b.roarSpd / 100 : 1);
    // How far an attack reaches. Flame cones can reach further than where the unit stops (g.flameReach x range),
    // so a flamer keeps burning the enemies behind the first one without walking up to each.
    const reachOf = (b) => b.u.flame > 0 && g.flameReach > 1 ? R(b) * g.flameReach : R(b);
    // Where a unit stops walking: by default a little inside its range (g.stopPct: a share of range instead)
    const stopAt = (rg) => g.stopPct > 0 && g.stopPct < 1 ? rg * g.stopPct : rg - Math.min(APPROACH, rg * 0.25);
    // deterministic random numbers for healing targets (same on every device)
    // one stream per side (for the dodges of its bodies and its healers' picks), seeded alike, so neither side's luck
    // depends on how often the other side drew first
    const seeds = [0, 1].map(() => ((A.length + B.length) * 7919 + Math.abs(A.length - B.length) * 104729 + 1) >>> 0);
    const rnd = (side) => { let seed = seeds[side] | 0; seed = seed + 0x6D2B79F5 | 0; seeds[side] = seed; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    // bodies made during the fight are numbered per side (their reload stagger and spawn spot come from it), so a side's
    // spawns don't depend on whether the other side spawned first that tick
    const spawnNo = [A.length + B.length, A.length + B.length];
    // g.bounds = { x0, x1, y0, y1 } (optional): the board; Spread never sends a body off it
    if (g.bounds) for (const b of all) if (b.spreadTo) {
      b.spreadTo.x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, b.spreadTo.x));
      b.spreadTo.y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, b.spreadTo.y));
    }
    const SPAWN_SPOTS = [[0.7, 0.7], [-0.7, 0.7], [0, 1], [1, 0], [-1, 0], [0.7, -0.7], [-0.7, -0.7], [0, -1]]; // (side, forward): front first
    // the health a body has to lose: its own, or its linked squad's
    const poolHp = (v) => { if (!v.link) return v.hp; let s = 0; for (const x of v.link) if (x.alive) s += x.hp; return s; };
    // take health off a body; a linked squad shares it out by max health
    function loseHp(v, dmg) {
      if (!v.link) { v.hp -= dmg; return; }
      let max = 0;
      for (const x of v.link) if (x.alive) max += x.u.hp;
      for (const x of v.link) if (x.alive) x.hp -= dmg * x.u.hp / max;
    }
    // v ran out of health: it falls (a linked squad all together). owner (or null): who gets the bounty for leveled bodies
    function kill(owner, v) {
      for (const x of v.link ? v.link.filter(x => x.alive) : [v]) {
        x.hp = 0; x.alive = false; x.diedTick = tick;
        if (owner) owner.xp += x.u.hp * x.level;
        fell(x);
        if (owner) killed(owner, x);
        // Mark Bounty: a Sniper lands the blow that takes the marked squad's last body
        if (owner && owner.sniperMark > 0 && x.marked && owner.side !== x.side && !sides[x.side].some(y => y.alive && y.squad === x.squad)) markKill[owner.side] = true;
        devour(owner, x);
      }
    }
    // a body of the other side is cut down (not a structure): what the killer gets for it
    function killed(owner, x) {
      if (owner.side === x.side || x.u.structure) return;
      const ks = owner.u.killStack;
      if (ks && (!(ks.max > 0) || (owner.kills || 0) < ks.max)) owner.kills = (owner.kills || 0) + 1; // the Assassin's trait, Rampager
      if (owner.u.lone > 0 && isLone(x)) { owner.hunt = true; owner.huntT = 0; } // Shadow hunter: a lone kill starts the hunt again
      if (owner.u.killSpawn > 0 && (owner.alive || owner.diedTick === tick)) for (let k = 0; k < owner.u.killSpawn; k++) { // More where that came from: a new body of the killer (one that fell this tick too: its kill counts, see the attacks)
        const [ox, oy] = SPAWN_SPOTS[(spawnNo[owner.side] + k) % SPAWN_SPOTS.length], fwd = owner.side === 0 ? 1 : -1;
        pendingKids.push(newBody(owner.u, owner.side, owner.x - ox * g.spacing * 0.6, owner.y - oy * fwd * g.spacing * 0.6, spawnNo[owner.side]++, -1));
      }
    }
    // an enemy body that falls (not a structure, construct or building) is eaten by an Obelisk: the one that killed it,
    // else the nearest one within EAT_R of it, if it still has room for a stack (see u.glut)
    const hungry = (b) => b.alive && b.u.glut && (b.glutGain || 0) < b.u.glut.cap && (b.glutN || 0) < b.u.glut.max;
    function devour(owner, x) {
      if (x.u.structure || x.u.construct || x.u.building || x.u.aloft) return;
      let by = owner && owner.side !== x.side && hungry(owner) ? owner : null, bd = EAT_R + 1e-9;
      if (!by) for (const b of sides[1 - x.side]) { if (!hungry(b)) continue; const d = dist(b, x); if (d <= bd) { bd = d; by = b; } }
      if (by && healLater) eatLater.push(by, x); // during the attacks: once they have all landed, like heals (see healsLand)
      else if (by) eat(by, x);
    }
    const eatLater = [], hitsLater = [];
    const markKill = [false, false]; // see kill(): a side's Sniper finished the squad it marked
    // a stack of Glut: its health grows with its max health, so the stack heals it by what it adds
    function eat(b, x) {
      const gl = b.u.glut, n = b.glutN || 0;
      const k = (p) => (1 + (n + 1) * (p || 0) / 100) / (1 + n * (p || 0) / 100), hp = b.u.hp * k(gl.hp);
      b.hp += hp - b.u.hp;
      b.u = { ...b.u, hp, hit: b.u.hit * k(gl.hit), speed: b.u.speed + (gl.speed || 0), aps: b.u.aps * k(gl.aps) };
      b.glutN = n + 1; b.glutGain = (b.glutGain || 0) + 1;
      if (opts.record) shots.push([x.x, x.y, b.x, b.y, b.side, 0, 0, 0, 0, 1, 0, 0, 0, 3]); // [13] 3: eaten
    }
    // Overwatch: a body sitting in a structure that still stands can't be hit or targeted
    const sheltered = (f) => !!(f.inside && f.inside.alive);
    // Shadow hunter: an enemy body that shares its spot with no other body of its side (not a structure)
    function isLone(f) {
      if (f.u.structure || f.u.aloft) return false;
      for (const a of sides[f.side]) if (a !== f && a.alive && !a.u.structure && !a.u.aloft && hyp(a.x - f.x, a.y - f.y) <= LONE_R) return false;
      return true;
    }
    // Overwatch: a body sitting in a building counts the seconds it sees no enemy it could pick within its sight (range
    // + sight, at least the minimum sight); after WATCH_IDLE s in a row it leaves (true), and a watchtower it leaves
    // empty is taken down (not destroyed: no one gets anything for it and its side isn't crippled)
    function watchIdle(b) {
      const aware = Math.max(R(b) + sight, minSight);
      let sees = false;
      for (const f of sides[1 - b.side]) if (pickable(b, f) && !f.u.aloft && gap(f, b) <= aware) { sees = true; break; }
      b.watchT = sees ? 0 : (b.watchT || 0) + dt;
      if (b.watchT < WATCH_IDLE - 1e-9) return false;
      const host = b.inside;
      b.inside = null; b.watchT = 0;
      if (host.u.kind === 'watchtower' && host.alive && !sides[b.side].some(x => x.alive && x.inside === host)) {
        host.alive = false; host.hp = 0; host.removed = true; host.diedTick = tick;
      }
      return true;
    }
    // the side's tower (not a lesser structure: treasury, watchtower, wall, building)
    const isTower = (f) => !!f.u.structure && !f.u.lesser;
    // noTower: whether side s has any body an enemy could pick other than its tower (worked out once a tick)
    const othersAt = [-1, -1], othersUp = [false, false];
    function othersThan(s) {
      if (othersAt[s] !== tick) {
        othersAt[s] = tick; othersUp[s] = false;
        for (const f of sides[s]) if (f.alive && !f.hidden && !f.turning && !f.u.aloft && !sheltered(f) && !isTower(f)) { othersUp[s] = true; break; }
      }
      return othersUp[s];
    }
    // a target b may pick: not hidden, not sheltered, a lone one while it hunts, and not the tower for a body that
    // ignores it (noTower) while anything else is left to pick
    // seesHidden: b can pick f although f is stealthed: Overwatch (u.trueSight) within b's range, or a Sniper
    // (b.sniperMark, set by the game) looking for the squad its side's Sniper tower marked (f.marked)
    const seesHidden = (b, f) => f.u.stealth && !f.u.aloft && ((f.marked && b.sniperMark > 0) || (b.u.trueSight && gap(f, b) <= b.u.range + 1e-9));
    const pickable = (b, f) => f.alive && (!f.hidden || seesHidden(b, f)) && !sheltered(f) && !(b.hunt && !isLone(f)) && !(b.u.noTower && isTower(f) && othersThan(f.side));
    // damage that skips armor and ward (poison)
    function direct(owner, v, amount) {
      if (v.turning || v.u.aloft || sheltered(v)) return;
      const applied = Math.min(amount, poolHp(v));
      if (applied <= 0) return;
      stats[owner.side].dealt += applied;
      owner.dealt = (owner.dealt || 0) + applied;
      owner.xp += applied;
      v.xp += applied * (g.absorbXp == null ? 0.5 : g.absorbXp);
      loseHp(v, applied);
      if (poolHp(v) <= 1e-9 && finishing(owner, v)) return;
      if (poolHp(v) <= 1e-9) kill(owner, v);
    }
    // n stacks of bleed from owner on v (see BLEED). The stacks are v's own: every source adds to them
    function bleedOn(owner, v, n) {
      if (!v.alive || v.turning || v.u.aloft || sheltered(v) || !(n > 0)) return;
      const bl = v.bleed || (v.bleed = { n: 0, t: 0, pulse: BLEED.pulse, src: owner, noHeal: false });
      const before = bl.n;
      bl.n = Math.min(BLEED.max, bl.n + n); bl.src = owner;
      bl.t = Math.max(bl.t, BLEED.secs + (owner.u.bleedLonger || 0));
      if (owner.u.bleedNoHeal) bl.noHeal = true;
      if (owner.u.bleedStun > 0 && before < BLEED.max && bl.n >= BLEED.max && !v.u.structure) v.stunT = Math.max(v.stunT, owner.u.bleedStun);
    }
    // a frost hit from owner on v (see u.frost): its first stack at once; the next ones build up in the ongoing effects
    function frostOn(owner, v) {
      const of = owner.u.frost, fr = v.frost || (v.frost = { n: 0, build: 0, last: t, every: of.every, pct: of.pct, keep: of.keep, stun: 0 });
      if (!(fr.n > 0)) { fr.n = 1; fr.build = 0; }
      fr.last = t; fr.every = of.every; fr.pct = of.pct; fr.keep = of.keep;
      if (of.stun > 0) fr.stun = Math.max(fr.stun, of.stun);
      frostSlow(v);
    }
    // slowed by its Frost stacks while they last (the stronger of this and any other slow counts)
    function frostSlow(v) {
      const fr = v.frost;
      if (!fr || !(fr.n > 0) || v.u.unstoppable) return;
      const p = fr.pct[fr.n - 1];
      if (!(v.slowT > 0)) { v.slowMove = 0; v.slowAtk = 0; }
      v.slowMove = Math.max(v.slowMove, p); v.slowAtk = Math.max(v.slowAtk, p); v.slowT = Math.max(v.slowT, dt * 1.5);
    }
    // amt more to burn on v (see BURN): it adds to what is still burning and the three ticks start again
    function burnOn(owner, v, amt) {
      if (!v.alive || v.turning || v.u.aloft) return;
      const bn = v.burn || (v.burn = { left: 0, k: 0, t: 0, src: owner });
      bn.left += amt; bn.k = 0; bn.t = BURN.every; bn.src = owner;
    }
    // pools (see u.pools): { x, y, r, side, owner, amt (per second), speed, secs }
    const pools = [];
    function makePool(owner, x, y, hit) {
      const r = owner.u.splash;
      if (!(r > 0)) return;
      for (const q of pools) if (hyp(q.x - x, q.y - y) < q.r + r) return; // pools can't overlap
      pools.push({ x, y, r, side: owner.side, owner, amt: hit * owner.u.pools.pct / 100, speed: owner.u.pools.speed, secs: owner.u.pools.secs });
    }
    // damage from the map itself (elf tower, toxic tiles): counts for neither side, earns no experience
    function neutralDamage(v, dmg) {
      if (v.turning || v.u.aloft || sheltered(v)) return;
      if (cripple[v.side] > 0) dmg = dmg * (1 + towerDown.taken / 100);
      loseHp(v, dmg);
      if (poolHp(v) <= 1e-9) kill(null, v);
    }
    // a unit is on a map tile: its effect, once per unit and tile type
    function onTile(b, tl) {
      if (tl.type === 'hail') { if (!b.u.hailImmune) { neutralDamage(b, tl.dps * dt); b.hailT = tick; } return; }
      // spell zones (Factions devtest), every tick while the unit stands in them; tl.side is the caster:
      // burn hurts the caster's enemies, mend heals the caster's units, mud slows the caster's enemies
      if (tl.type === 'burn') { if (b.side !== tl.side) neutralDamage(b, tl.dps * dt); return; }
      if (tl.type === 'mend') { if (b.side === tl.side) heal(b, tl.dps * healMul * dt); return; }
      if (tl.type === 'mud') {
        if (b.side === tl.side || b.u.unstoppable) return;
        if (!(b.slowT > 0)) { b.slowMove = 0; b.slowAtk = 0; }
        b.slowMove = Math.max(b.slowMove, tl.slow); b.slowT = Math.max(b.slowT, 0.25); // wears off a moment after it walks out
        return;
      }
      if (tl.type === 'haste' && b.side !== tl.side) return; // only the caster's units speed up
      const seen = b.tilesHit || (b.tilesHit = {});
      if (seen[tl.type]) return;
      seen[tl.type] = true;
      if (tl.type === 'speed' || tl.type === 'haste') { b.u = { ...b.u, speed: b.u.speed * (1 + tl.speed / 100) }; b.fast = true; }
      if (tl.type === 'toxic') {
        (b.poison || (b.poison = [])).push({ src: null, dps: b.u.hp * tl.poisonPct / 100, t: tl.poisonDur });
        // slime units get it the other way round: the poison heals them (see the ongoing effects) and the slow speeds them up
        if (b.u.slime) { if (!(b.slowT > 0)) { b.slowMove = -tl.slowMove; b.slowAtk = -tl.slowAtk; b.slowT = tl.slowDur; } return; }
        if (b.u.unstoppable) return; // Berserkers: no slow
        if (!(b.slowT > 0)) { b.slowMove = 0; b.slowAtk = 0; }
        b.slowMove = Math.max(b.slowMove, tl.slowMove); b.slowAtk = Math.max(b.slowAtk, tl.slowAtk); b.slowT = Math.max(b.slowT, tl.slowDur);
      }
    }
    // structures (towers) and airships don't count: a side is beaten when its units are gone
    const aliveCount = (arr) => { let c = 0; for (const b of arr) if (b.alive && counts(b)) c++; return c; };

    function hurt(owner, v, hit, fromX, fromY) {
      if (v.turning) return; // being won over: nothing hurts it until it has switched sides
      if (v.u.aloft) return; // an airship can't be shot down
      if (sheltered(v)) return; // Overwatch: safe inside its building
      const st = stats[owner.side];
      // Wind walk: the 1st, (every+1)th, ... attack aimed at it misses, and it dashes away to one side (see u.windWalk)
      if (v.u.windWalk && owner.side !== v.side) {
        const ww = v.u.windWalk, n = v.aimedAt = (v.aimedAt || 0) + 1;
        if ((n - 1) % ww.every === 0) {
          st.missed += hit;
          if (ww.step > 0 && !v.u.structure && !v.u.anchored && !v.u.unstoppable) {
            let dx = v.x - fromX, dy = v.y - fromY, d = hyp(dx, dy);
            if (d < 1e-6) { dx = 0; dy = v.side === 0 ? -1 : 1; d = 1; }
            dx /= d; dy /= d;
            // 45° off straight back, to its left and right in turn (the same on every device)
            const sgn = (v.wwDodges = (v.wwDodges || 0) + 1) % 2 ? 1 : -1, c = 0.7071067811865476;
            const ux = (dx - sgn * dy) * c, uy = (dy + sgn * dx) * c;
            v.x += ux * ww.step; v.y += uy * ww.step; v.hx = -dx; v.hy = -dy;
            if (g.bounds) { v.x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, v.x)); v.y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, v.y)); }
            v.dashing = true;
            if (v.u.windUp > 0) { v.setUp = false; v.windTarget = null; }
          }
          return;
        }
      }
      // Dodge: the whole hit misses (the same random numbers on every device)
      if (v.u.dodge > 0 && rnd(v.side) * 100 < v.u.dodge) { st.missed += hit; return; }
      // a guard (the keep's) that is attacked leaves its post and goes for its attacker
      if (v.guard && owner.alive && owner.side !== v.side && !owner.u.aloft && !(v.avenge && v.avenge.alive)) { v.holdT = 0; v.avenge = owner; v.engaged = true; }
      if (owner.u.bldgPct > 0 && v.u.structure) hit = hit * owner.u.bldgPct / 100; // weaker against buildings (the Assassin)
      let pct = owner.u.pctHit > 0 && !v.u.structure ? v.u.hp * owner.u.pctHit / 100 : 0;
      if (owner.sniperMark > 0 && v.marked && owner.side !== v.side) { hit = hit * (1 + owner.sniperMark / 100); pct = pct * (1 + owner.sniperMark / 100); } // Mark Bounty (sniper tower)
      if (cripple[owner.side] > 0) { hit = hit * (1 - towerDown.attack / 100); pct = pct * (1 - towerDown.attack / 100); }
      // Shield: the whole hit is blocked, however big, and it brings no poison
      if (v.shield > 0) { v.shield--; st.blocked += hit + pct; return; }
      // ice walls (towers on the ice map): four walls, one per direction; each blocks a number of whole hits
      // coming from its side. walls = [north (+y), east (+x), south (-y), west (-x)]
      if (v.walls) {
        const dx = fromX - v.x, dy = fromY - v.y;
        const w = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 0 : 2);
        if (v.walls[w] > 0) { v.walls[w]--; st.blocked += hit + pct; return; }
      }
      let burnAmt = 0; // Burn: a share of the hit burns over the next seconds instead (see BURN)
      if (owner.u.burn > 0) { burnAmt = hit * owner.u.burn / 100; hit -= burnAmt; }
      let dmg = damageAfterDefense(hit, v, g);
      if (owner.u.frenzyPct > 0) owner.frenzy++; // Frenzy: every hit that lands speeds up its next attacks
      // damage the target's armor turned away earns it a little experience (g.armorXp per point, default 0.5)
      const armor = (v.u.defense === 'armor' ? v.u.defVal : 0) + (v.u.bonusArmor || 0);
      if (armor > 0) v.xp += (hit - Math.max(hit - armor, hit * g.minDmgPct / 100)) * (g.armorXp == null ? 0.5 : g.armorXp);
      if (pct > 0) { // the health cut goes past armor; a ward still caps the whole hit
        dmg += pct; hit += pct;
        if (v.u.defense === 'ward') dmg = Math.min(dmg, v.u.defVal);
        if (v.u.bonusWard > 0) dmg = Math.min(dmg, v.u.bonusWard);
      }
      if (cripple[v.side] > 0) dmg = dmg * (1 + towerDown.taken / 100);
      st.blocked += hit - dmg;
      const applied = Math.min(dmg, poolHp(v));
      st.dealt += applied;
      owner.dealt = (owner.dealt || 0) + applied;
      if (owner.u.lifesteal > 0 && owner.alive) heal(owner, applied * owner.u.lifesteal / 100);
      st.wasted += dmg - applied;
      // experience: damage dealt, half of damage absorbed, and a bounty for killing leveled bodies
      owner.xp += applied;
      v.xp += applied * (g.absorbXp == null ? 0.5 : g.absorbXp);
      loseHp(v, dmg);
      if (poolHp(v) <= 0 && finishing(owner, v)) return;
      if (poolHp(v) <= 0) { kill(owner, v); return; }
      if (burnAmt > 0) burnOn(owner, v, burnAmt);
      if (owner.u.bleedEvery > 0) { // every n-th hit it lands on the same target gives that target a stack of bleed
        const kn = owner.knives || (owner.knives = new Map()), c = (kn.get(v) || 0) + 1;
        kn.set(v, c);
        if (c % owner.u.bleedEvery === 0) bleedOn(owner, v, 1);
      }
      if (owner.u.bleedHit > 0) bleedOn(owner, v, owner.u.bleedHit); // Bloodrush: stacks of bleed with every hit
      if (owner.u.stunHit > 0 && !v.u.structure) v.stunT = Math.max(v.stunT, owner.u.stunHit);
      if (owner.u.poisonPct > 0) {
        // poison: a share of the hit, spread over its duration. Each attacker keeps one dose on the target;
        // its next hit refreshes that dose. Doses from different attackers add up.
        const dps = hit * owner.u.poisonPct / 100 / owner.u.poisonDur;
        const list = v.poison || (v.poison = []);
        const dose = list.find(p => p.src === owner);
        if (dose) { dose.dps = dps; dose.t = owner.u.poisonDur; } else list.push({ src: owner, dps, t: owner.u.poisonDur });
      }
      if (owner.u.slowDur > 0 && !v.u.unstoppable) {
        // slow: the stronger effect counts, and the longest remaining time
        if (!(v.slowT > 0)) { v.slowMove = 0; v.slowAtk = 0; }
        v.slowMove = Math.max(v.slowMove, owner.u.slowMove || 0);
        v.slowAtk = Math.max(v.slowAtk, owner.u.slowAtk || 0);
        v.slowT = Math.max(v.slowT, owner.u.slowDur);
      }
      if (owner.u.frost) frostOn(owner, v);
      // a range cut and a knockback that land during the attacks take hold once they all have (see healsLand), so the
      // body hit still gets its own attack from where it stood, with its reach, this tick
      if (owner.u.shrinkM > 0) {
        const sm = owner.u.shrinkM, sd = owner.u.shrinkDur;
        const shrink = () => { v.shrinkM = v.shrinkT > 0 ? Math.max(v.shrinkM, sm) : sm; v.shrinkT = Math.max(v.shrinkT, sd); };
        if (healLater) hitsLater.push(shrink); else shrink();
      }
      if (owner.u.knockback > 0 && knockOn && !v.u.structure && !v.u.anchored && !v.u.unstoppable) {
        // big hits on small bodies push the full distance; on big bodies barely at all
        const push = owner.u.knockback * Math.min(1, hit / v.u.hp);
        const dx = v.x - fromX, dy = v.y - fromY, d = hyp(dx, dy) || 1;
        const knock = () => { v.x += dx / d * push; v.y += dy / d * push; };
        if (healLater) hitsLater.push(knock); else knock();
      }
    }

    // Damage lands at point (px, py). direct = intended body for instant hits.
    function impact(owner, px, py, direct, hit, dirX, dirY, fromX, fromY) {
      const foes = sides[1 - owner.side];
      const hitSet = new Set();
      if (owner.u.splash > 0) {
        for (const f of foes) if (f.alive && hyp(f.x - px, f.y - py) <= owner.u.splash) hitSet.add(f);
      } else {
        let v = null;
        if (direct && direct.alive && (!owner.u.projSpeed || direct.u.barrier > 0)) v = direct;
        else {
          let bd = PROJ_HIT_RADIUS;
          for (const f of foes) { if (!f.alive) continue; const d = hyp(f.x - px, f.y - py); if (d <= bd) { bd = d; v = f; } }
        }
        if (v) hitSet.add(v);
      }
      if (!hitSet.size && owner.u.projSpeed > 0) stats[owner.side].missed += hit;
      // pierce: keep going along the shot line and hit the next bodies behind
      if (owner.u.pierce > 0) {
        const cand = [];
        for (const f of foes) {
          if (!f.alive || hitSet.has(f)) continue;
          const rx = f.x - px, ry = f.y - py;
          const along = rx * dirX + ry * dirY;
          const across = Math.abs(rx * dirY - ry * dirX);
          if (along > 0 && along <= PIERCE_DEPTH && across <= PIERCE_WIDTH) cand.push([along, f]);
        }
        cand.sort((a, b) => a[0] - b[0]);
        for (let k = 0; k < Math.min(owner.u.pierce, cand.length); k++) hitSet.add(cand[k][1]);
      }
      for (const v of hitSet) hurt(owner, v, hit, fromX, fromY);
      if (owner.u.bounce && !(owner.u.splash > 0) && hitSet.size) { const v = hitSet.values().next().value; bounceOn(owner, v, hit, 0, [v]); } // Bouncing blade
      // Waterhealing: allies inside the splash heal for the hit
      if (owner.u.waterHeal && owner.u.splash > 0) for (const a of sides[owner.side]) if (a.alive && !a.u.structure && !a.turning && hyp(a.x - px, a.y - py) <= owner.u.splash) heal(a, hit * healMul);
      if (owner.u.pools) makePool(owner, px, py, hit);
    }
    // Bouncing blade: from body v the shot flies on (homing, as fast as the unit's shots) to the nearest other enemy
    // within bounce.reach that it hasn't hit yet, bounce.pct % of hit0; k bounces done so far
    function bounceOn(owner, v, hit0, k, done) {
      const bo = owner.u.bounce;
      if (!bo || k >= bo.n) return;
      let nx = null, nd = bo.reach + 0.01;
      for (const f of sides[1 - owner.side]) {
        if (!f.alive || f.hidden || sheltered(f) || f.u.aloft || done.includes(f)) continue;
        const d = hyp(f.x - v.x, f.y - v.y);
        if (d <= nd) { nd = d; nx = f; }
      }
      if (!nx) return;
      const d = nd || 1;
      projectiles.push({ owner, x: v.x, y: v.y, fx: v.x, fy: v.y, tx: nx.x, ty: nx.y, dirX: (nx.x - v.x) / d, dirY: (nx.y - v.y) / d, left: d, hit: hit0 * bo.pct / 100,
        homing: nx, bounce: { k: k + 1, hit0, done: done.concat([nx]) }, speed: Math.max(20, owner.u.projSpeed || 0) });
    }
    // a bounce or a missile lands: its hit to the body it was after (or the nearest within reach of where it is), a
    // missile's to everything within its blast; a bounce bounces on
    function homingLand(p) {
      const foes = sides[1 - p.owner.side];
      let v = p.homing && p.homing.alive && hyp(p.homing.x - p.x, p.homing.y - p.y) <= PROJ_HIT_RADIUS + 0.5 ? p.homing : null;
      if (!v) { let bd = PROJ_HIT_RADIUS; for (const f of foes) { if (!f.alive) continue; const d = hyp(f.x - p.x, f.y - p.y); if (d <= bd) { bd = d; v = f; } } }
      if (p.missile && p.splash > 0) {
        if (opts.record) shots.push([p.x, p.y, p.x, p.y, p.owner.side, p.splash, 1, 0, 0]);
        let any = false;
        for (const f of foes) if (f.alive && hyp(f.x - p.x, f.y - p.y) <= p.splash) { any = true; hurt(p.owner, f, p.hit, p.fx, p.fy); }
        if (!any) stats[p.owner.side].missed += p.hit;
      } else if (v) hurt(p.owner, v, p.hit, p.fx, p.fy);
      else stats[p.owner.side].missed += p.hit;
      if (!v) return;
      if (p.bounce) bounceOn(p.owner, v, p.bounce.hit0, p.bounce.k, p.bounce.done);
      else if (p.missile && p.owner.u.bounce) bounceOn(p.owner, v, p.hit, 0, [v]);
    }
    // Leafblade: a salvo of missiles.n homing missiles at the nearest enemies (units before buildings), one each while
    // there are enough
    function salvo(b) {
      const ms = b.u.missiles, list = [];
      for (const f of sides[1 - b.side]) if (pickable(b, f) && !f.u.aloft && !(gap(f, b) > ms.range + 1e-9)) list.push([(f.u.structure ? 1e6 : 0) + dist(f, b), f]); // only within its missile range
      if (!list.length) return false;
      list.sort((p, q) => p[0] - q[0]);
      for (let k = 0; k < ms.n; k++) {
        const tgt = list[k % list.length][1], d = dist(tgt, b) || 1;
        projectiles.push({ owner: b, x: b.x, y: b.y, fx: b.x, fy: b.y, tx: tgt.x, ty: tgt.y, dirX: (tgt.x - b.x) / d, dirY: (tgt.y - b.y) / d, left: d, hit: ms.hit,
          homing: tgt, missile: true, splash: ms.splash, speed: ms.speed });
      }
      return true;
    }
    // Berserkers: a roar when the body starts fighting (see u.roar)
    function roar(b) {
      const r = b.u.roar;
      b.roared = true;
      if (opts.record) shots.push([b.x, b.y, b.x, b.y, b.side, r.radius, 0, 0, 0, 1, 0, 0, 1]); // [12]: a roar
      for (const f of all) {
        if (f === b || !f.alive || f.u.structure || f.u.aloft || hyp(f.x - b.x, f.y - b.y) > r.radius) continue;
        if (f.side === b.side) f.roarSpd = Math.min(r.max, (f.roarSpd || 0) + r.speed);
        else if (!f.u.unstoppable) f.roarAtk = Math.min(r.max, (f.roarAtk || 0) + r.attack);
      }
    }
    // Snow storm: every 1/aps s (slowed like its attacks), its hit and its frost to every enemy within storm.radius
    function stormStep(b) {
      b.stormCd = (b.stormCd || 0) - dt * atkMul(b);
      if (b.stormCd > 1e-9) return;
      const r = b.u.storm.radius, hit = b.u.hit + (b.auraHit || 0);
      const caught = sides[1 - b.side].filter(f => f.alive && !f.u.aloft && !sheltered(f) && gap(f, b) <= r);
      if (!caught.length) { b.stormCd = Math.max(b.stormCd, -dt); return; }
      b.stormCd = Math.max(b.stormCd, -dt) + 1 / Math.max(0.01, apsOf(b));
      for (const f of caught) hurt(b, f, hit, b.x, b.y);
    }
    // a thrown titanium spear lands: its hit to the nearest enemy body within reach of where it is, and its bleed
    function spearLand(p) {
      let v = null, bd = PROJ_HIT_RADIUS;
      for (const f of sides[1 - p.owner.side]) { if (!f.alive) continue; const d = hyp(f.x - p.x, f.y - p.y); if (d <= bd) { bd = d; v = f; } }
      if (!v) { stats[p.owner.side].missed += p.hit; return; }
      const before = poolHp(v);
      hurt(p.owner, v, p.hit, p.fx, p.fy);
      if (v.alive && poolHp(v) < before) bleedOn(p.owner, v, p.bleed); // a shield or a dodge stops the bleed too
    }

    // enemies the unit may attack right now, nearest first
    function validTargets(b) {
      const valid = [];
      for (const f of sides[1 - b.side]) {
        if (!pickable(b, f)) continue;
        const d = gap(f, b);
        if (d <= reachOf(b) + 0.01 && d >= b.u.minRange) valid.push([b.u.healthiest ? (f.u.structure ? 1e9 : 0) - poolHp(f) : d, f]); // healthiest: most health first, units before structures
      }
      valid.sort((p, q) => b.u.backline ? q[0] - p[0] : p[0] - q[0]);
      return valid.map(v => v[1]);
    }

    // the enemy a body attacks: once it has picked one it stays on it until it dies, hides or leaves its reach,
    // even if another enemy comes closer; then it picks the nearest
    function locked(b, valid) {
      if (b.avenge && b.avenge.alive && valid.includes(b.avenge)) b.lock = b.avenge; // a guard going for its attacker
      if (!(b.lock && b.lock.alive && valid.includes(b.lock))) {
        // aware2: the nearest enemy that isn't about to die from what its side is already shooting at it
        b.lock = g.aware2 ? (valid.find(f => (f.claimDmg || 0) < f.hp) || valid[0]) : valid[0];
        if (g.aware2 && b.lock) b.lock.claimDmg = (b.lock.claimDmg || 0) + b.u.hit;
      }
      return b.lock;
    }
    // aware2: how many melee bodies a target makes room for
    const slotsOf = (f) => f.u.structure ? 6 : f.u.hp >= 1000 ? 5 : f.u.bodies >= 5 ? 2 : 3;
    // aware2: whom an engaged body walks to: within its sight (its current one a bit further), by distance plus crowding,
    // keeping its current one unless another is clearly better. null: nobody in sight (it goes for the nearest, as before)
    function goalOf(b, rg) {
      const aware = Math.max(rg + sight, minSight), melee = rg <= AWARE.melee;
      let best = null, bc = Infinity;
      for (const f of sides[1 - b.side]) {
        if (!pickable(b, f)) continue;
        const d = gap(f, b), mine = f === b.goal;
        if (d > aware * (mine ? AWARE.leash : 1)) continue;
        const lane = g.awareLane == null ? AWARE.lane : g.awareLane;
        let c = d - (mine ? AWARE.stick : 0) + lane * Math.abs(f.x - b.x);
        if (melee) { const n = (f.claimsM || 0) - (mine ? 1 : 0); c += n >= slotsOf(f) ? AWARE.full : n * AWARE.step; }
        else c += ((f.claimsR || 0) - (mine ? 1 : 0)) * 0.5;
        if (c < bc) { bc = c; best = f; }
      }
      b.goal = best;
      return best;
    }

    // one shot, or a spread of shotgun pellets each at a different body in the cone
    function aim(b, primary, valid) {
      if (b.u.flame > 0) return flameTargets(b, primary);
      if (b.u.stomp > 0) {
        // stomp: every enemy body within stomp m of it (the target too), each hit once where it stands
        const out = [primary];
        for (const f of sides[1 - b.side]) if (f !== primary && f.alive && !f.u.aloft && !sheltered(f) && gap(f, b) <= b.u.stomp + 0.01) out.push(f);
        out.stomp = true;
        return out;
      }
      const n = Math.max(1, Math.round(b.u.pellets));
      if (n === 1 && b.u.beams > 1) {
        // split beam: the target plus the next nearest enemies in reach, each hit once (Multibeam: each extra beam
        // keeps to its enemy while that stays in reach)
        const out = [primary];
        if (b.u.beamLock) for (const f of b.beamAims || []) { if (out.length >= b.u.beams) break; if (!out.includes(f) && valid.includes(f)) out.push(f); }
        for (const f of valid) { if (out.length >= b.u.beams) break; if (!out.includes(f)) out.push(f); }
        if (b.u.beamLock) b.beamAims = out.slice(1);
        return out;
      }
      if (n === 1) return [primary];
      const ax = primary.x - b.x, ay = primary.y - b.y, al = hyp(ax, ay);
      const cone = valid.filter(f => {
        const fx = f.x - b.x, fy = f.y - b.y, fl = hyp(fx, fy);
        if (!al || !fl) return true;
        return (ax * fx + ay * fy) / (al * fl) >= SHOTGUN_COS - 1e-12;
      });
      if (!cone.length) cone.push(primary);
      const out = [];
      for (let k = 0; k < n; k++) out.push(cone[k % cone.length]);
      return out;
    }

    // flame cone: every enemy in range inside the cone toward the target, hidden ones too
    function flameTargets(b, primary) {
      const ax = primary.x - b.x, ay = primary.y - b.y, al = hyp(ax, ay);
      const c = cosDeg(b.u.flame), reach = reachOf(b) + 0.01;
      const out = [];
      for (const f of sides[1 - b.side]) {
        if (!f.alive) continue;
        const fx = f.x - b.x, fy = f.y - b.y, fl = hyp(fx, fy);
        if (gap(f, b) > reach || fl < b.u.minRange) continue;
        if (f === primary || !al || !fl || (ax * fx + ay * fy) / (al * fl) >= c - 1e-12) out.push(f);
      }
      if (!out.includes(primary)) out.push(primary);
      out.flame = [ax, ay, al];
      return out;
    }

    // attacks per second right now: Frenzy speeds it up with every hit landed, up to its cap (never below the base rate)
    function apsOf(b) {
      const a = b.u.aps + (b.auraAps || 0) + (b.flow > 0 ? b.flow * b.u.flow.aps : 0) + (b.kills > 0 ? b.kills * b.u.killStack.aps : 0); // an ally's aura, Flow state stacks, kill stacks
      const roared = b.roarAtk > 0 ? 1 - b.roarAtk / 100 : 1; // an enemy Berserker's roar
      if (!(b.u.frenzyPct > 0) || !b.frenzy) return a * roared;
      return Math.max(a, Math.min(b.u.frenzyCap, a * (1 + b.frenzy * b.u.frenzyPct / 100))) * roared;
    }

    function fire(b, targets, canCharge) {
      const charged = canCharge && b.u.charge > 1 && b.moved >= CHARGE_RUN && !(t < (b.chargeAt || 0));
      b.moved = 0;
      if (charged && b.u.chargeCd > 0) b.chargeAt = t + b.u.chargeCd;
      // attacking gives a stealth unit away (it hides again after STEALTH_BACK s without attacking); an airship stays out of
      // reach; Silent blade's first attack doesn't. During the tick's attacks the enemy sees it from the next tick (healsLand)
      if (b.hidden && !b.u.aloft && !b.quiet) { if (healLater) hitsLater.push(() => { b.hidden = false; }); else b.hidden = false; }
      b.lastAtk = t; b.revealed = true; // a disguised body (b.mask) shows what it is from its first attack
      if (b.u.healPct > 0) {
        // heal a random wounded ally (not itself)
        const hurtAllies = sides[b.side].filter(a => a.alive && a !== b && a.hp < a.u.hp);
        if (hurtAllies.length) {
          const a = hurtAllies[Math.min(hurtAllies.length - 1, Math.floor(rnd(b.side) * hurtAllies.length))];
          heal(a, b.u.hit * b.u.healPct / 100 * healMul);
          if (opts.record) shots.push([b.x, b.y, a.x, a.y, b.side, 0, 0, 1]);
        }
      }
      const opening = b.u.firstHit > 0 && !b.firstDone ? 1 + b.u.firstHit / 100 : 1; // Shadowborn: the first attack of the fight hits harder
      b.firstDone = true;
      const hit = (b.u.hit * (charged ? b.u.charge : 1) * (b.u.spinHit > 0 ? Math.min(SPIN_CAP, 1 + b.u.spinHit / 100 * Math.max(0, b.firing)) : 1) + (b.auraHit || 0)) * opening; // an ally's aura adds to every hit
      // trample: a charged hit doesn't stop the unit; it runs on through its target and over every body in its path
      if (charged && b.u.trample > 0 && targets.length && !targets.flame) {
        const tgt = targets[0], dx = tgt.x - b.x, dy = tgt.y - b.y, d = hyp(dx, dy);
        if (d > 0) { b.trampleDir = [dx / d, dy / d]; b.trampleLeft = d + (b.u.trampleRun > 0 ? b.u.trampleRun : TRAMPLE_RUN); b.trampled = [tgt]; }
      }
      // stunned after a charge (a trampler only once its run is over, see the movement loop)
      if (charged && b.u.chargeStun > 0 && !(b.trampleLeft > 0)) b.stunT = b.u.chargeStun;
      const walled = new Set(); // an enemy wall in the way takes the shot instead (a flame burns it once)
      for (const t0 of targets) {
        const wl = wallBetween(b, t0), tgt = wl || t0;
        if (wl && targets.flame) { if (walled.has(wl)) continue; walled.add(wl); }
        const dx = tgt.x - b.x, dy = tgt.y - b.y, d = hyp(dx, dy) || 1;
        const dirX = dx / d, dirY = dy / d;
        if (targets.flame || targets.stomp) {
          hurt(b, tgt, hit, b.x, b.y); // flames and stomps land at once, no splash or pierce
        } else if (b.u.projSpeed > 0) {
          projectiles.push({ owner: b, x: b.x, y: b.y, fx: b.x, fy: b.y, tx: tgt.x, ty: tgt.y, dirX, dirY, left: d, hit });
        } else {
          impact(b, tgt.x, tgt.y, tgt, hit, dirX, dirY, b.x, b.y);
        }
        if (opts.record && !targets.flame) shots.push([b.x, b.y, tgt.x, tgt.y, b.side, b.u.splash, charged ? 1 : 0, 0, 0, b.u.spinUp > 0 ? b.spin : 1, b.u.chain ? 1 : 0, 0, 0, b.u.frost && !(b.u.projSpeed > 0) ? 1 : 0, b, tgt]); // [13] 1: a frost beam; [14], [15]: its shooter and target (a held beam is drawn between them)
      }
      // chain lightning: from the target on to the nearest enemy not hit yet, up to chain.jumps times
      if (b.u.chain && targets.length && !targets.flame && !(b.u.projSpeed > 0)) {
        const done = [targets[0]], k = b.u.hit > 0 ? hit / b.u.hit : 1;
        let last = targets[0], lx = last.x, ly = last.y;
        for (let j = 0; j < b.u.chain.jumps; j++) {
          let nx = null, nd = b.u.chain.reach + 0.01;
          for (const f of sides[1 - b.side]) {
            if (!f.alive || f.hidden || sheltered(f) || done.includes(f)) continue;
            const d = hyp(f.x - lx, f.y - ly);
            if (d <= nd) { nd = d; nx = f; }
          }
          if (!nx) break;
          if (opts.record) shots.push([lx, ly, nx.x, nx.y, b.side, 0, 0, 0, 0, 1, 1]);
          done.push(nx);
          const fx = lx, fy = ly;
          last = nx; lx = nx.x; ly = nx.y;
          hurt(b, nx, b.u.chain.hit * k, fx, fy);
        }
      }
      // a flame is drawn once, as a wedge from the unit out to its range
      if (opts.record && targets.flame) {
        const [ax, ay, al] = targets.flame, r = reachOf(b), k = al ? r / al : 0;
        shots.push([b.x, b.y, b.x + ax * k, b.y + ay * k, b.side, 0, charged ? 1 : 0, 0, b.u.flame, 1, 0, b.u.slam ? 1 : b.u.spinBlade ? 2 : 0]); // [11]: a ground slam (1) or spinning blades (2), not fire
      }
    }

    // Death flurry: the next blow, on the same target; when the last one killed it, a leap to the nearest enemy within
    // flurry.leap metres first (none: the flurry ends)
    function flurryStep(b) {
      b.flurryT -= dt;
      if (b.flurryT > 1e-9) return;
      let tgt = b.flurryTgt;
      if (!(tgt && tgt.alive && !sheltered(tgt))) {
        tgt = null;
        let bd = b.u.flurry.leap + 0.01;
        for (const f of sides[1 - b.side]) { if (!pickable(b, f)) continue; const d = gap(f, b); if (d <= bd) { bd = d; tgt = f; } }
        if (!tgt) { b.flurryLeft = 0; return; }
        const d = dist(tgt, b), keep = Math.min(d, Math.max(0.5, R(b) * 0.6));
        if (opts.record) shots.push([b.x, b.y, tgt.x, tgt.y, b.side, 0, 1, 0, 0]);
        if (d > 1e-6) { b.hx = (tgt.x - b.x) / d; b.hy = (tgt.y - b.y) / d; b.x = tgt.x - b.hx * keep; b.y = tgt.y - b.hy * keep; }
        b.flurryTgt = tgt; b.lock = tgt;
      } else if (gap(tgt, b) > R(b) + 2) { b.flurryLeft = 0; return; }
      b.flurryLeft--; b.flurryT += b.u.flurry.gap;
      fire(b, [tgt], false);
    }

    // Extra turret skill: each body carries more copies of its weapon (turret 0 is its own attack, see the attack
    // loop). Every turret has its own reload (b.tcd[k]) and target (b.aims[k]), and none aims at another one's target.
    function turretTaken(b, k) {
      if (!b.aims) b.aims = [];
      const out = [];
      for (let j = 0; j < b.u.turrets; j++) if (j !== k && b.aims[j] && b.aims[j].alive) out.push(b.aims[j]);
      return out;
    }
    function extraTurrets(b) {
      if (!b.tcd) b.tcd = [];
      let valid = null;
      for (let k = 1; k < b.u.turrets; k++) {
        b.tcd[k] = (b.tcd[k] || 0) - dt * atkMul(b);
        if (b.tcd[k] > 0) continue;
        if (!valid) valid = validTargets(b);
        const taken = turretTaken(b, k), tgt = valid.find(f => !taken.includes(f));
        if (!tgt) { b.tcd[k] = Math.max(b.tcd[k], -dt); b.aims[k] = null; continue; }
        b.aims[k] = tgt;
        b.tcd[k] = Math.max(b.tcd[k], -dt) + 1 / Math.max(0.01, apsOf(b));
        fire(b, aim(b, tgt, valid), false);
      }
    }

    // a ram's turn: run at the enemy tower (or, once it is down, the nearest enemy); on reaching it, hit it once and fall
    function ram(b, foes) {
      let tgt = null, td = Infinity;
      for (const f of foes) if (f.alive && f.u.structure) { const d = dist(f, b); if (d < td) { td = d; tgt = f; } }
      if (!tgt) for (const f of foes) if (pickable(b, f)) { const d = dist(f, b); if (d < td) { td = d; tgt = f; } }
      if (!tgt) return;
      b.intent = tgt;
      if (td > RAM_REACH) {
        const mv = Math.min(td - RAM_REACH * 0.5, spd(b) * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * (cripple[b.side] > 0 ? 1 - towerDown.move / 100 : 1) * dt);
        b.hx = (tgt.x - b.x) / td; b.hy = (tgt.y - b.y) / td;
        b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
        if (dist(tgt, b) > RAM_REACH) return;
      }
      if (opts.record) shots.push([b.x, b.y, tgt.x, tgt.y, b.side, 0, 1, 0, 0]);
      b.rammed = tgt;
      hurt(b, tgt, b.u.hit, b.x, b.y);
      if (b.alive) rammed.push(b); // it falls once every body has moved, so an enemy ram reaching it this tick still finds it
    }
    const rammed = [];

    // share of its move speed a body walks at right now (slowed, or crippled by its fallen tower)
    const moveMul = (b) => (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * (cripple[b.side] > 0 ? 1 - towerDown.move / 100 : 1);

    // a roller's turn (see ROLL_START): marches like any unit until it spots an enemy, then rolls at its target
    // gathering speed, runs over every enemy body in its path (each once per pass), carries on ROLL_PAST metres past
    // the target, stops dead and rolls back
    function roll(b, foes) {
      const top = b.u.speed, start = Math.min(ROLL_START, top);
      if (b.rollV == null) b.rollV = start;
      if (!(b.rollPast > 0)) {
        let near = null, nd = Infinity;
        for (const f of foes) { if (!pickable(b, f)) continue; const d = dist(f, b); if (d < nd) { nd = d; near = f; } }
        if (!near) return;
        b.near = near;
        const [mx, my] = b.march || [0, b.side === 0 ? 1 : -1];
        if (!b.engaged) {
          let spotted = nd <= Math.max(R(b) + sight, minSight);
          if (!spotted) { // nothing left ahead to march toward: go for the nearest
            spotted = true;
            for (const f of foes) if (pickable(b, f) && (f.x - b.x) * mx + (f.y - b.y) * my > 0) { spotted = false; break; }
          }
          if (spotted) b.engaged = true;
        }
        // once engaged it stays on its target until that dies or hides, like any unit
        const tgt = b.engaged ? (b.lock && pickable(b, b.lock) ? b.lock : (b.lock = near)) : null;
        b.intent = tgt;
        let wx = mx, wy = my;
        if (tgt) { const d = dist(tgt, b) || 1; wx = (tgt.x - b.x) / d; wy = (tgt.y - b.y) / d; }
        // standing still it can set off any way; rolling, it swings round like a walking body
        if (b.hx === undefined || b.rollV <= start) { b.hx = wx; b.hy = wy; }
        else {
          const k = Math.min(1, TURN * dt);
          let hx = b.hx + (wx - b.hx) * k, hy = b.hy + (wy - b.hy) * k, hl = hyp(hx, hy);
          if (hl < 1e-6) { hx = wx; hy = wy; hl = 1; }
          b.hx = hx / hl; b.hy = hy / hl;
        }
        // about to reach the target: from here it runs straight on, through it and past it
        if (tgt) {
          const d = dist(tgt, b);
          if (d <= b.rollV * dt + TRAMPLE_WIDTH) { b.rollDir = d > 1e-6 ? [(tgt.x - b.x) / d, (tgt.y - b.y) / d] : [b.hx, b.hy]; b.rollPast = d + ROLL_PAST; }
        }
      }
      b.rollV = Math.min(top, b.rollV + (top - start) / b.u.roll * dt);
      if (b.rollPast > 0) { b.hx = b.rollDir[0]; b.hy = b.rollDir[1]; if (b.lock && b.lock.alive) b.intent = b.lock; } // running through and past its target
      const mv = b.rollV * moveMul(b) * dt;
      b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
      let stop = false;
      if (b.rollPast > 0) { b.rollPast -= mv; if (b.rollPast <= 1e-9) stop = true; }
      if (g.bounds) { // the edge of the board stops it too
        const x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, b.x)), y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, b.y));
        if (x !== b.x || y !== b.y) { b.x = x; b.y = y; stop = true; }
      }
      const seen = b.rolled || (b.rolled = []);
      for (const f of foes) {
        if (!f.alive || seen.includes(f) || hyp(f.x - b.x, f.y - b.y) > TRAMPLE_WIDTH) continue;
        seen.push(f);
        if (opts.record) shots.push([b.x, b.y, f.x, f.y, b.side, 1, 1, 0, 0]);
        hurt(b, f, b.u.hit, b.x, b.y);
      }
      if (stop && b.u.unfold && b.rolled && b.rolled.length) { b.u = { ...b.u, roll: 0, unfolded: true }; b.engaged = true; } // through its first enemy: it folds out
      if (stop) { b.rollPast = 0; b.rollV = start; b.rolled = null; }
    }

    // a healbot keeps close behind its squad (the middle of its bodies still standing); with the squad gone it stays put
    function escortMove(b) {
      let sx = 0, sy = 0, n = 0;
      for (const a of b.follow) if (a.alive) { sx += a.x; sy += a.y; n++; }
      if (!n) return;
      const dx = sx / n - b.x, dy = sy / n - b.y, d = hyp(dx, dy), keep = 2.5;
      if (d <= keep) return;
      const mv = Math.min(d - keep, spd(b) * moveMul(b) * dt);
      b.hx = dx / d; b.hy = dy / d;
      b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
    }

    // a builder is done: its constructs stand where it worked, side by side across the direction of the enemy it saw
    function finishBuild(b) {
      b.buildT = 0; b.built = true;
      const bd = b.u.build, n = Math.max(1, Math.round(bd.count || 1)), [dx, dy] = b.buildDir;
      // a construct stands where it was built, unless it was made to move (Core Awoken)
      const cu = leveled(withTraits({ ...bd.unit, bodies: 1, construct: true, noCount: true, ...(bd.unit.speed > 0 ? {} : { speed: 0, anchored: true }) }), b.level);
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * BUILD_GAP;
        let x = b.x - dy * off, y = b.y + dx * off;
        if (g.bounds) { x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, x)); y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, y)); }
        const kid = newBody(cu, b.side, x, y, spawnNo[b.side]++, -1);
        kid.credit = b; // its XP and damage count for its builder's squad
        pendingKids.push(kid);
      }
    }

    // each unfinished building site gets the nearest builder that has no job yet
    for (const s of all) {
      if (!s.site || !s.alive) continue;
      s.site.start = s.site.work;
      if (s.site.work >= s.site.need) continue;
      let best = null, bd = Infinity;
      for (const b of sides[s.side]) if (b.u.build && !b.siteJob && b.alive) { const d = dist(b, s); if (d < bd) { bd = d; best = b; } }
      if (best) best.siteJob = s;
    }
    // a builder's turn while it has a site to build: walk there, then stand and build (see the builders in step())
    function siteWork(b) {
      const s = b.siteJob;
      if (!s.alive || s.site.work >= s.site.need) { b.siteJob = null; b.siteAt = false; return false; }
      const d = dist(s, b);
      b.siteAt = d <= SITE_REACH;
      if (b.siteAt) return true;
      const mv = Math.min(d - SITE_REACH * 0.8, spd(b) * moveMul(b) * dt);
      b.hx = (s.x - b.x) / d; b.hy = (s.y - b.y) / d;
      b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
      return true;
    }

    // a drone circles its anchor (it falls with it): the offset turns by speed / r radians a tick, kept at r metres
    function orbitMove(b) {
      const o = b.orbit, a = o.anchor;
      if (!a.alive) { kill(null, b); return; }
      let ox = b.x - a.x, oy = b.y - a.y, d = hyp(ox, oy);
      if (d < 1e-6) { ox = o.r; oy = 0; d = o.r; }
      ox = ox / d * o.r; oy = oy / d * o.r;
      const c = cosDeg(Math.min(90, b.u.speed * moveMul(b) * dt / o.r * 57.29577951308232)), sn = Math.sqrt(Math.max(0, 1 - c * c));
      const nx = ox * c - oy * sn, ny = ox * sn + oy * c;
      b.hx = -ny / o.r; b.hy = nx / o.r;
      b.x = a.x + nx; b.y = a.y + ny;
    }
    // walk toward (x, y), stopping `stop` metres short; true once there
    function walkTo(b, x, y, stop) {
      const dx = x - b.x, dy = y - b.y, d = hyp(dx, dy);
      if (d <= stop + 1e-6) return true;
      const mv = Math.min(d - stop, spd(b) * moveMul(b) * dt);
      b.hx = dx / d; b.hy = dy / d;
      b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
      return d - mv <= stop + 1e-6;
    }
    const mines = []; // { x, y, side, owner, hit, radius }
    // what a repairbot works on: the nearest of its side's buildings or tower that is damaged or not built yet
    const needsRepair = (v) => v.alive && (v.u.building || v.u.structure) && ((v.site && v.site.work < v.site.need) || v.hp < v.u.hp - 1e-9);
    function botMove(b) {
      if (b.u.bot === 'mine' && b.plant) {
        const sp = b.plant.spots[0];
        if (!sp) { b.plant = null; return; }
        if (walkTo(b, sp.x, sp.y, 0.1)) {
          const mn = b.plant.mine;
          mines.push({ x: sp.x, y: sp.y, side: b.side, owner: b, hit: mn.hit, radius: mn.radius });
          b.plant.spots.shift();
        }
        return;
      }
      if (b.u.bot === 'repair') {
        let best = null, bd = Infinity;
        for (const v of sides[b.side]) if (needsRepair(v)) { const d = dist(v, b); if (d < bd) { bd = d; best = v; } }
        b.repairing = best && walkTo(b, best.x, best.y, SITE_REACH * 0.8) ? best : null;
      }
    }

    // Grasping roots: let go of a target that is gone or in reach (it fights that one), grab the nearest free enemy
    // min..max metres away, and drag it in, hurting it
    function rootStep(b) {
      const rt = b.u.roots;
      let v = b.rootTgt;
      if (v && (!v.alive || v.turning || v.side === b.side || sheltered(v) || gap(v, b) > rt.max + 2 || gap(v, b) <= R(b))) {
        if (v.alive && v.side !== b.side && gap(v, b) <= R(b)) b.lock = v; // dragged into reach: it fights this one
        v.rootedBy = null; b.rootTgt = v = null;
      }
      if (!v) {
        let bd = Infinity;
        for (const f of sides[1 - b.side]) {
          if (!pickable(b, f) || f.u.structure || f.u.anchored || f.u.barrier || f.u.construct || f.u.unstoppable || (f.rootedBy && f.rootedBy.alive && f.rootedBy.rootTgt === f)) continue;
          const d = gap(f, b);
          if (d >= rt.min - 1e-9 && d <= rt.max + 1e-9 && d < bd) { bd = d; v = f; }
        }
        if (!v) return;
        b.rootTgt = v; v.rootedBy = b;
      }
      const d = dist(v, b), mv = Math.min(rt.pull * dt, Math.max(0, d - R(b) * 0.8));
      if (d > 1e-6) { v.x -= (v.x - b.x) / d * mv; v.y -= (v.y - b.y) / d * mv; }
      direct(b, v, rt.dps * dt);
    }

    let auraWas = false; // a body with an aura was standing last tick
    // Flow state: an attack made standing still adds a stack
    function flowStep(b) { if (b.u.flow && !(b.moved > 1e-6)) b.flow = Math.min(b.u.flow.max, (b.flow || 0) + 1); }
    // Waterhealing with no enemy in reach: a shot at the most wounded ally in reach (not itself); its splash heals
    function healShot(b) {
      let tgt = null, most = 1e-9;
      for (const a of sides[b.side]) {
        if (a === b || !a.alive || a.u.structure || a.u.aloft || a.boarded || a.turning || dist(a, b) > R(b) + 0.01) continue;
        if (a.u.hp - a.hp > most) { most = a.u.hp - a.hp; tgt = a; }
      }
      if (!tgt) { b.cd = Math.max(b.cd, -dt); return; }
      b.cd = Math.max(b.cd, -dt) + 1 / Math.max(0.01, apsOf(b));
      flowStep(b);
      fire(b, [tgt], false);
    }
    // Titanium spears: with armor left and an enemy in reach it spends 1 armor and forges (u.spear.forge s), then throws
    // the spear at the nearest enemy in reach (it holds a finished spear until there is one)
    function forgeSpear(b) {
      const sp = b.u.spear;
      if (b.forgeT > 0) { b.forgeT -= dt; if (b.forgeT > 1e-9) return; b.forgeT = 0; b.spearReady = true; }
      if (!b.spearReady && (b.u.defense === 'armor' ? b.u.defVal : 0) + (b.u.bonusArmor || 0) < 1 - 1e-9) return; // no armor left to forge with
      const valid = validTargets(b);
      if (!valid.length) return;
      if (b.spearReady) {
        const tgt = valid[0], dx = tgt.x - b.x, dy = tgt.y - b.y, d = hyp(dx, dy) || 1;
        b.spearReady = false;
        projectiles.push({ owner: b, x: b.x, y: b.y, fx: b.x, fy: b.y, tx: tgt.x, ty: tgt.y, dirX: dx / d, dirY: dy / d, left: d, hit: sp.hit, spear: true, speed: sp.speed, bleed: sp.bleed });
        return;
      }
      b.u = { ...b.u, bonusArmor: (b.u.bonusArmor || 0) - 1 }; // the armor goes into the spear
      b.forgeT = b.forgeFull = sp.forge;
    }

    function step() {
      if (over) return false;
      if (t >= g.timeCap || !aliveCount(A) || !aliveCount(B)) { over = true; return false; }
      shots = [];
      tick++;
      for (let k = 0; k < 2; k++) if (cripple[k] > 0) cripple[k] = Math.max(0, cripple[k] - dt);
      // map tiles under the units (checked before moving, so the tile a unit starts on always counts)
      if (tiles.length) for (const b of all) {
        if (!b.alive || b.u.structure || b.u.aloft) continue;
        for (const tl of tiles) if (b.alive && b.x >= tl.x0 && b.x < tl.x1 && b.y >= tl.y0 && b.y < tl.y1) onTile(b, tl);
      }
      // stealth: hidden until it attacks, and again after STEALTH_BACK s without attacking (roster rules can turn either off)
      for (const b of all) {
        if (!b.alive || !b.u.stealth) continue;
        if (!stealthOn) b.hidden = false;
        else if (!b.hidden && stealthBack && t - b.lastAtk >= STEALTH_BACK - 1e-9) b.hidden = true;
      }
      // a body with a start delay (deployed on a flank) can't move or attack until it runs out
      for (const b of all) if (b.delay > 0) b.delay = Math.max(0, b.delay - dt);
      // home ground (band = { y0, y1, armor, hpPct, on }): extra armor and health while the body stands between
      // y0 and y1 (its own zone); it loses both when it walks out, and gets them back if it returns
      for (const b of all) {
        if (!b.band || !b.alive) continue;
        const inside = b.y >= b.band.y0 && b.y <= b.band.y1;
        if (inside === b.band.on) continue;
        const k = 1 + b.band.hpPct / 100, sign = inside ? 1 : -1;
        b.band.on = inside;
        b.u = { ...b.u, hp: inside ? b.u.hp * k : b.u.hp / k, bonusArmor: (b.u.bonusArmor || 0) + sign * b.band.armor };
        b.hp = inside ? b.hp * k : b.hp / k;
      }
      // aware2: who is walking to and shooting at whom, from the last tick's choices
      if (g.aware2) {
        for (const f of all) { f.claimsM = 0; f.claimsR = 0; f.claimDmg = 0; }
        for (const b of all) {
          if (!b.alive) continue;
          if (b.goal && b.goal.alive) { if (R(b) <= AWARE.melee) b.goal.claimsM++; else b.goal.claimsR++; }
          if (b.lock && b.lock.alive) b.lock.claimDmg += b.u.hit;
        }
      }
      // Fair turns: the side whose bodies go first alternates every tick (side 0 on odd ticks, side 1 on even ones), so
      // neither player wins a tie just by being processed first (the host used to: its rams, charges, stuns and slows
      // always landed before the guest's). See tools/tests/fairness.js.
      const first = tick % 2 ? 0 : 1;
      const turnOrder = () => sides[first].concat(sides[1 - first]);
      // movement + targeting, both sides from where everyone stood when the tick began: the side that goes second sees
      // the first side's bodies where they were (their steps are put back on after), so nobody reacts to where the
      // other side has only just stepped (an archer stopping a step early, a sniper setting up first)
      const order = turnOrder(), nFirst = sides[first].length;
      let stepsOut = false;
      for (const a of sides[first]) { a.mvX = a.x; a.mvY = a.y; }
      for (let i = 0; i < order.length; i++) {
        if (i === nFirst) { stepsOut = true; for (const a of sides[first]) { const x = a.x, y = a.y; a.x = a.mvX; a.y = a.mvY; a.mvX = x - a.mvX; a.mvY = y - a.mvY; } }
        const b = order[i];
        if (!b.alive || b.delay > 0) continue;
        b.dashing = false;
        if (b.u.roar && !b.roared) roar(b); // Berserkers roar as they start
        if (b.inside) { // Overwatch: it stays in its building while that stands, and while it sees enemies now and then
          if (b.inside.alive && !watchIdle(b)) { b.x = b.inside.x; b.y = b.inside.y; continue; }
          b.inside = null;
        }
        if (b.stunT > 0) { b.stunT = Math.max(0, b.stunT - dt); continue; } // stunned: can't move (or attack, below)
        if (b.channel) continue; // summoning through its portal: it holds still (and doesn't attack, below)
        if (b.rootedBy && b.rootedBy.alive && b.rootedBy.rootTgt === b) continue; // dragged by roots: it can't walk (it still attacks)
        if (b.u.lone > 0) { // Shadow hunter: hunting while there are lone enemies; none for u.lone s and it gives up until its next lone kill
          if (b.hunt == null) { b.hunt = true; b.huntT = 0; }
          if (b.hunt) {
            let any = false;
            for (const f of sides[1 - b.side]) if (f.alive && !f.hidden && !sheltered(f) && isLone(f)) { any = true; break; }
            b.huntT = any ? 0 : b.huntT + dt;
            if (b.huntT >= b.u.lone - 1e-9) b.hunt = false;
          }
        }
        // b.intent: the enemy body it is walking to (its movement target), set below each tick; null while it marches
        // ahead, holds its ground or doesn't walk. Not the same as b.lock, the enemy it attacks (see locked): a body can
        // shoot one enemy while it walks to another. Kept through a stun, roots and a charge's run-through.
        const was = b.intent;
        b.intent = null;
        if (b.holdT > 0) { b.holdT -= dt; continue; } // holding its ground (it still shoots)
        const foes = sides[1 - b.side];
        if (b.trampleLeft > 0) {
          b.intent = was && was.alive ? was : null;
          // running through after a charge: straight on, hitting each body it runs over once
          // a Bullhead charge runs at twice its speed, hits for bull.hit and knocks each body it hits back along its path
          const mv = Math.min(b.trampleLeft, spd(b) * (b.charging ? 2 : b.u.trampleSpeed > 0 ? b.u.trampleSpeed : 1) * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * (cripple[b.side] > 0 ? 1 - towerDown.move / 100 : 1) * dt);
          const [ux, uy] = b.trampleDir;
          b.x += ux * mv; b.y += uy * mv; b.hx = ux; b.hy = uy;
          if (g.bounds) { b.x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, b.x)); b.y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, b.y)); }
          b.trampleLeft -= mv;
          const tHit = b.charging ? b.u.bull.hit : b.u.hit * b.u.trample / 100;
          for (const f of foes) {
            if (!f.alive || sheltered(f) || b.trampled.includes(f) || hyp(f.x - b.x, f.y - b.y) > TRAMPLE_WIDTH) continue;
            b.trampled.push(f);
            if (opts.record) shots.push([b.x, b.y, f.x, f.y, b.side, 1, 1, 0, 0]);
            hurt(b, f, tHit, b.x, b.y);
            if (b.charging && knockOn && f.alive && !f.u.structure && !f.u.anchored && !f.u.barrier && !f.u.unstoppable) {
              f.x += ux * b.u.bull.push; f.y += uy * b.u.bull.push;
              if (g.bounds) { f.x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, f.x)); f.y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, f.y)); }
            }
          }
          if (b.trampleLeft <= 1e-9) { b.trampleLeft = 0; b.trampled = null; if (b.charging) b.charging = false; else if (b.u.chargeStun > 0) b.stunT = b.u.chargeStun; }
          continue;
        }
        if (b.u.idle) continue; // a building
        if (b.orbit) { orbitMove(b); continue; }
        if (b.u.bot) { botMove(b); continue; }
        if (b.siteJob && siteWork(b)) continue;
        if (b.u.ram) { ram(b, foes); continue; }
        if (b.u.roll > 0) { roll(b, foes); continue; }
        if (b.follow) { escortMove(b); continue; }
        if (b.spreadTo) { // Spread: run out to its own spot first
          const sx = b.spreadTo.x - b.x, sy = b.spreadTo.y - b.y, sd = hyp(sx, sy);
          const mv = Math.min(sd, spd(b) * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * dt);
          if (sd > 1e-6) { b.hx = sx / sd; b.hy = sy / sd; b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv; }
          // allies pushing it away (separation) can keep it from ever reaching a spot near the middle of the squad:
          // it gives up after the time the run should take plus a second, and charges from where it is
          if (b.spreadT == null) b.spreadT = 1 + sd / Math.max(0.5, b.u.speed);
          b.spreadT -= dt;
          if (sd - mv <= 0.05 || b.spreadT <= 0) { b.spreadTo = null; b.spreadT = null; }
          continue;
        }
        let near = null, nd = Infinity;
        for (const f of foes) {
          if (!pickable(b, f)) continue;
          const d = gap(f, b);
          if (d < nd) { nd = d; near = f; }
        }
        b.near = near;
        if (b.u.flee > 0 && near && nd < b.u.flee) { // keeping away from the enemy
          const mv = spd(b) * moveMul(b) * dt;
          b.hx = -(near.x - b.x) / (nd || 1); b.hy = -(near.y - b.y) / (nd || 1);
          b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
          if (g.bounds) { b.x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, b.x)); b.y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, b.y)); }
          continue;
        }
        if (b.u.stay) continue; // keeps its ground: it only ever moves away
        // a builder that hasn't built yet stops to build once an enemy is within its constructs' range (see the builders below)
        if (b.u.build && !b.built) {
          if (b.buildT > 0) continue;
          if (near && nd <= b.u.build.range - 1) {
            b.buildT = b.buildFull = Math.max(dt, b.u.build.time || 0);
            b.buildDir = nd > 1e-6 ? [(near.x - b.x) / nd, (near.y - b.y) / nd] : [0, b.side === 0 ? 1 : -1];
            continue;
          }
        }
        const rg = b.u.hover > 0 ? Math.min(R(b), b.u.hover) : R(b); // hover: an airship flies in closer than its range
        // an arrow drawn by the player (Factions devtest): b.guide = [{ x, y }, ...]. The body walks the points in turn,
        // standing to fight only enemies already in its own range, then fights as usual from the last point on.
        if (b.guide && b.guide.length) {
          const p = b.guide[0], gx = p.x - b.x, gy = p.y - b.y, gd = hyp(gx, gy);
          if (gd < 1.5) { b.guide.shift(); if (!b.guide.length) b.guide = null; continue; }
          if (near && nd <= reachOf(b)) continue; // something in reach: stand and fight it
          const step = spd(b) * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * (cripple[b.side] > 0 ? 1 - towerDown.move / 100 : 1) * dt;
          if (b.hx === undefined) { b.hx = gx / gd; b.hy = gy / gd; }
          const k = Math.min(1, TURN * dt);
          let hx = b.hx + (gx / gd - b.hx) * k, hy = b.hy + (gy / gd - b.hy) * k, hl = hyp(hx, hy);
          if (hl < 1e-6) { hx = gx / gd; hy = gy / gd; hl = 1; }
          b.hx = hx / hl; b.hy = hy / hl;
          const mv = Math.min(step, gd);
          b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
          if (b.u.windUp > 0 && mv > 0) { b.setUp = false; if (b.windTarget) { b.windTarget = null; stats[b.side].windLost++; } }
          continue;
        }
        if (g.aware2 && b.engaged && near) { const gl = goalOf(b, rg); if (gl) { near = gl; nd = gap(gl, b); } }
        if (b.avenge) { if (b.avenge.alive && !b.avenge.hidden) { near = b.avenge; nd = gap(near, b); } else b.avenge = null; } // a guard going for its attacker
        // its movement target: whom it goes for once engaged (or a guard's attacker), or whom it stands at in reach
        if (near && (b.engaged || b.avenge || nd <= (g.stopPct > 0 && g.stopPct < 1 && b.engaged ? stopAt(rg) : rg))) b.intent = near;
        if (near && nd > (g.stopPct > 0 && g.stopPct < 1 && b.engaged ? stopAt(rg) : rg)) {
          b.dashing = b.u.dash > 0 && b.engaged && nd <= b.u.dash; // dash: the last metres to its target in a flash
          const step = (b.dashing ? Math.max(DASH_SPEED, spd(b)) : spd(b)) * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * (cripple[b.side] > 0 ? 1 - towerDown.move / 100 : 1) * dt;
          let mv;
          // March straight ahead until an enemy comes within sight (range + SIGHT, at least MIN_SIGHT, in any
          // direction), or no enemy is left ahead, then lock on: from then on the body goes for its own nearest
          // enemy for the rest of the fight. Each body decides for itself, so a squad can split up when its bodies spot different
          // enemies. A squad meets what stands in its own lane, an empty lane lets it walk around the side,
          // and nobody flips back and forth between marching and chasing.
          // "Ahead" is toward the enemy's end of the board, or b.march = [x, y] (a squad on a flank marches in from the side).
          const fwd = b.side === 0 ? 1 : -1, [mx, my] = b.march || [0, fwd];
          const aware = Math.max(rg + sight, minSight);
          if (!b.engaged) {
            let spotted = nd <= aware;
            if (!spotted) { // nothing left ahead to march toward: go for the nearest
              spotted = true;
              for (const f of foes) if (pickable(b, f) && (f.x - b.x) * mx + (f.y - b.y) * my > 0) { spotted = false; break; }
            }
            if (spotted) { b.engaged = true; b.intent = near; }
          }
          // where it wants to go: straight ahead, or at the nearest enemy
          let wx = mx, wy = my;
          const nr = dist(near, b) || 1; // the direction to it (nd is to its edge for a wall)
          if (b.engaged) { wx = (near.x - b.x) / nr; wy = (near.y - b.y) / nr; }
          else if (drift > 0 && nd < aware + drift && (near.x - b.x) * mx + (near.y - b.y) * my > 0) {
            // within DRIFT of its sight: lean toward the nearest enemy ahead, harder the closer it gets, so it
            // curves in on a diagonal instead of marching level with the enemy and then turning sharply
            const w = (aware + drift - nd) / drift;
            wx = mx * (1 - w) + (near.x - b.x) / nr * w; wy = my * (1 - w) + (near.y - b.y) / nr * w;
          }
          // turn smoothly instead of snapping: the heading swings toward the wanted direction
          if (b.hx === undefined) { b.hx = mx; b.hy = my; }
          const k = Math.min(1, TURN * dt);
          let hx = b.hx + (wx - b.hx) * k, hy = b.hy + (wy - b.hy) * k, hl = hyp(hx, hy);
          if (hl < 1e-6) { hx = wx; hy = wy; hl = 1; }
          b.hx = hx / hl; b.hy = hy / hl;
          // walk a little inside max range, so being nudged by allies doesn't leave the unit just out of reach
          mv = b.engaged ? Math.min(step, nd - stopAt(rg)) : step;
          b.x += b.hx * mv;
          b.y += b.hy * mv;
          b.moved += mv;
          // a unit with wind-up has to set up again after it moves; a charge in progress is lost
          if (b.u.windUp > 0 && mv > 0) {
            b.setUp = false;
            if (b.windTarget) { b.windTarget = null; stats[b.side].windLost++; }
          }
        }
      }
      if (stepsOut) for (const a of sides[first]) { a.x += a.mvX; a.y += a.mvY; } // the first side's steps (on top of any knockback since)
      for (const b of rammed) if (b.alive) { b.hp = 0; b.alive = false; b.diedTick = tick; fell(b); } // rams that hit fall
      rammed.length = 0;
      // Flow state: a body that walked since its last attack has lost its stacks
      for (const b of all) if (b.flow > 0 && b.moved > 1e-6) b.flow = 0;
      // auras (Reforge): other units of the side near one get its bonus to every hit and to attack speed this tick
      const auraNow = all.some(b => b.alive && b.u.aura);
      if (auraNow || auraWas) { // the last one gone: its bonus goes too
        auraWas = auraNow;
        for (const a of all) { a.auraHit = 0; a.auraAps = 0; }
        for (const src of all) {
          if (!src.alive || !src.u.aura) continue;
          const au = src.u.aura;
          for (const a of sides[src.side]) if (a !== src && a.alive && !a.u.structure && dist(a, src) <= au.radius) { a.auraHit = Math.max(a.auraHit, au.hit); a.auraAps = Math.max(a.auraAps, au.aps); }
        }
      }
      // builders at work: each builder building within BUILD_COOP of others speeds them up (1x, 1.5x, 1.75x, ...)
      const builders = all.filter(b => b.alive && b.buildT > 0);
      if (builders.length) {
        const rate = builders.map(b => {
          let mul = 1, add = 0.5;
          for (const c of builders) if (c !== b && c.side === b.side && dist(c, b) <= BUILD_COOP) { mul += add; add *= 0.5; }
          return mul;
        });
        builders.forEach((b, k) => { b.buildT -= dt * rate[k]; if (b.buildT <= 1e-9) finishBuild(b); });
      }
      // ...and at building sites (a site without a builder builds itself, slowly, if it can)
      const manned = new Set();
      for (const b of all) {
        if (!b.alive || !b.siteJob) continue;
        manned.add(b.siteJob);
        if (!b.siteAt) continue;
        const s = b.siteJob.site;
        s.work = Math.min(s.need, s.work + dt * (b.u.buildSpeed || 1));
        if (s.work >= s.need) { b.siteJob = null; b.siteAt = false; }
      }
      for (const b of all) if (b.alive && b.site && b.site.self > 0 && b.site.work < b.site.need && !manned.has(b)) b.site.work = Math.min(b.site.need, b.site.work + dt * b.site.self);
      // repairbots at work (one builder each)
      for (const b of all) {
        const v = b.repairing;
        if (!b.alive || !v || !needsRepair(v)) continue;
        if (v.site && v.site.work < v.site.need) v.site.work = Math.min(v.site.need, v.site.work + dt);
        else v.hp = Math.min(v.u.hp, v.hp + v.u.hp / (v.u.buildSecs > 0 ? v.u.buildSecs : REPAIR_SECS) * dt);
        b.healFx = (b.healFx || 0) - dt;
        if (b.healFx <= 0) { b.healFx = 1; if (opts.record) shots.push([b.x, b.y, v.x, v.y, b.side, 0, 0, 1]); }
      }
      // mines: an enemy body close by sets one off
      for (let i = mines.length - 1; i >= 0; i--) {
        const mn = mines[i];
        let hitBy = null;
        for (const f of sides[1 - mn.side]) if (f.alive && !f.u.aloft && hyp(f.x - mn.x, f.y - mn.y) <= MINE_TRIGGER) { hitBy = f; break; }
        if (!hitBy) continue;
        mines.splice(i, 1);
        if (opts.record) shots.push([mn.x, mn.y, mn.x, mn.y, mn.side, mn.radius, 1, 0, 0]);
        for (const f of sides[1 - mn.side]) if (f.alive && hyp(f.x - mn.x, f.y - mn.y) <= mn.radius) hurt(mn.owner, f, mn.hit, mn.x, mn.y);
      }
      // separation between allies
      const minSep = g.spacing * 0.7;
      for (let s = 0; s < 2; s++) {
        const arr = sides[s];
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i]; if (!a.alive || a.u.aloft || sheltered(a)) continue;
          for (let j = i + 1; j < arr.length; j++) {
            const c = arr[j]; if (!c.alive || c.u.aloft || sheltered(c)) continue;
            if (a.u.barrier > 0 || c.u.barrier > 0) continue; // a side's own units walk through its walls
            const dx = c.x - a.x, dy = c.y - a.y;
            const d = hyp(dx, dy);
            // structures and bodies still waiting to start (flank squads) don't budge: the other body moves the whole way
            const fa = a.u.structure || a.u.anchored || a.delay > 0, fc = c.u.structure || c.u.anchored || c.delay > 0;
            if (fa && fc) continue;
            const ka = fa ? 0 : fc ? 2 : 1, kc = fc ? 0 : fa ? 2 : 1;
            if (d < minSep && (a.u.structure || c.u.structure)) {
              // a body walking into its own tower slides around it instead of being pushed straight back (it got
              // stuck behind it): out to minSep, then sideways by as much as it had walked in, toward where it heads
              // (with no lean either way, toward the middle of the board)
              const s = a.u.structure ? a : c, w = s === a ? c : a;
              let rx = w.x - s.x, ry = w.y - s.y, rl = d;
              if (rl < 1e-9) { rx = s.x > 0 ? -1 : 1; ry = 0; rl = 1; }
              rx /= rl; ry /= rl;
              let tx = -ry, ty = rx;
              const lean = tx * (w.hx || 0) + ty * (w.hy || 0);
              if (lean < 0 || (lean < 1e-6 && tx * (s.x > 0 ? -1 : 1) < 0)) { tx = -tx; ty = -ty; }
              const slide = minSep - (d < 1e-9 ? 0 : d);
              w.x = s.x + rx * minSep + tx * slide; w.y = s.y + ry * minSep + ty * slide;
            } else if (d > 0 && d < minSep) {
              const push = (minSep - d) / 2;
              a.x -= dx / d * push * ka; a.y -= dy / d * push * ka;
              c.x += dx / d * push * kc; c.y += dy / d * push * kc;
            } else if (d === 0) {
              a.x -= minSep / 2 * ka; c.x += minSep / 2 * kc;
            }
          }
        }
      }
      // walls: an enemy body that walked into one is put back out at its nearest edge
      for (const w of barriers) {
        if (!w.alive) continue;
        const h = halfX(w), hy = halfY(w);
        for (const f of sides[1 - w.side]) {
          if (!f.alive || f.u.aloft || f.u.structure) continue;
          const dx = f.x - w.x, dy = f.y - w.y;
          if (Math.abs(dx) >= h || Math.abs(dy) >= hy) continue;
          if (h - Math.abs(dx) < hy - Math.abs(dy)) f.x = w.x + (dx < 0 ? -h : h);
          else f.y = w.y + (dy < 0 ? -hy : hy);
        }
      }
      for (const s of strikes) {
        if (s.done || t + 1e-9 < s.t) continue;
        s.done = true;
        if (opts.record) shots.push([s.x, s.y, s.x, s.y, s.side, s.r, 1, 0, 0]);
        for (const f of sides[1 - s.side]) {
          if (!f.alive || f.u.aloft || hyp(f.x - s.x, f.y - s.y) > s.r) continue;
          const dmg = damageAfterDefense(s.dmg, f, g);
          stats[s.side].dealt += Math.min(dmg, f.hp);
          neutralDamage(f, dmg);
        }
      }
      // pools: enemies standing in one take its damage, allies heal and speed up (one pool at a time each)
      if (pools.length) {
        const done = new Set();
        for (const q of pools) for (const f of all) {
          if (!f.alive || f.u.structure || f.u.aloft || done.has(f) || hyp(f.x - q.x, f.y - q.y) > q.r) continue;
          done.add(f);
          if (f.side !== q.side) direct(q.owner, f, q.amt * dt);
          else { heal(f, q.amt * healMul * dt); if (q.speed > 0) { f.poolFast = q.speed; f.poolFastT = q.secs; } }
        }
      }
      // ongoing effects: poison, bleed, regeneration, shortsight wearing off, spawns
      for (const b of turnOrder()) { // (the sides take turns going first here too; bodies spawned below start next tick)
        if (!b.alive) continue;
        if (b.poison && b.poison.length) {
          for (const p of b.poison) {
            if (!b.alive) break;
            if (b.u.slime) heal(b, p.dps * Math.min(dt, p.t)); // slime units drink poison: it heals them
            else if (p.src) direct(p.src, b, p.dps * Math.min(dt, p.t));
            else neutralDamage(b, p.dps * Math.min(dt, p.t)); // poison from a map tile: nobody's damage
            p.t -= dt;
          }
          if (b.poison) b.poison = b.poison.filter(p => p.t > 0); // a body won over by a Gentleman just now lost its poison
          if (!b.alive) continue;
        }
        if (b.bleed) { // every BLEED.pulse s: BLEED.dmg, doubled for each stack after the first, and a share of max health at 4 and 5 stacks
          const bl = b.bleed;
          bl.pulse -= dt;
          if (bl.pulse <= 1e-9) {
            bl.pulse += BLEED.pulse;
            let dmg = BLEED.dmg;
            for (let k = 1; k < bl.n; k++) dmg *= 2;
            if (BLEED.pct[bl.n] > 0 && !b.u.structure) dmg += b.u.hp * BLEED.pct[bl.n] / 100 * BLEED.pulse;
            direct(bl.src, b, dmg);
          }
          bl.t -= dt;
          if (!b.alive) continue;
          if (bl.t <= 1e-9) b.bleed = null;
        }
        if (b.burn) { // once a second a share of what is left to burn (see BURN)
          const bn = b.burn;
          bn.t -= dt;
          if (bn.t <= 1e-9) {
            const part = bn.left * BURN.share[bn.k];
            bn.left -= part; bn.k++; bn.t += BURN.every;
            if (bn.k >= BURN.share.length) b.burn = null;
            direct(bn.src, b, part);
            if (!b.alive) continue;
          }
        }
        if (b.u.roots && !(b.stunT > 0)) rootStep(b);
        if (b.poolFastT > 0) b.poolFastT -= dt;
        // Moat (bastion): every 1/aps s, its hit to every enemy within its reach, like a ring of fire around the tower
        if (b.u.moat) {
          b.moatCd = (b.moatCd == null ? 0 : b.moatCd) - dt;
          if (b.moatCd <= 0) {
            b.moatCd += 1 / b.u.moat.aps;
            let any = false;
            for (const f of sides[1 - b.side]) if (f.alive && hyp(f.x - b.x, f.y - b.y) <= b.u.moat.range) { any = true; hurt(b, f, b.u.moat.hit, b.x, b.y); }
            if (any && opts.record) shots.push([b.x, b.y, b.x + b.u.moat.range, b.y, b.side, 0, 0, 0, 180]);
          }
        }
        if (b.u.regen > 0) heal(b, b.u.hp * b.u.regen / 100 * healMul * dt);
        if (b.produce && !b.produced && !(b.site && b.site.work < b.site.need)) { // a building makes its unit
          b.prodT = (b.prodT == null ? b.produce.time : b.prodT) - dt;
          if (b.prodT <= 1e-9) {
            b.produced = true;
            const list = b.produce.units || [], gap = g.spacing;
            let y = b.y + (b.side === 0 ? 1 : -1) * BUILD_GAP * 0.7;
            if (g.bounds) y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, y));
            list.forEach((pu, k) => {
              let x = b.x + (k - (list.length - 1) / 2) * gap;
              if (g.bounds) x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, x));
              const kid = newBody(pu, b.side, x, y, spawnNo[b.side]++, -1);
              kid.credit = b;
              pendingKids.push(kid);
            });
          }
        }
        if (b.follow && b.healPct > 0) { // a healbot mends the bodies of its squad within reach
          let to = null;
          for (const a of b.follow) if (a.alive && a.hp < a.u.hp && dist(a, b) <= b.u.range + 0.01) { heal(a, a.u.hp * b.healPct / 100 * healMul * dt); to = to || a; }
          b.healFx = (b.healFx || 0) - dt;
          if (to && b.healFx <= 0) { b.healFx = 1; if (opts.record) shots.push([b.x, b.y, to.x, to.y, b.side, 0, 0, 1]); }
        }
        if (b.shrinkT > 0) { b.shrinkT -= dt; if (b.shrinkT <= 0) { b.shrinkT = 0; b.shrinkM = 0; } }
        if (b.frost) { // Frost: a stack every fr.every s while the frost keeps coming, melting fr.keep s after it stops (see u.frost)
          const fr = b.frost;
          if (t - fr.last > fr.keep + 1e-9) b.frost = null;
          else {
            if (t - fr.last <= FROST_ON + 1e-9) {
              fr.build += dt;
              if (fr.build >= fr.every - 1e-9) {
                fr.build -= fr.every;
                if (fr.n < fr.pct.length) fr.n++;
                else if (fr.stun > 0 && !b.u.structure) { // Deepfreeze: frozen solid, and the stacks start over
                  b.stunT = Math.max(b.stunT, fr.stun); b.frozenT = fr.stun; fr.n = 0; fr.build = 0;
                  if (opts.record) shots.push([b.x, b.y, b.x, b.y, 1 - b.side, 0, 0, 0, 0, 1, 0, 0, 0, 2]); // [13] 2: frozen solid
                }
              }
            }
            frostSlow(b);
          }
        }
        if (b.frozenT > 0) b.frozenT = b.stunT > 0 ? Math.min(b.frozenT, b.stunT) : 0; // frozen solid until its stun wears off
        if (b.slowT > 0) { b.slowT -= dt; if (b.slowT <= 0) { b.slowT = 0; b.slowMove = 0; b.slowAtk = 0; } }
        if (b.u.spawn) {
          b.spawnT -= dt;
          if (b.spawnT <= 0 && b.u.spawn.waves > 0 && (b.waves || 0) >= b.u.spawn.waves) b.spawnT = Infinity; // used up its waves
          if (b.spawnT <= 0) {
            b.spawnT += b.u.spawn.every;
            b.waves = (b.waves || 0) + 1;
            b.kids = (b.kids || []).filter(k => k.alive);
            const n = Math.min(b.u.spawn.count, b.u.spawn.max - b.kids.length);
            for (let k = 0; k < n; k++) {
              // spots are relative to the side's forward direction, so both sides spawn in front of the summoner
              const [ox, oy] = SPAWN_SPOTS[(b.kids.length + k) % SPAWN_SPOTS.length], fwd = b.side === 0 ? 1 : -1;
              const kid = newBody(b.u.spawn.unit, b.side, b.x + ox * g.spacing * 0.7, b.y + oy * fwd * g.spacing * 0.7, spawnNo[b.side]++, -1);
              b.kids.push(kid); all.push(kid); sides[b.side].push(kid);
              stats[b.side].totalHp += kid.u.hp;
            }
          }
        }
      }
      // attacks. A body killed earlier in this same tick still gets its attack, so neither side
      // wins a trade just by being processed first (side 0 used to win one-shot duels like Sniper vs Sniper); the sides
      // take turns going first (see first). Likewise a stun or slow that lands during the attacks only counts from the
      // next tick (atkStun, atkSlow: as they were when the attacks began), and heals wait for the end (healLater)
      const attackers = turnOrder();
      for (const b of attackers) { b.atkStun = b.stunT > 0; b.atkSlow = b.slowT > 0 ? b.slowAtk : 0; }
      healLater = [];
      for (const b of attackers) {
        if ((!b.alive && b.diedTick !== tick) || b.delay > 0 || b.u.ram || b.boarded || b.turning) continue;
        if (b.u.roll > 0 || b.follow || b.buildT > 0 || b.siteJob || b.u.idle || b.u.bot) continue; // rollers hit by rolling; healbots, bots and buildings never attack; builders at work don't
        b.cd -= dt * atkMul(b); // slowed units reload slower
        if (b.firing >= 0) b.firing += dt;
        if (b.atkStun || b.channel) continue; // stunned, or summoning
        if (b.flurryLeft > 0) { if (b.alive) flurryStep(b); else b.flurryLeft = 0; continue; } // Death flurry: the rest of its blows
        if (b.u.spear && b.alive) forgeSpear(b); // Titanium spears: forged and thrown apart from its own attack
        if (b.u.storm && b.alive) stormStep(b); // Snow storm: apart from its own attack
        if (b.u.missiles && b.alive) { // Leafblade: a salvo at the start and every missiles.every s
          b.missileT = (b.missileT || 0) - dt;
          if (b.missileT <= 1e-9) { if (salvo(b)) b.missileT = b.u.missiles.every; else b.missileT = 0; }
        }
        if (b.u.mend > 0) { // a healer that never attacks: the most wounded ally in range gets b.u.mend
          if (!b.alive || b.cd > 0) continue;
          let tgt = null, most = 1e-9;
          for (const a of sides[b.side]) {
            if (!a.alive || a.u.structure || a.hp >= a.u.hp || dist(a, b) > R(b) + 0.01) continue;
            if (a.u.hp - a.hp > most) { most = a.u.hp - a.hp; tgt = a; }
          }
          if (!tgt) { b.cd = Math.max(b.cd, -dt); continue; }
          b.cd = Math.max(b.cd, -dt) + 1 / Math.max(0.01, b.u.aps);
          heal(tgt, b.u.mend * healMul);
          if (opts.record) shots.push([b.x, b.y, tgt.x, tgt.y, b.side, 0, 0, 1]);
          continue;
        }
        if (b.u.turrets > 1 && !(b.u.windUp > 0 && !b.setUp)) extraTurrets(b);
        // follow-up shots of a running burst fly along the direction locked at the start
        // and hit the first enemy on that line; if the line is empty the shot misses
        if (b.burstLeft > 0) {
          b.burstTimer -= dt;
          if (b.burstTimer <= 0) {
            const [ux, uy] = b.burstDir;
            let first = null, fa = Infinity;
            for (const f of sides[1 - b.side]) {
              if (!f.alive) continue;
              const rx = f.x - b.x, ry = f.y - b.y;
              const along = rx * ux + ry * uy;
              const across = Math.abs(rx * uy - ry * ux);
              if (along >= b.u.minRange && along <= R(b) + 0.01 && across <= PIERCE_WIDTH && along < fa) { fa = along; first = f; }
            }
            if (first) {
              fire(b, aim(b, first, validTargets(b)), false);
            } else {
              const end = { x: b.x + ux * R(b), y: b.y + uy * R(b) };
              if (b.u.projSpeed > 0) fire(b, [end], false); // the projectile flies on and can still clip someone
              else {
                stats[b.side].missed += b.u.hit * Math.max(1, Math.round(b.u.pellets));
                if (opts.record) shots.push([b.x, b.y, end.x, end.y, b.side, 0, 0]);
              }
            }
            b.burstLeft--; b.burstTimer += BURST_GAP;
          }
        }
        let valid, primary;
        // wind-up: the unit sets up (like a sniper lying down) the first time an enemy is in range.
        // Once set up it fires normally at anything in range. It only sets up again after it has moved.
        if (b.u.windUp > 0 && !b.setUp) {
          if (b.windTarget) {
            b.windT -= dt;
            if (b.windT > 0) continue;
            b.windTarget = null; b.setUp = true;
            b.cd = 0; // reload starts with the first shot
            valid = validTargets(b);
            if (!valid.length) continue;
            primary = locked(b, valid);
          } else {
            if (b.cd > 0) continue;
            valid = validTargets(b);
            if (!valid.length) continue;
            b.windTarget = locked(b, valid); b.windT = b.u.windUp; stats[b.side].winds++;
            continue;
          }
        } else {
          if (b.cd > 0) continue;
          valid = validTargets(b);
          if (!valid.length) { if (b.u.waterHeal) healShot(b); continue; } // Waterhealing: no enemy in reach, so it shoots a wounded ally
          primary = locked(b, valid);
        }
        // spin-up builds while the unit keeps hitting one target: it stays on that target while it can,
        // and the ramp starts over when it has to switch
        if (b.u.spinUp > 0 || b.u.spinHit > 0) {
          if (b.spinTarget && b.spinTarget.alive && valid.includes(b.spinTarget)) primary = b.spinTarget;
          else { b.spinTarget = primary; b.firing = 0; }
        }
        // with extra turrets, the main attack doesn't aim at an enemy another turret is on; with no one else, it waits
        if (b.u.turrets > 1) {
          const taken = turretTaken(b, 0);
          if (taken.includes(primary)) { const alt = valid.find(f => !taken.includes(f)); if (!alt) continue; primary = alt; }
          b.aims[0] = primary;
        }
        if (b.firing < 0) b.firing = 0;
        const spin = b.u.spinUp > 0 ? Math.min(b.u.spinCap > 0 ? b.u.spinCap : SPIN_CAP, 1 + b.u.spinUp / 100 * b.firing) : 1;
        b.spin = spin;
        // reload doesn't stack up while the unit has nothing to shoot: keep at most one step of carry-over
        b.cd = Math.max(b.cd, -dt) + 1 / Math.max(0.01, apsOf(b) * spin);
        let n = Math.max(1, Math.round(b.u.burst));
        if (b.u.double > 1 && (b.atkN = (b.atkN || 0) + 1) % b.u.double === 0) n++; // Double strike: every n-th attack strikes once more
        if (b.u.flare) n += Math.floor(Math.min(b.u.flare.max, b.u.flare.per * (t - b.lastAtk)) / b.u.flare.shot + 1e-9); // Flare: what it stored while it waited
        b.quiet = !!(b.u.silent && !b.silentUsed); // Silent blade: its first attack keeps it hidden
        if (b.quiet) b.silentUsed = true;
        flowStep(b);
        if (n > 1) {
          const dx = primary.x - b.x, dy = primary.y - b.y, d = hyp(dx, dy) || 1;
          b.burstLeft = n - 1; b.burstTimer = BURST_GAP; b.burstDir = [dx / d, dy / d];
          b.cd = Math.max(b.cd, (n - 1) * BURST_GAP + dt); // the next attack waits for the burst to finish
        }
        fire(b, aim(b, primary, valid), true);
        if (b.u.flurry && b.alive && b.u.flurry.hits > 1) { b.flurryLeft = b.u.flurry.hits - 1; b.flurryT = b.u.flurry.gap; b.flurryTgt = primary; }
        if (b.u.bull && b.alive) { // Bullhead: its 1st, (every+1)th, ... attack sends it charging through its target
          b.bullN = (b.bullN || 0) + 1;
          const dx = primary.x - b.x, dy = primary.y - b.y, d = hyp(dx, dy);
          if ((b.bullN - 1) % b.u.bull.every === 0 && !(b.trampleLeft > 0) && d > 1e-6 && !primary.u.structure) {
            b.trampleDir = [dx / d, dy / d]; b.trampleLeft = d + b.u.bull.run; b.trampled = []; b.charging = true;
          }
        }
      }
      // neutral towers: each shot goes at the nearest unit in range of the side whose turn it is,
      // or of the other side if that one has nobody in range, so both sides are shot at equally
      for (const n of neutrals) {
        // heals for the sides it is friends with: the nearest wounded unit in range, and its allies around it
        if (n.u.healAps > 0 && (n.friends[0] || n.friends[1])) {
          n.healCd -= dt;
          if (n.healCd <= 0) {
            let tgt = null;
            for (let k = 0; k < 2 && !tgt; k++) {
              const sd = (n.healTurn + k) % 2;
              if (!n.friends[sd]) continue;
              let bd = n.u.range + 0.01;
              for (const f of sides[sd]) {
                if (!f.alive || f.u.structure || f.hp >= f.u.hp) continue;
                const d = hyp(f.x - n.x, f.y - n.y);
                if (d <= bd) { bd = d; tgt = f; }
              }
            }
            if (!tgt) n.healCd = Math.max(n.healCd, -dt);
            else {
              n.healTurn = 1 - tgt.side;
              n.healCd = Math.max(n.healCd, -dt) + 1 / n.u.healAps;
              const amt = n.u.healHit * healMul;
              for (const f of sides[tgt.side]) if (f.alive && !f.u.structure && hyp(f.x - tgt.x, f.y - tgt.y) <= n.u.healSplash) heal(f, amt);
              if (opts.record) shots.push([n.x, n.y, tgt.x, tgt.y, n.side != null ? n.side : 2, n.u.healSplash, n.u.strong ? 1 : 0, 1]);
            }
          }
        }
        if (n.friends[0] && n.friends[1]) continue; // friends with both: it shoots nobody
        n.cd -= dt;
        if (n.cd > 0) continue;
        let tgt = null;
        for (let k = 0; k < 2 && !tgt; k++) {
          if (n.friends[(n.turn + k) % 2]) continue;
          let bd = n.u.range + 0.01;
          for (const f of sides[(n.turn + k) % 2]) {
            if (!f.alive || f.hidden || sheltered(f) || f.u.structure) continue;
            const d = hyp(f.x - n.x, f.y - n.y);
            if (d <= bd) { bd = d; tgt = f; }
          }
        }
        if (!tgt) { n.cd = Math.max(n.cd, -dt); continue; }
        n.turn = 1 - tgt.side;
        n.cd = Math.max(n.cd, -dt) + 1 / Math.max(0.01, n.u.aps);
        if (opts.record) shots.push([n.x, n.y, tgt.x, tgt.y, n.side != null ? n.side : 2, 0, n.u.strong ? 1 : 0, 0, 0]);
        if (tgt.shield > 0) { tgt.shield--; continue; }
        neutralDamage(tgt, damageAfterDefense(n.u.hit, tgt, g));
      }
      // projectiles in flight
      if (projectiles.length) {
        // direct fire: a projectile hits the first enemy body it flies into;
        // if it reaches its aim point without touching anyone, it lands there (and may miss)
        const next = [];
        for (const p of projectiles) {
          const foes = sides[1 - p.owner.side];
          let mv = (p.speed || p.owner.u.projSpeed) * dt, done = false;
          const land = () => p.spear ? spearLand(p) : p.homing ? homingLand(p) : impact(p.owner, p.x, p.y, null, p.hit, p.dirX, p.dirY, p.fx, p.fy);
          if (p.homing && p.homing.alive) { // a bounce or a missile follows its target
            const dx = p.homing.x - p.x, dy = p.homing.y - p.y, d = hyp(dx, dy);
            if (d > 1e-6) { p.dirX = dx / d; p.dirY = dy / d; p.left = d; p.tx = p.homing.x; p.ty = p.homing.y; }
          }
          while (mv > 0 && !done) {
            const sub = Math.min(0.5, mv, p.left);
            p.x += p.dirX * sub; p.y += p.dirY * sub; p.left -= sub; mv -= sub;
            if ((!p.owner.u.lob || p.spear) && !p.homing) for (const f of foes) { // a bounce or a missile only lands on what it follows
              if (f.alive && hyp(f.x - p.x, f.y - p.y) <= PROJ_HIT_RADIUS) {
                land();
                done = true; break;
              }
            }
            if (!done && p.left <= 1e-6) {
              land();
              done = true;
            }
          }
          if (!done) next.push(p);
        }
        projectiles = next;
      }
      healsLand(); // the heals of the attacks and shots above
      // bodies won over by a Gentleman switch sides; they start fresh (no target, no burst, no effects from before)
      for (const v of turning) {
        const from = sides[v.side];
        from.splice(from.indexOf(v), 1);
        v.convert = { side: v.side, squad: v.squad, xp: v.xp, dealt: v.dealt || 0 }; // what it earned for its old squad
        v.side = 1 - v.side; v.squad = CONVERT_SQUAD; v.xp = 0; v.dealt = 0; v.turning = false;
        v.windTarget = null; v.windT = 0; v.setUp = false; v.firing = -1; v.burstLeft = 0; v.trampleLeft = 0; v.trampled = null;
        v.spinTarget = null; v.aims = null; v.lock = null; v.intent = null; v.march = null; v.guide = null; v.goal = null; v.spreadTo = null; v.engaged = false; v.holdT = 0; v.avenge = null; v.delay = 0; v.band = null; v.hidden = false;
        v.slowT = 0; v.slowMove = 0; v.slowAtk = 0; v.shrinkT = 0; v.shrinkM = 0; v.kids = null; v.stunT = 0; v.frenzy = 0; v.flow = 0; v.knives = null; v.atkN = 0; v.forgeT = 0; v.spearReady = false;
        v.burn = null; v.kills = 0; v.flurryLeft = 0; v.flurryTgt = null; v.rootTgt = null; v.rootedBy = null; v.hunt = null; v.bullN = 0; v.charging = false; v.inside = null; v.missileT = 0; v.roarSpd = 0; v.roarAtk = 0; v.frost = null; v.frozenT = 0; v.beamAims = null; v.stormCd = 0; v.aimedAt = 0; v.wwDodges = 0; v.watchT = 0;
        sides[v.side].push(v); stats[v.side].totalHp += v.hp;
        for (const b of all) {
          if (b.windTarget === v) { b.windTarget = null; b.windT = 0; }
          if (b.spinTarget === v) b.spinTarget = null;
        }
      }
      turning.length = 0;
      // a portal's summoning is done: the squad's bodies still standing are sacrificed and its unit walks out
      for (const pt of portals) {
        if (pt.done || t < pt.t0 + pt.secs - 1e-9) continue;
        pt.done = true;
        const live = pt.grp.filter(x => x.alive);
        for (const x of pt.grp) x.channel = false;
        if (!live.length) continue; // the whole squad fell first: nothing comes out
        for (const x of live) { x.hp = 0; x.alive = false; x.diedTick = tick; x.sacrificed = true; }
        pendingKids.push(pt.hf);
      }
      // bodies spawned by deaths this tick join the fight
      for (const kid of pendingKids) { all.push(kid); sides[kid.side].push(kid); if (counts(kid)) stats[kid.side].totalHp += kid.u.hp; }
      pendingKids.length = 0;
      // a linked squad shares its health: whatever healed one of its bodies is shared by all
      for (const grp of groups) {
        if (!grp[0].link) continue;
        let s = 0, mx = 0;
        for (const x of grp) if (x.alive) { s += x.hp; mx += x.u.hp; }
        if (mx > 0) for (const x of grp) if (x.alive) x.hp = x.u.hp * s / mx;
      }
      for (const sd of downNow) cripple[sd] = towerDown.secs;
      downNow.length = 0;
      t += dt;
      return true;
    }

    function frame(final) {
      return {
        t, shots: final ? [] : shots,
        p: final ? [] : projectiles.map(p => [p.x, p.y, p.owner.side]),
        b: all.map(x => [x.x, x.y, x.alive ? x.hp / x.u.hp : 0, x.side, x.windTarget && x.u.windUp > 0 ? 1 - x.windT / x.u.windUp : 0, x.hidden ? 1 : 0, x.poison && x.poison.length ? 1 : 0, x.slowT > 0 && x.slowMove > 0 ? 1 : 0, x.stunT > 0 ? 1 : 0, x.bleed ? x.bleed.n : 0, x.frost ? x.frost.n : 0]),
      };
    }

    function result() {
      const inside = (b) => b.boarded && b.carrier && b.carrier.alive; // still riding in a carrier that made it
      const remHp = sides.map(arr => arr.reduce((s, b) => s + ((b.alive || inside(b)) && counts(b) ? b.hp : 0), 0));
      const frac = [remHp[0] / stats[0].totalHp, remHp[1] / stats[1].totalHp];
      const aliveA = aliveCount(A), aliveB = aliveCount(B);
      let winner = -1, timeout = false;
      if (aliveA && !aliveB) winner = 0;
      else if (aliveB && !aliveA) winner = 1;
      else if (aliveA && aliveB) { timeout = true; winner = frac[0] > frac[1] ? 0 : frac[1] > frac[0] ? 1 : -1; }
      // survivors per squad: { squadId: { side, total, alive } }
      const squads = {};
      for (const b of all) {
        if (b.credit) { // a construct: its XP and damage go to the squad that built (or brought) it
          const o = b.credit.convert || b.credit, k = o.side + ':' + o.squad;
          const s = squads[k] || (squads[k] = { side: o.side, squad: o.squad, total: 0, alive: 0, xp: 0, dealt: 0 });
          s.xp += b.xp; s.dealt += b.dealt || 0;
          continue;
        }
        if (b.convert) { // a body won over still counts, as lost, for the squad it came from
          const k = b.convert.side + ':' + b.convert.squad;
          const s = squads[k] || (squads[k] = { side: b.convert.side, squad: b.convert.squad, total: 0, alive: 0, xp: 0, dealt: 0 });
          s.total++; s.xp += b.convert.xp; s.dealt += b.convert.dealt;
        }
        const k = b.side + ':' + b.squad;
        const s = squads[k] || (squads[k] = { side: b.side, squad: b.squad, total: 0, alive: 0, xp: 0, dealt: 0 });
        s.total++; if (b.alive || inside(b)) s.alive++;
        s.xp += b.xp; s.dealt += b.dealt || 0;
        if (b.glutGain > 0) s.glut = Math.max(s.glut || 0, b.glutGain); // Glut stacks eaten this fight (see u.glut)
      }
      return {
        winner, timeout, time: t, frac,
        score: frac[0] - frac[1],
        survivors: [aliveA, aliveB], counts: [A.length, B.length],
        stats, squads, markKill: markKill.slice(),
        charm, // charisma stacks after the fight, by side and squad id (null for a side without)
        converted: [0, 1].map(k => all.filter(b => b.convert && b.side === k).length), // bodies each side won over
        // each building: still standing, seconds of building done at the end (null when it was already built), whether any was done this fight
        buildings: all.filter(b => b.u.building).map(b => ({ side: b.side, squad: b.squad, alive: b.alive, work: b.site ? b.site.work : null, worked: !!(b.site && b.site.work > b.site.start) })),
      };
    }

    return { step, frame, result, bodies: all, neutrals, mines: () => mines, pools: () => pools, portals: () => portals.filter(p => t >= p.t0 && t < p.t0 + p.secs), isOver: () => over, time: () => t, lastShots: () => shots, projectiles: () => projectiles, crippled: (side) => cripple[side], charm: (side, squad) => (charm[side] && charm[side][squad]) || 0 };
  }

  function matrix(units, g) {
    const n = units.length;
    const m = [];
    for (let i = 0; i < n; i++) {
      m.push([]);
      for (let j = 0; j < n; j++) {
        if (i === j) { m[i].push(null); continue; }
        if (j < i && m[j][i]) {
          const r = m[j][i];
          m[i].push({ ...r, score: -r.score, winner: r.winner === -1 ? -1 : 1 - r.winner, frac: [r.frac[1], r.frac[0]], mirrored: true });
        } else {
          m[i].push(battle(units[i], units[j], g));
        }
      }
    }
    return m;
  }

  return { DASH_SPEED, LONE_R, WATCH_IDLE, BURN, FROST_ON, EAT_R, glutUnit, TOWER_DOWN, RULES, ruleOn, STEALTH_BACK, SKILL_SLOTS, SLOTS, SKILL_TYPES, skillParam, describeSkill, applySkills, innateUnit, fairBudget, battle, makeArmy, matrix, createBattle, buildSquad, rawStrength, squadsFor, withTraits, leveled, TRAIT_DEFAULTS, SPIN_CAP, CHARGE_RUN, TRAMPLE_RUN, BLAST_RADIUS, BLEED, POISON_HEAL, RAM_REACH, ROLL_START, ROLL_PAST, BUILD_GAP, BUILD_COOP, SITE_REACH, MINE_TRIGGER, REPAIR_SECS, LEVEL_BONUS, levelHpK, MAX_LEVEL, CHARM_MAX, CONVERT_HP, CONVERT_SQUAD };
})();
if (typeof module !== 'undefined') module.exports = Engine;
