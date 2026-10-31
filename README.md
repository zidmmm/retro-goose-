# Crash Bandicoot Adventure

A Crash-style 3D platformer that runs in the browser (Three.js) using a custom player model.

## Run
```
python3 -m http.server 8000
```
Open http://localhost:8000

## Controls
- WASD / arrows: move
- Space (or K): jump (hold for higher)
- Shift / J / X: spin attack (breaks crates, kills enemies)

Stomp crates and enemies, collect fruit (100 = extra life), hit checkpoint crates, reach the portal.

## Credits
- Dr. Neo Cortex model by [SG_Gaming786](https://sketchfab.com/SG_Gaming786), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/dr-neo-cortex-ps1-a4bef64f0ba94ced9268e8082bd986ed
- Ripper Roo model by [Mechatorrs](https://sketchfab.com/Mechatorrs), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/ripper-roo-crash-bandicoot-1996-psx-91a623efb1974244812b89b99c700391
- Uka Uka model by [AlexDingo051](https://sketchfab.com/AlexDingo051), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) (the Uka Uka mask was cut out of the combined "Dr. Neo Cortex / Uka Uka (CB3 boss fight)" model)
- Aku Aku model by [anttipantti](https://sketchfab.com/Kassugamerproo), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/aku-aku-3e3c0e0ece2c4a8bb30f5d27c1f89d4a

## Aku Aku
- You start without him. Break an Aku Aku crate (the one with his face) to summon him: he blocks hits.
- A second crate powers him up (silver glow, blocks two hits).
- A third crate turns him gold: you are invincible for 8 seconds (Aku Aku sits on Crash's face like a mask), except for falling into the water.

## Crates
- Plain crate: drops exactly 1 Wumpa when smashed.
- Crash crate: extra life. C crate: checkpoint. Aku Aku crate: Aku Aku / power-ups.
- TNT: jump on it (3 second countdown) or spin it (goes off almost at once). The blast hurts you, enemies and nearby crates.

## Boss fight
Reach the portal at the end of the level to face Ripper Roo (5 lives, shown on the health bar). Small rocks roll at you: jump or dodge them (a spin smashes them). Every so often a big glowing rock rolls in: spin into it to knock it back, and Ripper Roo loses a life.

## Sound
All music and sound effects are synthesized in the browser (no audio files). Jungle theme during the level, a faster theme for the boss. Press M or tap the speaker button (top right) to mute; the choice is remembered.

## Level 2: boulder chase
After Ripper Roo, a giant boulder chases you down a long track. You run toward the camera (down arrow / stick down), so jump the gaps, hurdles and spikes and keep ahead of it. Red screen edges and a rumble warn you when it is close. Aku Aku shoves it back once if it catches you; otherwise you lose a life and restart from the last checkpoint crate.

## Boss: Dr. Neo Cortex (end of World 1)
He hovers on a platform and fires ray-gun zaps at you (6 lives on the health bar). Green zaps just hurt, so dodge them. Every third zap is golden (his gun glows gold first): spin into a golden zap to knock it back at him. At half health he pulls a lever: four platforms rise out of the floor, then the floor (a trap door) drops away, so jump onto a platform before it opens. In stage two he fires faster, and platforms collapse one at a time, so keep moving.

## World 2: the temples
Beating Dr. Neo Cortex ends World 1 and opens the burning temples: a dusk sky, lava below, carved stone and torches. The game is won after the final boss of World 2.
- **Level 3, the temple** (a long platformer): fire jets that glow red, then burst (the side jets and the middle jet take turns), crumbling stone slabs over the lava that shake and drop shortly after you land (they grow back), stepping-stone pillars, spike halls, a hill with jets on top, enemies, and plenty of checkpoint, Aku Aku and life crates.
- **Level 4, the fire chase**: like the boulder chase, but a tall wall of fire chases you toward the camera. Aku Aku shoves it back once.
- **Final boss: Uka Uka** (6 lives): a huge floating mask. He spits **fireballs**: jump over them (spinning does not help). Every third shot is a **blue spirit orb** (he glows blue first): spin into it to knock it back and he loses a life. At half health the floor catches fire: lanes of flame burst across it in stage two, so keep moving and jump the fire. He shoots faster, and sometimes twice.

## Collision
Crash's collision is a flat disc at his feet (like the original trilogy), not a box. Corners are round, so he slides around crates, walls and ledge corners instead of catching on them. He can still stand with his centre slightly past a platform edge.

## Game Over
If you run out of lives, the button restarts the stage you were on (level 1, the Ripper Roo fight, the boulder chase, the Dr. Neo Cortex fight, the temple, the fire chase, or the Uka Uka fight) with 3 lives, instead of sending you back to the start of the game. After beating the whole game, Play Again starts from level 1.

## Start sequence
The game opens with "Retro Goose presents" (your hand-drawn logo), then the game logo and a PLAY button, then the world map with a START button; START teleports Crash to level 1. Tap the logo to skip the intro. Add `?nomap` or `?nointro` to skip it.

## World map
After every stage a 3-D map of the island plays (World 2 is on a second, scorched island joined to the first): the camera flies over it, then follows Crash as he runs along the road from the stage you just beat to the next one (the trail turns gold behind him), and he jumps for joy when he arrives. Tap the screen or press Enter to skip it. Add `?nomap` to the page address to skip it automatically (handy for testing).
