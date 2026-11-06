// The tools in hand, drawn in front of the camera: a sledgehammer, a hand cannon and a sticky
// charge (with its detonator in the other hand once charges are set). Simple shapes lit like the
// world, animated procedurally: springs for recoil and sway (they overshoot and settle), a bob in
// step with the walk, a dip on landing, a wind-up while the sledge charges and a hit-stop on the
// blow. Based on the viewmodel of three-voxel-destruction (MIT, Steven Bobyn).

import * as THREE from 'three/webgpu';

const metal = (c: number, rough = 0.35) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.85, roughness: rough });
const matte = (c: number, rough = 0.7) => new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: rough });
const glow = (c: number, k = 3) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: k });

function part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  return m;
}

const BUTTON_LIT = new THREE.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xff0c08, emissiveIntensity: 2 });
const BUTTON_DARK = matte(0x4a0806, 0.4);
const LED_ON = glow(0xff2010, 6);
const LED_OFF = matte(0x300404, 0.4);

/** A critically-ish damped spring on a vector: kicked by impulses, pulled back to zero. */
class Spring {
  readonly value = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly stiffness: number;
  private readonly damping: number;
  constructor(stiffness: number, damping: number) {
    this.stiffness = stiffness;
    this.damping = damping;
  }
  kick(x: number, y: number, z: number): void {
    this.velocity.x += x;
    this.velocity.y += y;
    this.velocity.z += z;
  }
  update(dt: number, target?: THREE.Vector3): void {
    // Sub-stepped so a long frame can't blow it up
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const tx = target ? target.x : 0;
      const ty = target ? target.y : 0;
      const tz = target ? target.z : 0;
      this.velocity.x += (-(this.value.x - tx) * this.stiffness - this.velocity.x * this.damping) * h;
      this.velocity.y += (-(this.value.y - ty) * this.stiffness - this.velocity.y * this.damping) * h;
      this.velocity.z += (-(this.value.z - tz) * this.stiffness - this.velocity.z * this.damping) * h;
      this.value.addScaledVector(this.velocity, h);
    }
  }
}

