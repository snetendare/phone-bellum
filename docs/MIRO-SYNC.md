# Miro board sync

The Miro board "Phone Bellum – Factions and keywords" (https://miro.com/app/board/uXjVEWUxwoE=/) is drawn from the repo. Every push to main that changes `src/factions.json`, `src/default-roster.json`, `src/keywords.json` or the sync script redraws it (`.github/workflows/miro-sync.yml` runs `node tools/miro-sync.js`). It can also be run by hand from the Actions tab (Miro sync, Run workflow).

## What is on the board

- Keywords in the middle, grouped in families. Fill colour is the family; dashed means nothing has it yet.
- The faction named in `keywords.json` `board.left` on the left and `board.right` (the neutral pool) on the right. Their cards are grouped by kind: units and their skills, built buildings and what they sell, the Powertower and its round buys, lesser buildings, Powers, spells.
- Each side has a "Links to keywords" column lined up with the keyword rows: "Keyword, N" where N is how many of its items have, give, make or feed on it. Lines only for makes, feeds on, both, and countered by (red dotted).
- Faction profiles: one bar per family for each faction, on one shared scale.
- Other factions sit below, cards only. Swap `board.left` to put another one beside the keywords.

## Where the keywords come from

1. Stats and fields, by rules in `tools/miro-sync.js` (`unitTags`, `modTags`, buildings, towers, Powers, spells). For example `defense: "armor"` gives Armor, `knockback` makes Displace, `build` gives Builder and makes Construct, `roll` or `trample` gives Run-through, a lesser building's `onDestroyed` makes When destroyed, a Power's `mods.hp` gives Health boost.
2. Skill types, by the `skillTypes` table in `src/keywords.json` (for example `armorHp` gives Armor and Health boost). A new skill type needs a line there, or the board lists it under "Data the sync could not place".
3. Design intent the data can't show, in `src/keywords.json` `items`: `{ "Rollers": { "counteredBy": ["Slow"], "why": "Rollers need speed to roll in" } }`. Also `has`, `makes`, `feeds` and `not` (keywords to drop).

A new keyword goes into a family in `src/keywords.json` (name and one-line text). Unknown keywords are skipped with a warning.

## Notes on the board

The sync deletes everything on the board and draws it again, except frames whose title starts with "Notes" and what is inside them. Write comments and ideas there (or as Miro comments, which stay too).

## One-time setup (Vilhelm)

1. In Miro: profile picture > Settings > Your apps > Create new app (any name, e.g. "Phone Bellum sync"). Give it the permissions `boards:read` and `boards:write`.
2. Click "Install app and get OAuth token", choose the team the board is in, and copy the access token.
3. On GitHub: snetendare/phone-bellum > Settings > Secrets and variables > Actions > New repository secret. Name `MIRO_TOKEN`, value the token.
4. Actions tab > Miro sync > Run workflow. The log says how many items it cleared and drew.

Without the secret the workflow runs and does nothing ("No MIRO_TOKEN set").

## Checking locally

- `node tools/miro-sync.js --json` prints every item with its keywords.
- `node tools/miro-sync.js --preview out.svg` writes a rough picture of the layout.
- `MIRO_TOKEN=... node tools/miro-sync.js` redraws the board from your machine (Node 18 or newer).
