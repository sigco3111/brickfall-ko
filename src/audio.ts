// Brickfall's sound. Recorded layers (Sonniss GDC bundle picks, licensed for this game only, cut and mastered
// in audio-build/build.mjs) stacked with synthesised ones, through a mix built like a game's:
//
//   layers ──► voice caps per category ──► distance (delay, low-pass, level) ──► sfx bus ─┐
//   reverb send ──► convolver (an impulse of slaps off the houses and a short tail) ───────┼► bus compressor ─► limiter ─► out
//   music ──► duck (under blasts and collapses) ──────────────────────────────────────────┘
//
// The four big events are designed in layers, scaled by energy and material:
//   cannon:  transient crack · chesty low body · sub thump · breech clack · recorded shot · slap and report off the town
//   impact:  material hit (brick, wood, metal, glass) · heavy designed hit when it's big · sub boom · debris tail by what broke
//   sledge:  designed thud · material hit · sub · steel ring · debris tail by what broke
//   charge:  crack · recorded boom (rotating takes) · sub · far tail; a ripple of charges stacks at 1/√n, never clips
// Collapses get a debris tail sized by how many voxels actually fell (seconds of rubble for a storey) and a rumble.
// The fork's synthesised sounds (three-voxel-destruction, MIT) remain for the small things: steps, glass tinkle,
// alarms, swings.

/** Which recorded layers there are, and how many takes of each (audio/<name>_<k>.ogg|m4a). */
export const LAYERS: Record<string, number> = {
  cannon_body: 1,
  cannon_report: 2,
  clack: 2,
  boom: 4,
  boom_tail: 2,
  steel_burst: 2,
  hit_brick: 3,
  hit_brick_big: 3,
  hit_wood: 3,
  hit_metal: 2,
  hit_glass: 3,
  thud: 2,
  debris_small: 3,
  debris_mid: 3,
  debris_big: 3,
  // Debris by material and size: S one voxel, M a clump, L a section landing (brick M and L are hit_brick and hit_brick_big)
  concrete_S: 4,
  concrete_M: 3,
  concrete_L: 2,
  plaster_S: 4,
  plaster_M: 3,
  plaster_L: 2,
  wood_S: 4,
  wood_M: 3,
  wood_L: 2,
  metal_S: 4,
  metal_M: 3,
  metal_L: 2,
  brick_S: 4,
  slide_rubble: 2,
  creak_wood: 2,
  creak_steel: 2,
  groan_masonry: 2,
  horn: 2,
  whistle: 2,
  music: 1,
};

/**
 * Per-take trims (dB) so the takes of a layer play at one loudness (from audio-build/layers.json: each take's
 * max momentary loudness against the loudest take's; a sharp transient was limited less hard in mastering).
 */
const TRIM: Record<string, number> = {
  cannon_body_2: 5.7, boom_2: 0.7, boom_4: 0.7, hit_brick_1: 0.9, hit_brick_2: 3.5, hit_brick_big_3: 3.1, hit_wood_2: 6, hit_wood_3: 3.6, hit_glass_3: 3.3, thud_2: 2.5,
  // the debris families (audio-build/trims.mjs: each take's loudest 100 ms against its layer's loudest)
  concrete_S_1: 3.2, concrete_S_3: 6.2, concrete_S_4: 10, concrete_M_1: 2.7, concrete_M_3: 2, concrete_L_2: 0.5, plaster_S_3: 4.3, plaster_S_4: 3.2, plaster_M_2: 7, plaster_L_1: 4.8,
  wood_S_1: 0.9, wood_S_2: 6.8, wood_M_3: 3.1, metal_S_1: 3.8, metal_S_2: 7.2, metal_S_3: 10, metal_M_1: 3.6, metal_M_3: 4, metal_L_2: 2.3, brick_S_2: 5.8, brick_S_3: 10, brick_S_4: 9.7,
  slide_rubble_2: 8.6, creak_wood_1: 1.4, creak_steel_1: 5, groan_masonry_2: 10,
};

/** Most voices of a category sounding at once: past it the oldest is cut (50 impacts never turn to mush). */
const CAPS: Record<string, number> = { cannon: 3, boom: 5, brick: 5, wood: 4, metal: 4, glass: 3, thud: 3, debris: 6, tail: 3, misc: 8, dS: 6, dM: 5, dL: 3, creak: 2 };
const CATEGORY = (name: string): string =>
  name.endsWith('_S') ? 'dS' : name.endsWith('_M') ? 'dM' : name.endsWith('_L') ? 'dL' : name.startsWith('creak') || name.startsWith('groan') ? 'creak' : name.startsWith('cannon') || name === 'clack' ? 'cannon' : name.startsWith('boom') || name === 'steel_burst' ? (name === 'boom_tail' ? 'tail' : 'boom') : name.startsWith('hit_brick') ? 'brick' : name === 'hit_wood' ? 'wood' : name === 'hit_metal' ? 'metal' : name === 'hit_glass' ? 'glass' : name === 'thud' ? 'thud' : name.startsWith('debris') ? 'debris' : 'misc';

/** What a voxel material sounds like when it's hit. */
export type Material = 'brick' | 'wood' | 'metal' | 'glass' | 'concrete' | 'plaster' | 'dirt';

/** A world position (m, z up). */
export type At = readonly [number, number, number];

/** Debris sizes: S a single voxel, M a clump, L a section landing. */
export type Tier = 'S' | 'M' | 'L';

/** The recorded layer for debris of `material` and `tier`, and a pitch for it. */
function debrisLayer(material: Material, tier: Tier): [string, number] {
  if (material === 'brick') return [tier === 'S' ? 'brick_S' : tier === 'M' ? 'hit_brick' : 'hit_brick_big', 1];
  if (material === 'dirt') return [`plaster_${tier}`, 0.78];
  if (material === 'glass') return ['hit_glass', tier === 'S' ? 1.35 : tier === 'M' ? 1.1 : 0.95];
  return [`${material}_${tier}`, 1];
}

/** The layer for a single hit (tools, cannonballs) on `material`. */
const hitLayer = (m: Material): string => (m === 'concrete' || m === 'plaster' || m === 'dirt' ? 'hit_brick' : `hit_${m}`);

interface PlayOpts {
  rate?: number;
  delay?: number;
  /** Pitch spread (share, each way). */
  spread?: number;
  /** Metres at which the level has halved. */
  dull?: number;
  /** Reverb send (0..1). */
  send?: number;
  /** Seconds to play at most (faded out over the last quarter). */
  dur?: number;
  /** A low-pass at this frequency (Hz), on top of the distance's. */
  lp?: number;
  /** Where it sounds (world m): panned around the listener. Left out for sounds at the player (tools, UI, steps). */
  at?: At;
  /** The voice category, if not the layer's own. */
  cat?: string;
}

