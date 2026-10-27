# Roguelike solo mode: plan (draft, 2026-10-27)

Status: plan only, nothing built or pushed. Open questions for Vilhelm are at the end.

## The idea in one paragraph

A solo run is a chain of fights on a branching map, like Slay the Spire, but the "deck" is your army on the board. Your squads, levels, skills, buildings and Powers carry over from fight to fight. Before each fight you see (most of) the enemy army, so every node is a small counter puzzle: what do I add, move, level or sell to beat this? Wins give a pick of rewards; losses cost life but don't end the run until life hits 0. Each act ends in a boss that is a real multi-round match against the AI.

Why it fits: the game's core is already "read the enemy, counter it". In versus play the opponent hides this round's squads; in the roguelike the enemy is mostly known up front, so the fun moves from guessing to building and solving. Almost every system we have (packages, leaders, towers, skills, Powers, lesser buildings, spells, neutral units, the deterministic engine) becomes run content without new rules.

## A run

- 3 acts, about 8 nodes each, then a boss. Target length: 25 to 35 minutes on a phone (a node is roughly 1 minute deploy plus a 30 s fight).
- Start: pick 1 of 3 packages (as now: 2 units, free squads, a leader) and 1 of 3 tower types. Later, with factions: pick 1 faction instead of 2.
- Life: 60, shared across the run (Game.START_HP). A lost fight costs the usual survivor damage (capped at MAX_ROUND_DMG, maybe lower in act 1). 0 life ends the run.
- Gold: each node gives income (like a round), plus rewards. Unspent gold carries over. No loser bonus; maybe interest later (Mechabellum doesn't have it, but it rewards planning in a solo run).
- Army: persists, positions included. You redeploy the usual way each node: new squads, the 50-gold move, selling, leveling, skills. Squads keep XP and levels.
- Deployment cap: same as a match (CONFIG.deploysPerRound), so the army grows at a match-like pace.

## The map

- Branching paths of nodes, 3 to 4 lanes wide, seeded from the run seed (so a run can be shared or replayed).
- You see the node types ahead, and the enemy "theme" of battle nodes (for example "Goblin horde", "Sniper nest"), not the exact army.

Node types:

| Node | What happens |
|---|---|
| Battle | A fixed enemy army. Win: pick 1 of 3 rewards plus gold. |
| Elite | A stronger army with 1 or 2 hidden squads (placed after you, as in versus). Better rewards, often a Power. |
| Shop | Buy units, unlocks, skills, levels and spells at a discount; remove a squad for a refund. |
| Camp | Choose one: heal life, level a squad for free, or retrain (swap a skill). |
| Event | A short choice with a trade-off (for example: lose 10 life, gain a neutral unit). Text only, cheap to make. |
| Treasure | A free Power (relic). |
| Boss | A real match of several rounds against the AI with its own life total (see below). |

## Enemies

Battle nodes use encounter templates, not the plain AI, so each one has an identity the player can read and counter.

```json
{ "id": "sniper-nest", "name": "Sniper nest", "act": 1, "weight": 1,
  "core": ["Sniper", "Sniper"], "fill": ["Brute", "Goblin Swarm"],
  "budget": 1.0, "hidden": 0, "place": "back", "tower": "keep",
  "rewardBias": "power" }
```

- core: squads that are always there (the identity). fill: the rest of the budget, chosen and placed by the AI (aiSpot already does placement).
- budget: multiplier on the node's budget curve (depth in the run sets the base). Levels and skills come in from act 2.
- hidden: squads placed after the player deploys (elites). place: a placement style for the core (front, back, flank, spread).
- Buildings, spells and Powers from factions.json can be added to templates later (a "fortress" encounter with walls and a mend zone).
- Fairness check: a script runs each template against the counter table and flags ones that no unit in the pool beats. Another runs the bot through 500 seeded runs and reports win rate per act, so the difficulty curve is measured, not guessed.

Bosses: a normal match against the AI (aiDeploy, which already reacts to your army), with its own life (for example 40, 60, 80 per act) and a head start in gold and levels. You keep your run life; the boss fight ends when either side reaches 0. Each boss has a rule twist, for example: a leader's ability, a tower type with both skills, or a faction trait. This is where the existing versus game shines, and it needs almost no new code.

## Rewards

After a battle: pick 1 of 3. The pool reuses what exists:

- Unit: unlock a unit, or a free squad of one you have.
- Skill: a free skill for a unit you field.
- Level: a free level for a squad.
- Power: from the devtest Powers (factions.json). These are the run's relics: permanent and stacking.
- Lesser building: from the devtest buildings, placed on your zone.
- Spell: unlocks a spell to cast each node for gold.
- Gold.

Leaders (characters) work as the run's starting relic. Rarity (common / rare / boss) can be a field on Powers and buildings; until it exists, rewards draw evenly.

## Meta progression (light, optional)

- Unlocks between runs: leaders, tower types, then factions, unlocked by reaching act 2, beating a boss and so on. Saved on the device.
- Ascension: after a win, a harder level (enemy budget +10%, less healing, elites with more hidden squads).
- Daily run: one seed per day for everyone. The deterministic engine makes this nearly free; a leaderboard would need a backend, so later.

## How it fits the code

- New file src/run.js (draws nothing, like game.js): run state, map generation, node resolution, reward offers, encounter building, save and load. Exported as Run, testable in node.
- Each battle node is a one-round match: Game.createMatch with a new opts.run, the player's army copied in as side 0, the encounter built into side 1 (aiSpot for placement), then the usual fight and Game.resolve. After the fight, side 0's state (army, tech, levels, buildings, gold) is copied back into the run. Bosses are the same with more rounds.
- Picks reuse the devtest pick card UI (devOffer / devPick), with the run as the source of offers instead of DEV.schedule.
- Data: src/run.json with encounters, events, boss definitions and the budget curve. Powers, buildings and spells stay in factions.json.
- Save: the run state in localStorage after every node (iPhone Safari drops background tabs), "Continue run" on the start screen.
- UI: a map screen (vertical, scrolls, nodes as icons), reward cards, the shop sheet, an event card. The board, tray and fights are unchanged.
- Hidden squads for elites reuse the "placed this round" hiding from versus play.

## Enemy units

The enemy-only units and bosses are in `src/roguelike-enemies.json` (same fields as `default-roster.json`, plus `apply`: skill definitions the run applies with `Engine.applySkills`). Stats are first guesses. `act`, `role`, `twist`, `place` and `elite` are for the encounter builder. Two things are not in yet: Burrowers coming up underground (for now they come in from a flank) and the Gold Leech's run rule.

New fight mechanics in `src/engine.js` (any unit can use them; they do nothing unless a unit has the field):

| Field | Unit | What it does |
|---|---|---|
| `deathZone: { r, dps, secs }` | Plague Carriers | Where a body falls, a poison patch of radius `r` m: its enemies in it take `dps` a second (past armor) for `secs` s. Drawn as a pool on both boards. |
| `aura: { radius, hit, aps, pct, armor }` | Bannerman | The existing aura (Reforge) gets `pct` (+% hit size) and `armor` (+flat armor) for allies within `radius` m. |
| `walls: { at, ahead, hp, armor, half, thick }` | Wall Engineers | At fight time `at`, each body puts up a wall `ahead` m in front of itself (`half`: half its length, across the board). The enemy can't walk or shoot through it (lobbed shots fly over); its own side can. Drawn as the bastion stone wall. |
| `regrow: { secs, pct, block, by }` | Hydra | A fallen head gets up again after `secs` s with `pct` % health, next to a living head of its squad. Fire on any head (a flame cone, a burn, or a unit named in `by`) within the last `block` s starts the clock again. |
| `copySkill: true` | Mirror Wraith | The first enemy it hits that has a skill it can take gives it that skill (the first in slot order) for the rest of the fight. Skills that need setting up at the start of a fight (spawns, links, buildings, portals) can't be copied. Units now remember their skills in `skillsHad`. |
| `raise: { radius, max, pct }` | The Lich | An enemy body that falls within `radius` m gets up on the Lich's side with `pct` % health, `max` per Lich per fight. Uses the same side switch as the Gentleman, so the game counts it as lost for its old squad. Never a structure, construct, linked body, carrier or ram. |

Check: `node tools/tests/roguelike-mechanics.js` (each mechanic, and every enemy in the data file fighting a few roster units).

## Order of work

1. Headless skeleton: run.js with battle nodes only, a fixed 8-node act, rewards as picks, the bot playing runs. Measure win rate. No UI.
2. Map screen and run flow on the start screen ("Solo run"), save and continue.
3. Encounter templates (10 to 15 for act 1), the fairness script, the budget curve.
4. Shop, camp, treasure and event nodes.
5. Bosses (one per act).
6. Acts 2 and 3, balance sims, then meta unlocks and ascension.
7. Later: factions as run starts, daily seed, map-specific events.

## Open questions for Vilhelm

1. Base ruleset: Standard pack and towers first, or straight onto the Factions devtest rules (buildings, Powers, spells)?
2. Army carries over between fights (my proposal), or a fresh build each node with only "relics" carrying over?
3. How much the player sees of the enemy before a battle: everything (puzzle feel), types but not positions, or a scouting cost?
4. Run length: about 25 battles in 3 acts, or shorter (1 act of about 10 nodes for the first version)?
5. Losing a fight: costs life only (proposal), or ends the run on elites and bosses?
6. Meta progression between runs, or every run starts equal?
