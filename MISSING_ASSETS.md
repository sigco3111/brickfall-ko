# Missing assets

Brickfall's release on Patch has 90 recorded sounds (180 files) that this repo leaves out. Their licences let them ship inside the game but not be handed on as files, so they can't sit in a repo anyone can download. Everything else the release has is here.

**The game runs without them.** `src/audio.ts` skips a take whose file isn't there, so each missing sound is silence. The synthesised layers (sub thumps, cracks, rumble, steps, glass tinkle, alarms, engines) and the music still play. Explosions and impacts sound thin until you add sounds back, and the end-of-round whistle falls back to a beep.

## The quick fix: open sounds of the same names

Patch's voxel destruction block has CC0 and CC-BY takes under 67 of the 86 recorded names below. They aren't the same recordings, but they're cut for the same jobs:

```sh
git clone https://git-staging.patch.gg/patch/voxel-destruction.git ../voxel-destruction
node tools/open-sounds.mjs ../voxel-destruction
```

The script copies only files that are missing, and lists what's still missing. Then copy the credit line of each copied sound from the block's `CREDITS.txt` (it lists them under "used in") into `CREDITS.md`, `public/CREDITS.md` and `public/patch-credits.js`, since CC-BY asks for credit. The other 19 (`boom`, `boom_tail`, `thud`, `plaster_*`, `groan_masonry`), the horn and the whistle need sounds from elsewhere: Kenney's CC0 packs (https://kenney.nl/assets/impact-sounds), Freesound searches filtered to CC0 (https://freesound.org/search/?f=license:%22Creative+Commons+0%22), or Patch's asset library (`search_assets` with `type: ["audio"]`).

## How to drop a sound in

- Put it in `public/audio/` as `<name>_<take>.ogg` (Vorbis) **and** `<name>_<take>.m4a` (AAC), with the name from the tables below. Safari plays the `.m4a`, everything else the `.ogg`.
- Any sound that does the same job works. Mono for one-shots, so the game can pan them; stereo is fine for tails and loops.
- How many takes a layer has is set by `LAYERS` in `src/audio.ts`; a layer plays a random take each time. `TRIM` beside it holds per-take level fixes (dB) for the original takes: delete a take's entry when you replace it, and set your own if a take stands out.
- Anything you add has to be open enough to ship in a repo anyone can fork if you push it here: CC0 or CC-BY, credited. Sounds under game-only terms (like the originals) can go in your released game, but keep them out of git (add them to `.gitignore`).

## The original recordings

All 86 recorded layers were cut from the **Sonniss GDC Game Audio Bundle**, 2016 to 2020. The bundles are free to download, each year under its own heading at https://sonniss.com/gameaudiogdc. **Licence:** https://sonniss.com/gdc-bundle-license/. Royalty free, commercial use, no credit needed, for use inside games and other finished projects. It does not allow passing the sounds on as sounds, processed or not, so keep them out of this repo, and never use them with an AI tool.

To rebuild the exact cuts once you have the bundles:

```sh
cd tools/audio-build
SONNISS_DIR=/path/to/sonniss node build.mjs
```

`SONNISS_DIR` holds the year folders (`2016/`, `2017/` and so on), each with the libraries unzipped under the names below. It needs `ffmpeg` and `ffprobe`. It writes straight into `public/audio/`, and `layers.json` has each take's source and measured loudness. Encoders differ, so the result sounds the same but isn't byte-identical to the release.

"Open" says whether the voxel destruction block has a take of that name.