const SPEED_OF_SOUND = 343;

export class Sounds {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private out: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly raw = new Map<string, Promise<ArrayBuffer | null>[]>();
  private readonly buffers = new Map<string, AudioBuffer[]>();
  private readonly last = new Map<string, number>();
  private readonly voices = new Map<string, { end: number; stop: () => void }[]>();
  /** Explosions started lately (s, context time): a ripple of charges stacks rather than clipping. */
  private recentBooms: number[] = [];
  volume = 0.7;
  musicLevel = 0.42;
  /** Seconds added to every start (offline rendering schedules a sequence ahead). */
  offset = 0;
  private wantMusic = false;
  /** Where the listener is (world m), for distances and for choosing who gets HRTF. */
  readonly ear: [number, number, number] = [0, 0, 1.7];
  /** HRTF voices sounding (end times): up to 3 loud, near ones get it, the rest equal power. */
  private hrtf: number[] = [];
  /** Collapse sets started lately: no new one within 8 m for 0.5 s. */
  private sets: { at: At; t: number }[] = [];
  /** The rubble loop (one, at the centroid of what's moving). */
  private slide: { src: AudioBufferSourceNode; gain: GainNode; pan: PannerNode | null } | null = null;
  /** Counters for the tests: debris voices started, collapse sets, creaks. */
  readonly counts = { debris: 0, sets: 0, creaks: 0 };

  /** How many recorded takes are decoded (for the test hook). */
  get loaded(): number {
    let n = 0;
    for (const l of this.buffers.values()) n += l.length;
    return n;
  }

  private now(): number {
    return (this.ctx?.currentTime ?? 0) + this.offset;
  }

  /** Start the audio (browsers only allow it after a click). */
  resume(): void {
    if (!this.ctx) this.attach(new AudioContext());
    const ctx = this.ctx as AudioContext;
    if (ctx.resume) void ctx.resume();
    this.master!.gain.value = this.volume;
  }

