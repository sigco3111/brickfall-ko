// Brickfall's contracts: three small sites, each a handful of voxel objects on one lot. Built with
// world.ts's builder (every voxel a body, anchored on the ground), plus what the game layer needs
// to know about them: which objects are the job, which must be left standing, which go up in a
// fireball when hit, where the player starts, the clock, the charges and the light.

import { bin, buildCity, car, type City, lamp, M, Mat, random, tree, VOXEL, type WorldBuilder, worldBuilder } from './world.ts';

export interface Level {
  id: number;
  name: string;
  /** One line under the name on the contract card. */
  brief: string;
  /** What the target bar is called (the job). */
  job: string;
  /** Seconds on the clock. */
  time: number;
  /** Demolition charges for the whole contract. */
  charges: number;
  /** Objects that are the job (indices into city.buildings). */
  targets: number[];
  /** Objects to leave standing (a bonus if they are). */
  keep: number[];
  keepName: string;
  /** Objects that explode when hit (propane tanks, fuel drums). */
  barrels: number[];
  /** A ring on the ground to drop the target into (centre, radius, m), and the object that must land in it. */
  zone?: { x: number; y: number; r: number; object: number };
  /** Start: feet position (m), yaw and pitch (rad). */
  spawn: [number, number, number, number];
  /** Fly-in: where the camera starts and what it looks at, before handing over to the player. */
  intro: { from: [number, number, number]; look: [number, number, number] };
  /** Time of day (hours) for the sky. */
  hour: number;
  /** The player stays within this many metres of the lot's middle (x and y). */
  bounds: number;
  /** Ground: a grass lot (true) or the paved city block (false). */
  grass: boolean;
  /** Middle of the job (m), for the end-of-contract camera. */
  focus: [number, number, number];
  /** The sun's direction round the sky (rad from +x), to light the job from the player's side. */
  sunAz?: number;
  /** The sun's height (degrees), overriding the sky's own. */
  sunEl?: number;
  /** Star thresholds on the job's demolition share. */
  stars: [number, number, number];
  /** Cutter charges and rockets for the contract (0: none). */
  cutters?: number;
  rockets?: number;
  pipes?: number;
  /** Gas lines (objects): break one and it goes up along its length. */
  gas?: number[];
  /** The sea's surface (m), if the lot stands in water: it fills the lot and runs to the horizon. */
  sea?: number;
  /** Where a water tank stands (m: x0, y0, z0, x1, y1, z1): holed, it pours. */
  tankBox?: [number, number, number, number, number, number];
  /** The feet's height at the start (m), for a start up on a deck. */
  spawnZ?: number;
  /** Planks and cables for the contract (default 8 and 6). */
  planks?: number;
  cables?: number;
  /** Sandbox: props waiting off the lot for the spawn menu, by kind (objects). */
  pool?: Record<string, number[]>;
  /** A heist (Salvage mode): the loot, the alarm boxes and the getaway truck. */
  heist?: HeistSpec;
  /** Machines parked on the lot (machines.ts): kind, where (m) and facing (rad). Not in a blowdown. */
  machines?: { kind: 'crane' | 'excavator'; at: [number, number]; heading: number }[];
}

/** A heist's set-up: the loot (props, not voxels: they fall when what they sit on goes), the alarm boxes (each on a wall voxel: break that and the alarm goes), the truck. */
export interface HeistSpec {
  loot: { name: string; look: 'gold' | 'drive' | 'ledger' | 'paintings' | 'watches' | 'cash'; at: [number, number, number]; required: boolean }[];
  /** Where each box sits (m) and the way it faces (unit, horizontal). */
  alarms: { at: [number, number, number]; facing: [number, number] }[];
  truck: { at: [number, number]; heading: number };
  /** Seconds from the alarm to the getaway. */
  alarm: number;
}

/** The sandbox's spawn menu: what it offers. */
export const SPAWNS = [
  { kind: 'propane', name: 'Propane tank' },
  { kind: 'drum', name: 'Fuel drum' },
  { kind: 'bottles', name: 'Gas bottles' },
  { kind: 'car', name: 'Car' },
  { kind: 'crates', name: 'Crates' },
  { kind: 'tanker', name: 'Fuel tanker' },
] as const;

/** Whether the lot being built gets the sandbox's spawn pool, and the pool it got. */
let withPool = false;
let lastPool: Record<string, number[]> = {};
/**
 * The sandbox's props, waiting in a row far off the lot (behind the start, 36 m out) until the spawn menu moves
 * one onto it: built with the lot, so they cost nothing to bring in.
 */
function spawnPool(w: WorldBuilder): void {
  lastPool = {};
  const add = (kind: string) => (lastPool[kind] ??= []).push(w.count() - 1);
  let x = -26;
  const next = (step: number) => {
    const at = x;
    x += step;
    return at;
  };
  for (let k = 0; k < 6; k++) {
    barrel(w, next(2), -36, PROPANE, 5);
    add('propane');
  }
  for (let k = 0; k < 4; k++) {
    barrel(w, next(2), -36, 0x3d6b8a, 4);
    add('drum');
  }
  for (let k = 0; k < 4; k++) {
    bottles(w, next(1.8), -36);
    add('bottles');
  }
  for (let k = 0; k < 3; k++) {
    car(w, next(5.5), -36, [0x2f5f8a, 0x8a2f2f, 0xd9d4c8][k]);
    add('car');
  }
  for (let k = 0; k < 2; k++) {
    crates(w, next(4), -36, 40 + k);
    add('crates');
  }
  tanker(w, next(9), -36);
  add('tanker');
}
/** Finish a lot (with the spawn pool when it's for the sandbox). */
function finishLot(w: WorldBuilder, grid: { pitch: number; street: number; blocks: number }): City {
  lastPool = {};
  if (withPool) spawnPool(w);
  return w.finish(grid);
}
/** Which of the pool's objects are barrels (they go up). */
const poolBarrels = () => [...(lastPool.propane ?? []), ...(lastPool.drum ?? []), ...(lastPool.bottles ?? []), ...(lastPool.tanker ?? [])];

/** A cage of gas bottles: four tall thin cylinders, red and white. */
function bottles(w: WorldBuilder, cx: number, cy: number): void {
  w.place(Math.round(cx * M) - 3, Math.round(cy * M) - 3, 6, 6, 7, (put) => {
    for (const [bx, by] of [
      [1, 1],
      [3, 1],
      [1, 3],
      [3, 3],
    ])
      for (let z = 0; z < 6; z++) {
        put(bx, by, z, Mat.Steel, z === 5 ? 0x8a8e92 : z % 2 ? 0xc8392b : 0xe8e2d4);
        put(bx + 1, by, z, Mat.Steel, z === 5 ? 0x8a8e92 : 0xc8392b);
      }
  });
  w.last().kind = 'barrel';
}

/** A fuel tanker: a long steel tank on a trailer and a cab; it goes up hugely. */
function tanker(w: WorldBuilder, cx: number, cy: number): void {
  const [L, Wd, H] = [36, 10, 14];
  w.place(Math.round(cx * M) - L / 2, Math.round(cy * M) - Wd / 2, L, Wd, H, (put) => {
    for (let x = 0; x < L; x++)
      for (let y = 0; y < Wd; y++) {
        // Wheels and the chassis
        if ((x % 9 === 1 || x % 9 === 2) && (y === 0 || y === Wd - 1)) for (let z = 0; z < 3; z++) put(x, y, z, Mat.Steel, 0x151515);
        put(x, y, 3, Mat.Steel, 0x2a2c30);
        if (x < 8) {
          // The cab
          for (let z = 4; z < 11; z++) put(x, y, z, z > 7 && x > 1 && x < 7 && (y === 0 || y === Wd - 1 || x === 1) ? Mat.Glass : Mat.Steel, 0xd9a21b);
          continue;
        }
        const r = Math.hypot(y + 0.5 - Wd / 2, 0);
        for (let z = 4; z < 13; z++) if (Math.hypot(y + 0.5 - Wd / 2, z + 0.5 - 8.5) < 4.8) put(x, y, z, Mat.Steel, x % 6 === 0 ? 0x8a8e92 : 0xd9d4c8);
        void r;
      }
  });
  w.last().kind = 'barrel';
}

export const LEVELS = [
  { id: 0, name: 'The Starter Home', job: 'House', brief: 'Bring the house down. Leave the neighbour’s shed standing.' },
  { id: 1, name: 'The Water Tower', job: 'Tower', brief: 'Topple the water tower into the ring behind it.' },
  { id: 2, name: 'The Corner Tower', job: 'Tower', brief: 'Eleven storeys of concrete. Bring them all down.' },
  { id: 3, name: 'The Farm', job: 'Barn and silo', brief: 'Flatten the old barn and lay the silo down in the field.' },
  { id: 4, name: 'The Chimney', job: 'Chimney', brief: 'Drop the brick chimney down the yard. Spare the boiler house.' },
  { id: 5, name: 'The Car Park', job: 'Car park', brief: 'Five decks of concrete and cars. Pancake every one.' },
  { id: 6, name: 'The Petrol Station', job: 'Station', brief: 'Bring down the canopy and the shop. The gas lines are live.' },
  { id: 7, name: 'The Warehouse', job: 'Loot', brief: 'Four pieces to take, two worth a detour. The first one you lift sets off the alarm.' },
  { id: 8, name: 'The Pier', job: 'Pier end', brief: 'Drop the boathouse and the end of the pier into the sea. Spare the lighthouse.' },
  { id: 9, name: 'The Quarry', job: 'Crusher plant', brief: 'Take down the crusher house and its conveyor. Their frames are steel: bring cutters.' },
  { id: 10, name: 'The Church', job: 'Steeple', brief: 'Bring the stone steeple down beside the nave, not onto it.' },
] as const;

/** Which lots each mode offers: the heists have their own. */
export const HEIST_LOTS = [7];
export const lotsFor = (heist: boolean): number[] => (heist ? HEIST_LOTS : LEVELS.map((l) => l.id).filter((id) => !HEIST_LOTS.includes(id)).sort((a, b) => a - b));

type Put = (x: number, y: number, z: number, m: Mat, colour?: number) => void;

const PLASTER = 0xe6dbc2;
const TRIM = 0xf1ebdc;
const MUSTARD = 0xd3a136;
const TEAL = 0x2f6f74;
const SLATE = 0x4b4e57;
const FENCE = 0xa97c48;
const PROPANE = 0xc8392b;

/** Build contract `id` (0, 1, 2) with `seed` (the small variations: brick shades, which windows are lit). */
export function buildLevel(id: number, seed = 7, pool = false): { city: City; level: Level } {
  withPool = pool;
  const built = id === 10 ? church(seed) : id === 9 ? quarry(seed) : id === 8 ? pier(seed) : id === 7 ? warehouse(seed) : id === 6 ? petrol(seed) : id === 5 ? carPark(seed) : id === 4 ? chimney(seed) : id === 3 ? farm(seed) : id === 2 ? corner(seed) : id === 1 ? waterTower(seed) : starterHome(seed);
  if (pool) {
    built.level.pool = lastPool;
    built.level.barrels = [...built.level.barrels, ...poolBarrels()];
  }
  withPool = false;
  return built;
}

