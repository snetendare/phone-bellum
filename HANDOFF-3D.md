# Handoff: getting the 3D board into the live game

Repo `snetendare/phone-bellum`, branch `refactor/render-split`. `main` (with the factions game mode) is merged in. The branch isn't merged into `main`, and there's no PR yet.

**Next: finish step 5 on real phones** (a two-player match, one phone on 2D and the other on 3D), **then step 6**. Steps 1–4 are done; step 5's automated check is done.

## Where things stand

- **2D board split out.** `src/render2d.js` draws the board and reads the game only through `view()`. Shared art (palette, coats of arms, tower icons) is in `src/art.js`.
- **3D board.** `src/render3d.js` (three.js 0.180.0 in `vendor/`) has the same calls and the same `view()` as `render2d.js`. `src/camera3d.js` has three views: strategic (straight down), angled and ground (ground is for watching only). `src/models3d.js` holds low-poly models, picked from unit stats. The six tier 4 units have their own models.
- **One set of board rules.** The game's board input (`src/site-template.html`, "board input") is five functions on tiles: `boardPress`, `boardDrag`, `boardDrop`, `boardHover` and `boardTap`. The 2D canvas's pointer handlers and `render3d.js`'s `onPress` / `onDrag` / `onDrop` / `onHover` / `onTap` both call them.
- **3D in the game is a setting.** The in-match Settings sheet (the cog) has **Board: 2D / 3D**, and while 3D is on, **3D quality: High / Medium / Low**. 2D is the default. The choice is saved in localStorage (`phone-bellum-board`: `'2d'` / `'3d'`, in `B3D_STORE`), and a saved 3D starts at page load. `?board=3d` in the address, or a page with the 3D code inlined (the phone-test artifact below), forces 3D for testing (`force3d`): that also shows the speed meter and skips the too-slow rule. The switch still works there for the session.
  - `start3d()` in `src/site-template.html` loads three.js from `vendor/` and, if needed, the 3D code from `src/`, then puts the 3D board in place of the canvas. It can run at any time, mid-match too; a switch back to 2D while it loads is respected (`want3d`).
  - `stop3d()` cancels the frame loop, removes the meter and the 3D element, calls Render3D's new `dispose()` (Camera3D's `dispose()` lets go of the window's key listeners, then `renderer.dispose()` and `renderer.forceContextLoss()`), shows `cv` again and calls `size(); render();`.
  - **Fall back to 2D** (`fallback2d(why)`), with one line on the board (`note3d()`, `.note3d` at the top of `#wrap`, gone after 8 s or a tap):
    - can't start (no WebGL, a load error): "3D can't run on this device, so the board is 2D." The setting goes back to 2D.
    - `webglcontextlost` on the 3D canvas: "The 3D board stopped, so it's back to 2D." The setting stays 3D, since a lost context may come back next time.
    - too slow: a fight of 4 s or more, on screen the whole time (no frame gap over 1 s), averaging under 20 fps steps the quality down one (high → medium → low, saved). At low it falls back: "3D was too slow here, so the board is back to 2D." The setting goes back to 2D. The rule is in `meterFrame()`.
  - While deploying, the angled view takes taps and drags too. There are no view buttons in the game: pinch or scroll to change views.
