// Brickfall 1.1.0: hardness tiers. Each tool's hole reaches each material only as far as its tier's radius
// (the hardness table), a sledge never breaks anything hard, nothing breaks bedrock; and the load model weighs
// what carries a storey by material (a girder holds up more than its size in brick).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RADII, within } from '../src/destruction.ts';
import { Structure } from '../src/structure.ts';
import { buildCity, Mat, TIER, VOXEL } from '../src/world.ts';

const city = buildCity(7);
const girder = (() => {
  for (let v = 0; v < city.count; v++) if (city.material[v] === Mat.Girder && city.position[3 * v + 2] > 2) return v;
  return -1;
})();
const at = Array.from(city.position.subarray(3 * girder, 3 * girder + 3));
const slack = VOXEL * 0.87;
const farthest = (voxels: number[], tier: number) =>
  Math.max(0, ...voxels.filter((v) => TIER[city.material[v] as Mat] === tier).map((v) => Math.hypot(city.position[3 * v] - at[0], city.position[3 * v + 1] - at[1], city.position[3 * v + 2] - at[2])));

describe('hardness tiers', () => {
  test('the corner tower has a steel frame and a reinforced core', () => {
    assert.ok(girder >= 0);
    let rc = 0;
    for (let v = 0; v < city.count; v++) if (city.material[v] === Mat.RCConcrete) rc++;
    assert.ok(rc > 500, `reinforced voxels: ${rc}`);
  });

  test('each tool reaches each tier only as far as its radius', () => {
    for (const [name, radii] of [
      ['charge', RADII.charge],
      ['propane', RADII.propane],
      ['cannon, first wall', RADII.cannon(0)],
      ['cannon, third wall', RADII.cannon(2)],
      ['sledge, full swing', RADII.sledge(1)],
      ['sledge, tap', RADII.sledge(0.2)],
    ] as const) {
      const hit = within(city, at, Math.max(...radii), -1, radii);
      for (const tier of [0, 1, 2]) assert.ok(farthest(hit, tier) <= radii[tier] + slack, `${name}: tier ${tier} reached ${farthest(hit, tier).toFixed(2)} m, radius ${radii[tier]}`);
      if (radii[2] === 0) assert.equal(hit.filter((v) => TIER[city.material[v] as Mat] >= 2).length, 0, `${name} broke something hard`);
    }
  });

  test('a charge cuts a girder; the sledge and the cannon never do', () => {
    assert.ok(within(city, at, 1, -1, RADII.charge).includes(girder));
    assert.ok(!within(city, at, 1.6, -1, RADII.sledge(1)).includes(girder));
    assert.ok(!within(city, at, 1.6, -1, RADII.cannon(0)).includes(girder));
  });

  test('a full swing takes at most a few voxels of brick, a tap none', () => {
    // A brick wall of the starter home isn't in this city: build a small slab of brick round a point
    let brick = -1;
    for (let v = 0; v < city.count && brick < 0; v++) if (city.material[v] === Mat.Concrete && TIER[Mat.Concrete] === TIER[Mat.Brick]) brick = v;
    const p = Array.from(city.position.subarray(3 * brick, 3 * brick + 3));
    const medium = (r: readonly [number, number, number]) => within(city, p, Math.max(...r), -1, r).filter((v) => TIER[city.material[v] as Mat] === 1).length;
    // (A full swing's medium radius is 0.35 m: in a slab, a disc of voxels, a handful)
    assert.ok(medium(RADII.sledge(1)) <= 9, `full swing: ${medium(RADII.sledge(1))}`);
    assert.equal(medium(RADII.sledge(0.2)), 0);
  });
});

describe('the load, by material', () => {
  test('a storey stands at 1/MARGIN as built, and losing its girders loads it more than losing as much brick', () => {
    const s = new Structure(city);
    const before = s.stress(0);
    assert.ok(before.r > 0 && before.r < 0.8, `as built: ${before.r}`);
    const layer = 20;
    const voxels = s.layerVoxels(0, layer);
    const girders = voxels.filter((v) => city.material[v] === Mat.Girder);
    const others = voxels.filter((v) => city.material[v] !== Mat.Girder && city.material[v] !== Mat.Glass && city.material[v] !== Mat.LitGlass).slice(0, girders.length);
    const a = new Structure(buildCity(7));
    const b = new Structure(buildCity(7));
    a.leave(girders);
    b.leave(others);
    const ra = a.layerStress(0)[layer];
    const rb = b.layerStress(0)[layer];
    assert.ok(ra > rb, `girders gone: ${ra.toFixed(3)}, as many others gone: ${rb.toFixed(3)}`);
  });
});
