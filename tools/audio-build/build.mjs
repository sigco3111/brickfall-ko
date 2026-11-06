// Build Brickfall's recorded sound layers from the Sonniss GDC Game Audio Bundle recordings they were cut from
// (in-game use only, so they aren't in this repo: see MISSING_ASSETS.md). Each layer is cut, onset-trimmed, mono-ed (tails keep stereo), filtered, faded,
// set to a loudness target (max momentary LUFS for one-shots, integrated for tails), peak-limited to -2 dBTP (headroom for the codecs),
// and encoded as .ogg (Vorbis) and .m4a (AAC). Nothing raw is shipped; nothing goes to any AI service.
// Writes ../../public/audio/<name>_<k>.{ogg,m4a} and layers.json (sources, cuts and measured loudness).
// SONNISS_DIR=<folder holding the bundles' year folders, e.g. 2016/, 2017/> node build.mjs [names...]
// Needs ffmpeg and ffprobe on the PATH. Encoder versions differ, so the files sound the same but aren't byte-identical.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from './analyze.mjs';

const S = process.env.SONNISS_DIR;
if (!S) throw new Error('Set SONNISS_DIR to the folder holding the Sonniss bundles (2016/ ... 2020/)');
const OUT = path.resolve('../../public/audio');
const TMP = path.resolve('tmp');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const lib = {
  bzTank: `${S}/2020/Bluezone - Tank - Explosion Sound Effects`,
  distant: `${S}/2018/Lukas Tvrdon - Distant Blast`,
  gm17: `${S}/2017/Gamemaster Audio -  Explosion Sound Pack`,
  gm18: `${S}/2018/Gamemaster Audio - Guns, Bullets and Explosions`,
  cremona: `${S}/2020/Stefano Cremona - Explosions`,
  bricks: `${S}/2020/PMSFX - Shattering Bricks`,
  rocky: `${S}/2020/PMSFX - Rocky Impacts`,
  maze16: `${S}/2016/3maze - High Impact`,
  maze19: `${S}/2019/3maze - FINAL IMPACT`,
  shards: `${S}/2017/Chris Skyes - Shards Broken Glass`,
  airGlass: `${S}/2019/Airborne Sound - Elements Glass`,
  dtWood: `${S}/2017/Double Trouble Audio - Wood Impacts and Debris`,
  dtTools: `${S}/2017/Double Trouble Audio - Tools and Wood`,
  bzWood: `${S}/2019/BlueZone - Wood Sound Effects`,
  bzMetal: `${S}/2019/BlueZone - Heavy Metal Impact Sound Effects`,
  justImpacts: `${S}/2017/SoundBits - Just Impacts - Extension II`,
  rangers: `${S}/2018/Soundrangers - Foley Elements Rocks, Dirt And Stone`,
  mwave: `${S}/2017/Mechanical Wave - Rock,Brick and Dirt - Part 02`,
  kopeikin: `${S}/2016/Alexander Kopeikin - Rocks`,
  cellotto: `${S}/2016/Mattia Cellotto - Rocks Momentum`,
  tatak: `${S}/2020/Tatak Audio - Rocks and Debris`,
  wavj: `${S}/2020/Wav Junction Sound Effects - Rocks`,
  gotWood: `${S}/2018/Gibson and Ansell - Got Wood`,
  antisample: `${S}/2018/Antisample - Rocks and Stones`,
  airMetal: `${S}/2019/Airborne Sound - Elements Metal`,
  bzDebris: `${S}/2018/Bluezone Corporation - Metal Debris`,
  dtJunk: `${S}/2017/Double Trouble Audio - Junk and Debris`,
  ppCar: `${S}/2017/Pole Position - Car Debris, Impacts & Crashes`,
  ppCarD: `${S}/2020/Pole Position - Car Destruction`,
  ppJunk: `${S}/2020/Pole Position - The Junkyard Metal Library`,
  quendel: `${S}/2018/Gregor Quendel - Designed Rocks`,
};

