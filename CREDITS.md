# Brickfall credits

Brickfall is a first-person voxel demolition game made for Patch. It is built on **three-voxel-destruction** by **Steven Bobyn** (MIT), from https://github.com/sbobyn/three-voxel-destruction at commit 8c4b058. The voxel world, the GPU physics use, destruction, structural collapse, rendering, smoke and dust, debris readback, device tuning, sky and synthesised sounds are his work. Brickfall adds the game: the contracts and modes, the tools, scoring and combos, propane tanks, gas lines and spreading fire, the replay camera, materials with hardness and a readable load, blast light, char and scorch, the sea, planks, spatial sound, the screens and the music.

This file covers what's in this repo. `public/CREDITS.md` ships with the game and covers the release on Patch, which also has the recorded sounds listed in [MISSING_ASSETS.md](MISSING_ASSETS.md).

## Code

| What | Author | Licence |
|---|---|---|
| three-voxel-destruction (the base of this game) | Steven Bobyn | MIT (`LICENSE`) |
| Brickfall's game layer and changes | Patch | MIT (`LICENSE`) |
| three-avbd 0.2.1 (GPU rigid bodies, from npm) | Steven Bobyn | MIT (`public/LICENSES/three-avbd-MIT.txt`) |
| three.js r186 | three.js authors | MIT (`public/LICENSES/three.js-MIT.txt`) |

## Art and sound in this repo

| What | Where | Source | Licence |
|---|---|---|---|
| Surface textures: brick_wall_005, concrete_wall_008, plastered_wall_02, damaged_plaster, asphalt_03 | `public/textures/` | Poly Haven (Dimitrios Savva, Dario Barresi, Charlotte Baglioni, Amal Kumar) | CC0 |
| Skies: Qwantani late afternoon and Qwantani sunset (puresky, 1k) | `public/hdri/` | Poly Haven | CC0 |
| Fonts: Anton and Inter | installed from npm (Fontsource) into the build | The Anton Project Authors, The Inter Project Authors | SIL OFL 1.1 (`public/LICENSES/`) |
| Music bed, a "demolition crew" groove, looped | `public/audio/music_1.*` | Generated for this game with Sonilo v1.1 | Generated for Patch |
| Air horn and whistle | `public/audio/horn_*`, `public/audio/whistle_*` | Generated for this game with ElevenLabs Sound Effects v2 | Generated for Patch |
| Levels, buildings, props, tools and machines | code | Built from voxels and boxes for this game | MIT |
| Synthesised sounds (sub thumps, cracks, rumble, steps, glass tinkle, alarms, engines) | `src/audio.ts` | Brickfall and three-voxel-destruction | MIT |
| Needs-WebGPU backdrop and favicon | `public/needs-webgpu.jpg`, `public/favicon.svg` | A frame of the game; drawn for it | MIT |

## Left out

86 recorded sounds, cut from the Sonniss GDC Game Audio Bundle (licensed for use in games, not for passing on). [MISSING_ASSETS.md](MISSING_ASSETS.md) has each one and where to get it.

Added to Patch by Patch. The author of three-voxel-destruction can claim this listing.