/** A propane tank or fuel drum: a short cylinder of steel, painted, with a band and a cap. */
function barrel(w: WorldBuilder, cx: number, cy: number, colour = PROPANE, tall = 5): number {
  const r = 1.6;
  const n = 4;
  w.place(Math.round(cx * M) - 2, Math.round(cy * M) - 2, n, n, tall + 1, (put) => {
    for (let z = 0; z < tall; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          if (Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) > r + 0.3) continue;
          put(x, y, z, Mat.Steel, z === 1 || z === tall - 2 ? 0xe8e2d4 : colour);
        }
    put(1, 1, tall, Mat.Steel, 0x8a8e92);
    put(2, 2, tall, Mat.Steel, 0x8a8e92);
  });
  const b = w.last();
  b.kind = 'barrel';
  return 0;
}

/** A line of voxels from a to b (cells), stepping one axis at a time so every voxel shares a face with the last. */
function line(put: Put, a: number[], b: number[], m: Mat, colour?: number): void {
  let at = [Math.round(a[0]), Math.round(a[1]), Math.round(a[2])];
  put(at[0], at[1], at[2], m, colour);
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 1.5);
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    const to = [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f));
    for (const i of [2, 0, 1]) {
      while (at[i] !== to[i]) {
        at = [...at];
        at[i] += Math.sign(to[i] - at[i]);
        put(at[0], at[1], at[2], m, colour);
      }
    }
  }
}

/** A picket fence along x from x0 to x1 (m) at y (m), with a gap for a gate between g0 and g1. */
function fence(w: WorldBuilder, x0: number, x1: number, y: number, g0 = 1e9, g1 = -1e9): void {
  const len = Math.round((x1 - x0) * M);
  w.place(Math.round(x0 * M), Math.round(y * M), len, 1, 5, (put) => {
    for (let x = 0; x < len; x++) {
      const at = x0 + x / M;
      if (at > g0 && at < g1) continue;
      const picket = x % 2 === 0;
      const shade = picket ? FENCE : 0xb48a52;
      if (picket) for (let z = 0; z < 4; z++) put(x, 0, z, Mat.Wood, z === 3 ? 0xbf9560 : shade);
      put(x, 0, 1, Mat.Wood, 0x8a6538);
      put(x, 0, 3, Mat.Wood, 0x8a6538);
      if (x % 8 === 0) put(x, 0, 0, Mat.Wood, 0x8a6a3c);
    }
  });
}

/** A hedge: a block of leaves, lumpy on top. */
function hedge(w: WorldBuilder, x0: number, y0: number, x1: number, y1: number, h = 5, seed = 3): void {
  const r = random(seed);
  const [W, D] = [Math.round((x1 - x0) * M), Math.round((y1 - y0) * M)];
  const greens = [0x4d6b34, 0x587a3a, 0x648842, 0x6f9248];
  w.place(Math.round(x0 * M), Math.round(y0 * M), W, D, h + 2, (put) => {
    for (let y = 0; y < D; y++)
      for (let x = 0; x < W; x++) {
        const top = h + (r() < 0.35 ? 1 : 0) - (r() < 0.15 ? 1 : 0);
        for (let z = 0; z < top; z++) put(x, y, z, Mat.Leaf, greens[Math.min(3, Math.floor((z / h) * 3 + r()))]);
      }
  });
}

/** A boulder of bedrock (nothing breaks it): a lumpy blob `rx` × `ry` × `h` m. */
function boulder(w: WorldBuilder, cx: number, cy: number, rx: number, ry: number, h: number, seed = 4): void {
  const r = random(seed);
  const [W, D, H] = [Math.ceil(rx * 2 * M), Math.ceil(ry * 2 * M), Math.ceil(h * M)];
  const greys = [0xa39e94, 0x948f86, 0xb0aba1, 0x89857d];
  w.place(Math.round(cx * M) - Math.floor(W / 2), Math.round(cy * M) - Math.floor(D / 2), W, D, H + 1, (put) => {
    for (let z = 0; z < H; z++)
      for (let y = 0; y < D; y++)
        for (let x = 0; x < W; x++) {
          const u = [(x + 0.5) / W - 0.5, (y + 0.5) / D - 0.5, (z + 0.5) / (H * 2)];
          const d = Math.hypot(u[0] * 2, u[1] * 2, u[2] * 2) + (r() - 0.5) * 0.18;
          if (d < 1) put(x, y, z, Mat.Rock, greys[Math.floor(r() * greys.length)]);
        }
  });
}

/** A raised bed of dirt (soft: anything breaks it), `w` × `d` m, `h` voxels. */
function dirtBed(w: WorldBuilder, x0: number, y0: number, x1: number, y1: number, h = 2): void {
  const [W, D] = [Math.round((x1 - x0) * M), Math.round((y1 - y0) * M)];
  w.place(Math.round(x0 * M), Math.round(y0 * M), W, D, h + 1, (put) => {
    for (let y = 0; y < D; y++)
      for (let x = 0; x < W; x++) {
        const edge = x === 0 || y === 0 || x === W - 1 || y === D - 1;
        for (let z = 0; z < h; z++) put(x, y, z, edge ? Mat.Wood : Mat.Dirt, edge ? 0x7a5a38 : (x * 7 + y * 3) % 5 === 0 ? 0x4e3a28 : undefined);
        if (!edge && (x + 2 * y) % 4 === 0) put(x, y, h, Mat.Leaf, 0x6f9248);
      }
  });
}

/** A stack of wooden crates. */
function crates(w: WorldBuilder, cx: number, cy: number, seed = 5): void {
  const r = random(seed);
  w.place(Math.round(cx * M) - 6, Math.round(cy * M) - 4, 12, 8, 10, (put) => {
    const crate = (x0: number, y0: number, z0: number) => {
      for (let z = 0; z < 4; z++)
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const edge = (x === 0 || x === 3 ? 1 : 0) + (y === 0 || y === 3 ? 1 : 0) + (z === 0 || z === 3 ? 1 : 0) >= 2;
            put(x0 + x, y0 + y, z0 + z, Mat.Wood, edge ? 0x7a5532 : 0xb48a52);
          }
    };
    crate(0, 0, 0);
    crate(4, 0, 0);
    crate(8, 1, 0);
    crate(2, 4, 0);
    crate(6, 4, 0);
    crate(2, 1, 4);
    if (r() < 0.8) crate(5, 2, 4);
    crate(4, 3, 8 - 4 + 0);
  });
}

/**
 * Level 1: a two-storey brick house with a cream rendered front, a mustard band between the
 * floors, white window frames and a slate gable roof with a chimney; a garden shed next door that
 * should survive, two propane tanks by the front corner, a picket fence, a hedge, a tree and the
 * owner's car on the drive.
 */
