# Factions: devtest and plan

The Factions mode is going to be the standard way to play. This file is the plan for getting its skeleton in place, who does what, and the data formats the designs go into. The mode to try things in is Factions – devtest (start screen, vs AI).

## The idea in one paragraph

Each player drafts 2 factions before the match. A faction is a small roster of units, 2 lesser buildings, 1 Powertower (with its powergem) and some Powers. The core is boardbuilding rather than deckbuilding: on top of buying units, every round you pick one thing that changes your side of the board. No tower in rounds 1 and 2, your first lesser building in round 2, your Powertower in round 3 (its tile is reserved from the start), then picks of Powers, lesser buildings and neutral units in turn. Buildings have "when destroyed" effects, so placing them is a risk as well as a gain.

## Who does what

Vilhelm (design):
1. The first 6 faction rosters (Mechites and Sunken Deep are half done).
2. The lesser buildings, per faction and neutral (map-specific ones later).
3. The faction Powers and the neutral Powers.
4. Pilot 3D models (with Claude, in Blender).

Claude (code):
1. The drafting mechanic and a simple UI: the faction draft, then the round-by-round picks.
2. Placing buildings, and temporary items and spells that change the map.
3. Mechites and Sunken Deep in the devtest mode.
4. Research on pathfinding and awareness: units should notice what's around them without everything locking on to everything. See [AWARENESS.md](AWARENESS.md).
5. Two mechanisms: a unit that looks like another unit to the opponent, and guiding a squad by drawing an arrow from it.

## Factions – devtest

A separate mode, so the normal game and the normal Factions mode don't change while we try things.

- vs AI only for now (live matches later, once the rules settle).
- Played on the Test Grid map: each zone is 14 by 7 tiles.
- Faction draft first. With fewer than 4 factions the devtest lets both players draft the same faction, so it works with just Mechites and Sunken Deep.
- No tower in rounds 1 and 2. The tower tile is reserved (nothing can stand on it).
- Every round from round 2, a pick card comes up at the start of deploy: choose 1 of 3. The schedule:

| Round | Pick |
|---|---|
| 1 | nothing yet (a round 1 objective is a strong maybe) |
| 2 | lesser building |
| 3 | Powertower (one per drafted faction) |
| 4, 7, 10… | Power |
| 5, 8, 11… | lesser building |
| 6, 9, 12… | neutral unit |

  The schedule is `DEV.schedule` in `src/game.js`. When a category has nothing left to offer, the pick falls back to the next one.
