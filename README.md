# No Mans Land

A small auto-battler for the phone browser. Buy squads, place them, and watch the armies fight. Play the AI or challenge a friend live.

- **Play:** open the site and tap Challenge a friend. Send the link, and your friend opens it in any browser. No accounts needed.
- **Counter Lab** (`lab.html`): a balance sandbox for designing units. Units saved there show up in the game under Load units on the same device.

## How live matches work

- Phones connect directly over WebRTC using [PeerJS](https://peerjs.com) and its free public matchmaking server. There is no backend of our own.
- The host's phone runs the match and decides each round. The battle engine only uses arithmetic that gives identical results in every browser, so both phones play back the same fight.
- Each round has a deploy countdown: 60 seconds in round 1, 30 after that. The fight starts when it runs out, or earlier when both players tap Ready.
- If either phone drops the page, opening the link again rejoins the match. The host's match is saved on the host's device.

## Editing

The source is in `src/`. After changing it, run `node src/build.js` from the repo root. This rebuilds `index.html` and `lab.html`.

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
- `tower.unit` overrides the standard tower's stats.
- `skills`: skills only the factions use. Units can also use any skill from `default-roster.json` by its id.
- Unit names must be unique across all factions.
- The draft order, picks per player and the map are in `FACTION_MODE` in `src/game.js`. A ban phase later is a matter of adding `{ "who": "A", "act": "ban" }` steps to its order.
- `node tools/tests/factions.js` checks the draft and faction matches headlessly with six throwaway test factions.

## Tools (`tools/`)

- `tools/match-history.gs` saves two-player matches to a Google Sheet. Paste it into the sheet's Apps Script, deploy it as a web app (Execute as: Me, Who has access: Anyone) and put the `/exec` URL in `HISTORY_URL` in `src/site-template.html` (already set to the live sheet; a new deployment gets a new URL, so update it then). The hosting phone then saves every round, and a Match history button appears on the start screen. The URL is public, so anyone could add rows; delete junk rows in the sheet.
- `node tools/build-artifact.js` turns `index.html` into `phone-bellum.html`, the version published as the claude.ai artifact (PeerJS from a CDN, no Counter Lab link).
- `node tools/counter-table.js` recomputes `src/demo-units.json` (the counter table) after editing `src/default-roster.json`, and `src/faction-units.json` after editing `src/factions.json`. Rebuild afterwards.
- `tools/tests/` holds Playwright checks. They expect the game served on port 8766 (`python3 -m http.server 8766`) and, for two-player tests, `node tools/peer-server.js` on port 9000. Install with `cd tools && npm i`.