function starterHome(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const { box } = w;
  const targets: number[] = [];
  const keep: number[] = [];
  const barrels: number[] = [];
  // The house: 9 x 7 m, its middle at (0, 2), front facing -y
  const W = 36;
  const D = 28;
  const PAD = 2;
  const STOREY = 12;
  const TOP = 2 * STOREY;
  const RIDGE = TOP + D / 2 + 2;
  w.place(-W / 2 - PAD, 2 * M - D / 2 - PAD, W + 2 * PAD, D + 2 * PAD, RIDGE + 6, (put) => {
    const P = (x: number, y: number, z: number, m: Mat, c?: number) => put(x + PAD, y + PAD, z, m, c);
    const rnd = random(seed + 1);
    // Openings in a wall: [face, from (along the wall), width, z0, z1, kind]
    type Opening = [number, number, number, number, number, 'window' | 'door'];
    const openings: Opening[] = [
      [0, 5, 6, 4, 10, 'window'],
      [0, 15, 5, 1, 10, 'door'],
      [0, 24, 7, 4, 10, 'window'],
      [0, 5, 6, 16, 22, 'window'],
      [0, 15, 6, 16, 22, 'window'],
      [0, 25, 6, 16, 22, 'window'],
      [1, 6, 6, 4, 10, 'window'],
      [1, 20, 6, 4, 10, 'window'],
      [1, 6, 6, 16, 22, 'window'],
      [1, 22, 6, 16, 22, 'window'],
      [2, 9, 6, 4, 10, 'window'],
      [2, 9, 6, 16, 22, 'window'],
      [3, 9, 6, 4, 10, 'window'],
      [3, 17, 6, 16, 22, 'window'],
    ];
    // Face 0: front (y = 0), 1: back (y = D-1), 2: left (x = 0), 3: right (x = W-1); `a` along it
    const faceOf = (x: number, y: number): [number, number] => (y === 0 ? [0, x] : y === D - 1 ? [1, x] : x === 0 ? [2, y] : [3, y]);
    for (let z = 0; z <= TOP; z++) {
      for (let y = 0; y < D; y++) {
        for (let x = 0; x < W; x++) {
          const wall = x === 0 || y === 0 || x === W - 1 || y === D - 1;
          if (z === 0) {
            // The foundation: reinforced concrete (nothing but a charge breaks it)
            P(x, y, z, Mat.RCConcrete, 0xa8a49b);
            continue;
          }
          if (z === STOREY || z === TOP) {
            // The floor (and the ceiling under the roof): timber boards; the mustard band outside
            if (wall) P(x, y, z, z === STOREY ? Mat.Trim : Mat.Trim, z === STOREY ? MUSTARD : TRIM);
            else P(x, y, z, Mat.Wood, (x + y) % 5 === 0 ? 0x8a6440 : 0x9c7149);
            continue;
          }
          if (!wall) continue;
          const [face, a] = faceOf(x, y);
          const open = openings.find(([f, from, width, z0, z1]) => f === face && a >= from && a < from + width && z >= z0 && z < z1);
          const upper = z > STOREY;
          const rendered = face === 0 && !upper;
          const wallMat = rendered ? Mat.Plaster : Mat.Brick;
          const wallColour = rendered ? PLASTER : undefined;
          if (!open) {
            // A frame round each opening: the cells just outside it
            const framed = openings.some(([f, from, width, z0, z1]) => f === face && a >= from - 1 && a <= from + width && z >= z0 - 1 && z <= z1);
            if (framed) P(x, y, z, Mat.Trim, TRIM);
            else P(x, y, z, wallMat, wallColour);
            continue;
          }
          const [, from, width, z0, , kind] = open;
          if (kind === 'door') {
            P(x, y, z, Mat.Wood, a === from + width - 2 && z === 5 ? 0xd9c27a : TEAL);
            continue;
          }
          // Glass with a cross of glazing bars
          const bar = a === from + Math.floor(width / 2) || z === z0 + 3;
          if (bar) P(x, y, z, Mat.Trim, TRIM);
          else P(x, y, z, rnd() < 0.0 ? Mat.LitGlass : Mat.Glass);
        }
      }
    }
    // Inside: a wall across the ground floor with a doorway, a sofa, a table, a bookcase, a bed upstairs
    for (let z = 1; z < STOREY; z++) for (let y = 1; y < D - 1; y++) if (!(y > 10 && y < 16 && z < 9)) P(20, y, z, Mat.Plaster, 0xd8ccb2);
    box(P, 3, 18, 1, 12, 23, 3, Mat.Wood, 0x7a4b3a);
    box(P, 3, 23, 1, 12, 26, 5, Mat.Wood, 0x6a3f30);
    box(P, 24, 6, 3, 31, 11, 4, Mat.Wood, 0xc8ab82);
    for (const [lx, ly] of [
      [24, 6],
      [30, 6],
      [24, 10],
      [30, 10],
    ])
      box(P, lx, ly, 1, lx + 1, ly + 1, 3, Mat.Wood, 0x6b4a30);
    box(P, 32, 16, 1, 34, 25, 10, Mat.Wood, 0x5a3c26);
    for (let z = 2; z < 10; z += 2) box(P, 32, 16, z, 33, 25, z + 1, Mat.Steel, [0x9b3b2f, 0x2f5a6b, 0xd3a136, 0x4e6b3a][(z / 2) % 4]);
    box(P, 4, 4, STOREY + 1, 14, 12, STOREY + 3, Mat.Wood, 0xe8e2d4);
    box(P, 4, 4, STOREY + 3, 6, 12, STOREY + 6, Mat.Wood, 0x6b4a30);
    // The roof: slate on rafters, gable along x, overhanging by PAD; brick gable ends
    for (let k = 0; k <= D / 2 + 1; k++) {
      const z = TOP + 1 + k;
      for (let x = -1; x <= W; x++) {
        for (const y of [k - 1, D - k]) {
          if (y < -PAD || y >= D + PAD) continue;
          P(x, y, z, Mat.Roof, SLATE);
          if (y >= 0 && y < D) P(x, y, z - 1, Mat.Roof, 0x3c3e45);
        }
        if (x === 0 || x === W - 1) for (let y = k; y < D - k; y++) P(x, y, z, Mat.Brick);
      }
    }
    // Gutters along the eaves, a chimney through the back slope
    for (let x = -1; x <= W; x++) {
      P(x, -1, TOP, Mat.Steel, 0x2a2d31);
      P(x, D, TOP, Mat.Steel, 0x2a2d31);
    }
    box(P, W - 9, D - 9, TOP - 2, W - 6, D - 6, RIDGE + 3, Mat.Brick);
    box(P, W - 9, D - 9, RIDGE + 3, W - 6, D - 6, RIDGE + 4, Mat.Concrete, 0x6a6660);
    // A porch light by the door, and a step
    P(14, -1, 8, Mat.Neon, 0xffd27a);
    box(P, 14, -2, 0, 21, 0, 1, Mat.Concrete, 0xb5b0a6);
  });
  targets.push(0);

  // The neighbour's shed (leave it standing): sage-painted boards, a door, a little window, a felt roof
  w.place(Math.round(8.5 * M), Math.round(7 * M), 12, 10, 12, (put) => {
    for (let z = 0; z < 10; z++)
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 12; x++) {
          const wall = x === 0 || y === 0 || x === 11 || y === 9;
          if (z === 0) put(x, y, z, Mat.Wood, 0x6b5136);
          else if (z === 9) put(x, y, z, Mat.Roof, 0x3a3c40);
          else if (wall) {
            const door = y === 0 && x >= 4 && x < 8 && z < 8;
            const window = x === 11 && y >= 3 && y < 7 && z >= 4 && z < 7;
            if (window) put(x, y, z, Mat.Glass);
            else put(x, y, z, Mat.Wood, door ? 0x8e5a34 : x % 2 ? 0x7c9a6a : 0x6f8f62);
          }
        }
    for (let x = 0; x < 12; x++) put(x, 4, 10, Mat.Roof, 0x2f3135);
  });
  keep.push(w.count() - 1);

  // Two propane tanks at the front corner, a drum round the side
  barrel(w, -3.6, -2.4);
  barrels.push(w.count() - 1);
  barrel(w, -2.4, -2.5);
  barrels.push(w.count() - 1);
  barrel(w, -5.6, 1.5, 0x3d6b8a, 4);
  barrels.push(w.count() - 1);
  // And one inside, in the front room (a gas heater): the tanks outside set it off
  barrel(w, -2.6, 0.4, 0xc8392b, 4);
  barrels.push(w.count() - 1);
  bin(w, 4.9, -2.3);
  bin(w, 5.6, -2.3);
  // The garden: a raised vegetable bed, boulders of bedrock by the hedge and the shed
  dirtBed(w, -11.5, 2, -7.5, 5.5);
  boulder(w, -12.4, -4.6, 0.9, 0.7, 0.9, seed + 2);
  boulder(w, 12.4, 4.8, 0.8, 0.8, 0.8, seed + 3);
  // The yard: a fence across the front with a gate, a hedge down the left, a tree, the car on the drive
  fence(w, -15, 15, -7, -1.5, 1.5);
  hedge(w, -15, -6, -13.5, 11);
  tree(w, -9, 8, 4);
  car(w, 9, -3.8, 0x2f5f8a);
  crates(w, -9.5, -3.5, seed);

  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 0,
      name: LEVELS[0].name,
      brief: LEVELS[0].brief,
      job: LEVELS[0].job,
      time: 90,
      charges: 4,
      targets,
      keep,
      keepName: 'Shed',
      barrels,
      spawn: [0.5, -13, Math.PI / 2 + 0.06, 0.1],
      machines: [{ kind: 'excavator', at: [7, -10], heading: Math.PI / 2 }],
      intro: { from: [-16, -20, 9], look: [0, 2, 3.5] },
      hour: 17,
      sunAz: -2.25,
      sunEl: 13,
      bounds: 22,
      grass: true,
      focus: [0, 2, 3],
      stars: [0.55, 0.75, 0.88],
    },
  };
}

/**
 * Level 2: a water tower on four steel legs with cross bracing, a timber tank banded in steel and
 * a slate cone on top; a brick pump house, fuel drums by its legs, crates. The job: knock out
 * legs on one side so it topples into the ring.
 */
function waterTower(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const { box } = w;
  const barrels: number[] = [];
  const [cx, cy] = [0, 4];
  const R = 12;
  const N = 2 * R + 2;
  const LEG = 48;
  const TANK0 = LEG + 2;
  const TANK1 = TANK0 + 16;
  const ROOF = 9;
  w.place(Math.round(cx * M) - N / 2, Math.round(cy * M) - N / 2, N, N, TANK1 + ROOF + 3, (put) => {
    const c = N / 2;
    const legs = [
      [c - 9, c - 9],
      [c + 7, c - 9],
      [c - 9, c + 7],
      [c + 7, c + 7],
    ];
    const steel = 0x3c4146;
    // The legs are girders (hard: only a charge cuts one); the beams and bracing lighter steel
    for (const [lx, ly] of legs) box(put, lx, ly, 0, lx + 2, ly + 2, LEG, Mat.Girder, 0x7a3a2a);
    // Ring beams at three heights, and X bracing on each face between them
    const ring = [16, 32, LEG - 1];
    for (const z of ring) {
      line(put, [c - 9, c - 9, z], [c + 8, c - 9, z], Mat.Steel, steel);
      line(put, [c - 9, c + 8, z], [c + 8, c + 8, z], Mat.Steel, steel);
      line(put, [c - 9, c - 9, z], [c - 9, c + 8, z], Mat.Steel, steel);
      line(put, [c + 8, c - 9, z], [c + 8, c + 8, z], Mat.Steel, steel);
    }
    const bands = [0, ...ring];
    for (let k = 0; k < bands.length - 1; k++) {
      const [z0, z1] = [bands[k] + 1, bands[k + 1] - 1];
      line(put, [c - 8, c - 9, z0], [c + 7, c - 9, z1], Mat.Steel, 0x4a5056);
      line(put, [c + 7, c - 9, z0], [c - 8, c - 9, z1], Mat.Steel, 0x4a5056);
      line(put, [c - 8, c + 8, z0], [c + 7, c + 8, z1], Mat.Steel, 0x4a5056);
      line(put, [c + 7, c + 8, z0], [c - 8, c + 8, z1], Mat.Steel, 0x4a5056);
      line(put, [c - 9, c - 8, z0], [c - 9, c + 7, z1], Mat.Steel, 0x4a5056);
      line(put, [c - 9, c + 7, z0], [c - 9, c - 8, z1], Mat.Steel, 0x4a5056);
      line(put, [c + 8, c - 8, z0], [c + 8, c + 7, z1], Mat.Steel, 0x4a5056);
      line(put, [c + 8, c + 7, z0], [c + 8, c - 8, z1], Mat.Steel, 0x4a5056);
    }
    // The deck under the tank: a steel grate out to the rim, with a rail
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
        if (r < R + 0.8) put(x, y, LEG, Mat.Steel, (x + y) % 2 ? 0x5a6066 : 0x4c5157);
        if (r < R - 0.5) put(x, y, LEG + 1, Mat.Wood, 0x6b4a30);
        if (r > R - 0.2 && r < R + 0.8 && (x + y) % 3 === 0) put(x, y, LEG + 1, Mat.Steel, 0x2c3034);
      }
    // The tank: cream timber staves bound by rusty hoops, a floor, a cone of slate
    for (let z = TANK0; z < TANK1; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (r > R - 1.6 && r < R - 0.5) {
            const hoop = (z - TANK0) % 5 === 2;
            const stave = Math.floor((Math.atan2(y + 0.5 - c, x + 0.5 - c) / (2 * Math.PI)) * 48 + 48) % 2;
            put(x, y, z, hoop ? Mat.Steel : Mat.Wood, hoop ? 0x8a4030 : stave ? 0xd9cfb8 : 0xcbbfa4);
          }
        }
    for (let k = 0; k < ROOF; k++) {
      const rr = (R - 0.3) * (1 - k / ROOF) + 0.6;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (r < rr && r > rr - 2.2) put(x, y, TANK1 + k, Mat.Roof, SLATE);
        }
    }
    put(c, c, TANK1 + ROOF, Mat.Steel, 0x2c3034);
    put(c, c, TANK1 + ROOF + 1, Mat.Steel, 0x2c3034);
    // A ladder up the front leg
    for (let z = 2; z < LEG; z += 3) put(c - 7, c - 10, z, Mat.Steel, 0x2a2d31);
    line(put, [c - 7, c - 10, 1], [c - 7, c - 10, LEG - 1], Mat.Steel, 0x2a2d31);
  });
  const tower = w.count() - 1;

  // The pump house: brick, a flat concrete roof, a teal door, a window, a pipe to the tower
  w.place(Math.round(-11 * M), Math.round(1 * M), 20, 16, 14, (put) => {
    for (let z = 0; z < 13; z++)
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 20; x++) {
          const wall = x === 0 || y === 0 || x === 19 || y === 15;
          if (z === 0 || z === 12) put(x, y, z, Mat.Concrete, 0xb0aba0);
          else if (wall) {
            const door = y === 0 && x >= 8 && x < 12 && z < 9;
            const window = x === 19 && y >= 5 && y < 11 && z >= 5 && z < 9;
            if (door) put(x, y, z, Mat.Wood, TEAL);
            else if (window) put(x, y, z, Mat.Glass);
            else put(x, y, z, Mat.Brick, z === 11 ? MUSTARD : undefined);
          }
        }
    box(put, 4, 5, 1, 10, 11, 5, Mat.Steel, 0x2f5a6b);
  });
  // Fuel drums by the two front legs, crates, a fence across the front
  for (const [x, y] of [
    [-6.2, -1.2],
    [-5.2, -2.0],
    [6.4, -0.6],
    [-6.6, 8.5],
  ]) {
    barrel(w, x, y, 0xc8392b, 5);
    barrels.push(w.count() - 1);
  }
  crates(w, 8, 1, seed + 3);
  bin(w, -8.2, -0.6);
  dirtBed(w, 9.5, 5, 12.5, 8);
  boulder(w, -13, -4.2, 1, 0.8, 1, seed + 5);
  fence(w, -15, 15, -7, -1.5, 1.5);
  hedge(w, 13.5, -6, 15, 12, 5, 9);
  tree(w, 10, 11, 6);
  tree(w, -12, 12, 2);

  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 1,
      name: LEVELS[1].name,
      brief: LEVELS[1].brief,
      job: LEVELS[1].job,
      time: 90,
      charges: 3,
      targets: [tower],
      keep: [],
      keepName: '',
      barrels,
      zone: { x: cx, y: cy + 13.5, r: 5, object: tower },
      spawn: [0, -13, Math.PI / 2, 0.22],
      machines: [{ kind: 'crane', at: [-9, -6], heading: Math.PI / 2 - 0.2 }],
      intro: { from: [14, -18, 20], look: [0, 4, 9] },
      hour: 17,
      sunAz: -1.95,
      sunEl: 15,
      bounds: 22,
      grass: true,
      focus: [0, 8, 6],
      stars: [0.45, 0.62, 0.75],
    },
  };
}