- **The 3D board rests when idle.** It draws only during fights, while the camera glides, and for 0.7 s after `render()` or a touch (`wake3d()` / `frame3d()`). Camera3D reports input (`opts.onInput`) and `busy()`; Render3D passes them on as `onInput` / `still()`. In the shop it sits at 0 frames per second.
- **Speed meter** (`.meter3d`, top right of the 3D board, only when 3D is forced for testing). It still counts frames and sums up fights for the too-slow rule when hidden. It shows frames in the last second, the slowest frame, and the quality with its pixels per CSS pixel. During a fight it adds live bodies and draw calls; after a fight, that fight's average frame rate, slowest second and most bodies. Tapping it steps the quality, through `render3d.js`'s `quality()`: high is up to 2 pixels per CSS pixel with shadows, medium 1.5 with shadows, low 1 without. The choice is saved in localStorage (`phone-bellum-3d-quality`), shared with the 3D quality in Settings (`setQuality()`).
- **Compact layout** for phones, for both boards:
  - smaller page padding;
  - the HUD in one row (round number beside its phase and buttons);
  - tighter deploy panel;
  - two-line tier tabs ("T2 Strong" / price), smaller shop cards;
  - general deploy tips moved off the panel into a Help sheet. The "?" button in the gold line opens it (`openHelp()`, tip in `helpTip`). On the panel, only hints about what the next tap does stay (`inline` in `panelDeploy()`): placing the tower or elf tower, choosing a package or tower, Move and Charisma prompts, not enough gold or no deployments, and waiting or time's-up messages. In a round with news (hail, the ice altar, flanks opening, a tower skill offer), the "?" turns gold until opened that round (`helpSeen`).
  
  At 390×664 (Safari's usable height on an iPhone 13) the deploy screen now overflows by about 77 px instead of 227. The board keeps its size: it's still `min(100%, (100svh - 300px) * 0.75)` wide on `#wrap`. Raising that 300 would fit more on one screen but shrink the board.
- **Artifacts** (claude.ai, private to the owner):
  - "No Mans Land 3D Game", https://claude.ai/artifact/5ZUYFDjVS6eSv234RBHHEy: the full game starting on the 3D board, for phone testing, with the meter. Republished after step 4, so it has the Board switch too. "Play vs Claude" doesn't work there; the match history and Claude features would need capabilities declared.
  - "No Mans Land · 3D test", https://claude.ai/artifact/S5EmsCVWqpqm3BfkWUQ5w8: the 3D test page. It's an older build, from before the black-floor fix and idling; republish it from `lab3d-artifact.html` if it's still wanted.
  - To update either: `node src/build.js && node tools/build-artifact.js`, then publish `game3d-artifact.html` or `lab3d-artifact.html` to its URL. `vendor/` is already published next to both.
- **3D test page** `lab3d.html` (`src/lab3d.js`, `src/lab3d-template.html`): deploy blue against the AI with unlimited gold, with Strategic / Angled / Ground buttons.

## Checks

- **Setup.** Serve the repo on port 8766 (`python3 -m http.server 8766`). Two-player checks also need `node tools/peer-server.js` on port 9000. Install with `cd tools && npm i`. Run each check with `NODE_PATH=<repo>/tools/node_modules node <repo>/tools/tests/<name>.js` from a scratch folder, because the checks write screenshots.
- **2D board unchanged:** `node tools/tests/snapshots.js <dir>` makes 71 fixed board moments (68 without the peer server). Compare against a run of `main`: `snapshots.js <new dir> <main dir>`. Every run since the merge has been identical to `main`.
- **Board setting:** `node tools/tests/board-switch.js`: 2D by default; 3D on and off mid-match from Settings (the WebGL context is freed, the 2D board takes input again); the 3D quality; saved 3D starts at load; a lost context, two slow fights (medium steps to low, then 2D; headless runs about 25 fps at low, so the check makes each frame 60 ms slower) and no WebGL each fall back with their line; `?board=3d` forces 3D with the meter.
- **Two players, 2D against 3D:** `foe3d-mp.js` (needs the peer server). Two live matches, a 3D guest against a 2D host and then the other way round. At each moment the 3D phone's two boards draw the same view (the 2D one on its hidden canvas; the check spies on `Shapes.body`, `Shapes.outline`, `Art.keep` and `Art.armsFlag`, and reads Render3D's `drawn()`), and it compares what each drew of the opponent's side: squad bodies by colour, stealthed ghosts by shape, the tower type and every coat of arms. Moments: round 1 while deploying (new squads and the leader hidden) and in the fight (a stealthed Rogue), round 2, round 3 (the tower pick: the opponent's type hidden while deploying, shown in the fight). Then the guest leaves and opens the invite link again: same round, each phone on its own board, countdowns within 2 s. The window peek (`?test`) now also has `board` (the 2D board).
- **3D:** `game3d.js` plays the game on the 3D board. It covers drag, place and take back, the tower, unit and enemy sheets, Move by tap, undo and drag, placing in the angled view, idling in the shop, the quality steps and the fight summary. `deploy3d.js` covers the 3D test page. Both need Chromium's software WebGL (set in the scripts), where one frame can take up to half a second. Headless frame rates say nothing about phones.
- **Factions:** `node tools/tests/factions.js` (headless).
- **Problems in older tests:**
  - `pack-ui.js` already failed before this work: a sheet covers the button it clicks.
  - `move-ui.js` fails now and then when a random package squad lands on its fixed target tile (5,11).
  - `flank-ui.js` already failed before this work: it never picks a start package.
  - Several UI checks print `#panel .hint` for a person to read. Tips now live in the Help sheet, so for those moments they print the footer status instead. They still pass.
  - `tools/build-artifact.js` stops at the Counter Lab step, after writing the game and 3D artifacts (see step 8).

