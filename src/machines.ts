// The machines: a crawler crane swinging a wrecking ball and a tracked excavator. You get in (F) and work them.
//
// They run on the CPU, as the fork's car does: the world's bodies are on the GPU and only read back every few
// frames, too late to steer by. Each machine is rigid kinematics with momentum: the crane's ball is a pendulum on
// a rope from the boom tip (the boom slews and luffs with inertia, so the ball lags and swings), the excavator's
// tracks carry 22 t at 11 km/h, its arm moves at hydraulic rates toward where you look. Every moving part is a
// kinematic box in the solver (physics.ts vehicle/drive): it shoves debris and is never pushed back. Against what
// still stands the CPU checks each part: a part pressed in reports a Contact (its speed into the surface and its
// mass), main.ts breaks what that energy breaks, and the part keeps the momentum left, or bounces off what held.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { within } from './destruction.ts';
import { type City, State, VOXEL } from './world.ts';

/**
 * Whether the machines are in the game. Off for now (1.6.1: they were hard to control and want rethinking): no lot
 * parks one, the cable (what they pull with) isn't offered, and nothing in the menus or hints mentions them. The
 * code stays, so turning this on brings them back as they were.
 */
export const VEHICLES = false;

export type MachineKind = 'crane' | 'excavator';

/** A moving part pressed into standing voxels. */
export interface Contact {
  /** The point of contact (m). */
  at: THREE.Vector3;
  /** Out of what it hit, toward the part (unit). */
  normal: THREE.Vector3;
  /** Speed into the surface (m/s). */
  vn: number;
  velocity: THREE.Vector3;
  /** What the part carries into the hit (kg). */
  mass: number;
  part: 'ball' | 'bucket' | 'tracks';
  /** The bucket curling into it: a bite, not a blow. */
  bite?: boolean;
  /** What it touched. */
  voxels: number[];
}

/** What the world did with a contact: the mass broken out of the way (kg). */
export interface Outcome {
  brokeMass: number;
}

export type HitFn = (c: Contact) => Outcome;

/** The controls, as main.ts reads them for whoever is in the seat. */
export interface Controls {
  /** W/S: drive (excavator), boom up/down (crane). */
  forward: number;
  /** A/D: steer (excavator; + left), slew (crane; + left). */
  turn: number;
  /** Space/C: winch in/out (crane). */
  lift: number;
  /** Where the camera looks (excavator: the arm reaches for it). */
  eye: THREE.Vector3;
  dir: THREE.Vector3;
  /** Left mouse held: curl the bucket (excavator). */
  action: boolean;
}

/** The sound each machine makes this frame (main.ts plays it). */
export interface Noise {
  rpm: number;
  load: number;
  hydraulic: number;
  winch: number;
}

// ---------- the look: painted blocks ----------
export type Block = { s: [number, number, number]; p: [number, number, number]; c: number; r?: [number, number, number] };
const colourOf = new THREE.Color();
/** One geometry of painted boxes (vertex colours), for one draw. */
export function blocks(list: Block[]): THREE.BufferGeometry {
  const geos = list.map(({ s, p, c, r }) => {
    const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
    if (r) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2], 'ZYX')));
    g.translate(p[0], p[1], p[2]);
    colourOf.set(c);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) a.set([colourOf.r, colourOf.g, colourOf.b], 3 * k);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false) as THREE.BufferGeometry;
  for (const g of geos) g.dispose();
  return merged;
}
/** Paint over steel: the yellow of plant machinery, worn. */
export const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
/** Bare steel: the ball, the rope, the teeth. */
export const steelMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.38, metalness: 0.9 });
/** Lamps and LEDs: what glows (the alarm boxes, the loot's marker, the truck's lights). */
export const glowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 1, vertexColors: true });
export function mesh(geometry: THREE.BufferGeometry, material: THREE.Material = paintMat): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const YELLOW = 0xe9a91c;
const YELLOW_DARK = 0xb98112;
const DARK = 0x26282b;
const GREY = 0x55595e;
const GLASS = 0x1c2a33;
const RED = 0xb3261e;

