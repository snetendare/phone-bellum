# Handoff: getting the 3D board into the live game

Repo `snetendare/phone-bellum`, branch `refactor/render-split`. `main` (with the factions game mode) is merged in. The branch isn't merged into `main`, and there's no PR yet.

**Next: step 4** (fall back to 2D when 3D can't run, and a 2D / 3D switch in settings). Steps 1–3 are done.

## Where things stand

- **2D board split out.** `src/render2d.js` draws the board and reads the game only through `view()`. Shared art (palette, coats of arms, tower icons) is in `src/art.js`.
- **3D board.** `src/render3d.js` (three.js 0.180.0 in `vendor/`) has the same calls and the same `view()` as `render2d.js`. `src/camera3d.js` has three views: strategic (straight down), angled and ground (ground is for watching only). `src/models3d.js` holds low-poly models, picked from unit stats. The six tier 4 units have their own models.
- **One set of board rules.** The game's board input (`src/site-template.html`, "board input") is five functions on tiles: `boardPress`, `boardDrag`, `boardDrop`, `boardHover` and `boardTap`. The 2D canvas's pointer handlers and `render3d.js`'s `onPress` / `onDrag` / `onDrop` / `onHover` / `onTap` both call them.
- **3D in the game, for now.** The game uses the 3D board when the address has `?board=3d`, or when the page has the 3D code inlined (the phone-test artifact below). `start3d()` in `src/site-template.html` loads three.js from `vendor/` and, if needed, the 3D code from `src/`, then puts the 3D board in place of the canvas. If anything fails, it stays on 2D. While deploying, the angled view takes taps and drags too. There are no view buttons in the game: pinch or scroll to change views.
- **The 3D board rests when idle.** It draws only during fights, while the camera glides, and for 0.7 s after `render()` or a touch (`wake3d()` / `frame3d()`). Camera3D reports input (`opts.onInput`) and `busy()`; Render3D passes them on as `onInput` / `still()`. In the shop it sits at 0 frames per second.
- **Speed meter** (`.meter3d`, top right of the 3D board, only when 3D is on). It shows frames in the last second, the slowest frame, and the quality with its pixels per CSS pixel. During a fight it adds live bodies and draw calls; after a fight, that fight's average frame rate, slowest second and most bodies. Tapping it steps the quality, through `render3d.js`'s `quality()`: high is up to 2 pixels per CSS pixel with shadows, medium 1.5 with shadows, low 1 without. The choice is saved in localStorage (`phone-bellum-3d-quality`). The meter is a testing aid: hide it, or move it behind a flag, once 3D is a setting.
- **Compact layout** for phones, for both boards:
  - smaller page padding;
  - the HUD in one row (round number beside its phase and buttons);
  - tighter deploy panel;
  - two-line tier tabs ("T2 Strong" / price), smaller shop cards.
  
  At 390×664 (Safari's usable height on an iPhone 13) the deploy screen now overflows by about 118 px instead of 227. The board keeps its size: it's still `min(100%, (100svh - 300px) * 0.75)` wide on `#wrap`. Raising that 300 would fit more on one screen but shrink the board.
- **Artifacts** (claude.ai, private to the owner):
  - "No Mans Land 3D Game", https://claude.ai/artifact/5ZUYFDjVS6eSv234RBHHEy: the full game starting on the 3D board, for phone testing. "Play vs Claude" doesn't work there; the match history and Claude features would need capabilities declared.
  - "No Mans Land · 3D test", https://claude.ai/artifact/S5EmsCVWqpqm3BfkWUQ5w8: the 3D test page. It's an older build, from before the black-floor fix and idling; republish it from `lab3d-artifact.html` if it's still wanted.
  - To update either: `node src/build.js && node tools/build-artifact.js`, then publish `game3d-artifact.html` or `lab3d-artifact.html` to its URL. `vendor/` is already published next to both.
- **3D test page** `lab3d.html` (`src/lab3d.js`, `src/lab3d-template.html`): deploy blue against the AI with unlimited gold, with Strategic / Angled / Ground buttons.

## Checks

- **Setup.** Serve the repo on port 8766 (`python3 -m http.server 8766`). Two-player checks also need `node tools/peer-server.js` on port 9000. Install with `cd tools && npm i`. Run each check with `NODE_PATH=<repo>/tools/node_modules node <repo>/tools/tests/<name>.js` from a scratch folder, because the checks write screenshots.
- **2D board unchanged:** `node tools/tests/snapshots.js <dir>` makes 71 fixed board moments (68 without the peer server). Compare against a run of `main`: `snapshots.js <new dir> <main dir>`. Every run since the merge has been identical to `main`.
- **3D:** `game3d.js` plays the game on the 3D board. It covers drag, place and take back, the tower, unit and enemy sheets, Move by tap, undo and drag, placing in the angled view, idling in the shop, the quality steps and the fight summary. `deploy3d.js` covers the 3D test page. Both need Chromium's software WebGL (set in the scripts), where one frame can take up to half a second. Headless frame rates say nothing about phones.
- **Factions:** `node tools/tests/factions.js` (headless).
- **Problems in older tests:**
  - `pack-ui.js` already failed before this work: a sheet covers the button it clicks.
  - `move-ui.js` fails now and then when a random package squad lands on its fixed target tile (5,11).
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
4. **Fall back to 2D when 3D can't run, and add a 2D / 3D switch in settings.** Start here.
   - The settings sheet is in `src/site-template.html` (look for `'Settings'` near the music sheet). The switch should replace the `?board=3d` test for whether 3D starts. Keep `?board=3d` and the inlined-code build as ways to force 3D for testing.
   - Turning 3D on mid-match should work: `start3d()` can run at any time. Turning it off needs a `stop3d()` that removes the 3D element, shows `cv` again, sets `board3d = null` and calls `size(); render();`. Free the WebGL context with `renderer.dispose()` and `renderer.forceContextLoss()`; this needs a `dispose()` call on Render3D.
   - Fall back when there's no WebGL (`start3d` already catches errors), on `webglcontextlost` on the 3D canvas, and when the phone is too slow. For "too slow", a reasonable rule is fights averaging under about 20 fps at low quality; the meter's per-fight numbers are already computed in `meterFrame()`. Tell the player once, in one line, when it falls back.
   - Remember the choice in localStorage, wrapped in try/catch like `Q3D_STORE`.
   - Hide the meter, or put it behind a flag, once the setting exists.
5. **Check that two-player matches stay safe.** The renderer only draws, and the battle engine is untouched, so fights still match on both phones. Test one phone on 2D and the other on 3D, rejoining a match, and the countdown. Add a check that 3D never shows what 2D hides from the opponent: hidden enemy squads, stealth units, tower types and characters before they're revealed. `render3d.js` uses the same `Game.*Shown` / `seenAt` / `hiddenFromFoe` rules as `render2d.js`; the check should compare what each board draws for the guest.
6. **Loading three.js** (about 720 KB). The live site serves it from `vendor/`, loaded only when 3D starts. The game artifact (`phone-bellum.html`) is a single inlined page with no 3D code. To offer 3D there, inline the 3D code as `game3d-artifact.html` does, and load three.js from a CDN pinned to 0.180.0 (jsDelivr is allowed) or publish `vendor/` next to it. Keep the 2D game opening as fast as before: only `import()` three.js when 3D is on. The 3D code itself (`camera3d`, `models3d`, `render3d`) is about 75 KB and could be inlined.
7. **Tests.** The existing Playwright tests tap the 2D board by grid position, so keeping 2D as the default keeps them valid. Add 3D versions of the remaining key flows on top of `game3d.js`: a full round in a two-player match, the elf tower, the altar, Charisma.
8. **Smaller gaps.**
   - Models for units that still use the general figures, and for faction towers, if wanted.
   - Fix the Counter Lab artifact build: its check rejects any page that mentions "Load units", and the Counter Lab help text now does.
   - Decide what the start screen and map picker look like in 3D; the map thumbnails can stay 2D.
   - View buttons (Strategic / Angled) in the game, if pinch and scroll aren't enough.