/** Level 3: the fork's corner tower, eleven storeys on its city block, at sunset. */
function corner(seed: number): { city: City; level: Level } {
  lastPool = {};
  const city = buildCity(seed, withPool ? spawnPool : undefined);
  return {
    city,
    level: {
      id: 2,
      name: LEVELS[2].name,
      brief: LEVELS[2].brief,
      job: LEVELS[2].job,
      time: 120,
      charges: 6,
      targets: [0],
      keep: [],
      keepName: '',
      barrels: [],
      spawn: [-24, -19, 0.62, 0.32],
      machines: [{ kind: 'crane', at: [-13, -13], heading: Math.PI / 4 }, { kind: 'excavator', at: [10, -16], heading: Math.PI / 2 + 0.4 }],
      intro: { from: [-40, -46, 30], look: [0, 0, 18] },
      hour: 18.6,
      bounds: 23,
      grass: false,
      focus: [0, 0, 14],
      stars: [0.5, 0.7, 0.9],
    },
  };
}

/**
 * Level 4: a farmyard. An old timber barn (red boards, white trim, a gambrel roof of sheet steel, a hay loft) and
 * a concrete silo with a steel dome; a fuel tank by the barn, round bales, a tractor, a fence and trees. The job:
 * flatten the barn and drop the silo across the field into the ring.
 */
function farm(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const targets: number[] = [];
  const barrels: number[] = [];
  const RED = 0x8e2f22;
  const WHITE = 0xece4d2;
  // The barn: 12 x 8 m, walls 4.5 m, a gambrel roof to 8.5 m; its middle at (-5, 4)
  const [BW, BD, WALL] = [48, 32, 18];
  const ROOF = 17;
  w.place(Math.round(-5 * M) - BW / 2, Math.round(4 * M) - BD / 2, BW + 2, BD + 2, WALL + ROOF + 2, (put) => {
    const P = (x: number, y: number, z: number, m: Mat, c?: number) => put(x + 1, y + 1, z, m, c);
    for (let z = 0; z <= WALL; z++)
      for (let y = 0; y < BD; y++)
        for (let x = 0; x < BW; x++) {
          const wall = x === 0 || y === 0 || x === BW - 1 || y === BD - 1;
          if (z === 0) {
            P(x, y, z, Mat.Concrete, 0x9c978d);
            continue;
          }
          // The loft floor at 3 m on posts; the posts every 2 m round the walls and down the middle
          if (z === 12 && !wall && x > 2 && x < BW - 3) P(x, y, z, Mat.Wood, (x + y) % 4 ? 0x8a6a44 : 0x7a5c3a);
          const post = (x % 8 === 0 || x === BW - 1) && (y === 0 || y === BD - 1 || y === BD / 2);
          if (post && z < WALL) P(x, y, z, Mat.Wood, 0x5e4128);
          if (!wall) continue;
          // Big doors at the gable ends, a hayloft door above, small windows down the sides
          const door = (x === 0 || x === BW - 1) && y > 9 && y < BD - 10 && z < 12;
          const loft = (x === 0 || x === BW - 1) && y > 13 && y < BD - 14 && z > 13 && z < 17;
          const window = (y === 0 || y === BD - 1) && x % 12 === 6 && z > 5 && z < 9;
          if (loft) continue;
          if (window) P(x, y, z, Mat.Glass);
          else if (door) P(x, y, z, Mat.Wood, (y + z) % 7 === 0 ? WHITE : 0x7a2a1e);
          else if (z === WALL || ((x === 0 || x === BW - 1) && (y === 0 || y === BD - 1))) P(x, y, z, Mat.Wood, WHITE);
          else P(x, y, z, Mat.Wood, x % 2 ? RED : 0x823022);
        }
    // Gambrel roof: steep lower slopes, shallow upper, sheet steel over rafters; boarded gable ends
    const half = BD / 2;
    const roofAt = (d: number) => (d < 5 ? WALL + d * 1.6 : WALL + 8 + (d - 5) * 0.8);
    for (let x = -1; x <= BW; x++)
      for (let y = -1; y <= BD; y++) {
        const d = Math.min(y + 1, BD - y);
        if (d > half + 1) continue;
        const z = Math.round(roofAt(d));
        P(x, y, z, Mat.Steel, (x + 100) % 3 ? 0x6d3b30 : 0x5b3128);
        if (x === 0 || x === BW - 1) for (let zz = WALL + 1; zz < z; zz++) if (y >= 0 && y < BD) P(x, y, zz, Mat.Wood, x % 2 ? RED : 0x823022);
      }
  });
  targets.push(w.count() - 1);
  // The silo: concrete, 2.5 m round, 16 m tall, a steel dome; a ladder; at (8, 6)
  const R = 10;
  const SH = 64;
  w.place(Math.round(8 * M) - R - 1, Math.round(6 * M) - R - 1, 2 * R + 3, 2 * R + 3, SH + 8, (put) => {
    const c = R + 1.5;
    for (let z = 0; z < SH; z++)
      for (let y = 0; y < 2 * R + 3; y++)
        for (let x = 0; x < 2 * R + 3; x++) {
          const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (z === 0 && r < R) put(x, y, z, Mat.RCConcrete, 0x9a968c);
          else if (r < R && r > R - 1.6) {
            const band = z % 16 === 15;
            // Reinforced up the bottom third, plain concrete above (where a charge goes through it)
            put(x, y, z, band ? Mat.Steel : z < 20 ? Mat.RCConcrete : Mat.Concrete, band ? 0x5b5f63 : (Math.floor(z / 4) + Math.floor(Math.atan2(y - c, x - c) * 4)) % 2 ? 0xb8b2a6 : 0xaea89c);
          }
        }
    for (let k = 0; k < 7; k++)
      for (let y = 0; y < 2 * R + 3; y++)
        for (let x = 0; x < 2 * R + 3; x++) {
          const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          const rr = R * Math.cos((k / 7) * (Math.PI / 2));
          if (r < rr && r > rr - 1.8) put(x, y, SH + k, Mat.Steel, k % 2 ? 0x8a9196 : 0x7c8388);
        }
    for (let z = 2; z < SH; z += 2) put(Math.round(c), 0, z, Mat.Steel, 0x2a2d31);
  });
  const silo = w.count() - 1;
  targets.push(silo);
  // A fuel tank on legs by the barn, round bales, a tractor, a fence, trees
  barrel(w, -12.5, -1.5, 0xc8392b, 5);
  barrels.push(w.count() - 1);
  barrel(w, 3.5, -3, 0x3d6b8a, 4);
  barrels.push(w.count() - 1);
  for (const [x, y] of [
    [-13, 9],
    [-13, 11],
    [-11.4, 10],
  ])
    w.place(Math.round(x * M) - 3, Math.round(y * M) - 3, 6, 6, 6, (put) => {
      for (let z = 0; z < 5; z++)
        for (let yy = 0; yy < 6; yy++)
          for (let xx = 0; xx < 6; xx++) if (Math.hypot(xx + 0.5 - 3, z + 0.5 - 2.5) < 2.8) put(xx, yy, z, Mat.Plastic, (xx + yy + z) % 5 ? 0xe9e4d6 : 0xd8d2c2);
    });
  car(w, -2, -6, 0x3e7d34);
  fence(w, -15, 15, -9, -1.5, 1.5);
  hedge(w, 13.5, -8, 15, 4, 5, 11);
  tree(w, -12, 15, 3);
  tree(w, 14, 14, 8);
  boulder(w, 12.5, -5, 0.9, 0.7, 0.8, seed + 7);
  dirtBed(w, -2, 12, 3, 15);
  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 3,
      name: LEVELS[3].name,
      brief: LEVELS[3].brief,
      job: LEVELS[3].job,
      time: 100,
      charges: 4,
      cutters: 2,
      rockets: 3,
      targets,
      keep: [],
      keepName: '',
      barrels,
      zone: { x: 8, y: 19, r: 4.5, object: silo },
      spawn: [0, -14, Math.PI / 2 + 0.1, 0.18],
      machines: [{ kind: 'excavator', at: [-6, -11], heading: Math.PI / 2 }],
      intro: { from: [-18, -20, 14], look: [2, 5, 5] },
      hour: 17.6,
      sunAz: -2.1,
      sunEl: 12,
      bounds: 22,
      grass: true,
      focus: [2, 5, 4],
      stars: [0.5, 0.7, 0.82],
    },
  };
}

/**
 * Level 5: a works yard. A brick chimney 30 m tall on a reinforced base, tapering, banded in steel; beside it the
 * boiler house to spare (a steel frame clad in sheet, glazed along the top). The job: notch the chimney on the side
 * it should fall, and drop it down the yard into the ring.
 */