/** The models, in camera space (x right, y up, -z ahead), their grip at the origin. */
function models(): { tools: THREE.Group[]; detonator: THREE.Group; muzzleFlash: THREE.Mesh; led: THREE.Mesh } {
  // A sledgehammer: a long handle with a rubber grip and a heavy octagonal head, faces worn bright
  const hammer = new THREE.Group();
  hammer.add(part(new THREE.CylinderGeometry(0.018, 0.022, 0.86, 12), matte(0xd9a21b, 0.45), 0, 0.37, 0));
  hammer.add(part(new THREE.CylinderGeometry(0.025, 0.023, 0.22, 12), matte(0x151515, 0.95), 0, 0.02, 0));
  hammer.add(part(new THREE.CylinderGeometry(0.066, 0.066, 0.3, 8), metal(0x3a3d42, 0.5), 0, 0.82, 0, Math.PI / 2, 0, Math.PI / 8));
  for (const z of [-0.153, 0.153]) hammer.add(part(new THREE.CylinderGeometry(0.06, 0.066, 0.012, 8), metal(0xc8ccd2, 0.22), 0, 0.82, z, Math.PI / 2, 0, Math.PI / 8));
  hammer.add(part(new THREE.BoxGeometry(0.055, 0.035, 0.13), metal(0x2a2c30, 0.6), 0, 0.76, 0));

  // A hand cannon: a stubby iron barrel with a flared, banded muzzle on a short oak stock
  const cannon = new THREE.Group();
  const iron = metal(0x26292d, 0.5);
  const brass = metal(0x8a6a34, 0.4);
  cannon.add(part(new THREE.CylinderGeometry(0.05, 0.064, 0.62, 20), iron, 0, 0.07, -0.34, Math.PI / 2));
  cannon.add(part(new THREE.CylinderGeometry(0.072, 0.058, 0.06, 20), brass, 0, 0.07, -0.66, Math.PI / 2));
  for (const z of [-0.16, -0.42]) cannon.add(part(new THREE.CylinderGeometry(0.062, 0.062, 0.025, 20), brass, 0, 0.07, z, Math.PI / 2));
  cannon.add(part(new THREE.CylinderGeometry(0.036, 0.036, 0.01, 20), matte(0x050505, 1), 0, 0.07, -0.692, Math.PI / 2));
  cannon.add(part(new THREE.SphereGeometry(0.048, 16, 12), iron, 0, 0.07, -0.04));
  cannon.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), brass, 0, 0.12, -0.08));
  cannon.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.2), matte(0x6b4428, 0.6), 0, 0.0, -0.1, 0.12));
  cannon.add(part(new THREE.BoxGeometry(0.04, 0.1, 0.045), matte(0x4a2e1a, 0.7), 0, -0.06, -0.06, 0.3));
  const muzzleFlash = part(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.4, 1.2) }), 0, 0.07, -0.78);
  muzzleFlash.scale.set(1, 1, 2.4);
  muzzleFlash.visible = false;
  cannon.add(muzzleFlash);

  // A sticky charge: a khaki block taped up in orange, a blinking light, a coil of wire
  const charge = new THREE.Group();
  charge.add(part(new THREE.BoxGeometry(0.16, 0.09, 0.12), matte(0x8a8458, 0.8), 0, 0.03, -0.08));
  for (const x of [-0.045, 0.045]) charge.add(part(new THREE.BoxGeometry(0.022, 0.094, 0.124), matte(0xe0782a, 0.6), x, 0.03, -0.08));
  charge.add(part(new THREE.BoxGeometry(0.06, 0.02, 0.05), matte(0x1a1c1e, 0.5), 0, 0.085, -0.08));
  const led = part(new THREE.BoxGeometry(0.014, 0.01, 0.014), LED_ON, 0.016, 0.097, -0.08);
  charge.add(led);
  charge.add(part(new THREE.TorusGeometry(0.03, 0.004, 6, 16), matte(0xb02a1a, 0.5), -0.05, 0.09, -0.05, Math.PI / 2));

  // The detonator (left hand, once a charge is set): a chunky remote, a big red button, an antenna
  const detonator = new THREE.Group();
  detonator.add(part(new THREE.BoxGeometry(0.085, 0.04, 0.14), matte(0x2a2c2f, 0.55), 0, 0, -0.08));
  detonator.add(part(new THREE.BoxGeometry(0.09, 0.012, 0.145), matte(0xd9a21b, 0.5), 0, -0.016, -0.08));
  detonator.add(part(new THREE.TorusGeometry(0.027, 0.006, 8, 24), metal(0x9a9ea4, 0.35), 0, 0.022, -0.1, Math.PI / 2));
  const button = part(new THREE.CylinderGeometry(0.022, 0.024, 0.018, 24), BUTTON_LIT, 0, 0.026, -0.1);
  button.name = 'button';
  detonator.add(button);
  detonator.add(part(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 8), metal(0x888888), 0.028, 0.075, -0.14));
  detonator.add(part(new THREE.SphereGeometry(0.008, 8, 6), matte(0xd02a1a, 0.4), 0.028, 0.135, -0.14));
  charge.scale.setScalar(0.6);
  charge.position.x = 0.04;

  // A cutter charge: a long, thin strip of linear charge in a grey sleeve, a red end cap, its leads
  const cutter = new THREE.Group();
  cutter.add(part(new THREE.BoxGeometry(0.34, 0.035, 0.05), matte(0x5c6066, 0.6), 0, 0.03, -0.1));
  cutter.add(part(new THREE.BoxGeometry(0.33, 0.012, 0.03), glow(0xff6a10, 1.2), 0, 0.05, -0.1));
  for (const x of [-0.17, 0.17]) cutter.add(part(new THREE.BoxGeometry(0.02, 0.045, 0.06), matte(0xb02a1a, 0.5), x, 0.03, -0.1));
  cutter.add(part(new THREE.TorusGeometry(0.025, 0.004, 6, 16), matte(0xd9a21b, 0.5), 0.12, 0.07, -0.06, Math.PI / 2));
  cutter.scale.setScalar(0.55);

  // A jackhammer: a yellow motor housing, T-handles, a long chisel
  const jack = new THREE.Group();
  jack.add(part(new THREE.CylinderGeometry(0.055, 0.06, 0.26, 16), matte(0xd9a21b, 0.45), 0, 0.02, -0.18, Math.PI / 2.4));
  jack.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), matte(0x151515, 0.9), 0, 0.09, -0.06, 0, 0, Math.PI / 2));
  jack.add(part(new THREE.BoxGeometry(0.06, 0.06, 0.1), metal(0x3a3d42, 0.5), 0, 0.06, -0.06));
  jack.add(part(new THREE.CylinderGeometry(0.016, 0.01, 0.3, 8), metal(0xb8bcc2, 0.3), 0, -0.07, -0.38, Math.PI / 2.4));
  jack.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), metal(0x2a2c30, 0.6), 0, -0.03, -0.29, Math.PI / 2.4));

  // A rocket launcher: an olive tube with a flared back, a grip and sight, a rocket's nose in the front
  const rocket = new THREE.Group();
  const olive = matte(0x4f5a34, 0.6);
  rocket.add(part(new THREE.CylinderGeometry(0.052, 0.052, 0.95, 18), olive, 0, 0.08, -0.25, Math.PI / 2));
  rocket.add(part(new THREE.CylinderGeometry(0.075, 0.055, 0.1, 18), olive, 0, 0.08, 0.25, Math.PI / 2));
  rocket.add(part(new THREE.CylinderGeometry(0.04, 0.01, 0.12, 12), matte(0x8a2a1c, 0.5), 0, 0.08, -0.77, -Math.PI / 2));
  rocket.add(part(new THREE.BoxGeometry(0.03, 0.09, 0.04), matte(0x1a1c1e, 0.7), 0, -0.01, -0.12, 0.25));
  rocket.add(part(new THREE.BoxGeometry(0.02, 0.04, 0.08), matte(0x1a1c1e, 0.6), -0.05, 0.14, -0.3));
  // A pipe bomb: a grey steel pipe, red end caps, a fuse
  const pipe = new THREE.Group();
  pipe.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 12), metal(0x5a5e62, 0.45), 0, 0.03, -0.1, 0, 0, Math.PI / 2.3));
  for (const s of [-1, 1]) pipe.add(part(new THREE.CylinderGeometry(0.048, 0.048, 0.04, 12), matte(0x8a2a1c, 0.5), s * 0.11, 0.03 + s * 0.05, -0.1, 0, 0, Math.PI / 2.3));
  pipe.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 6), matte(0x2a2a2a, 0.9), 0.15, 0.12, -0.1, 0, 0, 0.6));
  // A plank: a short length of board under the arm, its end ahead
  const plank = new THREE.Group();
  plank.add(part(new THREE.BoxGeometry(0.14, 0.03, 0.7), matte(0xa7835a, 0.7), 0.02, -0.02, -0.25, 0.2, 0.15, 0.1));
  plank.add(part(new THREE.BoxGeometry(0.145, 0.032, 0.03), matte(0x6e5034, 0.7), 0.02, 0.05, -0.59, 0.2, 0.15, 0.1));
  // A cable: a coil of steel rope and its hook
  const cable = new THREE.Group();
  cable.add(part(new THREE.TorusGeometry(0.09, 0.018, 8, 20), metal(0x3a3d42, 0.5), 0, 0.02, -0.15, 0.3));
  cable.add(part(new THREE.BoxGeometry(0.04, 0.09, 0.025), metal(0xd9a21b, 0.4), 0.03, -0.07, -0.25));
  return { tools: [hammer, cannon, charge, cutter, jack, rocket, pipe, plank, cable], detonator, muzzleFlash, led };
}