// name: takes [{src, ss (s), t (s), ...}], target, opts. kind: 'oneshot' (LUFS-M max) or 'tail' (integrated).
const A = (dir, file, ss = 0, t = 0, extra = {}) => ({ src: `${dir}/${file}`, ss, t, ...extra });
const SPEC = [
  // Cannon: the shot's body (artillery), its echo off the town, a breech clack
  { name: 'cannon_body', kind: 'oneshot', target: -9, fade: 0.25, takes: [A(lib.bzTank, 'Bluezone_BC0271_tank_artillery_cannon_shot_012.wav', 0, 2.4)] },
  { name: 'cannon_report', kind: 'tail', target: -20, fade: 0.8, stereo: true, takes: [A(lib.distant, 'Distant Blast 17.wav', 0, 3), A(lib.distant, 'Distant Blast 26.wav', 0, 3.6)] },
  { name: 'clack', kind: 'oneshot', target: -15, fade: 0.06, hp: 400, takes: [A(lib.maze19, 'metal_hit_004.wav', 0, 0.25), A(lib.justImpacts, 'Misc_Hits_118.wav', 0, 0.25)] },
  // Explosions: charges (crack-boom with low end), a propane tank (boom plus a burst of steel), far tails
  { name: 'boom', kind: 'oneshot', target: -8, fade: 0.6, takes: [A(lib.gm17, 'explosion_large_08.wav', 0, 3.2), A(lib.gm18, 'explosion_large_07.wav', 0, 2.5), A(lib.cremona, 'DeepExplosion02.wav', 0, 3.6), A(lib.bzTank, 'Bluezone_BC0271_explosion_outdoors_large_005.wav', 0, 3.2)] },
  { name: 'boom_tail', kind: 'tail', target: -21, fade: 1.5, stereo: true, takes: [A(lib.distant, 'Distant Blast 05.wav', 0.2, 6), A(lib.distant, 'Distant Blast 38.wav', 0.2, 6.5)] },
  { name: 'steel_burst', kind: 'oneshot', target: -12, fade: 0.5, takes: [A(lib.bzMetal, 'Bluezone_BC0251_heavy_metal_impact_steel_barrel_01.wav', 0, 2.2), A(lib.bzMetal, 'Bluezone_BC0251_heavy_metal_impact_large_tank_01_03.wav', 0, 2.6)] },
  // Impacts by material: brick and concrete, stone (heavy designed), wood, metal, glass
  { name: 'hit_brick', kind: 'oneshot', target: -11, fade: 0.25, takes: [A(lib.bricks, 'PM_SB_SOURCE_16 Impact brick rock dirt gravel single hit.wav', 0, 1.2), A(lib.bricks, 'PM_SB_SOURCE_61 Impact brick rock dirt gravel single hit.wav', 0, 1.4), A(lib.rangers, 'boulder_impact_on_stones_14.wav', 0, 1.0)] },
  { name: 'hit_brick_big', kind: 'oneshot', target: -9, fade: 0.5, takes: [A(lib.bricks, 'PM_SB_DESIGNED_IMPACT_48 Impact brick rock dirt gravel designed multi LFE.wav', 0, 2.2), A(lib.bricks, 'PM_SB_DESIGNED_IMPACT_116 Impact brick rock dirt gravel designed multi LFE.wav', 0, 2.6), A(lib.rocky, 'PM_RI_Designed_7 Rocks Impact Hit Big LFE Heavy Designed.wav', 0, 1.5)] },
  { name: 'hit_wood', kind: 'oneshot', target: -12, fade: 0.2, takes: [A(lib.dtTools, 'Small Wood Pile, Smash.wav', 0, 1.2), A(lib.bzWood, 'Bluezone_BC0254_wood_crushing_branches_001_001.wav', 0, 0.8), A(lib.dtTools, 'Wooden Tearing 09.wav', 0, 0.6)] },
  { name: 'hit_metal', kind: 'oneshot', target: -12, fade: 0.5, takes: [A(lib.bzMetal, 'Bluezone_BC0251_heavy_metal_impact_metal_plate_medium.wav', 0, 2.0), A(lib.justImpacts, 'Metal_Hit_Crash_199.wav', 0, 2.2)] },
  { name: 'hit_glass', kind: 'oneshot', target: -14, fade: 0.25, takes: [A(lib.shards, 'Window,Small,Break,Medium Impact,Large Amount of Clinking Pieces.wav', 0, 1.35), A(lib.shards, 'Glass,Shards,Smash,Medium Impact,Lots of Large Shards.wav', 0, 0.9), A(lib.airGlass, 'Glass,Plate Glass,Thick,Break,Topple,Schoeps.wav', 0, 2.2)] },
  // The sledge's own transient (a heavy designed hit), tight
  { name: 'thud', kind: 'oneshot', target: -11, fade: 0.2, takes: [A(lib.maze19, 'layered_material_hit_035.wav', 0, 0.9), A(lib.maze16, 'med_dark_001.wav', 0, 1.0)] },
  // Debris tails: small (a handful of bricks), medium (a wall's worth), large (a storey's), the long rumble
  { name: 'debris_small', kind: 'tail', target: -20, fade: 0.3, takes: [A(lib.rangers, 'brick_impact_debris_02.wav', 0, 0.84), A(lib.mwave, 'Hit Rock into Gravel_RBDII 06.wav', 0, 0.99), A(lib.bzTank, 'Bluezone_BC0271_debris_falling_rock_dust_002.wav', 0, 2.4)] },
  { name: 'debris_mid', kind: 'tail', target: -19, fade: 0.8, stereo: true, takes: [A(lib.kopeikin, 'rock tumble down debris long 06.wav', 0, 5.2), A(lib.kopeikin, 'soil and dirt debris heavy 13.wav', 0, 2.35), A(lib.mwave, 'Crumbling Rock Slide_RBDII 07.wav', 0, 4.4)] },
  { name: 'debris_big', kind: 'tail', target: -17, fade: 1.5, stereo: true, takes: [A(lib.cellotto, 'Collapsed Stone House - Rock Single Large Impacts - 1 Meter. Rock,Large,Impact,Single,Land,Various_04.wav', 0, 8), A(lib.kopeikin, 'rocks stream down heavy 02.wav', 0, 9.5), A(lib.rangers, 'dirt_collapse_05.wav', 0, 3.9)] },
  // Debris impacts by material and size (S: one voxel, M: a clump, L: a section landing). Mono: the game pans them.
  { name: 'concrete_S', kind: 'oneshot', target: -12, fade: 0.15, takes: [A(lib.rocky, 'PM_RI_Source_53 Rocks Impact Hit Single Stone.wav', 0.19, 0.5), A(lib.rocky, 'PM_RI_Source_92 Rocks Impact Hit Single Stone.wav', 0.2, 0.5), A(lib.tatak, 'Tatak_ROCKS_Single Rock Impact on Stones.wav', 0.71, 0.45), A(lib.tatak, 'Tatak_ROCKS_Single Rock Impact on Stones.wav', 2.87, 0.45)] },
  { name: 'concrete_M', kind: 'oneshot', target: -12, fade: 0.3, takes: [A(lib.mwave, 'Multiple Rock Hit Dirt_RBDII 07.wav', 0.61, 0.9), A(lib.mwave, 'Multiple Rock Hit Dirt_RBDII 07.wav', 2.93, 1.0), A(lib.rangers, 'rockslide_02.wav', 1.08, 1.0)] },
  { name: 'concrete_L', kind: 'oneshot', target: -10, fade: 0.5, takes: [A(lib.rocky, 'PM_RI_Designed_19 Rocks Impact Hit Big LFE Heavy Designed.wav', 0.42, 1.6), A(lib.cellotto, 'Collapsed Stone House - Rock Single Large Impacts - 1 Meter. Rock,Large,Impact,Single,Land,Various_04.wav', 8.58, 1.7)] },
  { name: 'plaster_S', kind: 'oneshot', target: -13, fade: 0.15, hp: 300, takes: [A(lib.wavj, '0228_Single_Small_Rocks_Tumble_Cliff_004.wav', 0.16, 0.5), A(lib.wavj, '0228_Single_Small_Rocks_Tumble_Cliff_004.wav', 1.28, 0.45), A(lib.wavj, '0242_Single_Small_Rocks_Tumble_Cliff_018.wav', 0.54, 0.4), A(lib.wavj, '0242_Single_Small_Rocks_Tumble_Cliff_018.wav', 0.89, 0.35)] },
  { name: 'plaster_M', kind: 'oneshot', target: -13, fade: 0.35, hp: 200, takes: [A(lib.tatak, 'Tatak_ROCKS_Falling Heavy Dusty Debris.wav', 2.3, 1.1), A(lib.tatak, 'Tatak_ROCKS_Pebbles Dust Tumbling Rolling Debris.wav', 1.57, 1.0), A(lib.antisample, 'Rock_Impact_Slide_Various_Garbage_MONO_09.wav', 0.7, 0.8)] },
  { name: 'plaster_L', kind: 'oneshot', target: -11, fade: 0.6, hp: 120, takes: [A(lib.tatak, 'Tatak_ROCKS_Falling Heavy Dusty Debris.wav', 12.23, 1.8), A(lib.cellotto, 'Eradicated Tree - Stones Large Impacts Debris - 1 Meter. Debris,Stones,Soil,Impact,Rock,Impact,Fall,Various_04.wav', 5.23, 2.0)] },
  { name: 'wood_S', kind: 'oneshot', target: -13, fade: 0.1, takes: [A(lib.dtWood, 'Drop Soft - Single Plank, Drop 02.wav', 0.3, 0.25), A(lib.dtWood, 'Impacts Soft - Short, Crack.wav', 0.29, 0.16), A(lib.gotWood, 'PineBlock_8x22x100cm_FaceDropped100cmOntoMDF_BeyerdynamicTG137c_Medium.wav', 1.34, 0.6), A(lib.gotWood, 'PlywoodOffcut_2x33x35cm_RandomlyDropped100cmOntoMDF_Se2200A_Medium.wav', 5.17, 0.6)] },
  { name: 'wood_M', kind: 'oneshot', target: -12, fade: 0.2, takes: [A(lib.dtWood, 'Impacts Hard - Short Wobbly Tail 01.wav', 0.19, 0.44), A(lib.dtWood, 'Rustles - Pile, Debris 22.wav', 0.26, 0.4), A(lib.antisample, 'Wood_Impact_Wood_Sawdust_5.wav', 0.31, 1.2)] },
  { name: 'wood_L', kind: 'oneshot', target: -10, fade: 0.5, takes: [A(lib.cellotto, 'Woodshed - Rock and Wood Large Impacts - 1 Meter. Rock,Wood,Large,Impact,Roll,Various_02.wav', 6.15, 1.6), A(lib.cellotto, 'Woodshed - Rock and Wood Large Impacts - 1 Meter. Rock,Wood,Large,Impact,Roll,Various_02.wav', 3.17, 1.3)] },
  { name: 'metal_S', kind: 'oneshot', target: -14, fade: 0.12, takes: [A(lib.airMetal, 'Metal,Hits,Pipe,Mixed,Fast,Irregular.wav', 0.1, 0.2), A(lib.airMetal, 'Metal,Hits,Pipe,Mixed,Fast,Irregular.wav', 0.41, 0.7), A(lib.justImpacts, 'Metal_Hit_Crash_090.wav', 2.28, 0.6), A(lib.ppCarD, 'Car_Destruction_Chassis_Impact_t36_Ext_Drop_on_Ground_Metal_Crash_Bounce_Various_MKH8060.wav', 12.03, 0.3)] },
  { name: 'metal_M', kind: 'oneshot', target: -12, fade: 0.4, takes: [A(lib.bzDebris, 'Bluezone_BC0236_metal_debris_097.wav', 1.38, 1.6), A(lib.justImpacts, 'Metal_Jolt_Rattle_Scrape_52.wav', 0.12, 0.85), A(lib.dtJunk, 'Pile of Scrap Metal - Metal Scrap Pile, Rustle, Drop, Long Tail 03.wav', 0.74, 1.6)] },
  { name: 'metal_L', kind: 'oneshot', target: -10, fade: 0.7, takes: [A(lib.ppCarD, 'Car_Destruction_Chassis_Impact_t36_Ext_Drop_on_Ground_Metal_Crash_Bounce_Various_MKH8060.wav', 2.96, 2.2), A(lib.ppCar, 'peugeot_106_dropped_5m_on_metal_plates_zaxcom_holophone_1.wav', 1.12, 2.4)] },
  { name: 'brick_S', kind: 'oneshot', target: -12, fade: 0.12, takes: [A(lib.bricks, 'PM_SB_SOURCE_16 Impact brick rock dirt gravel single hit.wav', 0.62, 0.45), A(lib.bricks, 'PM_SB_SOURCE_61 Impact brick rock dirt gravel single hit.wav', 0.68, 0.35), A(lib.bricks, 'PM_SB_SOURCE_61 Impact brick rock dirt gravel single hit.wav', 1.05, 0.4), A(lib.mwave, 'Rock Hit and Bounce Dirt_RBDII 06.wav', 0.11, 0.6)] },
  // Rubble sliding (seamless loops), and what a loaded structure says before it goes
  { name: 'slide_rubble', kind: 'loop', target: -18, xfade: 0.6, takes: [A(lib.rangers, 'rockslide_02.wav', 0.4, 4.6), A(lib.tatak, 'Tatak_ROCKS_Pebbles Dust Tumbling Rolling Debris.wav', 1.3, 6.0)] },
  { name: 'creak_wood', kind: 'oneshot', target: -14, fade: 0.4, takes: [A(lib.bzWood, 'Bluezone_BC0254_wood_creaking_tree_005.wav', 0.6, 1.4), A(lib.bzWood, 'Bluezone_BC0254_wood_creaking_tree_005.wav', 1.9, 1.3)] },
  { name: 'creak_steel', kind: 'oneshot', target: -15, fade: 0.5, takes: [A(lib.ppJunk, 'Metal_Creak_Van_Door_Back_and_Forth_Various_CO100k.wav', 49.3, 1.4, { rate: 0.8 }), A(lib.ppJunk, 'Metal_Rocking_Diesel_Tank_Pulses_A_DPA4061.wav', 14.77, 1.8)] },
  { name: 'groan_masonry', kind: 'oneshot', target: -14, fade: 0.6, takes: [A(lib.quendel, 'Designed Rocks - EVO19 - Texture - Filtered 4.wav', 13.7, 2.0), A(lib.wavj, '0119_Rock_Quick_Drag_On_Rock_029.wav', 0.73, 0.7, { rate: 0.6 })] },
];

