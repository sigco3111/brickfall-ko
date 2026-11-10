// The jump detector (tests, Brickfall 1.7): where every voxel is drawn this frame, against where it was drawn the
// frame before. A voxel that moved or turned further in one step than its speed allows (with a little slack for
// gravity and rounding) jumped: a pop the player sees. It reads the same things the voxel shader does (the solver's
// bodies, the section links, the settle tweens), so what it measures is what's on screen.

import { B_ANGVEL, B_POS, B_ROT, B_SIZE, B_VEL, BODY_FLOATS } from 'three-avbd/advanced';

export interface JumpInput {
  bodies: Float32Array;
  links: Float32Array;
  /** Settle tweens (render.ts), if the build has them: from xyz + start time, and from-turn xyz + duration. */
  tweenA?: Float32Array | null;
  tweenB?: Float32Array | null;
  time: number;
  /** Voxel → body, voxel state (world.ts State), and whether a point is in view. */
  body: Int32Array;
  state: Uint8Array;
  inView: (x: number, y: number, z: number) => boolean;
  parkedBelow: number;
  /** Which section a slot carries now (a count that goes up each time a section is made in it). */
  generation?: (slot: number) => number;
}

export interface JumpFrame {
  /** Voxels drawn both frames that jumped (moved or turned past what their speed allows). */
  jumped: number;
  jumpedInView: number;
  /** Largest jump this frame (m, rad), and the transitions (state before > after) the jumps came with. */
  maxMove: number;
  maxTurn: number;
  why: Record<string, number>;
  /** Voxels that vanished in one frame (drawn, then not, with no shrink), in view; and how many were drawn at all. */
  popped: number;
  /**
   * Voxels moved relative to their body (Brickfall 1.8's rule: once in the solver, a voxel only moves with its body):
   * drawn sliding to somewhere other than where its body is, or shifted within the section that carries it.
   */
  morphed: number;
  /** A few of the jumps (tests: what jumped, from where to where). */
  samples: number[][];
  drawn: number;
  moving: number;
}

const STATE = ['F', 'L', 'G', 'R', 'C'];

export class JumpDetector {
  private pos = new Float32Array(0);
  private rot = new Float32Array(0);
  private speed = new Float32Array(0);
  private spin = new Float32Array(0);
  private seen = new Uint8Array(0);
  /** How big it was drawn (dust shrinks away): a pop is something vanishing at full size. */
  private scale = new Float32Array(0);
  private was = new Uint8Array(0);
  private primed = false;
  /** Each voxel's link last frame (offset xyz, parent body or -1). */
  private link = new Float32Array(0);
  private gen = new Float32Array(0);

  reset(): void {
    this.primed = false;
  }

