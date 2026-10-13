// ===== Battle engine (shared by headless tests and the page) =====
const Engine = (() => {
  const TRAIT_DEFAULTS = { burst: 1, pellets: 1, spinUp: 0, pierce: 0, projSpeed: 0, minRange: 0, charge: 1, knockback: 0, windUp: 0, flame: 0 };
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
  const SPIN_CAP = 3;          // spin-up tops out at 3x attack speed
  const CHARGE_RUN = 5;        // metres a unit must run before its next attack counts as a charge
  const PIERCE_DEPTH = 10;     // metres a piercing shot travels past its target
  const PIERCE_WIDTH = 1;      // half-width of the pierce corridor (m)
  const APPROACH = 0.5;         // metres a moving unit steps inside its max range
  const PROJ_HIT_RADIUS = 1;
  const TURN = 6;              // how fast a walking body swings to a new heading (share of the turn per second)
  const SIGHT = 12;            // metres beyond its own range at which a unit notices an enemy and turns toward it   // a projectile hits a body within this distance of where it lands

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
  // Each skill type and its settings (key, label, default, step). Shared by Counter Lab and the game.
  const SKILL_TYPES = {
    regen:   { label: 'Regeneration', params: [['pct', 'Health regained per second (% of max)', 2, 0.5], ['hp', 'Health (+%)', 20, 5]] },
    poison:  { label: 'Poison shot', params: [['pct', 'Poison damage (% of hit, in total)', 100, 10], ['duration', 'Poison lasts (s)', 4, 0.5], ['slow', 'Longer time between attacks (%)', 30, 5]] },
    stealth: { label: 'Stealth', params: [] },
    armorHp: { label: 'Armor and health', params: [['armor', 'Armor (blocked from every hit)', 8, 1], ['hp', 'Health (+%)', 25, 5]] },
    spawn:   { label: 'Spawn goblins', params: [['unit', 'Spawns (unit name)', 'Goblin Swarm', null], ['count', 'Bodies per spawn', 2, 1], ['every', 'Every (s)', 4, 0.5], ['max', 'Most alive at once', 6, 1]] },
    rapid:   { label: 'Rapid fire', params: [['aps', 'Attack speed (+%)', 50, 5], ['range', 'Range (−%)', 30, 5]] },
    swift:   { label: 'Swift strikes', params: [['speed', 'Move speed (+%)', 30, 5], ['hit', 'Hit size (+%)', 25, 5]] },
    heavy:   { label: 'Heavy shot', params: [['slow', 'Projectile speed (−%)', 40, 5], ['instant', 'Projectile speed if the unit hits instantly (m/s)', 30, 5], ['hit', 'Hit size (+%)', 40, 5]] },
    healer:  { label: 'Healing touch', params: [['pct', 'Heal per attack (% of hit)', 50, 5]] },
    range:   { label: 'Long reach', params: [['m', 'Range (+m)', 5, 1]] },
    shrink:  { label: 'Shortsight', params: [['m', 'Enemy range (−m)', 4, 0.5], ['duration', 'Lasts (s)', 3, 0.5]] },
    ward:    { label: 'Ward', params: [['cap', 'Most damage one hit can deal', 40, 5]] },
    slow:    { label: 'Slow', params: [['move', 'Enemy move speed (−%)', 40, 5], ['attack', 'Enemy attack speed (−%)', 20, 5], ['duration', 'Lasts (s)', 3, 0.5]] },
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
      case 'stealth': return 'Can’t be targeted until it attacks for the first time. Splash and piercing shots can still hit it.';
      case 'armorHp': return `+${n('armor')} armor and +${n('hp')}% health.`;
      case 'spawn': return `Every ${n('every')} s, spawns ${n('count')} ${String(P('unit'))} ${+P('count') === 1 ? 'body' : 'bodies'}, up to ${n('max')} alive at once.`;
      case 'rapid': return `+${n('aps')}% attack speed, −${n('range')}% range.`;
      case 'swift': return `+${n('speed')}% move speed and +${n('hit')}% hit size.`;
      case 'heavy': return `Projectiles fly ${n('slow')}% slower (${n('instant')} m/s if it normally hits instantly), +${n('hit')}% hit size.`;
      case 'healer': return `Each attack heals a random wounded ally for ${n('pct')}% of its hit.`;
      case 'range': return `+${n('m')} m range.`;
      case 'shrink': return `Hits cut the target’s range by ${n('m')} m for ${n('duration')} s, but not below 1 m.`;
      case 'ward': return `No single hit can deal more than ${n('cap')} damage to it.`;
      case 'slow': return `Hits slow the target for ${n('duration')} s: −${n('move')}% move speed and −${n('attack')}% attack speed.`;
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
            u.spawn = { unit: withTraits({ ...plain, level: 0 }), count: Math.max(1, Math.round(P('count'))), every: Math.max(0.5, P('every')), max: Math.max(1, Math.round(P('max'))) };
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
      }
    }
    return u;
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
      hidden: !!u.stealth, poison: null, shrinkM: 0, shrinkT: 0, slowT: 0, slowMove: 0, slowAtk: 0,
      spawnT: u.spawn ? u.spawn.every : 0, kids: null,
    };
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
    const all = A.concat(B);
    const sides = [A, B];
    const stats = [
      { dealt: 0, wasted: 0, blocked: 0, missed: 0, windLost: 0, winds: 0, totalHp: A.reduce((s, b) => s + b.u.hp, 0) },
      { dealt: 0, wasted: 0, blocked: 0, missed: 0, windLost: 0, winds: 0, totalHp: B.reduce((s, b) => s + b.u.hp, 0) },
    ];
    const dt = g.dt;
    const sight = g.sight == null ? SIGHT : g.sight;
    let projectiles = [];
    let t = 0, shots = [], over = false;
    const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
    // current range: shortsight can shrink it for a while, but never below 1 m (or the unit's own range if shorter)
    const R = (b) => b.shrinkT > 0 ? Math.max(Math.min(b.u.range, 1), b.u.range - b.shrinkM) : b.u.range;
    // deterministic random numbers for healing targets (same on every device)
    let seed = (A.length * 7919 + B.length * 104729 + 1) >>> 0;
    const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    let spawnIdx = A.length + B.length;
    const SPAWN_SPOTS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    // damage that skips armor and ward (poison)
    function direct(owner, v, amount) {
      const applied = Math.min(amount, v.hp);
      if (applied <= 0) return;
      stats[owner.side].dealt += applied;
      owner.dealt = (owner.dealt || 0) + applied;
      owner.xp += applied;
      v.xp += applied * (g.absorbXp == null ? 0.5 : g.absorbXp);
      v.hp -= applied;
      if (v.hp <= 1e-9) { v.hp = 0; v.alive = false; owner.xp += v.u.hp * v.level; }
    }
    const aliveCount = (arr) => { let c = 0; for (const b of arr) if (b.alive) c++; return c; };

    function hurt(owner, v, hit, fromX, fromY) {
      const st = stats[owner.side];
      const dmg = damageAfterDefense(hit, v, g);
      st.blocked += hit - dmg;
      const applied = Math.min(dmg, v.hp);
      st.dealt += applied;
      owner.dealt = (owner.dealt || 0) + applied;
      st.wasted += dmg - applied;
      // experience: damage dealt, half of damage absorbed, and a bounty for killing leveled bodies
      owner.xp += applied;
      v.xp += applied * (g.absorbXp == null ? 0.5 : g.absorbXp);
      v.hp -= dmg;
      if (v.hp <= 0) { v.hp = 0; v.alive = false; owner.xp += v.u.hp * v.level; return; }
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
      if (owner.u.knockback > 0) {
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
        if (d <= R(b) + 0.01 && d >= b.u.minRange) valid.push([d, f]);
      }
      valid.sort((p, q) => p[0] - q[0]);
      return valid.map(v => v[1]);
    }

    // one shot, or a spread of shotgun pellets each at a different body in the cone
    function aim(b, primary, valid) {
      if (b.u.flame > 0) return flameTargets(b, primary);
      const n = Math.max(1, Math.round(b.u.pellets));
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
      const c = cosDeg(b.u.flame), reach = R(b) + 0.01;
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

    function fire(b, targets, canCharge) {
      const charged = canCharge && b.u.charge > 1 && b.moved >= CHARGE_RUN;
      b.moved = 0;
      b.hidden = false; // stealth ends with the first attack
      if (b.u.healPct > 0) {
        // heal a random wounded ally (not itself)
        const hurtAllies = sides[b.side].filter(a => a.alive && a !== b && a.hp < a.u.hp);
        if (hurtAllies.length) {
          const a = hurtAllies[Math.min(hurtAllies.length - 1, Math.floor(rnd() * hurtAllies.length))];
          a.hp = Math.min(a.u.hp, a.hp + b.u.hit * b.u.healPct / 100);
          if (opts.record) shots.push([b.x, b.y, a.x, a.y, b.side, 0, 0, 1]);
        }
      }
      const hit = b.u.hit * (charged ? b.u.charge : 1);
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
        if (opts.record && !targets.flame) shots.push([b.x, b.y, tgt.x, tgt.y, b.side, b.u.splash, charged ? 1 : 0]);
      }
      // a flame is drawn once, as a wedge from the unit out to its range
      if (opts.record && targets.flame) {
        const [ax, ay, al] = targets.flame, r = R(b), k = al ? r / al : 0;
        shots.push([b.x, b.y, b.x + ax * k, b.y + ay * k, b.side, 0, charged ? 1 : 0, 0, b.u.flame]);
      }
    }

    function step() {
      if (over) return false;
      if (t >= g.timeCap || !aliveCount(A) || !aliveCount(B)) { over = true; return false; }
      shots = [];
      // movement + targeting
      for (const b of all) {
        if (!b.alive) continue;
        const foes = sides[1 - b.side];
        let near = null, nd = Infinity;
        for (const f of foes) {
          if (!f.alive || f.hidden) continue;
          const d = dist(f, b);
          if (d < nd) { nd = d; near = f; }
        }
        b.near = near;
        const rg = R(b);
        if (near && nd > rg) {
          const step = b.u.speed * (b.slowT > 0 ? 1 - b.slowMove / 100 : 1) * dt;
          let mv;
          // March straight ahead until an enemy comes within sight (range + SIGHT), or no enemy is left
          // ahead, then lock on: from then on the body goes for its own nearest enemy for the rest of the
          // fight. Each body decides for itself, so a squad can split up when its bodies spot different
          // enemies. A squad meets what stands in its own lane, an empty lane lets it walk around the side,
          // and nobody flips back and forth between marching and chasing.
          const fwd = b.side === 0 ? 1 : -1;
          if (!b.engaged) {
            let spotted = nd <= rg + sight;
            if (!spotted) { // nothing left ahead to march toward: go for the nearest
              spotted = true;
              for (const f of foes) if (f.alive && !f.hidden && (f.y - b.y) * fwd > 0) { spotted = false; break; }
            }
            if (spotted) b.engaged = true;
          }
          // where it wants to go: straight ahead, or at the nearest enemy
          let wx = 0, wy = fwd;
          if (b.engaged) { wx = (near.x - b.x) / nd; wy = (near.y - b.y) / nd; }
          // turn smoothly instead of snapping: the heading swings toward the wanted direction
          if (b.hx === undefined) { b.hx = 0; b.hy = fwd; }
          const k = Math.min(1, TURN * dt);
          let hx = b.hx + (wx - b.hx) * k, hy = b.hy + (wy - b.hy) * k, hl = hyp(hx, hy);
          if (hl < 1e-6) { hx = wx; hy = wy; hl = 1; }
          b.hx = hx / hl; b.hy = hy / hl;
          // walk a little inside max range, so being nudged by allies doesn't leave the unit just out of reach
          mv = b.engaged ? Math.min(step, nd - (rg - Math.min(APPROACH, rg * 0.25))) : step;
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
      // separation between allies
      const minSep = g.spacing * 0.7;
      for (let s = 0; s < 2; s++) {
        const arr = sides[s];
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i]; if (!a.alive) continue;
          for (let j = i + 1; j < arr.length; j++) {
            const c = arr[j]; if (!c.alive) continue;
            const dx = c.x - a.x, dy = c.y - a.y;
            const d = hyp(dx, dy);
            if (d > 0 && d < minSep) {
              const push = (minSep - d) / 2;
              a.x -= dx / d * push; a.y -= dy / d * push;
              c.x += dx / d * push; c.y += dy / d * push;
            } else if (d === 0) {
              a.x -= minSep / 2; c.x += minSep / 2;
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
            direct(p.src, b, p.dps * Math.min(dt, p.t));
            p.t -= dt;
          }
          b.poison = b.poison.filter(p => p.t > 0);
          if (!b.alive) continue;
        }
        if (b.u.regen > 0 && b.hp < b.u.hp) b.hp = Math.min(b.u.hp, b.hp + b.u.hp * b.u.regen / 100 * dt);
        if (b.shrinkT > 0) { b.shrinkT -= dt; if (b.shrinkT <= 0) { b.shrinkT = 0; b.shrinkM = 0; } }
        if (b.slowT > 0) { b.slowT -= dt; if (b.slowT <= 0) { b.slowT = 0; b.slowMove = 0; b.slowAtk = 0; } }
        if (b.u.spawn) {
          b.spawnT -= dt;
          if (b.spawnT <= 0) {
            b.spawnT += b.u.spawn.every;
            b.kids = (b.kids || []).filter(k => k.alive);
            const n = Math.min(b.u.spawn.count, b.u.spawn.max - b.kids.length);
            for (let k = 0; k < n; k++) {
              const [ox, oy] = SPAWN_SPOTS[(b.kids.length + k) % SPAWN_SPOTS.length];
              const kid = newBody(b.u.spawn.unit, b.side, b.x + ox * g.spacing * 0.7, b.y + oy * g.spacing * 0.7, spawnIdx++, -1);
              b.kids.push(kid); all.push(kid); sides[b.side].push(kid);
              stats[b.side].totalHp += kid.u.hp;
            }
          }
        }
      }
      // attacks
      for (const b of all) {
        if (!b.alive) continue;
        b.cd -= dt * (b.slowT > 0 ? 1 - b.slowAtk / 100 : 1); // slowed units reload slower
        if (b.firing >= 0) b.firing += dt;
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
            primary = valid[0];
          } else {
            if (b.cd > 0) continue;
            valid = validTargets(b);
            if (!valid.length) continue;
            b.windTarget = valid[0]; b.windT = b.u.windUp; stats[b.side].winds++;
            continue;
          }
        } else {
          if (b.cd > 0) continue;
          valid = validTargets(b);
          if (!valid.length) continue;
          primary = valid[0];
        }
        if (b.firing < 0) b.firing = 0;
        const spin = b.u.spinUp > 0 ? Math.min(SPIN_CAP, 1 + b.u.spinUp / 100 * b.firing) : 1;
        // reload doesn't stack up while the unit has nothing to shoot: keep at most one step of carry-over
        b.cd = Math.max(b.cd, -dt) + 1 / Math.max(0.01, b.u.aps * spin);
        const n = Math.max(1, Math.round(b.u.burst));
        if (n > 1) {
          const dx = primary.x - b.x, dy = primary.y - b.y, d = hyp(dx, dy) || 1;
          b.burstLeft = n - 1; b.burstTimer = BURST_GAP; b.burstDir = [dx / d, dy / d];
          b.cd = Math.max(b.cd, (n - 1) * BURST_GAP + dt); // the next attack waits for the burst to finish
        }
        fire(b, aim(b, primary, valid), true);
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
            for (const f of foes) {
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
      t += dt;
      return true;
    }

    function frame(final) {
      return {
        t, shots: final ? [] : shots,
        p: final ? [] : projectiles.map(p => [p.x, p.y, p.owner.side]),
        b: all.map(x => [x.x, x.y, x.alive ? x.hp / x.u.hp : 0, x.side, x.windTarget && x.u.windUp > 0 ? 1 - x.windT / x.u.windUp : 0, x.hidden ? 1 : 0, x.poison && x.poison.length ? 1 : 0, x.slowT > 0 ? 1 : 0]),
      };
    }

    function result() {
      const remHp = sides.map(arr => arr.reduce((s, b) => s + (b.alive ? b.hp : 0), 0));
      const frac = [remHp[0] / stats[0].totalHp, remHp[1] / stats[1].totalHp];
      const aliveA = aliveCount(A), aliveB = aliveCount(B);
      let winner = -1, timeout = false;
      if (aliveA && !aliveB) winner = 0;
      else if (aliveB && !aliveA) winner = 1;
      else if (aliveA && aliveB) { timeout = true; winner = frac[0] > frac[1] ? 0 : frac[1] > frac[0] ? 1 : -1; }
      // survivors per squad: { squadId: { side, total, alive } }
      const squads = {};
      for (const b of all) {
        const k = b.side + ':' + b.squad;
        const s = squads[k] || (squads[k] = { side: b.side, squad: b.squad, total: 0, alive: 0, xp: 0, dealt: 0 });
        s.total++; if (b.alive) s.alive++;
        s.xp += b.xp; s.dealt += b.dealt || 0;
      }
      return {
        winner, timeout, time: t, frac,
        score: frac[0] - frac[1],
        survivors: [aliveA, aliveB], counts: [A.length, B.length],
        stats, squads,
      };
    }

    return { step, frame, result, bodies: all, isOver: () => over, time: () => t, lastShots: () => shots, projectiles: () => projectiles };
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

  return { SKILL_TYPES, skillParam, describeSkill, applySkills, battle, makeArmy, matrix, createBattle, buildSquad, rawStrength, squadsFor, withTraits, leveled, TRAIT_DEFAULTS, SPIN_CAP, CHARGE_RUN, LEVEL_BONUS, MAX_LEVEL };
})();
if (typeof module !== 'undefined') module.exports = Engine;