/** Fixed voxels inside the box of half-length `hl` along `heading`, half-width `hw`, z0..z1, round (x, y) (the fork's car sweep, any size). */
export function sweepBox(city: City, x: number, y: number, heading: number, hl: number, hw: number, z0: number, z1: number): number[] {
  const [c, s] = [Math.cos(heading), Math.sin(heading)];
  const hx = hl + VOXEL / 2;
  const hy = hw + VOXEL / 2;
  const ex = Math.abs(c) * hx + Math.abs(s) * hy;
  const ey = Math.abs(s) * hx + Math.abs(c) * hy;
  const out: number[] = [];
  for (const b of city.buildings) {
    const bx0 = b.x0 * VOXEL;
    const by0 = b.y0 * VOXEL;
    if (x + ex < bx0 || x - ex > bx0 + b.w * VOXEL || y + ey < by0 || y - ey > by0 + b.d * VOXEL || z0 > b.h * VOXEL) continue;
    const i0 = Math.max(0, Math.floor((x - ex) / VOXEL) - b.x0);
    const i1 = Math.min(b.w - 1, Math.floor((x + ex) / VOXEL) - b.x0);
    const j0 = Math.max(0, Math.floor((y - ey) / VOXEL) - b.y0);
    const j1 = Math.min(b.d - 1, Math.floor((y + ey) / VOXEL) - b.y0);
    const k0 = Math.max(0, Math.floor(z0 / VOXEL));
    const k1 = Math.min(b.h - 1, Math.floor(z1 / VOXEL));
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const v = b.cells[i + b.w * (j + b.d * k)];
          if (v < 0 || city.state[v] !== State.Fixed) continue;
          const dx = (b.x0 + i + 0.5) * VOXEL - x;
          const dy = (b.y0 + j + 0.5) * VOXEL - y;
          if (Math.abs(dx * c + dy * s) <= hx && Math.abs(-dx * s + dy * c) <= hy) out.push(v);
        }
      }
    }
  }
  return out;
}

/** The middle of some voxels (m). */
function centroid(city: City, voxels: number[], out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0);
  for (const v of voxels) out.x += city.position[3 * v] / voxels.length;
  for (const v of voxels) out.y += city.position[3 * v + 1] / voxels.length;
  for (const v of voxels) out.z += city.position[3 * v + 2] / voxels.length;
  return out;
}

/**
 * A sphere of `radius` at `p` moving at `v` (kg `mass`) against what stands: break what the hit breaks
 * (`hit`), keep the momentum left, push out of and bounce off the rest. Returns the hit's speed into the
 * surface, or 0 if it touched nothing.
 */
function collideSphere(city: City, p: THREE.Vector3, v: THREE.Vector3, radius: number, mass: number, part: Contact['part'], hit: HitFn, bite = false): number {
  const touching = within(city, p.toArray(), radius + VOXEL * 0.5);
  if (!touching.length) return 0;
  const c = centroid(city, touching, new THREE.Vector3());
  const normal = p.clone().sub(c);
  if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
  normal.normalize();
  const vn = -v.dot(normal);
  let broke = 0;
  if (vn > 1 || bite) {
    const at = p.clone().addScaledVector(normal, -radius);
    broke = hit({ at, normal, vn: Math.max(vn, 0), velocity: v.clone(), mass, part, bite, voxels: touching }).brokeMass;
    // Momentum shared with what it broke out
    if (broke > 0) v.multiplyScalar(mass / (mass + 0.5 * broke));
  }
  // What's left: out of it, and the speed into it gone (a little back: steel on masonry doesn't bounce much)
  const left = within(city, p.toArray(), radius + VOXEL * 0.25);
  if (left.length) {
    const c2 = centroid(city, left, new THREE.Vector3());
    const n2 = p.clone().sub(c2);
    if (n2.lengthSq() < 1e-6) n2.copy(normal);
    n2.normalize();
    const into = -v.dot(n2);
    if (into > 0) v.addScaledVector(n2, into * 1.2);
    // Nudged out a step at a time (never further than a voxel a step)
    p.addScaledVector(n2, Math.min(VOXEL, 0.05 + VOXEL * 0.5));
  }
  return Math.max(vn, 0);
}

// ---------- the crane ----------
const BOOM = 18;
const BALL_R = 0.75;
const BALL_MASS = 4000;
const ROPE_POINTS = 16;
/** Slew: top rate (rad/s) and how fast it gets there (rad/s²): a heavy upper structure, it lags and overruns. */
const SLEW_MAX = 0.38;
const SLEW_ACCEL = 0.32;
const LUFF_MIN = (25 * Math.PI) / 180;
const LUFF_MAX = (76 * Math.PI) / 180;
const LUFF_RATE = 0.16;
const WINCH_RATE = 2.4;
const ROPE_MIN = 3;
const ROPE_MAX = 17;

export class Crane {
  readonly kind = 'crane' as const;
  readonly object = new THREE.Group();
  /** Where you climb in (m, world), and the seat's height. */
  readonly door = new THREE.Vector3();
  heading: number;
  slew: number;
  slewRate = 0;
  luff = (55 * Math.PI) / 180;
  luffRate = 0;
  rope = 11;
  readonly ball = new THREE.Vector3();
  readonly ballVel = new THREE.Vector3();
  readonly tip = new THREE.Vector3();
  private readonly tipVel = new THREE.Vector3();
  private readonly upper = new THREE.Group();
  private readonly boom = new THREE.Group();
  private readonly ballMesh: THREE.Group;
  private readonly ropeMesh: THREE.InstancedMesh;
  private readonly points: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  /** The ball's kinematic body in the solver (or -1), and whether it's in play (main.ts: only while it moves or is worked). */
  slot = -1;
  solid = false;
  readonly noise: Noise = { rpm: 0, load: 0, hydraulic: 0, winch: 0 };
  /** Speed of the last hit (m/s) and when (s): main.ts shakes and sounds by it. */
  lastHit = 0;
  /** The ground thuds the ball made this frame (speed). */
  thud = 0;
  readonly x: number;
  readonly y: number;

