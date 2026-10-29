# No Mans Land – Patch notes

Newest first. Each entry says what changed for players; technical details live in the README and `docs/`.

---

## 29 October 2026 – Balance

- **Tower falls:** a fallen tower still costs up to 10 health, but a round now costs at most **35 in all**, the tower included. A round that already did 35 damage costs nothing more for the tower; one that did 30 costs 5 more.
- **Necromancer:** hit 56 → **52**.
- **Meteor Caller:** splash 6 m → **5.5 m** (the mage tower's meteors too).
- **Obelisk – Evolve:** Eye of the Obelisk isn't bought any more. An Obelisk **evolves by itself, for free**, after the fight that fills its Glut (15), and keeps the Eye for the rest of the match. Enzo's Obelisks evolve too, and it doesn't use up your one awakened unit type.
- **Keep:** if you bought the +1 deployment before picking the Keep, you get the 50 gold back (Muster gives it for free).
- **Sniper tower:** can't hit anything within **1 tile** (6 m) of it.
- **Ember Imps:** health 110 → **90**. Ember Mortar: −0.2 attack speed (now −0.1 attacks/s instead of +0.1).
- **Wisps:** health 80 → **65**, attack speed 0.8 → **0.7**/s. Keep Guards (Wisps) follow.

---

## 29 October 2026 (late night) – Otto - The Gambler

### New leader: Otto - The Gambler
- Otto has a **slot machine**. Tap **Slots** in the tray: each spin costs **50 gold**, up to **3 spins a round**.
- Three of a kind pays out (or hurts):
  - 💀 **Skulls (12%):** −5 health. A skull never takes you below 1 health.
  - **Horseshoes (12%):** a free Move and +1 deployment this round. The free Move comes on top of your normal one.
  - 🪙 **Coins (12%):** +100 gold.
  - **Goblins "T1" (3%):** a random tier 1 squad at level 2, placed for you. Its unit is unlocked too, and it doesn't use a deployment.
  - 🧰 **Chest (1%):** +500 gold. Jackpot!
  - Anything else (60%): nothing.
- On average the machine loses money. Otto isn't meant to be strong, he's meant to be fun.
- Spins can't be undone, and your opponent sees what you rolled (from round 2, once leaders are revealed).
- The AI and Claude spin now and then when they play Otto.

### Looks
- **Goblin Swarm** has a new symbol on the board: a goblin head with big pointy ears.
- **Enzo's** crest is now a gift box (his free skill). Otto's crest has the dice.

---

## 29 October 2026 (late night) – Quality of life

### Deploying
- The deploy clock is now **1:30** every round (it was 1:00).
- **Keep tower – Muster:** you simply get **1 extra deployment every round**. There's no "+1" button to press any more.
- **Just a horse:** taking a squad out of a horse is **free**. It doesn't use your once-a-round Move, and the squad can keep moving (or get back in) for free that round.

### Sounds
- Using the **Move ability** now plays the purchase sound, so you hear that 50 gold was spent.
- Trying to drag an older squad you can't move (not enough gold, or you already moved one this round), or tapping a tile it can't go to, plays the "can't do that" sound.

### Board and menus
- The **tilted camera view** sits further back, so the enemy tower, its flag and its health bar are always on screen.
- **Path arrows** (Draw path) now show the squad's movement speed written along the arrow.
- The **Unlock** list shows a short description for every unit. Frost Wizard and the faction units used to show only a dot.
- Choosing **All units** in the main menu now also puts every leader back into the draw.

---

## 29 October 2026 (night) – Gold cap and shutdown bounty

### Gold carry cap
- You can carry at most **500 gold** into the next round. Anything above that is lost when the fight starts.
- If you press Fight or Ready with more than 500 gold, a warning tells you how much you'd lose, so you can keep shopping or go anyway.
- This stops "save everything, then flood the board with tier 4" from being the best plan.

### Shutdown bounty
- Win 3 rounds in a row and a 🔥 with your streak appears next to your health.
- The opponent who breaks the streak earns **+100 gold**, plus **+50** for each win past 3 (4 in a row pays 150, 5 pays 200).
- A draw ends both streaks without paying anything.
- The loser's +50 gold (from round 3) stays as it was.

---

## 29 October 2026 (late evening) – Main menu: map looks

### Looks
- The Frost look is now called **Darkwoods**, and its board no longer has the pale snow patches, snow caps and snowflakes painted on it.
- The board behind the title on the start screen now shows the map you picked in Match settings, in the look you picked. Change the map or the look and the board changes with it, while the title card fades back for a couple of seconds so you can see it properly.
- The Look picker wraps onto two lines instead of stretching out of the panel, so clicking through the looks no longer resizes the whole screen.

### Music follows the look
Deployment and battle music now belong to the look of the match, not the map:

| Look | Music |
|---|---|
| Darkwoods, Autumn | Mushroom Cavern combo |
| Snow | Icy Peak combo |
| Meadow, Desert, Forest (placeholder) | Standard combo |

Maps keep the music of their own look, so Mushroom Cavern and Frozen Peak sound as before, and Test Grid (whose own look is Darkwoods) now plays the Mushroom Cavern combo.

---

## 29 October 2026 (evening) – Music player on the start screen

- The start screen now has a **music player** under the menu buttons: the song playing, plus **Back**, **Play / Pause** and **Next**.
  - Back goes to the start of the song, or to the previous song if you press it in the first few seconds.
  - Next skips to another menu song. If you had picked one song in the Sound sheet, Next goes back to playing all menu songs.
  - Pause stops the menu music until you press Play. Turning music fully off is still done in the Sound sheet.
- The player's icons come from Kenney's Mobile Controls pack (CC0).

---

## 29 October 2026 (evening) – Fixes and tuning

### Fixes

- **PC: dragging units from the shop works again.** On a PC the board sits to the left of the panel, so dragging a card toward the board starts sideways, and the game took that as scrolling the shop. Sideways drags now pick up the card on a PC (the mouse wheel still scrolls the shop).

### Camera

- **PC: the tilted view (the second camera angle) sits a little further out**, so more of the enemy side is in view.

### Sound

- Sound effects now start at **45% volume** for new players (was 70%). If you had the old default, it moves to 45% too.
- The **UI click** (menus and in-match buttons) and the **Battle start** sound are a little quieter than the other effects.

---

## 29 October 2026 – Sound effects

The game now has sound effects, made by Snetänd.

### What makes a sound

| Sound | When it plays |
|---|---|
| Press unit in deployment | Pressing a unit card in the tray |
| Drop unit | A new squad lands on the board (also buildings and walls) |
| Press or drag in battlefield | Pressing one of your squads on the board |
| Drop or release in battlefield | Letting go of a squad you dragged to a new tile |
| Nope | A card or squad dropped where it can't go, a tile you can't place on, a locked card |
| Sell | Selling a squad |
| Undo action | Taking back a squad, a skill, a level, a move, an unlock or anything else bought this round |
| Level up | Leveling a squad or a building |
| Upgrade skill | Buying a skill (unit, tower or building) or unlocking a unit |
| Evolve / Master / Awaken | Buying a Master skill or awakening a squad |
| Battle start | The fight begins |
| Press UI button | Any other button during a match |
| Menu UI click | Any button in the menus |
| Go back to menu | Leaving a match for the main menu |

Only your own actions make sounds; the AI and your opponent stay quiet. The most frequent sounds shift pitch slightly each time so repeats don't grate.

### Settings

- The menu's Music button is now called Sound.
- The Sound sheet (and the in-match Settings) has Sound effects On/Off and an Effects volume slider (45% to start), separate from the music. Your choice is saved on the device.

---

## Earlier (summary)

- **28 Oct – Economy and towers.** Treasury and raids on Test Grid, loans for everyone, a once-per-match Major investment, loser bonus only from round 3, a fallen tower costs 10 health. Tower traits: Keep's Muster, Sniper's Mark Bounty and Airship, Bastion's Fortify and Vault. New Encyclopedia on the start screen.
- **27 Oct – Roguelike plan.** Enemy-only units and new fight mechanics (death zones, banner auras, walls, regrowing Hydra heads, Mirror Wraith, the Lich) for a future solo mode.
- **26 Oct – UI 2.0.** The deploy panel became a tray that never covers the board: drag cards straight onto the board, drag squads back to the tray to take back or sell.
- **23 Oct – Factions devtest.** Faction draft, lesser buildings, Powers, spells, the Mechites, and a Miro board synced from the game data.
- **15 Oct – Characters and bigger zones.** Four leaders (Frickolas Cage, Zoe, Emile, Wilhelm), fixed towers, 6-row zones, 60 health, new prices (100/200/300/500), Split beam and Forward planting skills.
- **12–14 Oct – Live multiplayer, skills and selling.** Play a friend over a link, two skill slots per unit, selling older squads for half price.
