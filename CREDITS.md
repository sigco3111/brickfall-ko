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
| Fonts: Black Han Sans and Noto Sans KR (Korean localization) | installed from npm (Fontsource) into the build | JIKJI SOFT (Black Han Sans), The Noto Project Authors | SIL OFL 1.1 |
| Music bed, a "demolition crew" groove, looped | `public/audio/music_1.*` | Generated for this game with Sonilo v1.1 | Generated for Patch |
| Air horn and whistle | `public/audio/horn_*`, `public/audio/whistle_*` | Generated for this game with ElevenLabs Sound Effects v2 | Generated for Patch |
| Levels, buildings, props, tools and machines | code | Built from voxels and boxes for this game | MIT |
| Synthesised sounds (sub thumps, cracks, rumble, steps, glass tinkle, alarms, engines) | `src/audio.ts` | Brickfall and three-voxel-destruction | MIT |
| Needs-WebGPU backdrop and favicon | `public/needs-webgpu.jpg`, `public/favicon.svg` | A frame of the game; drawn for it | MIT |

## Recorded sounds

67 of the 86 recorded takes are filled with open recordings of the same names from Patch's voxel destruction block (CC0 and CC-BY-4.0; CC-BY asks for credit, given below and in the game's credits overlay). The other 19 (`boom`, `boom_tail`, `thud`, `plaster_*`, `groan_masonry`) keep the repo's silence stand-ins.