  constructor(x: number, y: number, heading: number) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.slew = 0;
    this.object.position.set(x, y, 0);
    this.object.rotation.z = heading;
    // The crawler: two tracks and the car body between them
    this.object.add(
      mesh(
        blocks([
          { s: [6.4, 1.0, 1.1], p: [0, 1.9, 0.55], c: DARK },
          { s: [6.4, 1.0, 1.1], p: [0, -1.9, 0.55], c: DARK },
          { s: [5.6, 1.06, 0.16], p: [0, 1.9, 1.04], c: GREY },
          { s: [5.6, 1.06, 0.16], p: [0, -1.9, 1.04], c: GREY },
          { s: [3.2, 2.9, 0.8], p: [0, 0, 1.0], c: GREY },
          { s: [2.0, 2.0, 0.3], p: [0, 0, 1.5], c: DARK },
        ]),
      ),
    );
    // The upper works: the house, the counterweight, the cab, the A-frame
    this.upper.position.set(0, 0, 1.65);
    this.upper.add(
      mesh(
        blocks([
          { s: [4.6, 3.0, 1.8], p: [-0.7, 0, 0.9], c: YELLOW },
          { s: [1.5, 3.3, 1.5], p: [-3.4, 0, 0.75], c: DARK },
          { s: [0.1, 3.0, 0.1], p: [1.6, 0, 1.75], c: YELLOW_DARK },
          { s: [1.6, 1.15, 1.7], p: [1.2, 1.05, 1.0], c: YELLOW },
          { s: [0.06, 0.9, 0.9], p: [2.02, 1.05, 1.25], c: GLASS },
          { s: [1.2, 0.06, 0.8], p: [1.25, 1.64, 1.25], c: GLASS },
          { s: [0.3, 0.3, 2.6], p: [-1.6, 0.9, 2.9], c: YELLOW_DARK, r: [0, 0.35, 0] },
          { s: [0.3, 0.3, 2.6], p: [-1.6, -0.9, 2.9], c: YELLOW_DARK, r: [0, 0.35, 0] },
          { s: [0.4, 2.2, 0.3], p: [-1.15, 0, 4.1], c: YELLOW_DARK },
          { s: [3.6, 0.2, 0.3], p: [-0.7, 1.52, 1.5], c: RED },
          { s: [3.6, 0.2, 0.3], p: [-0.7, -1.52, 1.5], c: RED },
        ]),
      ),
    );
    this.object.add(this.upper);
    // The lattice boom: four chords, ties and diagonals, the sheave at the tip
    const lattice: Block[] = [];
    const half = 0.42;
    for (const y of [-half, half]) for (const z of [-half, half]) lattice.push({ s: [BOOM, 0.13, 0.13], p: [BOOM / 2, y, z], c: YELLOW });
    for (let x = 0.6; x < BOOM - 0.3; x += 1.2) {
      for (const z of [-half, half]) lattice.push({ s: [0.07, 2 * half, 0.07], p: [x, 0, z], c: YELLOW_DARK });
      for (const y of [-half, half]) lattice.push({ s: [0.07, 0.07, 2 * half], p: [x, y, 0], c: YELLOW_DARK });
      const d = Math.atan2(2 * half, 1.2);
      for (const y of [-half, half]) lattice.push({ s: [Math.hypot(1.2, 2 * half), 0.06, 0.06], p: [x + 0.6, y, 0], c: YELLOW_DARK, r: [0, (Math.floor(x / 1.2) % 2 ? 1 : -1) * d, 0] });
    }
    lattice.push({ s: [1.0, 0.7, 0.9], p: [BOOM, 0, 0], c: DARK });
    lattice.push({ s: [1.2, 1.1, 1.1], p: [0.2, 0, 0], c: DARK });
    this.boom.add(mesh(blocks(lattice)));
    this.boom.position.set(1.4, 0, 1.25);
    this.upper.add(this.boom);
    // The ball on its hook block
    this.ballMesh = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), steelMat);
    ball.castShadow = true;
    this.ballMesh.add(ball);
    this.ballMesh.add(mesh(blocks([
      { s: [0.5, 0.5, 0.35], p: [0, 0, BALL_R + 0.12], c: DARK },
      { s: [0.18, 0.18, 0.45], p: [0, 0, BALL_R + 0.45], c: GREY },
      { s: [0.6, 0.35, 0.7], p: [0, 0, BALL_R + 1.0], c: YELLOW },
    ])));
    this.ropeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.06, 1), steelMat, ROPE_POINTS - 1);
    this.ropeMesh.frustumCulled = false;
    this.ropeMesh.castShadow = true;
    this.pose();
    this.ball.copy(this.tip).add(new THREE.Vector3(0, 0, -this.rope));
    this.ball.z = Math.max(BALL_R, this.ball.z);
    for (let k = 0; k < ROPE_POINTS; k++) {
      const p = this.tip.clone().lerp(this.ball, k / (ROPE_POINTS - 1));
      this.points.push(p);
      this.prev.push(p.clone());
    }
    this.door.set(x + Math.cos(heading) * 1.5 - Math.sin(heading) * 3.2, y + Math.sin(heading) * 1.5 + Math.cos(heading) * 3.2, 0);
  }

  /** The meshes that sit in the world, not under the crane's group (the ball and rope swing free). */
  get loose(): THREE.Object3D[] {
    return [this.ballMesh, this.ropeMesh];
  }

  /** The boom's world angle and the tip from the slew and luff. */
  private pose(): void {
    const yaw = this.heading + this.slew;
    // The boom foot: 1.4 m forward of the slew axis, 2.9 m up
    const fx = this.x + Math.cos(yaw) * 1.4;
    const fy = this.y + Math.sin(yaw) * 1.4;
    const fz = 2.9;
    const r = Math.cos(this.luff) * BOOM;
    this.tip.set(fx + Math.cos(yaw) * r, fy + Math.sin(yaw) * r, fz + Math.sin(this.luff) * BOOM);
  }

  /** The seat: where the camera's held from (m). */
  seat(out: THREE.Vector3): THREE.Vector3 {
    const yaw = this.heading + this.slew;
    return out.set(this.x + Math.cos(yaw) * 1.2 - Math.sin(yaw) * 1.05, this.y + Math.sin(yaw) * 1.2 + Math.cos(yaw) * 1.05, 3.6);
  }

  /** What the camera should look at: between the cab and the ball. */
  focus(out: THREE.Vector3): THREE.Vector3 {
    return this.seat(out).lerp(this.ball, 0.55);
  }

  update(dt: number, city: City, c: Controls | null, hit: HitFn): void {
    if (dt <= 0) return;
    this.thud = 0;
    const n = 4;
    const h = dt / n;
    const turn = c?.turn ?? 0;
    const luff = c?.forward ?? 0;
    const lift = c?.lift ?? 0;
    for (let s = 0; s < n; s++) {
      // The upper works: toward the wanted slew rate at a heavy machine's pace (and it coasts to a stop)
      const want = turn * SLEW_MAX;
      const dv = want - this.slewRate;
      this.slewRate += Math.sign(dv) * Math.min(Math.abs(dv), SLEW_ACCEL * h * (want === 0 ? 1.4 : 1));
      this.slew += this.slewRate * h;
      this.luffRate += (luff * LUFF_RATE - this.luffRate) * Math.min(1, h * 4);
      this.luff = Math.max(LUFF_MIN, Math.min(LUFF_MAX, this.luff + this.luffRate * h));
      if (this.luff === LUFF_MIN || this.luff === LUFF_MAX) this.luffRate = 0;
      this.rope = Math.max(ROPE_MIN, Math.min(ROPE_MAX, this.rope - lift * WINCH_RATE * h));
      const was = this.tip.clone();
      this.pose();
      this.tipVel.subVectors(this.tip, was).divideScalar(h);
      // The ball: gravity and a little air, then the rope (it can go slack; taut, it holds the ball to the tip)
      this.ballVel.z -= 9.81 * h;
      this.ballVel.multiplyScalar(1 - 0.03 * h);
      this.ball.addScaledVector(this.ballVel, h);
      const d = this.ball.clone().sub(this.tip);
      const len = d.length();
      const full = this.rope + BALL_R + 1.2;
      if (len > full) {
        d.divideScalar(len);
        this.ball.copy(this.tip).addScaledVector(d, full);
        const away = this.ballVel.dot(d) - this.tipVel.dot(d);
        if (away > 0) this.ballVel.addScaledVector(d, -away);
      }
      // The ground
      if (this.ball.z < BALL_R) {
        if (this.ballVel.z < -2) this.thud = Math.max(this.thud, -this.ballVel.z);
        this.ball.z = BALL_R;
        this.ballVel.z = Math.max(0, -this.ballVel.z * 0.15);
        this.ballVel.x *= 1 - Math.min(1, 3 * h);
        this.ballVel.y *= 1 - Math.min(1, 3 * h);
      }
      // What still stands
      const vn = collideSphere(city, this.ball, this.ballVel, BALL_R, BALL_MASS, 'ball', hit);
      if (vn > 1) this.lastHit = Math.max(this.lastHit, vn);
    }
    this.noise.rpm = 0.25 + 0.75 * Math.min(1, Math.abs(this.slewRate) / SLEW_MAX * 0.6 + Math.abs(this.luffRate) / LUFF_RATE * 0.5 + Math.abs(lift) * 0.6);
    this.noise.load = c ? Math.min(1, Math.abs(turn) + Math.abs(luff) * 0.7 + Math.abs(lift) * 0.8) : 0;
    this.noise.hydraulic = Math.min(1, Math.abs(this.luffRate) / LUFF_RATE);
    this.noise.winch = lift !== 0 && this.rope > ROPE_MIN && this.rope < ROPE_MAX ? 1 : 0;
    this.rope3d(dt);
    this.draw();
  }

  /** The rope: a Verlet chain from the tip to the hook block, hung with a little sag when slack. */
  private rope3d(dt: number): void {
    const hook = this.hook(new THREE.Vector3());
    const pts = this.points;
    const seg = Math.max(this.tip.distanceTo(hook), this.rope) / (ROPE_POINTS - 1);
    for (let k = 1; k < ROPE_POINTS - 1; k++) {
      const p = pts[k];
      const v = p.clone().sub(this.prev[k]).multiplyScalar(0.96);
      this.prev[k].copy(p);
      p.add(v);
      p.z -= 9.81 * dt * dt;
    }
    pts[0].copy(this.tip);
    pts[ROPE_POINTS - 1].copy(hook);
    for (let it = 0; it < 10; it++) {
      for (let k = 0; k < ROPE_POINTS - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const d = b.clone().sub(a);
        const l = d.length() || 1e-6;
        const corr = d.multiplyScalar((l - seg) / l / 2);
        if (k > 0) a.add(corr);
        if (k + 1 < ROPE_POINTS - 1) b.sub(corr);
      }
    }
  }

  /** The top of the hook block, where the rope meets it. */
  private hook(out: THREE.Vector3): THREE.Vector3 {
    const up = this.tip.clone().sub(this.ball).normalize();
    return out.copy(this.ball).addScaledVector(up, BALL_R + 1.35);
  }

  private draw(): void {
    this.upper.rotation.z = this.slew;
    this.boom.rotation.y = -this.luff;
    this.ballMesh.position.copy(this.ball);
    // The ball hangs along the rope
    const up = this.tip.clone().sub(this.ball).normalize();
    this.ballMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let k = 0; k < ROPE_POINTS - 1; k++) {
      const a = this.points[k];
      const b = this.points[k + 1];
      const d = b.clone().sub(a);
      const l = d.length();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.divideScalar(l || 1));
      m.compose(a.clone().lerp(b, 0.5), q, new THREE.Vector3(1, 1, l));
      this.ropeMesh.setMatrixAt(k, m);
    }
    this.ropeMesh.instanceMatrix.needsUpdate = true;
  }

  /** Swing the ball (tests): a push across the boom. */
  push(v: ArrayLike<number>): void {
    this.ballVel.set(v[0], v[1], v[2]);
  }
}