const ease = (x: number) => x * x * (3 - 2 * x);
/** The sledge's swing (s): wind-up release, blow, recovery. */
const SWING = 0.34;

export class ViewModel {
  readonly object = new THREE.Group();
  private readonly tools: THREE.Group[];
  private readonly detonator: THREE.Group;
  private readonly muzzleFlash: THREE.Mesh;
  private readonly led: THREE.Mesh;
  private current = 0;
  /** Springs: position (m) and rotation (rad) offsets, and the mouse sway. */
  private readonly pos = new Spring(170, 15);
  private readonly rot = new Spring(150, 13);
  private readonly sway = new Spring(60, 11);
  private readonly swayTarget = new THREE.Vector3();
  private raise = 1;
  /** The swing in progress (0..1 remaining) and the sledge's charge (0..1, held). */
  private swing = 0;
  charge = 0;
  /** Seconds the blow holds still (hit-stop). */
  private stopped = 0;
  private flash = 0;
  private press = Infinity;
  private time = 0;
  /** Whether charges are set (the detonator comes up in the left hand). */
  armed = false;
  private armedLift = 0;
  /** The pack being pressed onto a wall (s since). */
  private placed = Infinity;

  /** Whether the jackhammer is running (it judders). */
  running = false;

  /** Seconds from releasing a swing to the sledge landing (the blow lands then). */
  static readonly STRIKE = 0.11;

