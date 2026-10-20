# No Mans Land

A small auto-battler for the phone browser. Buy squads, place them, and watch the armies fight. Play the AI or challenge a friend live.

- **Play:** open the site and tap Challenge a friend. Send the link, and your friend opens it in any browser. No accounts needed.
- **Counter Lab** (`lab.html`): a balance sandbox for designing units. Units saved there show up in the game under Load units on the same device.
- **3D test** (`lab3d.html`): real battles on the 3D board, with low-poly units, to try the 3D renderer and camera. You deploy blue against the AI in the strategic view (or set Blue: AI to watch): pick a unit in the shop and tap a tile, tap a squad from this round to take it back, drag it to move it, Auto lets the AI deploy for you. Blue has unlimited gold here. You can also place and drag in the angled view while deploying; there a tap places instead of going back, so use the Strategic / Angled / Ground buttons (or pinch out, scroll, Esc). Strategic view straight down; spread two fingers (or scroll) for the angled and ground-level views, drag to look around, twist (or right/middle drag, Q/E) to rotate, tap (or Esc) to go back. Fight, Next round and New armies drive the match.

## How live matches work

- Phones connect directly over WebRTC using [PeerJS](https://peerjs.com) and its free public matchmaking server. There is no backend of our own.
- The host's phone runs the match and decides each round. The battle engine only uses arithmetic that gives identical results in every browser, so both phones play back the same fight.
- Each round has a deploy countdown: 60 seconds in round 1, 30 after that. The fight starts when it runs out, or earlier when both players tap Ready.
- If either phone drops the page, opening the link again rejoins the match. The host's match is saved on the host's device.

## Editing

The source is in `src/`. After changing it, run `node src/build.js` from the repo root. This rebuilds `index.html`, `lab.html` and `lab3d.html`.

- `engine.js`: the battle engine. Plain arithmetic only, so both phones in a live match play the same fight. Draws nothing.
- `game.js`: match rules (gold, rounds, maps, characters, the AI, what each player may see of the other). Draws nothing.
- `shapes.js`: how a unit looks: its shape, colour and 3-letter tag.
- `art.js`: the shared palette, coats of arms and tower icons, used on the board and in the panels.
- `camera3d.js`: the 3D camera and its touch, mouse and key controls (strategic, angled and ground views). In the strategic view (and the angled view while the player is placing) the page can take taps and one-finger drags for itself, to place and move squads.
- `render3d.js`: draws the board and the battles in 3D (three.js), through the same `view()` and calls as `render2d.js`, with the same markers (health, wind-up and flank timers, statuses, charisma, levels, buffs, tags, badges, placement hints, coats of arms, the elf spires, ice walls and hail, the crippled-army notice). The map floor is painted by `render2d.js` (its `floor()` call) and laid on the ground. Markers follow the camera: health as rings in the strategic view and bars in the angled view; the ground view is purely cinematic (no markers, no zones or grid on the floor).
- `models3d.js`: the low-poly models: units (soldier, archer, caster, goblin, brute, flier, horse, spider, airship), picked from each unit's stats, and their own models for the tier 4 units (Ether Golem, Sun Priest, Meteor Caller, War Mammoth, Necromancer, Truespear), Ent, Rogue, Sniper, Slimeshots, Skeleton Archers and the six wizards (each with its element on the staff), a tower for each tower type and one for faction towers (in the faction's colour), the elf spire and the thrown spear.
- `lab3d.js` + `lab3d-template.html`: the 3D test page: runs matches against the AI, with blue's deploy in the 3D view, and shows them with `render3d.js`.
- `render2d.js`: draws the board and the battles on the canvas. It reads what to show only through the `view()` the page hands it, so another renderer (3D) can take its place.
- `site-template.html` + `game.css`: the game page: panels, menus, live matches, music. Its board input works on tiles, so the 2D and the 3D board share it. The in-match Settings (the cog) switch between the 2D board (the default) and the 3D board, saved on the device; `?board=3d` in the address forces 3D for testing. Only then does it load three.js (`THREE_URL`: `vendor/` here, jsDelivr in the artifact) and the 3D code from `src/`, and it falls back to the 2D board with one line when 3D can't load or start, the phone drops it, or fights run too slowly. The 3D board draws only while something moves; when forced for testing it shows a speed meter in its top right corner (tap it to change the quality).
- `template.html`: Counter Lab.

`vendor/` holds three.js (0.180.0, MIT licence), used by the 3D test page.

## Factions gamemode

A second gamemode on the standard map. Each faction is a small roster with its own theme, a trait and its own tower. Before the match the players draft factions one at a time, two each (A, B, B, A). Each player can then only unlock, buy and place units of their own two factions, and at round 3 they pick between their two factions' towers instead of the usual tower offer. Starting packages are dealt from your own factions' units, so give every faction at least one unit at 200 gold or less.