// ---------- the excavator ----------
const TRACK_L = 4.6;
const TRACK_W = 3.0;
const EX_MASS = 22000;
/** 11 km/h, a real 20 t machine's top speed. */
const EX_SPEED = 3.05;
const EX_ACCEL = 1.6;
const EX_TURN = 0.62;
const L1 = 5.4;
const L2 = 3.0;
const ARM_SPEED = 3.2;
const ARM_ACCEL = 9;
const SLEW_EX = 0.95;
const SLEW_EX_ACCEL = 1.7;
const BUCKET_R = 0.72;
const BUCKET_MASS = 5000;
/** The boom foot on the upper works (m: forward, across, up from the ground). */
const FOOT = [0.95, -0.35, 2.05] as const;

export class Excavator {
  readonly kind = 'excavator' as const;
  readonly object = new THREE.Group();
  readonly position = new THREE.Vector3();
  heading: number;
  speed = 0;
  turnRate = 0;
  /** The upper works' turn, relative to the tracks, and its rate. */
  slew = 0;
  slewRate = 0;
  /** The bucket pivot in the arm's plane: out from the foot and up (m), and its velocity there. */
  readonly arm = new THREE.Vector2(5.2, 0.6);
  private readonly armVel = new THREE.Vector2();
  /** The bucket's curl (0 open … 1 curled) and its rate. */
  curl = 0;
  private readonly upper = new THREE.Group();
  private readonly boom = new THREE.Group();
  private readonly stick = new THREE.Group();
  private readonly bucket = new THREE.Group();
  /** The bucket's middle (world) and its velocity. */
  readonly bucketAt = new THREE.Vector3();
  readonly bucketVel = new THREE.Vector3();
  /** Kinematic bodies in the solver: the machine, the bucket (or -1). */
  slot = -1;
  bucketSlot = -1;
  readonly noise: Noise = { rpm: 0, load: 0, hydraulic: 0, winch: 0 };
  lastHit = 0;
  /** Seconds to the next bite while curling against something. */
  private biteIn = 0;
  /** How long the arm has been held against something it can't break (s): it strains. */
  strain = 0;
  readonly door = new THREE.Vector3();