  constructor() {
    const m = models();
    this.tools = m.tools;
    this.detonator = m.detonator;
    this.muzzleFlash = m.muzzleFlash;
    this.led = m.led;
    for (const t of this.tools) {
      t.visible = false;
      this.object.add(t);
    }
    this.tools[0].visible = true;
    this.detonator.visible = false;
    this.object.add(this.detonator);
  }

  /** Show every tool at once (so their shaders compile behind the loading screen), or put them back. */
  compileAll(on: boolean): void {
    this.tools.forEach((t, k) => (t.visible = on || k === this.current));
    this.detonator.visible = on;
    this.muzzleFlash.visible = on;
  }

  select(i: number): void {
    if (i === this.current) return;
    this.tools[this.current].visible = false;
    this.current = i;
    this.tools[i].visible = true;
    this.raise = 1;
    this.swing = 0;
    this.charge = 0;
  }

  /** The sledge swung (`power` 0..1 from the charge). */
  swingSledge(power: number): void {
    this.swing = 1;
    this.rot.kick(-2 - power * 2, 0, 0);
  }
  /** The cannon fired: a hard kick back and up, the flash at the muzzle. */
  fire(): void {
    this.pos.kick(0, 0.4, 2.6);
    this.rot.kick(5.5, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.5);
    this.flash = 0.06;
  }
  /** A charge pressed onto a wall: the hand pushes forward, a new pack comes up. */
  place(): void {
    this.placed = 0;
    this.pos.kick(0, 0.2, -1.6);
  }
  /** The detonator's button pressed. */
  detonate(): void {
    this.press = 0;
    this.rot.kick(0.8, 0, 0);
  }
  /** The blow landed: the swing holds still for `seconds` (a hit-stop sells the weight). */
  hitstop(seconds = 0.06): void {
    this.stopped = seconds;
    this.pos.kick(0, -0.25, 0.4);
  }
  /** The blow bounced off something too hard: the tool kicks back `scale` times as hard, and doesn't hold. */
  bounce(scale = 1.5): void {
    this.stopped = 0;
    this.pos.kick(0, -0.25 * scale, 0.4 * scale);
    this.rot.kick(3 * scale, (Math.random() - 0.5) * scale, (Math.random() - 0.5) * 2 * scale);
  }
  /** Landing from a fall at `speed` m/s: the tool dips and springs back. */
  land(speed: number): void {
    this.pos.kick(0, -Math.min(1.6, speed * 0.12), 0);
  }
  /** A blast nearby shoves the tool (strength 0..1). */
  jolt(strength: number): void {
    this.pos.kick((Math.random() - 0.5) * strength, (Math.random() - 0.5) * strength, strength * 0.5);
    this.rot.kick((Math.random() - 0.5) * strength * 3, (Math.random() - 0.5) * strength * 3, (Math.random() - 0.5) * strength * 4);
  }

  /** Mouse movement this frame (pixels): the tool lags behind the look. */
  look(dx: number, dy: number): void {
    this.swayTarget.x = Math.max(-1, Math.min(1, this.swayTarget.x - dx * 0.004));
    this.swayTarget.y = Math.max(-1, Math.min(1, this.swayTarget.y + dy * 0.004));
  }

