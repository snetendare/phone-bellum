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

## Tools (`tools/`)

- `node tools/build-artifact.js` turns `index.html` into `phone-bellum.html`, the version published as the claude.ai artifact (PeerJS from a CDN, no Counter Lab link).
- `node tools/counter-table.js` recomputes `src/demo-units.json` (the counter table) after editing `src/default-roster.json`. Rebuild afterwards.
- `tools/tests/` holds Playwright checks. They expect the game served on port 8766 (`python3 -m http.server 8766`) and, for two-player tests, `node tools/peer-server.js` on port 9000. Install with `cd tools && npm i`.
