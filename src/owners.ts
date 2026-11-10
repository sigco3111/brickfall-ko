// The owner check (tests, Brickfall 1.7.1): every voxel that's drawn, by either voxel mesh (the solid one, and the
// clear glass's own), must be drawn where its physics says it is: a fixed voxel at home in its building, a loose one
// as its own moving body, a carried one on a section that exists and carries it, rubble as a fixed body where the
// rubble list says it lies. Anything drawn otherwise has no owner: it can't be walked on or hit, and it's left
// hanging (Blendi's floating panes). Settle tweens still running count too: after a collapse has settled, none are.

import { B_POS, B_SIZE, BODY_FLOATS } from 'three-avbd/advanced';
import { Mat, State } from './world.ts';

export interface OwnerInput {
  bodies: Float32Array;
  links: Float32Array;
  paints: Float32Array;
  tweenA?: Float32Array | null;
  tweenB?: Float32Array | null;
  time: number;
  body: Int32Array;
  state: Uint8Array;
  material: Uint8Array;
  exposed: Uint8Array;
  home: Float32Array;
  rest: Float32Array;
  rubble: Set<number>;
  /** Section slot → its voxels. */
  sections: Map<number, Set<number>>;
  parkedBelow: number;
}

export interface Orphan {
  v: number;
  why: string;
  mat: number;
  state: number;
  at: number[];
}

export function owners(i: OwnerInput): { drawn: number; glassDrawn: number; tweening: number; orphans: Orphan[]; byWhy: Record<string, number> } {
  const S = BODY_FLOATS;
  const orphans: Orphan[] = [];
  const byWhy: Record<string, number> = {};
  let drawn = 0;
  let glassDrawn = 0;
  let tweening = 0;
  const bad = (v: number, why: string, at: number[]) => {
    byWhy[why] = (byWhy[why] ?? 0) + 1;
    if (orphans.length < 400) orphans.push({ v, why, mat: i.material[v], state: i.state[v], at: at.map((x) => +x.toFixed(2)) });
  };
  for (let v = 0; v < i.body.length; v++) {
    const b = i.body[v];
    const parent = i.links[4 * b + 3];
    const linked = parent >= 0;
    const o = (linked ? parent : b) * S;
    const own = [i.bodies[b * S + B_POS], i.bodies[b * S + B_POS + 1], i.bodies[b * S + B_POS + 2]];
    const parkedNow = linked ? i.bodies[o + B_POS + 2] < i.parkedBelow : own[2] < i.parkedBelow || i.bodies[b * S + B_SIZE] > 50;
    const painted = i.paints[4 * b + 3] >= 0;
    const mat = i.material[v];
    // A settle tween still running
    let vanishing = false;
    if (i.tweenA && i.tweenB && !linked) {
      const dur = i.tweenB[4 * b + 3];
      const u = dur !== 0 ? (i.time - i.tweenA[4 * b + 3]) / Math.abs(dur) : 1;
      if (u < 1) {
        tweening++;
        vanishing = dur < 0;
      }
    }
    const clear = mat === Mat.Glass;
    const solid = painted && !clear && (!parkedNow || vanishing);
    const glass = painted && clear && i.exposed[v] > 0 && !parkedNow;
    if (glass) glassDrawn++;
    if (!solid && !glass) continue;
    drawn++;
    const st = i.state[v];
    const fixedBody = i.bodies[b * S + B_SIZE + 3] <= 0;
    const at = linked ? [i.bodies[o + B_POS], i.bodies[o + B_POS + 1], i.bodies[o + B_POS + 2]] : own;
    if (vanishing) continue;
    if (st === State.Gone) bad(v, 'gone but drawn', at);
    else if (st === State.Fixed) {
      if (linked) bad(v, 'fixed but carried', at);
      else if (!fixedBody) bad(v, 'fixed but a moving body', at);
      else if (Math.hypot(own[0] - i.home[3 * v], own[1] - i.home[3 * v + 1], own[2] - i.home[3 * v + 2]) > 0.01) bad(v, 'fixed away from home', at);
    } else if (st === State.Loose) {
      if (linked) bad(v, 'loose but carried', at);
      else if (fixedBody) bad(v, 'loose but a fixed body', at);
    } else if (st === State.Carried) {
      if (!linked) bad(v, 'carried by nothing', at);
      else if (!i.sections.get(parent)?.has(v)) bad(v, 'carried by a section that has gone', at);
    } else if (st === State.Rubble) {
      if (linked) bad(v, 'rubble but carried', at);
      else if (!i.rubble.has(v)) bad(v, 'rubble not on the list', at);
      else if (!fixedBody) bad(v, 'rubble but a moving body', at);
      else if (Math.hypot(own[0] - i.rest[7 * v], own[1] - i.rest[7 * v + 1], own[2] - i.rest[7 * v + 2]) > 0.01) bad(v, 'rubble away from where it lies', at);
    }
  }
  return { drawn, glassDrawn, tweening, orphans, byWhy };
}
