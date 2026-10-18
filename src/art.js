// ===== Shared art: the palette and the small pictures used both on the board and in the HTML panels =====
const Art = (() => {
  // the page's CSS colour variables, read once: getComputedStyle is slow, and they never change
  const cssCache = {};
  const css = (n) => n in cssCache ? cssCache[n] : (cssCache[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim());
  const ELF_COL = '#D8E68C'; // the neutral elf tower and its arrows
  // a side's colour as the screen of side `me` shows it: yours, the opponent's, or the elves' (side 2)
  const teamCol = (side, me) => side === 2 ? ELF_COL : side === me ? css('--you') : css('--foe');
  // mushroom tiles, by type
  const SHROOM_COL = { purple: '#B57BFF', yellow: '#F2D25C', green: '#7BD66A' };
  // Matteo's charisma
  const CHARM_COL = '#FF7AB6';
  // Each character's coat of arms: a field colour and a bold charge, drawn on a small shield.
  // Shield coordinates: 1 wide, from -0.55 (top) to 0.65 (the point), centred on (0, 0).
  const ARMS = {
    cage: { field: '#A8323C', charge: '#F2C94C', draw(g) { // a heart: more health
      g.beginPath(); g.moveTo(0, 0.38); g.bezierCurveTo(-0.5, 0.02, -0.32, -0.36, 0, -0.14); g.bezierCurveTo(0.32, -0.36, 0.5, 0.02, 0, 0.38); g.fill(); } },
    zoe: { field: '#6B43A6', charge: '#F2C94C', draw(g) { // a star: the buff tiles
      g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 0.15 : 0.36; g.lineTo(rr * Math.cos(a), 0.04 + rr * Math.sin(a)); } g.closePath(); g.fill(); } },
    emile: { field: '#2F7D4A', charge: '#EDEFF2', draw(g) { // a key: free unlocks
      g.lineWidth = 0.1; g.beginPath(); g.arc(0, -0.2, 0.13, 0, Math.PI * 2); g.stroke();
      g.fillRect(-0.05, -0.08, 0.1, 0.5); g.fillRect(0.05, 0.2, 0.13, 0.08); g.fillRect(0.05, 0.33, 0.1, 0.08); } },
    wilhelm: { field: '#2E5C8A', charge: '#EDEFF2', draw(g) { // a saltire: attacks from the flanks
      g.lineWidth = 0.16; g.lineCap = 'butt'; g.beginPath(); g.moveTo(-0.5, -0.55); g.lineTo(0.42, 0.5); g.moveTo(0.5, -0.55); g.lineTo(-0.42, 0.5); g.stroke(); } },
    blixten: { field: '#E2B23A', charge: '#1E1E24', draw(g) { // a lightning bolt
      g.beginPath(); g.moveTo(0.12, -0.46); g.lineTo(-0.24, 0.06); g.lineTo(-0.02, 0.06); g.lineTo(-0.14, 0.5); g.lineTo(0.26, -0.06); g.lineTo(0.04, -0.06); g.closePath(); g.fill(); } },
    noah: { field: '#1F7272', charge: '#EDEFF2', draw(g) { // two chevrons: squads that start at level 2
      g.lineWidth = 0.12; g.lineJoin = 'miter'; g.beginPath(); for (const dy of [-0.12, 0.16]) { g.moveTo(-0.3, dy + 0.14); g.lineTo(0, dy - 0.14); g.lineTo(0.3, dy + 0.14); } g.stroke(); } },
    phil: { field: '#2A2A36', charge: '#F2C94C', draw(g) { // a crown: the top tier
      g.beginPath(); g.moveTo(-0.32, 0.22); g.lineTo(-0.34, -0.2); g.lineTo(-0.16, 0.0); g.lineTo(0, -0.28); g.lineTo(0.16, 0.0); g.lineTo(0.34, -0.2); g.lineTo(0.32, 0.22); g.closePath(); g.fill();
      g.fillRect(-0.32, 0.27, 0.64, 0.08); } },
    yotyot: { field: '#3A1E16', charge: '#FFA94D', draw(g) { // the Ember Imp: a horned square
      g.beginPath(); for (const pt of Shapes.IMP) pt.p.forEach(([px, py], i) => i ? g.lineTo(px * 0.3, 0.06 + py * 0.3) : g.moveTo(px * 0.3, 0.06 + py * 0.3)); g.fill(); } },
    mubarak: { field: '#245C2A', charge: '#8BEA4A', draw(g) { // a crowned slime blob
      g.beginPath(); g.moveTo(-0.34, 0.38); g.quadraticCurveTo(-0.4, -0.06, -0.12, -0.1); g.quadraticCurveTo(0, -0.16, 0.12, -0.1); g.quadraticCurveTo(0.4, -0.06, 0.34, 0.38); g.closePath(); g.fill();
      g.fillStyle = '#F2C94C'; g.beginPath(); g.moveTo(-0.2, -0.14); g.lineTo(-0.22, -0.4); g.lineTo(-0.1, -0.26); g.lineTo(0, -0.44); g.lineTo(0.1, -0.26); g.lineTo(0.22, -0.4); g.lineTo(0.2, -0.14); g.closePath(); g.fill();
      g.fillStyle = '#245C2A'; for (const ex of [-0.12, 0.12]) { g.beginPath(); g.arc(ex, 0.12, 0.05, 0, Math.PI * 2); g.fill(); } } },
    felix: { field: '#3E6B2F', charge: '#F2C94C', draw(g) { // a stack of coins: more gold
      for (const dy of [0.3, 0.12, -0.06]) { g.beginPath(); g.ellipse(0, dy, 0.28, 0.1, 0, 0, Math.PI * 2); g.fill(); }
      g.lineWidth = 0.035; g.strokeStyle = '#3E6B2F'; for (const dy of [0.3, 0.12, -0.06]) { g.beginPath(); g.ellipse(0, dy, 0.28, 0.1, 0, 0, Math.PI * 2); g.stroke(); } } },
    enzo: { field: '#5A2E6E', charge: '#EDEFF2', draw(g) { // a die: a random skill
      g.beginPath(); g.roundRect(-0.3, -0.26, 0.6, 0.6, 0.08); g.fill();
      g.fillStyle = '#5A2E6E'; for (const [px, py] of [[-0.15, -0.11], [0, 0.04], [0.15, 0.19]]) { g.beginPath(); g.arc(px, py, 0.06, 0, Math.PI * 2); g.fill(); } } },
    matteo: { field: '#5B1F3A', charge: '#EDEFF2', draw(g) { // a top hat with a pink band: the Gentleman
      g.fillRect(-0.38, 0.22, 0.76, 0.1); g.fillRect(-0.22, -0.34, 0.44, 0.58);
      g.fillStyle = '#FF7AB6'; g.fillRect(-0.22, 0.06, 0.44, 0.1); } },
  };
  function arms(g, id, x, y, w) {
    const a = ARMS[id]; if (!a) return;
    const shield = () => { g.beginPath(); g.moveTo(-0.5, -0.55); g.lineTo(0.5, -0.55); g.lineTo(0.5, 0.05); g.quadraticCurveTo(0.5, 0.45, 0, 0.65); g.quadraticCurveTo(-0.5, 0.45, -0.5, 0.05); g.closePath(); };
    g.save(); g.translate(x, y); g.scale(w, w);
    shield(); g.fillStyle = a.field; g.fill();
    g.save(); g.clip(); g.fillStyle = a.charge; g.strokeStyle = a.charge; a.draw(g); g.restore();
    shield(); g.lineWidth = Math.max(0.09, 1 / w); g.strokeStyle = '#15151B'; g.stroke();
    g.restore();
  }
  // a coat of arms on a little swallowtailed flag flying right from (x, y) on a pole, w wide, edged in edge (a team colour)
  function armsFlag(g, id, x, y, w, edge) {
    const a = ARMS[id]; if (!a) return;
    const h = w * 0.68;
    const flag = () => { g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(w * 0.5, -h * 0.14, w, 0); g.lineTo(w * 0.8, h * 0.5); g.lineTo(w, h); g.quadraticCurveTo(w * 0.5, h * 0.86, 0, h); g.closePath(); };
    g.save(); g.translate(x, y);
    flag(); g.fillStyle = a.field; g.fill();
    g.save(); g.clip(); g.translate(w * 0.4, h * 0.52); g.scale(h * 0.95, h * 0.95); g.fillStyle = a.charge; g.strokeStyle = a.charge; a.draw(g); g.restore();
    flag(); g.lineWidth = Math.max(1, w * 0.09); g.lineJoin = 'round'; g.strokeStyle = edge; g.stroke();
    g.restore();
  }
  // a coat of arms as an image, for the character lines in the panels
  const armsImgs = {};
  function armsImg(id) {
    if (!ARMS[id]) return '';
    if (armsImgs[id] == null) {
      const oc = document.createElement('canvas'); oc.width = 40; oc.height = 48;
      const g = oc.getContext('2d'); arms(g, id, 20, 22.5, 34);
      armsImgs[id] = oc.toDataURL();
    }
    return `<img src="${armsImgs[id]}" alt="" width="14" height="17" style="vertical-align:-3px;margin-right:4px">`;
  }
  // a little keep with battlements, in the team colour c. kind: 'keep', 'outpost' (a smaller keep), 'sniper' (tall
  // and skinny, a yellow stripe), 'bastion' (wide and squat, a shield on the front), 'bank', 'slime' or 'mage'.
  // hpr: health left (fades it), crest: the owner's character id, drawn on a small shield on the tower's corner
  function keep(ctx, x, y, s, c, hpr, kind, crest) {
    const tt = [Game.OUTPOST, ...Game.TOWER_TYPES].find(k => k.id === kind) || Game.TOWER_TYPES[0];
    ctx.globalAlpha = 0.35 + 0.65 * (hpr == null ? 1 : hpr);
    ctx.fillStyle = tt.unit.color; ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, s * 0.08);
    const [w, h, n] = tt.id === 'sniper' ? [s * 0.36, s * 0.74, 3] : tt.id === 'bastion' ? [s * 0.86, s * 0.54, 7] : tt.id === 'outpost' ? [s * 0.46, s * 0.5, 5] : tt.id === 'mage' ? [s * 0.5, s * 0.5, 5] : tt.id === 'bank' ? [s * 0.74, s * 0.52, 7] : tt.id === 'slime' ? [s * 0.56, s * 0.56, 5] : [s * 0.62, s * 0.62, 5];
    const x0 = x - w / 2, y0 = y - h / 2 + s * 0.06, m = w / n, mh = Math.min(m, s * 0.124) * 0.9;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + h); ctx.lineTo(x0, y0);
    for (let k = 0; k < n; k++) { const xa = x0 + k * m; if (k % 2 === 0) { ctx.lineTo(xa, y0 - mh); ctx.lineTo(xa + m, y0 - mh); ctx.lineTo(xa + m, y0); } else ctx.lineTo(xa + m, y0); }
    ctx.lineTo(x0 + w, y0 + h); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (tt.id === 'sniper') { // a yellow band across the top, a slit window below it
      ctx.fillStyle = '#F2C94C'; ctx.fillRect(x0 + ctx.lineWidth / 2, y0 + h * 0.18, w - ctx.lineWidth, h * 0.14);
      ctx.fillStyle = c; ctx.fillRect(x - w * 0.09, y0 + h * 0.5, w * 0.18, h * 0.3);
    } else if (tt.id === 'bastion') { // a shield in the team colour
      const sw = h * 0.68, sh = h * 0.78, sx = x - sw / 2, sy = y0 + h * 0.12;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(sx + sw, sy); ctx.lineTo(sx + sw, sy + sh * 0.5);
      ctx.quadraticCurveTo(sx + sw, sy + sh * 0.85, x, sy + sh); ctx.quadraticCurveTo(sx, sy + sh * 0.85, sx, sy + sh * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = tt.unit.color; ctx.fillRect(x - sw * 0.07, sy + sh * 0.12, sw * 0.14, sh * 0.62); ctx.fillRect(sx + sw * 0.2, sy + sh * 0.3, sw * 0.6, sh * 0.13);
    } else if (tt.id === 'bank') { // a gold coin in the team colour over a door
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y0 + h * 0.36, h * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tt.unit.color; ctx.font = `700 ${Math.max(6, h * 0.34)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', x, y0 + h * 0.38);
      ctx.fillStyle = c; ctx.fillRect(x - m * 0.5, y0 + h - m * 1.1, m, m * 1.1);
    } else if (tt.id === 'slime') { // slime dripping down from the battlements, a round door
      ctx.fillStyle = '#3FA81E'; ctx.beginPath(); ctx.moveTo(x0, y0);
      for (let k = 0; k <= 4; k++) { const xa = x0 + w * k / 4; ctx.lineTo(xa, y0 + h * (k % 2 ? 0.34 : 0.18)); }
      ctx.lineTo(x0 + w, y0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y0 + h - m * 0.5, m * 0.6, Math.PI, 0); ctx.lineTo(x + m * 0.6, y0 + h); ctx.lineTo(x - m * 0.6, y0 + h); ctx.closePath(); ctx.fill();
    } else if (tt.id === 'mage') { // a pointed wizard roof in the team colour with a star, and an arched door
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x0 - w * 0.12, y0 - mh); ctx.lineTo(x + w * 0.08, y0 - mh - h * 0.95); ctx.lineTo(x0 + w * 1.12, y0 - mh); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#F2C94C'; ctx.beginPath(); const sx = x + w * 0.02, sy = y0 - mh - h * 0.36, sr = Math.max(1.5, s * 0.07);
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? sr * 0.45 : sr; ctx.lineTo(sx + rr * Math.cos(a), sy + rr * Math.sin(a)); } ctx.closePath(); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - m * 0.5, y0 + h); ctx.lineTo(x - m * 0.5, y0 + h - m * 1.1); ctx.arc(x, y0 + h - m * 1.1, m * 0.5, Math.PI, 0); ctx.lineTo(x + m * 0.5, y0 + h); ctx.closePath(); ctx.fill();
    } else { ctx.fillStyle = c; ctx.fillRect(x - m * 0.5, y0 + h - m * 1.6, m, m * 1.6); }
    if (crest) arms(ctx, crest, x + Math.min(w / 2, s * 0.28), y + s * 0.18, Math.max(8, s * 0.38));
    ctx.globalAlpha = 1;
  }
  return { css, teamCol, ELF_COL, SHROOM_COL, CHARM_COL, ARMS, arms, armsFlag, armsImg, keep };
})();