function chimney(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const targets: number[] = [];
  const keep: number[] = [];
  const barrels: number[] = [];
  const H = 120;
  const R0 = 9;
  const R1 = 5;
  w.place(Math.round(0 * M) - R0 - 1, Math.round(-2 * M) - R0 - 1, 2 * R0 + 3, 2 * R0 + 3, H + 3, (put) => {
    const c = R0 + 1.5;
    for (let z = 0; z < H; z++) {
      const r = R0 + (R1 - R0) * (z / H);
      const t = 2.2;
      for (let y = 0; y < 2 * R0 + 3; y++)
        for (let x = 0; x < 2 * R0 + 3; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (d > r || d < r - t) continue;
          const base = z < 8;
          const band = z > 8 && z % 24 === 0;
          const top = z > H - 5;
          put(x, y, z, base ? Mat.RCConcrete : band ? Mat.Steel : Mat.Brick, base ? 0xa49f95 : band ? 0x3a3d41 : top ? 0x4a3a32 : undefined);
        }
    }
  });
  targets.push(w.count() - 1);
  // The boiler house: girder frame, sheet-steel walls, a glazed clerestory, a flat roof; at (-11, 5)
  const [W, D, HH] = [44, 28, 24];
  w.place(Math.round(-11 * M) - W / 2, Math.round(5 * M) - D / 2, W, D, HH + 2, (put) => {
    for (let z = 0; z <= HH; z++)
      for (let y = 0; y < D; y++)
        for (let x = 0; x < W; x++) {
          const wall = x === 0 || y === 0 || x === W - 1 || y === D - 1;
          const column = (x % 11 === 0 || x === W - 1) && (y === 0 || y === D - 1);
          if (z === 0) put(x, y, z, Mat.Concrete, 0x9a958c);
          else if (z === HH) put(x, y, z, Mat.Roof, 0x55524c);
          else if (column) put(x, y, z, Mat.Girder, 0x7a3a2a);
          else if (wall) put(x, y, z, z > HH - 6 && z < HH - 1 && !(x % 11 === 0) ? Mat.Glass : Mat.Steel, z % 2 ? 0x7f8a8f : 0x77828a);
        }
  });
  keep.push(w.count() - 1);
  // Gas bottles and drums, a skip, pallets of bricks
  for (const [x, y, c] of [
    [6, -8, 0xc8392b],
    [7.2, -8.4, 0xc8392b],
    [-4, 12, 0x3d6b8a],
  ] as const) {
    barrel(w, x, y, c, 5);
    barrels.push(w.count() - 1);
  }
  w.place(Math.round(10 * M), Math.round(3 * M), 16, 8, 6, (put) => {
    for (let z = 0; z < 6; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) if (x === 0 || x === 15 || y === 0 || y === 7 || z === 0) put(x, y, z, Mat.Steel, 0xd09a2a);
  });
  crates(w, -3, -12, seed + 2);
  bin(w, 12, -6);
  bin(w, 12.7, -6);
  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 4,
      name: LEVELS[4].name,
      brief: LEVELS[4].brief,
      job: LEVELS[4].job,
      time: 100,
      charges: 3,
      cutters: 3,
      rockets: 2,
      targets,
      keep,
      keepName: 'Boiler house',
      barrels,
      zone: { x: 0, y: 24, r: 4.5, object: targets[0] },
      spawn: [4, -15, Math.PI / 2 + 0.25, 0.32],
      machines: [{ kind: 'crane', at: [-10, -7], heading: Math.PI / 2 - 0.3 }],
      intro: { from: [16, -20, 26], look: [0, 0, 14] },
      hour: 18.2,
      sunAz: -1.9,
      sunEl: 14,
      bounds: 22,
      grass: false,
      focus: [0, 4, 10],
      stars: [0.5, 0.75, 0.9],
    },
  };
}

/** A gas line along the ground through `points` (m): one object, a yellow pipe; break it and it goes up along its length. */
function gasLine(w: WorldBuilder, points: [number, number][]): void {
  const xs = points.map((p) => Math.round(p[0] * M));
  const ys = points.map((p) => Math.round(p[1] * M));
  const [x0, y0] = [Math.min(...xs) - 1, Math.min(...ys) - 1];
  w.place(x0, y0, Math.max(...xs) - x0 + 2, Math.max(...ys) - y0 + 2, 2, (put) => {
    for (let k = 1; k < points.length; k++) {
      line(put, [xs[k - 1] - x0, ys[k - 1] - y0, 0], [xs[k] - x0, ys[k] - y0, 0], Mat.Steel, 0xe0b020);
      // A valve post at each bend
      put(xs[k] - x0, ys[k] - y0, 1, Mat.Steel, 0xc8392b);
    }
  });
  w.last().kind = 'gas';
}

/** A small car built into a deck of the car park (part of it: it rides the deck down). */
function deckCar(put: Put, x0: number, y0: number, z0: number, paint: number, along = true): void {
  const [L, Wd] = along ? [16, 7] : [7, 16];
  for (let x = 0; x < L; x++)
    for (let y = 0; y < Wd; y++) {
      const a = along ? x : y;
      const b = along ? y : x;
      const edge = b === 0 || b === (along ? Wd : L) - 1;
      put(x0 + x, y0 + y, z0, Mat.Steel, 0x151515);
      put(x0 + x, y0 + y, z0 + 1, Mat.Steel, paint);
      put(x0 + x, y0 + y, z0 + 2, Mat.Steel, paint);
      if (a > 3 && a < 12) put(x0 + x, y0 + y, z0 + 3, edge || a === 4 || a === 11 ? Mat.Glass : Mat.Steel, paint);
      if (a > 4 && a < 11) put(x0 + x, y0 + y, z0 + 4, Mat.Steel, paint);
    }
}

/**
 * Level 6: a multi-storey car park. Five decks of concrete slab on reinforced columns, parapets round each, a
 * brick stair tower at one corner, cars parked on every deck (part of it: they come down with their deck). The
 * job: cut the columns low and pancake it.
 */
function carPark(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const rnd = random(seed + 9);
  const [W, D] = [88, 60];
  const DECK = 12;
  const DECKS = 5;
  const TOP = DECK * (DECKS - 1);
  const paints = [0x2f5f8a, 0x8a2f2f, 0xd9d4c8, 0x3e7d34, 0x1d1f22, 0xd9a21b, 0x6a6e74];
  w.place(Math.round(0 * M) - W / 2, Math.round(3 * M) - D / 2, W, D, TOP + 14, (put) => {
    for (let z = 0; z <= TOP + 3; z++)
      for (let y = 0; y < D; y++)
        for (let x = 0; x < W; x++) {
          const deck = z % DECK === 0 && z <= TOP;
          const edge = x === 0 || y === 0 || x === W - 1 || y === D - 1;
          const column = x % 22 < 2 && y % 20 < 2 && !(x === W - 1 && y === D - 1);
          const core = x >= W - 16 && y >= D - 16;
          const coreWall = core && (x === W - 16 || y === D - 16 || x === W - 1 || y === D - 1);
          if (deck) {
            // The slab, bay lines painted on it, a ramp opening on the upper decks
            const ramp = z > 0 && x > 30 && x < 50 && y > 22 && y < 38;
            if (ramp) continue;
            const line = (y % 20 === 10 && x % 11 !== 0) || (x % 11 === 0 && (y % 20 < 7 || y % 20 > 13));
            put(x, y, z, Mat.Concrete, line ? 0xe8e2d4 : (x + y + z) % 9 === 0 ? 0x9a958c : undefined);
            continue;
          }
          const inDeck = z % DECK;
          if (column || coreWall) {
            if (coreWall && !column && inDeck > 1 && inDeck < 9 && (x === W - 16 || y === D - 16) && (x + y) % 10 < 3) continue;
            put(x, y, z, column ? Mat.RCConcrete : Mat.Brick, column ? 0xa9a59c : undefined);
            continue;
          }
          // Parapets round each deck (open at the ground floor's entrance)
          if (edge && inDeck > 0 && inDeck <= 3 && z > 0 && z < TOP + 4) {
            put(x, y, z, Mat.Concrete, inDeck === 3 ? 0xd3a136 : 0xb9b4aa);
          }
        }
    // Cars on every deck
    for (let d = 0; d < DECKS; d++) {
      const z0 = d * DECK + 1;
      for (let k = 0; k < 6; k++) {
        if (rnd() < 0.25) continue;
        const bay = k % 3;
        const row = Math.floor(k / 3);
        deckCar(put, 4 + bay * 11 + (row ? 44 : 0) - (row ? 0 : 0), row ? 42 : 3, z0, paints[Math.floor(rnd() * paints.length)], false);
      }
    }
    // A sign on the roof parapet
    for (let x = 10; x < 34; x++) for (let z = TOP + 4; z < TOP + 7; z++) put(x, 0, z, Mat.Neon, (x + z) % 7 ? 0x2f6fb0 : 0xe8e0d0);
  });
  const park = w.count() - 1;
  // Around it: a ticket barrier hut, bollards, a parked car, bins
  w.place(Math.round(-14 * M), Math.round(-10 * M), 8, 8, 12, (put) => {
    for (let z = 0; z < 11; z++)
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const wall = x === 0 || y === 0 || x === 7 || y === 7;
          if (z === 0 || z === 10) put(x, y, z, Mat.Concrete, 0xa8a49b);
          else if (wall) put(x, y, z, z > 4 && z < 8 && y === 0 ? Mat.Glass : Mat.Plaster, 0xd8cdb8);
        }
  });
  const hut = w.count() - 1;
  car(w, 12, -8, 0x8a2f2f);
  bin(w, -9, -9.6);
  bin(w, -8.3, -9.6);
  barrel(w, 14, 12, PROPANE, 5);
  const barrels = [w.count() - 1];
  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 5,
      name: LEVELS[5].name,
      brief: LEVELS[5].brief,
      job: LEVELS[5].job,
      time: 110,
      charges: 6,
      cutters: 4,
      rockets: 3,
      pipes: 3,
      targets: [park],
      keep: [hut],
      keepName: 'Ticket hut',
      barrels,
      spawn: [-4, -17, Math.PI / 2 + 0.2, 0.22],
      machines: [{ kind: 'crane', at: [-14, -14], heading: Math.PI / 2 - 0.3 }, { kind: 'excavator', at: [9, -15], heading: Math.PI / 2 }],
      intro: { from: [-24, -24, 22], look: [0, 3, 6] },
      hour: 17.8,
      sunAz: -2.2,
      sunEl: 13,
      bounds: 22,
      grass: false,
      focus: [0, 3, 6],
      stars: [0.45, 0.65, 0.8],
    },
  };
}

/**
 * Level 7: a petrol station. A canopy on girder columns over two pump islands, a brick and glass shop, the
 * underground tanks' vents behind it with a gas line running out to the pumps, bottle cages, and a fuel tanker
 * parked by the canopy. The job: bring down the canopy and the shop. Everything here goes up.
 */