## Steps to get the 3D board into the live game

Ship it as an opt-in setting first. Keep the 2D board as the default until 3D has held up in real matches.

1. **Merge `main` into the branch.** Done. The only drawing change on `main` (tower types looked up with `Game.towerTypeById`, so faction towers are found) moved into `src/art.js`. Faction towers still use the plain keep in 3D. `src/factions.json` is still empty, so the Factions mode can't be played yet.
2. **Wire the game's board input to the 3D board.** Done (see "One set of board rules"). Also fixed: the 3D floor stayed black when the board started before a match existed. A texture can't grow in place, so `paintFloor` now starts a new one when the floor canvas changes size.
3. **Test on real phones.** Done. The owner tested the phone-test artifact on their phones:
   - no big lag and no big battery drain;
   - dragging squads works as it should;
   - the camera angles look fine.
   
   So the angled view stays as it is, even though on a phone it shows only 6–8 of the 12 columns in your zone (outer columns need a drag on empty ground). Their only request, a smaller deploy panel and less scrolling, is done (see "Compact layout"). Quality stays at high by default.
4. **Fall back to 2D when 3D can't run, and a 2D / 3D switch in settings.** Done (see "3D in the game is a setting"). The switch is only in the in-match Settings, not in the main menu's Music sheet. Checked: the 2D snapshots are identical to `main` (71 of 71), and `game3d.js`, `deploy3d.js`, `board-switch.js` and `factions.js` pass.
5. **Check that two-player matches stay safe.** The automated part is done: `foe3d-mp.js` (see "Checks"). It found one leak, now fixed: in a fight the 3D board drew markers (health, level, charisma, status dots) and a team ring on a stealthed enemy, where the 2D board shows only a faint dashed outline. Stealthed bodies now get no markers in 3D, and an opponent's no ring. With the fix taken out, the check fails on exactly that.
   - **Still to do: a real match on two phones**, one on 2D and the other on 3D (cog → Board → 3D): a few rounds, fights matching on both phones, the countdown, and rejoining by opening the invite link again from each phone. The branch isn't on the live site; the owner can use https://raw.githack.com/snetendare/phone-bellum/refactor/render-split/index.html (serves the branch's files; "Challenge a friend" builds the invite from that address). It couldn't be opened from the cloud container, so it's untested there. The phone-test artifact is private and can't be used for this.
   - Not covered by the check: the other maps' extras (forest mushrooms, the ice altar and snowgres, elf towers of each player). Both boards use the same `Game.*Shown` rules for them; extending the check to those maps is a matter of picking the map and placing those.
6. **Loading three.js** (about 720 KB). Next after step 5. The live site serves it from `vendor/`, loaded only when 3D starts. The game artifact (`phone-bellum.html`) is a single inlined page with no 3D code. To offer 3D there, inline the 3D code as `game3d-artifact.html` does, and load three.js from a CDN pinned to 0.180.0 (jsDelivr is allowed) or publish `vendor/` next to it. Keep the 2D game opening as fast as before: only `import()` three.js when 3D is on. The 3D code itself (`camera3d`, `models3d`, `render3d`) is about 75 KB and could be inlined.
7. **Tests.** The existing Playwright tests tap the 2D board by grid position, so keeping 2D as the default keeps them valid. Add 3D versions of the remaining key flows on top of `game3d.js`: a full round in a two-player match, the elf tower, the altar, Charisma.
8. **Smaller gaps.**
   - Models for units that still use the general figures, and for faction towers, if wanted.
   - Fix the Counter Lab artifact build: its check rejects any page that mentions "Load units", and the Counter Lab help text now does.
   - Decide what the start screen and map picker look like in 3D; the map thumbnails can stay 2D.
   - View buttons (Strategic / Angled) in the game, if pinch and scroll aren't enough.
