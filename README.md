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
