// Tournaments: players, pairings, results and standings. Draws nothing and sends nothing (the page does that), so
// it runs in node too: const Tour = require('./src/tournament.js').
//
// A tournament t = {
//   v, code, name, status: 'lobby' | 'running' | 'done',
//   settings: { format: 'swiss' | 'elim', swissRounds, cut (playoff size: 0, 2, 4 or 8), ... the match settings the page keeps },
//   players: [{ id, name, dropped }],
//   rounds: [{ n, stage: 'swiss' | 'playoff', map, matches: [{ id, a, b, code, host: 'a' | 'b', result }] }],
//   champion: player id or null }
// A match's a and b are player ids (b null: a bye, a free win). result: null, or { winner: 'a' | 'b' | 'draw', hp: [a's health,
// b's health], rounds, by: 'auto' (reported by the players' phones) or 'org' (set by the organizer) }.
// Swiss: everyone plays every round against someone on about the same score, never the same opponent twice where
// possible. A bye (odd number of players) goes to the lowest player who hasn't had one and counts as a win.
// Playoffs: single elimination; the best seeds get the byes. 'elim' is a whole tournament of it, seeded at random.
(function (root) {
  'use strict';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const POINTS = { win: 1, draw: 0.5, loss: 0 };

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const newCode = (r, n = 5) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(r() * CODE_CHARS.length)]).join('');
  const cleanName = (s) => String(s == null ? '' : s).replace(/[<>&"\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);

  // Swiss rounds for a field of n players before the playoffs: 2 up to 4 players, 3 up to 8, then 4 (an evening's worth)
  const suggestRounds = (n) => n <= 4 ? 2 : n <= 8 ? 3 : 4;
  // the playoff size that fits: top 4 from 6 players, top 8 from 14
  const suggestCut = (n) => n >= 14 ? 8 : n >= 5 ? 4 : n >= 3 ? 2 : 0;

  function create(code, name, settings) {
    return { v: 1, code, name: cleanName(name) || 'Tournament', status: 'lobby', settings: { format: 'swiss', swissRounds: 0, cut: -1, ...(settings || {}) }, players: [], rounds: [], champion: null, seed: (Math.random() * 1e9) >>> 0, created: Date.now() };
  }
  const player = (t, id) => t.players.find(p => p.id === id) || null;
  const nameOf = (t, id) => (player(t, id) || { name: id ? '?' : 'Bye' }).name;
  const active = (t) => t.players.filter(p => !p.dropped);
  // the number of Swiss rounds and the playoff size this tournament uses (0 in settings = suggested)
  const swissRounds = (t) => t.settings.format === 'elim' ? 0 : (t.settings.swissRounds > 0 ? t.settings.swissRounds : suggestRounds(t.players.length));
  const cutSize = (t) => {
    if (t.settings.format === 'elim') return t.players.length;
    const c = t.settings.cut >= 0 ? t.settings.cut : suggestCut(t.players.length);
    return c >= 2 ? Math.min(c, t.players.length) : 0;
  };

  function join(t, id, name) {
    let p = player(t, id);
    if (p) { if (t.status === 'lobby' && cleanName(name)) p.name = uniqueName(t, cleanName(name), id); return p; }
    if (t.status !== 'lobby') return null; // late players: the organizer adds them before the start
    p = { id, name: uniqueName(t, cleanName(name) || 'Player ' + (t.players.length + 1), id), dropped: false };
    t.players.push(p);
    return p;
  }
  function uniqueName(t, name, id) {
    let out = name, k = 2;
    while (t.players.some(p => p.id !== id && p.name.toLowerCase() === out.toLowerCase())) out = (name.slice(0, 15) + ' ' + k++);
    return out;
  }
  function rename(t, id, name) { const p = player(t, id), n = cleanName(name); if (!p || !n) return false; p.name = uniqueName(t, n, id); return true; }
  function remove(t, id) { // before the start: gone; after: dropped (no more pairings, results so far stay)
    if (t.status === 'lobby') { const k = t.players.findIndex(p => p.id === id); if (k < 0) return false; t.players.splice(k, 1); return true; }
    const p = player(t, id); if (!p) return false; p.dropped = true; return true;
  }

  const allMatches = (t, stage) => t.rounds.filter(r => !stage || r.stage === stage).flatMap(r => r.matches);
  const sideOf = (mt, id) => mt.a === id ? 'a' : mt.b === id ? 'b' : null;
  const other = (s) => s === 'a' ? 'b' : 'a';
  // what a finished match was for one of its players: 'win', 'loss', 'draw' (a bye is a win); null while it is on
  function outcome(mt, id) {
    const s = sideOf(mt, id);
    if (!s) return null;
    if (mt.b == null) return 'win';
    if (!mt.result) return null;
    if (mt.result.winner === 'draw') return 'draw';
    return mt.result.winner === s ? 'win' : 'loss';
  }

  // Standings from the Swiss rounds (all rounds in an 'elim' tournament): points, then Buchholz (the opponents'
  // points added up), then health difference (own health left minus the opponent's, over all games), then wins
  function standings(t) {
    const stage = t.settings.format === 'elim' ? null : 'swiss';
    const ms = allMatches(t, stage);
    const row = (p) => ({ id: p.id, name: p.name, dropped: !!p.dropped, played: 0, wins: 0, draws: 0, losses: 0, byes: 0, points: 0, hpDiff: 0, opps: [], buchholz: 0 });
    const rows = new Map(t.players.map(p => [p.id, row(p)]));
    for (const mt of ms) for (const id of [mt.a, mt.b]) {
      const r = rows.get(id), o = id == null ? null : outcome(mt, id);
      if (!r || !o) continue;
      r.played++;
      if (mt.b == null) { r.byes++; r.wins++; r.points += POINTS.win; continue; }
      r[o === 'win' ? 'wins' : o === 'loss' ? 'losses' : 'draws']++;
      r.points += POINTS[o];
      const s = sideOf(mt, id), hp = mt.result.hp || [0, 0];
      r.hpDiff += s === 'a' ? (hp[0] | 0) - (hp[1] | 0) : (hp[1] | 0) - (hp[0] | 0);
      r.opps.push(s === 'a' ? mt.b : mt.a);
    }
    for (const r of rows.values()) r.buchholz = r.opps.reduce((n, id) => n + (rows.get(id) ? rows.get(id).points : 0), 0);
    return [...rows.values()].sort((x, y) => (x.dropped - y.dropped) || (y.points - x.points) || (y.buchholz - x.buchholz) || (y.hpDiff - x.hpDiff) || (y.wins - x.wins) || x.name.localeCompare(y.name));
  }

  const played = (t, a, b) => allMatches(t).some(mt => (mt.a === a && mt.b === b) || (mt.a === b && mt.b === a));
  const hosted = (t, id) => allMatches(t).filter(mt => mt.b != null && mt[mt.host || 'a'] === id).length;

  // Swiss pairing: the field in standings order, the bye to the lowest without one, then each player against the
  // highest one left they haven't met (backtracking when that paints the bottom into a corner; a rematch only if there is no other way)
  function pairSwiss(t) {
    const order = standings(t).filter(r => !r.dropped).map(r => r.id);
    let bye = null;
    if (order.length % 2) {
      const had = new Set(allMatches(t).filter(mt => mt.b == null).map(mt => mt.a));
      for (let k = order.length - 1; k >= 0; k--) if (!had.has(order[k])) { bye = order[k]; break; }
      if (bye == null) bye = order[order.length - 1];
      order.splice(order.indexOf(bye), 1);
    }
    const tryPair = (list, allowRe) => {
      if (!list.length) return [];
      const [x, ...rest] = list;
      for (let k = 0; k < rest.length; k++) {
        if (!allowRe && played(t, x, rest[k])) continue;
        const sub = tryPair(rest.filter((_, j) => j !== k), allowRe);
        if (sub) return [[x, rest[k]], ...sub];
      }
      return null;
    };
    const pairs = tryPair(order, false) || tryPair(order, true) || [];
    const out = pairs.map(([x, y]) => [x, y]);
    if (bye != null) out.push([bye, null]);
    return out;
  }

  // the standard bracket order for a bracket of size n (a power of 2): 1 v n, and the top two seeds meet in the final
  function bracketOrder(n) {
    let o = [1];
    while (o.length < n) { const m = o.length * 2 + 1; o = o.flatMap(s => [s, m - s]); }
    return o;
  }
  // the first playoff round from the seeds (player ids, best first): byes for the top seeds when the field isn't a power of 2
  function playoffFirst(seeds) {
    let n = 1; while (n < seeds.length) n *= 2;
    const o = bracketOrder(n), out = [];
    for (let k = 0; k < n; k += 2) {
      const x = seeds[o[k] - 1] || null, y = seeds[o[k + 1] - 1] || null;
      if (x == null && y == null) continue;
      out.push(x == null ? [y, null] : [x, y]);
    }
    return out;
  }
  const winnerOf = (mt) => mt.b == null ? mt.a : mt.result && mt.result.winner !== 'draw' ? mt[mt.result.winner] : null;

  // a round is done when every match has a result; a playoff match also needs a winner (a draw is played again)
  const roundDone = (r) => !!r && r.matches.every(mt => mt.b == null || (mt.result && (r.stage !== 'playoff' || mt.result.winner !== 'draw')));
  const current = (t) => t.rounds[t.rounds.length - 1] || null;

  // what comes after the current round: { stage: 'swiss' | 'playoff', pairs } or { done: true, champion }
  function nextPlan(t) {
    const swissDone = t.rounds.filter(r => r.stage === 'swiss').length;
    if (t.settings.format !== 'elim' && swissDone < swissRounds(t)) return { stage: 'swiss', pairs: pairSwiss(t) };
    const po = t.rounds.filter(r => r.stage === 'playoff');
    if (!po.length) {
      const n = cutSize(t);
      if (n < 2) { const top = standings(t)[0]; return { done: true, champion: top ? top.id : null }; }
      let seeds;
      if (t.settings.format === 'elim') { // seeded at random, from the tournament's seed
        const r = rng(t.seed + 99); seeds = active(t).map(p => p.id);
        for (let i = seeds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [seeds[i], seeds[j]] = [seeds[j], seeds[i]]; }
      } else seeds = standings(t).filter(r => !r.dropped).slice(0, n).map(r => r.id);
      return { stage: 'playoff', pairs: playoffFirst(seeds) };
    }
    const last = po[po.length - 1], win = last.matches.map(winnerOf);
    if (win.length <= 1) return { done: true, champion: win[0] || null };
    const pairs = [];
    for (let k = 0; k < win.length; k += 2) pairs.push(win[k + 1] === undefined ? [win[k], null] : [win[k], win[k + 1]]);
    return { stage: 'playoff', pairs };
  }

  // Starts the next round (or ends the tournament). rnd: a random function for the match codes (Math.random by default)
  function advance(t, rnd) {
    const r0 = current(t);
    if (t.status === 'done' || (r0 && !roundDone(r0))) return false;
    if (!r0 && active(t).length < 2) return false;
    const plan = nextPlan(t);
    t.status = 'running';
    if (plan.done) { t.status = 'done'; t.champion = plan.champion; return true; }
    const r = rnd || Math.random, used = new Set(allMatches(t).map(mt => mt.code));
    const round = { n: t.rounds.length + 1, stage: plan.stage, map: '', matches: [] };
    for (const [a, b] of plan.pairs) {
      let code; do code = newCode(r); while (used.has(code)); used.add(code);
      const mt = { id: 'm' + round.n + '-' + (round.matches.length + 1), a, b, code, host: 'a', result: null };
      if (b != null && hosted(t, b) < hosted(t, a)) mt.host = 'b'; // take turns hosting
      round.matches.push(mt);
    }
    t.rounds.push(round);
    return true;
  }

  const findMatch = (t, matchId) => { for (const r of t.rounds) for (const mt of r.matches) if (mt.id === matchId) return { round: r, match: mt }; return null; };
  // A result from a phone (by 'auto') or the organizer (by 'org'). winner: 'a', 'b' or 'draw'. The organizer's always
  // counts; a phone's counts unless the organizer already set one. Two phones that disagree mark the match for the organizer.
  function report(t, matchId, winner, hp, rounds, by) {
    const f = findMatch(t, matchId);
    if (!f || f.match.b == null || !['a', 'b', 'draw'].includes(winner)) return false;
    const mt = f.match, res = { winner, hp: Array.isArray(hp) ? [hp[0] | 0, hp[1] | 0] : [0, 0], rounds: rounds | 0, by: by === 'org' ? 'org' : 'auto' };
    if (res.by === 'auto' && mt.result) {
      if (mt.result.by === 'org') return false;
      if (mt.result.winner !== winner) { mt.conflict = true; return true; }
      return false;
    }
    mt.result = res; delete mt.conflict;
    return true;
  }
  // the organizer clears a match to have it played again: a new code, no result
  function replay(t, matchId, rnd) {
    const f = findMatch(t, matchId);
    if (!f || f.match.b == null || f.round !== current(t)) return false;
    const used = new Set(allMatches(t).map(mt => mt.code)); let code;
    do code = newCode(rnd || Math.random); while (used.has(code));
    f.match.code = code; f.match.result = null; delete f.match.conflict;
    return true;
  }
  function swapHost(t, matchId) { const f = findMatch(t, matchId); if (!f || f.match.b == null || f.match.result) return false; f.match.host = other(f.match.host || 'a'); return true; }
  // the organizer takes back a round nobody has a result in yet (to fix the field and pair again)
  function undoRound(t) {
    const r = current(t);
    if (!r || r.matches.some(mt => mt.b != null && mt.result)) return false;
    t.rounds.pop();
    if (!t.rounds.length) t.status = 'lobby';
    return true;
  }

  // the player's match in the current round (null if none, or a bye: { match, bye: true })
  function matchOf(t, id) {
    const r = current(t);
    if (!r || t.status !== 'running') return null;
    const mt = r.matches.find(x => x.a === id || x.b === id);
    return mt ? { round: r, match: mt, side: sideOf(mt, id), bye: mt.b == null } : null;
  }
  // the playoff rounds as a bracket: [{ name, matches }] with names like Final, Semifinals
  function bracket(t) {
    const po = t.rounds.filter(r => r.stage === 'playoff');
    if (!po.length) return [];
    let size = 1; while (size < po[0].matches.length * 2) size *= 2;
    const total = Math.round(Math.log2(size));
    return po.map((r, k) => {
      const left = total - k; // rounds still to go including this one
      return { name: left === 1 ? 'Final' : left === 2 ? 'Semifinals' : left === 3 ? 'Quarterfinals' : 'Round of ' + Math.pow(2, left), round: r };
    });
  }
  // the order the players finished in, once it's done: the champion, the runner-up, then by how far they got, then standings
  function placings(t) {
    const st = standings(t), pos = new Map(st.map((r, k) => [r.id, k]));
    const reach = new Map(); // playoff rounds survived
    t.rounds.filter(r => r.stage === 'playoff').forEach((r, k) => r.matches.forEach(mt => { for (const id of [mt.a, mt.b]) if (id != null) reach.set(id, k + (winnerOf(mt) === id ? 1 : 0)); }));
    return st.slice().sort((x, y) => ((y.id === t.champion) - (x.id === t.champion)) || ((reach.get(y.id) ?? -1) - (reach.get(x.id) ?? -1)) || (pos.get(x.id) - pos.get(y.id)));
  }

  const api = { CODE_CHARS, POINTS, rng, newCode, cleanName, suggestRounds, suggestCut, create, join, rename, remove, player, nameOf, active, swissRounds, cutSize,
    standings, pairSwiss, bracketOrder, playoffFirst, nextPlan, advance, report, replay, swapHost, undoRound, roundDone, current, matchOf, findMatch, bracket, placings, outcome, winnerOf, sideOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Tour = api;
})(typeof window !== 'undefined' ? window : globalThis);