Open recordings used (cut and mastered for Patch's destruction block; sources: Freesound and Kenney):
  CW_Cannon_Single1.wav by richardemoore, CC-BY-4.0: https://freesound.org/people/richardemoore/sounds/162626
    used in: cannon_body, cannon_report
  Howitzer Artillery Gun Shot Sound Effect 03 by qubodup, CC0-1.0: https://freesound.org/people/qubodup/sounds/161341
    used in: cannon_body
  Tykki, laukaus / Big gun, cannon, 76 mm, single shots, gunshots by YleArkisto, CC-BY-4.0: https://freesound.org/people/YleArkisto/sounds/332935
    used in: cannon_body, cannon_report
  impact-sounds/impactMetal_medium_000.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: clack
  impact-sounds/impactMetal_medium_001.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: clack
  metal door.wav by ninebilly, CC0-1.0: https://freesound.org/people/ninebilly/sounds/173014
    used in: steel_burst, strain
  Large Metal Lift Door Closing.wav by lolamadeus, CC0-1.0: https://freesound.org/people/lolamadeus/sounds/161230
    used in: steel_burst, metal_L, strain
  S020_Rock_Impact_Mono.wav by Pól, CC0-1.0: https://freesound.org/people/P%C3%B3l/sounds/385938
    used in: hit_brick
  Big bricks falling sound.wav by Rosa-Orenes256, CC0-1.0: https://freesound.org/people/Rosa-Orenes256/sounds/540913
    used in: hit_brick, hit_brick_big
  PieceofConcrete01.wav by kingsrow, CC0-1.0: https://freesound.org/people/kingsrow/sounds/194688
    used in: hit_brick
  Foley_Impact_Stones_Strong_Debris_Stereo_DS.wav by Nox_Sound, CC0-1.0: https://freesound.org/people/Nox_Sound/sounds/554148
    used in: hit_brick_big
  Wood Fall.wav by Manim8, CC0-1.0: https://freesound.org/people/Manim8/sounds/577454
    used in: hit_wood
  Wood Fall 2.wav by Manim8, CC0-1.0: https://freesound.org/people/Manim8/sounds/577455
    used in: hit_wood, wood_M
  wood impact axe chop real int echo.flac by kyles, CC0-1.0: https://freesound.org/people/kyles/sounds/454381
    used in: hit_wood
  Heavy Metal Impact 2 by magnuswaker, CC0-1.0: https://freesound.org/people/magnuswaker/sounds/614063
    used in: hit_metal, metal_L
  Metal Impact by Rickplayer, CC0-1.0: https://freesound.org/people/Rickplayer/sounds/530486
    used in: hit_metal
  Glass Shatter 4.wav by Greg_Surr, CC0-1.0: https://freesound.org/people/Greg_Surr/sounds/554566
    used in: hit_glass, glass_break
  window break with axe glass shatter in trailer.wav by kyles, CC0-1.0: https://freesound.org/people/kyles/sounds/452667
    used in: hit_glass, glass_break
  Glass Smash.wav by chewiesmissus, CC0-1.0: https://freesound.org/people/chewiesmissus/sounds/244238
    used in: hit_glass, glass_break
  Stone Impact Rubble Debris 6 by Sheyvan, CC0-1.0: https://freesound.org/people/Sheyvan/sounds/569502
    used in: debris_small
  Stone Impact Rubble Debris 11 by Sheyvan, CC0-1.0: https://freesound.org/people/Sheyvan/sounds/569507
    used in: debris_small
  Stone Impact Rubble Debris 4 by Sheyvan, CC0-1.0: https://freesound.org/people/Sheyvan/sounds/569500
    used in: debris_small
  Stones Falling by iwanPlays, CC0-1.0: https://freesound.org/people/iwanPlays/sounds/567251
    used in: debris_mid
  Dropping Rocks by iwanPlays, CC0-1.0: https://freesound.org/people/iwanPlays/sounds/567250
    used in: debris_mid
  Gravel Impacts and Falls.wav by lolamadeus, CC0-1.0: https://freesound.org/people/lolamadeus/sounds/179341
    used in: debris_mid
  Rockslide 2.wav by juskiddink, CC-BY-4.0: https://freesound.org/people/juskiddink/sounds/79783
    used in: debris_big
  Bakers house collapse by DasWaff, CC0-1.0: https://freesound.org/people/DasWaff/sounds/721600
    used in: debris_big
  Pouring Gravel.mp3 by sassyde, CC0-1.0: https://freesound.org/people/sassyde/sounds/271130
    used in: debris_big, slide_rubble
  stonehit3.wav by aerror, CC0-1.0: https://freesound.org/people/aerror/sounds/350748
    used in: concrete_S
  stonehit2.wav by aerror, CC0-1.0: https://freesound.org/people/aerror/sounds/350749
    used in: concrete_S
  brick falling on brick.wav by Hankof, CC0-1.0: https://freesound.org/people/Hankof/sounds/655622
    used in: concrete_S
  Stone Impact Rubble Debris 14 by Sheyvan, CC0-1.0: https://freesound.org/people/Sheyvan/sounds/569510
    used in: concrete_M
  Stone Impact Rubble Debris 1 by Sheyvan, CC0-1.0: https://freesound.org/people/Sheyvan/sounds/569497
    used in: concrete_M
  Concrete Hit 2 by dslrguide, CC0-1.0: https://freesound.org/people/dslrguide/sounds/321478
    used in: concrete_M
  Concrete SMASH by magnuswaker, CC0-1.0: https://freesound.org/people/magnuswaker/sounds/522098
    used in: concrete_L
  Rock collapse or destruction by Vozme, CC0-1.0: https://freesound.org/people/Vozme/sounds/590096
    used in: concrete_L
  Wood impact Board Short by Sheyvan, CC0-1.0: https://freesound.org/people/Sheyvan/sounds/569443
    used in: wood_S
  Wood impact Board Dull by Sheyvan, CC0-1.0: https://freesound.org/people/Sheyvan/sounds/569444
    used in: wood_S
  Wood impact Single Plank 3 by Sheyvan, CC0-1.0: https://freesound.org/people/Sheyvan/sounds/569723
    used in: wood_S
  Clatter wood_05.wav by deleted_user_2104797, CC0-1.0: https://freesound.org/people/deleted_user_2104797/sounds/349270
    used in: wood_S
  Clatter wood_07.wav by deleted_user_2104797, CC0-1.0: https://freesound.org/people/deleted_user_2104797/sounds/349268
    used in: wood_M
  Clatter wood_06.wav by deleted_user_2104797, CC0-1.0: https://freesound.org/people/deleted_user_2104797/sounds/349269
    used in: wood_M
  impact-sounds/impactPlank_medium_000.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: wood_L
  impact-sounds/impactPlank_medium_002.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: wood_L
  impact-sounds/impactMetal_heavy_000.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: metal_S
  impact-sounds/impactMetal_heavy_001.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: metal_S
  impact-sounds/impactMetal_medium_002.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: metal_S
  impact-sounds/impactPlate_medium_000.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: metal_S
  Falling scrap metal by 13FPanská_Tolar_David, CC0-1.0: https://freesound.org/people/13FPansk%C3%A1_Tolar_David/sounds/378670
    used in: metal_M
  impact-sounds/impactPlate_medium_001.ogg by Kenney, CC0-1.0: https://kenney.nl/assets/impact-sounds
    used in: metal_M
  Brick-Drop-Concrete-02.wav by DWOBoyle, CC-BY-4.0: https://freesound.org/people/DWOBoyle/sounds/145693
    used in: brick_S
  Brick Drop on Gravel 1.wav by dichardson, CC0-1.0: https://freesound.org/people/dichardson/sounds/570961
    used in: brick_S
  Brick-Drop-Concrete-06.wav by DWOBoyle, CC-BY-4.0: https://freesound.org/people/DWOBoyle/sounds/145695
    used in: brick_S
  brick falling on floor.wav by Hankof, CC0-1.0: https://freesound.org/people/Hankof/sounds/655621
    used in: brick_S
  pour out gravel on the stairs.wav by Dalibor, CC0-1.0: https://freesound.org/people/Dalibor/sounds/34175
    used in: creak_wood
  Large Metal Lift Door Opening.wav by lolamadeus, CC0-1.0: https://freesound.org/people/lolamadeus/sounds/161228
    used in: creak_steel

## Left out

19 recorded takes remain silence stand-ins (see above). The original 86 recordings were cut from the Sonniss GDC Game Audio Bundle (licensed for use in games, not for passing on). [MISSING_ASSETS.md](MISSING_ASSETS.md) has each one and where to get it.

Added to Patch by Patch. The author of three-voxel-destruction can claim this listing.