  /** Build the mix on a context (the live one, or an OfflineAudioContext to render and measure a sequence). */
  attach(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.frequency.value = ctx.sampleRate / 2;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.22;
    // The limiter: as hard and fast as the node goes (ratio 20, 1 ms), a little under full scale
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.out = ctx.createGain();
    this.out.gain.value = 0.92;
    this.master.connect(this.muffle).connect(this.comp).connect(this.limiter).connect(this.out).connect(ctx.destination);
    // Reverb: early slaps off the house fronts (a few tens of metres away) and a short, dark tail
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.muffle);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.duckGain = ctx.createGain();
    this.musicBus.connect(this.duckGain).connect(this.limiter);
    const n = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    void this.decodeAll();
  }

  /** The reverb's impulse: discrete slaps at 45 to 240 ms (house fronts across the lot), then diffuse noise decaying over ~1 s, low-passed. */
  private impulse(ctx: BaseAudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.round(sr * 1.4);
    const b = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (const [t, g] of [
        [0.045, 0.5],
        [0.071, 0.35],
        [0.11, 0.42],
        [0.16, 0.25],
        [0.24, 0.18],
      ] as [number, number][]) {
        const at = Math.round((t + (c ? 0.006 : 0)) * sr);
        for (let k = 0; k < 40; k++) d[at + k] += g * (1 - k / 40) * (Math.random() * 2 - 1);
      }
      let lp = 0;
      for (let i = Math.round(0.05 * sr); i < len; i++) {
        const t = i / sr;
        lp += ((Math.random() * 2 - 1) - lp) * 0.25;
        d[i] += lp * 0.5 * Math.exp(-t / 0.32);
      }
    }
    return b;
  }

  /** Fetch every take of every layer ahead of the first click (decoded once audio starts). */
  preload(names: Record<string, number> = LAYERS): void {
    const ext = typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
    for (const [name, takes] of Object.entries(names)) {
      if (this.raw.has(name)) continue;
      this.raw.set(
        name,
        Array.from({ length: takes }, (_, k) =>
          fetch(`audio/${name}_${k + 1}.${ext}`)
            .then((r) => (r.ok ? r.arrayBuffer() : null))
            .catch(() => null),
        ),
      );
    }
  }

  /** The decoded takes (to hand to an offline render). */
  get bufferMap(): Map<string, AudioBuffer[]> {
    return this.buffers;
  }

  /** Decoded buffers handed over directly (offline rendering in tests). */
  setBuffers(map: Map<string, AudioBuffer[]>): void {
    for (const [k, v] of map) this.buffers.set(k, v);
  }

  private async decodeAll(): Promise<void> {
    const ctx = this.ctx!;
    await Promise.all(
      [...this.raw.entries()].map(async ([name, list]) => {
        const out: AudioBuffer[] = [];
        for (const p of list) {
          const data = await p;
          if (!data) continue;
          try {
            out.push(await ctx.decodeAudioData(data.slice(0)));
          } catch {
            // undecodable: skip it
          }
        }
        if (out.length && !this.buffers.has(name)) this.buffers.set(name, out);
      }),
    );
    if (this.wantMusic) this.music(true);
  }

  /** A voice of `cat` starts, lasting until `end`: past the category's cap the oldest is cut short. */
  private claim(cat: string, end: number, stop: () => void): void {
    const now = this.now();
    const list = (this.voices.get(cat) ?? []).filter((v) => v.end > now);
    list.push({ end, stop });
    while (list.length > (CAPS[cat] ?? 8)) list.shift()!.stop();
    this.voices.set(cat, list);
  }

  /** Put the listener at the camera (call once a frame, after the camera moves). World and camera are z-up. */
  listen(pos: At, forward: At, up: At): void {
    this.ear[0] = pos[0];
    this.ear[1] = pos[1];
    this.ear[2] = pos[2];
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = pos[0];
      l.positionY.value = pos[1];
      l.positionZ.value = pos[2];
      l.forwardX.value = forward[0];
      l.forwardY.value = forward[1];
      l.forwardZ.value = forward[2];
      l.upX.value = up[0];
      l.upY.value = up[1];
      l.upZ.value = up[2];
    } else {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    }
  }

  /** Metres from the listener to `at`. */
  distanceTo(at: At): number {
    return Math.hypot(at[0] - this.ear[0], at[1] - this.ear[1], at[2] - this.ear[2]);
  }

  /**
   * A panner at `at`: equal power, with no roll-off of its own (level, low-pass and delay already follow distance).
   * HRTF for up to 3 loud voices within 15 m (lasting until `end`).
   */
  private panner(at: At, loud: number, end: number): PannerNode | null {
    const { ctx } = this;
    if (!ctx) return null;
    const p = ctx.createPanner();
    const now = this.now();
    this.hrtf = this.hrtf.filter((t) => t > now);
    const near = this.distanceTo(at) < 15 && loud > 0.3 && this.hrtf.length < 3;
    if (near) this.hrtf.push(end);
    p.panningModel = near ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 3;
    p.rolloffFactor = 0;
    p.maxDistance = 250;
    if (p.positionX) {
      p.positionX.value = at[0];
      p.positionY.value = at[1];
      p.positionZ.value = at[2];
    } else p.setPosition(at[0], at[1], at[2]);
    return p;
  }

  /** Where a layer goes: through a panner at `at` if given, else straight into the mix. */
  private dest(at: At | undefined, loud: number, end: number, hrtf = false): AudioNode {
    const p = at ? this.panner(at, hrtf ? loud : 0, end) : null;
    if (!p) return this.master!;
    p.connect(this.master!);
    return p;
  }

  /**
   * A recorded layer: a take at random (never the same twice running), its pitch and level varied, quieter,
   * duller and later with `distance` m (sound takes its time across the lot), a reverb send. False if not loaded.
   */
  play(name: string, gain = 1, distance = 0, opts: PlayOpts = {}): boolean {
    const { ctx } = this;
    const list = this.buffers.get(name);
    if (!ctx || !this.master || !list?.length || gain <= 0.001) return false;
    let k = Math.floor(Math.random() * list.length);
    if (list.length > 1 && k === this.last.get(name)) k = (k + 1) % list.length;
    this.last.set(name, k);
    const t = this.now() + (opts.delay ?? 0) + distance / SPEED_OF_SOUND;
    const src = ctx.createBufferSource();
    src.buffer = list[k];
    const spread = opts.spread ?? 0.07;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * spread);
    const g = ctx.createGain();
    const near = 1 / (1 + distance / (opts.dull ?? 25));
    const level = gain * near * (0.86 + Math.random() * 0.2) * 10 ** ((TRIM[`${name}_${k + 1}`] ?? 0) / 20);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(opts.lp ?? 20000, 1800 + 18000 * near * near);
    const length = list[k].duration / src.playbackRate.value;
    const dur = Math.min(length, opts.dur ?? length);
    const out = this.dest(opts.at, level, t + dur, true);
    src.connect(lp).connect(g).connect(out);
    if (opts.send && this.reverb) {
      // (From after the panner: the slaps come back mostly from the side the sound was on)
      const s = ctx.createGain();
      s.gain.value = opts.send;
      (out === this.master ? g : out).connect(s).connect(this.reverb);
    }
    g.gain.setValueAtTime(level, t);
    if (dur < length) {
      g.gain.setValueAtTime(level, t + dur * 0.75);
      g.gain.linearRampToValueAtTime(0, t + dur);
    }
    src.start(t);
    src.stop(t + dur + 0.02);
    this.claim(opts.cat ?? CATEGORY(name), t + dur, () => {
      const n = this.now();
      g.gain.cancelScheduledValues(n);
      g.gain.setValueAtTime(g.gain.value, n);
      g.gain.linearRampToValueAtTime(0, n + 0.04);
      try {
        src.stop(n + 0.05);
      } catch {
        // already stopped
      }
    });
    return true;
  }

  // ---------- the four designed events ----------

  /** The hand cannon fired, at the player's ear. */
  cannonFire(): void {
    if (!this.ctx) return;
    // Transient: a few ms of bright noise
    this.hiss(0.55, 1800, 0.035);
    // Chesty low body and the sub thump under it
    this.tone(0.55, 140, 68, 0.2, 'triangle');
    this.tone(1.15, 62, 31, 0.42);
    // The recorded shot, with a little reverb
    if (!this.play('cannon_body', 1.1, 0, { spread: 0.05, send: 0.18 })) this.rumble(0.9, 3000, 80, 0.6);
    // The breech clack, a beat after
    this.play('clack', 0.32, 0, { delay: 0.06, rate: 1.25, spread: 0.08 });
    // The slap off the houses and the report rolling back across the town
    this.play('cannon_report', 0.55, 0, { delay: 0.12, send: 0.5, lp: 3500, spread: 0.04 });
    this.duck(4, 0.35);
  }

  /** Something hit hard (a cannonball, debris): `energy` 0..1, the material, `broken` voxels, `distance` m, where. */
  impact(material: Material, energy: number, distance: number, broken: number, at?: At): void {
    if (!this.ctx) return;
    const e = Math.max(0, Math.min(1, energy));
    const dly = distance / SPEED_OF_SOUND;
    this.play(hitLayer(material), 0.45 + 0.45 * e, distance, { rate: (1.1 - 0.22 * e) * (material === 'plaster' ? 1.15 : material === 'concrete' ? 0.92 : 1), send: 0.15 + 0.15 * e, dull: 30, at });
    if (material === 'concrete' || material === 'plaster') this.play(`${material}_M`, 0.4 * e, distance, { delay: 0.02, send: 0.15, dull: 30, at });
    if ((material === 'brick' || material === 'concrete') && e > 0.45) this.play('hit_brick_big', 0.35 + 0.6 * (e - 0.45) * 2, distance, { rate: 1.05 - 0.15 * e, send: 0.25, dull: 35, at });
    if (material === 'metal' && e > 0.5) this.play('steel_burst', 0.4 * e, distance, { rate: 1.2, dull: 30, at });
    // Sub boom through the ground, by energy
    const near = 1 / (1 + distance / 30);
    this.tone(0.8 * e * near, 78, 30, 0.35 + 0.3 * e, 'sine', dly, at);
    this.debrisTail(broken, distance, 0.1 + dly, at);
  }

  /** The sledge landing: `power` 0..1 of the wind-up, the material, `broken` voxels, `distance` m, where. */
  sledgeHit(material: Material, power: number, distance: number, broken: number, at?: At): void {
    if (!this.ctx) return;
    const p = Math.max(0, Math.min(1, power));
    this.play('thud', 0.45 + 0.35 * p, distance, { rate: 1.12 - 0.18 * p, spread: 0.06, send: 0.1, at });
    this.play(hitLayer(material), broken > 0 ? 0.55 + 0.35 * p : 0.35, distance, { rate: (1.15 - 0.2 * p) * (material === 'plaster' ? 1.2 : 1), delay: 0.004, send: 0.12, at });
    if (material === 'brick' && p > 0.8 && broken > 30) this.play('hit_brick_big', 0.35, distance, { rate: 1.15, send: 0.2, at });
    if (material === 'plaster' || material === 'concrete') this.play(`${material}_S`, 0.5, distance, { delay: 0.01, at });
    const near = 1 / (1 + distance / 12);
    this.tone(0.75 * near * (0.5 + 0.5 * p), 125, 44, 0.26, 'sine', 0, at);
    // The steel head rings a little
    this.tone(0.05 * near, 2150, 2100, 0.3, 'triangle', 0.01, at);
    this.debrisTail(broken, distance, 0.06, at);
  }

  /**
   * A tool hit something too hard for it (Phase 2 hardness): no hole, but the player hears the material win, a
   * small hit of it at -8 dB, a dull thud pitched up, and steel rings.
   */
  bounce(material: Material, distance: number, at?: At): void {
    if (!this.ctx) return;
    const [layer, rate] = debrisLayer(material === 'glass' ? 'concrete' : material, 'S');
    this.play(layer, 0.4, distance, { rate: rate * 1.05, send: 0.12, at, cat: 'misc' });
    this.play('thud', 0.42, distance, { rate: 1.25, spread: 0.04, send: 0.08, at });
    const near = 1 / (1 + distance / 12);
    if (material === 'metal') {
      this.play('clack', 0.35, distance, { rate: 0.8, at });
      this.tone(0.07 * near, 1720, 1700, 0.6, 'triangle', 0.005, at);
      this.tone(0.05 * near, 2890, 2860, 0.45, 'sine', 0.005, at);
    } else this.tone(0.4 * near, 180, 70, 0.12, 'sine', 0, at);
  }

  /** A gas line rupturing: a roaring jet of flame. */
  gasJet(at: At): void {
    if (!this.ctx) return;
    const d = this.distanceTo(at);
    this.swoosh(0.45 / (1 + d / 30), 300, 2200, 1.1, d / SPEED_OF_SOUND, at);
    this.rumble(0.35 / (1 + d / 40), 700, 90, 1.2, d / SPEED_OF_SOUND, at);
  }

  /** The rocket launched: a thump and a roaring hiss pulling away. */
  rocket(): void {
    if (!this.ctx) return;
    this.play('clack', 0.4, 0, { rate: 0.7 });
    this.tone(0.6, 120, 45, 0.25);
    this.hiss(0.4, 900, 0.5);
    this.swoosh(0.35, 500, 2400, 0.7);
  }

  /** A cutter firing: a sharp crack, a hiss of burning metal, steel ringing. */
  cutter(distance: number, at?: At): void {
    if (!this.ctx) return;
    const dly = distance / SPEED_OF_SOUND;
    this.hiss(0.6 / (1 + distance / 30), 2600, 0.05, dly, at);
    this.play('steel_burst', 0.55, distance, { rate: 1.3, send: 0.25, dull: 35, at });
    this.play('hit_metal', 0.4, distance, { rate: 1.1, delay: 0.03, send: 0.2, at });
    this.hiss(0.18 / (1 + distance / 20), 4000, 0.7, dly + 0.04, at);
    this.tone(0.6 / (1 + distance / 30), 90, 40, 0.3, 'sine', dly);
    this.duck(4, 0.4);
  }

  /** A jackhammer bite: a short knock of the material, quieter if nothing came away. */
  jackHit(material: Material, broke: number, distance: number, at?: At, through = false): void {
    if (!this.ctx) return;
    const [layer, rate] = debrisLayer(material === 'glass' ? 'concrete' : material, 'S');
    this.play(layer, broke ? 0.5 : 0.22, distance, { rate: rate * (0.95 + Math.random() * 0.2), spread: 0.1, dur: 0.22, at, cat: 'misc' });
    this.tone(0.3, 140, 60, 0.07, 'sine', 0, at);
    this.tone(0.1, 240, 120, 0.04, 'square', 0, at);
    if (broke > 3) this.play('debris_small', 0.3, distance, { delay: 0.05, spread: 0.15, at });
    if (through) {
      // The clump breaking out: a heavy crack, the chunk landing, a rumble
      const [big] = debrisLayer(material === 'glass' ? 'concrete' : material, 'M');
      this.play(big, 0.9, distance, { send: 0.2, at });
      this.play('thud', 0.6, distance, { rate: 0.9, at });
      this.tone(0.7, 90, 35, 0.3, 'sine', 0, at);
      this.debrisTail(40 + broke, distance, 0.15, at);
    }
  }

  /** The jackhammer's motor: a rough buzz while it runs. */
  jackMotor(on: boolean): void {
    const { ctx } = this;
    if (!ctx || !this.master) return;
    if (on && !this.motor) {
      const t = this.now();
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 46;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.06);
      // The hammering: the motor's level chopped ten times a second
      const chop = ctx.createOscillator();
      chop.type = 'square';
      chop.frequency.value = 10;
      const depth = ctx.createGain();
      depth.gain.value = 0.07;
      chop.connect(depth).connect(g.gain);
      chop.start(t);
      osc.connect(lp).connect(g).connect(this.master);
      osc.start(t);
      this.motor = { osc, g, chop };
    } else if (!on && this.motor) {
      const t = this.now();
      const { osc, g } = this.motor;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.08);
      osc.stop(t + 0.1);
      this.motor.chop?.stop(t + 0.1);
      this.motor = null;
    }
  }
  private motor: { osc: OscillatorNode; g: GainNode; chop?: OscillatorNode } | null = null;

  /** A demolition charge going off `distance` m away. Charges in a ripple stack at 1/√n rather than summing. */
  charge(distance: number, size = 1, at?: At): void {
    if (!this.ctx) return;
    const now = this.now();
    this.recentBooms = this.recentBooms.filter((t) => now - t < 0.4);
    this.recentBooms.push(now);
    const stack = 1 / Math.sqrt(this.recentBooms.length);
    const near = 1 / (1 + distance / 40);
    const dly = distance / SPEED_OF_SOUND;
    // The crack: a hard, bright few milliseconds, then the boom
    this.hiss(0.7 * near * stack, 2200, 0.03, dly, at);
    this.play('boom', 1.3 * stack * size, distance, { rate: 1.0 - 0.06 * size, spread: 0.06, send: 0.3, dull: 45, at });
    this.tone(1.25 * near * stack, 52, 26, 0.9, 'sine', dly);
    // The far tail rolling round the houses (not panned: it comes back from everywhere)
    this.play('boom_tail', 0.5 * stack, distance, { delay: 0.18, send: 0.4, spread: 0.05, dull: 60 });
    this.duck(7, 0.8);
  }

  /** A propane tank or fuel drum: a charge's boom, a burst of steel and a roar of fire. */
  propane(distance: number, at?: At): void {
    if (!this.ctx) return;
    this.charge(distance, 1, at);
    this.play('steel_burst', 0.6, distance, { rate: 0.95, delay: 0.01, send: 0.25, dull: 40, at });
    this.swoosh(0.28 / (1 + distance / 30), 300, 1400, 0.9, 0.05 + distance / SPEED_OF_SOUND, at);
  }

  /** Rubble coming down after `voxels` broke or fell, `distance` m off: more voxels, longer and louder, a storey's rumbles for seconds. */
  debrisTail(voxels: number, distance: number, delay = 0, at?: At): void {
    if (!this.ctx || voxels <= 0) return;
    const v = voxels;
    if (v < 50) {
      this.play('debris_small', 0.15 + 0.4 * Math.min(1, v / 50), distance, { delay, spread: 0.12, dull: 25, at });
      return;
    }
    // (Quieter and shorter than before the debris had its own hits: the bed under them, not a wash over them)
    const dur = Math.min(6, 1 + v / 900);
    this.play('debris_mid', 0.32 * Math.min(0.85, 0.3 + v / 1500), distance, { delay, dur: Math.min(4, dur), spread: 0.1, send: 0.15, dull: 35, at });
    if (v > 600) {
      this.play('debris_big', 0.32 * Math.min(1, 0.35 + v / 6000), distance, { delay: delay + 0.15, dur, spread: 0.08, send: 0.25, dull: 45, rate: 0.95, at });
      this.rumble(Math.min(0.7, 0.2 + v / 10000) / (1 + distance / 60), 260, 35, Math.min(6, 1.5 + v / 3000), delay + distance / SPEED_OF_SOUND, at);
      this.duck(6, Math.min(3, dur * 0.5));
    }
  }

  // ---------- debris that sounds like what it is ----------

  /**
   * A piece of debris struck something at `at`: `tier` S (one voxel), M (a clump) or L (a section landing),
   * `dv` the speed it lost (m/s), `size` voxels. S at -24 dB, M -16, L -8, up to 6 dB more by how hard it hit;
   * bigger pieces lower. L adds a sub. The voice caps (S 6, M 5, L 3) keep a storey's worth from turning to mush.
   */
  debrisHit(material: Material, tier: Tier, dv: number, size: number, at: At): void {
    if (!this.ctx) return;
    const distance = this.distanceTo(at);
    const db = (tier === 'S' ? -24 : tier === 'M' ? -16 : -8) + 6 * Math.max(0, Math.min(1, (dv - 3) / 12));
    const [layer, pitch] = debrisLayer(material, tier);
    const ref = tier === 'S' ? 1 : tier === 'M' ? 8 : 300;
    const rate = pitch * Math.max(0.78, Math.min(1.25, (Math.max(1, size) / ref) ** (-1 / 3)));
    // (Somewhere in the 100 ms since the last readback, not all on its beat; small pieces short)
    const delay = Math.random() * 0.1;
    if (this.play(layer, 10 ** (db / 20), distance, { rate, delay, dur: tier === 'S' ? 0.22 : tier === 'M' ? 0.5 : undefined, spread: 0.07, send: tier === 'S' ? 0.05 : tier === 'M' ? 0.12 : 0.25, dull: 30, at, cat: `d${tier}` })) this.counts.debris++;
    if (tier === 'L') this.tone(0.32 / (1 + distance / 40), 60, 30, 0.45, 'sine', distance / SPEED_OF_SOUND, at);
    if (material === 'glass' && tier !== 'L') this.glassTinkle(tier === 'S' ? 2 : 5, distance, at);
  }

  /**
   * Many impacts at once in one place (a wall coming apart): one designed set instead of each piece, a crack,
   * a body, the debris tail, a rumble, sized by `voxels`. None within 8 m of the last for 0.5 s. True if it played.
   */
  collapseSet(material: Material, voxels: number, at: At): boolean {
    if (!this.ctx) return false;
    const now = this.now();
    this.sets = this.sets.filter((s) => now - s.t < 0.5);
    if (this.sets.some((s) => Math.hypot(s.at[0] - at[0], s.at[1] - at[1], s.at[2] - at[2]) < 8)) return false;
    this.sets.push({ at, t: now });
    this.counts.sets++;
    const distance = this.distanceTo(at);
    const level = Math.min(1, 0.35 + 0.65 * Math.sqrt(voxels / 150));
    const dly = distance / SPEED_OF_SOUND;
    this.hiss(0.4 * level / (1 + distance / 40), 2200, 0.03, dly, at);
    const [body, rate] = material === 'brick' ? ['hit_brick_big', 1] : debrisLayer(material, 'L');
    this.play(body, 0.5 * level, distance, { rate: rate * (0.97 + 0.06 * Math.random()), send: 0.25, dull: 35, at, cat: 'dL' });
    this.debrisTail(voxels, distance, 0.08, at);
    this.rumble((0.45 * level) / (1 + distance / 60), 120, 30, Math.min(4, 0.8 + voxels / 400), dly, at);
    return true;
  }

  /**
   * The rubble loop: one looping slide of rubble whose level follows how much is moving (√(moving/400), at most
   * -10 dB) and sits at the centroid of what moves. Call every readback; 0 fades it out.
   */
  rubble(moving: number, at: At | null): void {
    const { ctx } = this;
    if (!ctx || !this.master) return;
    const list = this.buffers.get('slide_rubble');
    if (!list?.length) return;
    const t = this.now();
    if (!this.slide && moving > 0 && at) {
      const src = ctx.createBufferSource();
      src.buffer = list[Math.floor(Math.random() * list.length)];
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = this.panner(at, 0, 0);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 9000;
      src.connect(lp).connect(gain);
      if (pan) gain.connect(pan).connect(this.master);
      else gain.connect(this.master);
      src.start(t, Math.random() * 3);
      this.slide = { src, gain, pan };
    }
    const s = this.slide;
    if (!s) return;
    const want = moving > 0 && at ? Math.min(0.316, Math.sqrt(moving / 400)) / (1 + this.distanceTo(at) / 35) : 0;
    s.gain.gain.setTargetAtTime(want, t, want > s.gain.gain.value ? 0.12 : 0.5);
    if (at && s.pan) {
      if (s.pan.positionX) {
        s.pan.positionX.setTargetAtTime(at[0], t, 0.15);
        s.pan.positionY.setTargetAtTime(at[1], t, 0.15);
        s.pan.positionZ.setTargetAtTime(at[2], t, 0.15);
      } else s.pan.setPosition(at[0], at[1], at[2]);
    }
  }

  /**
   * A structure under load says so: wood and steel creak, masonry groans, at `r` 0.8..1 of what it can carry
   * (-14 dB at 0.8, -6 dB at 1).
   */
  creak(kind: 'wood' | 'steel' | 'masonry', r: number, at: At): void {
    if (!this.ctx) return;
    const db = -14 + 8 * Math.max(0, Math.min(1, (r - 0.8) / 0.2));
    const layer = kind === 'wood' ? 'creak_wood' : kind === 'steel' ? 'creak_steel' : 'groan_masonry';
    if (this.play(layer, 10 ** (db / 20), this.distanceTo(at), { spread: 0.1, send: 0.2, dull: 30, at, rate: kind === 'masonry' ? 0.85 : 1 })) this.counts.creaks++;
  }

  /** The material a voxel sounds like (world.ts Mat: glass 1 and 5, steel 3 and girder 11, wood 10, leaf 8, plastic 13, concrete 0, roof 4 and RC 12 and rock 15, plaster 6 and trim 7, dirt 14; brick and the rest masonry). */
  static material(mat: number): Material {
    switch (mat) {
      case 1:
      case 5:
        return 'glass';
      case 3:
      case 11:
        return 'metal';
      case 8:
      case 10:
      case 13:
        return 'wood';
      case 0:
      case 4:
      case 12:
      case 15:
        return 'concrete';
      case 6:
      case 7:
        return 'plaster';
      case 14:
        return 'dirt';
      default:
        return 'brick';
    }
  }

  // ---------- music, ducking, slow motion ----------

  /** The music bed, looping (starts once it's decoded). */
  music(on: boolean): void {
    this.wantMusic = on;
    const { ctx } = this;
    if (!ctx || !this.musicBus) return;
    const t = this.now();
    if (on && !this.musicSource) {
      const buffer = this.buffers.get('music')?.[0];
      if (!buffer) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(this.musicBus);
      src.start(t);
      this.musicSource = src;
    }
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(on ? this.musicLevel * this.volume : 0, t, on ? 0.6 : 0.3);
  }

  /** Duck the music by `db` for `seconds` (a blast, a collapse), easing back after. */
  duck(db = 6, seconds = 0.6): void {
    if (!this.ctx || !this.duckGain) return;
    const t = this.now();
    const g = this.duckGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(10 ** (-db / 20), t, 0.03);
    g.setTargetAtTime(1, t + seconds, 0.35);
  }

  /** The world slowed (kill-cam): everything muffled, the music dipped. */
  slowMo(on: boolean): void {
    if (!this.ctx || !this.muffle) return;
    const t = this.now();
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setTargetAtTime(on ? 900 : this.ctx.sampleRate / 2, t, on ? 0.05 : 0.2);
    if (this.duckGain) this.duckGain.gain.setTargetAtTime(on ? 0.35 : 1, t, 0.15);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
    if (this.musicBus && this.wantMusic && this.ctx) this.musicBus.gain.setTargetAtTime(this.musicLevel * v, this.now(), 0.1);
  }

  // ---------- synthesised layers (the fork's, at the mix's input) ----------

  /** A short synth blip (combo ticks, UI): `f` Hz. */
  blip(f: number, gain = 0.06, seconds = 0.08, type: OscillatorType = 'triangle'): void {
    this.tone(gain, f, f * 1.02, seconds, type);
  }

  /** Noise through a low-pass falling from `from` to `to` Hz over `seconds`, at `gain`. */
  private rumble(gain: number, from: number, to: number, seconds: number, delay = 0, at?: At): void {
    const { ctx } = this;
    if (!ctx || !this.master || !this.noise || gain <= 0.0005) return;
    const t = this.now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = seconds > 2.5;
    src.playbackRate.value = 0.6 + Math.random() * 0.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(from, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(lp).connect(g).connect(this.dest(at, gain, t + seconds));
    src.start(t, Math.random() * 1.5);
    src.stop(t + seconds + 0.1);
  }

  private tone(gain: number, from: number, to: number, seconds: number, type: OscillatorType = 'sine', delay = 0, at?: At): void {
    const { ctx } = this;
    if (!ctx || !this.master || gain <= 0.0005) return;
    const t = this.now() + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(g).connect(this.dest(at, gain, t + seconds));
    osc.start(t);
    osc.stop(t + seconds + 0.05);
  }

  /** Noise through a high-pass (from `cut` Hz), sharp attack, gone over `seconds`. */
  private hiss(gain: number, cut: number, seconds: number, delay = 0, at?: At): void {
    const { ctx } = this;
    if (!ctx || !this.master || !this.noise || gain <= 0.0005) return;
    const t = this.now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.3;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(hp).connect(g).connect(this.dest(at, gain, t + seconds));
    src.start(t, Math.random() * 2);
    src.stop(t + seconds + 0.1);
  }

  /** Noise through a band-pass sweeping `from` to `to` Hz: a whoosh. */
  private swoosh(gain: number, from: number, to: number, seconds: number, delay = 0, at?: At): void {
    const { ctx } = this;
    if (!ctx || !this.master || !this.noise || gain <= 0.0005) return;
    const t = this.now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + seconds * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(bp).connect(g).connect(this.dest(at, gain, t + seconds));
    src.start(t, Math.random() * 2);
    src.stop(t + seconds + 0.1);
  }

  /** A blast heard from `distance` m with no recorded layers loaded yet (synth only). */
  blast(radius: number, distance: number): void {
    const near = 1 / (1 + distance / 40);
    const size = Math.min(1, radius / 7);
    this.rumble(0.9 * near * (0.4 + size), 4000 * near + 300, 60, 1.2 + 2 * size);
    this.tone(0.8 * near * (0.3 + size), 90, 28, 0.6 + size);
  }

  /** A small knock (debris striking what stands). */
  hammer(distance: number, at?: At): void {
    const near = 1 / (1 + distance / 10);
    this.rumble(0.4 * near, 2200, 200, 0.18, 0, at);
    this.tone(0.25 * near, 160, 60, 0.12, 'triangle', 0, at);
  }

  /** Switching tools: a soft mechanical click. */
  click(): void {
    this.tone(0.07, 900, 600, 0.05, 'triangle');
    this.hiss(0.04, 5000, 0.03);
  }

  /** Windows shattering (`panes` of them) from `distance` m: the recorded break, and shards tinkling down. */
  glass(panes: number, distance: number, fall = 1, at?: At): void {
    const size = Math.min(1, panes / 12);
    this.play('hit_glass', 0.35 + 0.4 * size, distance, { send: 0.2, dull: 30, at });
    if (panes > 3) this.play('hit_glass', 0.3 * size, distance, { delay: 0.07, rate: 0.9, dull: 30, at });
    this.glassTinkle(Math.round(4 + 18 * size), distance, at, 0.3, 0.9 + 0.8 * fall);
  }

  /** Shards tinkling down: `n` little bright pings over `spread` s, from `after` s on. */
  private glassTinkle(n: number, distance: number, at?: At, after = 0.05, spread = 0.5): void {
    const near = 1 / (1 + distance / 30);
    const dull = 1 / (1 + distance / 80);
    for (let k = 0; k < n; k++) {
      const when = after + Math.random() ** 0.7 * spread;
      const f = (2600 + Math.random() * 6500) * (0.6 + 0.4 * dull);
      this.tone((0.015 + Math.random() * 0.035) * near, f, f * (0.97 + Math.random() * 0.02), 0.04 + Math.random() * 0.12, Math.random() < 0.5 ? 'sine' : 'triangle', when, at);
    }
  }

  /** A heavy tool swung through the air. */
  swing(power = 0.5): void {
    this.swoosh(0.16 + 0.12 * power, 300, 1300, 0.24);
  }

  /** Something big came down (voxel count), `distance` m off. */
  collapse(voxels: number, distance: number, at?: At): void {
    this.debrisTail(voxels, distance, 0.2, at);
  }

  /** A footstep (a little different each time). */
  step(run: boolean): void {
    this.rumble(run ? 0.1 : 0.07, 1400 + Math.random() * 600, 180, 0.07);
  }

  /** Landing from a fall at `speed` m/s. */
  land(speed: number): void {
    this.rumble(Math.min(0.5, speed * 0.04), 900, 60, 0.2);
  }

  // ---------- machines ----------
  private engines = new Map<string, { pan: PannerNode; out: GainNode; saw: OscillatorNode; sub: OscillatorNode; lp: BiquadFilterNode; clatter: GainNode; chop: OscillatorNode; hyd: GainNode; whine: OscillatorNode; whineG: GainNode; winch: GainNode; stop: () => void }>();

  /**
   * A machine's engine and hydraulics, kept running while it's on: a diesel (a sawtooth and a sub an octave down,
   * low-passed by the load, with a clatter of injector knocks at the firing rate), the hydraulic pump's hiss and
   * whine when the arm or boom moves, and a winch's ratchet. `rpm`, `load`, `hydraulic` and `winch` are 0..1.
   */
  machine(id: string, at: At, rpm: number, load: number, hydraulic: number, winch: number, near = 1): void {
    const { ctx } = this;
    if (!ctx || !this.master || !this.noise) return;
    // (Not into an offline render of a scene: the engines are the live mix's)
    if (typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext) return;
    let e = this.engines.get(id);
    const t = this.now();
    if (!e) {
      const pan = ctx.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 4;
      pan.rolloffFactor = 0.9;
      pan.maxDistance = 200;
      pan.connect(this.master);
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(pan);
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'square';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1.6;
      const body = ctx.createGain();
      body.gain.value = 0.55;
      saw.connect(lp);
      sub.connect(body).connect(lp);
      lp.connect(out);
      // Injector knock: band-passed noise gated at the firing rate
      const knock = ctx.createBufferSource();
      knock.buffer = this.noise;
      knock.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 0.9;
      const clatter = ctx.createGain();
      clatter.gain.value = 0;
      const chop = ctx.createOscillator();
      chop.type = 'square';
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      const gate = ctx.createGain();
      gate.gain.value = 0.5;
      chop.connect(depth).connect(gate.gain);
      knock.connect(bp).connect(gate).connect(clatter).connect(out);
      // The hydraulics: a hiss and the pump's whine
      const hissSrc = ctx.createBufferSource();
      hissSrc.buffer = this.noise;
      hissSrc.loop = true;
      const hbp = ctx.createBiquadFilter();
      hbp.type = 'bandpass';
      hbp.frequency.value = 650;
      hbp.Q.value = 3;
      const hyd = ctx.createGain();
      hyd.gain.value = 0;
      hissSrc.connect(hbp).connect(hyd).connect(pan);
      const whine = ctx.createOscillator();
      whine.type = 'triangle';
      const whineG = ctx.createGain();
      whineG.gain.value = 0;
      whine.connect(whineG).connect(pan);
      // The winch: a ratchet, high clicks 18 times a second
      const rat = ctx.createBufferSource();
      rat.buffer = this.noise;
      rat.loop = true;
      const rbp = ctx.createBiquadFilter();
      rbp.type = 'bandpass';
      rbp.frequency.value = 3200;
      rbp.Q.value = 2;
      const rgate = ctx.createGain();
      rgate.gain.value = 0;
      const rclock = ctx.createOscillator();
      rclock.type = 'square';
      rclock.frequency.value = 18;
      rclock.connect(rgate.gain);
      const winchG = ctx.createGain();
      winchG.gain.value = 0;
      rat.connect(rbp).connect(rgate).connect(winchG).connect(pan);
      const oscs = [saw, sub, chop, whine, rclock];
      const srcs = [knock, hissSrc, rat];
      for (const n of oscs) n.start(t);
      for (const n of srcs) n.start(t, Math.random() * 2);
      const stop = () => {
        const n = this.now();
        for (const g of [out.gain, hyd.gain, whineG.gain, winchG.gain]) {
          g.cancelScheduledValues(n);
          g.setTargetAtTime(0, n, 0.05);
        }
        for (const o of [...oscs, ...srcs]) o.stop(n + 0.4);
      };
      e = { pan, out, saw, sub, lp, clatter, chop, hyd, whine, whineG, winch: winchG, stop };
      this.engines.set(id, e);
    }
    if (e.pan.positionX) {
      e.pan.positionX.setTargetAtTime(at[0], t, 0.03);
      e.pan.positionY.setTargetAtTime(at[1], t, 0.03);
      e.pan.positionZ.setTargetAtTime(at[2], t, 0.03);
    } else e.pan.setPosition(at[0], at[1], at[2]);
    const f = 24 + 30 * rpm;
    e.saw.frequency.setTargetAtTime(f, t, 0.12);
    e.sub.frequency.setTargetAtTime(f / 2, t, 0.12);
    e.chop.frequency.setTargetAtTime(f / 2, t, 0.12);
    e.lp.frequency.setTargetAtTime(220 + 900 * load + 300 * rpm, t, 0.1);
    e.out.gain.setTargetAtTime((0.07 + 0.13 * load + 0.05 * rpm) * near, t, 0.1);
    e.clatter.gain.setTargetAtTime((0.08 + 0.2 * load) * near, t, 0.1);
    e.hyd.gain.setTargetAtTime(0.11 * hydraulic * near, t, 0.06);
    e.whine.frequency.setTargetAtTime(380 + 260 * hydraulic + 120 * load, t, 0.1);
    e.whineG.gain.setTargetAtTime(0.018 * hydraulic * near, t, 0.06);
    e.winch.gain.setTargetAtTime(0.05 * winch * near, t, 0.04);
  }

  /** Every machine's engine off (a new lot). */
  machinesOff(): void {
    for (const e of this.engines.values()) e.stop();
    this.engines.clear();
  }

  /** How many machine engines are running (tests). */
  get enginesOn(): number {
    return this.engines.size;
  }

  /** Steel on what it couldn't break: a clang, a ring and a thump through the frame. */
  clank(speed: number, distance: number, at?: At): void {
    if (!this.ctx) return;
    const k = Math.min(1, speed / 6);
    this.play('hit_metal', 0.5 + 0.5 * k, distance, { rate: 0.75 + Math.random() * 0.1, at, send: 0.2 });
    this.play('metal_M', 0.4 * k, distance, { rate: 0.7, delay: 0.02, at });
    this.tone(0.35 * k, 120, 45, 0.25, 'sine', 0, at);
  }

  /** The ball swinging past: a whoosh by its speed. */
  whoosh(speed: number, at: At): void {
    if (speed < 3) return;
    this.swoosh(Math.min(0.25, (speed - 3) * 0.04), 300, 900, 0.5, 0, at);
  }

  /** Something going into the water (`size` 0..2): a slap, a rush of bubbling spray, and a deep plunge for big ones. */
  splash(size: number, distance: number, at?: At): void {
    if (!this.ctx) return;
    const k = Math.min(1, size / 1.5);
    const near = 1 / (1 + distance / 30);
    this.swoosh((0.12 + 0.3 * k) * near, 2400, 700, 0.25 + 0.4 * k, 0, at);
    this.hiss((0.08 + 0.2 * k) * near, 1500, 0.3 + 0.5 * k, 0.03, at);
    if (size > 0.6) this.play('thud', 0.5 * k, distance, { rate: 0.6, at, lp: 900 });
    this.tone(0.2 * k * near, 180, 50, 0.3, 'sine', 0, at);
  }

  // ---------- the heist ----------
  private sirenNodes: { stop: () => void } | null = null;
  /** The alarm: a siren wailing over the lot, far off (low-passed, with a lot of reverb). */
  siren(on: boolean): void {
    const { ctx } = this;
    if (!ctx || !this.master) return;
    if (on && !this.sirenNodes) {
      const t = this.now();
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.09, t + 0.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2500;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 620;
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = 0.55;
      const sweep = ctx.createGain();
      sweep.gain.value = 260;
      lfo.connect(sweep).connect(o.frequency);
      o.connect(lp).connect(out).connect(this.master);
      if (this.reverb) {
        const s = ctx.createGain();
        s.gain.value = 0.6;
        out.connect(s).connect(this.reverb);
      }
      o.start(t);
      lfo.start(t);
      this.sirenNodes = {
        stop: () => {
          const n = this.now();
          out.gain.cancelScheduledValues(n);
          out.gain.setValueAtTime(out.gain.value, n);
          out.gain.linearRampToValueAtTime(0, n + 0.4);
          o.stop(n + 0.5);
          lfo.stop(n + 0.5);
        },
      };
    } else if (!on && this.sirenNodes) {
      this.sirenNodes.stop();
      this.sirenNodes = null;
    }
  }

  private chopperNodes: { out: GainNode; stop: () => void } | null = null;
  /** The security chopper closing in: rotor thump (noise chopped at 5 Hz, low-passed), louder as `level` goes 0..1. */
  chopper(level: number): void {
    const { ctx } = this;
    if (!ctx || !this.master || !this.noise) return;
    if (level > 0 && !this.chopperNodes) {
      const t = this.now();
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const gate = ctx.createGain();
      gate.gain.value = 0.2;
      const rotor = ctx.createOscillator();
      rotor.type = 'sawtooth';
      rotor.frequency.value = 5.2;
      const depth = ctx.createGain();
      depth.gain.value = 0.8;
      rotor.connect(depth).connect(gate.gain);
      const out = ctx.createGain();
      out.gain.value = 0;
      src.connect(lp).connect(gate).connect(out).connect(this.master);
      src.start(t);
      rotor.start(t);
      this.chopperNodes = {
        out,
        stop: () => {
          const n = this.now();
          out.gain.cancelScheduledValues(n);
          out.gain.setValueAtTime(out.gain.value, n);
          out.gain.linearRampToValueAtTime(0, n + 0.6);
          src.stop(n + 0.7);
          rotor.stop(n + 0.7);
        },
      };
    }
    if (this.chopperNodes) {
      if (level <= 0) {
        this.chopperNodes.stop();
        this.chopperNodes = null;
      } else this.chopperNodes.out.gain.setTargetAtTime(0.5 * level, this.now(), 0.2);
    }
  }

  /** A piece of loot taken: a bright two-note sting. */
  pickup(): void {
    this.tone(0.22, 880, 880, 0.12, 'triangle');
    this.tone(0.2, 1320, 1320, 0.22, 'triangle', 0.09);
    this.play('clack', 0.3, 0, { rate: 1.4 });
  }

  /** The end of a heist: away clean (a rising run), or caught (a falling one). */
  sting(win: boolean): void {
    const notes = win ? [523, 659, 784, 1046] : [392, 330, 262, 196];
    notes.forEach((f, k) => this.tone(0.2, f, f, 0.35, 'triangle', k * 0.13));
  }

  /**
   * A car alarm: the horn honking over and over, in bursts with a breath between. Returns its volume control
   * (0..1, set from the listener's distance) and a stop. (From three-voxel-destruction.)
   */
  alarm(): { level: (v: number) => void; stop: () => void } | null {
    const { ctx } = this;
    if (!ctx || !this.master) return null;
    const t = this.now();
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    const tones = [392, 494].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * (0.995 + Math.random() * 0.01);
      return o;
    });
    const drive = ctx.createWaveShaper();
    drive.curve = Float32Array.from({ length: 256 }, (_, i) => Math.tanh(((i / 255) * 2 - 1) * 2.5));
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    for (const o of tones) o.connect(drive);
    drive.connect(tone).connect(gate).connect(out);
    for (const o of tones) o.start(t);
    let at = t + 0.02;
    let running = true;
    const schedule = () => {
      if (!running) return;
      while (at < this.now() + 3) {
        for (let k = 0; k < 3; k++) {
          gate.gain.setTargetAtTime(1, at, 0.008);
          gate.gain.setTargetAtTime(0, at + 0.34, 0.012);
          at += 0.54;
        }
        at += 0.35;
      }
    };
    schedule();
    const timer = setInterval(schedule, 1000);
    let stopped = false;
    return {
      level: (v) => {
        if (!stopped) out.gain.setTargetAtTime(0.12 * v, this.now(), 0.05);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        running = false;
        clearInterval(timer);
        const now = this.now();
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(0, now + 0.15);
        for (const o of tones) o.stop(now + 0.2);
      },
    };
  }
}
