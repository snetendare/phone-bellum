# Phone Bellum: art direction

How the units should look and why. Written 2026-10-20, after the first Ent pilot in Blender.

## The idea behind the visuals

Every unit is a character that lives in one shared world, not a game piece. A player should be able to look at a unit for a second and know how it feels and get a hint of its life outside the fight. The style is rounded, smooth and chunky low poly with a hand-painted finish, closer to a storybook than to a shiny mobile game.

## Rules of thumb (all units)

1. One clear emotion per unit. Happy, sad, bored, excited, snobbish, nervous, tired... It must read at phone size, mostly from the silhouette, the pose and the eyes. The emotion doesn't have to be related to the unit's job.
2. One world detail per unit. A small prop or trait that hints at a life outside the battle: a cigar, a mug, a patched hat, a bird's nest. It should make the unit feel like it belongs to the same universe as the others.
3. When possible, the emotion explains the mechanics. Example: the Ent walks slowly because he's half asleep, and his death is him giving up and flopping over. When the emotion and the behavior say the same thing, the unit is easier to remember.
4. Pastel-ish, dusty colors. No neon or bright saturated colors. Fire, magic and glows are soft peach, amber or pale tones. Use warm and cool contrast, not saturation, to make things pop.
5. As close to hand-painted as we can get. Soft gradients (darker at the bottom, lighter at the top), painted grain and marks (wood grain, moss, stitches), soft baked shadows. Avoid plastic or clay-looking surfaces.
6. Rounded and smooth, but not cute by default. Chunky, simple forms with soft edges. Proportions follow the character: a lanky slouching teen is tall and thin, a brute is wide. Avoid making everything round, fat and baby-faced.
7. Keep faces simple. Few parts: eyes, lids or brows, mouth. The emotion comes from shape and placement, not from many sculpted details.
8. The unit must read as what it is first. A tree has to look like a tree (bark, trunk, branches), then the character is added on top.
9. Silhouette first. Units are seen small and from above, so the outline and the biggest shapes matter most. Small details are a bonus.

## Technical rules

- Built in Blender with Python scripts, so every unit can be rebuilt and kept consistent. If Vilhelm edits a model by hand, continue from his version instead of regenerating.
- Each unit is split into separate parts (body, head or face parts, arms, legs, props) with pivots at the joints. Most animation is done in code (idle, walk, attack, hit, death), not with a rig. Only big showpiece units get keyframed clips.
- Animation is visual only. The deterministic battle engine is never touched by the visuals, so multiplayer stays in sync.
- Colors are vertex colors on one shared material, with no image textures for now. Target 500 to 1000 triangles for a normal unit and 150 to 300 for swarm bodies.
- Exported as GLB for Three.js. Swarms are drawn with instanced meshes.
- Reference images are inspiration only. We don't copy specific characters.

## Reference mood

Vilhelm's references: a voodoo doll with a wooden mask, a skull robot, a rock golem with floating limbs, a barrel knight, a chunky mech, a stone golem with a small creature on it, and simple low-poly brute meshes. What we take from them: chunky simple forms, floating or blocky limbs, soft painted surfaces, warm and cool contrast, and personality.

## Units

### Ent: the sleepy teen tree

- Emotion: sleepy, bored teenager who was just woken up.
- World detail: a bird's nest in his broken treetop, with a small bird that is far more awake than he is.
- Look: one tall trunk with the face carved into it, slight forward slouch, long branch arms hanging low, stubby root legs, a few lopsided leaf clumps. Heavy bark eyelids over dull eyes, a slack mouth.
- Attack: he can't be bothered to aim, so he slams the ground in front of him (the attack is being changed to a 180 degree fan to match).
- Death blast upgrade: instead of exploding, he gives up and flops face-first. Dust, leaves and the bird fly off. Without the upgrade he just crumples.
- Forward planting: he sleepwalked there and rooted.
- Role: a meatshield, not a counter unit.
- Status: pilot v2 accepted as the right direction. To polish: wider lopsided mouth, visible bark grain and knots, fuller drooping leaf clumps, knobblier fingers and flatter root toes, legs that look more like a split trunk, a bigger nest and bird.

### Leaf Wizard: the smug ninja

- Emotion: smug. The most ninja of the wizards, and a cocky show-off about it.
- World detail: a scroll of leaf techniques strapped across his back.
- Look: a low, wide leaf kasa with a jagged edge pulled down over his eyes and a short wizard tip swept back; half-lidded glowing eyes (one squinting harder, a smirk without a mouth) over a scarf pulled up as a mask; long scarf tails streaming behind; fans of big leaves on the shoulders; a staff with a glowing leaf blade carried trailing behind; a ready stance, chin up, one hand in a hand seal with glowing leaves circling it. Few small details, big shapes.
- Mechanics: he can't just walk somewhere, he wind-walks there and strikes a pose.
- Style: Frutiger Aero, after the owner's references (2026-10-26): glossy, fresh lime and leaf greens, sky blue and white accents, leaves lighting up to a pale blue at the tips, emissive eyes and blade. This breaks rule 4 (dusty pastels, no bright saturated colours) and rule 5 (hand-painted, not plastic) on purpose. Open question: is this the new look for every unit, or only the Leaf Wizard?
- Two materials instead of one: the glossy one and an emissive twin for the glowing parts.
- Built by `tools/blender/leaf_wizard.py` (run it in the open Blender, or from a terminal). Status: v3, waiting for the owner's feedback.

### Ideas for later

- Fake ent: a nervous goblin dressed up as a bush or ent, hiding a bomb inside. Its own unit, not a replacement for the Ent.