| Path | What it is | Sonniss bundle year: library | Source file and cut | Open |
|---|---|---|---|---|
| `public/audio/cannon_body_1.ogg`, `.m4a` | The hand cannon's shot, its body | 2020: Bluezone - Tank - Explosion Sound Effects | `Bluezone_BC0271_tank_artillery_cannon_shot_012.wav`, from 0 s for 2.4 s | yes |
| `public/audio/cannon_report_1.ogg`, `.m4a` | The cannon's report off the town | 2018: Lukas Tvrdon - Distant Blast | `Distant Blast 17.wav`, from 0 s for 3 s | yes |
| `public/audio/cannon_report_2.ogg`, `.m4a` | The cannon's report off the town | 2018: Lukas Tvrdon - Distant Blast | `Distant Blast 26.wav`, from 0 s for 3.6 s | yes |
| `public/audio/clack_1.ogg`, `.m4a` | The cannon's breech clack | 2019: 3maze - FINAL IMPACT | `metal_hit_004.wav`, from 0 s for 0.25 s | yes |
| `public/audio/clack_2.ogg`, `.m4a` | The cannon's breech clack | 2017: SoundBits - Just Impacts - Extension II | `Misc_Hits_118.wav`, from 0 s for 0.25 s | yes |
| `public/audio/boom_1.ogg`, `.m4a` | A charge going off | 2017: Gamemaster Audio - Explosion Sound Pack | `explosion_large_08.wav`, from 0 s for 3.2 s | no |
| `public/audio/boom_2.ogg`, `.m4a` | A charge going off | 2018: Gamemaster Audio - Guns, Bullets and Explosions | `explosion_large_07.wav`, from 0 s for 2.5 s | no |
| `public/audio/boom_3.ogg`, `.m4a` | A charge going off | 2020: Stefano Cremona - Explosions | `DeepExplosion02.wav`, from 0 s for 3.6 s | no |
| `public/audio/boom_4.ogg`, `.m4a` | A charge going off | 2020: Bluezone - Tank - Explosion Sound Effects | `Bluezone_BC0271_explosion_outdoors_large_005.wav`, from 0 s for 3.2 s | no |
| `public/audio/boom_tail_1.ogg`, `.m4a` | A blast's far tail | 2018: Lukas Tvrdon - Distant Blast | `Distant Blast 05.wav`, from 0.2 s for 6 s | no |
| `public/audio/boom_tail_2.ogg`, `.m4a` | A blast's far tail | 2018: Lukas Tvrdon - Distant Blast | `Distant Blast 38.wav`, from 0.2 s for 6.5 s | no |
| `public/audio/steel_burst_1.ogg`, `.m4a` | A propane tank bursting | 2019: BlueZone - Heavy Metal Impact Sound Effects | `Bluezone_BC0251_heavy_metal_impact_steel_barrel_01.wav`, from 0 s for 2.2 s | yes |
| `public/audio/steel_burst_2.ogg`, `.m4a` | A propane tank bursting | 2019: BlueZone - Heavy Metal Impact Sound Effects | `Bluezone_BC0251_heavy_metal_impact_large_tank_01_03.wav`, from 0 s for 2.6 s | yes |
| `public/audio/hit_brick_1.ogg`, `.m4a` | A hit on brick or concrete | 2020: PMSFX - Shattering Bricks | `PM_SB_SOURCE_16 Impact brick rock dirt gravel single hit.wav`, from 0 s for 1.2 s | yes |
| `public/audio/hit_brick_2.ogg`, `.m4a` | A hit on brick or concrete | 2020: PMSFX - Shattering Bricks | `PM_SB_SOURCE_61 Impact brick rock dirt gravel single hit.wav`, from 0 s for 1.4 s | yes |
| `public/audio/hit_brick_3.ogg`, `.m4a` | A hit on brick or concrete | 2018: Soundrangers - Foley Elements Rocks, Dirt And Stone | `boulder_impact_on_stones_14.wav`, from 0 s for 1 s | yes |
| `public/audio/hit_brick_big_1.ogg`, `.m4a` | A heavy hit on brick or stone | 2020: PMSFX - Shattering Bricks | `PM_SB_DESIGNED_IMPACT_48 Impact brick rock dirt gravel designed multi LFE.wav`, from 0 s for 2.2 s | yes |
| `public/audio/hit_brick_big_2.ogg`, `.m4a` | A heavy hit on brick or stone | 2020: PMSFX - Shattering Bricks | `PM_SB_DESIGNED_IMPACT_116 Impact brick rock dirt gravel designed multi LFE.wav`, from 0 s for 2.6 s | yes |
| `public/audio/hit_brick_big_3.ogg`, `.m4a` | A heavy hit on brick or stone | 2020: PMSFX - Rocky Impacts | `PM_RI_Designed_7 Rocks Impact Hit Big LFE Heavy Designed.wav`, from 0 s for 1.5 s | yes |
| `public/audio/hit_wood_1.ogg`, `.m4a` | A hit on wood | 2017: Double Trouble Audio - Tools and Wood | `Small Wood Pile, Smash.wav`, from 0 s for 1.2 s | yes |
| `public/audio/hit_wood_2.ogg`, `.m4a` | A hit on wood | 2019: BlueZone - Wood Sound Effects | `Bluezone_BC0254_wood_crushing_branches_001_001.wav`, from 0 s for 0.8 s | yes |
| `public/audio/hit_wood_3.ogg`, `.m4a` | A hit on wood | 2017: Double Trouble Audio - Tools and Wood | `Wooden Tearing 09.wav`, from 0 s for 0.6 s | yes |
| `public/audio/hit_metal_1.ogg`, `.m4a` | A hit on metal | 2019: BlueZone - Heavy Metal Impact Sound Effects | `Bluezone_BC0251_heavy_metal_impact_metal_plate_medium.wav`, from 0 s for 2 s | yes |
| `public/audio/hit_metal_2.ogg`, `.m4a` | A hit on metal | 2017: SoundBits - Just Impacts - Extension II | `Metal_Hit_Crash_199.wav`, from 0 s for 2.2 s | yes |
| `public/audio/hit_glass_1.ogg`, `.m4a` | A window breaking | 2017: Chris Skyes - Shards Broken Glass | `Window,Small,Break,Medium Impact,Large Amount of Clinking Pieces.wav`, from 0 s for 1.35 s | yes |
| `public/audio/hit_glass_2.ogg`, `.m4a` | A window breaking | 2017: Chris Skyes - Shards Broken Glass | `Glass,Shards,Smash,Medium Impact,Lots of Large Shards.wav`, from 0 s for 0.9 s | yes |
| `public/audio/hit_glass_3.ogg`, `.m4a` | A window breaking | 2019: Airborne Sound - Elements Glass | `Glass,Plate Glass,Thick,Break,Topple,Schoeps.wav`, from 0 s for 2.2 s | yes |
| `public/audio/thud_1.ogg`, `.m4a` | The sledge's thud | 2019: 3maze - FINAL IMPACT | `layered_material_hit_035.wav`, from 0 s for 0.9 s | no |
| `public/audio/thud_2.ogg`, `.m4a` | The sledge's thud | 2016: 3maze - High Impact | `med_dark_001.wav`, from 0 s for 1 s | no |
| `public/audio/debris_small_1.ogg`, `.m4a` | A handful of debris falling | 2018: Soundrangers - Foley Elements Rocks, Dirt And Stone | `brick_impact_debris_02.wav`, from 0 s for 0.84 s | yes |
| `public/audio/debris_small_2.ogg`, `.m4a` | A handful of debris falling | 2017: Mechanical Wave - Rock,Brick and Dirt - Part 02 | `Hit Rock into Gravel_RBDII 06.wav`, from 0 s for 0.99 s | yes |
| `public/audio/debris_small_3.ogg`, `.m4a` | A handful of debris falling | 2020: Bluezone - Tank - Explosion Sound Effects | `Bluezone_BC0271_debris_falling_rock_dust_002.wav`, from 0 s for 2.4 s | yes |
| `public/audio/debris_mid_1.ogg`, `.m4a` | A wall's worth of debris | 2016: Alexander Kopeikin - Rocks | `rock tumble down debris long 06.wav`, from 0 s for 5.2 s | yes |
| `public/audio/debris_mid_2.ogg`, `.m4a` | A wall's worth of debris | 2016: Alexander Kopeikin - Rocks | `soil and dirt debris heavy 13.wav`, from 0 s for 2.35 s | yes |
| `public/audio/debris_mid_3.ogg`, `.m4a` | A wall's worth of debris | 2017: Mechanical Wave - Rock,Brick and Dirt - Part 02 | `Crumbling Rock Slide_RBDII 07.wav`, from 0 s for 4.4 s | yes |
| `public/audio/debris_big_1.ogg`, `.m4a` | A storey's worth of debris | 2016: Mattia Cellotto - Rocks Momentum | `Collapsed Stone House - Rock Single Large Impacts - 1 Meter. Rock,Large,Impact,Single,Land,Various_04.wav`, from 0 s for 8 s | yes |
| `public/audio/debris_big_2.ogg`, `.m4a` | A storey's worth of debris | 2016: Alexander Kopeikin - Rocks | `rocks stream down heavy 02.wav`, from 0 s for 9.5 s | yes |
| `public/audio/debris_big_3.ogg`, `.m4a` | A storey's worth of debris | 2018: Soundrangers - Foley Elements Rocks, Dirt And Stone | `dirt_collapse_05.wav`, from 0 s for 3.9 s | yes |
| `public/audio/concrete_S_1.ogg`, `.m4a` | One concrete voxel landing | 2020: PMSFX - Rocky Impacts | `PM_RI_Source_53 Rocks Impact Hit Single Stone.wav`, from 0.19 s for 0.5 s | yes |
| `public/audio/concrete_S_2.ogg`, `.m4a` | One concrete voxel landing | 2020: PMSFX - Rocky Impacts | `PM_RI_Source_92 Rocks Impact Hit Single Stone.wav`, from 0.2 s for 0.5 s | yes |
| `public/audio/concrete_S_3.ogg`, `.m4a` | One concrete voxel landing | 2020: Tatak Audio - Rocks and Debris | `Tatak_ROCKS_Single Rock Impact on Stones.wav`, from 0.71 s for 0.45 s | yes |
| `public/audio/concrete_S_4.ogg`, `.m4a` | One concrete voxel landing | 2020: Tatak Audio - Rocks and Debris | `Tatak_ROCKS_Single Rock Impact on Stones.wav`, from 2.87 s for 0.45 s | yes |
| `public/audio/concrete_M_1.ogg`, `.m4a` | A clump of concrete landing | 2017: Mechanical Wave - Rock,Brick and Dirt - Part 02 | `Multiple Rock Hit Dirt_RBDII 07.wav`, from 0.61 s for 0.9 s | yes |
| `public/audio/concrete_M_2.ogg`, `.m4a` | A clump of concrete landing | 2017: Mechanical Wave - Rock,Brick and Dirt - Part 02 | `Multiple Rock Hit Dirt_RBDII 07.wav`, from 2.93 s for 1 s | yes |
| `public/audio/concrete_M_3.ogg`, `.m4a` | A clump of concrete landing | 2018: Soundrangers - Foley Elements Rocks, Dirt And Stone | `rockslide_02.wav`, from 1.08 s for 1 s | yes |
| `public/audio/concrete_L_1.ogg`, `.m4a` | A concrete section landing | 2020: PMSFX - Rocky Impacts | `PM_RI_Designed_19 Rocks Impact Hit Big LFE Heavy Designed.wav`, from 0.42 s for 1.6 s | yes |
| `public/audio/concrete_L_2.ogg`, `.m4a` | A concrete section landing | 2016: Mattia Cellotto - Rocks Momentum | `Collapsed Stone House - Rock Single Large Impacts - 1 Meter. Rock,Large,Impact,Single,Land,Various_04.wav`, from 8.58 s for 1.7 s | yes |
| `public/audio/plaster_S_1.ogg`, `.m4a` | One plaster voxel landing | 2020: Wav Junction Sound Effects - Rocks | `0228_Single_Small_Rocks_Tumble_Cliff_004.wav`, from 0.16 s for 0.5 s | no |
| `public/audio/plaster_S_2.ogg`, `.m4a` | One plaster voxel landing | 2020: Wav Junction Sound Effects - Rocks | `0228_Single_Small_Rocks_Tumble_Cliff_004.wav`, from 1.28 s for 0.45 s | no |
| `public/audio/plaster_S_3.ogg`, `.m4a` | One plaster voxel landing | 2020: Wav Junction Sound Effects - Rocks | `0242_Single_Small_Rocks_Tumble_Cliff_018.wav`, from 0.54 s for 0.4 s | no |
| `public/audio/plaster_S_4.ogg`, `.m4a` | One plaster voxel landing | 2020: Wav Junction Sound Effects - Rocks | `0242_Single_Small_Rocks_Tumble_Cliff_018.wav`, from 0.89 s for 0.35 s | no |
| `public/audio/plaster_M_1.ogg`, `.m4a` | A clump of plaster landing | 2020: Tatak Audio - Rocks and Debris | `Tatak_ROCKS_Falling Heavy Dusty Debris.wav`, from 2.3 s for 1.1 s | no |
| `public/audio/plaster_M_2.ogg`, `.m4a` | A clump of plaster landing | 2020: Tatak Audio - Rocks and Debris | `Tatak_ROCKS_Pebbles Dust Tumbling Rolling Debris.wav`, from 1.57 s for 1 s | no |
| `public/audio/plaster_M_3.ogg`, `.m4a` | A clump of plaster landing | 2018: Antisample - Rocks and Stones | `Rock_Impact_Slide_Various_Garbage_MONO_09.wav`, from 0.7 s for 0.8 s | no |
| `public/audio/plaster_L_1.ogg`, `.m4a` | A plaster section landing | 2020: Tatak Audio - Rocks and Debris | `Tatak_ROCKS_Falling Heavy Dusty Debris.wav`, from 12.23 s for 1.8 s | no |
| `public/audio/plaster_L_2.ogg`, `.m4a` | A plaster section landing | 2016: Mattia Cellotto - Rocks Momentum | `Eradicated Tree - Stones Large Impacts Debris - 1 Meter. Debris,Stones,Soil,Impact,Rock,Impact,Fall,Various_04.wav`, from 5.23 s for 2 s | no |
| `public/audio/wood_S_1.ogg`, `.m4a` | One wood voxel landing | 2017: Double Trouble Audio - Wood Impacts and Debris | `Drop Soft - Single Plank, Drop 02.wav`, from 0.3 s for 0.25 s | yes |
| `public/audio/wood_S_2.ogg`, `.m4a` | One wood voxel landing | 2017: Double Trouble Audio - Wood Impacts and Debris | `Impacts Soft - Short, Crack.wav`, from 0.29 s for 0.16 s | yes |
| `public/audio/wood_S_3.ogg`, `.m4a` | One wood voxel landing | 2018: Gibson and Ansell - Got Wood | `PineBlock_8x22x100cm_FaceDropped100cmOntoMDF_BeyerdynamicTG137c_Medium.wav`, from 1.34 s for 0.6 s | yes |
| `public/audio/wood_S_4.ogg`, `.m4a` | One wood voxel landing | 2018: Gibson and Ansell - Got Wood | `PlywoodOffcut_2x33x35cm_RandomlyDropped100cmOntoMDF_Se2200A_Medium.wav`, from 5.17 s for 0.6 s | yes |
| `public/audio/wood_M_1.ogg`, `.m4a` | A clump of wood landing | 2017: Double Trouble Audio - Wood Impacts and Debris | `Impacts Hard - Short Wobbly Tail 01.wav`, from 0.19 s for 0.44 s | yes |
| `public/audio/wood_M_2.ogg`, `.m4a` | A clump of wood landing | 2017: Double Trouble Audio - Wood Impacts and Debris | `Rustles - Pile, Debris 22.wav`, from 0.26 s for 0.4 s | yes |
| `public/audio/wood_M_3.ogg`, `.m4a` | A clump of wood landing | 2018: Antisample - Rocks and Stones | `Wood_Impact_Wood_Sawdust_5.wav`, from 0.31 s for 1.2 s | yes |
| `public/audio/wood_L_1.ogg`, `.m4a` | A timber section landing | 2016: Mattia Cellotto - Rocks Momentum | `Woodshed - Rock and Wood Large Impacts - 1 Meter. Rock,Wood,Large,Impact,Roll,Various_02.wav`, from 6.15 s for 1.6 s | yes |
| `public/audio/wood_L_2.ogg`, `.m4a` | A timber section landing | 2016: Mattia Cellotto - Rocks Momentum | `Woodshed - Rock and Wood Large Impacts - 1 Meter. Rock,Wood,Large,Impact,Roll,Various_02.wav`, from 3.17 s for 1.3 s | yes |
| `public/audio/metal_S_1.ogg`, `.m4a` | One steel voxel landing | 2019: Airborne Sound - Elements Metal | `Metal,Hits,Pipe,Mixed,Fast,Irregular.wav`, from 0.1 s for 0.2 s | yes |
| `public/audio/metal_S_2.ogg`, `.m4a` | One steel voxel landing | 2019: Airborne Sound - Elements Metal | `Metal,Hits,Pipe,Mixed,Fast,Irregular.wav`, from 0.41 s for 0.7 s | yes |
| `public/audio/metal_S_3.ogg`, `.m4a` | One steel voxel landing | 2017: SoundBits - Just Impacts - Extension II | `Metal_Hit_Crash_090.wav`, from 2.28 s for 0.6 s | yes |
| `public/audio/metal_S_4.ogg`, `.m4a` | One steel voxel landing | 2020: Pole Position - Car Destruction | `Car_Destruction_Chassis_Impact_t36_Ext_Drop_on_Ground_Metal_Crash_Bounce_Various_MKH8060.wav`, from 12.03 s for 0.3 s | yes |
| `public/audio/metal_M_1.ogg`, `.m4a` | A clump of steel landing | 2018: Bluezone Corporation - Metal Debris | `Bluezone_BC0236_metal_debris_097.wav`, from 1.38 s for 1.6 s | yes |
| `public/audio/metal_M_2.ogg`, `.m4a` | A clump of steel landing | 2017: SoundBits - Just Impacts - Extension II | `Metal_Jolt_Rattle_Scrape_52.wav`, from 0.12 s for 0.85 s | yes |
| `public/audio/metal_M_3.ogg`, `.m4a` | A clump of steel landing | 2017: Double Trouble Audio - Junk and Debris | `Pile of Scrap Metal - Metal Scrap Pile, Rustle, Drop, Long Tail 03.wav`, from 0.74 s for 1.6 s | yes |
| `public/audio/metal_L_1.ogg`, `.m4a` | A steel section landing | 2020: Pole Position - Car Destruction | `Car_Destruction_Chassis_Impact_t36_Ext_Drop_on_Ground_Metal_Crash_Bounce_Various_MKH8060.wav`, from 2.96 s for 2.2 s | yes |
| `public/audio/metal_L_2.ogg`, `.m4a` | A steel section landing | 2017: Pole Position - Car Debris, Impacts & Crashes | `peugeot_106_dropped_5m_on_metal_plates_zaxcom_holophone_1.wav`, from 1.12 s for 2.4 s | yes |
| `public/audio/brick_S_1.ogg`, `.m4a` | One brick voxel landing | 2020: PMSFX - Shattering Bricks | `PM_SB_SOURCE_16 Impact brick rock dirt gravel single hit.wav`, from 0.62 s for 0.45 s | yes |
| `public/audio/brick_S_2.ogg`, `.m4a` | One brick voxel landing | 2020: PMSFX - Shattering Bricks | `PM_SB_SOURCE_61 Impact brick rock dirt gravel single hit.wav`, from 0.68 s for 0.35 s | yes |
| `public/audio/brick_S_3.ogg`, `.m4a` | One brick voxel landing | 2020: PMSFX - Shattering Bricks | `PM_SB_SOURCE_61 Impact brick rock dirt gravel single hit.wav`, from 1.05 s for 0.4 s | yes |
| `public/audio/brick_S_4.ogg`, `.m4a` | One brick voxel landing | 2017: Mechanical Wave - Rock,Brick and Dirt - Part 02 | `Rock Hit and Bounce Dirt_RBDII 06.wav`, from 0.11 s for 0.6 s | yes |
| `public/audio/slide_rubble_1.ogg`, `.m4a` | Rubble sliding (a seamless loop) | 2018: Soundrangers - Foley Elements Rocks, Dirt And Stone | `rockslide_02.wav`, from 0.4 s for 4.6 s | yes |
| `public/audio/slide_rubble_2.ogg`, `.m4a` | Rubble sliding (a seamless loop) | 2020: Tatak Audio - Rocks and Debris | `Tatak_ROCKS_Pebbles Dust Tumbling Rolling Debris.wav`, from 1.3 s for 6 s | yes |
| `public/audio/creak_wood_1.ogg`, `.m4a` | Loaded timber creaking | 2019: BlueZone - Wood Sound Effects | `Bluezone_BC0254_wood_creaking_tree_005.wav`, from 0.6 s for 1.4 s | yes |
| `public/audio/creak_wood_2.ogg`, `.m4a` | Loaded timber creaking | 2019: BlueZone - Wood Sound Effects | `Bluezone_BC0254_wood_creaking_tree_005.wav`, from 1.9 s for 1.3 s | yes |
| `public/audio/creak_steel_1.ogg`, `.m4a` | Loaded steel creaking | 2020: Pole Position - The Junkyard Metal Library | `Metal_Creak_Van_Door_Back_and_Forth_Various_CO100k.wav`, from 49.3 s for 1.4 s | yes |
| `public/audio/creak_steel_2.ogg`, `.m4a` | Loaded steel creaking | 2020: Pole Position - The Junkyard Metal Library | `Metal_Rocking_Diesel_Tank_Pulses_A_DPA4061.wav`, from 14.77 s for 1.8 s | yes |
| `public/audio/groan_masonry_1.ogg`, `.m4a` | Loaded masonry groaning | 2018: Gregor Quendel - Designed Rocks | `Designed Rocks - EVO19 - Texture - Filtered 4.wav`, from 13.7 s for 2 s | no |
| `public/audio/groan_masonry_2.ogg`, `.m4a` | Loaded masonry groaning | 2020: Wav Junction Sound Effects - Rocks | `0119_Rock_Quick_Drag_On_Rock_029.wav`, from 0.73 s for 0.7 s | no |

## Generated sounds

| Path | What it is | Where to get it | Licence |
|---|---|---|---|
| `public/audio/horn_1.ogg`, `.m4a`, `public/audio/horn_2.ogg`, `.m4a` | The air horn that starts a round, two takes | Generated with ElevenLabs Sound Effects v2 (https://elevenlabs.io/sound-effects): "construction site air horn, one long loud blast, no music", 1.5 s, prompt influence 0.6 (add "variation" for the second take). Or any CC0 air horn. | ElevenLabs' terms (https://elevenlabs.io/sound-effects-terms) let output go into a game but not be made available as isolated audio files, so it's left out. Generate your own under your own account, and keep it out of git. |
| `public/audio/whistle_1.ogg`, `.m4a`, `public/audio/whistle_2.ogg`, `.m4a` | The whistle at the end of a round, two takes | The same, with "referee style long whistle blow signalling the end, outdoors, no music", 1.2 s. Or any CC0 whistle. | As above |

The music bed (`public/audio/music_1.*`) is in the repo: it was generated for Brickfall with Sonilo v1.1, whose terms assign its rights in the output to whoever made it.
