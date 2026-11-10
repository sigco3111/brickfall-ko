// The city's physics: every voxel a body in the GPU solver (../avbd3d/gpu), fixed until it's
// let loose. Fixed bodies cost next to nothing (they never pair with each other), so the whole
// city stands in the solver and only what's knocked loose is simulated. A blast pushes the
// loose bodies near it outward on the GPU, where their state lives.

import { B_ANGVEL, B_POS, B_ROT, B_SIZE, B_VEL, BODY_FLOATS } from 'three-avbd/advanced';
import { GpuSolver3D, gpuParams3D, REF_UP } from 'three-avbd/advanced';
import { Rigid } from 'three-avbd/advanced';
import { Solver } from 'three-avbd/advanced';
import { sphere } from 'three-avbd/advanced';
import { type City, Mat, State, VOXEL, voxelAt } from './world.ts';

/** Bodies kept spare for things thrown into the world. */
export const SPARE = 256;
/**
 * Bodies for sections falling whole (proxy): each carries its voxels as one box. At most 60 at once: the solver's
 * broadphase tests up to 64 large bodies against everything, and past that the largest left size its grid cells
 * (metres, not a voxel's), which made a demolition's collision detection some 20 times slower while they fell.
 */
export const PROXIES = 60;
/** Bodies the solver holds for `city`: the ground, a body per voxel, the spares, the sections'. */
export const bodyCapacity = (city: City): number => 1 + city.count + SPARE + PROXIES;
/** A section carried as one body: its voxels, their offsets from its centre, and how they bond when it breaks. */
export interface Section {
  slot: number;
  voxels: number[];
  offsets: Float32Array;
  bond: (v: number, u: number) => number;
  born: number;
  /** Its velocity at the last readback (m/s), for telling an impact. */
  velocity: [number, number, number];
  size: [number, number, number];
  /** Where it was at the last readback (centre xyz, quaternion xyzw). */
  pose: number[];
  /** Since when it has barely moved (s), for breaking a piece that stays whole too long. */
  slowSince?: number;
}
/** Where bodies out of play wait: far below, a few metres apart so no broadphase cell crowds. */
const PARKED_Z = -5000;
/**
 * How hard bonds hold (force or torque, N / N m, before they break): inside a fragment (a
 * piece falls whole, and cracks only on a hard landing), across the chunk seams inside a
 * fragment (where it cracks first), between fragments of a falling section (it comes apart
 * along them when it lands), and among rubble clumps.
 */
export const Bond = { Fragment: 6000 * VOXEL ** 2, Crack: 3600 * VOXEL ** 2, Seam: 1600 * VOXEL ** 2, Rubble: 1400 * VOXEL ** 2 } as const;
/** A voxel's size, as the solver takes it. */
const CUBE = [VOXEL, VOXEL, VOXEL];

/**
 * How a piece starts to move as it comes away: turning at `spin` (rad/s, world axis × rate)
 * about a pivot, so each point's velocity is `at(point)` (a tower cut through on one side
 * tips over its uncut side).
 */
export interface Motion {
  spin: number[];
  at: (p: ArrayLike<number>) => number[];
}

/** Turning at `spin` about `pivot`: v = spin × (p − pivot). */
export function turning(pivot: number[], spin: number[]): Motion {
  return {
    spin,
    at: (p) => {
      const r = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
      return [spin[1] * r[2] - spin[2] * r[1], spin[2] * r[0] - spin[0] * r[2], spin[0] * r[1] - spin[1] * r[0]];
    },
  };
}

/** Least share of its box a section must fill to fall as one (a wall with its windows is about half). */
const FILL = 0.4;

/** v rotated by the unit quaternion q (xyzw). */
function rotate(q: number[], v: number[]): number[] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

const DENSITY: Partial<Record<number, number>> = { [Mat.Glass]: 0.6, [Mat.LitGlass]: 0.6, [Mat.Steel]: 2.5, [Mat.Brick]: 1.6, [Mat.Leaf]: 0.3, [Mat.Wood]: 0.7, [Mat.Girder]: 7.8, [Mat.RCConcrete]: 2.4, [Mat.Plastic]: 0.9, [Mat.Dirt]: 1.5, [Mat.Rock]: 2.6 };
const density = (m: number) => DENSITY[m] ?? 1.8;

const blastWGSL = /* wgsl */ `
struct Blast { centre: vec4f, push: vec4f }  // centre xyz, radius; push: outward, lift, spin, body count
@group(0) @binding(0) var<uniform> blast: Blast;
@group(0) @binding(1) var<storage, read_write> bodies: array<vec4f>;

fn hash(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return f32((x >> 22u) ^ x) / 4294967295.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(blast.push.w)) { return; }
  let base = i * ${BODY_FLOATS / 4}u;
  if (bodies[base + ${B_SIZE / 4}u].w <= 0.0) { return; }
  let d = bodies[base + ${B_POS / 4}u].xyz - blast.centre.xyz;
  let dist = length(d);
  if (dist > blast.centre.w) { return; }
  // Falls off with distance; lighter pieces fly further
  let size = bodies[base + ${B_SIZE / 4}u];
  // A section falling whole (one box for a storey) takes the push its mass allows, not a brick's: its density
  // is spread over its box (mostly air), and it was being thrown like the lightest of bricks; houses flew.
  // Scaled down by how many voxels' worth it is (cube root: a blast's push is about its face, not its volume).
  let big = max(1.0, pow(size.x * size.y * size.z / ${(VOXEL ** 3).toFixed(6)}, 1.0 / 3.0));
  if (size.x * size.y * size.z > 2.0) { return; }
  let f = (1.0 - dist / blast.centre.w) / sqrt(max(size.w, 0.2)) / big;
  // Outwards, a little up (none in orbit, where there's no lift either: nothing to throw it up against)
  let up = select(0.0, 0.12, blast.push.y > 0.0);
  let dir = normalize(d + vec3f(0.0, 0.0, up * blast.centre.w) + vec3f(1e-4));
  // Raised to the blast's throw along it, not added to: blasts that overlap (charges going off
  // together) don't stack, and debris already flying faster keeps its speed
  var v = bodies[base + ${B_VEL / 4}u];
  var kick = (dir * blast.push.x + vec3f(0.0, 0.0, blast.push.y)) * f;
  // (Up no faster than this: debris thrown straight up under a falling storey carried the storey up with it)
  kick.z = min(kick.z, 3.5);
  let speed = length(kick);
  let along = kick / max(speed, 1e-6);
  v = vec4f(v.xyz + along * max(0.0, speed - dot(v.xyz, along)), v.w);
  bodies[base + ${B_VEL / 4}u] = v;
  let spin = vec3f(hash(i * 3u), hash(i * 3u + 1u), hash(i * 3u + 2u)) - 0.5;
  var w = bodies[base + ${B_ANGVEL / 4}u];
  bodies[base + ${B_ANGVEL / 4}u] = vec4f(w.xyz + spin * blast.push.z * f, w.w);
}
`;

/**
 * Water: buoyancy and drag for loose bodies in a box of sea (x0, y0, x1, y1) below `level` (m). Each body's
 * density is its mass over its box (Brickfall's densities are relative to water: timber 0.7 floats, brick 1.6
 * sinks); the share of it under the surface lifts it by g·share/density against the gravity the solver applies,
 * and water drags at its motion and its spin. Sections (whole storeys falling as one box) are left to sink and
 * shatter on the bottom.
 */
