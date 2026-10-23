# Awareness and targeting: research notes

The goal: units should notice what's around them, without every unit locking on to every enemy and the whole fight collapsing into one blob in the middle.

## How it works now (src/engine.js, `step()`)

1. Marching. A body walks straight ahead (or in from its flank) until any enemy comes within its sight: its range + 15 m, at least 18 m, in any direction. From 15 m beyond that it starts to lean toward the nearest enemy ahead.
2. Engaged. Once it has spotted something, it is engaged for the rest of the fight. Every tick it walks toward the nearest living enemy on the whole board, wherever that is.
3. Attacking. It attacks the nearest enemy in reach and stays on it until it dies, hides or leaves its reach.
4. Allies push each other apart (separation), so a crowd on one target spreads into a ring.

Why it can feel like everything locks on to everything:

- Sight is big compared with the board. One tile is 6 m and no man's land is 4 rows (24 m), so as soon as the armies step into no man's land, almost every body has spotted something and is engaged.
- Engaged bodies pick from the whole board by distance alone, with no memory. They all drift toward wherever the nearest enemy is, so lanes merge into the middle.
- Nothing limits how many attackers go for one enemy. Twelve goblins all run at the same Brute; the separation push then shoves the late ones around the ring.

## What other games do

- StarCraft 2 picks targets by threat first (can it shoot back?), then a priority number per unit type, and only then distance. A unit keeps its target until it dies, leaves range, or a higher-priority target comes into range. Some units prefer the smallest turn instead of the nearest. ([Liquipedia](https://liquipedia.net/starcraft2/Automatic_Targeting))
- Mechabellum units go for the nearest enemy they face, weighing time to reach (including turning) more than straight distance, and players steer them by changing their facing. ([GamePretty](https://gamepretty.com/mechabellum-how-to-switch-targets/))
- Melee crowding is usually solved with attack slots: a few spots around each target, each attacker takes a free one, and when they're all taken the rest wait or pick another target. ([bugnet](https://bugnet.io/blog/how-to-fix-unity-melee-ai-clumping-on-player), [Aron Granberg forum](https://forum.arongranberg.com/t/surrounding-the-target/446))
- Overkill avoidance: shooters skip an enemy that's already going to die from shots on their way and spread fire to the next one (AI War's ships work like this, by a player's account). ([Arcen forums](https://forums.arcengames.com/ai-war-classic/target-selection-priority/))
- For big crowds, flow fields (one shared direction map per goal) replace per-unit pathfinding, as in Supreme Commander 2. That's for routing around terrain, which our open boards don't have yet; worth it once maps get walls or buildings that block. ([Wildfire Games forum](https://wildfiregames.com/forum/topic/16018-supreme-commander-2-pathfinding/))

## The prototype (on in Factions – devtest only)

`g.aware2` in the engine, switched on by `DEV.awareness` in `src/game.js`. Four changes to how an engaged body chooses:

1. It only considers enemies within its own sight (its current target a bit further, 1.5×). If nobody is in sight it falls back to the nearest, as now.
2. Cost instead of distance: distance + 0.5 per metre sideways (it keeps to its lane) + crowding.
3. Melee slots: each target has room for 2 (swarm bodies), 3 (normal), 5 (big, 1000+ health) or 6 (buildings) melee attackers. Each melee body already on it adds 2 m to the cost; a full target adds 12 m, so the next one usually picks another.
4. Stickiness: its current target counts 3 m closer, so it doesn't flip between two enemies.
5. Overkill: a new attack target skips an enemy that the side's current targets already add up to killing, if anyone else is in reach.

It is deterministic (same numbers on every device) and costs about the same as the current nearest-enemy loop.

## What it changed (simulated)

76 fights from AI-vs-AI devtest matches, each played four ways from the same start:

| | Fight length | Sideways share of walking | Army width (spread of x) |
|---|---|---|---|
| Now | 24.7 s | 32% | 7.8 m |
| Prototype, no lane cost | 23.7 s | 32% | 7.8 m |
| Prototype, lane 0.5 (on in the devtest) | 22.8 s | 28% | 8.2 m |
| Prototype, lane 1.0 | 22.4 s | 26% | 8.4 m |

- Fights get a bit shorter, units walk less sideways, and armies stay a bit wider. The winner changed in 7 of 76 fights. Mirror fights stay even.
- In one-unit-against-one-unit lab fights (measured before the lane cost was added) the changes are small (average 6 points of score); swarms lose a little (they no longer all pile onto one target) and Wisps gain the most.
- Honest read: it's a nudge, not a different feel. The numbers can't tell how it looks, so the devtest is where to judge it.

## What would change the feel more (for Vilhelm to pick)

1. Smaller sight. Sight 15 m beyond range is most of no man's land. At 6–9 m, squads would meet what's in their lane first and only turn when something is close. Cheap to try: `SETTINGS.sight` / `minSight` in `src/game.js`.
2. Engage per squad, not per body. Today each body decides alone, so a squad smears across several targets. A squad-level target (the squad picks an enemy squad, its bodies share the slots around it) reads much clearer on a phone.
3. Roles in targeting. Like StarCraft's priorities: "beats giants" units prefer big targets in reach, "beats crowds" prefer swarms, artillery prefers clumps. This would make the counter design show up in how fights look.
4. Disengage. Let an engaged body go back to marching when nothing is in sight any more, instead of chasing across the board.
5. Flow fields later, when maps get blocking buildings or terrain.

Settings to play with: `AWARE` in `src/engine.js` (step, full, stick, leash, lane) and `DEV.awareness` in `src/game.js`.