  constructor(x: number, y: number, heading: number) {
    this.position.set(x, y, 0);
    this.heading = heading;
    const tracks: Block[] = [
      { s: [TRACK_L, 0.8, 0.9], p: [0, 1.15, 0.45], c: DARK },
      { s: [TRACK_L, 0.8, 0.9], p: [0, -1.15, 0.45], c: DARK },
      { s: [2.8, 1.6, 0.6], p: [0, 0, 0.7], c: GREY },
      { s: [1.4, 1.4, 0.3], p: [0, 0, 1.1], c: DARK },
    ];
    for (let k = 0; k < 9; k++) for (const y of [-1.15, 1.15]) tracks.push({ s: [0.16, 0.86, 0.06], p: [-2.1 + k * 0.52, y, 0.93], c: GREY });
    this.object.add(mesh(blocks(tracks)));
    this.upper.position.z = 1.25;
    this.upper.add(
      mesh(
        blocks([
          { s: [3.4, 2.6, 1.1], p: [-0.5, 0, 0.55], c: YELLOW },
          { s: [1.2, 2.7, 1.0], p: [-2.1, 0, 0.6], c: YELLOW_DARK },
          { s: [1.5, 1.1, 1.7], p: [0.65, 0.75, 1.0], c: YELLOW },
          { s: [0.05, 0.95, 1.0], p: [1.41, 0.75, 1.3], c: GLASS },
          { s: [1.2, 0.05, 0.9], p: [0.7, 1.31, 1.3], c: GLASS },
          { s: [0.16, 0.16, 0.8], p: [-1.5, -0.95, 1.4], c: DARK },
          { s: [1.6, 0.06, 0.12], p: [-0.8, 1.31, 0.9], c: DARK },
          { s: [0.9, 0.7, 0.5], p: [0.9, -0.35, 0.7], c: YELLOW_DARK },
        ]),
      ),
    );
    this.object.add(this.upper);
    // The arm: boom, stick and bucket, each about its own pin
    this.boom.position.set(FOOT[0], FOOT[1], FOOT[2] - 1.25);
    this.boom.add(mesh(blocks([
      { s: [L1, 0.55, 0.62], p: [L1 / 2, 0, 0], c: YELLOW },
      { s: [L1 * 0.55, 0.16, 0.16], p: [L1 * 0.35, 0, 0.45], c: 0xc8ccd0 },
      { s: [0.7, 0.62, 0.7], p: [L1, 0, 0], c: YELLOW_DARK },
    ])));
    this.stick.position.set(L1, 0, 0);
    this.stick.add(mesh(blocks([
      { s: [L2, 0.4, 0.45], p: [L2 / 2, 0, 0], c: YELLOW },
      { s: [L2 * 0.6, 0.12, 0.12], p: [L2 * 0.4, 0, 0.33], c: 0xc8ccd0 },
    ])));
    this.boom.add(this.stick);
    this.bucket.position.set(L2, 0, 0);
    const scoop: Block[] = [
      { s: [1.1, 1.15, 0.1], p: [0.55, 0, -0.45], c: DARK },
      { s: [0.1, 1.15, 0.9], p: [0.05, 0, 0], c: DARK },
      { s: [1.1, 0.08, 0.9], p: [0.55, 0.58, -0.05], c: YELLOW_DARK },
      { s: [1.1, 0.08, 0.9], p: [0.55, -0.58, -0.05], c: YELLOW_DARK },
    ];
    for (let k = 0; k < 5; k++) scoop.push({ s: [0.28, 0.1, 0.1], p: [1.2, -0.46 + k * 0.23, -0.45], c: 0x8c9096 });
    this.bucket.add(mesh(blocks(scoop)));
    this.stick.add(this.bucket);
    this.upper.add(this.boom);
    this.object.position.copy(this.position);
    this.object.rotation.z = heading;
    this.place();
  }

