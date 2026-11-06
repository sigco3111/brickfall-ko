// The sea: one flat surface to the horizon, a single plane (a fluid simulation would be far too costly
// here). Murky and opaque, so what sinks is gone from sight;
// ripples from two drifting octaves of noise bend its normal for the sun's glints and the sky's reflection; and
// the last sixteen splashes spread rings of foam that fade. Buoyancy and drag on the debris are physics.ts's.

import * as THREE from 'three/webgpu';
import { exp, float, length, max, mix, mx_noise_float, normalize, positionWorld, smoothstep, transformNormalToView, uniform, uniformArray, vec2, vec3 } from 'three/tsl';

const RINGS = 16;

export class Sea {
  readonly mesh: THREE.Mesh;
  level: number;
  private readonly clock = uniform(0);
  private readonly rings = uniformArray(
    Array.from({ length: RINGS }, () => new THREE.Vector4(0, 0, -100, 0)),
    'vec4',
  );
  private next = 0;
  private time = 0;

  constructor(level: number) {
    this.level = level;
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.1, metalness: 0 });
    const p = positionWorld.xy;
    const t = this.clock;
    // The surface's height: a slow swell and a finer chop, drifting with the wind
    // biome-ignore lint/suspicious/noExplicitAny: a TSL vec2 of any make
    const height = (q: any) =>
      mx_noise_float(vec3(q.mul(0.22), t.mul(0.18)))
        .mul(0.5)
        .add(mx_noise_float(vec3(q.mul(0.9).add(vec2(t.mul(0.35), t.mul(0.12))), t.mul(0.5))).mul(0.18));
    const e = 0.15;
    const h0 = height(p);
    const dx = height(p.add(vec2(e, 0))).sub(h0).div(e);
    const dy = height(p.add(vec2(0, e))).sub(h0).div(e);
    // Foam: rings spreading from the splashes, fading as they go
    // biome-ignore lint/suspicious/noExplicitAny: TSL nodes built in a loop
    let foam: any = float(0);
    for (let k = 0; k < RINGS; k++) {
      // biome-ignore lint/suspicious/noExplicitAny: a vec4 element of the uniform array
      const r = this.rings.element(k) as any;
      const age = t.sub(r.z);
      const radius = age.mul(r.w.mul(1.6).add(1.2));
      const d = length(p.sub(r.xy)).sub(radius).abs();
      const ring = smoothstep(float(0.35).add(r.w.mul(0.1)), float(0), d).mul(exp(age.mul(-1.1))).mul(smoothstep(float(0), float(0.05), age));
      // and the white water where it went in
      const core = smoothstep(r.w.mul(0.6).add(0.4), float(0), length(p.sub(r.xy))).mul(exp(age.mul(-2.2))).mul(smoothstep(float(0), float(0.03), age));
      foam = max(foam, max(ring, core));
    }
    const normal = normalize(vec3(dx.mul(-0.35), dy.mul(-0.35), 1));
    material.normalNode = transformNormalToView(normal) as unknown as THREE.Node<'vec3'>;
    const deep = vec3(0.03, 0.12, 0.14);
    const light = vec3(0.07, 0.24, 0.26);
    const water = mix(deep, light, h0.mul(0.5).add(0.5));
    material.colorNode = mix(water, vec3(0.85, 0.9, 0.9), foam.min(1)) as unknown as THREE.Node<'color'>;
    material.roughnessNode = mix(float(0.08), float(0.6), foam.min(1)) as unknown as THREE.Node<'float'>;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), material);
    this.mesh.position.z = level;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  /** Move the surface (a new lot). */
  setLevel(level: number): void {
    this.level = level;
    this.mesh.position.z = level;
  }

  /** A splash at (x, y) of `size` (0..2): a ring of foam spreading from it. */
  splash(x: number, y: number, size: number): void {
    this.rings.array[this.next] = new THREE.Vector4(x, y, this.time, Math.min(2, size));
    this.next = (this.next + 1) % RINGS;
  }

  update(dt: number): void {
    this.time += dt;
    this.clock.value = this.time;
  }
}
