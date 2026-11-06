// Planks and cables: what the player builds with (the most versatile tools).
//
// A plank is a timber board up to 5 m long laid between two points (two clicks): a fixed box in the solver, so
// debris rests on it, and solid to the player, so it bridges a gap or makes a ramp. Each end rests on what it was
// laid on: take one end's support away and it swings down about the other until it lands on something; take both
// and it drops. A blast that reaches it breaks it. A cable is a steel rope up to 12 m between two anchors (a voxel,
// loose debris, or a machine): slack, it hangs; pulled taut by a machine it pulls back, and past what the anchor
// holds (by its hardness) it tears the anchor out, toward the pull, and drags what came loose behind it.

import * as THREE from 'three/webgpu';
import { blocks, mesh, steelMat } from './machines.ts';
import { type City, State, VOXEL, voxelAt } from './world.ts';

export const PLANK_MAX = 5;
export const PLANK_W = 0.6;
export const PLANK_T = 0.12;
export const CABLE_MAX = 12;

/** What an end is held by: a voxel (by index, and the point on it), the ground at a point, or a machine's part. */
export type Anchor = { kind: 'voxel'; v: number; offset: [number, number, number] } | { kind: 'ground'; at: [number, number, number] } | { kind: 'machine'; m: number; part: 'bucket' | 'hitch' | 'ball' } | { kind: 'none'; at: [number, number, number] };

export class Plank {
  readonly a = new THREE.Vector3();
  readonly b = new THREE.Vector3();
  readonly object: THREE.Mesh;
  /** What holds each end (a voxel index, or -1 for the ground). */
  holdA: number;
  holdB: number;
  /** Swinging about one end (rad/s), or dropping (m/s). */
  private spin = 0;
  private fall = 0;
  /** The kinematic body in the solver. */
  slot = -1;
  broken = false;
  readonly length: number;

  constructor(a: THREE.Vector3, b: THREE.Vector3, holdA: number, holdB: number) {
    this.a.copy(a);
    this.b.copy(b);
    this.holdA = holdA;
    this.holdB = holdB;
    this.length = a.distanceTo(b);
    this.object = mesh(plankGeometry(this.length));
    this.place();
  }

  get middle(): THREE.Vector3 {
    return this.a.clone().add(this.b).multiplyScalar(0.5);
  }

  /** Its turn: x along it, z its face's normal (as near up as the board allows). */
  get quaternion(): THREE.Quaternion {
    const along = this.b.clone().sub(this.a).normalize();
    const side = new THREE.Vector3(0, 0, 1).cross(along);
    if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
    side.normalize();
    const up = along.clone().cross(side).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, side, up));
  }

  place(): void {
    this.object.position.copy(this.middle);
    this.object.quaternion.copy(this.quaternion);
  }

  /** A point's place in the board's frame (along, across, up from its middle). */
  local(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().sub(this.middle).applyQuaternion(this.quaternion.invert());
  }

  /** Whether a point is in (or within `pad` m of) the board. */
  contains(p: THREE.Vector3, pad = 0): boolean {
    const l = this.local(p);
    return Math.abs(l.x) <= this.length / 2 + pad && Math.abs(l.y) <= PLANK_W / 2 + pad && Math.abs(l.z) <= PLANK_T / 2 + pad;
  }

  /** Points on its top face (every 0.2 m along, three across), for the player standing on it. */
  topPoints(): THREE.Vector3[] {
    const q = this.quaternion;
    const out: THREE.Vector3[] = [];
    const n = Math.max(2, Math.ceil(this.length / 0.2));
    for (let i = 0; i <= n; i++)
      for (const y of [-PLANK_W / 2 + 0.05, 0, PLANK_W / 2 - 0.05]) out.push(new THREE.Vector3(-this.length / 2 + (this.length * i) / n, y, PLANK_T / 2).applyQuaternion(q).add(this.middle));
    return out;
  }

  /**
   * Each end on what holds it: a held end stays; with one held it swings down about it until the free end meets
   * something; with neither it drops until one does. Returns whether it moved.
   */
  update(dt: number, city: City, rubbleAt: (x: number, y: number, z: number) => boolean): boolean {
    const held = (p: THREE.Vector3, hold: number) => p.z <= PLANK_T || (hold >= 0 && city.state[hold] === State.Fixed) || touching(city, p, rubbleAt);
    const okA = held(this.a, this.holdA);
    const okB = held(this.b, this.holdB);
    if (okA && okB) {
      this.spin = 0;
      this.fall = 0;
      return false;
    }
    if (!okA && !okB) {
      this.fall += 9.81 * dt;
      const dz = Math.min(this.fall * dt, Math.min(this.a.z, this.b.z));
      this.a.z -= dz;
      this.b.z -= dz;
      // What it lands on holds it from now on
      for (const [p, k] of [
        [this.a, 0],
        [this.b, 1],
      ] as [THREE.Vector3, number][]) {
        if (p.z <= PLANK_T || touching(city, p, rubbleAt)) {
          const v = voxelAt(city, p.x, p.y, p.z - VOXEL * 0.6);
          if (k === 0) this.holdA = v;
          else this.holdB = v;
        }
      }
      this.place();
      return true;
    }
    // Swinging down about the held end
    const [pivot, free] = okA ? [this.a, this.b] : [this.b, this.a];
    const arm = free.clone().sub(pivot);
    const len = arm.length();
    const horiz = Math.hypot(arm.x, arm.y);
    // Gravity's turning pull on a board hinged at one end: (3g / 2L)·cos(angle)
    this.spin += ((3 * 9.81) / (2 * len)) * (horiz / len) * dt + 0.5 * dt;
    let angle = Math.atan2(arm.z, horiz) - this.spin * dt;
    angle = Math.max(-Math.PI / 2, angle);
    const dir = horiz > 1e-4 ? new THREE.Vector2(arm.x / horiz, arm.y / horiz) : new THREE.Vector2(1, 0);
    free.set(pivot.x + dir.x * Math.cos(angle) * len, pivot.y + dir.y * Math.cos(angle) * len, pivot.z + Math.sin(angle) * len);
    if (free.z <= PLANK_T || touching(city, free, rubbleAt) || angle <= -Math.PI / 2 + 1e-3) {
      free.z = Math.max(free.z, PLANK_T / 2);
      const v = voxelAt(city, free.x, free.y, free.z - VOXEL * 0.6);
      if (okA) this.holdB = v;
      else this.holdA = v;
      this.spin = 0;
    }
    this.place();
    return true;
  }
}