  /** Place it for this frame: walking phase (radians), speed share (0..1), sprinting. */
  update(dt: number, walk: number, speed: number, sprint: boolean): void {
    this.time += dt;
    const frozen = this.stopped > 0;
    this.stopped = Math.max(0, this.stopped - dt);
    if (!frozen) {
      this.swing = Math.max(0, this.swing - dt / SWING);
      this.pos.update(dt);
      this.rot.update(dt);
    }
    this.swayTarget.multiplyScalar(Math.exp(-dt * 10));
    this.sway.update(dt, this.swayTarget);
    this.raise = Math.max(0, this.raise - dt * 4);
    this.press += dt;
    this.placed += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.muzzleFlash.visible = this.flash > 0;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    const s = this.sway.value;
    const bob = Math.sin(walk) * 0.014 * speed;
    const side = Math.cos(walk * 0.5) * 0.012 * speed;
    const run = sprint ? 1 : 0;
    const t = this.tools[this.current];
    const p = this.pos.value;
    const r = this.rot.value;
    t.position.set(0.22 + side + s.x * 0.035 - run * 0.04 + p.x * 0.05, -0.21 + bob - this.raise * 0.28 + s.y * 0.025 - run * 0.05 + p.y * 0.05, -0.4 + p.z * 0.05);
    if (this.current === 0) {
      // The sledge rests on the shoulder; charging draws it back and up; a swing brings it down
      // hard (landing at STRIKE), holds a beat on the blow, then lifts it back to the shoulder
      const rest = -0.35;
      const wind = ease(Math.min(1, this.charge));
      let angle = rest + (0.55 - rest) * wind;
      let lean = wind * 0.35;
      if (this.swing > 0) {
        const u = 1 - this.swing;
        angle = u < 0.32 ? 0.55 + (-1.8 - 0.55) * (u / 0.32) ** 2 : u < 0.45 ? -1.8 + 0.07 * Math.sin(((u - 0.32) / 0.13) * Math.PI) : -1.8 + (rest + 1.8) * ease((u - 0.45) / 0.55);
        lean = u < 0.45 ? Math.sin(Math.min(1, u / 0.32) * Math.PI * 0.5) : 1 - ease((u - 0.45) / 0.55);
      }
      const shiver = this.charge > 0.95 ? Math.sin(this.time * 70) * 0.006 : 0;
      t.rotation.set(angle + run * 0.4 + r.x * 0.05, 0.15 + s.x * 0.2 - lean * 0.15 + r.y * 0.05, -0.35 + lean * 0.25 + r.z * 0.05);
      t.position.y += lean * 0.12 + shiver;
      t.position.x -= lean * 0.17;
      t.position.z += wind * 0.05;
    } else {
      t.rotation.set(r.x * 0.05 + s.y * 0.1 - run * 0.5, s.x * 0.15 + run * 0.6 + r.y * 0.05, r.z * 0.05);
      if (this.current === 4) {
        // The jackhammer judders while it runs
        const j = this.running ? 1 : 0;
        t.position.x += Math.sin(this.time * 113) * 0.006 * j;
        t.position.y += Math.sin(this.time * 97 + 1) * 0.008 * j - 0.04;
        t.position.z -= j * 0.06;
      }
      if (this.current === 2 || this.current === 3) {
        // Held low and to the right, turned toward the wall it's going on
        t.position.x += 0.05;
        t.position.y -= 0.07;
        t.rotation.y -= 0.5;
        t.rotation.x += 0.35;
        // The pack: pressed forward onto the wall, then a fresh one comes up from below
        const q = this.placed;
        const push = q < 0.12 ? ease(q / 0.12) : q < 0.2 ? 1 : 0;
        const up = q >= 0.2 && q < 0.55 ? 1 - ease((q - 0.2) / 0.35) : 0;
        t.position.z -= push * 0.18;
        t.position.y -= up * 0.25;
        t.rotation.x -= push * 0.4;
        this.led.material = Math.sin(this.time * 9) > 0 ? LED_ON : LED_OFF;
      }
    }
    // The detonator in the left hand while charges are set
    this.armedLift += ((this.armed ? 1 : 0) - this.armedLift) * Math.min(1, dt * 8);
    const d = this.detonator;
    d.visible = this.armedLift > 0.02;
    if (d.visible) {
      const pr = this.press;
      const tip = pr < 0.07 ? ease(pr / 0.07) : pr < 0.16 ? 1 : pr < 0.45 ? 1 - ease((pr - 0.16) / 0.29) : 0;
      d.position.set(-0.2 + s.x * 0.03, -0.2 - (1 - this.armedLift) * 0.25 + bob * 0.8 + s.y * 0.02 - tip * 0.012, -0.36);
      d.rotation.set(0.25 + tip * 0.18 + s.y * 0.1, 0.2 + s.x * 0.15, 0.1 - tip * 0.06);
      const button = d.getObjectByName('button') as THREE.Mesh;
      button.position.y = 0.026 - tip * 0.009;
      button.material = pr < 0.6 ? BUTTON_DARK : BUTTON_LIT;
    }
  }
}
