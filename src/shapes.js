// ===== Unit shapes (shared by Counter Lab and the demo) =====
const Shapes = (() => {
  const LIST = ['circle', 'ring', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross', 'bar', 'horse', 'spider', 'sun', 'flame', 'spear', 'imp', 'knife', 'drop'];
  const LABELS = { circle: 'Circle', ring: 'Ring', square: 'Square', triangle: 'Triangle', diamond: 'Diamond', pentagon: 'Pentagon', hexagon: 'Hexagon', star: 'Star', cross: 'Cross', bar: 'Bar', horse: 'Horse', spider: 'Spider', sun: 'Sun', flame: 'Flame', spear: 'Spear', imp: 'Imp', knife: 'Knife', drop: 'Drop' };
  const DEFAULTS = {
    'Goblin Swarm': 'triangle', 'Skeleton Archers': 'diamond', 'Ember Imps': 'imp', 'Fire Mage': 'hexagon',
    'Sniper': 'cross', 'Brute': 'square', 'Wisps': 'ring', 'Crossbow Volley': 'pentagon', 'Ballista': 'bar',
    'Boar Riders': 'circle', 'Spinning Golem': 'hexagon', 'Blunderbuss Crew': 'star', 'Ogre Smasher': 'square',
  };
  const valid = (s) => LIST.includes(s);
  // Unit colours: picked to stay clear of the team colours (blue and red), which outline every body
  const PALETTE = ['#9BD35A', '#E9E3CF', '#FFA94D', '#C77DFF', '#F7D154', '#8D99AE', '#E07A9B', '#B08155', '#3FD39A', '#B4A7F5', '#D9C49A', '#7FA650'];
  const DEFAULT_COLORS = {
    'Goblin Swarm': '#9BD35A', 'Skeleton Archers': '#E9E3CF', 'Ember Imps': '#FFA94D', 'Fire Mage': '#C77DFF',
    'Sniper': '#F7D154', 'Brute': '#8D99AE', 'Wisps': '#B4A7F5', 'Crossbow Volley': '#B08155', 'Ballista': '#D9C49A',
    'Boar Riders': '#E07A9B', 'Spinning Golem': '#7FA650', 'Blunderbuss Crew': '#3FD39A', 'Ogre Smasher': '#B08155',
  };
  // a unit's short label on the board: the first three letters of its name
  const tag = (u) => ((typeof u.tag === 'string' && u.tag.replace(/[^A-Za-z]/g, '')) || u.name.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'UNT').slice(0, 3).toUpperCase(); // a unit may pick its own (tag)
  const validColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

  // Give every unit a shape and a colour: keep valid ones, else a known default, else the first one not used yet
  function assign(units) {
    const used = new Set(units.filter(u => valid(u.shape)).map(u => u.shape));
    const usedC = new Set(units.filter(u => validColor(u.color)).map(u => u.color.toUpperCase()));
    return units.map((u) => {
      let out = u;
      if (!valid(u.shape)) {
        let s = DEFAULTS[u.name];
        if (!s || used.has(s)) s = LIST.find(x => !used.has(x)) || LIST[used.size % LIST.length];
        used.add(s);
        out = { ...out, shape: s };
      }
      if (!validColor(u.color)) {
        let c = DEFAULT_COLORS[u.name];
        if (!c || usedC.has(c)) c = PALETTE.find(x => !usedC.has(x)) || PALETTE[usedC.size % PALETTE.length];
        usedC.add(c);
        out = { ...out, color: c };
      }
      return out;
    });
  }

  // A horse seen from the side, facing right: rump, back, neck and head, chest, front leg, belly, hind leg, tail.
  // Points are in units of r around the centre; it always stands upright, whichever side it is on.
  const HORSE = [[-0.95, -0.3], [0.3, -0.3], [0.62, -0.95], [0.82, -0.85], [1.12, -0.5], [1.02, -0.36], [0.74, -0.46], [0.66, -0.05], [0.62, 0.3],
    [0.62, 1.05], [0.42, 1.05], [0.38, 0.32], [-0.52, 0.32], [-0.58, 1.05], [-0.78, 1.05], [-0.86, 0.22], [-1.18, 0.55], [-1.08, 0.05]];

  // Pictures made of several parts, in units of r around the centre, always upright: { c: [x, y, radius] } is a
  // disc, { p: [[x, y], ...] } a polygon. Every part runs the same way round, so overlapping parts fill as one.
  const clockwise = (pts) => pts.reduce((s, [x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x1 * y2 - x2 * y1; }, 0) > 0 ? pts : pts.slice().reverse();
  // a leg drawn as a thin strip along a bent line (w = half its thickness)
  function strip(line, w) {
    const nrm = (i) => { const [ax, ay] = line[Math.max(0, i - 1)], [bx, by] = line[Math.min(line.length - 1, i + 1)], l = Math.hypot(bx - ax, by - ay); return [-(by - ay) / l * w, (bx - ax) / l * w]; };
    const n = line.map((_, i) => nrm(i));
    return line.map(([x, y], i) => [x + n[i][0], y + n[i][1]]).concat(line.map(([x, y], i) => [x - n[i][0], y - n[i][1]]).reverse());
  }
  const SPIDER_LEGS = [[[0.15, -0.5], [0.72, -0.95], [1.02, -1.28]], [[0.22, -0.3], [0.92, -0.5], [1.3, -0.42]],
    [[0.24, -0.08], [0.92, 0.12], [1.3, 0.48]], [[0.2, 0.12], [0.72, 0.62], [0.98, 1.22]]];
  const ray = (a) => [[Math.cos(a) * 1.32, Math.sin(a) * 1.32], [Math.cos(a + 0.3) * 0.56, Math.sin(a + 0.3) * 0.56], [Math.cos(a - 0.3) * 0.56, Math.sin(a - 0.3) * 0.56]];
  const IMP = [{ p: [[-0.8, -0.6], [0.8, -0.6], [0.8, 0.95], [-0.8, 0.95]] }, { p: [[-0.8, -0.58], [-0.36, -0.58], [-0.74, -1.22]] }, { p: [[0.36, -0.58], [0.8, -0.58], [0.74, -1.22]] }];
  const FIGURES = {
    spider: [{ c: [0, 0.32, 0.56] }, { c: [0, -0.42, 0.33] }, ...SPIDER_LEGS.flatMap(l => [{ p: strip(l, 0.15) }, { p: strip(l.map(([x, y]) => [-x, y]), 0.15) }])],
    sun: [{ c: [0, 0, 0.64] }, ...Array.from({ length: 8 }, (_, i) => ({ p: ray(-Math.PI / 2 + i * Math.PI / 4) }))],
    flame: [{ p: [[0, -1.32], [0.2, -0.86], [0.42, -0.56], [0.54, -0.9], [0.74, -0.38], [0.88, 0.1], [0.82, 0.52], [0.6, 0.86], [0.26, 1.04],
      [-0.16, 1.04], [-0.52, 0.9], [-0.8, 0.6], [-0.9, 0.18], [-0.8, -0.22], [-0.6, -0.54], [-0.54, -0.24], [-0.36, -0.58], [-0.2, -0.98]] }],
    // a spear standing upright: leaf-shaped head, crossguard, shaft
    spear: [{ p: [[0, -1.36], [0.4, -0.78], [0.14, -0.5], [-0.14, -0.5], [-0.4, -0.78]] }, { p: [[-0.42, -0.52], [0.42, -0.52], [0.42, -0.34], [-0.42, -0.34]] },
      { p: [[-0.13, -0.4], [0.13, -0.4], [0.13, 1.32], [-0.13, 1.32]] }],
    // an imp: a square body with two small horns
    imp: IMP,
    // a throwing knife standing upright: blade, crossguard, grip, pommel
    knife: [{ p: [[0, -1.36], [0.3, -0.86], [0.24, 0.2], [-0.24, 0.2], [-0.3, -0.86]] }, { p: [[-0.6, 0.2], [0.6, 0.2], [0.6, 0.42], [-0.6, 0.42]] },
      { p: [[-0.16, 0.42], [0.16, 0.42], [0.16, 1.1], [-0.16, 1.1]] }, { c: [0, 1.16, 0.24] }],
    // a drop of water
    drop: [{ p: [[0, -1.32], [0.74, 0.02], [-0.74, 0.02]] }, { c: [0, 0.32, 0.84] }],
  };
  for (const parts of Object.values(FIGURES)) for (const pt of parts) if (pt.p) pt.p = clockwise(pt.p);

  // Points of a regular polygon; up = 1 points toward the top of the screen, -1 toward the bottom
  function poly(ctx, x, y, r, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + i * Math.PI * 2 / n;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // Builds the path for a shape. Returns true if the shape should be stroked instead of filled (ring).
  function path(ctx, shape, x, y, r, up = 1) {
    const top = up >= 0 ? -Math.PI / 2 : Math.PI / 2;
    switch (shape) {
      case 'square': ctx.beginPath(); ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76); return false;
      case 'triangle': poly(ctx, x, y + (up >= 0 ? r * 0.15 : -r * 0.15), r * 1.25, 3, top); return false;
      case 'diamond': poly(ctx, x, y, r * 1.2, 4, top); return false;
      case 'pentagon': poly(ctx, x, y, r * 1.08, 5, top); return false;
      case 'hexagon': poly(ctx, x, y, r * 1.05, 6, 0); return false;
      case 'star': {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = top + i * Math.PI / 5, rr = i % 2 ? r * 0.55 : r * 1.3;
          const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); return false;
      }
      case 'cross': {
        const a = r * 1.15, b = r * 0.42;
        ctx.beginPath();
        ctx.moveTo(x - b, y - a); ctx.lineTo(x + b, y - a); ctx.lineTo(x + b, y - b); ctx.lineTo(x + a, y - b);
        ctx.lineTo(x + a, y + b); ctx.lineTo(x + b, y + b); ctx.lineTo(x + b, y + a); ctx.lineTo(x - b, y + a);
        ctx.lineTo(x - b, y + b); ctx.lineTo(x - a, y + b); ctx.lineTo(x - a, y - b); ctx.lineTo(x - b, y - b);
        ctx.closePath(); return false;
      }
      case 'bar': ctx.beginPath(); ctx.rect(x - r * 1.3, y - r * 0.55, r * 2.6, r * 1.1); return false;
      case 'ring': ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); return true;
      case 'spider': case 'sun': case 'flame': case 'spear': case 'imp': case 'knife': case 'drop':
        ctx.beginPath();
        for (const pt of FIGURES[shape]) {
          if (pt.c) { const [cx, cy, cr] = pt.c; ctx.moveTo(x + (cx + cr) * r, y + cy * r); ctx.arc(x + cx * r, y + cy * r, cr * r, 0, Math.PI * 2); }
          else { pt.p.forEach(([px, py], i) => i ? ctx.lineTo(x + px * r, y + py * r) : ctx.moveTo(x + px * r, y + py * r)); ctx.closePath(); }
        }
        return false;
      case 'horse': ctx.beginPath(); HORSE.forEach(([px, py], i) => i ? ctx.lineTo(x + px * r, y + py * r) : ctx.moveTo(x + px * r, y + py * r)); ctx.closePath(); return false;
      default: ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); return false;
    }
  }

  // Draw a filled shape (a ring is drawn as a thick outline)
  function draw(ctx, shape, x, y, r, up = 1) {
    if (path(ctx, shape, x, y, r, up)) {
      const lw = ctx.lineWidth; ctx.lineWidth = Math.max(1.5, r * 0.45);
      ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); ctx.lineWidth = lw;
    } else ctx.fill();
  }

  // Outline only, for highlights (level outline, health ring use their own arcs)
  function outline(ctx, shape, x, y, r, up = 1) { path(ctx, shape, x, y, r, up); ctx.stroke(); }

  // Small inline SVG icon in the current text colour
  function svg(shape, size = 14) {
    const c = size / 2, r = size * 0.36;
    const pts = (n, rr, rot, cy = c) => Array.from({ length: n }, (_, i) => {
      const a = rot + i * Math.PI * 2 / n; return `${(c + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`;
    }).join(' ');
    let body;
    switch (shape) {
      case 'square': body = `<rect x="${c - r * 0.88}" y="${c - r * 0.88}" width="${r * 1.76}" height="${r * 1.76}"/>`; break;
      case 'triangle': body = `<polygon points="${pts(3, r * 1.25, -Math.PI / 2, c + r * 0.15)}"/>`; break;
      case 'diamond': body = `<polygon points="${pts(4, r * 1.2, -Math.PI / 2)}"/>`; break;
      case 'pentagon': body = `<polygon points="${pts(5, r * 1.08, -Math.PI / 2)}"/>`; break;
      case 'hexagon': body = `<polygon points="${pts(6, r * 1.05, 0)}"/>`; break;
      case 'star': body = `<polygon points="${Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.55 : r * 1.3; return `${(c + Math.cos(a) * rr).toFixed(2)},${(c + Math.sin(a) * rr).toFixed(2)}`; }).join(' ')}"/>`; break;
      case 'cross': { const a = r * 1.15, b = r * 0.42; body = `<polygon points="${[[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]].map(([px, py]) => `${(c + px).toFixed(2)},${(c + py).toFixed(2)}`).join(' ')}"/>`; break; }
      case 'bar': body = `<rect x="${c - r * 1.3}" y="${c - r * 0.55}" width="${r * 2.6}" height="${r * 1.1}"/>`; break;
      case 'horse': { const rr = r * 0.95; body = `<polygon points="${HORSE.map(([px, py]) => `${(c + px * rr).toFixed(2)},${(c + py * rr).toFixed(2)}`).join(' ')}"/>`; break; }
      case 'spider': case 'sun': case 'flame': case 'spear': case 'imp': case 'knife': case 'drop': { const rr = r * 0.95; body = FIGURES[shape].map(pt => pt.c
        ? `<circle cx="${(c + pt.c[0] * rr).toFixed(2)}" cy="${(c + pt.c[1] * rr).toFixed(2)}" r="${(pt.c[2] * rr).toFixed(2)}"/>`
        : `<polygon points="${pt.p.map(([px, py]) => `${(c + px * rr).toFixed(2)},${(c + py * rr).toFixed(2)}`).join(' ')}"/>`).join(''); break; }
      case 'ring': body = `<circle cx="${c}" cy="${c}" r="${r * 0.8}" fill="none" stroke="currentColor" stroke-width="${Math.max(1.5, r * 0.45)}"/>`; break;
      default: body = `<circle cx="${c}" cy="${c}" r="${r}"/>`;
    }
    return `<svg class="shape-icon" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="currentColor" aria-hidden="true">${body}</svg>`;
  }

  // A body: filled with the unit's colour, outlined in its team colour
  function body(ctx, shape, x, y, r, up, fill, team, fillAlpha = 1) {
    if (FIGURES[shape]) {
      // a picture made of parts: a thick team-coloured stroke underneath, so only its outer edge shows
      ctx.strokeStyle = team; ctx.lineWidth = Math.max(2, Math.min(3.5, r * 0.3)); ctx.lineJoin = 'round';
      path(ctx, shape, x, y, r, up); ctx.stroke(); ctx.lineJoin = 'miter';
      ctx.globalAlpha = fillAlpha; ctx.fillStyle = fill; draw(ctx, shape, x, y, r, up); ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = fillAlpha; ctx.fillStyle = fill;
    draw(ctx, shape, x, y, r, up);
    ctx.globalAlpha = 1; ctx.strokeStyle = team; ctx.lineWidth = Math.max(1.5, Math.min(2.5, r * 0.32));
    outline(ctx, shape, x, y, shape === 'ring' ? r * 1.05 : r + 0.6, up);
  }

  return { IMP, LIST, tag, LABELS, PALETTE, valid, validColor, assign, draw, outline, path, svg, body };
})();
