// What holds the building up, kept as a graph of chunks rather than found among the voxels
// each time. Each object is cut when built into chunks a metre or two across (Voronoi cells
// of jittered-grid seeds, one material each, so pieces part along slabs, walls and windows),
// every chunk connected inside. The graph counts the faces between fixed voxels of
// neighbouring chunks: a voxel that leaves (loosened, blown away) takes its faces with it,
// and a chunk it cuts in two is cut in the graph too, so what the graph says stands is exactly
// what a flood fill through the voxels would say, at a hundredth of the work: the fill runs
// over some 1,500 chunks, not 80,000 voxels (and a crush cascade ran it two dozen times a
// readback). The chunks are the fragments a falling section breaks into (destruction.ts).

import { type Building, CARRY, type City, isGlass, Mat, random, State } from './world.ts';

export interface Chunk {
  building: number;
  /** Its fixed voxels (trimmed as they leave). */
  voxels: number[];
  /** How many of them stand on the ground. */
  ground: number;
  /** Fixed-to-fixed faces shared with each neighbouring chunk. */
  edges: Map<number, number>;
}

/** A connected part of an object no longer standing on the ground, by voxel and by chunk. */
export interface Piece {
  voxels: number[];
  chunks: number[];
}

/** Chunk cell edge (voxels) by material: slabs and roofs in big cells, walls and glass in small. */
const CELL: Record<Mat, number> = {
  [Mat.Concrete]: 10,
  [Mat.Roof]: 10,
  [Mat.Brick]: 6,
  [Mat.Plaster]: 6,
  [Mat.Trim]: 6,
  [Mat.Glass]: 6,
  [Mat.LitGlass]: 6,
  [Mat.Steel]: 6,
  [Mat.Leaf]: 8,
  [Mat.Neon]: 6,
  [Mat.Wood]: 6,
  [Mat.Girder]: 4,
  [Mat.RCConcrete]: 10,
  [Mat.Plastic]: 6,
  [Mat.Dirt]: 8,
  [Mat.Rock]: 12,
};

/**
 * How many times its design load a storey gives way at, per share of what carries it still
 * standing: a layer carries what stood on it when built with a margin, and gives way once a
 * third of what carries it is gone (more once the load above is lighter; four demolition
 * charges round a ground floor take some 40%). Relative to its own design, so a row of ribbon
 * windows is as sound as a solid wall (glass carries nothing).
 */
export const MARGIN = 1.5;

const bump = (edges: Map<number, number>, to: number, by: number) => {
  const n = (edges.get(to) ?? 0) + by;
  if (n > 0) edges.set(to, n);
  else edges.delete(to);
};

export class Structure {
  /** Each voxel's chunk. */
  readonly chunk: Int32Array;
  readonly chunks: Chunk[] = [];
  /** Each object's chunks, and its fixed voxels per layer (overloaded). */
  private readonly byBuilding: number[][];
  private readonly layers: Int32Array[];
  /** Of those, glass (weight, but it carries nothing). */
  private readonly glass: Int32Array[];
  /** What each layer carries: its fixed voxels weighted by material (world.ts CARRY: a girder holds up six bricks' worth). */
  private readonly carries: Float64Array[];
  /** Each layer as built: what carries it, and the voxels above it. */
  private readonly design: { carry: Float64Array; above: Float64Array }[];
  private readonly damaged = new Set<number>();
  /** When each object last lost voxels (s, performance clock): its load is watched for a while after (main.ts). */
  readonly lastHit = new Map<number, number>();
  /** Objects whose steel-carried storey is sagging, and when it lets go (s, performance clock): destruction.ts. */
  readonly fatigue = new Map<number, number>();
  /** The way a sagging object was cut (destruction.ts hinge): it tips that way when it goes. */
  readonly sagCut = new Map<number, number[]>();
  /** The way each object was last cut or blown (and when, s): what comes away from it later still tips that way. */
  readonly lastCut = new Map<number, { way: number[]; at: number }>();
  private readonly city: City;

  /** Whether voxel v holds its object in place: an anchor (the space station's), or on the ground. */
  private holds(v: number): boolean {
    const { city } = this;
    if (city.anchor) return city.anchor[v] === 1;
    const b = city.buildings[city.building[v]];
    return city.cell[v] < b.w * b.d;
  }