function petrol(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const targets: number[] = [];
  const barrels: number[] = [];
  const gas: number[] = [];
  // The canopy: 16 x 9 m, 4.5 m up, four girder columns, a white soffit, a red neon band; the pump islands under it
  const [CW, CD, CZ] = [64, 36, 18];
  w.place(Math.round(-3 * M) - CW / 2, Math.round(0 * M) - CD / 2, CW, CD, CZ + 4, (put) => {
    for (let y = 0; y < CD; y++)
      for (let x = 0; x < CW; x++) {
        const column = (x === 6 || x === 7 || x === CW - 8 || x === CW - 7) && (y === 6 || y === 7 || y === CD - 8 || y === CD - 7);
        if (column) for (let z = 0; z < CZ; z++) put(x, y, z, Mat.Girder, 0xe8e2d4);
        const edge = x === 0 || y === 0 || x === CW - 1 || y === CD - 1;
        put(x, y, CZ, Mat.Steel, 0xf0ece2);
        put(x, y, CZ + 1, edge ? Mat.Neon : Mat.Steel, edge ? 0xd8302a : 0xdcd8ce);
        if (edge) put(x, y, CZ + 2, Mat.Neon, 0xd8302a);
        // Strip lights under it
        if (y % 12 === 6 && x % 8 > 1 && x % 8 < 6) put(x, y, CZ - 1, Mat.Neon, 0xfff1d6);
      }
    // Pump islands: a kerb, two pumps each with a lit display
    for (const iy of [10, 22]) {
      for (let x = 14; x < CW - 14; x++) for (let y = iy; y < iy + 4; y++) put(x, y, 0, Mat.Concrete, 0xd3a136);
      for (const px of [20, CW - 22]) {
        for (let z = 1; z < 8; z++) for (let x = px; x < px + 3; x++) for (let y = iy + 1; y < iy + 3; y++) put(x, y, z, Mat.Steel, z > 5 ? 0xd8302a : 0xe8e2d4);
        for (let x = px; x < px + 3; x++) put(x, iy, 5, Mat.Neon, 0x40e070);
      }
    }
  });
  targets.push(w.count() - 1);
  // The shop: brick, a glass front, a flat roof with a lit sign
  const [SW, SD, SH] = [40, 26, 15];
  w.place(Math.round(-4 * M) - SW / 2, Math.round(12 * M) - SD / 2, SW, SD, SH + 4, (put) => {
    for (let z = 0; z <= SH; z++)
      for (let y = 0; y < SD; y++)
        for (let x = 0; x < SW; x++) {
          const wall = x === 0 || y === 0 || x === SW - 1 || y === SD - 1;
          if (z === 0) put(x, y, z, Mat.Concrete, 0x9c978d);
          else if (z === SH) put(x, y, z, Mat.Roof, 0x55524c);
          else if (wall) {
            const front = y === 0 && x > 2 && x < SW - 3 && z < 11 && x % 8 !== 0;
            const door = y === 0 && x >= 16 && x < 22 && z < 9;
            if (door) continue;
            put(x, y, z, front ? Mat.Glass : Mat.Brick, front ? undefined : z > 11 ? 0xd8302a : undefined);
          } else if (z < 6 && x % 8 === 4 && y > 4 && y < SD - 5) put(x, y, z, Mat.Wood, 0x8a6a44);
          else if (z === 5 && x % 8 >= 3 && x % 8 <= 5 && y > 4 && y < SD - 5) put(x, y, z, Mat.Plastic, [0xd8302a, 0x2f6fb0, 0xd9a21b][x % 3]);
        }
    for (let x = 6; x < SW - 6; x++) for (let z = SH + 1; z < SH + 4; z++) put(x, 0, z, Mat.Neon, (x + z) % 5 ? 0x2a8a3a : 0xf0ece2);
  });
  targets.push(w.count() - 1);
  // The tanks' vents behind the shop, and the gas line out to both pump islands
  barrel(w, -14, 18, 0x2a8a3a, 6);
  barrels.push(w.count() - 1);
  barrel(w, -11.5, 18, 0x2a8a3a, 6);
  barrels.push(w.count() - 1);
  gasLine(w, [
    [-12.5, 16.2],
    [-14, 6.5],
    [-14, -1.5],
    [5, -1.5],
    [5, 3.6],
  ]);
  gas.push(w.count() - 1);
  // Gas bottle cages by the shop, the tanker by the canopy, a car at a pump
  bottles(w, 7, 9);
  barrels.push(w.count() - 1);
  bottles(w, 8.6, 9);
  barrels.push(w.count() - 1);
  tanker(w, 12, -9);
  barrels.push(w.count() - 1);
  car(w, -6, 3, 0x2f5f8a);
  crates(w, 10, 15, seed + 4);
  bin(w, -15, 8);
  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 6,
      name: LEVELS[6].name,
      brief: LEVELS[6].brief,
      job: LEVELS[6].job,
      time: 100,
      charges: 4,
      cutters: 2,
      rockets: 3,
      pipes: 4,
      targets,
      keep: [],
      keepName: '',
      barrels,
      gas,
      spawn: [2, -17, Math.PI / 2 + 0.05, 0.15],
      machines: [{ kind: 'excavator', at: [-9, -14], heading: Math.PI / 2 }],
      intro: { from: [20, -22, 14], look: [-3, 4, 3] },
      hour: 18.4,
      sunAz: -1.8,
      sunEl: 11,
      bounds: 22,
      grass: false,
      focus: [-3, 5, 3],
      stars: [0.5, 0.75, 0.92],
    },
  };
}

/**
 * Lot 8, the heist: a steel-clad warehouse on a brick plinth at dusk. Inside: a reinforced-concrete vault in one
 * corner behind a steel door (an alarm box on it), an office under a concrete mezzanine reached by a timber stair,
 * racks of crates. Outside: a shipping container, a guard hut by the gate, the getaway truck. Four pieces of loot are
 * required (the vault's gold, the office's drives, the ledger on the mezzanine, the paintings in the container);
 * two are worth a detour (the watches on the container's roof, the cash in the guard hut).
 */
function warehouse(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  // The shed: 22 x 14 m, 5.5 m to the eaves; walls of brick to 1.25 m, then sheet steel; a roof of sheet on the walls
  const [W, D, H] = [88, 56, 22];
  const [X0, Y0] = [-11 * M, -3 * M];
  const SHEET = [0x8a929a, 0x7b838b];
  w.place(X0, Y0, W, D, H + 1, (put) => {
    for (let z = 0; z <= H; z++)
      for (let y = 0; y < D; y++)
        for (let x = 0; x < W; x++) {
          const wall = x === 0 || y === 0 || x === W - 1 || y === D - 1;
          const post = (x % 16 === 0 || x === W - 1) && (y === 0 || y === D - 1) || (y % 14 === 0 || y === D - 1) && (x === 0 || x === W - 1);
          if (z === 0) {
            put(x, y, z, Mat.Concrete, (x + y) % 9 === 0 ? 0x8e8a82 : 0x9a968d);
            continue;
          }
          if (z === H) {
            const sky = x % 16 >= 6 && x % 16 < 10 && y > 4 && y < D - 5 && y % 14 > 3 && y % 14 < 11;
            put(x, y, z, sky ? Mat.Glass : Mat.Roof, sky ? undefined : (x + y) % 2 ? 0x6b6f75 : 0x63676d);
            continue;
          }
          if (!wall) continue;
          if (post) {
            put(x, y, z, Mat.Girder, 0x3f5f7f);
            continue;
          }
          // The roller door (south, middle), the side door (west), high windows east and west
          const roller = y === 0 && x >= 34 && x < 54 && z < 16;
          if (roller) {
            put(x, y, z, Mat.Steel, z % 2 ? 0xb4b8bc : 0x9ea2a6);
            continue;
          }
          if (x === 0 && y >= 20 && y < 25 && z < 10) {
            put(x, y, z, Mat.Wood, z === 9 ? 0x5a3e24 : 0x7a5532);
            continue;
          }
          if ((x === 0 || x === W - 1) && z >= 14 && z < 18 && y % 10 > 2 && y % 10 < 8) {
            put(x, y, z, Mat.Glass);
            continue;
          }
          if (z < 5) put(x, y, z, Mat.Brick);
          else if (z === 18 || z === 19) put(x, y, z, Mat.Steel, 0x2f5f8a);
          else put(x, y, z, Mat.Steel, SHEET[(x + y) % 2]);
        }
    // The vault: NW corner, reinforced concrete two voxels thick, a steel door on its south face
    const [vx0, vx1, vy0, vy1, vh] = [1, 22, 34, 55, 14];
    for (let z = 1; z <= vh; z++)
      for (let y = vy0; y < vy1; y++)
        for (let x = vx0; x < vx1; x++) {
          const shell = x < vx0 + 2 || x >= vx1 - 2 || y < vy0 + 2 || y >= vy1 - 2 || z >= vh - 1;
          if (!shell) continue;
          const door = y < vy0 + 2 && x >= 9 && x < 15 && z < 10;
          put(x, y, z, door ? Mat.Steel : Mat.RCConcrete, door ? (y === vy0 ? 0x5a5e64 : 0x4a4e54) : 0xa7a39a);
        }
    // The office: NE, plaster walls, a door gap and a window on its south face
    const [ox0, ox1, oy0, oy1] = [62, 87, 38, 55];
    for (let z = 1; z <= 11; z++)
      for (let y = oy0; y < oy1; y++)
        for (let x = ox0; x < ox1; x++) {
          const edge = x === ox0 || y === oy0;
          if (!edge) continue;
          if (y === oy0 && x >= 68 && x < 72 && z < 9) continue;
          const win = y === oy0 && x >= 75 && x < 83 && z >= 4 && z < 8;
          put(x, y, z, win ? Mat.Glass : Mat.Plaster, win ? undefined : 0xd9d2c0);
        }
    // The mezzanine over the office: a concrete slab on the office walls and girder posts, a timber rail
    const [mx0, my0] = [58, 28];
    for (const [px, py] of [
      [mx0, my0],
      [mx0, 40],
      [72, my0],
      [86, my0],
    ])
      for (let z = 1; z < 12; z++) for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) put(px + dx, py + dy, z, Mat.Girder, 0x3f5f7f);
    for (let y = my0; y < 55; y++) for (let x = mx0; x < 87; x++) for (let z = 12; z < 14; z++) put(x, y, z, Mat.Concrete, 0xa29e95);
    for (let x = mx0; x < 87; x++) if (x > mx0 + 5) for (let z = 14; z < 17; z++) if (z === 16 || x % 4 === 0) put(x, my0, z, Mat.Wood, 0x8a6a44);
    // The stair: timber, rising half a metre a step along x to the mezzanine's west end
    for (let k = 0; k < 6; k++) {
      const top = 2 * (k + 1);
      for (let x = mx0 - 18 + 3 * k; x < mx0 - 15 + 3 * k; x++) for (let y = my0 + 1; y < my0 + 6; y++) for (let z = 1; z <= top; z++) put(x, y, z, Mat.Wood, z === top ? 0x9a7650 : 0x6e5034);
    }
    // Racks down the middle: steel uprights, timber shelves
    for (const ry of [14, 24])
      for (let x = 26; x < 54; x++)
        for (let z = 1; z < 11; z++)
          for (let y = ry; y < ry + 3; y++) {
            const upright = x % 7 === 5;
            const shelf = z % 4 === 0;
            if (upright) put(x, y, z, Mat.Steel, 0xd36a2a);
            else if (shelf) put(x, y, z, Mat.Wood, 0x9a7650);
          }
  });
  // Clutter inside and the yard: crates, drums, a container with its own crates to climb, the guard hut
  crates(w, -2, 8, seed + 1);
  crates(w, -7.5, 1.6, seed + 2);
  barrel(w, -9.5, 0.5, 0x2f6fb0, 4);
  barrel(w, -8.5, 0.5, 0x2f6fb0, 4);
  // The container: 6 x 2.5 m, 2.75 m tall, corrugated steel, doors at its west end (closed)
  w.place(Math.round(14 * M), Math.round(1 * M) - 5, 24, 10, 12, (put) => {
    for (let z = 0; z < 11; z++)
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 24; x++) {
          const shell = x === 0 || x === 23 || y === 0 || y === 9 || z === 0 || z === 10;
          if (!shell) continue;
          put(x, y, z, Mat.Steel, x === 0 ? (y === 4 || y === 5 ? 0x7a1c14 : 0x9a2a1e) : (x + z) % 2 ? 0xa83222 : 0x962c1e);
        }
  });
  crates(w, 16, -1.5, seed + 3);
  // The guard hut by the gate: brick, a flat roof, a timber door facing the yard
  w.place(Math.round(-17 * M), Math.round(-14 * M), 14, 12, 13, (put) => {
    for (let z = 0; z < 12; z++)
      for (let y = 0; y < 12; y++)
        for (let x = 0; x < 14; x++) {
          const wall = x === 0 || y === 0 || x === 13 || y === 11;
          if (z === 0) put(x, y, z, Mat.Concrete, 0x9a968d);
          else if (z === 11) put(x, y, z, Mat.Roof, 0x55524c);
          else if (wall) {
            if (x === 13 && y >= 4 && y < 8 && z < 9) put(x, y, z, Mat.Wood, 0x7a5532);
            else if (y === 0 && x >= 4 && x < 10 && z >= 4 && z < 8) put(x, y, z, Mat.Glass);
            else put(x, y, z, Mat.Brick);
          }
        }
  });
  // A fence along the back, lamps, a bin
  fence(w, -20, 20, 15);
  lamp(w, -6, -6);
  lamp(w, 12, -8);
  bin(w, 8, -5);
  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 7,
      name: LEVELS[7].name,
      brief: LEVELS[7].brief,
      job: LEVELS[7].job,
      time: 60,
      charges: 4,
      cutters: 3,
      rockets: 2,
      pipes: 3,
      targets: [],
      keep: [],
      keepName: '',
      barrels: [],
      spawn: [-3, -18, Math.PI / 2 + 0.1, 0.12],
      machines: [{ kind: 'excavator', at: [-9, -16], heading: Math.PI / 2 }],
      heist: {
        loot: [
          { name: 'Gold bars', look: 'gold', at: [-8.25, 8.4, 0.25], required: true },
          { name: 'Server drives', look: 'drive', at: [8.4, 9.0, 0.25], required: true },
          { name: 'The ledger', look: 'ledger', at: [6.5, 6.0, 3.5], required: true },
          { name: 'Paintings', look: 'paintings', at: [17.6, 1.0, 0.25], required: true },
          { name: 'Watches', look: 'watches', at: [16.5, 1.0, 2.75], required: false },
          { name: 'Cash box', look: 'cash', at: [-15.6, -12.4, 0.25], required: false },
        ],
        alarms: [
          { at: [0, -3.12, 2.4], facing: [0, -1] },
          { at: [-8.25, 5.38, 2.0], facing: [0, -1] },
          { at: [5.4, 6.38, 1.8], facing: [0, -1] },
        ],
        truck: { at: [15, -16], heading: Math.PI },
        alarm: 60,
      },
      intro: { from: [-20, -24, 12], look: [0, 4, 3] },
      hour: 19.1,
      sunAz: -2.2,
      sunEl: 7,
      bounds: 22,
      grass: false,
      focus: [0, 4, 3],
      stars: [1, 2, 3],
    },
  };
}