The mode unlocks on the start screen (Factions vs AI) and in the friend lobby (Standard / Factions) once there are enough factions for a draft (4 for now; each pick and ban needs its own).

Factions go in `src/factions.json`, then run `node tools/counter-table.js` and rebuild. Format:

```json
{
  "factions": [{
    "id": "deepsea", "name": "Deep Sea", "color": "#3FA7D6",
    "theme": "One line shown in the draft",
    "trait": { "name": "Crushing depths", "text": "+20% damage, -15% speed", "hit": 20, "speed": -15 },
    "tower": { "name": "Coral Spire", "text": "What it does", "unit": { "hp": 650, "hit": 30, "aps": 1.2, "range": 10 } },
    "units": [ { "name": "...", "cost": 100, "bodies": 4, "hp": 200, "...": "same fields as units in default-roster.json" } ]
  }],
  "skills": []
}
```

- `trait` changes all the faction's units (spawned ones too) by a percentage: `hp`, `hit`, `aps`, `range`, `speed`. It is optional.
- `tower.unit` overrides the standard tower's stats. With `drone: { orbit, unit }` (and `idle: true`) the tower doesn't shoot itself: a drone circles it `orbit` metres out and does the shooting (the Mecha Tower).
- `tower.awake`: the tower's stats while Core Awoken is on (the Mecha Tower drives and lobs mortar shells).
- `tower.rounds`: skills bought every round for that round's fight, each `{ id, name, cost, text, bots: { count, unit }, mines: { each, hit, radius } }` (the Mecha Tower's minebots and repairbots; a bot unit has `bot: "mine"` or `"repair"`).
- `skills`: skills only the factions use. Units can also use any skill from `default-roster.json` by its id.
- Unit names must be unique across all factions.
- The draft order, picks per player and the map are in `FACTION_MODE` in `src/game.js`. A ban phase later is a matter of adding `{ "who": "A", "act": "ban" }` steps to its order.
- `node tools/tests/factions.js` checks the draft and faction matches headlessly with six throwaway test factions.
- Until there are 4 factions the mode stays locked. To try a faction's units now: Counter Lab → Import units → "From <faction> (faction)", save, then Load units in the game.

Fight mechanics added for factions (they work for any unit, in Counter Lab too):