/** Make a cut loop without a click: its last `xf` seconds crossfade (equal power) into its first, and are dropped. */
function seamless(file, xf) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const d = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength));
  const n = Math.round(xf * 44100);
  const len = d.length - n;
  const o = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    if (i < n) {
      const a = i / n;
      o[i] = d[i] * Math.sin((a * Math.PI) / 2) + d[len + i] * Math.cos((a * Math.PI) / 2);
    } else o[i] = d[i];
  }
  const raw = path.join(TMP, 'loop.f32');
  fs.writeFileSync(raw, Buffer.from(o.buffer));
  run(['-y', '-f', 'f32le', '-ar', '44100', '-ac', '1', '-i', raw, '-c:a', 'pcm_f32le', `${file}.l.wav`]);
  fs.renameSync(`${file}.l.wav`, file);
  fs.rmSync(raw);
}

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};
function loudness(file, kind) {
  const a = analyze(file);
  if (kind !== 'oneshot') {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
    const j = JSON.parse(r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
    return { ...a, integrated: Number(j.input_i) };
  }
  return a;
}

const channels = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim());

// node build.mjs [names...]: only those layers (their rows replaced in layers.json)
const only = process.argv.slice(2);
const out = only.length && fs.existsSync('layers.json') ? JSON.parse(fs.readFileSync('layers.json', 'utf8')).filter((r) => !only.includes(r.name)) : [];
for (const spec of SPEC.filter((x) => !only.length || only.includes(x.name))) {
  spec.takes.forEach((take, k) => {
    const n = k + 1;
    const cut = path.join(TMP, `${spec.name}_${n}_cut.wav`);
    const loop = spec.kind === 'loop';
    const filters = [];
    if (!spec.stereo && channels(take.src) > 1) filters.push('pan=mono|c0=0.5*c0+0.5*c1');
    if (!loop) filters.push('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.004');
    if (take.rate) filters.push('aresample=44100', `asetrate=44100*${take.rate}`, 'aresample=44100');
    if (spec.hp) filters.push(`highpass=f=${spec.hp}`);
    const len = take.t / (take.rate ?? 1);
    if (!loop) {
      filters.push('afade=t=in:d=0.002');
      filters.push(`afade=t=out:st=${Math.max(0.05, len - spec.fade)}:d=${spec.fade}:curve=qsin`);
    }
    const span = loop ? take.t + spec.xfade : len;
    run(['-y', '-ss', String(take.ss), '-t', String((loop ? span : take.t) + 0.2), '-i', take.src, '-af', filters.join(',') || 'anull', '-t', String(span), '-ar', '44100', '-c:a', 'pcm_f32le', cut]);
    if (loop) seamless(cut, spec.xfade);
    // Gain to the target, then a true-peak limiter at -1 dBTP
    const m = loudness(cut, spec.kind);
    const level = spec.kind !== 'oneshot' ? m.integrated : m.lufsMmax;
    // To the target, but never more than 6 dB into the limiter (a sharp crack flattened is worse than a quieter one)
    const gain = Math.min(spec.target - level, -2 - m.peakDb + 6);
    const done = path.join(TMP, `${spec.name}_${n}.wav`);
    run(['-y', '-i', cut, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.79:attack=1:release=60:level=disabled,aresample=44100`, '-c:a', 'pcm_f32le', done]);
    const final = loudness(done, spec.kind);
    const base = path.join(OUT, `${spec.name}_${n}`);
    run(['-y', '-i', done, '-c:a', 'libvorbis', '-q:a', spec.stereo ? '5' : '4', `${base}.ogg`]);
    run(['-y', '-i', done, '-c:a', 'aac', '-b:a', spec.stereo ? '160k' : '96k', '-movflags', '+faststart', `${base}.m4a`]);
    const enc = analyze(`${base}.ogg`);
    const row = {
      name: spec.name,
      take: n,
      kind: spec.kind,
      source: path.relative(S, take.src).replace(/\\/g, '/'),
      cut: [take.ss, take.t],
      gainDb: +gain.toFixed(1),
      before: { peakDb: m.peakDb, lufsMmax: m.lufsMmax, integrated: m.integrated ?? null, clipped: m.clipped, floorDb: m.floorDb, crestDb: m.crestDb },
      after: { peakDb: enc.peakDb, truePeakDb: enc.truePeakDb, rmsDb: enc.rmsDb, lufsMmax: enc.lufsMmax, integrated: final.integrated ?? null, clipped: enc.clipped, duration: enc.duration },
      bytes: fs.statSync(`${base}.ogg`).size,
    };
    out.push(row);
    console.log(`${spec.name}_${n}`.padEnd(18), 'gain', row.gainDb.toString().padStart(6), '| peak', String(enc.peakDb).padStart(5), 'TP', String(enc.truePeakDb).padStart(5), 'rms', String(enc.rmsDb).padStart(6), 'LUFS-M', String(enc.lufsMmax).padStart(6), spec.kind !== 'oneshot' ? `I ${final.integrated}` : '', 'clip', enc.clipped, '|', path.basename(take.src).slice(0, 50));
  });
}
fs.writeFileSync('layers.json', JSON.stringify(out, null, 1));