  frame(i: JumpInput, dt = 1 / 60): JumpFrame {
    const n = i.body.length;
    if (this.pos.length !== 3 * n) {
      this.pos = new Float32Array(3 * n);
      this.rot = new Float32Array(4 * n);
      this.speed = new Float32Array(n);
      this.spin = new Float32Array(n);
      this.seen = new Uint8Array(n);
      this.scale = new Float32Array(n);
      this.was = new Uint8Array(n);
      this.primed = false;
    }
    const { bodies, links, tweenA, tweenB, time } = i;
    const out: JumpFrame = { jumped: 0, jumpedInView: 0, maxMove: 0, maxTurn: 0, why: {}, popped: 0, morphed: 0, samples: [], drawn: 0, moving: 0 };
    if (this.link.length !== 4 * n) {
      this.link = new Float32Array(4 * n).fill(-1);
      this.gen = new Float32Array(n);
    }
    const S = BODY_FLOATS;
    const p = [0, 0, 0];
    const q = [0, 0, 0, 1];
    for (let v = 0; v < n; v++) {
      const b = i.body[v];
      const parent = links[4 * b + 3];
      const linked = parent >= 0;
      const o = (linked ? parent : b) * S;
      let [x, y, z] = [bodies[o + B_POS], bodies[o + B_POS + 1], bodies[o + B_POS + 2]];
      [q[0], q[1], q[2], q[3]] = [bodies[o + B_ROT], bodies[o + B_ROT + 1], bodies[o + B_ROT + 2], bodies[o + B_ROT + 3]];
      let vx = bodies[o + B_VEL];
      let vy = bodies[o + B_VEL + 1];
      let vz = bodies[o + B_VEL + 2];
      const [wx, wy, wz] = [bodies[o + B_ANGVEL], bodies[o + B_ANGVEL + 1], bodies[o + B_ANGVEL + 2]];
      if (linked) {
        // The offset turned by the section, and the section's spin carrying it round
        rotateInto(q, [links[4 * b], links[4 * b + 1], links[4 * b + 2]], p);
        vx += wy * p[2] - wz * p[1];
        vy += wz * p[0] - wx * p[2];
        vz += wx * p[1] - wy * p[0];
        x += p[0];
        y += p[1];
        z += p[2];
      }
      let scale = 1;
      let hidden = z < i.parkedBelow || (linked ? bodies[o + B_POS + 2] < i.parkedBelow : bodies[b * S + B_SIZE] > 50);
      // The settle tweens, as the shader draws them
      if (tweenA && tweenB && !linked) {
        const dur = tweenB[4 * b + 3];
        const age = time - tweenA[4 * b + 3];
        const u = dur !== 0 ? Math.min(1, Math.max(0, age / Math.abs(dur))) : 1;
        if (u < 1) {
          const fx = tweenA[4 * b];
          const fy = tweenA[4 * b + 1];
          const fz = tweenA[4 * b + 2];
          const qx = tweenB[4 * b];
          const qy = tweenB[4 * b + 1];
          const qz = tweenB[4 * b + 2];
          const qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
          if (dur < 0) {
            // Shrinking away where it was (dust)
            hidden = false;
            scale = 1 - u;
            [x, y, z] = [fx, fy, fz];
            [q[0], q[1], q[2], q[3]] = [qx, qy, qz, qw];
          } else if (!hidden) {
            const e = u * u;
            x = fx + (x - fx) * e;
            y = fy + (y - fy) * e;
            z = fz + (z - fz) * e;
            const s = qx * q[0] + qy * q[1] + qz * q[2] + qw * q[3] < 0 ? -1 : 1;
            const m = [qx * s + (q[0] - qx * s) * e, qy * s + (q[1] - qy * s) * e, qz * s + (q[2] - qz * s) * e, qw * s + (q[3] - qw * s) * e];
            const l = Math.hypot(m[0], m[1], m[2], m[3]) || 1;
            [q[0], q[1], q[2], q[3]] = [m[0] / l, m[1] / l, m[2] / l, m[3] / l];
            // (Its speed along the tween, for the allowance: the slump falls at up to 2·d/T at its end)
            const d = Math.hypot(fx - bodies[o + B_POS], fy - bodies[o + B_POS + 1], fz - bodies[o + B_POS + 2]);
            // (Easing a few centimetres into where it was frozen is fine; sliding further is a voxel moved off its body)
            if (d > 0.05) {
              out.morphed++;
              out.why['morph:slide'] = (out.why['morph:slide'] ?? 0) + 1;
            }
            vx = 0;
            vy = 0;
            vz = (2 * d * u) / dur;
          }
        }
      }
      const speed = Math.hypot(vx, vy, vz);
      const spin = Math.hypot(wx, wy, wz);
      // Carried by the same section as last frame, at a different place in it: moved relative to its body
      const lk = 4 * v;
      const gen = linked && i.generation ? i.generation(parent) : 0;
      if (linked && this.link[lk + 3] === parent && this.gen[v] === gen && Math.hypot(links[4 * b] - this.link[lk], links[4 * b + 1] - this.link[lk + 1], links[4 * b + 2] - this.link[lk + 2]) > 1e-4) {
        out.morphed++;
        out.why['morph:link'] = (out.why['morph:link'] ?? 0) + 1;
        if (out.samples.length < 6) out.samples.push([-1, v, parent, gen, this.gen[v], links[4 * b], this.link[lk], links[4 * b + 2], this.link[lk + 2]]);
      }
      this.link[lk] = links[4 * b];
      this.link[lk + 1] = links[4 * b + 1];
      this.link[lk + 2] = links[4 * b + 2];
      this.link[lk + 3] = linked ? parent : -1;
      this.gen[v] = gen;
      const st = i.state[v];
      if (!hidden) {
        out.drawn++;
        if (speed > 0.5) out.moving++;
      }
      if (this.primed) {
        const k = 3 * v;
        if (!hidden && this.seen[v]) {
          const move = Math.hypot(x - this.pos[k], y - this.pos[k + 1], z - this.pos[k + 2]);
          const dot = Math.abs(q[0] * this.rot[4 * v] + q[1] * this.rot[4 * v + 1] + q[2] * this.rot[4 * v + 2] + q[3] * this.rot[4 * v + 3]);
          const turn = 2 * Math.acos(Math.min(1, dot));
          const allowMove = Math.max(speed, this.speed[v]) * dt * 1.3 + 0.5 * 9.81 * dt * dt + 0.03;
          const allowTurn = Math.max(spin, this.spin[v]) * dt * 1.3 + 0.06;
          if (move > allowMove || turn > allowTurn) {
            out.jumped++;
            if (i.inView(x, y, z)) out.jumpedInView++;
            out.maxMove = Math.max(out.maxMove, move);
            out.maxTurn = Math.max(out.maxTurn, turn);
            const key = `${STATE[this.was[v]] ?? '?'}>${STATE[st] ?? '?'}`;
            out.why[key] = (out.why[key] ?? 0) + 1;
            if (out.samples.length < 6) out.samples.push([v, this.was[v], st, +this.pos[k].toFixed(2), +this.pos[k + 1].toFixed(2), +this.pos[k + 2].toFixed(2), +x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +this.speed[v].toFixed(2), +speed.toFixed(2), +spin.toFixed(1), linked ? 1 : 0]);
          }
        } else if (hidden && this.seen[v] && this.scale[v] > 0.3 && i.inView(this.pos[k], this.pos[k + 1], this.pos[k + 2])) out.popped++;
      }
      this.pos[3 * v] = x;
      this.pos[3 * v + 1] = y;
      this.pos[3 * v + 2] = z;
      this.rot.set(q, 4 * v);
      this.speed[v] = speed;
      this.spin[v] = spin;
      this.seen[v] = hidden ? 0 : 1;
      this.scale[v] = scale;
      this.was[v] = st;
    }
    this.primed = true;
    return out;
  }
}

function rotateInto(q: number[], v: number[], out: number[]): void {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  out[0] = v[0] + w * tx + (y * tz - z * ty);
  out[1] = v[1] + w * ty + (z * tx - x * tz);
  out[2] = v[2] + w * tz + (x * ty - y * tx);
}
