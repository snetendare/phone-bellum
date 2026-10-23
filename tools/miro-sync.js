#!/usr/bin/env node
// Draws the factions board in Miro from the repo: src/factions.json, src/default-roster.json and src/keywords.json.
// Every item (unit, skill, building, tower, Power, spell) is tagged with keywords: from its stats and skill types
// (rules below and keywords.json "skillTypes"), plus design intent from keywords.json "items". The board is then
// redrawn: frames whose title starts with "Notes" (and what is in them) are kept, everything else is replaced.
//
//   node tools/miro-sync.js --json            print the keyword model (no network)
//   node tools/miro-sync.js --preview out.svg write a rough picture of the layout (no network)
//   MIRO_TOKEN=... node tools/miro-sync.js     redraw the board (board id from keywords.json board.miro or MIRO_BOARD)
//
// Run by .github/workflows/miro-sync.yml on every push to main that touches these files. See docs/MIRO-SYNC.md.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

// ---------------------------------------------------------------- model

function buildModel() {
  const KW = readJson('src/keywords.json');
  const FX = readJson('src/factions.json');
  const RO = readJson('src/default-roster.json');
  const families = KW.families;
  const known = new Map();
  families.forEach((f) => f.keywords.forEach((k) => known.set(k.name, { ...k, family: f.name, color: f.color })));
  const warnings = [];
  const items = [];

  const mk = (o) => {
    const it = { has: new Set(), makes: new Set(), feeds: new Set(), counter: new Set(), why: '', note: '', ...o };
    items.push(it);
    return it;
  };
  const tag = (it, rel, kws) => {
    for (const k of kws || []) {
      if (!k) continue;
      if (!known.has(k)) { warnings.push(`${it.name}: unknown keyword "${k}" (add it to src/keywords.json)`); continue; }
      it[rel].add(k);
    }
  };
  const num = (v) => +v || 0;
  // a unit's own stats
  const unitTags = (it, u) => {
    if (!u) return;
    if (u.defense === 'armor' && num(u.defVal) > 0) tag(it, 'has', ['Armor']);
    if (u.defense === 'ward' && num(u.defVal) > 0) tag(it, 'has', ['Ward']);
    if (num(u.shield) > 0) tag(it, 'has', ['Shield']);
    if (num(u.roll) > 0 || num(u.trample) > 0) tag(it, 'has', ['Run-through']);
    if (num(u.knockback) > 0) tag(it, 'makes', ['Displace']);
    if (num(u.splash) > 0 || num(u.flame) > 0 || num(u.beams) > 1) tag(it, 'has', ['Splash']);
    if (num(u.spinUp) > 0 || num(u.turrets) > 1) tag(it, 'has', ['Attack speed']);
    if (u.build) tag(it, 'has', ['Builder']), tag(it, 'makes', ['Construct']);
    if (u.disguise) tag(it, 'has', ['Disguise']);
    if (num(u.deathBlast) > 0) tag(it, 'has', ['Death effects']);
    if (num(u.flee) > 0) tag(it, 'has', ['Kite']);
    if (u.spawn) tag(it, 'makes', ['Spawn']);
    if (num(u.mend) > 0) tag(it, 'makes', ['Heal and repair']);
  };
  // stat changes in % (and armor flat): Powers, traits, auras, blessings
  const modTags = (it, m, rel = 'has') => {
    if (!m) return;
    if (num(m.hp) > 0) tag(it, rel, ['Health boost']);
    if (num(m.hit) > 0) tag(it, rel, ['Damage boost']);
    if (num(m.aps) > 0) tag(it, rel, ['Attack speed']);
    if (num(m.range) > 0) tag(it, rel, ['Range boost']);
    if (num(m.speed) > 0) tag(it, rel, ['Move speed']);
    if (num(m.armor) > 0) tag(it, rel, ['Armor']);
  };
  const skillTags = (it, def, params) => {
    const st = (KW.skillTypes || {})[def.type];
    if (!st) warnings.push(`${it.name}: skill type "${def.type}" has no entry in keywords.json skillTypes`);
    else for (const rel of ['has', 'makes', 'feeds']) tag(it, rel, st[rel]);
    if (def.type === 'builder') {
      const p = params || {};
      if (num(p.extra) > 0) tag(it, 'makes', ['Construct']);
      if (num(p.faster) > 0 || num(p.aps) > 0 || num(p.shield) > 0 || num(p.armor) > 0) tag(it, 'feeds', ['Construct']);
      if (num(p.aps) > 0) tag(it, 'has', ['Attack speed']);
      if (num(p.shield) > 0) tag(it, 'has', ['Shield']);
      if (num(p.armor) > 0) tag(it, 'has', ['Armor']);
    }
  };
  const params = (def, mod) => ({ ...(def.params || {}), ...((mod && mod.params) || {}) });
  const paramText = (p) => Object.entries(p).filter(([k, v]) => typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(', ');
  const unitLine = (u) => [u.bodies > 1 ? `${u.bodies} bodies` : '1 body', `${u.hp} health`, u.hit ? `hit ${u.hit}` : 'no attack', u.range ? `range ${u.range}` : ''].filter(Boolean).join(', ');

  const owners = [];
  const spellOwner = new Map(); // spell id -> owner id (whoever has the Power that unlocks it)
  for (const f of FX.factions || []) for (const p of f.powers || []) if (p.spell) spellOwner.set(p.spell, f.id);
  for (const p of ((FX.neutral || {}).powers || [])) if (p.spell && !spellOwner.has(p.spell)) spellOwner.set(p.spell, 'neutral');

  const lesserItem = (owner, b) => {
    const it = mk({ owner, name: b.name, kind: 'Lesser building', gold: 0, text: b.text || '' });
    tag(it, 'has', ['Lesser building']);
    if (b.onDestroyed) tag(it, 'makes', ['When destroyed']);
    if (b.aura) tag(it, 'makes', ['Aura']), modTags(it, b.aura);
    if (num(b.income) > 0) tag(it, 'makes', ['Income']);
    if (b.spawn) tag(it, 'makes', ['Spawn']);
    unitTags(it, b.unit);
    return it;
  };
  const powerItem = (owner, p) => {
    const it = mk({ owner, name: p.name, kind: 'Power', gold: 0, text: p.text || '' });
    modTags(it, p.mods);
    if (num(p.gold) > 0) tag(it, 'makes', ['Income']);
    if (num(p.deploys) > 0) tag(it, 'makes', ['Extra deploys']);
    if (num(p.buildingHp) > 0) tag(it, 'feeds', ['Lesser building']);
    const sp = (FX.spells || []).find((s) => s.id === p.spell);
    if (sp) spellTags(it, sp, 'makes');
    return it;
  };
  const spellTags = (it, s, rel) => {
    if (s.kind === 'wall') return tag(it, rel, ['Walls']);
    tag(it, rel, ['Tile spells']);
    if (s.effect === 'burn') tag(it, rel, ['Burn']);
    if (s.effect === 'mend') tag(it, rel, ['Heal and repair']);
    if (s.effect === 'mud') tag(it, rel, ['Slow']);
    if (s.effect === 'haste') tag(it, rel, ['Move speed']);
  };
  const spellItems = (owner) => (FX.spells || []).filter((s) => (spellOwner.get(s.id) || 'neutral') === owner).map((s) => {
    const it = mk({ owner, name: s.name, kind: 'Spell', gold: num(s.cost), text: s.text || '' });
    spellTags(it, s, 'has');
    return it;
  });

  // factions
  const fSkills = new Map((FX.skills || []).map((s) => [s.id, s]));
  const fBuildings = FX.buildings || [];
  for (const f of FX.factions || []) {
    const o = { id: f.id, name: f.name, color: f.color, placeholder: /PLACEHOLDER/.test(f.theme || ''), theme: f.theme || '', sections: [] };
    owners.push(o);
    if (f.trait) {
      const it = mk({ owner: f.id, name: f.trait.name, kind: 'Trait', gold: 0, text: f.trait.text || '' });
      modTags(it, f.trait);
      o.sections.push({ title: 'Trait', stacks: [{ card: it }] });
    } else o.sections.push({ title: 'Trait', slot: 'none yet: a change for all its units' });

    const unitStacks = [], buildingStacks = [], viaSkill = new Map(); // building id -> skill item that places it
    for (const u of f.units || []) {
      if (u.building) continue; // a building bought in the shop (the Altar of Build): drawn with the buildings
      const it = mk({ owner: f.id, name: u.name, kind: 'Unit', gold: num(u.cost), text: `${num(u.cost)} gold, unlock ${num(u.unlock)}. ${unitLine(u)}.` });
      unitTags(it, u);
      if (u.build && u.build.unit) it.text += ` Builds a ${u.build.unit.name || 'turret'} once a fight.`;
      const kids = (u.skills || []).map((id, j) => {
        const d = fSkills.get(id);
        if (!d) return null;
        const need = (u.skillNeeds || [])[j];
        const s = mk({ owner: f.id, name: d.name, kind: 'Unit skill', gold: num(d.cost), text: `${num(d.cost)} gold. ${paramText(d.params || {}) || ''}${need ? ' Needs the others first.' : ''}`.trim(), parent: u.name });
        skillTags(s, d, d.params);
        if (d.type === 'building' && d.params && d.params.building) viaSkill.set(d.params.building, { skill: s, unit: u.name });
        return s;
      }).filter(Boolean);
      unitStacks.push({ card: it, kids });
    }
    o.sections.push({ title: 'Units, bought in the shop', stacks: unitStacks });

    for (const b of fBuildings.filter((b) => b.faction === f.id)) {
      const shopUnit = (f.units || []).find((u) => u.building === b.id);
      const via = viaSkill.get(b.id);
      const how = shopUnit ? `${num(shopUnit.cost)} gold in the shop, unlock ${num(shopUnit.unlock)}` : via ? `${via.unit} skill ${via.skill.name}, ${via.skill.gold} gold` : '';
      const it = mk({ owner: f.id, name: b.name, kind: 'Built building', gold: shopUnit ? num(shopUnit.cost) : via ? via.skill.gold : 0, text: `${how}. ${b.hp} health, ${b.buildSecs} s of building.` });
      tag(it, 'has', ['Built building', 'Construct']);
      tag(it, 'feeds', ['Builder']);
      const kids = (b.skills || []).map((s) => {
        const k = mk({ owner: f.id, name: s.name, kind: 'Sold by a building', gold: num(s.cost), text: `${num(s.cost)} gold. ${s.text || (s.unit ? unitLine(s.unit) : '')}`, parent: b.name });
        if (s.unit) { tag(k, 'has', ['Construct']); unitTags(k, s.unit); tag(it, 'makes', ['Spawn']); }
        if (s.make) tag(k, 'makes', ['Spawn', 'Construct']);
        if (s.bless) {
          tag(k, 'feeds', ['Construct']);
          modTags(k, s.bless);
          if (num(s.bless.regen) > 0) tag(k, 'makes', ['Heal and repair']);
        }
        if (s.awake) {
          tag(k, 'feeds', ['Built building']);
          tag(k, 'has', ['Transform']);
          unitTags(k, s.awake.built);
          fBuildings.filter((x) => x.faction === f.id && x.awake).forEach((x) => unitTags(k, x.awake));
        }
        return k;
      });
      buildingStacks.push({ card: it, kids });
    }
    if (buildingStacks.length) o.sections.push({ title: 'Built buildings, finished by builders during fights', stacks: buildingStacks });

    if (f.tower) {
      const t = f.tower;
      const it = mk({ owner: f.id, name: t.name, kind: 'Powertower', gold: 0, text: `${(t.unit || {}).hp || ''} health. ${t.text || ''}` });
      unitTags(it, t.unit);
      if (t.awake) tag(it, 'has', ['Transform']);
      const kids = (t.rounds || []).map((r) => {
        const k = mk({ owner: f.id, name: r.name, kind: 'Bought each round', gold: num(r.cost), text: `${num(r.cost)} gold each round. ${r.text || ''}`, parent: t.name });
        const bot = r.bots && r.bots.unit && r.bots.unit.bot;
        if (bot === 'mine') tag(k, 'makes', ['Mines']);
        if (bot === 'repair') tag(k, 'makes', ['Heal and repair']), tag(k, 'feeds', ['Built building', 'Lesser building']);
        return k;
      });
      o.sections.push({ title: 'Powertower', stacks: [{ card: it, kids, slot: t.gem ? null : 'Powergem: not designed yet', gem: t.gem || null }] });
    }

    const lessers = (f.buildings || []).map((b) => ({ card: lesserItem(f.id, b) }));
    o.sections.push(lessers.length ? { title: 'Lesser buildings, a round pick', stacks: lessers } : { title: 'Lesser buildings, a round pick', slot: 'none yet: picks fall back to the neutral ones' });
    const powers = (f.powers || []).map((p) => ({ card: powerItem(f.id, p) }));
    o.sections.push(powers.length ? { title: 'Powers, a round pick', stacks: powers } : { title: 'Powers, a round pick', slot: 'none yet: picks fall back to the neutral ones' });
    const spells = spellItems(f.id).map((s) => ({ card: s }));
    if (spells.length) o.sections.push({ title: 'Spells its Powers unlock', stacks: spells });
  }

  // neutral pool
  const NT = FX.neutral || {};
  const rSkills = new Map((RO.skills || []).map((s) => [s.id, s]));
  const no = { id: 'neutral', name: 'Neutral pool', color: '#8a8a7e', placeholder: false, theme: 'Open to every faction. Devtest round picks fall back to these when a faction has none.', sections: [] };
  owners.push(no);
  const nStacks = [];
  for (const nu of NT.units || []) {
    const u = typeof nu === 'string' ? (RO.units || []).find((x) => x.name === nu) : nu;
    if (!u) { warnings.push(`neutral unit "${nu}" is not in the roster`); continue; }
    const it = mk({ owner: 'neutral', name: u.name, kind: 'Unit', gold: num(u.cost), text: `${num(u.cost)} gold once picked. ${unitLine(u)}.` });
    unitTags(it, u);
    const kids = [];
    (u.skills || []).forEach((id, j) => {
      const d = rSkills.get(id);
      if (!d) return;
      const mod = (u.skillMods || [])[j];
      const innate = (u.skillsInnate || [])[j];
      if (innate) { skillTags(it, d, params(d, mod)); it.text += ` ${d.name} (innate).`; return; }
      const cost = mod && mod.cost != null ? num(mod.cost) : num(d.cost);
      const s = mk({ owner: 'neutral', name: d.name, kind: 'Unit skill', gold: cost, text: `${cost} gold. ${paramText(params(d, mod))}`.trim(), parent: u.name });
      skillTags(s, d, params(d, mod));
      kids.push(s);
    });
    nStacks.push({ card: it, kids });
  }
  no.sections.push({ title: 'Neutral units, a round pick that unlocks the unit', stacks: nStacks });
  no.sections.push({ title: 'Lesser buildings, a round pick', stacks: (NT.buildings || []).map((b) => ({ card: lesserItem('neutral', b) })) });
  no.sections.push({ title: 'Powers, a round pick', stacks: (NT.powers || []).map((p) => ({ card: powerItem('neutral', p) })) });
  no.sections.push({ title: 'Spells, unlocked by Powers and cast on a tile for gold', stacks: spellItems('neutral').map((s) => ({ card: s })) });

  // design intent from keywords.json
  const extra = KW.items || {};
  for (const [name, x] of Object.entries(extra)) {
    if (name.startsWith('_')) continue;
    const hits = items.filter((it) => it.name === name);
    if (!hits.length) warnings.push(`keywords.json items: "${name}" is not on the board`);
    for (const it of hits) {
      tag(it, 'has', x.has); tag(it, 'makes', x.makes); tag(it, 'feeds', x.feeds); tag(it, 'counter', x.counteredBy);
      for (const k of x.not || []) ['has', 'makes', 'feeds', 'counter'].forEach((r) => it[r].delete(k));
      if (x.why) it.why = x.why;
    }
  }
  // a keyword an item makes or feeds on doesn't also need to be listed as one it has
  for (const it of items) for (const k of [...it.has]) if (it.makes.has(k) || it.feeds.has(k)) it.has.delete(k);
  return { KW, families, known, owners, items, warnings };
}

// per owner: keyword -> { items (that have, make or feed on it), makes, feeds, counter (items) }
function touches(model, owner) {
  const out = new Map();
  const get = (k) => out.get(k) || out.set(k, { items: [], makes: false, feeds: false, counter: [] }).get(k);
  for (const it of model.items.filter((i) => i.owner === owner)) {
    for (const rel of ['has', 'makes', 'feeds']) for (const k of it[rel]) {
      const t = get(k);
      if (!t.items.includes(it)) t.items.push(it);
      if (rel === 'makes') t.makes = true;
      if (rel === 'feeds') t.feeds = true;
    }
    for (const k of it.counter) get(k).counter.push(it);
  }
  return out;
}

// ---------------------------------------------------------------- layout
// Everything is placed in board coordinates (top-left of each box). Frames own the items inside them.

const INK = '#1a1a1a', BODY = '#595959', GREY = '#b0b0b0';
const SHORT = { 'Mechite Guards': 'Guards', 'Master engineering': 'Master eng.', 'Cogbot Fighter': 'Fighter', 'Cogbot Machinegunner': 'Machinegunner', 'Blessing of the Cycle': 'Blessing', 'Cogbot Defensive Force': 'Defensive Force', 'Altar of Build': 'Altar' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// rough text height: characters per line from the width and font size
function textHeight(lines, width, size) {
  const per = Math.max(10, Math.floor((width - 24) / (size * 0.56)));
  const n = lines.reduce((s, l) => s + Math.max(1, Math.ceil(l.replace(/<[^>]+>/g, '').length / per)), 0);
  return Math.ceil(n * size * 1.45 + 28);
}

function layout(model) {
  const nodes = []; // { t: frame|shape|text|line, key, frame, ... }
  let n = 0;
  const key = () => `n${++n}`;
  const frame = (title, x, y, w, h) => { const f = { t: 'frame', key: key(), title, x, y, w, h }; nodes.push(f); return f; };
  const shape = (fr, o) => { const s = { t: 'shape', key: key(), frame: fr && fr.key, fx: fr ? fr.x : 0, fy: fr ? fr.y : 0, size: 16, align: 'left', valign: 'top', ink: INK, round: true, ...o }; nodes.push(s); return s; };
  const text = (fr, x, y, w, content, size = 20, bold = false, ink = INK) => { const s = { t: 'text', key: key(), frame: fr && fr.key, fx: fr ? fr.x : 0, fy: fr ? fr.y : 0, x, y, w, h: textHeight([content], w + 24, size) - 28, content: bold ? `<strong>${content}</strong>` : content, size, ink }; nodes.push(s); return s; };
  const line = (a, b, o) => nodes.push({ t: 'line', key: key(), a: a.key, b: b.key, ...o });

  const fam = new Map(model.families.map((f) => [f.name, f]));
  const kwLine = (it) => {
    const parts = [];
    if (it.has.size) parts.push([...it.has].join(', '));
    if (it.makes.size) parts.push(`makes ${[...it.makes].join(', ')}`);
    if (it.feeds.size) parts.push(`feeds on ${[...it.feeds].join(', ')}`);
    if (it.counter.size) parts.push(`countered by ${[...it.counter].join(', ')}`);
    return parts.length ? `Keywords: ${parts.join('; ')}` : 'Keywords: none yet';
  };
  const cardLines = (it) => [`<strong>${esc(it.name)}</strong>`, esc(it.text), esc(kwLine(it))].filter((l) => l && l !== '<strong></strong>');

  // which keywords anything on the board touches
  const used = new Set();
  model.items.forEach((it) => ['has', 'makes', 'feeds', 'counter'].forEach((r) => it[r].forEach((k) => used.add(k))));

  // --- keyword spine (its rows set the y of every link pill)
  const left = model.owners.find((o) => o.id === model.KW.board.left);
  const right = model.owners.find((o) => o.id === model.KW.board.right);
  const kwRows = new Map();
  let y = 200;
  const spineRows = [];
  for (const f of model.families) {
    spineRows.push({ family: f, y });
    y += 44;
    for (const k of f.keywords) { kwRows.set(k.name, y); y += 68; }
    y += 20;
  }
  const spineH = y + 44;

  // --- one faction frame (cards in columns of 520, sections stacked top to bottom)
  const COLW = 520, GAP = 32;
  const drawOwner = (o, fx, fy, contentX, cols, ifaceX) => {
    const fr = frame(o.name, fx, fy, 0, 0);
    text(fr, contentX, 40, cols * COLW + (cols - 1) * GAP, esc(o.name) + (o.placeholder ? ' (placeholder)' : ''), 48, true);
    text(fr, contentX, 112, cols * COLW + (cols - 1) * GAP, esc(o.theme), 20, false, BODY);
    const light = o.id === 'neutral' ? '#f7f7f7' : '#fff5ed', mid = o.id === 'neutral' ? GREY : '#fe9f4d', paper = o.id === 'neutral' ? '#f7f7f7' : '#f8d3af';
    let cy = 200;
    for (const sec of o.sections) {
      text(fr, contentX, cy, cols * COLW + (cols - 1) * GAP, esc(sec.title), 26, true);
      cy += 50;
      if (sec.slot) {
        shape(fr, { x: contentX, y: cy, w: COLW, h: 80, content: esc(sec.slot), fill: '#ffffff', border: GREY, dash: true, ink: BODY });
        cy += 80 + 48;
        continue;
      }
      const stacks = sec.stacks || [];
      for (let i = 0; i < stacks.length; i += cols) {
        let rowH = 0;
        stacks.slice(i, i + cols).forEach((st, j) => {
          const x = contentX + j * (COLW + GAP);
          const it = st.card;
          const isBld = /building|Powertower/i.test(it.kind);
          const lines = cardLines(it);
          const h = Math.max(110, textHeight(lines, COLW, 16));
          shape(fr, { x, y: cy, w: COLW, h, content: lines.join('<br>'), fill: isBld ? paper : light, border: mid, round: !isBld, item: it });
          let sy = cy + h + 16;
          for (const k of st.kids || []) {
            const kl = cardLines(k);
            const kh = Math.max(90, textHeight(kl, COLW, 16));
            shape(fr, { x, y: sy, w: COLW, h: kh, content: kl.join('<br>'), fill: '#ffffff', border: o.id === 'neutral' ? GREY : '#f8d3af', item: k });
            sy += kh + 16;
          }
          if (st.slot) { shape(fr, { x, y: sy, w: COLW, h: 70, content: esc(st.slot), fill: '#ffffff', border: GREY, dash: true, ink: BODY }); sy += 86; }
          if (st.gem) { shape(fr, { x, y: sy, w: COLW, h: 70, content: `<strong>Powergem</strong> ${esc(st.gem)}`, fill: '#ffffff', border: mid }); sy += 86; }
          rowH = Math.max(rowH, sy - cy);
        });
        cy += rowH + 16;
      }
      cy += 32;
    }
    fr.contentH = cy;
    // the links column
    const pills = [];
    if (ifaceX != null) {
      text(fr, ifaceX, 112, 440, 'Links to keywords', 20, true);
      for (const [k, t] of touches(model, o.id)) {
        if (!kwRows.has(k)) continue;
        const rel = t.makes && t.feeds ? 'makes and feeds on' : t.makes ? 'makes' : t.feeds ? 'feeds on' : t.items.length ? 'has or gives' : 'countered by';
        const names = (arr) => { const s = arr.map((i) => SHORT[i.name] || i.name).join(', '); return s.length > 60 ? s.slice(0, 57).replace(/,[^,]*$/, '') + ' and more' : s; };
        let content = t.items.length ? `<strong>${esc(k)}, ${t.items.length}</strong>  ${rel}<br>${esc(names(t.items))}` : `<strong>${esc(k)}</strong>  countered by<br>${esc(t.counter.map((i) => i.why || i.name).join('; '))}`;
        if (t.items.length && t.counter.length) content += `<br>countered: ${esc(t.counter.map((i) => i.name).join(', '))}`;
        const linked = t.makes || t.feeds;
        const p = shape(fr, { x: ifaceX, y: kwRows.get(k), w: 440, h: 56, content, size: 14, valign: 'middle', fill: linked ? light : '#ffffff', border: t.counter.length && !t.items.length ? '#bd0a0a' : (o.id === 'neutral' ? BODY : '#fe9f4d') });
        pills.push({ k, t, p });
      }
    }
    return { fr, pills };
  };

  // positions: legend | left | keywords | right | profiles; other factions below
  const L_W = 1040, SP_W = 1040, GAPF = 320;
  const leftW = 64 + 3 * COLW + 2 * GAP + 96 + 440 + 64; // 2288
  const rightW = 64 + 440 + 96 + 3 * COLW + 2 * GAP + 64;
  const legend = frame('How to read', -L_W - GAPF, 0, L_W, 0);
  const L = left ? drawOwner(left, 0, 0, 64, 3, 64 + 3 * COLW + 2 * GAP + 96) : null;
  const spX = leftW + GAPF;
  const spine = frame('Keywords', spX, 0, SP_W, 0);
  const rX = spX + SP_W + GAPF;
  const R = right ? drawOwner(right, rX, 0, 64 + 440 + 96, 3, 64) : null;
  const pX = rX + rightW + GAPF;

  // keyword pills
  text(spine, 64, 40, 900, 'Keywords', 48, true);
  text(spine, 64, 112, 912, 'Shared by every faction. Fill colour is the family. Dashed means nothing on the board has it yet.', 20, false, BODY);
  const kwShape = new Map();
  for (const r of spineRows) {
    text(spine, 64, r.y, 600, esc(r.family.name), 22, true);
    for (const k of r.family.keywords) {
      const on = used.has(k.name);
      kwShape.set(k.name, shape(spine, { x: 64, y: kwRows.get(k.name), w: 912, h: 56, content: `<strong>${esc(k.name)}</strong>   ${esc(k.text)}`, size: 18, valign: 'middle', fill: on ? r.family.color : '#ffffff', border: on ? r.family.color : GREY, dash: !on, ink: on ? INK : BODY }));
    }
  }
  // lines: makes (pill -> keyword), feeds on (keyword -> pill, dashed), both (two arrowheads), countered by (red dotted)
  for (const [side, S, col] of [['left', L, '#9b4a08'], ['right', R, BODY]]) {
    if (!S) continue;
    for (const { k, t, p } of S.pills) {
      const kw = kwShape.get(k);
      const ps = side === 'left' ? 'right' : 'left', ks = side === 'left' ? 'left' : 'right';
      if (t.makes && t.feeds) line(p, kw, { from: ps, to: ks, color: col, style: 'normal', start: 'arrow', end: 'arrow' });
      else if (t.makes) line(p, kw, { from: ps, to: ks, color: col, style: 'normal', start: 'none', end: 'arrow' });
      else if (t.feeds) line(kw, p, { from: ks, to: ps, color: col, style: 'dashed', start: 'none', end: 'arrow' });
      if (t.counter.length) line(kw, p, { from: ks, to: ps, color: '#bd0a0a', style: 'dotted', start: 'none', end: 'arrow' });
    }
  }

  // legend
  {
    const f = legend;
    text(f, 64, 40, 912, 'How to read', 48, true);
    text(f, 64, 112, 912, 'This board is drawn from the repo (src/factions.json, src/default-roster.json, src/keywords.json) on every push to main. Edits made here are replaced; write notes in a frame whose title starts with Notes, which is kept.', 20, false, BODY);
    text(f, 64, 260, 912, 'Shape is the kind of thing', 26, true);
    const kinds = [['Unit', '#fff5ed', '#fe9f4d', true, false], ['Building or tower', '#f8d3af', '#fe9f4d', false, false], ['Skill, pick, spell, or something a building sells', '#ffffff', '#f8d3af', true, false], ['Open slot, not designed yet', '#ffffff', GREY, true, true]];
    kinds.forEach(([label, fill, border, round, dash], i) => {
      shape(f, { x: 64, y: 310 + i * 96, w: 240, h: 80, content: `<strong>${label.split(',')[0]}</strong>`, fill, border, round, dash, align: 'center', valign: 'middle' });
      text(f, 336, 334 + i * 96, 640, label, 20);
    });
    text(f, 64, 720, 912, '"Keywords:" on a card means it has or gives that keyword. Those get no line.', 20);
    text(f, 64, 810, 912, 'Lines are what a faction offers or needs', 26, true);
    const rels = [['Makes it: puts it on the board for any faction to use', 'makes'], ['Feeds on it: gets a payoff from it', 'feeds'], ['Makes it and feeds on it', 'both'], ['Countered by it: it hurts this faction', 'counter']];
    rels.forEach(([label, rel], i) => {
      const yy = 860 + i * 96;
      const a = shape(f, { x: 64, y: yy, w: 180, h: 56, content: 'Item', fill: '#fff5ed', border: rel === 'counter' ? '#bd0a0a' : '#fe9f4d', align: 'center', valign: 'middle' });
      const b = shape(f, { x: 384, y: yy, w: 180, h: 56, content: 'Keyword', fill: '#ffcf99', border: '#ffcf99', align: 'center', valign: 'middle' });
      text(f, 596, yy + 4, 380, label, 18);
      if (rel === 'makes') line(a, b, { from: 'right', to: 'left', color: '#9b4a08', style: 'normal', start: 'none', end: 'arrow' });
      if (rel === 'both') line(a, b, { from: 'right', to: 'left', color: '#9b4a08', style: 'normal', start: 'arrow', end: 'arrow' });
      if (rel === 'feeds') line(b, a, { from: 'left', to: 'right', color: '#9b4a08', style: 'dashed', start: 'none', end: 'arrow' });
      if (rel === 'counter') line(b, a, { from: 'left', to: 'right', color: '#bd0a0a', style: 'dotted', start: 'none', end: 'arrow' });
    });
    text(f, 64, 1260, 912, 'Line colour is whose line it is: dark orange for the faction on the left, grey for the one on the right. Red dotted is always a counter.', 20);
    text(f, 64, 1370, 912, 'Numbers and profiles', 26, true);
    text(f, 64, 1420, 912, 'The number after a keyword in a faction\'s column is how many of its items have, give, make or feed on it. A white pill with no line means the faction only has or gives it. Faction profiles, right of the keywords, add these up per family as bars.', 20);
    text(f, 64, 1600, 912, 'Changing what is shown', 26, true);
    text(f, 64, 1650, 912, 'Keywords, families and what each skill type gives: src/keywords.json. Design intent the stats can\'t show (a counter, a payoff): its "items" list. Which factions sit either side of the keywords: its "board". Then push to main.', 20);
    if (model.warnings.length) {
      text(f, 64, 1830, 912, 'Data the sync could not place', 26, true);
      text(f, 64, 1880, 912, esc(model.warnings.slice(0, 12).join('. ')), 18, false, '#bd0a0a');
    }
  }

  // profiles: one block per owner, a bar per family
  const prof = frame('Faction profiles', pX, 0, 1880, 0);
  text(prof, 64, 40, 1700, 'Faction profiles', 48, true);
  text(prof, 64, 112, 1700, 'How many items have, give, make or feed on a keyword in each family. It counts items, not how strong they are.', 20, false, BODY);
  const counts = model.owners.map((o) => {
    const t = touches(model, o.id);
    return { o, fams: model.families.map((f) => { const parts = f.keywords.filter((k) => t.has(k.name) && t.get(k.name).items.length).map((k) => [k.name, t.get(k.name).items.length]); return { f, parts, total: parts.reduce((s, p) => s + p[1], 0) }; }), counter: [...t].filter(([k, v]) => v.counter.length).map(([k, v]) => `${k} (${v.counter.map((i) => i.why || i.name).join('; ')})`) };
  });
  const maxC = Math.max(1, ...counts.flatMap((c) => c.fams.map((x) => x.total)));
  const UNIT = Math.min(28, Math.floor(640 / maxC));
  let py = 220;
  for (const c of counts) {
    const nItems = model.items.filter((i) => i.owner === c.o.id).length;
    text(prof, 64, py, 1700, `${esc(c.o.name)}${c.o.placeholder ? ' (placeholder)' : ''}, ${nItems} items`, 30, true);
    py += 64;
    for (const x of c.fams) {
      text(prof, 64, py + 2, 240, esc(x.f.name), 20);
      if (x.total) shape(prof, { x: 320, y: py, w: x.total * UNIT, h: 32, content: '', fill: x.f.color, border: x.f.color });
      else shape(prof, { x: 320, y: py, w: UNIT, h: 32, content: '', fill: '#ffffff', border: GREY, dash: true });
      text(prof, 1000, py + 2, 816, x.total ? `<strong>${x.total}</strong>   ${esc(x.parts.sort((a, b) => b[1] - a[1]).map((p) => p.join(' ')).join(', '))}` : '<strong>0</strong>', 18, false, x.total ? INK : BODY);
      py += 48;
    }
    text(prof, 64, py + 8, 1700, c.counter.length ? `Countered by: ${esc(c.counter.join(', '))}` : 'Countered by: nothing noted yet.', 20, false, BODY);
    py += 140;
  }

  // factions not beside the keywords: below, cards only
  const parked = model.owners.filter((o) => o !== left && o !== right);
  const rowH = Math.max(spineH, L ? L.fr.contentH : 0, R ? R.fr.contentH : 0, py, 2200);
  for (const f of [legend, spine, prof]) f.h = rowH;
  if (L) L.fr.w = leftW, L.fr.h = rowH;
  if (R) R.fr.w = rightW, R.fr.h = rowH;
  let px = legend.x;
  const parkedY = rowH + 320;
  for (const o of parked) {
    const S = drawOwner(o, px, parkedY, 64, 3, null);
    S.fr.w = 64 + 3 * COLW + 2 * GAP + 64;
    S.fr.h = S.fr.contentH + 32;
    px += S.fr.w + GAPF;
  }
  return nodes;
}

// ---------------------------------------------------------------- preview (rough, for checking the layout)

function preview(nodes, file) {
  const frames = nodes.filter((n) => n.t === 'frame');
  const minX = Math.min(...frames.map((f) => f.x)) - 100, minY = Math.min(...frames.map((f) => f.y)) - 100;
  const maxX = Math.max(...frames.map((f) => f.x + f.w)) + 100, maxY = Math.max(...frames.map((f) => f.y + f.h)) + 100;
  const at = (n) => [n.fx + n.x, n.fy + n.y];
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const strip = (s) => esc(String(s).replace(/<br>/g, ' | ').replace(/<[^>]+>/g, '')).slice(0, 90);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${Math.round((maxX - minX) / 4)}" height="${Math.round((maxY - minY) / 4)}" style="background:#eee;font-family:sans-serif">`];
  for (const f of frames) out.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="#fff" stroke="#999" stroke-width="4"/><text x="${f.x}" y="${f.y - 12}" font-size="40">${esc(f.title)}</text>`);
  for (const n of nodes) {
    if (n.t === 'shape') { const [x, y] = at(n); out.push(`<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="${n.round ? 12 : 0}" fill="${n.fill}" stroke="${n.border}" stroke-width="2" ${n.dash ? 'stroke-dasharray="8,8"' : ''}/><text x="${x + 8}" y="${y + 22}" font-size="16">${strip(n.content)}</text>`); }
    if (n.t === 'text') { const [x, y] = at(n); out.push(`<text x="${x}" y="${y + n.size}" font-size="${n.size}" fill="${n.ink}">${strip(n.content)}</text>`); }
  }
  for (const n of nodes.filter((n) => n.t === 'line')) {
    const a = byKey.get(n.a), b = byKey.get(n.b);
    const [ax, ay] = at(a), [bx, by] = at(b);
    const ex = (s, x, w) => (s === 'right' ? x + w : x);
    out.push(`<line x1="${ex(n.from, ax, a.w)}" y1="${ay + a.h / 2}" x2="${ex(n.to, bx, b.w)}" y2="${by + b.h / 2}" stroke="${n.color}" stroke-width="3" ${n.style !== 'normal' ? 'stroke-dasharray="6,6"' : ''}/>`);
  }
  out.push('</svg>');
  fs.writeFileSync(file, out.join('\n'));
}

// ---------------------------------------------------------------- Miro REST

async function sync(nodes, boardId, token) {
  const base = `https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}`;
  const call = async (method, url, body, tries = 5) => {
    for (let i = 0; ; i++) {
      const r = await fetch(url.startsWith('http') ? url : base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 429 && i < tries) { await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); continue; }
      if (r.status === 404 && method === 'DELETE') return null;
      const txt = await r.text();
      if (!r.ok && method === 'DELETE') { console.warn(`could not delete ${url}: ${r.status} ${txt.slice(0, 200)}`); return null; }
      if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${txt.slice(0, 400)}`);
      return txt ? JSON.parse(txt) : null;
    }
  };
  const pool = async (list, fn, n = 4) => { const q = list.slice(); await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); };
  const all = async (url) => { const out = []; let cursor = ''; do { const r = await call('GET', `${url}${url.includes('?') ? '&' : '?'}limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); out.push(...(r.data || [])); cursor = r.cursor || ''; } while (cursor); return out; };

  // 1. clear the board, keeping frames titled "Notes..." and what is in them
  const items = await all('/items');
  const keep = new Set(items.filter((i) => i.type === 'frame' && /^notes/i.test((i.data && i.data.title) || '')).map((i) => i.id));
  const inKeep = (i) => keep.has(i.id) || (i.parent && keep.has(i.parent.id));
  const doomed = items.filter((i) => !inKeep(i));
  const connectors = await all('/connectors');
  await pool(connectors.filter((c) => !(c.startItem && keep.has(c.startItem.id))), (c) => call('DELETE', `/connectors/${c.id}`));
  await pool(doomed.filter((i) => i.type !== 'frame'), (i) => call('DELETE', `/items/${i.id}`));
  await pool(doomed.filter((i) => i.type === 'frame'), (i) => call('DELETE', `/items/${i.id}`));
  console.log(`cleared ${doomed.length} items and ${connectors.length} connectors, kept ${items.length - doomed.length}`);

  // 2. draw. Miro positions are the item's centre, relative to the frame's top-left inside a frame.
  const ids = new Map();
  const frames = nodes.filter((n) => n.t === 'frame');
  for (const f of frames) {
    const r = await call('POST', '/frames', { data: { format: 'custom', title: f.title, type: 'freeform' }, style: { fillColor: '#ffffff' }, position: { x: f.x + f.w / 2, y: f.y + f.h / 2 }, geometry: { width: f.w, height: f.h } });
    ids.set(f.key, r.id);
  }
  if (!keep.size) {
    const right = Math.max(...frames.map((f) => f.x + f.w));
    await call('POST', '/frames', { data: { format: 'custom', title: 'Notes', type: 'freeform' }, style: { fillColor: '#fffbed' }, position: { x: right + 320 + 600, y: 600 }, geometry: { width: 1200, height: 1200 } });
  }
  const shapes = nodes.filter((n) => n.t === 'shape' || n.t === 'text');
  await pool(shapes, async (n) => {
    const parent = n.frame ? { id: ids.get(n.frame) } : undefined;
    if (n.t === 'shape') {
      const r = await call('POST', '/shapes', {
        data: { shape: n.round ? 'round_rectangle' : 'rectangle', content: n.content ? `<p>${n.content}</p>` : '' },
        style: { fillColor: n.fill, fillOpacity: '1.0', borderColor: n.border, borderWidth: '2.0', borderOpacity: '1.0', borderStyle: n.dash ? 'dashed' : 'normal', fontFamily: 'noto_sans', fontSize: String(n.size), color: n.ink, textAlign: n.align, textAlignVertical: n.valign },
        position: { x: n.x + n.w / 2, y: n.y + n.h / 2 }, geometry: { width: n.w, height: n.h }, parent,
      });
      ids.set(n.key, r.id);
    } else {
      const r = await call('POST', '/texts', {
        data: { content: `<p>${n.content}</p>` }, style: { color: n.ink, fontFamily: 'noto_sans', fontSize: String(n.size), textAlign: 'left' },
        position: { x: n.x + n.w / 2, y: n.y + n.h / 2 }, geometry: { width: n.w }, parent,
      });
      ids.set(n.key, r.id);
    }
  });
  const lines = nodes.filter((n) => n.t === 'line');
  await pool(lines, (n) => call('POST', '/connectors', {
    startItem: { id: ids.get(n.a), snapTo: n.from }, endItem: { id: ids.get(n.b), snapTo: n.to }, shape: 'straight',
    style: { strokeColor: n.color, strokeWidth: '3.0', strokeStyle: n.style, startStrokeCap: n.start, endStrokeCap: n.end },
  }));
  console.log(`drew ${frames.length} frames, ${shapes.length} shapes and texts, ${lines.length} lines`);
}

// ---------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  const model = buildModel();
  model.warnings.forEach((w) => console.warn('warning:', w));
  if (args.includes('--json')) {
    const out = model.items.map((it) => ({ owner: it.owner, name: it.name, kind: it.kind, gold: it.gold, has: [...it.has], makes: [...it.makes], feeds: [...it.feeds], counteredBy: [...it.counter] }));
    console.log(JSON.stringify(out, null, 1));
    return;
  }
  const nodes = layout(model);
  const pi = args.indexOf('--preview');
  if (pi >= 0) { preview(nodes, args[pi + 1] || 'miro-preview.svg'); console.log(`preview: ${nodes.length} nodes`); return; }
  const token = process.env.MIRO_TOKEN;
  if (!token) { console.log('No MIRO_TOKEN set, so the board was not changed. See docs/MIRO-SYNC.md for the one-time setup.'); return; }
  await sync(nodes, process.env.MIRO_BOARD || model.KW.board.miro, token);
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });
module.exports = { buildModel, touches, layout };