- Picks are free. Gold still goes on units, levels, skills and spells.
- A picked building is placed on a free tile of your zone in the same round (until it's placed, a button in the panel waits for it). It can be dragged while it's new, and is fixed after its first fight.
- Your opponent doesn't see what you picked or placed this round until the fight, the same as new squads.

## Data formats

Everything goes in `src/factions.json`. Then run `node tools/counter-table.js` and `node src/build.js`. A field left out uses the default. Keywords for the Miro factions board live in `src/keywords.json`; the board redraws itself on push (see [MIRO-SYNC.md](MIRO-SYNC.md)).

### A faction

```json
{
  "id": "mechites", "name": "Mechites", "color": "#C08A4E",
  "theme": "One line for the draft",
  "trait": { "name": "Riveted", "text": "+2 armor", "armor": 2 },
  "tower": { "name": "Gear Spire", "text": "What it does", "gem": "What its powergem does",
             "unit": { "hp": 650, "hit": 30, "aps": 1.2, "range": 10 } },
  "units": [ { "name": "Scrap Hound", "cost": 100, "bodies": 6, "hp": 60, "hit": 10, "aps": 1, "range": 2, "speed": 7 } ],
  "buildings": [ ...lesser buildings, see below ],
  "powers": [ ...Powers, see below ]
}
```

- The Mechites also use the fight mechanics and building system from their branch (rollers, builders, the Factory, the Altar of Build, tower bots): see "Fight mechanics added for factions" in the README. Those buildings are bought with units and skills; the lesser buildings below are the devtest's round picks. Both kinds can stand in one match.
- Units use the same fields as `default-roster.json`, so anything Counter Lab can make works here. One new field: `"disguise": "Unit name"` (it looks like that unit to the opponent until it first attacks). `unlock` is the gold to unlock it in a match (0 = open from the start).
- `trait` changes all the faction's units: `hp`, `hit`, `aps`, `range`, `speed` in %, `armor` flat.

### A lesser building

```json
{
  "id": "rivet-post", "name": "Rivet Post", "text": "Shown on the card",
  "unit": { "hp": 450, "hit": 14, "aps": 1, "range": 12 },
  "aura": { "tiles": 1, "hp": 15, "armor": 2 },
  "income": 25,
  "spawn": { "unit": "Scrap Hound", "count": 2, "every": 8, "max": 4 },
  "onDestroyed": { "hp": 2, "gold": 50 },
  "place": "zone"
}
```

- `unit`: its stats in a fight. It stands still, can be attacked, and shoots if `hit` is above 0. `"mend": 30` makes it heal the most wounded friendly unit in range instead of shooting. Leave out `hit` for a building that only does the other things.
- `aura`: squads that start the fight within `tiles` tiles of it (1 = the 8 tiles around it) get these: `hp`, `hit`, `aps`, `range`, `speed` in %, `armor` flat.
- `income`: gold at the start of every round while you have it.
- `spawn`: it releases units during the fight (any unit name in the game).
- `onDestroyed`: if it's destroyed in a fight, you lose this much health and gold. It's back up for the next fight.
- `place`: `zone` (your zone, default), `front` (your zone or no man's land) or `flank`.

### A Power

```json
{ "id": "overclock", "name": "Overclock", "text": "Shown on the card",
  "mods": { "aps": 10 }, "units": "faction",
  "gold": 0, "deploys": 0, "buildingHp": 0, "spell": "oil-slick" }
```

- `mods`: stat changes for units: `hp`, `hit`, `aps`, `range`, `speed` in %, `armor` flat.
- `units`: which units get the mods: `"all"` (default), `"faction"` (only the faction the Power belongs to) or a list of unit names.
- `gold`: extra gold every round. `deploys`: extra deployments every round. `buildingHp`: % more health on your buildings and tower.
- `spell`: unlocks a spell (below) for the rest of the match.

### A spell (a temporary item on the map)

Spells sit in a `"spells"` list at the top of `factions.json`, and Powers unlock them. Each round you can cast the spells you have, for gold, on a tile.

```json
{ "id": "oil-slick", "name": "Oil slick", "text": "...", "cost": 50, "kind": "zone",
  "effect": "mud", "size": 2, "rounds": 1, "slow": 40, "place": "any" }
```

- `kind: "zone"`: a square of `size` by `size` tiles. `effect`: `burn` (enemies in it take `dps` damage a second), `mend` (your units in it heal `dps` a second), `mud` (enemies in it are slowed by `slow` %), `haste` (your units that cross it move `speed` % faster for the rest of the fight).
- `kind: "wall"`: a block on the tile with `hp` health that enemies have to go around or break.
- `kind: "strike"`: `dmg` damage to every enemy within `radius` metres of the tile, `at` seconds into the fight. Armor counts.
- `rounds`: how many fights it lasts (1 = this fight only).
- `place`: `own` (your zone), `front` (your zone or no man's land), `any` (the whole board).

### Neutral

```json
"neutral": {
  "units": ["Goblin Swarm", "Brute", { "name": "Hired Ogre", "cost": 300, "...": "a full unit" }],
  "buildings": [ ... ],
  "powers": [ ... ]
}
```

Neutral units can be names from the standard roster or full units. Picking one unlocks it for you for the rest of the match.

## Mechanisms

- Disguise (`"disguise": "Unit name"` on a unit): the opponent sees the disguise's shape, name and stats on the board, in the unit sheet and in the fight, until the unit's first attack. Its range ring uses the disguise's range.
- Arrow guide: in the devtest, tap one of your squads and choose Draw path, then drag from it (or tap the end tile). In the fight it walks the arrow first, stopping only to fight enemies that come into its own range, then fights as usual. Tap Clear path in its sheet to remove it.

## Order of work (Claude)

1. Plan (this file). Done.
2. Devtest mode, round-by-round picks, simple pick card UI. Done.
3. Buildings and spells: game rules, battle engine, 2D and 3D boards. Done (buildings and walls have simple placeholder 3D models).
4. Mechites: the real faction is in (merged from its own branch on 2026-10-23: Rollers, Cog Builder, Mechite Guards, Altar of Build, the Factory, the Mecha Tower). It has no lesser buildings or Powers for the devtest picks yet, so its picks come from the neutral ones. Sunken Deep: still a placeholder (marked PLACEHOLDER in its theme line), waiting for the real design.
5. Disguise and the arrow guide. Done. The disguise still shows the real number of bodies.
6. Awareness research and a prototype, on in the devtest only. Done, see [AWARENESS.md](AWARENESS.md).
7. Tests, build, push, publish the artifact. Done.

Checks: `node tools/tests/devtest.js` (rules, headless) and `node tools/tests/devtest-ui.js` (the page; `PB_BOARD=3d` for the 3D board).

Later, once the devtest settles: live matches in the devtest, the AI using buildings and spells well, the round 1 objective, map-specific buildings, and moving the devtest rules into the real Factions mode.
