// ===== Battle engine (shared by headless tests and the page) =====
const Engine = (() => {
  const TRAIT_DEFAULTS = { burst: 1, pellets: 1, spinUp: 0, pierce: 0, projSpeed: 0, minRange: 0, charge: 1, knockback: 0, windUp: 0 };
  const BURST_GAP = 0.15;      // seconds between shots in a burst
  const SHOTGUN_COS = Math.sqrt(3) / 2; // pellets spread 30 degrees to each side of the target (cos 30)
  // Only + - * / and sqrt from here on: those give identical results in every browser,
  // so two players' phones run exactly the same battle.
  const hyp = (x, y) => Math.sqrt(x * x + y * y);
  const SPIN_CAP = 3;          // spin-up tops out at 3x attack speed
  const CHARGE_RUN = 5;        // metres a unit must run before its next attack counts as a charge
  const PIERCE_DEPTH = 10;     // metres a piercing shot travels past its target
  const PIERCE_WIDTH = 1;      // half-width of the pierce corridor (m)
  const PROJ_HIT_RADIUS = 1;   // a projectile hits a body within this distance of where it lands

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
    const dps = n * u.hit / cycle * Math.max(1, u.burst) * Math.max(1, u.pellets);
    return { squads: s, bodies: n, hp, dps, strength: hp * dps };
  }

  function damageAfterDefense(hit, target, g) {
    if (target.u.defense === 'armor') return Math.max(hit - target.u.defVal, hit * g.minDmgPct / 100);
    if (target.u.defense === 'ward') return Math.min(hit, target.u.defVal);
    return hit;
  }

  function makeSide(unit, side, g) {
    const u = leveled(unit);
    const s = squadsFor(u, g);
    const n = s * u.bodies;
    const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * 2.5))));
    const sp = g.spacing;
    const bodies = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x = (c - (cols - 1) / 2) * sp;
      const y = (g.distance / 2 + r * sp) * (side === 0 ? -1 : 1);
      bodies.push(newBody(u, side, x, y, i, 0));
    }
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
  function battle(uA, uB, g, opts = {}) {
    const bt = createBattle(makeSide(uA, 0, g), makeSide(uB, 1, g), g, opts);
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
    let projectiles = [];
    let t = 0, shots = [], over = false;
    const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
    const aliveCount = (arr) => { let c = 0; for (const b of arr) if (b.alive) c++; return c; };

    function hurt(owner, v, hit, fromX, fromY) {
      const st = stats[owner.side];
      const dmg = damageAfterDefense(hit, v, g);
      st.blocked += hit - dmg;
      const applied = Math.min(dmg, v.hp);
      st.dealt += applied;
      st.wasted += dmg - applied;
      // experience: damage dealt, half of damage absorbed, and a bounty for killing leveled bodies
      owner.xp += applied;
      v.xp += applied * (g.absorbXp == null ? 0.5 : g.absorbXp);
      v.hp -= dmg;
      if (v.hp <= 0) { v.hp = 0; v.alive = false; owner.xp += v.u.hp * v.level; return; }
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
        if (!f.alive) continue;
        const d = dist(f, b);
        if (d <= b.u.range + 0.01 && d >= b.u.minRange) valid.push([d, f]);
      }
      valid.sort((p, q) => p[0] - q[0]);
      return valid.map(v => v[1]);
    }

    // one shot, or a spread of shotgun pellets each at a different body in the cone
    function aim(b, primary, valid) {
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

    function fire(b, targets, canCharge) {
      const charged = canCharge && b.u.charge > 1 && b.moved >= CHARGE_RUN;
      b.moved = 0;
      const hit = b.u.hit * (charged ? b.u.charge : 1);
      for (const tgt of targets) {
        const dx = tgt.x - b.x, dy = tgt.y - b.y, d = hyp(dx, dy) || 1;
        const dirX = dx / d, dirY = dy / d;
        if (b.u.projSpeed > 0) {
          projectiles.push({ owner: b, x: b.x, y: b.y, fx: b.x, fy: b.y, tx: tgt.x, ty: tgt.y, dirX, dirY, left: d, hit });
        } else {
          impact(b, tgt.x, tgt.y, tgt, hit, dirX, dirY, b.x, b.y);
        }
        if (opts.record) shots.push([b.x, b.y, tgt.x, tgt.y, b.side, b.u.splash, charged ? 1 : 0]);
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
          if (!f.alive) continue;
          const d = dist(f, b);
          if (d < nd) { nd = d; near = f; }
        }
        b.near = near;
        if (near && nd > b.u.range) {
          const mv = Math.min(b.u.speed * dt, nd - b.u.range);
          b.x += (near.x - b.x) / nd * mv;
          b.y += (near.y - b.y) / nd * mv;
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
      // attacks
      for (const b of all) {
        if (!b.alive) continue;
        b.cd -= dt;
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
              if (along >= b.u.minRange && along <= b.u.range + 0.01 && across <= PIERCE_WIDTH && along < fa) { fa = along; first = f; }
            }
            if (first) {
              fire(b, aim(b, first, validTargets(b)), false);
            } else {
              const end = { x: b.x + ux * b.u.range, y: b.y + uy * b.u.range };
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
        b: all.map(x => [x.x, x.y, x.alive ? x.hp / x.u.hp : 0, x.side, x.windTarget && x.u.windUp > 0 ? 1 - x.windT / x.u.windUp : 0]),
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
        const s = squads[k] || (squads[k] = { side: b.side, squad: b.squad, total: 0, alive: 0, xp: 0 });
        s.total++; if (b.alive) s.alive++;
        s.xp += b.xp;
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

  return { battle, matrix, createBattle, buildSquad, rawStrength, squadsFor, withTraits, leveled, TRAIT_DEFAULTS, SPIN_CAP, CHARGE_RUN, LEVEL_BONUS, MAX_LEVEL };
})();
if (typeof module !== 'undefined') module.exports = Engine;