const waterWGSL = /* wgsl */ `
struct Water { box: vec4f, level: vec4f }  // box x0 y0 x1 y1; level: z, dt, body count, 0
@group(0) @binding(0) var<uniform> water: Water;
@group(0) @binding(1) var<storage, read_write> bodies: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(water.level.z)) { return; }
  let base = i * ${BODY_FLOATS / 4}u;
  let size = bodies[base + ${B_SIZE / 4}u];
  if (size.w <= 0.0) { return; }
  let vol = size.x * size.y * size.z;
  if (vol > 2.0) { return; }
  let p = bodies[base + ${B_POS / 4}u].xyz;
  if (p.x < water.box.x || p.x > water.box.z || p.y < water.box.y || p.y > water.box.w) { return; }
  let h = max(size.z, 0.05);
  let s = clamp((water.level.x - (p.z - h * 0.5)) / h, 0.0, 1.0);
  if (s <= 0.0) { return; }
  let rho = max(size.w / max(vol, 1e-6), 0.05);
  let dt = water.level.y;
  var v = bodies[base + ${B_VEL / 4}u];
  let drag = exp(-2.5 * dt * s);
  v = vec4f(v.xy * drag, v.z * drag + s * 9.81 * dt / rho, v.w);
  bodies[base + ${B_VEL / 4}u] = v;
  let w = bodies[base + ${B_ANGVEL / 4}u];
  bodies[base + ${B_ANGVEL / 4}u] = vec4f(w.xyz * exp(-3.0 * dt * s), w.w);
}
`;

const gatherWGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> which: array<u32>;
@group(0) @binding(1) var<storage, read> bodies: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> out: array<vec4f>;
@group(0) @binding(3) var<uniform> count: vec4u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let k = gid.x;
  if (k >= count.x) { return; }
  let base = which[k] * ${BODY_FLOATS / 4}u;
  out[3u * k] = bodies[base + ${B_POS / 4}u];
  out[3u * k + 1u] = bodies[base + ${B_VEL / 4}u];
  out[3u * k + 2u] = bodies[base + ${B_ROT / 4}u];
}
`;

export class CityPhysics {
  readonly solver: GpuSolver3D;
  /** Voxel → GPU body, and back (-1: the ground or a spare). */
  readonly body: Int32Array;
  readonly voxelOf: Int32Array;
  /** Spare bodies' GPU indices (thrown balls, oldest reused first). */
  readonly spares: number[] = [];
  /** Sections falling whole, and the bodies free for more. */
  readonly sections = new Map<number, Section>();
  /** How many sections each slot has carried (tests: a slot's new section isn't the old one moved). */
  readonly generation = new Map<number, number>();
  private readonly freeSlots: number[] = [];
  /** Told when voxels are carried by a section's body, or let go (parent -1): the renderer draws them there. */
  onCarry: (bodies: number[], parent: number, offsets?: Float32Array) => void = () => {};
  private nextSpare = 0;
  private readonly scratch = new Solver();
  private readonly blastPipe: GPUComputePipeline;
  private readonly blastGroup: GPUBindGroup;
  private readonly blastParams: GPUBuffer;
  loose = 0;
  /** Loose voxels, in the order they came loose (some since gone or at rest), for readLoose. */
  private looseList: number[] = [];
  /** Each loose voxel's joints (slots), and each joint's voxels: released when either comes to rest or goes. */
  private readonly joints = new Map<number, Set<number>>();
  private readonly jointVoxels = new Map<number, [number, number]>();
  /** Rubble at rest: where it lies (xyz, quaternion xyzw) per voxel, and the list of it. */
  readonly rest: Float32Array;
  rubble = new Set<number>();
  /**
   * Columns (x0, y0, x1, y1 m) where something changed under the rubble since the last settle:
   * blasts, sections breaking up, rubble waking. Settle checks only the rubble standing in them
   * (the rest was held before and nothing moved under it). Added for Brickfall: a tower's
   * collapse leaves tens of thousands of rubble voxels, and checking them all every half second
   * cost 30 to 60 ms a time.
   */
  dirty: number[] = [];
  /** Rubble left over from the last settle (past SETTLE_MAX), checked next time. */
  private settleLater: number[] = [];
  /** Rubble by cell (a voxel's size) and by 1 m column, kept as it settles and wakes. */
  private readonly cellIndex = new Map<number, number[]>();
  private readonly colIndex = new Map<number, Set<number>>();
  /** Rubble lying more than 2.5 m up: every settle checks it, wherever things changed (nothing hangs in the air). */
  private readonly high = new Set<number>();
  private static cellKey(x: number, y: number, z: number): number {
    const h = VOXEL;
    return (Math.floor(x / h) + 4096) * 67108864 + (Math.floor(y / h) + 4096) * 8192 + (Math.floor(z / h) + 64);
  }
  private static colKey(x: number, y: number): number {
    return (Math.floor(x) + 4096) * 8192 + (Math.floor(y) + 4096);
  }
  private index(v: number): void {
    const o = 7 * v;
    const k = CityPhysics.cellKey(this.rest[o], this.rest[o + 1], this.rest[o + 2]);
    const cell = this.cellIndex.get(k);
    if (cell) cell.push(v);
    else this.cellIndex.set(k, [v]);
    const c = CityPhysics.colKey(this.rest[o], this.rest[o + 1]);
    const col = this.colIndex.get(c);
    if (col) col.add(v);
    else this.colIndex.set(c, new Set([v]));
    if (this.rest[o + 2] > 2.5) this.high.add(v);
  }
  private unindex(v: number): void {
    const o = 7 * v;
    const k = CityPhysics.cellKey(this.rest[o], this.rest[o + 1], this.rest[o + 2]);
    const cell = this.cellIndex.get(k);
    if (cell) {
      const i = cell.indexOf(v);
      if (i >= 0) cell.splice(i, 1);
      if (!cell.length) this.cellIndex.delete(k);
    }
    const c = CityPhysics.colKey(this.rest[o], this.rest[o + 1]);
    const col = this.colIndex.get(c);
    if (col) {
      col.delete(v);
      if (!col.size) this.colIndex.delete(c);
    }
    this.high.delete(v);
  }
  private markColumn(x: number, y: number, r: number): void {
    this.dirty.push(x - r, y - r, x + r, y + r);
  }
  private gather: { pipe: GPUComputePipeline; which: GPUBuffer; out: GPUBuffer; staging: GPUBuffer; count: GPUBuffer; capacity: number; group: GPUBindGroup } | null = null;
  private readonly bodyBuffer: GPUBuffer;

  private readonly device: GPUDevice;
  private readonly city: City;

  constructor(device: GPUDevice, city: City, bodyBuffer: GPUBuffer) {
    this.device = device;
    this.city = city;
    this.bodyBuffer = bodyBuffer;
    this.rest = new Float32Array(city.count * 7);
    const ref = new Solver();
    // The ground (body 0): in orbit there's none, so it waits far off, out of everything's way
    new Rigid(ref, [4000, 4000, 20], 0, 0.8, city.weightless ? [0, 0, -60000] : [0, 0, -10]);
    for (let v = 0; v < city.count; v++) new Rigid(ref, CUBE, 0, 0.7, city.position.subarray(3 * v, 3 * v + 3));
    // Spares wait parked, fixed
    for (let k = 0; k < SPARE + PROXIES; k++) new Rigid(ref, CUBE, 0, 0.7, parked(city.count + k));
    this.solver = new GpuSolver3D(device, ref, {
      bodyBuffer,
      bodyCapacity: ref.bodies.length,
      capacity: { pairs: 8 * 65536, manifolds: 8 * 65536, contacts: 24 * 65536, colors: 32, joints: 2 * 65536 },
    });
    Object.assign(this.solver.params, gpuParams3D(), { dt: 1 / 60, iterations: 6, gravity: city.weightless ? 0 : -9.81, up: REF_UP });
    this.body = new Int32Array(city.count);
    this.voxelOf = new Int32Array(ref.bodies.length).fill(-1);
    for (let v = 0; v < city.count; v++) {
      this.body[v] = this.solver.gpuIndex(v + 1);
      this.voxelOf[this.body[v]] = v;
    }
    for (let k = 0; k < SPARE; k++) this.spares.push(this.solver.gpuIndex(city.count + 1 + k));
    for (let k = 0; k < PROXIES; k++) this.freeSlots.push(this.solver.gpuIndex(city.count + 1 + SPARE + k));

    this.blastParams = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const module = device.createShaderModule({ code: blastWGSL });
    this.blastPipe = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    this.blastGroup = device.createBindGroup({
      layout: this.blastPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.blastParams } },
        { binding: 1, resource: { buffer: bodyBuffer } },
      ],
    });
  }

  get bodyCount(): number {
    return this.solver.bodyCount;
  }

  /** The sea, if the lot has one: its box (x0, y0, x1, y1, m) and surface (m). */
  water: { box: [number, number, number, number]; level: number } | null = null;
  private waterPipe: GPUComputePipeline | null = null;
  private waterGroup: GPUBindGroup | null = null;
  private waterParams: GPUBuffer | null = null;
  setWater(box: [number, number, number, number], level: number): void {
    this.water = { box, level };
    if (!this.waterPipe) {
      const d = this.device;
      this.waterParams = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.waterPipe = d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code: waterWGSL }), entryPoint: 'main' } });
      this.waterGroup = d.createBindGroup({
        layout: this.waterPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.waterParams } },
          { binding: 1, resource: { buffer: this.bodyBuffer } },
        ],
      });
    }
  }
  /** Whether a point is under the sea's surface. */
  inWater(x: number, y: number, z: number): boolean {
    const w = this.water;
    return !!w && z < w.level && x > w.box[0] && x < w.box[2] && y > w.box[1] && y < w.box[3];
  }

  step(): void {
    this.solver.step();
    if (this.water && this.waterPipe && this.loose + this.sections.size > 0) {
      const w = this.water;
      this.device.queue.writeBuffer(this.waterParams as GPUBuffer, 0, new Float32Array([...w.box, w.level, 1 / 60, this.solver.bodyCount, 0]));
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.waterPipe);
      pass.setBindGroup(0, this.waterGroup as GPUBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.solver.bodyCount / 64));
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
  }

  /**
   * Let fixed voxels loose. With `bond`, face neighbours among them are held together by
   * joints of the strength it gives each pair (0: none), so a section falls whole and breaks
   * along its weak seams when it lands.
   */
  loosen(voxels: number[], bond?: (v: number, u: number) => number, motion?: Motion): void {
    if (!voxels.length) return;
    const { city } = this;
    const order = voxels.filter((v) => city.state[v] === State.Fixed).sort((a, b) => this.body[a] - this.body[b]);
    if (!order.length) return;
    const bodies = order.map((v) => {
      city.state[v] = State.Loose;
      const at = city.position.subarray(3 * v, 3 * v + 3);
      const body = new Rigid(this.scratch, CUBE, density(city.material[v]), 0.7, at);
      if (motion) {
        body.velocityLin.set(motion.at(at));
        body.velocityAng.set(motion.spin);
      }
      return body;
    });
    this.solver.rewriteBodies(
      order.map((v) => this.body[v]),
      bodies,
    );
    this.scratch.clear();
    this.loose += order.length;
    this.looseList.push(...order);
    if (bond) this.join(order, bond);
  }

  /** Joints between face neighbours among `voxels` (all just let loose, so still unturned). */
  private join(voxels: number[], bond: (v: number, u: number) => number): void {
    const { city } = this;
    const inSet = new Set(voxels);
    const lists = new Map<number, { a: number; b: number; rA: number[]; rB: number[] }[]>();
    for (const v of voxels) {
      const b = city.buildings[city.building[v]];
      const c = city.cell[v];
      const [x, y] = [c % b.w, Math.floor(c / b.w) % b.d];
      const z = Math.floor(c / (b.w * b.d));
      const neighbours: [number, number[]][] = [];
      const h = VOXEL / 2;
      if (x + 1 < b.w) neighbours.push([c + 1, [h, 0, 0]]);
      if (y + 1 < b.d) neighbours.push([c + b.w, [0, h, 0]]);
      if (z + 1 < b.h) neighbours.push([c + b.w * b.d, [0, 0, h]]);
      for (const [n, r] of neighbours) {
        const u = b.cells[n];
        if (u < 0 || !inSet.has(u)) continue;
        const strength = bond(v, u);
        if (strength <= 0) continue;
        let list = lists.get(strength);
        if (!list) lists.set(strength, (list = []));
        list.push({ a: this.body[v], b: this.body[u], rA: r, rB: r.map((s) => -s) });
      }
    }
    for (const [strength, list] of lists) {
      const slots = this.solver.appendJoints(list, strength, true);
      list.forEach((j, n) => {
        const pair: [number, number] = [this.voxelOf[j.a], this.voxelOf[j.b]];
        this.jointVoxels.set(slots[n], pair);
        for (const v of pair) {
          let mine = this.joints.get(v);
          if (!mine) this.joints.set(v, (mine = new Set()));
          mine.add(slots[n]);
        }
      });
    }
  }

  /** Release the joints of these voxels (their partners' too), so the solver can reuse the slots. */
  private unjoin(voxels: number[]): void {
    const slots: number[] = [];
    for (const v of voxels) {
      const mine = this.joints.get(v);
      if (!mine) continue;
      for (const slot of mine) {
        slots.push(slot);
        const pair = this.jointVoxels.get(slot);
        this.jointVoxels.delete(slot);
        for (const u of pair ?? []) if (u !== v) this.joints.get(u)?.delete(slot);
      }
      this.joints.delete(v);
    }
    if (slots.length) this.solver.releaseJoints(slots);
  }

  /**
   * Loose voxels come to rest: fixed where they lie (`poses`: xyz and quaternion per voxel),
   * their joints switched off, so a settled heap costs next to nothing. Blasts wake them.
   */
  freeze(voxels: number[], poses: Float32Array): void {
    const { city } = this;
    const keep = voxels.map((v, k) => [v, k]).filter(([v]) => city.state[v] === State.Loose);
    if (!keep.length) return;
    this.unjoin(keep.map(([v]) => v));
    const at = new Float32Array(keep.length * 7);
    keep.forEach(([, k], i) => at.set(poses.subarray(7 * k, 7 * k + 7), 7 * i));
    this.settleAt(
      keep.map(([v]) => v),
      at,
    );
    this.loose -= keep.length;
    this.looseList = this.looseList.filter((v) => city.state[v] === State.Loose);
  }

  /**
   * Break the bonds of these loose voxels (Brickfall): a falling piece that lands on its own loose, still-bonded
   * stilts (a water tower's legs under its tank) stood on them; snapped, they give way and it comes down.
   */
  snap(voxels: number[]): void {
    const loose = voxels.filter((v) => this.city.state[v] === State.Loose);
    if (loose.length) this.unjoin(loose);
  }

  /** Rubble within `radius` of `at` wakes: loose again where it lay (a blast is coming). */
  wake(at: ArrayLike<number>, radius: number): void {
    this.wakeVoxels(
      [...this.rubble].filter((v) => {
        const o = 7 * v;
        return (this.rest[o] - at[0]) ** 2 + (this.rest[o + 1] - at[1]) ** 2 + (this.rest[o + 2] - at[2]) ** 2 < radius * radius;
      }),
    );
  }

  /**
   * Rubble with nothing left to rest on wakes and falls. Rubble is frozen where it came to
   * rest, and nothing else moves it: when what it lay on fell or was blown away (a floor
   * collapsing under a heap), it hung in the air. Rubble is held by the ground, by a fixed
   * voxel under it or beside it (leaning), or by held rubble under it; taken bottom up, so a
   * heap is held from its base. Loose voxels at `supports` (xyz triples: debris still loose,
   * but lying still) hold rubble too, or rubble on them would wake and refreeze over and over.
   * Returns how many woke.
   */
  settle(supports: ArrayLike<number> = [], full = false): number {
    const { city } = this;
    const dirty = this.dirty;
    this.dirty = [];
    if (!this.rubble.size || (!full && !dirty.length && !this.settleLater.length && !this.high.size)) return 0;
    const h = VOXEL;
    const cellKey = CityPhysics.cellKey;
    const byCell = this.cellIndex;
    // Only rubble in a changed column is checked; rubble round it counts as held, as it was
    let list: number[];
    let checked: Set<number> | null = null;
    if (full) list = [...this.rubble];
    else {
      checked = new Set<number>();
      for (let k = 0; k < dirty.length; k += 4)
        for (let cx = Math.floor(dirty[k]); cx <= Math.floor(dirty[k + 2]); cx++)
          for (let cy = Math.floor(dirty[k + 1]); cy <= Math.floor(dirty[k + 3]); cy++) {
            const col = this.colIndex.get((cx + 4096) * 8192 + (cy + 4096));
            if (col) for (const v of col) checked.add(v);
          }
      for (const v of this.settleLater) if (this.rubble.has(v)) checked.add(v);
      // (High rubble isn't re-checked every pass any more: it was, bottom first, and the pass cut off at
      // SETTLE_MAX, so a tower's worth above was never reached. hovering() holds the line for all of it)
      list = [...checked];
    }
    this.settleLater = [];
    let inList = checked;
    const isHeld = (u: number) => held.has(u) || (inList !== null && !inList.has(u));
    list.sort((a, b) => this.rest[7 * a + 2] - this.rest[7 * b + 2]);
    // At most a few thousand a time, bottom up: the rest wait for the next settle (a collapse's
    // whole heap at once was a 40 ms stall)
    if (list.length > SETTLE_MAX) {
      this.settleLater = list.slice(SETTLE_MAX);
      list = list.slice(0, SETTLE_MAX);
      checked = new Set(list);
      inList = checked;
    }
    const held = new Set<number>();
    const looseAt = new Set<number>();
    for (let k = 0; k + 2 < supports.length; k += 3) looseAt.add(cellKey(supports[k], supports[k + 1], supports[k + 2]));
    const fixedNear = (x: number, y: number, z: number) => voxelAt(city, x, y, z) >= 0;
    // A falling section's box (where it was last read back) holds what lies on it
    const boxes = [...this.sections.values()].map((sec) => ({ c: sec.pose.slice(0, 3), q: sec.pose.slice(3, 7), half: sec.size.map((s) => s / 2 + h) }));
    const onSection = (x: number, y: number, z: number) =>
      boxes.some(({ c, q, half }) => {
        const l = rotate([-q[0], -q[1], -q[2], q[3]], [x - c[0], y - c[1], z - c[2]]);
        return Math.abs(l[0]) <= half[0] && Math.abs(l[1]) <= half[1] && Math.abs(l[2]) <= half[2];
      });
    const unheld: number[] = [];
    for (const v of list) {
      const o = 7 * v;
      const [x, y, z] = [this.rest[o], this.rest[o + 1], this.rest[o + 2]];
      // The common cases first, a lookup each: on the ground, on loose debris, on a fixed
      // voxel straight below, on held rubble straight below
      let ok = z < h * 1.2 || looseAt.has(cellKey(x, y, z - h)) || fixedNear(x, y, z - h * 0.9) || onSection(x, y, z - h);
      if (!ok) {
        const below = byCell.get(cellKey(x, y, z - h));
        if (below) for (const u of below) if (isHeld(u)) ok = true;
      }
      // Then a fixed voxel under it or leaning against it
      for (let k = 0; !ok && k < 9; k++) {
        const [dx, dy] = [((k % 3) - 1) * 0.6 * h, (Math.floor(k / 3) - 1) * 0.6 * h];
        ok = fixedNear(x + dx, y + dy, z - h * 0.9) || (k !== 4 && fixedNear(x + dx * 1.5, y + dy * 1.5, z));
      }
      // Held rubble just under it (within a voxel and a half, down to a voxel and a half below)
      for (let k = 0; !ok && k < 27; k++) {
        const [cx, cy, cz] = [(k % 3) - 1, (Math.floor(k / 3) % 3) - 1, -Math.floor(k / 9)];
        const near = byCell.get(cellKey(x + cx * h, y + cy * h, z + (cz - 1) * h + h * 0.5));
        if (!near) continue;
        for (const u of near) {
          if (u === v || !isHeld(u)) continue;
          const q = 7 * u;
          const dz = z - this.rest[q + 2];
          if (dz > 0.05 * h && dz < 1.6 * h && Math.hypot(x - this.rest[q], y - this.rest[q + 1]) < 1.4 * h) {
            ok = true;
            break;
          }
        }
      }
      if (ok) held.add(v);
      else unheld.push(v);
    }
    this.wakeVoxels(unheld);
    return unheld.length;
  }

  /**
   * Rubble with nothing under it, however much of it there is (Brickfall 1.2's hard rule: nothing hovers). The
   * rubble is laid on a grid of voxel-sized cells and flooded up from the cells that touch the ground or rest on
   * (or against) something fixed, through every cell touching another (26 neighbours). What the flood doesn't
   * reach hangs in the air: returned as its connected masses, each a list of voxels.
   *
   * Settle's local checks (a voxel at a time, a few thousand a pass, bottom first) missed it: a whole storey
   * laid down as rubble high up where its section came to rest kept being re-checked bottom first and cut off
   * after 3,500, so the rubble above never was, and what woke was peeled off the bottom a layer a pass.
   */
  hovering(stillLoose: ArrayLike<number> = []): number[][] {
    const { city } = this;
    if (!this.rubble.size) return [];
    // Half-metre cells: a coarse grid floods fast (a tower's rubble is 50,000 voxels), and two pieces within a
    // cell of each other count as touching
    const h = 0.5;
    const T0 = performance.now();
    const list = Array.from(this.rubble);
    const m = list.length;
    const cx = new Int32Array(m);
    const cy = new Int32Array(m);
    const cz = new Int32Array(m);
    let [x0, y0, z0, x1, y1, z1] = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    const rest = this.rest;
    // The grid spans 80 m round the rubble's middle and 60 m up at most (a stray voxel flung across the city
    // made it 130 million cells): anything outside is on the ground out there, and counts as held
    let [mx, my] = [0, 0];
    for (let i = 0; i < m; i++) {
      mx += rest[7 * list[i]] / m;
      my += rest[7 * list[i] + 1] / m;
    }
    const [lox, hix, loy, hiy] = [Math.floor((mx - 40) / h), Math.floor((mx + 40) / h), Math.floor((my - 40) / h), Math.floor((my + 40) / h)];
    const [loz, hiz] = [-2, Math.floor(60 / h)];
    const out = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      const o = 7 * list[i];
      const x = Math.floor(rest[o] / h);
      const y = Math.floor(rest[o + 1] / h);
      const z = Math.floor(rest[o + 2] / h);
      cx[i] = x;
      cy[i] = y;
      cz[i] = z;
      if (x < lox || x > hix || y < loy || y > hiy || z < loz || z > hiz) {
        out[i] = 1;
        continue;
      }
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
    }
    // One cell of margin all round, so a neighbour's index never wraps
    x0--;
    y0--;
    z0--;
    const [nx, ny, nz] = [x1 - x0 + 2, y1 - y0 + 2, z1 - z0 + 2];
    const n = nx * ny * nz;
    const layer = nx * ny;
    if (!this.hoverGrid || this.hoverGrid.length < n) this.hoverGrid = new Uint8Array(Math.ceil(n * 1.25));
    const grid = this.hoverGrid;
    grid.fill(0, 0, n);
    const cell = new Int32Array(m);
    let occupied = 0;
    for (let i = 0; i < m; i++) {
      if (out[i]) {
        cell[i] = 0;
        continue;
      }
      const c = cx[i] - x0 + nx * (cy[i] - y0 + ny * (cz[i] - z0));
      cell[i] = c;
      if (grid[c] === 0) {
        grid[c] = 1;
        occupied++;
      }
    }
    const T1 = performance.now();
    const fixedAt = (x: number, y: number, z: number) => voxelAt(city, x, y, z) >= 0;
    // Loose debris lying still holds what's on it too (it is about to be rubble itself)
    const cellKey2 = (x: number, y: number, z: number) => (Math.floor(x / h) + 2048) * 4194304 + (Math.floor(y / h) + 2048) * 1024 + Math.max(0, Math.floor(z / h) + 8);
    const stillAt = new Set<number>();
    for (let k = 0; k + 2 < stillLoose.length; k += 3) stillAt.add(cellKey2(stillLoose[k], stillLoose[k + 1], stillLoose[k + 2]));
    const queue = new Int32Array(occupied + 1);
    let tail = 0;
    const v4 = VOXEL;
    for (let i = 0; i < m; i++) {
      if (out[i]) continue;
      const c = cell[i];
      if (grid[c] !== 1) continue;
      // Only the bottom of a stack needs looking at: what lies on rubble is held if that is
      if (grid[c - layer] !== 0) continue;
      const o = 7 * list[i];
      const [x, y, z] = [rest[o], rest[o + 1], rest[o + 2]];
      const held =
        z < v4 * 1.3 ||
        fixedAt(x, y, z - v4 * 0.9) ||
        fixedAt(x + 0.8 * v4, y, z) ||
        fixedAt(x - 0.8 * v4, y, z) ||
        fixedAt(x, y + 0.8 * v4, z) ||
        fixedAt(x, y - 0.8 * v4, z) ||
        fixedAt(x, y, z - h) ||
        // (Resting on an edge or a corner of what stands below: half a voxel off diagonally is still on it)
        fixedAt(x + 0.5 * v4, y + 0.5 * v4, z - v4 * 0.9) ||
        fixedAt(x - 0.5 * v4, y + 0.5 * v4, z - v4 * 0.9) ||
        fixedAt(x + 0.5 * v4, y - 0.5 * v4, z - v4 * 0.9) ||
        fixedAt(x - 0.5 * v4, y - 0.5 * v4, z - v4 * 0.9) ||
        stillAt.has(cellKey2(x, y, z - h * 0.6)) ||
        (this.sections.size > 0 && this.inSection(x, y, z - v4)) ||
        (this.solidAt?.(x, y, z - v4) ?? false) ||
        // (Afloat: the sea holds what floats on it, and what sinks lands on the bottom)
        this.inWater(x, y, z - v4);
      if (held) {
        grid[c] = 2;
        queue[tail++] = c;
      }
    }
    const T2 = performance.now();
    const seeds = tail;
    for (let head = 0; head < tail; head++) {
      const c = queue[head];
      for (let dz = -layer; dz <= layer; dz += layer)
        for (let dy = -nx; dy <= nx; dy += nx)
          for (let dx = -1; dx <= 1; dx++) {
            const q = c + dx + dy + dz;
            if (grid[q] === 1) {
              grid[q] = 2;
              queue[tail++] = q;
            }
          }
    }
    const T3 = performance.now();
    this.hoverProf = { list: m, cells: n, occupied, seeds, setup: +(T1 - T0).toFixed(2), seed: +(T2 - T1).toFixed(2), flood: +(T3 - T2).toFixed(2) };
    // (The usual case: everything reached)
    if (tail === occupied) return [];
    // What wasn't reached, as connected masses (3 marks a cell of one already gathered)
    const byCell = new Map<number, number[]>();
    for (let i = 0; i < m; i++) {
      if (out[i]) continue;
      const c = cell[i];
      if (grid[c] !== 1) continue;
      const l = byCell.get(c);
      if (l) l.push(list[i]);
      else byCell.set(c, [list[i]]);
    }
    const masses: number[][] = [];
    for (const start of byCell.keys()) {
      if (grid[start] !== 1) continue;
      grid[start] = 3;
      const cells = [start];
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k];
        for (let dz = -layer; dz <= layer; dz += layer)
          for (let dy = -nx; dy <= nx; dy += nx)
            for (let dx = -1; dx <= 1; dx++) {
              const q = c + dx + dy + dz;
              if (grid[q] === 1) {
                grid[q] = 3;
                cells.push(q);
              }
            }
      }
      masses.push(cells.flatMap((c) => byCell.get(c) ?? []));
    }
    return masses;
  }
  private hoverGrid: Uint8Array | null = null;
  hoverProf: Record<string, number> = {};

  /**
   * A mass of rubble with nothing under it falls as one body, as a cut-off storey does (proxy): a box round it in
   * its own frame (the first voxel's turn: a storey laid down whole kept its section's), its voxels carried on
   * it. False if it won't do as a box (too small, no free body, or the box would start inside rubble or anything
   * fixed that isn't its own): wake it then, a voxel at a time.
   */
  dropRubble(voxels: number[], bond: (v: number, u: number) => number, now = performance.now() / 1000): boolean {
    const { city } = this;
    if (voxels.length < 8 || !this.freeSlots.length) return false;
    const h = VOXEL / 2;
    const v0 = voxels[0];
    const q = [this.rest[7 * v0 + 3], this.rest[7 * v0 + 4], this.rest[7 * v0 + 5], this.rest[7 * v0 + 6]];
    const qi = [-q[0], -q[1], -q[2], q[3]];
    const local = new Float32Array(voxels.length * 3);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    voxels.forEach((v, k) => {
      const l = rotate(qi, [this.rest[7 * v], this.rest[7 * v + 1], this.rest[7 * v + 2]]);
      for (let a = 0; a < 3; a++) {
        local[3 * k + a] = l[a];
        lo[a] = Math.min(lo[a], l[a] - h);
        hi[a] = Math.max(hi[a], l[a] + h);
      }
    });
    const size: [number, number, number] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const centre = rotate(q, mid);
    // The box mustn't start inside anything: sample it (a point a voxel apart) for fixed voxels and other rubble
    const own = new Set(voxels);
    const step = VOXEL;
    let blocked = 0;
    let samples = 0;
    for (let x = lo[0] + h; x < hi[0]; x += step)
      for (let y = lo[1] + h; y < hi[1]; y += step)
        for (let z = lo[2] + h; z < hi[2]; z += step) {
          samples++;
          const p = rotate(q, [x, y, z]);
          if (voxelAt(city, p[0], p[1], p[2]) >= 0) blocked++;
          else {
            const other = this.cellIndex.get(CityPhysics.cellKey(p[0], p[1], p[2]));
            if (other?.some((u) => !own.has(u))) blocked++;
          }
        }
    if (blocked > samples * 0.01 + 2) return false;
    const slot = this.freeSlots.pop()!;
    let mass = 0;
    for (const v of voxels) mass += density(city.material[v]);
    const volume = size[0] * size[1] * size[2];
    const box = new Rigid(this.scratch, size.map((s) => s - 0.02) as [number, number, number], (mass * VOXEL ** 3) / volume, 0.7, centre);
    box.positionAng.set(q);
    this.solver.rewriteBodies([slot], [box]);
    this.scratch.clear();
    const offsets = new Float32Array(voxels.length * 3);
    voxels.forEach((_, k) => {
      for (let a = 0; a < 3; a++) offsets[3 * k + a] = local[3 * k + a] - mid[a];
    });
    this.markColumn(centre[0], centre[1], Math.max(...size) / 2 + 1);
    this.park(voxels, State.Carried);
    this.onCarry(
      voxels.map((v) => this.body[v]),
      slot,
      offsets,
    );
    this.generation.set(slot, (this.generation.get(slot) ?? 0) + 1);
    this.sections.set(slot, { slot, voxels, offsets, bond, born: now, velocity: [0, 0, 0], size, pose: [...centre, q[0], q[1], q[2], q[3]] });
    return true;
  }

  /** Fixed voxels moved (the sandbox's spawn menu): their bodies to their new places in city.position. */
  moveFixed(voxels: number[]): void {
    const { city } = this;
    const order = voxels.filter((v) => city.state[v] === State.Fixed).sort((a, b) => this.body[a] - this.body[b]);
    if (!order.length) return;
    const at = new Float32Array(order.length * 3);
    order.forEach((v, k) => at.set(city.position.subarray(3 * v, 3 * v + 3), 3 * k));
    this.solver.rewriteFixed(
      order.map((v) => this.body[v]),
      at,
      CUBE,
      0.7,
    );
  }

  /** Debugging: what holds rubble voxel `v` in settle's eyes (and the voxel straight below it). */
  whyHeld(v: number): Record<string, unknown> {
    const { city } = this;
    const h = VOXEL;
    const o = 7 * v;
    const [x, y, z] = [this.rest[o], this.rest[o + 1], this.rest[o + 2]];
    const fixedBelow = voxelAt(city, x, y, z - h * 0.9);
    const beside: number[][] = [];
    for (let k = 0; k < 9; k++) {
      const [dx, dy] = [((k % 3) - 1) * 0.6 * h, (Math.floor(k / 3) - 1) * 0.6 * h];
      const a = voxelAt(city, x + dx, y + dy, z - h * 0.9);
      const b = k !== 4 ? voxelAt(city, x + dx * 1.5, y + dy * 1.5, z) : -1;
      if (a >= 0 || b >= 0) beside.push([k, a, b, a >= 0 ? city.state[a] : -1, b >= 0 ? city.state[b] : -1]);
    }
    const below = this.cellIndex.get(CityPhysics.cellKey(x, y, z - h)) ?? [];
    return { at: [x, y, z], state: city.state[v], high: this.high.has(v), fixedBelow, beside, below: below.map((u) => [u, city.state[u], +this.rest[7 * u + 2].toFixed(2)]), sections: this.sections.size, settleLater: this.settleLater.length, dirty: this.dirty.length };
  }

  /** Rubble woken and bonded to itself again (`bond`, default rubble's): a hanging slab falls as a slab. */
  wakeBonded(voxels: number[], bond: (v: number, u: number) => number = () => Bond.Rubble): void {
    const woken = voxels.filter((v) => this.city.state[v] === State.Rubble);
    this.wakeVoxels(woken);
    // (Only neighbours as built that still lie side by side: rubble from different pieces mustn't be pulled together)
    const near = (v: number, u: number) => (this.rest[7 * v] - this.rest[7 * u]) ** 2 + (this.rest[7 * v + 1] - this.rest[7 * u + 1]) ** 2 + (this.rest[7 * v + 2] - this.rest[7 * u + 2]) ** 2 < (1.3 * VOXEL) ** 2;
    if (woken.length > 1) this.join(woken, (v, u) => (near(v, u) ? bond(v, u) : 0));
  }

  /** These rubble voxels wake: loose again where they lay. */
  wakeVoxels(voxels: number[]): void {
    const { city } = this;
    const woken = voxels.filter((v) => city.state[v] === State.Rubble);
    if (!woken.length) return;
    for (const v of woken) if (Math.random() < 0.15 || woken.length < 40) this.markColumn(this.rest[7 * v], this.rest[7 * v + 1], 1.2);
    woken.sort((a, b) => this.body[a] - this.body[b]);
    const bodies = woken.map((v) => {
      city.state[v] = State.Loose;
      if (this.rubble.has(v)) this.unindex(v);

      this.rubble.delete(v);
      const r = new Rigid(this.scratch, CUBE, density(city.material[v]), 0.7, this.rest.subarray(7 * v, 7 * v + 3));
      r.positionAng.set(this.rest.subarray(7 * v + 3, 7 * v + 7));
      return r;
    });
    this.solver.rewriteBodies(
      woken.map((v) => this.body[v]),
      bodies,
    );
    this.scratch.clear();
    this.loose += woken.length;
    this.looseList.push(...woken);
  }

  /**
   * Carry `voxels` (fixed, just cut off) as one rigid box falling whole, rather than a body
   * each: a tower's falling storeys are tens of thousands of voxels, far past what can be
   * simulated a voxel at a time. Only sections filling at least `fill` of their box (a storey
   * of a hollow building is mostly air, and falls well enough as a box) with nothing fixed
   * inside their box qualify, so the box doesn't start inside what still stands. `bond`: how its voxels bond when it breaks (shatter). False if it didn't qualify
   * or no body was free: the caller lets the voxels loose instead.
   */
  proxy(voxels: number[], bond: (v: number, u: number) => number, now = performance.now() / 1000, fill = FILL, motion?: Motion): boolean {
    const { city } = this;
    if (voxels.length < 8 || !this.freeSlots.length) return false;
    const h = VOXEL / 2;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const inside = new Set(voxels);
    for (const v of voxels) {
      if (city.state[v] !== State.Fixed) return false;
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], city.position[3 * v + a] - h);
        hi[a] = Math.max(hi[a], city.position[3 * v + a] + h);
      }
    }
    const size: [number, number, number] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const cells = (size[0] / VOXEL) * (size[1] / VOXEL) * (size[2] / VOXEL);
    if (voxels.length / cells < fill) return false;
    // Nothing fixed inside the box (its own voxels aside), read straight off its object's grid
    const b = city.buildings[city.building[voxels[0]]];
    const cell = (m: number) => Math.floor(m / VOXEL + 1e-4);
    const [x0, x1] = [Math.max(0, cell(lo[0] + h) - b.x0), Math.min(b.w - 1, cell(hi[0] - h) - b.x0)];
    const [y0, y1] = [Math.max(0, cell(lo[1] + h) - b.y0), Math.min(b.d - 1, cell(hi[1] - h) - b.y0)];
    const [z0, z1] = [Math.max(0, cell(lo[2] + h)), Math.min(b.h - 1, cell(hi[2] - h))];
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const u = b.cells[x + b.w * (y + b.d * z)];
          if (u >= 0 && city.state[u] === State.Fixed && !inside.has(u)) return false;
        }
    const slot = this.freeSlots.pop()!;
    const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    let mass = 0;
    for (const v of voxels) mass += density(city.material[v]);
    const volume = size[0] * size[1] * size[2];
    // The box a hair smaller than the voxels, so it starts clear of what it was cut from
    const box = new Rigid(this.scratch, size.map((s) => s - 0.02) as [number, number, number], (mass * VOXEL ** 3) / volume, 0.7, centre);
    if (motion) {
      box.velocityLin.set(motion.at(centre));
      box.velocityAng.set(motion.spin);
    }
    this.solver.rewriteBodies([slot], [box]);
    this.scratch.clear();
    const offsets = new Float32Array(voxels.length * 3);
    voxels.forEach((v, k) => {
      for (let a = 0; a < 3; a++) offsets[3 * k + a] = city.position[3 * v + a] - centre[a];
    });
    // Its voxels' own bodies wait parked; they're drawn on the box
    this.park(voxels, State.Carried);
    this.onCarry(
      voxels.map((v) => this.body[v]),
      slot,
      offsets,
    );
    this.generation.set(slot, (this.generation.get(slot) ?? 0) + 1);
    this.sections.set(slot, { slot, voxels, offsets, bond, born: now, velocity: [0, 0, 0], size, pose: [...centre, 0, 0, 0, 1] });
    return true;
  }

  /** Whether the point (m) is inside a section's box (where it was last read back), other than `except`. */
  inSection(x: number, y: number, z: number, except = -1): boolean {
    const h = VOXEL / 2;
    for (const sec of this.sections.values()) {
      if (sec.slot === except) continue;
      const [c, q] = [sec.pose.slice(0, 3), sec.pose.slice(3, 7)];
      const l = rotate([-q[0], -q[1], -q[2], q[3]], [x - c[0], y - c[1], z - c[2]]);
      if (Math.abs(l[0]) <= sec.size[0] / 2 + h && Math.abs(l[1]) <= sec.size[1] / 2 + h && Math.abs(l[2]) <= sec.size[2] / 2 + h) return true;
    }
    return false;
  }

  /** The section whose box holds the point (m), or -1 (Brickfall: tools hit pieces still falling whole). */
  sectionAt(x: number, y: number, z: number): number {
    for (const sec of this.sections.values()) {
      const [c, q] = [sec.pose.slice(0, 3), sec.pose.slice(3, 7)];
      const l = rotate([-q[0], -q[1], -q[2], q[3]], [x - c[0], y - c[1], z - c[2]]);
      if (Math.abs(l[0]) <= sec.size[0] / 2 && Math.abs(l[1]) <= sec.size[1] / 2 && Math.abs(l[2]) <= sec.size[2] / 2) return sec.slot;
    }
    return -1;
  }

  /** A rubble voxel in the voxel-sized cell at the point (m), or -1 (Brickfall: tools hit settled rubble). */
  rubbleAt(x: number, y: number, z: number): number {
    const cell = this.cellIndex.get(CityPhysics.cellKey(x, y, z));
    return cell && cell.length ? cell[0] : -1;
  }

  /** A section's lowest voxels (world xyz, the `n` lowest) at pose (centre xyz, quaternion xyzw). */
  underside(slot: number, pose: ArrayLike<number>, n = 12): Float32Array {
    const section = this.sections.get(slot);
    if (!section) return new Float32Array(0);
    const q = [pose[3], pose[4], pose[5], pose[6]];
    // (Each voxel's height from the rotation's bottom row, and the n lowest kept as it goes: this ran several
    // times per section per readback, and rotating and sorting every voxel of fifty storeys cost 100 ms)
    const [x, y, z, w] = q;
    const r20 = 2 * (x * z - w * y);
    const r21 = 2 * (y * z + w * x);
    const r22 = 1 - 2 * (x * x + y * y);
    const off = section.offsets;
    const best: number[] = [];
    const bestZ: number[] = [];
    const count = section.voxels.length;
    for (let k = 0; k < count; k++) {
      const zk = r20 * off[3 * k] + r21 * off[3 * k + 1] + r22 * off[3 * k + 2];
      if (best.length < n) {
        best.push(k);
        bestZ.push(zk);
        continue;
      }
      let worst = 0;
      for (let i = 1; i < n; i++) if (bestZ[i] > bestZ[worst]) worst = i;
      if (zk < bestZ[worst]) {
        best[worst] = k;
        bestZ[worst] = zk;
      }
    }
    const order = best.map((k, i) => [k, bestZ[i]]).sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    const out = new Float32Array(order.length * 3);
    order.forEach((k, i) => {
      const r = rotate(q, [section.offsets[3 * k], section.offsets[3 * k + 1], section.offsets[3 * k + 2]]);
      out.set([pose[0] + r[0], pose[1] + r[1], pose[2] + r[2]], 3 * i);
    });
    return out;
  }

  /**
   * A section breaks where it is (pose: centre xyz, quaternion xyzw; moving at `velocity`):
   * `loose` of its voxels (a share, the ones nearest `towards`, the impact side) fly on as
   * bodies, bonded; the rest settle there as rubble. Returns the world positions of its
   * lowest voxels (what it came down on, for crushing).
   */
  shatter(slot: number, pose: ArrayLike<number>, velocity: ArrayLike<number>, loose: number, dust = 0, squash = 1): Float32Array {
    const { city } = this;
    const section = this.sections.get(slot);
    if (!section) return new Float32Array(0);
    this.sections.delete(slot);
    // A slam that pancakes it: a share goes to dust at once (as a crushed storey does)
    if (dust > 0) {
      const gone: number[] = [];
      const keep: number[] = [];
      const offs: number[] = [];
      section.voxels.forEach((v, k) => {
        if (Math.random() < dust) gone.push(v);
        else {
          keep.push(v);
          offs.push(section.offsets[3 * k], section.offsets[3 * k + 1], section.offsets[3 * k + 2]);
        }
      });
      if (gone.length) {
        this.onCarry(
          gone.map((v) => this.body[v]),
          -1,
        );
        this.park(gone, State.Gone);
      }
      section.voxels = keep;
      section.offsets = Float32Array.from(offs);
    }
    this.markColumn(pose[0], pose[1], Math.max(...section.size) / 2 + 1.5);
    const q = [pose[3], pose[4], pose[5], pose[6]];
    const where = new Float32Array(section.voxels.length * 3);
    section.voxels.forEach((_, k) => {
      const r = rotate(q, [section.offsets[3 * k], section.offsets[3 * k + 1], section.offsets[3 * k + 2]]);
      for (let a = 0; a < 3; a++) where[3 * k + a] = pose[a] + r[a];
    });
    // Pancaked: what's left of it lies squashed toward its bottom (a crushed storey is a layer of rubble a
    // fraction of its height), so what stood on it comes down that far and slams again
    if (squash < 1) {
      let zmin = Infinity;
      for (let k = 0; k < section.voxels.length; k++) zmin = Math.min(zmin, where[3 * k + 2]);
      for (let k = 0; k < section.voxels.length; k++) where[3 * k + 2] = zmin + (where[3 * k + 2] - zmin) * squash + (Math.random() - 0.5) * 0.1;
    }
    // The lowest ones take the blow and fly; the rest lie where they are
    const order = section.voxels.map((_, k) => k).sort((a, b) => where[3 * a + 2] - where[3 * b + 2]);
    const count = Math.round(section.voxels.length * loose);
    const flying = new Set(order.slice(0, count).concat(order.filter(() => Math.random() < loose * 0.25)));
    const flyVoxels: number[] = [];
    const flyBodies: Rigid[] = [];
    const lie: number[] = [];
    const liePoses: number[] = [];
    section.voxels.forEach((v, k) => {
      if (flying.has(k)) {
        flyVoxels.push(v);
        const b = new Rigid(this.scratch, CUBE, density(city.material[v]), 0.7, where.subarray(3 * k, 3 * k + 3));
        b.positionAng.set(q);
        const kick = 1 + (Math.random() - 0.5) * 0.6;
        b.velocityLin.set([velocity[0] * kick + (Math.random() - 0.5) * 2, velocity[1] * kick + (Math.random() - 0.5) * 2, Math.abs(velocity[2]) * 0.15 * Math.random()]);
        flyBodies.push(b);
      } else {
        lie.push(v);
        liePoses.push(where[3 * k], where[3 * k + 1], where[3 * k + 2], q[0], q[1], q[2], q[3]);
      }
    });
    // Let go of the carried voxels, park the box
    this.onCarry(
      section.voxels.map((v) => this.body[v]),
      -1,
    );
    this.solver.rewriteBodies([slot], [new Rigid(this.scratch, CUBE, 0, 0.7, parked(city.count + slot))]);
    this.scratch.clear();
    this.freeSlots.push(slot);
    if (flyVoxels.length) {
      const order2 = flyVoxels.map((v, k) => [v, k]).sort((a, b) => this.body[a[0]] - this.body[b[0]]);
      for (const [v] of order2) city.state[v] = State.Loose;
      this.solver.rewriteBodies(
        order2.map(([v]) => this.body[v]),
        order2.map(([, k]) => flyBodies[k]),
      );
      this.scratch.clear();
      this.loose += flyVoxels.length;
      this.looseList.push(...flyVoxels);
      this.join(flyVoxels, section.bond);
    }
    if (lie.length) this.settleAt(lie, Float32Array.from(liePoses));
    const low = order.slice(0, Math.min(order.length, 12));
    const out = new Float32Array(low.length * 3);
    low.forEach((k, i) => out.set(where.subarray(3 * k, 3 * k + 3), 3 * i));
    return out;
  }

  /** Voxels (carried, or loose) laid down as rubble at poses (xyz, quaternion xyzw each). */
  private settleAt(voxels: number[], poses: Float32Array): void {
    const { city } = this;
    const order = voxels.map((v, k) => [v, k]).sort((a, b) => this.body[a[0]] - this.body[b[0]]);
    const at = new Float32Array(order.length * 3);
    const turn = new Float32Array(order.length * 4);
    order.forEach(([v, k], i) => {
      if (this.rubble.has(v)) this.unindex(v);
      city.state[v] = State.Rubble;
      this.rubble.add(v);
      this.rest.set(poses.subarray(7 * k, 7 * k + 7), 7 * v);
      this.index(v);
      at.set(poses.subarray(7 * k, 7 * k + 3), 3 * i);
      turn.set(poses.subarray(7 * k + 3, 7 * k + 7), 4 * i);
    });
    this.solver.rewriteFixed(
      order.map(([v]) => this.body[v]),
      at,
      CUBE,
      0.7,
      turn,
    );
  }

  /** Park voxels' bodies out of play in `state` (gone, or carried by a section). */
  private park(voxels: number[], state: number): void {
    const { city } = this;
    const order = voxels.filter((v) => city.state[v] !== State.Gone).sort((a, b) => this.body[a] - this.body[b]);
    if (!order.length) return;
    this.unjoin(order);
    const at = new Float32Array(order.length * 3);
    order.forEach((v, k) => {
      if (city.state[v] === State.Loose) this.loose--;
      if (this.rubble.has(v)) this.unindex(v);

      this.rubble.delete(v);
      city.state[v] = state;
      at.set(parked(v), 3 * k);
    });
    this.solver.rewriteFixed(
      order.map((v) => this.body[v]),
      at,
      CUBE,
      0.7,
    );
  }

  /** Take voxels out of play (blown to dust): parked far away, fixed. */
  remove(voxels: number[]): void {
    this.park(voxels, State.Gone);
  }

  /** Take a section out of play whole (drifted off for good): its voxels gone, its box parked for the next. */
  discard(slot: number): void {
    const section = this.sections.get(slot);
    if (!section) return;
    this.sections.delete(slot);
    this.onCarry(
      section.voxels.map((v) => this.body[v]),
      -1,
    );
    this.solver.rewriteBodies([slot], [new Rigid(this.scratch, CUBE, 0, 0.7, parked(this.city.count + slot))]);
    this.scratch.clear();
    this.freeSlots.push(slot);
    this.park(section.voxels, State.Gone);
  }

  /** Push loose bodies within `radius` of `at` outward (m/s at the centre), up and spinning. */
  blast(at: ArrayLike<number>, radius: number, push: number, lift = this.city.weightless ? 0 : push * LIFT, spin = 6): void {
    this.markColumn(at[0], at[1], radius + 1.5);
    this.wake(at, radius);
    this.device.queue.writeBuffer(this.blastParams, 0, new Float32Array([at[0], at[1], at[2], radius, push, lift, spin, this.solver.bodyCount]));
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.blastPipe);
    pass.setBindGroup(0, this.blastGroup);
    pass.dispatchWorkgroups(Math.ceil(this.solver.bodyCount / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Where the loose voxels are now: their voxel numbers and, per voxel (12 floats), position
   * (xyzw), velocity (xyzw) and rotation (quaternion), gathered on the GPU so only they are
   * read back.
   */
  async readLoose(): Promise<{ voxels: number[]; data: Float32Array; sections: number[]; sectionData: Float32Array }> {
    const voxels = this.looseList.filter((v) => this.city.state[v] === State.Loose);
    const sections = [...this.sections.keys()];
    const n = voxels.length + sections.length;
    if (!n) return { voxels, data: new Float32Array(0), sections, sectionData: new Float32Array(0) };
    const d = this.device;
    let g = this.gather;
    if (!g || g.capacity < n) {
      g?.which.destroy();
      g?.out.destroy();
      g?.staging.destroy();
      const capacity = Math.max(4096, 2 ** Math.ceil(Math.log2(n)));
      const pipe = g?.pipe ?? d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code: gatherWGSL }), entryPoint: 'main' } });
      const which = d.createBuffer({ size: capacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const out = d.createBuffer({ size: capacity * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const staging = d.createBuffer({ size: capacity * 48, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const count = g?.count ?? d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const group = d.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [which, this.bodyBuffer, out, count].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
      g = this.gather = { pipe, which, out, staging, count, capacity, group };
    }
    d.queue.writeBuffer(g.which, 0, Uint32Array.from([...voxels.map((v) => this.body[v]), ...sections]));
    d.queue.writeBuffer(g.count, 0, new Uint32Array([n, 0, 0, 0]));
    const encoder = d.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(g.pipe);
    pass.setBindGroup(0, g.group);
    pass.dispatchWorkgroups(Math.ceil(n / 64));
    pass.end();
    encoder.copyBufferToBuffer(g.out, 0, g.staging, 0, n * 48);
    d.queue.submit([encoder.finish()]);
    await g.staging.mapAsync(GPUMapMode.READ, 0, n * 48);
    const all = new Float32Array(g.staging.getMappedRange(0, n * 48).slice(0));
    g.staging.unmap();
    return { voxels, data: all.subarray(0, voxels.length * 12), sections, sectionData: all.subarray(voxels.length * 12) };
  }

  /**
   * A body for a vehicle driven from the CPU (a section slot): a fixed box of `size` (m) that
   * `drive` moves each step. Fixed with a velocity, it's kinematic in the solver: it shoves the
   * debris it runs into and carries what lands on it, and nothing pushes it back. (Fixed voxels
   * it can't touch: the solver never pairs two fixed bodies, so what it breaks, it breaks on
   * the CPU.) Returns the slot, or -1 if none is free.
   */
  /** Give a vehicle's slot back (a plank broken, a machine gone): its body parked out of play. */
  release(slot: number): void {
    if (slot < 0) return;
    this.solver.rewriteBodies([slot], [new Rigid(this.scratch, CUBE, 0, 0.7, parked(this.city.count + slot))]);
    this.scratch.clear();
    this.freeSlots.push(slot);
  }

  /** Anything solid that isn't voxels (main.ts: the machines): rubble lying on it is held. */
  solidAt: ((x: number, y: number, z: number) => boolean) | null = null;

  vehicle(size: number[], at: ArrayLike<number>): number {
    const slot = this.freeSlots.pop();
    if (slot === undefined) return -1;
    this.solver.rewriteFixed([slot], at, size, 0.6);
    return slot;
  }

  /**
   * The vehicle in `slot` is at `at` turned by `q` (xyzw) now, moving at `v` and turning at `w`
   * (rad/s about each axis): the step advances it by them, so it's where the CPU will have it
   * after the step, sliding there (contacts see it move) rather than jumping.
   */
  drive(slot: number, at: ArrayLike<number>, q: ArrayLike<number>, v: ArrayLike<number>, w: ArrayLike<number>): void {
    const base = slot * BODY_FLOATS * 4;
    const put = (offset: number, values: ArrayLike<number>) => this.device.queue.writeBuffer(this.bodyBuffer, base + offset * 4, new Float32Array(Array.from(values)));
    put(B_POS, [at[0], at[1], at[2]]);
    put(B_ROT, [q[0], q[1], q[2], q[3]]);
    put(B_VEL, [v[0], v[1], v[2]]);
    put(B_ANGVEL, [w[0], w[1], w[2]]);
  }

  /** Throw a ball (radius m, density) from `at` with velocity `v`, reusing the oldest spare. */
  throwBall(at: ArrayLike<number>, v: ArrayLike<number>, radius: number, ballDensity: number): number {
    const slot = this.spares[this.nextSpare];
    this.nextSpare = (this.nextSpare + 1) % this.spares.length;
    const ball = sphere(this.scratch, radius, ballDensity, 0.6, at, v);
    this.solver.rewriteBodies([slot], [ball]);
    this.scratch.clear();
    return slot;
  }

  destroy(): void {
    this.solver.destroy();
    this.blastParams.destroy();
    this.waterParams?.destroy();
    for (const b of [this.gather?.which, this.gather?.out, this.gather?.staging, this.gather?.count]) b?.destroy();
  }
}

/** A parking spot for body k, out of play. */
function parked(k: number): [number, number, number] {
  return [-40000 + (k % 2000) * 4, -40000 + Math.floor(k / 2000) * 4, PARKED_Z];
}

export const PARKED_BELOW = PARKED_Z / 2;
/** How much of a blast's push throws loose pieces up (the fork's 0.4 lifted debris into the falling storeys above, and they rode it up). */
const LIFT = 0.15;
/** Most rubble one settle checks (the rest waits for the next). */
const SETTLE_MAX = 1500;
