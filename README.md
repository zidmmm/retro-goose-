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

## Final boss: Dr. Neo Cortex
He hovers on a platform and fires ray-gun zaps at you (6 lives on the health bar). Green zaps just hurt, so dodge them. Every third zap is golden (his gun glows gold first): spin into a golden zap to knock it back at him. At half health he pulls a lever: four platforms rise out of the floor, then the floor (a trap door) drops away, so jump onto a platform before it opens. In stage two he fires faster, and platforms collapse one at a time, so keep moving.