  get loose(): THREE.Object3D[] {
    return [];
  }

  /** The world yaw of the upper works. */
  get yaw(): number {
    return this.heading + this.slew;
  }

  /** The boom foot (world). */
  foot(out: THREE.Vector3): THREE.Vector3 {
    const y = this.yaw;
    return out.set(this.position.x + Math.cos(y) * FOOT[0] - Math.sin(y) * FOOT[1], this.position.y + Math.sin(y) * FOOT[0] + Math.cos(y) * FOOT[1], FOOT[2]);
  }

  seat(out: THREE.Vector3): THREE.Vector3 {
    const y = this.yaw;
    return out.set(this.position.x + Math.cos(y) * 0.65 - Math.sin(y) * 0.75, this.position.y + Math.sin(y) * 0.65 + Math.cos(y) * 0.75, 3.3);
  }

  focus(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y, 3.4);
  }

  /** The arm's joint angles for the pivot at `arm` (two-link, elbow up): boom from level, stick relative to the boom. */
  private angles(): [number, number] {
    const d = Math.min(L1 + L2 - 0.05, Math.max(Math.abs(L1 - L2) + 0.4, this.arm.length()));
    const base = Math.atan2(this.arm.y, this.arm.x);
    const inner = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const elbow = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
    return [base + inner, -(Math.PI - elbow)];
  }

  /** Lay out the parts and the bucket's place from the state. */
  place(): void {
    this.object.position.copy(this.position);
    this.object.rotation.z = this.heading;
    this.upper.rotation.z = this.slew;
    const [a1, a2] = this.angles();
    this.boom.rotation.y = -a1;
    this.stick.rotation.y = -a2;
    // The bucket hangs teeth down and forward, curling in under the stick
    this.bucket.rotation.y = a1 + a2 + 1.2 - this.curl * 1.9;
    this.bucket.updateWorldMatrix(true, false);
    this.bucketAt.set(0.55, 0, -0.1).applyMatrix4(this.bucket.matrixWorld);
    const [c, s] = [Math.cos(this.heading), Math.sin(this.heading)];
    this.door.set(this.position.x + c * 0.3 - s * 2.0, this.position.y + s * 0.3 + c * 2.0, 0);
  }

  update(dt: number, city: City, c: Controls | null, hit: HitFn): void {
    if (dt <= 0) return;
    const forward = c?.forward ?? 0;
    const turn = c?.turn ?? 0;
    // The tracks: toward the wanted speed (they bite fast; momentum carries it on into what it hits)
    const want = forward * EX_SPEED;
    const dv = want - this.speed;
    this.speed += Math.sign(dv) * Math.min(Math.abs(dv), EX_ACCEL * dt * (forward === 0 ? 1.5 : 1));
    this.turnRate += (turn * EX_TURN - this.turnRate) * Math.min(1, dt * 3);
    const before = this.position.clone();
    const h0 = this.heading;
    this.heading += this.turnRate * dt;
    this.position.x += Math.cos(this.heading) * this.speed * dt;
    this.position.y += Math.sin(this.heading) * this.speed * dt;
    // Into what stands: 22 t breaks soft walls through and slows; what holds stops it
    const hits = sweepBox(city, this.position.x, this.position.y, this.heading, TRACK_L / 2 + 0.1, TRACK_W / 2, 0.2, 2.4);
    if (hits.length) {
      const moving = Math.abs(this.speed) + Math.abs(this.turnRate) * 2;
      let through = false;
      if (moving > 0.5) {
        const p = centroid(city, hits, new THREE.Vector3());
        const vel = new THREE.Vector3(Math.cos(this.heading) * this.speed, Math.sin(this.heading) * this.speed, 0);
        const normal = this.position.clone().sub(p).setZ(0).normalize();
        const vn = Math.max(0.6, -vel.dot(normal));
        const broke = hit({ at: p, normal, vn, velocity: vel, mass: EX_MASS, part: 'tracks', voxels: hits }).brokeMass;
        through = broke > 0 && sweepBox(city, this.position.x, this.position.y, this.heading, TRACK_L / 2 + 0.1, TRACK_W / 2, 0.2, 2.4).length < hits.length * 0.3;
        this.speed *= EX_MASS / (EX_MASS + 0.7 * broke);
      }
      if (!through) {
        this.position.copy(before);
        this.heading = h0;
        if (Math.abs(this.speed) > 0.8) this.lastHit = Math.max(this.lastHit, Math.abs(this.speed));
        this.speed *= -0.1;
        this.strain = Math.min(1, this.strain + dt * 2);
      }
    }
    // The upper works turn toward where you look, at a slew motor's pace
    let target = this.slew;
    let reach = this.arm.clone();
    if (c) {
      const foot = this.foot(new THREE.Vector3());
      const aim = aimPoint(city, c.eye, c.dir);
      const yawTo = Math.atan2(aim.y - this.position.y, aim.x - this.position.x);
      // (Not round to the cab's own side within its reach: the shortest way, kept within half a turn)
      let rel = yawTo - this.heading;
      rel = Math.atan2(Math.sin(rel - this.slew), Math.cos(rel - this.slew)) + this.slew;
      target = rel;
      const out = Math.hypot(aim.x - this.position.x, aim.y - this.position.y) - FOOT[0];
      reach = new THREE.Vector2(Math.max(2.6, out), aim.z - foot.z + 0.4);
      const d = reach.length();
      const max = L1 + L2 - 0.1;
      if (d > max) reach.multiplyScalar(max / d);
      // Never into the ground
      reach.y = Math.max(-FOOT[2] + 0.75, reach.y);
    }
    const ds = target - this.slew;
    const wantRate = Math.sign(ds) * Math.min(SLEW_EX, Math.sqrt(2 * SLEW_EX_ACCEL * Math.abs(ds)));
    this.slewRate += Math.sign(wantRate - this.slewRate) * Math.min(Math.abs(wantRate - this.slewRate), SLEW_EX_ACCEL * dt);
    this.slew += this.slewRate * dt;
    // The arm: the bucket pivot toward the reach, at hydraulic speed (accelerating, easing in)
    const toGo = reach.clone().sub(this.arm);
    const wantVel = toGo.clone().multiplyScalar(4);
    if (wantVel.length() > ARM_SPEED) wantVel.setLength(ARM_SPEED);
    const dVel = wantVel.sub(this.armVel);
    const maxD = ARM_ACCEL * dt;
    if (dVel.length() > maxD) dVel.setLength(maxD);
    this.armVel.add(dVel);
    const armBefore = this.arm.clone();
    const curlBefore = this.curl;
    this.arm.addScaledVector(this.armVel, dt);
    const curling = !!c?.action;
    this.curl = Math.max(0, Math.min(1, this.curl + (curling ? 2.4 : -1.6) * dt));
    const bucketBefore = this.bucketAt.clone();
    this.place();
    this.bucketVel.subVectors(this.bucketAt, bucketBefore).divideScalar(dt);
    // The bucket against what stands: a blow if it's moving fast enough, a bite while it curls in
    this.biteIn -= dt;
    const bite = curling && this.curl < 1 && this.biteIn <= 0;
    const v = this.bucketVel.clone();
    const touching = within(city, this.bucketAt.toArray(), BUCKET_R + VOXEL * 0.5);
    // (Hydraulics drive it, not a swing: what it brings to a hit is at most the arm's top speed and a slew)
    if (v.length() > 7) v.setLength(7);
    if (touching.length) {
      const vn = collideSphere(city, this.bucketAt, v, BUCKET_R, BUCKET_MASS, 'bucket', hit, bite);
      if (bite) this.biteIn = 0.22;
      if (vn > 1.5) this.lastHit = Math.max(this.lastHit, vn);
      // Held: what's still there stops the arm where it was (it strains against it)
      if (within(city, this.bucketAt.toArray(), BUCKET_R * 0.7).length) {
        this.arm.copy(armBefore);
        this.armVel.multiplyScalar(-0.15);
        if (!curling) this.curl = curlBefore;
        this.slewRate *= -0.2;
        this.strain = Math.min(1, this.strain + dt * 3);
        this.place();
      }
    } else this.strain = Math.max(0, this.strain - dt * 2);
    const armMoving = Math.min(1, this.armVel.length() / ARM_SPEED + Math.abs(this.slewRate) / SLEW_EX * 0.6 + (curling && this.curl < 1 ? 0.5 : 0));
    this.noise.rpm = 0.3 + 0.7 * Math.min(1, Math.abs(this.speed) / EX_SPEED * 0.8 + armMoving * 0.6 + this.strain * 0.5);
    this.noise.load = c ? Math.min(1, Math.abs(forward) * 0.7 + armMoving * 0.6 + this.strain) : 0;
    this.noise.hydraulic = Math.min(1, armMoving + this.strain * 0.8);
  }

  /** Its state, to put back (a cable that holds stops it where it was). */
  snapshot() {
    return { p: this.position.clone(), h: this.heading, s: this.speed, t: this.turnRate, sl: this.slew, sr: this.slewRate, a: this.arm.clone(), av: this.armVel.clone(), c: this.curl };
  }
  restore(s: ReturnType<Excavator['snapshot']>): void {
    this.position.copy(s.p);
    this.heading = s.h;
    this.speed = 0;
    this.turnRate = 0;
    this.slew = s.sl;
    this.slewRate = 0;
    this.arm.copy(s.a);
    this.armVel.set(0, 0);
    this.curl = s.c;
    this.place();
  }

  /** The tracks' box (m): for the solver's kinematic body. */
  static readonly SIZE = [TRACK_L, TRACK_W, 1.9];
}

/** Where the camera's ray first meets something (or 9 m out), pulled back a little: what the arm reaches for. */
function aimPoint(city: City, eye: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
  let t = 14;
  const hit = rayTo(city, eye, dir, t);
  if (hit !== null) t = Math.max(1, hit - 0.35);
  else if (dir.z < -0.01) t = Math.min(t, -eye.z / dir.z);
  else t = 9;
  return eye.clone().addScaledVector(dir, t);
}
let rayTo: (city: City, eye: THREE.Vector3, dir: THREE.Vector3, far: number) => number | null = () => null;
/** main.ts's raycast, for the aim (kept out of here so the world's ray code stays in one place). */
export function setRay(f: typeof rayTo): void {
  rayTo = f;
}

export type Machine = Crane | Excavator;

/** A machine for a lot's list: `kind` at (x, y) m facing `heading` rad. */
export function makeMachine(kind: MachineKind, x: number, y: number, heading: number): Machine {
  return kind === 'crane' ? new Crane(x, y, heading) : new Excavator(x, y, heading);
}
