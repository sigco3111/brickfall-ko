// Measure audio files with ffmpeg: duration, channels, sample peak, true peak, RMS, clipped samples, onset (first
// moment above -40 dBFS), max momentary loudness (LUFS-M), integrated loudness, noise floor (quietest 100 ms RMS,
// dBFS) and crest (peak over RMS in the first 300 ms after the onset: how sharp the transient is).
// node analyze.mjs <file or dir> [...]   (prints a table; --json writes analysis.json)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function analyze(file) {
  const run = (args) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'verbose', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    return (r.stdout || '') + (r.stderr || '');
  };
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=channels,sample_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
  const duration = Number(probe.format.duration);
  const channels = probe.streams[0].channels;
  // Raw samples (mono mix, 22.05 kHz is enough for envelopes) for onset, floor and crest
  // Peaks and clipping on the channels as they are (a mono sum overstates them), at the file's own rate
  const full = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-t', '60', '-f', 'f32le', '-'], { maxBuffer: 1 << 29 });
  const all = new Float32Array(full.buffer, full.byteOffset, full.byteLength / 4);
  let peak = 0;
  let clipped = 0;
  for (const v of all) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
  }
  // Envelopes from a mono average (pan=mono|c0=0.5*c0+0.5*c1 for stereo)
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-t', '60', '-af', channels > 1 ? 'pan=mono|c0=0.5*c0+0.5*c1' : 'anull', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const sr = 22050;
  let onset = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.01) {
    onset = i;
    break;
  }
  const win = Math.round(sr * 0.1);
  let floor = Infinity;
  for (let i = 0; i + win < x.length; i += win) {
    let s = 0;
    for (let k = i; k < i + win; k++) s += x[k] * x[k];
    const r = Math.sqrt(s / win);
    if (r > 1e-6) floor = Math.min(floor, r);
  }
  let s = 0;
  let p = 0;
  const end = Math.min(x.length, onset + Math.round(sr * 0.3));
  for (let i = onset; i < end; i++) {
    s += x[i] * x[i];
    p = Math.max(p, Math.abs(x[i]));
  }
  const rms300 = Math.sqrt(s / Math.max(1, end - onset));
  let total = 0;
  for (const v of x) total += v * v;
  const ebu = run(['-i', file, '-t', '60', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const num = (re) => {
    const m = ebu.match(re);
    return m ? Number(m[1]) : null;
  };
  // Max momentary: scan the per-frame log lines
  let mmax = -Infinity;
  for (const m of ebu.matchAll(/M:\s*(-?[\d.]+)/g)) mmax = Math.max(mmax, Number(m[1]));
  const db = (v) => +(20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
  return {
    file,
    duration: +duration.toFixed(2),
    channels,
    peakDb: db(peak),
    truePeakDb: num(/True peak:\s*\n\s*Peak:\s*(-?[\d.]+)/),
    rmsDb: db(Math.sqrt(total / x.length)),
    clipped,
    onsetMs: Math.round((onset / sr) * 1000),
    lufsMmax: Number.isFinite(mmax) ? mmax : null,
    lufsI: num(/I:\s*(-?[\d.]+) LUFS/),
    floorDb: db(floor),
    crestDb: +(db(p) - db(rms300)).toFixed(1),
  };
}

if (process.argv[1] && process.argv[1].endsWith('analyze.mjs')) {
  const files = [];
  for (const a of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
    if (fs.statSync(a).isDirectory()) for (const f of fs.readdirSync(a)) if (/\.(wav|ogg|mp3|m4a|flac)$/i.test(f)) files.push(path.join(a, f));
    else files.push(a);
  }
  const out = files.map(analyze);
  for (const r of out) console.log([r.duration, r.channels, r.peakDb, r.truePeakDb, r.rmsDb, r.clipped, r.onsetMs, r.lufsMmax, r.lufsI, r.floorDb, r.crestDb].map((v) => String(v).padStart(7)).join(' '), ' ', path.basename(r.file).slice(0, 70));
  if (process.argv.includes('--json')) fs.writeFileSync('analysis.json', JSON.stringify(out, null, 1));
}