  constructor(city: City, seed = 11) {
    this.city = city;
    this.chunk = new Int32Array(city.count).fill(-1);
    this.byBuilding = city.buildings.map(() => []);
    this.layers = city.buildings.map((b) => new Int32Array(b.h));
    this.glass = city.buildings.map((b) => new Int32Array(b.h));
    this.carries = city.buildings.map((b) => new Float64Array(b.h));
    const rnd = random(seed);
    city.buildings.forEach((b, i) => this.cut(i, b, rnd));
    // Faces between chunks, each counted once (towards +x, +y, +z)
    for (let v = 0; v < city.count; v++) {
      if (city.state[v] !== State.Fixed) continue;
      const b = city.buildings[city.building[v]];
      const c = city.cell[v];
      const [x, y] = [c % b.w, Math.floor(c / b.w) % b.d];
      const layer = b.w * b.d;
      this.layers[city.building[v]][Math.floor(c / layer)]++;
      if (isGlass(city.material[v])) this.glass[city.building[v]][Math.floor(c / layer)]++;
      this.carries[city.building[v]][Math.floor(c / layer)] += CARRY[city.material[v] as Mat] ?? 1;
      for (const u of [x + 1 < b.w ? b.cells[c + 1] : -1, y + 1 < b.d ? b.cells[c + b.w] : -1, c + layer < b.cells.length ? b.cells[c + layer] : -1]) {
        if (u < 0 || city.state[u] !== State.Fixed || this.chunk[u] === this.chunk[v]) continue;
        bump(this.chunks[this.chunk[v]].edges, this.chunk[u], 1);
        bump(this.chunks[this.chunk[u]].edges, this.chunk[v], 1);
      }
    }
    this.design = city.buildings.map((b, i) => {
      const carry = Float64Array.from(this.carries[i]);
      const above = new Float64Array(b.h);
      for (let z = b.h - 2; z >= 0; z--) above[z] = above[z + 1] + this.layers[i][z + 1];
      return { carry, above };
    });
  }

