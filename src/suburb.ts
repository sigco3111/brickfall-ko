// The neighbourhood round a garden lot: rows of small houses with gable roofs and a ring of trees
// fading into the haze. Drawn only (three instanced meshes, flat colours), nothing in the physics:
// it sets the lot in a street, so the diorama reads as a place and not a test range.

import * as THREE from 'three/webgpu';
import { random } from './world.ts';

export function suburb(lot: number, seed = 5): THREE.Group {
  const rnd = random(seed);
  const group = new THREE.Group();
  const houses: { x: number; y: number; w: number; d: number; h: number; rot: number; wall: number; roof: number }[] = [];
  const trees: { x: number; y: number; r: number; h: number; c: number }[] = [];
  const walls = [0xa4553d, 0xb8624a, 0xd8cdb6, 0xe6dbc2, 0x9a4a35, 0xc9b79a, 0x8f6a52];
  const roofs = [0x4b4e57, 0x5b4038, 0x3f444d, 0x6a3b2e];
  const greens = [0x4d6b34, 0x587a3a, 0x648842, 0x3f5f2c, 0x6f9248];
  // Houses along the streets round the lot, facing in, a row each side; more further out
  const edge = lot / 2 + 16;
  for (let ring = 0; ring < 3; ring++) {
    const off = edge + ring * 26;
    for (let side = 0; side < 4; side++) {
      for (let a = -off - 10; a <= off + 10; a += 11 + rnd() * 5) {
        if (rnd() < 0.18) continue;
        const along = a + (rnd() - 0.5) * 2;
        const out = off + 4 + rnd() * 6;
        const [x, y] = side === 0 ? [along, -out] : side === 1 ? [along, out] : side === 2 ? [-out, along] : [out, along];
        // Keep the low sun's corner (south-west) open so it can set over the gardens
        if (x < -edge && y < -edge && ring < 2) continue;
        const w = 7 + rnd() * 3;
        const d = 6 + rnd() * 3;
        houses.push({ x, y, w, d, h: rnd() < 0.3 ? 3.2 : 6, rot: side < 2 ? 0 : Math.PI / 2, wall: walls[Math.floor(rnd() * walls.length)], roof: roofs[Math.floor(rnd() * roofs.length)] });
        if (rnd() < 0.6) trees.push({ x: x + (rnd() - 0.5) * 12, y: y + (rnd() - 0.5) * 12, r: 2 + rnd() * 2, h: 5 + rnd() * 4, c: greens[Math.floor(rnd() * greens.length)] });
      }
    }
  }
  // A belt of trees further out, thick enough to close the horizon in the haze
  for (let k = 0; k < 140; k++) {
    const a = rnd() * Math.PI * 2;
    const r = edge + 80 + rnd() * 90;
    trees.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 4 + rnd() * 4, h: 10 + rnd() * 8, c: greens[Math.floor(rnd() * greens.length)] });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const z = new THREE.Vector3(0, 0, 1);
  const c = new THREE.Color();
  // Bodies
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), houses.length);
  // Roofs: a prism (a triangle swept along the ridge)
  const prism = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1);
  prism.rotateZ(Math.PI / 2);
  const roof = new THREE.InstancedMesh(prism, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), houses.length);
  houses.forEach((h, k) => {
    q.setFromAxisAngle(z, h.rot);
    m.compose(p.set(h.x, h.y, h.h / 2), q, s.set(h.w, h.d, h.h));
    body.setMatrixAt(k, m);
    body.setColorAt(k, c.setHex(h.wall));
    m.compose(p.set(h.x, h.y, h.h + h.d * 0.75 * 0.25), q, s.set(h.w * 1.08, h.d * 1.3, h.d * 0.75));
    roof.setMatrixAt(k, m);
    roof.setColorAt(k, c.setHex(h.roof));
  });
  // Trees: a faceted crown on a trunk
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), trees.length);
  const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), trees.length);
  trees.forEach((t, k) => {
    q.setFromAxisAngle(z, rnd() * 6);
    m.compose(p.set(t.x, t.y, t.h - t.r * 0.6), q, s.set(t.r, t.r, t.r * 1.1));
    crown.setMatrixAt(k, m);
    crown.setColorAt(k, c.setHex(t.c));
    m.compose(p.set(t.x, t.y, (t.h - t.r) / 2), q, s.set(0.5, 0.5, t.h - t.r));
    trunk.setMatrixAt(k, m);
  });
  for (const mesh of [body, roof, crown, trunk]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