- `roll` (seconds): a roller. It never stops to attack; it rolls at its target from 1 m/s up to its `speed` over this many seconds, hits every enemy body it rolls over for its `hit`, carries on a tile past the target, stops and rolls back. `aps` and `range` only matter for the shop's numbers.
- `build`: `{ "time": 1.5, "range": 25, "count": 1, "unit": { ...stats } }`. Once per fight the unit stops when an enemy is within `range` − 1 m, builds `count` copies of `unit` (a tile apart) in `time` seconds and fights on. Builders building next to each other speed each other up (1×, 1.5×, 1.75×, …). What it builds never moves, levels with its builder, earns the builder's squad its XP, and doesn't count as a unit left standing.
- `skillNeeds`: `[null, null, [0, 1]]` = skill 3 can only be bought once skills 1 and 2 are owned (empty slots are skipped).
- Skill types: `momentum` (a roller gets up to speed faster), `link` (a squad's bodies share one health pool and fall together), `healbot` (a construct follows each squad and heals it a share of max health per second), `builder` (more constructs per build, faster builds, better constructs).
- Buildings are listed under `"buildings"` in `src/factions.json`: `{ id, name, faction, hp, buildSecs, selfBuild, survive, rebuild, levelCost, color, text, awake, skills }`. A player gets one in two ways:
  - a unit skill of type `building` (`"params": { "building": "factory" }`): buying it places the building on a free tile of your zone (the Factory);
  - a unit with `"building": "altar"` bought in the shop like any unit (the Altar of Build): a squad that never moves; `footprint: 2` makes it take a 2x2 block (its col, row are the block's first ones). Give it `idle`, `noCount` and `anchored` too, so it doesn't fight in Counter Lab; the counter table scores it 0.
- A building is a site until it is built: the nearest builder without a job builds it during fights (`buildSecs` seconds of work; a site nobody builds builds itself at `selfBuild` times that speed). The work carries over between fights; with `survive` a site still standing at the end of a fight it was worked on is built at once. A built building that falls starts the next round at `rebuild` %. Once built, one of its `skills` can be bought each round: `unit` (one unit made `time` s into the fight), `make` (`[[building, its skill, count], ...]`), `bless` (Blessing of the Cycle: `build`, `hp`, `speed`, `aps` %, `regen` for all your constructs) or `awake` (Core Awoken: your buildings get their kind's `awake` stats and walk; `awake.built` changes what builders build). What it makes earns it XP; it levels up with gold, and its units with it.
- New unit fields: `spinCap` (how far spin-up goes; default 3×), `tag` (its 3-letter tag on the board), `smooth` (no bobbing in 3D), `flee` (metres: keeps away from enemies that close, still shooting), `backline` (shoots the farthest enemy in reach), `lob` (shells fly over whoever is in the way and only land where aimed).

### Mechites (in progress)

Rock elementals with clockwork hearts; what they build rattles and smokes. Done:
- Rollers, Cog Builder (turrets, Twin turrets, Master engineering), Mechite Guards (Oiled pumps, Linked cores, Healbot).
- The Factory (Cog Builder skill 1, 200 gold): placed with a tap on a free tile of your zone, built by your nearest Cog Builder during fights, then one unit a round from its sheet (tap it): Cogbot Fighter (100), Cogbot Machinegunner (100) or CogMech (300). Master engineering needs Build factory and Twin turrets, and its upgrades reach what the factory makes.
- The Altar of Build (500 gold in the shop, 4000 health): placed on a 2x2 block of your zone (the tile you tap is its first column and row), it stands where the four tiles meet with the Cog Spire in its middle. Built over 30 s of work, by your nearest free Cog Builder or, with none free, by itself 5 times slower. Its unit sheet sells one skill a round: Blessing of the Cycle (200), Cogbot Defensive Force (500: 2 Fighters and 2 Machinegunners) or Core Awoken (800: the Factory rolls out as a tank, the altar walks on spider legs firing 6 beams from the Cog Spire, turrets get wheels, keep away from enemies and lob mortar shells at the back line).
- Drawn on both boards: on the 2D board the workshop and the altar ring (scaffolds with a gold arc while they are built, tracks and legs when awoken); on the 3D board their own models (Rollers roll, Mechites glide, their constructs rattle and smoke).
- Checks: `node tools/tests/mechites.js`, `factory.js`, `altar.js` (headless); `tools/tests/factory-ui.js`, `altar-ui.js` (2D and 3D); `factory-mp.js`, `altar-mp.js` (a 2D host against a 3D guest).

Still to come: the Rollers' "ent" form, the faction's trait and its own tower (the "Mechite Tower" is the standard tower until then).

## Tools (`tools/`)

- `tools/match-history.gs` saves two-player matches to a Google Sheet. Paste it into the sheet's Apps Script, deploy it as a web app (Execute as: Me, Who has access: Anyone) and put the `/exec` URL in `HISTORY_URL` in `src/site-template.html` (already set to the live sheet; a new deployment gets a new URL, so update it then). The hosting phone then saves every round, and a Match history button appears on the start screen. The URL is public, so anyone could add rows; delete junk rows in the sheet.
- `node tools/build-artifact.js` turns `index.html` into `phone-bellum.html`, the version published as the claude.ai artifact (PeerJS and three.js from jsDelivr, the 3D code inlined, no Counter Lab link). It also makes `lab3d-artifact.html` from `lab3d.html`, for the 3D test artifact, and `game3d-artifact.html`, the game forced onto the 3D board with the speed meter, for testing 3D on phones (publish `vendor/` next to both).
- `node tools/counter-table.js` recomputes `src/demo-units.json` (the counter table) after editing `src/default-roster.json`, and `src/faction-units.json` after editing `src/factions.json`. Rebuild afterwards.
- `node tools/tests/snapshots.js before` (before a change), then `node tools/tests/snapshots.js after before` (after it): draws the board at about 70 fixed moments, exactly the same every run, and lists any that changed. Use it when a change shouldn't alter what players see, like moving code between files. Only compare runs from the same machine. Needs the same servers as the other checks below.
- `tools/tests/game3d.js` plays the game on the 3D board (`?board=3d`): dragging, placing and taking back, the tower and unit sheets, the Move ability and placing in the angled view, and that the board stops drawing in the shop. Like `deploy3d.js` it needs Chromium's software WebGL (set in the script).
- More 3D checks, all with software WebGL: `game3d-maps.js` (the elf tower, the ice altar and Charisma on the 3D board), `game3d-mp.js` (a live round with both phones on 3D), `foe3d-mp.js` (a 2D phone against a 3D one: the 3D board never shows more of the opponent than the 2D board; rejoining), `board-switch.js` (the 2D / 3D setting and the fall back to 2D) and `artifact3d.js` (the artifact builds with the 3D board; run `node tools/build-artifact.js` first).
- `tools/tests/` holds Playwright checks. They expect the game served on port 8766 (`python3 -m http.server 8766`) and, for two-player tests, `node tools/peer-server.js` on port 9000. Install with `cd tools && npm i`.