/**
 * Lot 9: a timber pier running out into the sea at dusk, on piles; at its end a wide platform with the boathouse
 * (timber, a tin roof, a steel water tank on top that pours when it's holed), gas bottles and fuel drums, two boats
 * moored alongside. Off to the side on its rock, a brick lighthouse to leave standing. The job: the boathouse and the
 * end platform, into the sea.
 */
function pier(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const targets: number[] = [];
  const keep: number[] = [];
  const barrels: number[] = [];
  const DECK = 6; // the deck's voxel layer: 1.5 to 1.75 m, the sea at 1.0
  const PLANK = [0x8a6a44, 0x7d5f3c, 0x94744c];
  // The walkway: 4 m wide from the shore end (y = -21) out to the platform (y = 2), piles every 2 m, rails
  w.place(Math.round(-2 * M), Math.round(-21 * M), 16, 92, DECK + 5, (put) => {
    for (let y = 0; y < 92; y++)
      for (let x = 0; x < 16; x++) {
        put(x, y, DECK, Mat.Wood, PLANK[(y + (x >> 2)) % 3]);
        const pile = (x === 1 || x === 14) && y % 8 === 3;
        if (pile) for (let z = 0; z < DECK; z++) put(x, y, z, Mat.Wood, 0x5a4026);
        const rail = (x === 0 || x === 15) && y < 88;
        if (rail && (y % 6 === 0 || true)) {
          if (y % 6 === 0) for (let z = DECK + 1; z <= DECK + 3; z++) put(x, y, z, Mat.Wood, 0x6e5034);
          put(x, y, DECK + 4, Mat.Wood, 0x9a7650);
        }
      }
  });
  // The end platform: 12 x 9 m on a grid of piles, and on it the boathouse (timber walls, a door to the walkway,
  // windows, a tin roof) with its water tank on top: one object, held up by the piles, so it all goes together
  const [PW, PD] = [48, 36];
  const [BX, BY, BW, BD, BH] = [8, 8, 32, 24, 13];
  const TZ = DECK + BH + 1;
  const [TX, TY] = [40, 28];
  w.place(Math.round(-6 * M), Math.round(2 * M), PW, PD, TZ + 8, (put) => {
    for (let y = 0; y < PD; y++)
      for (let x = 0; x < PW; x++) {
        put(x, y, DECK, Mat.Wood, PLANK[(x + (y >> 2)) % 3]);
        if (x % 8 === 3 && y % 8 === 3) for (let z = 0; z < DECK; z++) put(x, y, z, Mat.Wood, 0x5a4026);
      }
    for (let z = DECK + 1; z <= DECK + BH; z++)
      for (let y = 0; y < BD; y++)
        for (let x = 0; x < BW; x++) {
          const wall = x === 0 || y === 0 || x === BW - 1 || y === BD - 1;
          if (z === DECK + BH) {
            put(BX + x, BY + y, z, Mat.Roof, (x + y) % 2 ? 0x8a3a2c : 0x7a3226);
            continue;
          }
          if (!wall) continue;
          if (y === 0 && x >= 13 && x < 19 && z < DECK + 10) continue;
          const win = (x === 0 || x === BW - 1) && z >= DECK + 5 && z < DECK + 8 && y % 8 > 2 && y % 8 < 6;
          put(BX + x, BY + y, z, win ? Mat.Glass : Mat.Wood, win ? undefined : z % 2 ? 0x2f5f6a : 0x2a5560);
        }
    // The tank: a steel drum on four legs on the roof
    for (let z = TZ; z < TZ + 7; z++)
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const r = Math.hypot(x + 0.5 - 4, y + 0.5 - 4);
          if (z < TZ + 2) {
            if ((x === 1 || x === 6) && (y === 1 || y === 6)) put(TX - 4 + x, TY - 4 + y, z, Mat.Steel, 0x3a3d42);
          } else if (r < 3.9) put(TX - 4 + x, TY - 4 + y, z, Mat.Steel, z === TZ + 6 ? 0x6a6e72 : z % 2 ? 0x9aa2a8 : 0x8a9298);
        }
  });
  targets.push(w.count() - 1);
  // (Where the tank is, m: it pours when holed)
  const tankBox: [number, number, number, number, number, number] = [-6 + (TX - 4) / M, 2 + (TY - 4) / M, TZ * VOXEL, -6 + (TX + 4) / M, 2 + (TY + 4) / M, (TZ + 7) * VOXEL];
  // Gas bottles and fuel drums on the platform
  bottles(w, -4.5, 3.2);
  barrels.push(w.count() - 1);
  barrel(w, 4.5, 3, 0x2a8a3a, 4);
  barrels.push(w.count() - 1);
  // Two boats moored alongside, afloat (held by the sea: their hulls are what hold them)
  const boat = (cx: number, cy: number, L: number, Wd: number, hull: number, cabin: boolean) => {
    w.place(Math.round(cx * M) - L / 2, Math.round(cy * M) - Wd / 2, L, Wd, 12, (put) => {
      for (let x = 0; x < L; x++) {
        const taper = Math.min(1, (L - x) / 6);
        for (let y = 0; y < Wd; y++) {
          const off = Math.abs(y + 0.5 - Wd / 2);
          if (off > (Wd / 2) * taper + 0.2) continue;
          const side = off > (Wd / 2) * taper - 1;
          put(x, y, 3, Mat.Wood, hull);
          if (side || x === 0) for (let z = 4; z <= 5; z++) put(x, y, z, Mat.Wood, z === 5 ? 0xe8e2d4 : hull);
          if (cabin && x > 2 && x < L / 2 && !side) for (let z = 4; z < 9; z++) if (z === 8 || x === 3 || x === Math.floor(L / 2) - 1 || off > Wd / 2 - 2.5) put(x, y, z, z > 5 && z < 8 && x === Math.floor(L / 2) - 1 ? Mat.Glass : Mat.Wood, z === 8 ? 0xe8e2d4 : 0xd8d0bc);
        }
      }
    }, (_x, _y, z) => z === 3);
  };
  boat(-6, -6, 22, 8, 0x2f6fb0, true);
  boat(5.5, -10, 14, 6, 0xb3261e, false);
  // The lighthouse on its rock, off to the side: keep it standing
  w.place(Math.round(13 * M) - 10, Math.round(-2 * M) - 10, 20, 20, 52, (put) => {
    for (let z = 0; z < 52; z++)
      for (let y = 0; y < 20; y++)
        for (let x = 0; x < 20; x++) {
          const r = Math.hypot(x + 0.5 - 10, y + 0.5 - 10);
          if (z < 6) {
            if (r < 9.5 - z * 0.4) put(x, y, z, Mat.Rock, (x * 7 + y * 3 + z) % 4 ? 0x6a665e : 0x5a564e);
            continue;
          }
          const top = 44;
          if (z < top) {
            const rr = 5.2 - (z - 6) * 0.04;
            if (r < rr && r > rr - 1.2) put(x, y, z, Mat.Brick, Math.floor((z - 6) / 6) % 2 ? 0xe8e2d4 : 0xb3261e);
          } else if (z < top + 5) {
            if (r < 4.2 && r > 3.2) put(x, y, z, z < top + 1 || z > top + 3 ? Mat.Steel : Mat.LitGlass, z < top + 1 || z > top + 3 ? 0x2a2c30 : 0xffe9b0);
          } else if (r < 4.5 - (z - top - 5) * 1.2) put(x, y, z, Mat.Steel, 0x2a2c30);
        }
  });
  keep.push(w.count() - 1);
  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 8,
      name: LEVELS[8].name,
      brief: LEVELS[8].brief,
      job: LEVELS[8].job,
      time: 90,
      charges: 4,
      cutters: 2,
      rockets: 2,
      pipes: 3,
      targets,
      keep,
      keepName: 'Lighthouse',
      barrels,
      tankBox,
      sea: 1.0,
      spawn: [0, -18, Math.PI / 2, 0.08],
      spawnZ: (DECK + 1) * VOXEL,
      intro: { from: [-16, -24, 9], look: [0, 6, 2] },
      hour: 18.3,
      sunAz: -1.2,
      sunEl: 9,
      bounds: 22,
      grass: false,
      focus: [0, 7, 3],
      stars: [0.5, 0.75, 0.9],
    },
  };
}

/** Stone: the quarry's sandstone and the church's walls (hard-wearing medium masonry), in a few shades. */
const STONE = [0xb8a888, 0xa89878, 0xc4b494, 0x9c8c6c];

/**
 * Lot 10: a sandstone quarry at noon. Terraced faces of stone and dirt behind; in front the crusher house (a girder
 * frame clad in sheet steel on a concrete plinth) and the conveyor gantry climbing from it to a stockpile; a site
 * office to keep standing; gravel heaps, the explosives store's drums. (The crane and the excavator parked by it are
 * the machines', off for now: machines.ts VEHICLES.)
 */
