// ===== Battle engine (shared by headless tests and the page) =====
const Engine = (() => {
  const TRAIT_DEFAULTS = { burst: 1, pellets: 1, spinUp: 0, spinHit: 0, pierce: 0, projSpeed: 0, minRange: 0, charge: 1, knockback: 0, windUp: 0, flame: 0, trample: 0, chargeStun: 0, deathBlast: 0, pctHit: 0, ram: 0, noFlank: 0, carrier: 0, noPack: 0, roll: 0 };
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
  // chargeStun: after a charged hit (and the trample run that follows it) the unit is stunned this many seconds:
  // it can't move or attack
  const STEALTH_BACK = 1.5;    // a stealth unit hides again after this many seconds without attacking
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
  // link: the bodies of a squad share one health pool. Damage to any of them is split across all that are alive
  // (by max health), healing is shared the same way, and they all fall together when the pool runs out. Bodies with a
  // linked squad can't be won over by a Gentleman.
  // escort = { unit, pct }: at the start of a fight a construct (the healbot) stands behind each squad, follows it,
  // never attacks, and heals every body of its squad within unit.range by pct % of its max health a second.
  // chain = { jumps, hit, reach }: after each hit the attack jumps on to the nearest enemy body not hit yet within
  // reach metres of the last one, up to jumps times, dealing chain.hit each time (lightning).
  // mend: the body never attacks; each attack heals the most wounded ally in range (not structures) by this much
  // pctHit: every hit also deals this share of the target's max health (not to structures); that part ignores armor (ward still caps the hit)
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

  const LEVEL_BONUS = 1;       // each upgrade adds +100% of starting health and hit (2x, then 3x)
  const MAX_LEVEL = 2;         // two upgrades on top of the base unit

  const withTraits = (u) => ({ ...TRAIT_DEFAULTS, defense: 'none', defVal: 0, level: 0, ...u });

  // Unit stats at a given level (defaults to the unit's own level field)
  function leveled(unit, level) {
    const u = withTraits(unit);
    const L = Math.max(0, Math.min(MAX_LEVEL, Math.round(level == null ? u.level : level)));
    if (!L) return { ...u, level: 0 };
    const k = 1 + LEVEL_BONUS * L;
    return { ...u, level: L, hp: u.hp * k, hit: u.hit * k };
  }

  // ---------- skills ----------
  const SKILL_SLOTS = 3; // skill slots per unit
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
    lifesteal: { label: 'Lifesteal', params: [['pct', 'Heals itself for (% of damage dealt)', 10, 1]] },
    turret:  { label: 'Extra turret', params: [['turrets', 'Attacks at once (each with its own target and reload)', 2, 1]] },
    frenzy:  { label: 'Frenzy', params: [['pct', 'Attack speed per hit (+% of base)', 10, 1], ['cap', 'Most attacks per second', 2, 0.1]] },
    spread:  { label: 'Spread', params: [['min', 'Least distance (m)', 1, 0.5], ['max', 'Most distance (m)', 6, 0.5]] },
    mortar:  { label: 'Mortar', params: [['range', 'Range (+m)', 15, 1], ['min', 'Minimum range (m)', 5, 0.5], ['aps', 'Attack speed (+ attacks per second)', 0.1, 0.05]] },
    momentum: { label: 'Momentum', params: [['accel', 'Rolling acceleration (+%)', 100, 10]] },
    link:    { label: 'Linked health', params: [['hp', 'Health (+%)', 15, 5]] },
    healbot: { label: 'Healbot', params: [['hp', 'Healbot health', 300, 25], ['pct', 'Heals each body (% of max health per second)', 4, 0.5], ['range', 'Heal reach (m)', 8, 1], ['speed', 'Healbot move speed (m/s)', 3, 0.5]] },
    building: { label: 'Building', params: [['building', 'Building (id)', 'factory', null]] },
    builder: { label: 'Construct upgrades', params: [['extra', 'More constructs per build', 0, 1], ['faster', 'Build time (−%)', 0, 5], ['aps', 'Construct attack speed (+%)', 0, 5], ['shield', 'Construct shield (hits blocked)', 0, 1], ['armor', 'Construct armor', 0, 1]] },
  };
  const skillParam = (d, k) => {
    const v = d.params && d.params[k];
    if (v !== undefined && v !== null && v !== '') return v;
    const def = (SKILL_TYPES[d.type].params.find(p => p[0] === k) || [])[2];
    return def;
  };

  // One plain sentence describing what a skill does with its current settings
  function describeSkill(d) {
    if (!d || !SKILL_TYPES[d.type]) return '';
    const P = (k) => skillParam(d, k);
    const n = (k) => { const v = +P(k); return isFinite(v) ? String(Math.round(v * 100) / 100) : '0'; };
    switch (d.type) {
      case 'regen': return `+${n('hp')}% health, and regains ${n('pct')}% of its max health every second.`;
      case 'poison': return `Hits poison the target for ${n('pct')}% of the hit over ${n('duration')} s, ignoring armor and ward. ${n('slow')}% more time between attacks.`;
      case 'stealth': return `Can’t be targeted until it attacks, and hides again after ${STEALTH_BACK} s without attacking. Splash and piercing shots can still hit it.`;
      case 'armorHp': return `+${n('armor')} armor and +${n('hp')}% health.`;
      case 'spawn': return `Every ${n('every')} s, spawns ${n('count')} ${String(P('unit'))} ${+P('count') === 1 ? 'body' : 'bodies'}, up to ${n('max')} alive at once${+P('waves') > 0 ? `, at most ${n('waves')} ${+P('waves') === 1 ? 'wave' : 'waves'} per fight` : ''}.`;
      case 'rapid': return `+${n('aps')}% attack speed, −${n('range')}% range.`;
      case 'swift': return +P('hit') ? `+${n('speed')}% move speed and +${n('hit')}% hit size.` : `+${n('speed')}% move speed.`;
      case 'heavy': return `Projectiles fly ${n('slow')}% slower (${n('instant')} m/s if it normally hits instantly), +${n('hit')}% hit size.`;
      case 'healer': return `Each attack heals a random wounded ally for ${n('pct')}% of its hit.`;
      case 'range': return `+${n('m')} m range.`;
      case 'shrink': return `Hits cut the target’s range by ${n('m')} m for ${n('duration')} s, but not below 1 m.`;
      case 'ward': return `No single hit can deal more than ${n('cap')} damage to it.`;
      case 'slow': return `Hits slow the target for ${n('duration')} s: −${n('move')}% move speed and −${n('attack')}% attack speed.`;
      case 'forward': return 'Squads of this unit can also be placed in no man’s land.';
      case 'split': return `Attacks ${n('beams')} different enemies at once${+P('hit') > 0 ? `, −${n('hit')}% hit each` : ''}. −${n('range')}% range.`;
      case 'deathSpawn': return `When a body dies, ${n('count')} ${String(P('unit'))} ${+P('count') === 1 ? 'body takes' : 'bodies take'} its place${+P('strength') !== 100 ? `, at ${n('strength')}% health and damage` : ''}. A spawn of the unit itself starts from the dead body's own stats. Spawns don’t spawn again.`;
      case 'blast': return `When a body dies it explodes, dealing ${+P('pct') === 100 ? 'the damage of its hit' : `${n('pct')}% of its hit`} (for a ram, what it deals to the tower) to every enemy within ${n('radius')} m.`;
      case 'lifesteal': return `Each body heals itself for ${n('pct')}% of the damage it deals.`;
      case 'turret': return `Each body attacks ${n('turrets')} different enemies at once, each attack with its own target and its own reload, as if it carried ${n('turrets')} copies of its weapon. They never aim at the same enemy, so with only one enemy in reach just one fires.`;
      case 'frenzy': return `Each hit it lands gives that body +${n('pct')}% attack speed for the rest of the fight, up to ${n('cap')} attacks per second.`;
      case 'spread': return `At the start of a fight the bodies scatter in all directions, ${n('min')} to ${n('max')} m from where they stand (some stay on the tile), then charge. Splash catches fewer of them.`;
      case 'mortar': return `+${n('range')} m range and +${n('aps')} attacks per second, but it can’t attack enemies ${n('min')} m away or closer.`;
      case 'shield': return `Each body fully blocks the first ${n('hits')} ${+P('hits') === 1 ? 'hit' : 'hits'} it takes in a fight, however big. Poison already on it still ticks.`;
      case 'building': return `Pick a free tile in your zone for a ${String(P('building'))}. Your nearest builder builds it during fights; once built it stays all match, and each round you can buy one of its own skills.`;
      case 'momentum': return `Gets up to full rolling speed ${n('accel')}% faster, so it rolls over its targets more often.`;
      case 'link': return `+${n('hp')}% health, and the bodies of a squad share one health pool: damage to any of them is shared by all, and they fall together.`;
      case 'healbot': return `Each squad brings a healbot (${n('hp')} health) that follows it, never attacks, and heals every body of the squad within ${n('range')} m for ${n('pct')}% of its max health every second.`;
      case 'builder': {
        const parts = [];
        if (+P('extra') > 0) parts.push(`builds ${+P('extra') === 1 ? 'one more construct' : `${n('extra')} more constructs`} at once, ${BUILD_GAP} m apart`);
        if (+P('faster') > 0) parts.push(`builds ${n('faster')}% faster, its buildings too`);
        const c = [+P('aps') > 0 && `+${n('aps')}% attack speed`, +P('shield') > 0 && `a shield that blocks ${n('shield')} ${+P('shield') === 1 ? 'hit' : 'hits'}`, +P('armor') > 0 && `+${n('armor')} armor`].filter(Boolean);
        if (c.length) parts.push(`its constructs and what its buildings make get ${c.join(', ')}`);
        return parts.length ? parts.join('; ').replace(/^./, s => s.toUpperCase()) + '.' : 'No change.';
      }
    }
    return '';
  }

  // A unit with skills applied. defs = the skill definitions that are active; roster = all units (for spawns).
  function applySkills(unit, defs, roster) {
    const u = withTraits(unit);
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
        case 'blast': u.blastR = Math.max(u.blastR || 0, Math.max(0, P('radius'))); u.blastPct = (u.blastPct || 0) + Math.max(0, P('pct')); break;
        case 'split':
          u.beams = Math.max(u.beams || 1, Math.round(P('beams')));
          u.range = Math.max(0.5, u.range * (1 - Math.min(90, P('range')) / 100));
          u.hit = u.hit * (1 - Math.min(90, P('hit')) / 100);
          break;
        case 'momentum': if (u.roll > 0) u.roll = u.roll / (1 + Math.max(0, P('accel')) / 100); break;
        case 'link': u.link = true; u.hp = u.hp * (1 + P('hp') / 100); break;
        case 'healbot':
          u.escort = { pct: Math.max(0, P('pct')), unit: withTraits({ name: 'Healbot', cost: 0, bodies: 1, hp: Math.max(1, P('hp')), hit: 0, aps: 1, range: Math.max(1, P('range')),
            speed: Math.max(0.5, P('speed')), splash: 0, shape: 'diamond', color: '#8FD6A0', construct: true, noCount: true, follow: true }) };
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
    const armor = (u.defense === 'armor' ? u.defVal : 0) + (u.bonusArmor || 0);
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
      spawnT: u.spawn ? u.spawn.every : 0, kids: null,
      shield: u.shield || 0, // hits left that the Shield skill blocks completely
      frenzy: 0, // hits landed so far (Frenzy skill)
      stunT: 0, lastAtk: 0, // seconds of stun left (chargeStun); fight time of its last attack (stealth returns)
      spreadTo: u.spread ? spreadSpot(x, y, i, u.spread) : null, // Spread skill: where it runs to before anything else
    };
  }
  // Spread: a spot min..max metres from (x, y) in one of 12 directions, picked from the body's index (the same on every device)
  const DIRS12 = [[1, 0], [0.866025, 0.5], [0.5, 0.866025], [0, 1], [-0.5, 0.866025], [-0.866025, 0.5], [-1, 0], [-0.866025, -0.5], [-0.5, -0.866025], [0, -1], [0.5, -0.866025], [0.866025, -0.5]];
  function spreadSpot(x, y, i, [min, max]) {
    const [dx, dy] = DIRS12[(i * 5) % 12], d = min + (max - min) * ((i * 7) % 12) / 11;
    return { x: x + dx * d, y: y + dy * d };
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
      out.push(newBody(u, side, cx + (c - (cols - 1) / 2) * sp, cy + (r - (rows - 1) / 2) * sp, startIndex + i, squad));
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
        if (!b.u.link && !b.u.escort) continue;
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
    const towerDown = g.towerDown || TOWER_DOWN;
    // a body died: a fallen tower cripples its side; a body with deathBlast explodes (deathBlast % of its max health)
    const fell = (v) => {
      // a tower with teleport (Teleport mage general): instead of falling it jumps to u.teleport { x, y } with 1 health, once, and its side isn't crippled
      if (v.u.structure && v.u.teleport && !v.teleported) {
        v.teleported = true; v.alive = true; v.hp = 1; v.diedTick = undefined; v.poison = null;
        v.x = v.u.teleport.x; v.y = v.u.teleport.y;
        return;
      }
      if (v.u.structure) cripple[v.side] = towerDown.secs;
      if (v.u.deathBlast > 0) {
        const dmg = v.u.hp * v.u.deathBlast / 100;
        if (opts.record) shots.push([v.x, v.y, v.x, v.y, v.side, BLAST_RADIUS, 1, 0, 0]);
        for (const f of sides[1 - v.side]) if (f.alive && hyp(f.x - v.x, f.y - v.y) <= BLAST_RADIUS) hurt(v, f, dmg, v.x, v.y);
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
          pendingKids.push(newBody(ku, v.side, v.x + ox * g.spacing * 0.7, v.y + oy * fwd * g.spacing * 0.7, spawnIdx++, -1));
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
        v.hp = v.u.hp * CONVERT_HP / 100; v.turning = true; v.poison = null;
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
    // neutral structures (a map's elf tower): they belong to neither side, can't be hit, and shoot at
    // units of both sides in turn. Each is { u, x, y, friends: [bool, bool] }. A side it is friends with
    // (bribed) is never shot; it gets small splash heals instead (u.healHit, u.healAps, u.healSplash).
    // side (optional): the player it belongs to, so its shots are drawn in their colour. u.strong: drawn as heavier shots.
    const neutrals = (opts.neutrals || []).map(n => ({ ...n, friends: n.friends || [false, false], cd: 1 / Math.max(0.01, n.u.aps), turn: 0, healCd: n.u.healAps > 0 ? 1 / n.u.healAps : 0, healTurn: 0 }));
    // map tiles that act on any unit (either side) that starts on them or walks onto them, once per unit.
    // Each is { x0, x1, y0, y1 (world rectangle), type: 'speed' | 'toxic' | 'hail', ...settings }.
    // 'hail' is different: it hurts every unit standing in it, every tick (dps), unless the unit is hailImmune.
    const tiles = opts.tiles || [];
    let projectiles = [];
    let t = 0, shots = [], over = false, tick = 0;
    const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
    // current range: shortsight can shrink it for a while, but never below 1 m (or the unit's own range if shorter)
    const R = (b) => b.shrinkT > 0 ? Math.max(Math.min(b.u.range, 1), b.u.range - b.shrinkM) : b.u.range;
    // How far an attack reaches. Flame cones can reach further than where the unit stops (g.flameReach x range),
    // so a flamer keeps burning the enemies behind the first one without walking up to each.
    const reachOf = (b) => b.u.flame > 0 && g.flameReach > 1 ? R(b) * g.flameReach : R(b);
    // Where a unit stops walking: by default a little inside its range (g.stopPct: a share of range instead)
    const stopAt = (rg) => g.stopPct > 0 && g.stopPct < 1 ? rg * g.stopPct : rg - Math.min(APPROACH, rg * 0.25);
    // deterministic random numbers for healing targets (same on every device)
    let seed = (A.length * 7919 + B.length * 104729 + 1) >>> 0;
    const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    let spawnIdx = A.length + B.length;
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
      }
    }
    // damage that skips armor and ward (poison)
    function direct(owner, v, amount) {
      if (v.turning || v.u.aloft) return;
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
    // damage from the map itself (elf tower, toxic tiles): counts for neither side, earns no experience
    function neutralDamage(v, dmg) {
      if (v.turning || v.u.aloft) return;
      if (cripple[v.side] > 0) dmg = dmg * (1 + towerDown.taken / 100);
      loseHp(v, dmg);
      if (poolHp(v) <= 1e-9) kill(null, v);
    }
    // a unit is on a map tile: its effect, once per unit and tile type
    function onTile(b, tl) {
      if (tl.type === 'hail') { if (!b.u.hailImmune) { neutralDamage(b, tl.dps * dt); b.hailT = tick; } return; }
      const seen = b.tilesHit || (b.tilesHit = {});
      if (seen[tl.type]) return;
      seen[tl.type] = true;
      if (tl.type === 'speed') { b.u = { ...b.u, speed: b.u.speed * (1 + tl.speed / 100) }; b.fast = true; }
      if (tl.type === 'toxic') {
        (b.poison || (b.poison = [])).push({ src: null, dps: b.u.hp * tl.poisonPct / 100, t: tl.poisonDur });
        if (!(b.slowT > 0)) { b.slowMove = 0; b.slowAtk = 0; }
        b.slowMove = Math.max(b.slowMove, tl.slowMove); b.slowAtk = Math.max(b.slowAtk, tl.slowAtk); b.slowT = Math.max(b.slowT, tl.slowDur);
      }
    }
    // structures (towers) and airships don't count: a side is beaten when its units are gone
    const aliveCount = (arr) => { let c = 0; for (const b of arr) if (b.alive && counts(b)) c++; return c; };

    function hurt(owner, v, hit, fromX, fromY) {
      if (v.turning) return; // being won over: nothing hurts it until it has switched sides
      if (v.u.aloft) return; // an airship can't be shot down
      const st = stats[owner.side];
      let pct = owner.u.pctHit > 0 && !v.u.structure ? v.u.hp * owner.u.pctHit / 100 : 0;
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
      if (owner.u.lifesteal > 0 && owner.alive) owner.hp = Math.min(owner.u.hp, owner.hp + applied * owner.u.lifesteal / 100);
      st.wasted += dmg - applied;
      // experience: damage dealt, half of damage absorbed, and a bounty for killing leveled bodies
      owner.xp += applied;
      v.xp += applied * (g.absorbXp == null ? 0.5 : g.absorbXp);
      loseHp(v, dmg);
      if (poolHp(v) <= 0 && finishing(owner, v)) return;
      if (poolHp(v) <= 0) { kill(owner, v); return; }
      if (owner.u.poisonPct > 0) {
        // poison: a share of the hit, spread over its duration. Each attacker keeps one dose on the target;
        // its next hit refreshes that dose. Doses from different attackers add up.
        const dps = hit * owner.u.poisonPct / 100 / owner.u.poisonDur;
        const list = v.poison || (v.poison = []);
        const dose = list.find(p => p.src === owner);
        if (dose) { dose.dps = dps; dose.t = owner.u.poisonDur; } else list.push({ src: owner, dps, t: owner.u.poisonDur });
      }
      if (owner.u.slowDur > 0) {
        // slow: the stronger effect counts, and the longest remaining time
        if (!(v.slowT > 0)) { v.slowMove = 0; v.slowAtk = 0; }
        v.slowMove = Math.max(v.slowMove, owner.u.slowMove || 0);
        v.slowAtk = Math.max(v.slowAtk, owner.u.slowAtk || 0);
        v.slowT = Math.max(v.slowT, owner.u.slowDur);
      }
      if (owner.u.shrinkM > 0) {
        v.shrinkM = v.shrinkT > 0 ? Math.max(v.shrinkM, owner.u.shrinkM) : owner.u.shrinkM;
        v.shrinkT = Math.max(v.shrinkT, owner.u.shrinkDur);
      }
      if (owner.u.knockback > 0 && knockOn && !v.u.structure && !v.u.anchored) {
        // big hits on small bodies push the full distance; on big bodies barely at all
        const push = owner.u.knockback * Math.min(1, hit / v.u.hp);
        const dx = v.x - fromX, dy = v.y - fromY, d = hyp(dx, dy) || 1;
        v.x += dx / d * push; v.y += dy / d * push;
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
        if (direct && direct.alive && !owner.u.projSpeed) v = direct;
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
    }

    // enemies the unit may attack right now, nearest first
    function validTargets(b) {
      const valid = [];
      for (const f of sides[1 - b.side]) {
        if (!f.alive || f.hidden) continue;
        const d = dist(f, b);
        if (d <= reachOf(b) + 0.01 && d >= b.u.minRange) valid.push([d, f]);
      }
      valid.sort((p, q) => b.u.backline ? q[0] - p[0] : p[0] - q[0]);
      return valid.map(v => v[1]);
    }

    // the enemy a body attacks: once it has picked one it stays on it until it dies, hides or leaves its reach,
    // even if another enemy comes closer; then it picks the nearest
    function locked(b, valid) {
      if (!(b.lock && b.lock.alive && valid.includes(b.lock))) b.lock = valid[0];
      return b.lock;
    }

    // one shot, or a spread of shotgun pellets each at a different body in the cone
    function aim(b, primary, valid) {
      if (b.u.flame > 0) return flameTargets(b, primary);
      const n = Math.max(1, Math.round(b.u.pellets));
      if (n === 1 && b.u.beams > 1) {
        // split beam: the target plus the next nearest enemies in reach, each hit once
        const out = [primary];
        for (const f of valid) { if (out.length >= b.u.beams) break; if (f !== primary) out.push(f); }
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
        if (fl > reach || fl < b.u.minRange) continue;
        if (f === primary || !al || !fl || (ax * fx + ay * fy) / (al * fl) >= c - 1e-12) out.push(f);
      }
      if (!out.includes(primary)) out.push(primary);
      out.flame = [ax, ay, al];
      return out;
    }

    // attacks per second right now: Frenzy speeds it up with every hit landed, up to its cap (never below the base rate)
    function apsOf(b) {
      const a = b.u.aps;
      if (!(b.u.frenzyPct > 0) || !b.frenzy) return a;
      return Math.max(a, Math.min(b.u.frenzyCap, a * (1 + b.frenzy * b.u.frenzyPct / 100)));
    }

    function fire(b, targets, canCharge) {
      const charged = canCharge && b.u.charge > 1 && b.moved >= CHARGE_RUN;
      b.moved = 0;
      if (!b.u.aloft) b.hidden = false; // attacking gives a stealth unit away (it hides again after STEALTH_BACK s without attacking); an airship stays out of reach
      b.lastAtk = t;
      if (b.u.healPct > 0) {
        // heal a random wounded ally (not itself)
        const hurtAllies = sides[b.side].filter(a => a.alive && a !== b && a.hp < a.u.hp);
        if (hurtAllies.length) {
          const a = hurtAllies[Math.min(hurtAllies.length - 1, Math.floor(rnd() * hurtAllies.length))];
          a.hp = Math.min(a.u.hp, a.hp + b.u.hit * b.u.healPct / 100 * healMul);
          if (opts.record) shots.push([b.x, b.y, a.x, a.y, b.side, 0, 0, 1]);
        }
      }
      const hit = b.u.hit * (charged ? b.u.charge : 1) * (b.u.spinHit > 0 ? Math.min(SPIN_CAP, 1 + b.u.spinHit / 100 * Math.max(0, b.firing)) : 1);
      // trample: a charged hit doesn't stop the unit; it runs on through its target and over every body in its path
      if (charged && b.u.trample > 0 && targets.length && !targets.flame) {
        const tgt = targets[0], dx = tgt.x - b.x, dy = tgt.y - b.y, d = hyp(dx, dy);
        if (d > 0) { b.trampleDir = [dx / d, dy / d]; b.trampleLeft = d + TRAMPLE_RUN; b.trampled = [tgt]; }
      }
      // stunned after a charge (a trampler only once its run is over, see the movement loop)
      if (charged && b.u.chargeStun > 0 && !(b.trampleLeft > 0)) b.stunT = b.u.chargeStun;
      for (const tgt of targets) {
        const dx = tgt.x - b.x, dy = tgt.y - b.y, d = hyp(dx, dy) || 1;
        const dirX = dx / d, dirY = dy / d;
        if (targets.flame) {
          hurt(b, tgt, hit, b.x, b.y); // flames land at once, no splash or pierce
        } else if (b.u.projSpeed > 0) {
          projectiles.push({ owner: b, x: b.x, y: b.y, fx: b.x, fy: b.y, tx: tgt.x, ty: tgt.y, dirX, dirY, left: d, hit });
        } else {
          impact(b, tgt.x, tgt.y, tgt, hit, dirX, dirY, b.x, b.y);
        }
        if (opts.record && !targets.flame) shots.push([b.x, b.y, tgt.x, tgt.y, b.side, b.u.splash, charged ? 1 : 0, 0, 0, b.u.spinUp > 0 ? b.spin : 1, b.u.chain ? 1 : 0]);
      }
      // chain lightning: from the target on to the nearest enemy not hit yet, up to chain.jumps times
      if (b.u.chain && targets.length && !targets.flame && !(b.u.projSpeed > 0)) {
        const done = [targets[0]], k = b.u.hit > 0 ? hit / b.u.hit : 1;
        let last = targets[0], lx = last.x, ly = last.y;
        for (let j = 0; j < b.u.chain.jumps; j++) {
          let nx = null, nd = b.u.chain.reach + 0.01;
          for (const f of sides[1 - b.side]) {
            if (!f.alive || f.hidden || done.includes(f)) continue;
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
        shots.push([b.x, b.y, b.x + ax * k, b.y + ay * k, b.side, 0, charged ? 1 : 0, 0, b.u.flame]);
      }
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
        b.tcd[k] = (b.tcd[k] || 0) - dt * (b.slowT > 0 ? 1 - b.slowAtk / 100 : 1);
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
      if (!tgt) for (const f of foes) if (f.alive && !f.hidden) { const d = dist(f, b); if (d < td) { td = d; tgt = f; } }
      if (!tgt) return;
      if (td > RAM_REACH) {
        const mv = Math.min(td - RAM_REACH * 0.5, b.u.speed * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * (cripple[b.side] > 0 ? 1 - towerDown.move / 100 : 1) * dt);
        b.hx = (tgt.x - b.x) / td; b.hy = (tgt.y - b.y) / td;
        b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
        if (dist(tgt, b) > RAM_REACH) return;
      }
      if (opts.record) shots.push([b.x, b.y, tgt.x, tgt.y, b.side, 0, 1, 0, 0]);
      b.rammed = tgt;
      hurt(b, tgt, b.u.hit, b.x, b.y);
      if (b.alive) { b.hp = 0; b.alive = false; b.diedTick = tick; fell(b); }
    }

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
        for (const f of foes) { if (!f.alive || f.hidden) continue; const d = dist(f, b); if (d < nd) { nd = d; near = f; } }
        if (!near) return;
        b.near = near;
        const [mx, my] = b.march || [0, b.side === 0 ? 1 : -1];
        if (!b.engaged) {
          let spotted = nd <= Math.max(R(b) + sight, minSight);
          if (!spotted) { // nothing left ahead to march toward: go for the nearest
            spotted = true;
            for (const f of foes) if (f.alive && !f.hidden && (f.x - b.x) * mx + (f.y - b.y) * my > 0) { spotted = false; break; }
          }
          if (spotted) b.engaged = true;
        }
        // once engaged it stays on its target until that dies or hides, like any unit
        const tgt = b.engaged ? (b.lock && b.lock.alive && !b.lock.hidden ? b.lock : (b.lock = near)) : null;
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
      if (b.rollPast > 0) { b.hx = b.rollDir[0]; b.hy = b.rollDir[1]; }
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
      if (stop) { b.rollPast = 0; b.rollV = start; b.rolled = null; }
    }

    // a healbot keeps close behind its squad (the middle of its bodies still standing); with the squad gone it stays put
    function escortMove(b) {
      let sx = 0, sy = 0, n = 0;
      for (const a of b.follow) if (a.alive) { sx += a.x; sy += a.y; n++; }
      if (!n) return;
      const dx = sx / n - b.x, dy = sy / n - b.y, d = hyp(dx, dy), keep = 2.5;
      if (d <= keep) return;
      const mv = Math.min(d - keep, b.u.speed * moveMul(b) * dt);
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
        const kid = newBody(cu, b.side, x, y, spawnIdx++, -1);
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
      const mv = Math.min(d - SITE_REACH * 0.8, b.u.speed * moveMul(b) * dt);
      b.hx = (s.x - b.x) / d; b.hy = (s.y - b.y) / d;
      b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
      return true;
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
      // movement + targeting
      for (const b of all) {
        if (!b.alive || b.delay > 0) continue;
        if (b.stunT > 0) { b.stunT = Math.max(0, b.stunT - dt); continue; } // stunned: can't move (or attack, below)
        if (b.holdT > 0) { b.holdT -= dt; continue; } // holding its ground (it still shoots)
        const foes = sides[1 - b.side];
        if (b.trampleLeft > 0) {
          // running through after a charge: straight on, hitting each body it runs over once
          const mv = Math.min(b.trampleLeft, b.u.speed * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * (cripple[b.side] > 0 ? 1 - towerDown.move / 100 : 1) * dt);
          const [ux, uy] = b.trampleDir;
          b.x += ux * mv; b.y += uy * mv; b.hx = ux; b.hy = uy;
          b.trampleLeft -= mv;
          const tHit = b.u.hit * b.u.trample / 100;
          for (const f of foes) {
            if (!f.alive || b.trampled.includes(f) || hyp(f.x - b.x, f.y - b.y) > TRAMPLE_WIDTH) continue;
            b.trampled.push(f);
            if (opts.record) shots.push([b.x, b.y, f.x, f.y, b.side, 1, 1, 0, 0]);
            hurt(b, f, tHit, b.x, b.y);
          }
          if (b.trampleLeft <= 1e-9) { b.trampleLeft = 0; b.trampled = null; if (b.u.chargeStun > 0) b.stunT = b.u.chargeStun; }
          continue;
        }
        if (b.u.idle) continue; // a building
        if (b.siteJob && siteWork(b)) continue;
        if (b.u.ram) { ram(b, foes); continue; }
        if (b.u.roll > 0) { roll(b, foes); continue; }
        if (b.follow) { escortMove(b); continue; }
        if (b.spreadTo) { // Spread: run out to its own spot first
          const sx = b.spreadTo.x - b.x, sy = b.spreadTo.y - b.y, sd = hyp(sx, sy);
          const mv = Math.min(sd, b.u.speed * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * dt);
          if (sd > 1e-6) { b.hx = sx / sd; b.hy = sy / sd; b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv; }
          if (sd - mv <= 0.05) b.spreadTo = null;
          continue;
        }
        let near = null, nd = Infinity;
        for (const f of foes) {
          if (!f.alive || f.hidden) continue;
          const d = dist(f, b);
          if (d < nd) { nd = d; near = f; }
        }
        b.near = near;
        if (b.u.flee > 0 && near && nd < b.u.flee) { // keeping away from the enemy
          const mv = b.u.speed * moveMul(b) * dt;
          b.hx = -(near.x - b.x) / (nd || 1); b.hy = -(near.y - b.y) / (nd || 1);
          b.x += b.hx * mv; b.y += b.hy * mv; b.moved += mv;
          if (g.bounds) { b.x = Math.max(g.bounds.x0, Math.min(g.bounds.x1, b.x)); b.y = Math.max(g.bounds.y0, Math.min(g.bounds.y1, b.y)); }
          continue;
        }
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
        if (near && nd > (g.stopPct > 0 && g.stopPct < 1 && b.engaged ? stopAt(rg) : rg)) {
          const step = b.u.speed * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * (cripple[b.side] > 0 ? 1 - towerDown.move / 100 : 1) * dt;
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
              for (const f of foes) if (f.alive && !f.hidden && (f.x - b.x) * mx + (f.y - b.y) * my > 0) { spotted = false; break; }
            }
            if (spotted) b.engaged = true;
          }
          // where it wants to go: straight ahead, or at the nearest enemy
          let wx = mx, wy = my;
          if (b.engaged) { wx = (near.x - b.x) / nd; wy = (near.y - b.y) / nd; }
          else if (drift > 0 && nd < aware + drift && (near.x - b.x) * mx + (near.y - b.y) * my > 0) {
            // within DRIFT of its sight: lean toward the nearest enemy ahead, harder the closer it gets, so it
            // curves in on a diagonal instead of marching level with the enemy and then turning sharply
            const w = (aware + drift - nd) / drift;
            wx = mx * (1 - w) + (near.x - b.x) / nd * w; wy = my * (1 - w) + (near.y - b.y) / nd * w;
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
      // separation between allies
      const minSep = g.spacing * 0.7;
      for (let s = 0; s < 2; s++) {
        const arr = sides[s];
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i]; if (!a.alive || a.u.aloft) continue;
          for (let j = i + 1; j < arr.length; j++) {
            const c = arr[j]; if (!c.alive || c.u.aloft) continue;
            const dx = c.x - a.x, dy = c.y - a.y;
            const d = hyp(dx, dy);
            // structures and bodies still waiting to start (flank squads) don't budge: the other body moves the whole way
            const fa = a.u.structure || a.u.anchored || a.delay > 0, fc = c.u.structure || c.u.anchored || c.delay > 0;
            if (fa && fc) continue;
            const ka = fa ? 0 : fc ? 2 : 1, kc = fc ? 0 : fa ? 2 : 1;
            if (d > 0 && d < minSep) {
              const push = (minSep - d) / 2;
              a.x -= dx / d * push * ka; a.y -= dy / d * push * ka;
              c.x += dx / d * push * kc; c.y += dy / d * push * kc;
            } else if (d === 0) {
              a.x -= minSep / 2 * ka; c.x += minSep / 2 * kc;
            }
          }
        }
      }
      // ongoing effects: poison, regeneration, shortsight wearing off, spawns
      const n0 = all.length;
      for (let i = 0; i < n0; i++) {
        const b = all[i];
        if (!b.alive) continue;
        if (b.poison && b.poison.length) {
          for (const p of b.poison) {
            if (!b.alive) break;
            if (b.u.slime) b.hp = Math.min(b.u.hp, b.hp + p.dps * Math.min(dt, p.t)); // slime units drink poison: it heals them
            else if (p.src) direct(p.src, b, p.dps * Math.min(dt, p.t));
            else neutralDamage(b, p.dps * Math.min(dt, p.t)); // poison from a map tile: nobody's damage
            p.t -= dt;
          }
          b.poison = b.poison.filter(p => p.t > 0);
          if (!b.alive) continue;
        }
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
        if (b.u.regen > 0 && b.hp < b.u.hp) b.hp = Math.min(b.u.hp, b.hp + b.u.hp * b.u.regen / 100 * healMul * dt);
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
              const kid = newBody(pu, b.side, x, y, spawnIdx++, -1);
              kid.credit = b;
              pendingKids.push(kid);
            });
          }
        }
        if (b.follow && b.healPct > 0) { // a healbot mends the bodies of its squad within reach
          let to = null;
          for (const a of b.follow) if (a.alive && a.hp < a.u.hp && dist(a, b) <= b.u.range + 0.01) { a.hp = Math.min(a.u.hp, a.hp + a.u.hp * b.healPct / 100 * healMul * dt); to = to || a; }
          b.healFx = (b.healFx || 0) - dt;
          if (to && b.healFx <= 0) { b.healFx = 1; if (opts.record) shots.push([b.x, b.y, to.x, to.y, b.side, 0, 0, 1]); }
        }
        if (b.shrinkT > 0) { b.shrinkT -= dt; if (b.shrinkT <= 0) { b.shrinkT = 0; b.shrinkM = 0; } }
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
              const kid = newBody(b.u.spawn.unit, b.side, b.x + ox * g.spacing * 0.7, b.y + oy * fwd * g.spacing * 0.7, spawnIdx++, -1);
              b.kids.push(kid); all.push(kid); sides[b.side].push(kid);
              stats[b.side].totalHp += kid.u.hp;
            }
          }
        }
      }
      // attacks. A body killed earlier in this same tick still gets its attack, so neither side
      // wins a trade just by being processed first (side 0 used to win one-shot duels like Sniper vs Sniper)
      for (const b of all) {
        if ((!b.alive && b.diedTick !== tick) || b.delay > 0 || b.u.ram || b.boarded || b.turning) continue;
        if (b.u.roll > 0 || b.follow || b.buildT > 0 || b.siteJob || b.u.idle) continue; // rollers hit by rolling; healbots and buildings never attack; builders at work don't
        b.cd -= dt * (b.slowT > 0 ? 1 - b.slowAtk / 100 : 1); // slowed units reload slower
        if (b.firing >= 0) b.firing += dt;
        if (b.stunT > 0) continue; // stunned after a charge
        if (b.u.mend > 0) { // a healer that never attacks: the most wounded ally in range gets b.u.mend
          if (!b.alive || b.cd > 0) continue;
          let tgt = null, most = 1e-9;
          for (const a of sides[b.side]) {
            if (!a.alive || a.u.structure || a.hp >= a.u.hp || dist(a, b) > R(b) + 0.01) continue;
            if (a.u.hp - a.hp > most) { most = a.u.hp - a.hp; tgt = a; }
          }
          if (!tgt) { b.cd = Math.max(b.cd, -dt); continue; }
          b.cd = Math.max(b.cd, -dt) + 1 / Math.max(0.01, b.u.aps);
          tgt.hp = Math.min(tgt.u.hp, tgt.hp + b.u.mend * healMul);
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
          if (!valid.length) continue;
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
        const n = Math.max(1, Math.round(b.u.burst));
        if (n > 1) {
          const dx = primary.x - b.x, dy = primary.y - b.y, d = hyp(dx, dy) || 1;
          b.burstLeft = n - 1; b.burstTimer = BURST_GAP; b.burstDir = [dx / d, dy / d];
          b.cd = Math.max(b.cd, (n - 1) * BURST_GAP + dt); // the next attack waits for the burst to finish
        }
        fire(b, aim(b, primary, valid), true);
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
              for (const f of sides[tgt.side]) if (f.alive && !f.u.structure && hyp(f.x - tgt.x, f.y - tgt.y) <= n.u.healSplash) f.hp = Math.min(f.u.hp, f.hp + amt);
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
            if (!f.alive || f.hidden || f.u.structure) continue;
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
          let mv = p.owner.u.projSpeed * dt, done = false;
          while (mv > 0 && !done) {
            const sub = Math.min(0.5, mv, p.left);
            p.x += p.dirX * sub; p.y += p.dirY * sub; p.left -= sub; mv -= sub;
            if (!p.owner.u.lob) for (const f of foes) {
              if (f.alive && hyp(f.x - p.x, f.y - p.y) <= PROJ_HIT_RADIUS) {
                impact(p.owner, p.x, p.y, null, p.hit, p.dirX, p.dirY, p.fx, p.fy);
                done = true; break;
              }
            }
            if (!done && p.left <= 1e-6) {
              impact(p.owner, p.x, p.y, null, p.hit, p.dirX, p.dirY, p.fx, p.fy);
              done = true;
            }
          }
          if (!done) next.push(p);
        }
        projectiles = next;
      }
      // bodies won over by a Gentleman switch sides; they start fresh (no target, no burst, no effects from before)
      for (const v of turning) {
        const from = sides[v.side];
        from.splice(from.indexOf(v), 1);
        v.convert = { side: v.side, squad: v.squad, xp: v.xp, dealt: v.dealt || 0 }; // what it earned for its old squad
        v.side = 1 - v.side; v.squad = CONVERT_SQUAD; v.xp = 0; v.dealt = 0; v.turning = false;
        v.windTarget = null; v.windT = 0; v.setUp = false; v.firing = -1; v.burstLeft = 0; v.trampleLeft = 0; v.trampled = null;
        v.spinTarget = null; v.aims = null; v.lock = null; v.march = null; v.spreadTo = null; v.engaged = false; v.holdT = 0; v.delay = 0; v.band = null; v.hidden = false;
        v.slowT = 0; v.slowMove = 0; v.slowAtk = 0; v.shrinkT = 0; v.shrinkM = 0; v.kids = null; v.stunT = 0; v.frenzy = 0;
        sides[v.side].push(v); stats[v.side].totalHp += v.hp;
        for (const b of all) {
          if (b.windTarget === v) { b.windTarget = null; b.windT = 0; }
          if (b.spinTarget === v) b.spinTarget = null;
        }
      }
      turning.length = 0;
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
      t += dt;
      return true;
    }

    function frame(final) {
      return {
        t, shots: final ? [] : shots,
        p: final ? [] : projectiles.map(p => [p.x, p.y, p.owner.side]),
        b: all.map(x => [x.x, x.y, x.alive ? x.hp / x.u.hp : 0, x.side, x.windTarget && x.u.windUp > 0 ? 1 - x.windT / x.u.windUp : 0, x.hidden ? 1 : 0, x.poison && x.poison.length ? 1 : 0, x.slowT > 0 ? 1 : 0, x.stunT > 0 ? 1 : 0]),
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
      }
      return {
        winner, timeout, time: t, frac,
        score: frac[0] - frac[1],
        survivors: [aliveA, aliveB], counts: [A.length, B.length],
        stats, squads,
        charm, // charisma stacks after the fight, by side and squad id (null for a side without)
        converted: [0, 1].map(k => all.filter(b => b.convert && b.side === k).length), // bodies each side won over
        // each building: still standing, seconds of building done at the end (null when it was already built), whether any was done this fight
        buildings: all.filter(b => b.u.building).map(b => ({ side: b.side, squad: b.squad, alive: b.alive, work: b.site ? b.site.work : null, worked: !!(b.site && b.site.work > b.site.start) })),
      };
    }

    return { step, frame, result, bodies: all, neutrals, isOver: () => over, time: () => t, lastShots: () => shots, projectiles: () => projectiles, crippled: (side) => cripple[side], charm: (side, squad) => (charm[side] && charm[side][squad]) || 0 };
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

  return { TOWER_DOWN, RULES, ruleOn, STEALTH_BACK, SKILL_SLOTS, SLOTS, SKILL_TYPES, skillParam, describeSkill, applySkills, innateUnit, fairBudget, battle, makeArmy, matrix, createBattle, buildSquad, rawStrength, squadsFor, withTraits, leveled, TRAIT_DEFAULTS, SPIN_CAP, CHARGE_RUN, TRAMPLE_RUN, BLAST_RADIUS, RAM_REACH, ROLL_START, ROLL_PAST, BUILD_GAP, BUILD_COOP, SITE_REACH, LEVEL_BONUS, MAX_LEVEL, CHARM_MAX, CONVERT_HP, CONVERT_SQUAD };
})();
if (typeof module !== 'undefined') module.exports = Engine;
