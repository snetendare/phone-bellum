# Frost Wizard and Obelisk: balance proposal

Numbers came from headless simulations: equal-gold fights against every other unit, averaged over 600, 1200 and 3000 gold a side, plus full AI-vs-AI matches. The score runs from -100 to +100: 0 means a unit is worth its gold, and the roster averages 0. These are a starting point for playtesting, not final values.

## Frost Wizard (tier 3, 300 gold)

900 health, 34 hit, 2 attacks a second (68 dps), 25 m beam, 2 m/s. You gave the mechanics (Frost 20/30/40%, a stack every 2.5 s, Deepfreeze 2 s, Multibeam, +5 m / +20% / healthiest, an 8 m storm). I chose only the base stats.

| Build | Score |
|---|---|
| no skills | about -5 (counter table -15, next to Water Mage and Shiv) |
| + Multibeam | about +45 |
| + Glacial gaze | about +30 |
| + Multibeam + Snow storm | about +55 |
| other tier 3 units, no skills | Flame 45, Steel 34, Slime 63, Water -10, Rogue -7 |

- Mirror fights can't show the value of its slows to *other* units, so it is deliberately a bit under its gold on paper.
- Deepfreeze barely registers in the sims: most targets die before the 7.5 s it takes to freeze them. It should matter against tanks (Golem, Mammoth, a high-Glut Obelisk).
- Multibeam beats Glacial gaze by about 15 points.

**Playtest:** whether the slows feel strong in mixed armies; whether Deepfreeze is ever worth buying; whether Glacial gaze ever beats Multibeam.

## Obelisk (tier 3, 300 gold)

A giant serpent. 1300 health, 90 hit, 0.7 attacks a second, melee (3 m), 4 m/s. Heals for 50% of the damage it deals (Devour). Glut: +6% health and hit per stack, up to 2 a round, 12 in all.

**Strength by Glut** (base unit, no skills):

| Glut | 0 | 3 | 6 (half) | 9 | 12 (max) |
|---|---|---|---|---|---|
| Score | -37 | -18 | +1 | +18 | +27 |

The 50% heal on its own moved the curve up about 18 points (+21 at half Glut, with the earlier 1550 health and 100 hit). Health and hit were lowered to put it back on the brief.

This hits the brief: weaker than its gold below half stacks, about even at half, stronger above.

**How fast Glut comes** (60 AI matches each, measured before the heal; the heal keeps it alive longer, so likely a little faster now):
- Bought in round 2: about 4 by round 4 and about 6 by round 6. It reaches 12 around round 8, in about 1 match in 4.
- With Gluttony (3 a round): full around round 6–7, in almost half the matches.
- Bought in round 4: it rarely fills before the match ends. A late Obelisk is a weak buy, by design.

**Two changes the sims forced:**
1. **Speed 4 instead of something slow.** At 2.2 m/s it dealt no damage in 65% of fights: its ranged allies won before it arrived. It then ate about 0.3 stacks a round and never got close to max.
2. **It also eats enemies that fall within 6 m of it (one tile), whoever killed them**, not only its own kills. That fits "eats units" and keeps it from relying on last hits. The cap of 2 a round is now the real limit.

**Skills** (measured before the heal):
- Gluttony: +1 stack a round (tempo only).
- Hunger's haste: +0.1 m/s and +1.5% attack speed per stack (+18% attack speed at 12, about +3% every 2 stacks). Worthless fresh, +10–15 points at high Glut.
- Crushing maw (3 m splash): about +35 points at every Glut level, and its splash damage heals it too. Much stronger than Hunger's haste.
- Eye of the Obelisk (Awaken, only at 12 Glut): ranged, 18 m. With Crushing maw at 12 Glut it scores about +64, close to Meteor Caller, the strongest unit. That is fine as a late capstone, but watch it.

**Playtest:**
- Does it fill in time to matter (rounds 7–9)?
- Is Hunger's haste ever picked over Crushing maw? If not, make Crushing maw a 2 m splash or give Hunger's haste more speed.
- Is the awakened Obelisk with Crushing maw too strong?
- Does the heal make it too hard to kill, especially with Crushing maw against swarms?
- The AI picks units from the counter table, which sees the Obelisk at 0 Glut, so the AI will rarely buy it.

To tune: the numbers are in `src/default-roster.json` (`glut` on the unit, and the skills). Run `node tools/counter-table.js` and `node src/build.js` afterwards.