function quarry(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const r = random(seed + 9);
  const targets: number[] = [];
  const keep: number[] = [];
  const barrels: number[] = [];
  // The face: three terraces of stone across the back of the lot, dirt on the benches. Only their skins are
  // stone (three voxels deep at the faces, two on the benches): a quarry is hillside, and this is what you can reach
  const [FW, FD] = [112, 36];
  const tops = [12, 22, 32];
  w.place(Math.round(-14 * M), Math.round(10 * M), FW, FD, 36, (put) => {
    for (let y = 0; y < FD; y++) {
      const tier = Math.min(2, Math.floor(y / 12));
      const top = tops[tier];
      const front = y % 12 < 3;
      for (let x = 0; x < FW; x++) {
        const jag = Math.floor(r() * 3);
        const lid = top - jag;
        // The column under the bench (front skin) and its cap, and the cells below the cap held up by the tier below
        const from = front ? 0 : Math.max(0, lid - 2);
        for (let z = from; z < lid; z++) {
          const bench = z >= lid - 2 && y % 12 >= 3;
          put(x, y, z, bench ? Mat.Dirt : Mat.Concrete, bench ? 0x7a6040 : STONE[(x + 3 * z + (y >> 2)) % 4]);
        }
        // (a bench's cap rests on stone pillars every two metres, so nothing of it hangs)
        if (!front && x % 8 === 0 && y % 4 === 1) for (let z = 0; z < from; z++) put(x, y, z, Mat.Concrete, STONE[(x + z) % 4]);
      }
    }
  });
  // The crusher house: 8 x 6 m, 7 m to the eaves, girders and sheet steel on a concrete plinth
  const [CW, CD, CH] = [32, 24, 28];
  w.place(Math.round(-9 * M) - CW / 2, Math.round(-1 * M) - CD / 2, CW, CD, CH + 2, (put) => {
    for (let z = 0; z <= CH; z++)
      for (let y = 0; y < CD; y++)
        for (let x = 0; x < CW; x++) {
          const wall = x === 0 || y === 0 || x === CW - 1 || y === CD - 1;
          const column = (x % 10 === 0 || x === CW - 1) && (y === 0 || y === CD - 1);
          if (z < 3) {
            if (wall || z === 0) put(x, y, z, Mat.Concrete, 0x8e8a82);
          } else if (z === CH) put(x, y, z, Mat.Roof, 0x6b6f75);
          else if (column) put(x, y, z, Mat.Girder, 0xd09a2a);
          else if (wall) {
            const hatch = y === 0 && x >= 12 && x < 20 && z < 14;
            if (!hatch) put(x, y, z, Mat.Steel, z % 2 ? 0x9a8a5a : 0x8a7a4c);
          } else if (z === 12 && x > 4 && x < CW - 5 && y > 4 && y < CD - 5) put(x, y, z, Mat.Steel, 0x3a3d42);
        }
  });
  targets.push(w.count() - 1);
  // The conveyor: a girder gantry climbing from the crusher house to the stockpile, on trestles
  w.place(Math.round(-1 * M), Math.round(-3 * M), 64, 6, 40, (put) => {
    for (let x = 0; x < 64; x++) {
      const z = 10 + Math.floor(x * 0.42);
      // (Stepped up a voxel at a time: each step's riser keeps the belt joined face to face)
      const was = x > 0 ? 10 + Math.floor((x - 1) * 0.42) : z;
      for (let y = 1; y < 5; y++) for (let zz = was; zz <= z; zz++) put(x, y, zz, Mat.Steel, y === 1 || y === 4 ? 0xd09a2a : 0x2a2c30);
      if (x % 16 === 4) for (let zz = 0; zz < z; zz++) for (const y of [0, 5]) put(x, y, zz, Mat.Girder, 0xd09a2a);
      if (x % 16 === 4) for (let y = 0; y < 6; y++) put(x, y, Math.max(0, z - 1), Mat.Girder, 0xd09a2a);
    }
  });
  targets.push(w.count() - 1);
  // The stockpile at its top end: a heap of gravel (dirt)
  w.place(Math.round(16 * M) - 12, Math.round(-2 * M) - 12, 24, 24, 16, (put) => {
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const h = 15 - Math.hypot(x + 0.5 - 12, y + 0.5 - 12) * 1.3;
        for (let z = 0; z < h; z++) put(x, y, z, Mat.Dirt, (x + y + z) % 3 ? 0x9a8a70 : 0x8a7a60);
      }
  });
  // The site office: a brick cabin with a window, to keep
  w.place(Math.round(-16 * M), Math.round(-14 * M), 20, 14, 13, (put) => {
    for (let z = 0; z < 12; z++)
      for (let y = 0; y < 14; y++)
        for (let x = 0; x < 20; x++) {
          const wall = x === 0 || y === 0 || x === 19 || y === 13;
          if (z === 0) put(x, y, z, Mat.Concrete, 0x9a968d);
          else if (z === 11) put(x, y, z, Mat.Roof, 0x55524c);
          else if (wall) put(x, y, z, y === 0 && x > 4 && x < 15 && z > 4 && z < 9 ? Mat.Glass : Mat.Brick);
        }
  });
  keep.push(w.count() - 1);
  // The explosives store's drums and a boulder or two
  for (const [x, y] of [
    [6, -9],
    [7.1, -9.3],
    [6.4, -10.3],
  ]) {
    barrel(w, x, y, 0xc8392b, 5);
    barrels.push(w.count() - 1);
  }
  boulder(w, 2, 6, 1.6, 1.3, 1.4, seed + 1);
  boulder(w, -16, 4, 1.4, 1.2, 1.2, seed + 2);
  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 9,
      name: LEVELS[9].name,
      brief: LEVELS[9].brief,
      job: LEVELS[9].job,
      time: 100,
      charges: 4,
      cutters: 3,
      rockets: 2,
      pipes: 3,
      targets,
      keep,
      keepName: 'Site office',
      barrels,
      spawn: [2, -17, Math.PI / 2 + 0.2, 0.15],
      machines: [
        { kind: 'crane', at: [9, -12], heading: Math.PI / 2 + 0.6 },
        { kind: 'excavator', at: [-10, -15], heading: Math.PI / 2 + 0.3 },
      ],
      intro: { from: [18, -24, 16], look: [-4, 0, 4] },
      hour: 12.5,
      bounds: 22,
      grass: true,
      focus: [-3, 0, 4],
      stars: [0.55, 0.8, 0.94],
    },
  };
}

/**
 * Lot 11: a stone church on a green: a nave of grey stone with tall windows and a slate roof, and at its west end
 * a square stone tower with a timber belfry and a slate spire, 24 m to the cross. The job: the steeple, felled
 * clear of the nave (which is to be kept); its lower stage is reinforced (only charges and cutters cut it).
 */
function church(seed: number): { city: City; level: Level } {
  const w = worldBuilder(seed);
  const targets: number[] = [];
  const keep: number[] = [];
  const barrels: number[] = [];
  const GREY = [0x9a968c, 0x8e8a80, 0xa6a296, 0x86827a];
  // The nave: 16 x 9 m, walls 6 m to the eaves, buttresses, lancet windows, a pitched slate roof
  const [NW, ND, NH] = [64, 36, 24];
  w.place(Math.round(-4 * M), Math.round(0 * M), NW, ND, NH + 20, (put) => {
    for (let z = 0; z < NH; z++)
      for (let y = 0; y < ND; y++)
        for (let x = 0; x < NW; x++) {
          const wall = x === 0 || y === 0 || x === NW - 1 || y === ND - 1 || (z < 2 && (x < 2 || y < 2 || x > NW - 3 || y > ND - 3));
          if (z === 0) {
            put(x, y, z, Mat.Concrete, 0x8a867c);
            continue;
          }
          if (!wall) continue;
          const lancet = (y === 0 || y === ND - 1) && x % 10 === 5 && z > 5 && z < 18;
          const lancetW = (y === 0 || y === ND - 1) && (x % 10 === 4 || x % 10 === 6) && z > 6 && z < 17;
          if (lancet || lancetW) {
            put(x, y, z, Mat.Glass, 0x6a8aa8);
            continue;
          }
          put(x, y, z, Mat.Brick, GREY[(x + 2 * z + y) % 4]);
        }
    // The roof: slate, pitched along the nave
    for (let x = 0; x < NW; x++)
      for (let y = 0; y < ND; y++) {
        const rise = Math.min(y, ND - 1 - y);
        const z = NH + Math.floor(rise * 0.9);
        put(x, y, z, Mat.Roof, (x + y) % 2 ? 0x4b4e57 : 0x434650);
        if (x === 0 || x === NW - 1) for (let zz = NH; zz < z; zz++) put(x, y, zz, Mat.Brick, GREY[(zz + y) % 4]);
      }
  });
  keep.push(w.count() - 1);
  // The steeple: at the nave's west end, 5 m square; a reinforced lower stage, stone above, a timber belfry, a spire
  const S = 20;
  w.place(Math.round(-4 * M) - S, Math.round(0 * M) + 8, S, S, 100, (put) => {
    for (let z = 0; z < 100; z++)
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const wall = x < 2 || y < 2 || x >= S - 2 || y >= S - 2;
          if (z < 14) {
            if (wall || z === 0) put(x, y, z, Mat.RCConcrete, GREY[(x + z + y) % 4]);
          } else if (z < 52) {
            const louvre = z > 40 && z < 50 && (x === 0 || y === 0 || x === S - 1 || y === S - 1) && (x % 6 === 3 || y % 6 === 3);
            if (wall) put(x, y, z, louvre ? Mat.Wood : Mat.Brick, louvre ? 0x5a4026 : GREY[(x + 2 * z + y) % 4]);
            if (z % 12 === 0 && !wall) put(x, y, z, Mat.Wood, 0x6e5034);
          } else if (z < 56) {
            put(x, y, z, Mat.Brick, 0x7c786e);
          } else {
            // The spire: a slate pyramid on timber
            const half = (S / 2) * (1 - (z - 56) / 42);
            if (half < 0.5) continue;
            const dx = Math.abs(x + 0.5 - S / 2);
            const dy = Math.abs(y + 0.5 - S / 2);
            if (Math.max(dx, dy) <= half && Math.max(dx, dy) > half - 1.4) put(x, y, z, Mat.Roof, (x + z) % 2 ? 0x3f424a : 0x4b4e57);
          }
        }
    // The cross
    for (let z = 97; z < 100; z++) put(S / 2, S / 2, z, Mat.Steel, 0xd8a520);
  });
  targets.push(w.count() - 1);
  // The churchyard: a wall, yews, a couple of headstones; the verger's gas bottles by the vestry
  for (let k = 0; k < 6; k++) w.place(Math.round((-12 + k * 2.6) * M), Math.round(-9 * M), 2, 4, 4, (put) => {
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (z < 3 || (y > 0 && y < 3)) put(x, y, z, Mat.Concrete, 0x9a968c);
  });
  tree(w, 16, -8, seed + 3);
  tree(w, -14, 14, seed + 4);
  hedge(w, -22, -14, 22, -13, 4, seed + 5);
  bottles(w, 14, 4);
  barrels.push(w.count() - 1);
  const city = finishLot(w, { pitch: 60, street: 14, blocks: 1 });
  return {
    city,
    level: {
      id: 10,
      name: LEVELS[10].name,
      brief: LEVELS[10].brief,
      job: LEVELS[10].job,
      time: 100,
      charges: 5,
      cutters: 3,
      rockets: 2,
      pipes: 2,
      targets,
      keep,
      keepName: 'Nave',
      barrels,
      zone: { x: -9, y: -10, r: 5, object: targets[0] },
      spawn: [6, -18, Math.PI / 2 + 0.45, 0.25],
      machines: [{ kind: 'crane', at: [-17, -11], heading: Math.PI / 2 - 0.1 }],
      intro: { from: [14, -24, 20], look: [-6, 4, 12] },
      hour: 17.6,
      sunAz: -2.1,
      sunEl: 16,
      bounds: 22,
      grass: true,
      focus: [-6, 4, 10],
      stars: [0.6, 0.8, 0.95],
    },
  };
}

/** Metres per voxel (re-exported for the game layer). */
export const VOXEL_M = VOXEL;