/** Something under or at a point: a standing voxel, or rubble. */
function touching(city: City, p: THREE.Vector3, rubbleAt: (x: number, y: number, z: number) => boolean): boolean {
  return voxelAt(city, p.x, p.y, p.z - VOXEL * 0.6) >= 0 || voxelAt(city, p.x, p.y, p.z) >= 0 || rubbleAt(p.x, p.y, p.z - VOXEL * 0.6);
}

const plankGeos = new Map<number, THREE.BufferGeometry>();
/** A board: grain in bands of two timber shades, the ends a little darker. */
function plankGeometry(length: number): THREE.BufferGeometry {
  const key = Math.round(length * 10);
  let g = plankGeos.get(key);
  if (g) return g;
  const L = key / 10;
  const parts: { s: [number, number, number]; p: [number, number, number]; c: number }[] = [];
  const n = Math.max(1, Math.round(L / 0.5));
  for (let k = 0; k < n; k++) parts.push({ s: [L / n, PLANK_W, PLANK_T], p: [-L / 2 + (L / n) * (k + 0.5), 0, 0], c: k % 2 ? 0x9a7650 : 0xa7835a });
  for (const s of [-1, 1]) parts.push({ s: [0.04, PLANK_W + 0.01, PLANK_T + 0.01], p: [(s * L) / 2, 0, 0], c: 0x6e5034 });
  g = blocks(parts);
  plankGeos.set(key, g);
  return g;
}

const POINTS = 14;
export class Cable {
  readonly ends: [Anchor, Anchor];
  /** Its length when laid (m): pulled past it, it pulls back. */
  rest: number;
  readonly points: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  readonly object: THREE.InstancedMesh;
  /** Pull now (kN): main.ts tears the anchor out past what it holds. */
  tension = 0;
  cut = false;

  constructor(a: Anchor, b: Anchor, pa: THREE.Vector3, pb: THREE.Vector3) {
    this.ends = [a, b];
    this.rest = Math.max(0.5, pa.distanceTo(pb) * 1.02);
    for (let k = 0; k < POINTS; k++) {
      const p = pa.clone().lerp(pb, k / (POINTS - 1));
      this.points.push(p);
      this.prev.push(p.clone());
    }
    this.object = new THREE.InstancedMesh(cableGeo, steelMat, POINTS - 1);
    this.object.frustumCulled = false;
    this.object.castShadow = true;
  }

  /** Lay the rope between the ends' places now: a Verlet chain, sagging when slack. */
  update(dt: number, pa: THREE.Vector3, pb: THREE.Vector3): void {
    const pts = this.points;
    const d = pa.distanceTo(pb);
    this.tension = d > this.rest ? (d - this.rest) * 80 : 0;
    const seg = Math.max(d, this.rest) / (POINTS - 1);
    for (let k = 1; k < POINTS - 1; k++) {
      const p = pts[k];
      const v = p.clone().sub(this.prev[k]).multiplyScalar(0.95);
      this.prev[k].copy(p);
      p.add(v);
      p.z -= 9.81 * dt * dt;
      if (p.z < 0.03) p.z = 0.03;
    }
    pts[0].copy(pa);
    pts[POINTS - 1].copy(pb);
    for (let it = 0; it < 12; it++) {
      for (let k = 0; k < POINTS - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const dd = b.clone().sub(a);
        const l = dd.length() || 1e-6;
        const corr = dd.multiplyScalar((l - seg) / l / 2);
        if (k > 0) a.add(corr);
        if (k + 1 < POINTS - 1) b.sub(corr);
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let k = 0; k < POINTS - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const dd = b.clone().sub(a);
      const l = dd.length();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dd.divideScalar(l || 1));
      m.compose(a.clone().lerp(b, 0.5), q, new THREE.Vector3(1, 1, l));
      this.object.setMatrixAt(k, m);
    }
    this.object.instanceMatrix.needsUpdate = true;
  }

  /** The nearest the rope comes to `p` (m). */
  distanceTo(p: THREE.Vector3): number {
    let best = Infinity;
    const seg = new THREE.Line3();
    const tmp = new THREE.Vector3();
    for (let k = 0; k < POINTS - 1; k++) {
      seg.set(this.points[k], this.points[k + 1]);
      best = Math.min(best, seg.closestPointToPoint(p, true, tmp).distanceTo(p));
    }
    return best;
  }
}
const cableGeo = new THREE.BoxGeometry(0.08, 0.08, 1);
