# UI 2.0 plan (2026-10-26)

Test page: `ui2-test.html` (standalone prototype of the deploy screen, Standard pack data, round 2 position; the fight is only stood in for). Not wired into the game yet.

## What the screenshots of the current build showed (iPhone 390 x 744, 3D board)

- With the drawer up (the start of every round), the drawer covers your own deployment zone: you can't see your army while you shop. Biggest problem.
- The drawer stacks four rows before any card: gold + deployments + ?, +1 deployment / Move a squad, four tier tabs, then 3 cards. Only 3 units visible at once; tier tabs are the main navigation.
- Cards repeat information (3-letter tag, T1, full name, 2-3 role symbols, "CAN UNLOCK FOR 50 GOLD" in caps, price, bodies).
- Placing: tap card, the drawer drops, an instruction box appears, tap tile. Works, but three state changes for one action.
- The squad sheet is long: role symbols plus their words, a description, a Take back button, stat pills, then skills with paragraph-long text and greyed "Need 200 gold" buttons.
- Each placed squad gets an ✕ on its tile; Move is a separate button and mode; Sell lives in the sheet.
- The fps meter shows when 3D is forced (test only). The result screen is already clear.
- Start menu: tutorial, friend, AI, factions (coming soon + devtest), code join, unit pack and settings all on one screen.

## Plan

1. Tray instead of drawer: one row of compact cards under the thumb. The whole board stays in sight. Grouped by tier: a small tier tab (with the price), your unlocked units, then a "+ Unlock" space (same size as a card) while that tier has units left. + Unlock opens a short list of the tier's locked units; unlocking adds the card and picks it. (Vilhelm's idea, 2026-10-26.)
2. Drag a card up onto a tile (ghost floats above the finger on touch, glowing valid tiles, range ring, price label). Tap card then tile still works. Hold a card for details.
3. Locked units are not in the tray; they live behind each tier's + Unlock space.
4. No ✕ marks and no Move button: drag a new squad freely or down to the tray to take it back; drag an older squad to move it (50, once a round) or down to sell (confirm sheet).
5. Deployments as pips next to gold, +1 beside them. Leaders as portraits in the top bar. Round clock as a ring around the round number.
6. The squad sheet takes the tray's place, so the board shrinks but stays whole, with the range ring shown. One big Level up button, one-line skills with price on the button.
7. Later: move Factions devtest and code join behind "More" on the start menu; keep tutorial / vs AI / friend as the three main buttons.

Open questions: does the tray need a filter when a roster has 25+ units (All units)? Where do towers, buildings, Powers and spells go in the tray (devtest)?