  /** Cut object `i` into chunks: nearest same-material seed, then connected parts of each cell. */
  private cut(i: number, b: Building, rnd: () => number): void {
    const { city } = this;
    // A seed per grid cell per material: a random voxel of that material in the cell
    const grid = new Map<number, number[]>();
    const key = (m: number, gx: number, gy: number, gz: number) => ((m * 64 + gx) * 64 + gy) * 64 + gz;
    const at = (c: number) => [c % b.w, Math.floor(c / b.w) % b.d, Math.floor(c / (b.w * b.d))];
    for (let c = 0; c < b.cells.length; c++) {
      const v = b.cells[c];
      if (v < 0 || city.state[v] !== State.Fixed) continue;
      const m = city.material[v] as Mat;
      const [x, y, z] = at(c);
      const s = CELL[m];
      const k = key(m, Math.floor(x / s), Math.floor(y / s), Math.floor(z / s));
      const list = grid.get(k);
      if (list) list.push(v);
      else grid.set(k, [v]);
    }
    const seeds = new Map<number, number>();
    for (const [k, list] of grid) seeds.set(k, list[Math.floor(rnd() * list.length)]);
    // Each voxel to its nearest seed among the neighbouring cells of its material
    const prelim = new Map<number, number[]>();
    for (const list of grid.values()) {
      for (const v of list) {
        const m = city.material[v] as Mat;
        const s = CELL[m];
        const [x, y, z] = at(city.cell[v]);
        const [gx, gy, gz] = [Math.floor(x / s), Math.floor(y / s), Math.floor(z / s)];
        let [best, bestD] = [-1, Infinity];
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const seed = seeds.get(key(m, gx + dx, gy + dy, gz + dz));
              if (seed === undefined) continue;
              const [sx, sy, sz] = at(city.cell[seed]);
              const d = (sx - x) ** 2 + (sy - y) ** 2 + (sz - z) ** 2;
              if (d < bestD) [best, bestD] = [seed, d];
            }
          }
        }
        const cell = prelim.get(best);
        if (cell) cell.push(v);
        else prelim.set(best, [v]);
      }
    }
    // A chunk per connected part of each cell
    const mark = new Int32Array(b.cells.length).fill(-1);
    for (const [seed, list] of prelim) for (const v of list) mark[city.cell[v]] = seed;
    const seen = new Uint8Array(b.cells.length);
    for (const list of prelim.values()) {
      for (const start of list) {
        if (seen[city.cell[start]]) continue;
        const id = this.chunks.length;
        const voxels = [start];
        seen[city.cell[start]] = 1;
        for (let n = 0; n < voxels.length; n++) {
          this.neighbours(b, city.cell[voxels[n]], (u) => {
            const cu = city.cell[u];
            if (!seen[cu] && mark[cu] === mark[city.cell[start]]) {
              seen[cu] = 1;
              voxels.push(u);
            }
          });
        }
        let ground = 0;
        for (const v of voxels) {
          this.chunk[v] = id;
          if (this.holds(v)) ground++;
        }
        this.chunks.push({ building: i, voxels, ground, edges: new Map() });
        this.byBuilding[i].push(id);
      }
    }
  }

  /** The face neighbours of cell `c` of `b` that hold a voxel. */
  private neighbours(b: Building, c: number, fn: (u: number) => void): void {
    const layer = b.w * b.d;
    const x = c % b.w;
    const y = Math.floor(c / b.w) % b.d;
    let u: number;
    if (x > 0 && (u = b.cells[c - 1]) >= 0) fn(u);
    if (x + 1 < b.w && (u = b.cells[c + 1]) >= 0) fn(u);
    if (y > 0 && (u = b.cells[c - b.w]) >= 0) fn(u);
    if (y + 1 < b.d && (u = b.cells[c + b.w]) >= 0) fn(u);
    if (c >= layer && (u = b.cells[c - layer]) >= 0) fn(u);
    if (c + layer < b.cells.length && (u = b.cells[c + layer]) >= 0) fn(u);
  }

  /**
   * Fixed voxels leaving the standing structure (about to be loosened or blown away): their
   * faces leave the graph, and a chunk they cut apart is split so every chunk stays connected.
   * Call before the physics changes their state.
   */
  leave(voxels: ArrayLike<number>): void {
    const { city } = this;
    if (voxels.length) this.lastHit.set(city.building[voxels[0]], performance.now() / 1000);
    const done = new Set<number>();
    for (let k = 0; k < voxels.length; k++) {
      const v = voxels[k];
      if (city.state[v] !== State.Fixed || done.has(v)) continue;
      done.add(v);
      const id = this.chunk[v];
      const ch = this.chunks[id];
      const b = city.buildings[ch.building];
      const c = city.cell[v];
      const layer = b.w * b.d;
      this.layers[ch.building][Math.floor(c / layer)]--;
      if (isGlass(city.material[v])) this.glass[ch.building][Math.floor(c / layer)]--;
      this.carries[ch.building][Math.floor(c / layer)] -= CARRY[city.material[v] as Mat] ?? 1;
      if (this.holds(v)) ch.ground--;
      this.neighbours(b, c, (u) => {
        if (city.state[u] !== State.Fixed || done.has(u)) return;
        const other = this.chunk[u];
        if (other === id) return;
        bump(ch.edges, other, -1);
        bump(this.chunks[other].edges, id, -1);
      });
      this.damaged.add(id);
    }
    for (const id of this.damaged) this.split(id, done);
    this.damaged.clear();
  }

  /** Chunk `id` lost voxels (`gone`): keep its connected parts as chunks of their own. */
  private split(id: number, gone: Set<number>): void {
    const { city } = this;
    const ch = this.chunks[id];
    const b = city.buildings[ch.building];
    const live = ch.voxels.filter((v) => city.state[v] === State.Fixed && !gone.has(v));
    const seen = new Set<number>();
    const parts: number[][] = [];
    for (const start of live) {
      if (seen.has(start)) continue;
      const part = [start];
      seen.add(start);
      for (let n = 0; n < part.length; n++) {
        this.neighbours(b, city.cell[part[n]], (u) => {
          if (!seen.has(u) && this.chunk[u] === id && city.state[u] === State.Fixed && !gone.has(u)) {
            seen.add(u);
            part.push(u);
          }
        });
      }
      parts.push(part);
    }
    parts.sort((x, y) => y.length - x.length);
    ch.voxels = parts[0] ?? [];
    ch.ground = ch.voxels.filter((v) => this.holds(v)).length;
    for (const part of parts.slice(1)) {
      const nid = this.chunks.length;
      const nc: Chunk = { building: ch.building, voxels: part, ground: 0, edges: new Map() };
      this.chunks.push(nc);
      this.byBuilding[ch.building].push(nid);
      for (const v of part) this.chunk[v] = nid;
      for (const v of part) {
        const c = city.cell[v];
        if (this.holds(v)) nc.ground++;
        // Parts share no face, so every fixed neighbour outside the part is in another chunk
        this.neighbours(b, c, (u) => {
          if (city.state[u] !== State.Fixed || gone.has(u)) return;
          const o = this.chunk[u];
          if (o === nid) return;
          bump(ch.edges, o, -1);
          bump(this.chunks[o].edges, id, -1);
          bump(nc.edges, o, 1);
          bump(this.chunks[o].edges, nid, 1);
        });
      }
    }
  }

  /** The parts of object `i` no longer joined to the ground through fixed voxels. */
  unsupported(i: number): Piece[] {
    const ids = this.byBuilding[i];
    const reached = new Set<number>();
    const queue: number[] = [];
    for (const id of ids) {
      const ch = this.chunks[id];
      if (ch.ground > 0 && ch.voxels.length > 0) {
        reached.add(id);
        queue.push(id);
      }
    }
    const flood = (set: Set<number>, from: number[], ok: (id: number) => boolean) => {
      for (let n = 0; n < from.length; n++) {
        for (const [o, faces] of this.chunks[from[n]].edges) {
          if (faces > 0 && !set.has(o) && ok(o)) {
            set.add(o);
            from.push(o);
          }
        }
      }
    };
    flood(reached, queue, () => true);
    const pieces: Piece[] = [];
    const taken = new Set<number>();
    for (const id of ids) {
      if (reached.has(id) || taken.has(id) || this.chunks[id].voxels.length === 0) continue;
      const chunks = [id];
      taken.add(id);
      flood(taken, chunks, (o) => !reached.has(o));
      pieces.push({ chunks, voxels: chunks.flatMap((c) => this.chunks[c].voxels) });
    }
    return pieces;
  }

  /**
   * The fixed voxels of object `i`'s weakest storey, if it can no longer carry what stands on
   * it (MARGIN), or none. A blown-out storey crushes, and everything above it comes down.
   */
  overloaded(i: number): number[] {
    const { z: worst, r } = this.stress(i);
    if (worst < 0 || r <= 1) return [];
    // The storey buckles, not a layer of it: the weakest layer and those above it up to the next slab (a full
    // layer), at most 3.5 m. One layer gave way before, and the building dropped a quarter of a metre, landed
    // on the layer under it and stood there: a whole tower turned to rubble in the air, a storey up.
    const counts = this.layers[i];
    let full = 0;
    for (let z = 0; z < counts.length; z++) full = Math.max(full, counts[z]);
    const out = this.layerVoxels(i, worst);
    for (let z = worst + 1; z < Math.min(counts.length, worst + 14); z++) {
      if (counts[z] >= full * 0.75) break;
      out.push(...this.layerVoxels(i, z));
    }
    return out;
  }

  /**
   * How close object `i` is to giving way: the most loaded layer `z` and its load `r` against what it can carry
   * (above 1 it goes; a building as built stands at 1/MARGIN). r is 0 and z -1 for one that carries nothing.
   */
  stress(i: number): { z: number; r: number } {
    // In orbit nothing weighs anything
    if (this.city.weightless) return { z: -1, r: 0 };
    const b = this.city.buildings[i];
    const count = this.layers[i];
    const carries = this.carries[i];
    const design = this.design[i];
    let [worst, ratio, above] = [-1, 0, 0];
    for (let z = b.h - 1; z >= 0; z--) {
      // Load against strength, each as a share of the design's (a layer that never carried
      // anything, a car's glass, holds nothing up)
      const carry = carries[z];
      if (design.carry[z] > 0 && count[z] > 0 && above > 0) {
        const r = carry > 1e-6 ? (above / design.above[z]) * (design.carry[z] / carry) / MARGIN : Infinity;
        if (r > ratio) [worst, ratio] = [z, r];
      }
      above += count[z];
    }
    return { z: worst, r: ratio };
  }

  /** Each layer's load against what it can carry (as stress), for the load overlay; 0 where it carries nothing. */
  layerStress(i: number): Float32Array {
    const b = this.city.buildings[i];
    const out = new Float32Array(b.h);
    if (this.city.weightless) return out;
    const count = this.layers[i];
    const design = this.design[i];
    let above = 0;
    for (let z = b.h - 1; z >= 0; z--) {
      if (design.carry[z] > 0 && count[z] > 0 && above > 0) out[z] = this.carries[i][z] > 1e-6 ? Math.min(2, ((above / design.above[z]) * (design.carry[z] / this.carries[i][z])) / MARGIN) : 2;
      above += count[z];
    }
    return out;
  }

  /** The fixed voxels of layer `z` of object `i`. */
  layerVoxels(i: number, z: number): number[] {
    const b = this.city.buildings[i];
    const out: number[] = [];
    const layer = b.w * b.d;
    for (let c = z * layer; c < (z + 1) * layer; c++) {
      const v = b.cells[c];
      if (v >= 0 && this.city.state[v] === State.Fixed) out.push(v);
    }
    return out;
  }

  /** The most common material carrying layer `z` of object `i` (by what it carries), for its creak or groan. */
  layerMaterial(i: number, z: number): number {
    const tally = new Map<number, number>();
    for (const v of this.layerVoxels(i, z)) {
      const m = this.city.material[v];
      tally.set(m, (tally.get(m) ?? 0) + (CARRY[m as Mat] ?? 1));
    }
    let [best, most] = [Mat.Concrete as number, -1];
    for (const [m, n] of tally) if (n > most) [best, most] = [m, n];
    return best;
  }

  /** Fixed voxels per layer of object `i` (tests). */
  layerCounts(i: number): Int32Array {
    return this.layers[i];
  }
}
