// Brickfall: first-person demolition on a small voxel lot. Every voxel is a body in the AVBD GPU
// solver (physics.ts), fixed until a tool knocks it loose (destruction.ts); what loses its footing
// falls in pieces that shatter where they land. The game layer sits on top: three contracts, a
// sledgehammer, a hand cannon and sticky charges, a clock, a score with combos for chain
// reactions, propane tanks that go up, fire that eats timber, and a slow-motion replay camera for
// the big collapses.
//
// Built on three-voxel-destruction by Steven Bobyn (MIT): the solver use, destruction, structure,
// rendering, particles, debris readback, device tuning and sky are his; the loop below started as
// his main.ts.

import * as THREE from 'three/webgpu';
import { Sounds } from './audio.ts';
import { CAP_MIN, chooseProfile, type DeviceProfile, deviceKey, measureFrames, measurePhysics, type Quality, saveProfile, savedProfile } from './calibrate.ts';
import { Chips } from './chips.ts';
import { type BlastResult, blasts, type Hit, RADII, within } from './destruction.ts';
import { type ContractCard, Hud, type Mode, type Settings, type Tool } from './hud.ts';
import { type NavScreen, Pad, PadNav } from './pad.ts';
import { Impacts } from './impacts.ts';
import { JumpDetector } from './jumps.ts';
import { owners } from './owners.ts';
import { buildLevel, type HeistSpec, type Level, LEVELS, lotsFor, SPAWNS } from './levels.ts';
import { Loader } from './loader.ts';
import { type Block, blocks, type Contact, type Controls, Crane, Excavator, glowMat, type Machine, makeMachine, mesh, type Outcome, setRay, sweepBox, VEHICLES } from './machines.ts';
import { Particles } from './particles.ts';
import { bodyCapacity, CityPhysics, PARKED_BELOW } from './physics.ts';
import { type Input, Player } from './player.ts';
import { CityRenderer } from './render.ts';
import { Replays } from './replay.ts';
import { Sea } from './water.ts';
import { type Anchor, Cable, CABLE_MAX, Plank, PLANK_MAX, PLANK_T, PLANK_W } from './rigging.ts';
import { skyline } from './skyline.ts';
import { suburb } from './suburb.ts';
import { CitySky } from './sky.ts';
import { Structure } from './structure.ts';
import { ViewModel } from './viewmodel.ts';
import { type City, emptyCity, MAT_BOND, Mat, raycast, resetColumns, State, TIER, VOXEL, voxelAt } from './world.ts';

const params = new URLSearchParams(location.search);
/** ?seed=: the small variations in each lot (brick shades, which windows are lit). */
const SEED = Math.max(1, Number.parseInt(params.get('seed') ?? '7', 10) || 7);
/** ?test: automation (no pointer lock needed; the bot drives through window.__game). */
const TESTING = params.has('test') || params.has('patch-test');
/** ?patch-test=1: Patch's runner, which looks for "pass <name>" lines. */
const PATCH_TEST = params.has('patch-test');
/** ?hour=: the time of day, overriding the contract's (look development). */
if (params.has('nopush')) (globalThis as { __noPush?: boolean }).__noPush = true;
const HOUR = params.has('hour') ? Number(params.get('hour')) : null;

// ---------- tools ----------
interface ToolSpec extends Tool {
  reach: number;
  cooldown: number;
}
const ALL_TOOLS: ToolSpec[] = [
  {
    name: 'Sledge',
    key: '1',
    hint: 'Hold <b>Click</b> to wind up, release to swing',
    icon: `<svg viewBox="0 0 24 24"><path d="M4 20l9-9"/><path d="M11 5l3-2 7 7-2 3z"/><path d="M12 8l4 4"/></svg>`,
    reach: 3.6,
    cooldown: 0.12,
  },
  {
    name: 'Cannon',
    key: '2',
    hint: '<b>Click</b> to fire: the ball punches through wall after wall',
    icon: `<svg viewBox="0 0 24 24"><circle cx="17.5" cy="7" r="2.5"/><path d="M3 15l9-5 2 4-9 5z"/><circle cx="7" cy="18" r="3"/></svg>`,
    reach: 300,
    cooldown: 0.85,
  },
  {
    name: 'Charges',
    key: '3',
    hint: '<b>Click</b> to stick a charge · <b>Right click</b> or <b>Q</b> to blow them',
    icon: `<svg viewBox="0 0 24 24"><rect x="4" y="9" width="12" height="11" rx="1.5"/><path d="M8 9V6h4v3"/><path d="M12 6c0-2 2-3 4-3"/><path d="M18 2l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/></svg>`,
    reach: 6,
    cooldown: 0.25,
  },
  {
    name: 'Cutter',
    key: '4',
    hint: '<b>Click</b> to lay a cutter across a column or girder: it slices a line through anything, even steel · <b>Q</b> fires it with the charges',
    icon: `<svg viewBox="0 0 24 24"><path d="M3 14h18"/><rect x="3" y="11" width="18" height="6" rx="1.5"/><path d="M7 11V8M12 11V7M17 11V8"/></svg>`,
    reach: 6,
    cooldown: 0.25,
  },
  {
    name: 'Jackhammer',
    key: '5',
    hint: '<b>Hold click</b> on a wall: chips through brick and concrete, a bite at a time',
    icon: `<svg viewBox="0 0 24 24"><path d="M6 4h12"/><path d="M12 4v4"/><rect x="8" y="8" width="8" height="7" rx="1.5"/><path d="M12 15v6"/><path d="M10 21h4"/></svg>`,
    reach: 2.6,
    cooldown: 0.1,
  },
  {
    name: 'Rocket',
    key: '6',
    hint: '<b>Click</b> to fire a rocket: it blows up on the first thing it hits',
    icon: `<svg viewBox="0 0 24 24"><path d="M3 15l12-6 3 4-12 6z"/><path d="M15 9l4-2-1 6"/><path d="M5 18l-2 3M8 17l-1 4"/></svg>`,
    reach: 300,
    cooldown: 1.6,
  },
  {
    name: 'Pipe bomb',
    key: '7',
    hint: '<b>Click</b> to throw a pipe bomb: it bounces, the fuse burns three seconds, then it goes',
    icon: `<svg viewBox="0 0 24 24"><rect x="5" y="9" width="12" height="7" rx="1"/><path d="M5 9v7M17 9v7"/><path d="M17 12h2c1 0 1-2 2-3"/><path d="M21 7l1-1"/></svg>`,
    reach: 300,
    cooldown: 0.6,
  },
  {
    name: 'Plank',
    key: '8',
    hint: '<b>Click</b> where one end goes, <b>click</b> again for the other: a board up to 5 m to bridge a gap or make a ramp',
    icon: `<svg viewBox="0 0 24 24"><path d="M3 16l16-9 2 3-16 9z"/><path d="M7 14l2 3M11 12l2 3M15 10l2 3"/></svg>`,
    reach: 7,
    cooldown: 0.2,
  },
  {
    name: 'Cable',
    key: '9',
    hint: '<b>Click</b> a wall or a machine, <b>click</b> the other end: up to 12 m of steel cable. Drive away and it pulls',
    icon: `<svg viewBox="0 0 24 24"><circle cx="7" cy="8" r="4"/><path d="M11 8c4 0 4 9 8 9"/><path d="M19 14v6M17 20h4"/></svg>`,
    reach: 9,
    cooldown: 0.2,
  },
];
/** The tools on offer: the cable only with the vehicles (it's what they pull with). */
const TOOLS = VEHICLES ? ALL_TOOLS : ALL_TOOLS.filter((t) => t.name !== 'Cable');
const SLEDGE = 0;
const CANNON = 1;
const CHARGE = 2;
const CUTTER = 3;
const JACK = 4;
const ROCKET = 5;
const PIPE = 6;
const PLANK = 7;
const CABLE = 8;
/** The delays a charge or cutter can be set to (s, after the button): a blowdown's sequence. R cycles them. */
const DELAYS = [0, 0.25, 0.5, 1, 2];
/** The mode being played. */
let mode: Mode = 'rush';
/** When a blowdown was set off (world clock, s; -1 not yet), and the delay the next device gets. */
let blownAt = -1;
let fuseDelay = 0;

// ---------- settings and progress ----------
const settings: Settings = { sensitivity: 1, fov: 82, invertY: false, quality: 'high', graphics: 'auto', volume: 0.8, music: 0.6, shake: true, hour: 17.4, smoothing: false, dof: true, sunRays: true, padSens: 1, padDead: 0.15 };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('brickfall.settings') ?? '{}'));
} catch {
  // no saved settings
}
const progress: { best: number[]; stars: number[]; blowBest: number[]; blowStars: number[]; heistBest: number[]; heistStars: number[] } = { best: [], stars: [], blowBest: [], blowStars: [], heistBest: [], heistStars: [] };
try {
  Object.assign(progress, JSON.parse(localStorage.getItem('brickfall.progress') ?? '{}'));
} catch {
  // no progress yet
}
function save(): void {
  try {
    localStorage.setItem('brickfall.settings', JSON.stringify(settings));
    localStorage.setItem('brickfall.progress', JSON.stringify(progress));
  } catch {
    // storage unavailable
  }
}

const canvas = document.querySelector('#view') as HTMLCanvasElement;
let profile: DeviceProfile | null = null;
const sounds = new Sounds();
/**
 * In tests, every sound event the game starts (not the layers inside it), with the time and where the listener
 * was: renderAudio('collapse') plays a real collapse's events back offline and counts its onsets.
 */
const soundLog: [number, [number, number, number], string, unknown[]][] = [];
let soundMark = 0;
if (params.has('test')) {
  const s = sounds as unknown as Record<string, (...a: unknown[]) => unknown>;
  let depth = 0;
  for (const name of ['impact', 'sledgeHit', 'charge', 'propane', 'debrisTail', 'debrisHit', 'collapseSet', 'glass', 'collapse', 'hammer', 'bounce', 'creak', 'cannonFire']) {
    const f = s[name].bind(sounds);
    s[name] = (...a: unknown[]) => {
      if (depth === 0 && soundLog.length < 6000) soundLog.push([performance.now() / 1000, [...sounds.ear], name, a]);
      depth++;
      try {
        return f(...a);
      } finally {
        depth--;
      }
    };
  }
}
sounds.preload();
const view = new CityRenderer(canvas);
const hand = new ViewModel();
/** The best moments, recorded as they happen (the replay camera's rolls). */
const replays = new Replays(canvas);
view.camera.add(hand.object);
view.scene.add(view.camera);
const hud = new Hud(TOOLS, settings);

// ---------- game state ----------
/** 'free': after the results, the lot is still yours to wreck (no clock, no score to save) until Next or Retry. */
type Phase = 'loading' | 'title' | 'intro' | 'play' | 'grace' | 'end' | 'free';
let phase: Phase = 'loading';
let paused = false;
let levelId = 0;
let level: Level;
const game = {
  score: 0,
  combo: 1,
  comboAt: -10,
  bestCombo: 1,
  timeLeft: 90,
  grace: 0,
  charges: 0,
  cutters: 0,
  rockets: 0,
  pipes: 0,
  planks: 0,
  cables: 0,
  biggest: 0,
  demolition: 0,
  keepShare: 1,
  zoneHit: false,
  barrelsBlown: 0,
  voxelsBroken: 0,
  introT: 0,
  endT: 0,
  demolishedCalled: false,
  timeLeftAtDemolish: 0,
  hint: 0,
};
/** Voxels of the job's objects, and of the ones to keep (counted once per level). */
let targetTotal = 1;
let keepTotal = 1;
let targetSet = new Set<number>();
let targetVoxels: number[] = [];
/** Where each loose voxel was at the last readback (xyz), and where every voxel was built (for tests). */
let livePos = new Float32Array(0);
let homePos = new Float32Array(0);
let keepVoxels: number[] = [];
let keepSet = new Set<number>();
let barrelSet = new Set<number>();
/** Gas lines (objects): break one and it goes up along its length. */
let gasSet = new Set<number>();
const barrelLit = new Set<number>();

function applySettings(): void {
  save();
  view.camera.fov = settings.fov;
  view.camera.updateProjectionMatrix();
  sounds.setVolume(settings.volume);
  sounds.musicLevel = 0.5 * settings.music;
  sounds.setVolume(settings.volume);
  view.sunRays.value = settings.sunRays ? 1 : 0;
  const auto = settings.graphics === 'auto';
  if (!auto) settings.quality = settings.graphics as Quality;
  else if (profile) settings.quality = profile.quality;
  const base = auto && profile ? profile.resolution : 1;
  if (view.quality !== settings.quality || view.baseResolution !== base) {
    view.baseResolution = base;
    view.setQuality(settings.quality);
  }
  sky?.setQuality(settings.quality);
  smoke?.setQuality(settings.quality);
  smokeLevel = settings.quality;
  // The volume AO: on unless the device runs at low quality (or a measurement turns it off)
  view.volumeAO.value = settings.quality === 'low' || params.has('noao') ? 0 : 1;
}
hud.onSettings = applySettings;

// ---------- input ----------
const keys = new Set<string>();
let held = false;
let wantFire = false;
let tool = CANNON;
/** Captured: the mouse is locked to the view. Free: the browser refused the lock (Patch's test runner denies it), so the free cursor turns the view. */
let captured = false;
let freeLook = false;
const look = { x: 0, y: 0 };
const GAME_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight', 'Slash']);
const active = () => (phase === 'play' || phase === 'grace' || phase === 'free') && !paused && !cam.active;

function lockPointer(): void {
  sounds.resume();
  if (TESTING) {
    freeLook = true;
    return;
  }
  // On the pad there's no pointer to lock: play on without it (the next click takes it, as before)
  if (pad.used) {
    freeLook = true;
    padLook = true;
    return;
  }
  try {
    const lock = canvas.requestPointerLock() as Promise<void> | undefined;
    lock?.catch(() => {
      freeLook = true;
    });
  } catch {
    freeLook = true;
  }
}
document.addEventListener('pointerlockchange', () => {
  captured = document.pointerLockElement === canvas;
  if (captured) freeLook = padLook = false;
  canvas.style.cursor = captured ? 'none' : '';
  if (!captured && (phase === 'play' || phase === 'grace' || phase === 'intro' || phase === 'free') && !freeLook) setPaused(true);
  held = false;
  keys.clear();
});
document.addEventListener('pointerlockerror', () => {
  freeLook = true;
});
function setPaused(on: boolean): void {
  if (phase === 'title' || phase === 'end' || phase === 'loading') on = false;
  if (on === paused) return;
  paused = on;
  hud.showPause(on);
  if (!on && !captured && !TESTING) lockPointer();
  sounds.music(!on && phase !== 'title');
}
hud.onResume = () => setPaused(false);
hud.onRestart = () => {
  paused = false;
  hud.showPause(false);
  hud.showEnd(null);
  lockPointer();
  void startLevel(levelId);
};
hud.onQuit = () => {
  paused = false;
  hud.showPause(false);
  hud.showEnd(null);
  if (document.pointerLockElement) document.exitPointerLock();
  void showTitle();
};
hud.onKeep = () => {
  // Free play: the card goes, the clock stops, every voxel left is still there to break
  hud.showEnd(null);
  phase = 'free';
  cam.active = false;
  hud.cine(false);
  hud.show(true);
  hud.hint('Free play: keep wrecking · <b>Esc</b> for Retry, Contracts');
  spawn();
  lockPointer();
};
hud.onNext = () => {
  hud.showEnd(null);
  lockPointer();
  const lots = lotsFor(mode === 'heist');
  void startLevel(lots[Math.min(lots.length - 1, lots.indexOf(levelId) + 1)] ?? lots[0]);
};
hud.onStart = (id) => {
  lockPointer();
  void startLevel(id);
};
// The title: a click anywhere off the cards starts the first contract not yet three-starred
hud.title.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.card') || phase !== 'title') return;
  lockPointer();
  void startLevel(nextContract());
});
const nextContract = () => {
  const stars = mode === 'blowdown' ? progress.blowStars : mode === 'heist' ? progress.heistStars : progress.stars;
  const lots = lotsFor(mode === 'heist');
  const open = lots.filter((id) => !lotLocked(id));
  return open.find((id) => (stars[id] ?? 0) < 3) ?? open[0] ?? lots[0];
};
hud.onMode = (m) => {
  mode = m;
  hud.showTitle(cards(), nextContract(), null);
  hud.setLoading(null);
};

addEventListener('keydown', (e) => {
  if (phase === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
    lockPointer();
    void startLevel(nextContract());
    return;
  }
  if ((e.code === 'Escape' || e.code === 'KeyP') && (phase === 'play' || phase === 'grace' || phase === 'intro' || phase === 'free')) {
    // (Esc also releases the mouse by itself; the lock change pauses too, and this keeps them in step)
    if (!paused && document.pointerLockElement) document.exitPointerLock();
    setPaused(!paused);
    return;
  }
  if (!active() && phase !== 'intro') return;
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  // The sandbox's spawn bar: B opens it, a number puts that prop where the crosshair is
  if (mode === 'sandbox' && e.code === 'KeyB') {
    toggleSpawn();
    return;
  }
  if (spawnOpen && /^Digit[1-6]$/.test(e.code)) {
    spawnProp(SPAWNS[Number(e.code.slice(5)) - 1].kind);
    spawnOpen = false;
    hud.spawnBar(null);
    return;
  }
  if (mode === 'sandbox' && e.code === 'KeyT') nextHour();
  if (e.code === 'KeyF' && (heistUse() || useMachine())) return;
  if (e.code === 'F5' || e.code === 'F9') {
    e.preventDefault();
    if (e.code === 'F5') quicksave();
    else void quickload();
    return;
  }
  if (riding) return;
  if (e.code === 'Digit1') selectTool(SLEDGE);
  if (e.code === 'Digit2') selectTool(CANNON);
  if (e.code === 'Digit3') selectTool(CHARGE);
  if (e.code === 'Digit4') selectTool(CUTTER);
  if (e.code === 'Digit5') selectTool(JACK);
  if (e.code === 'Digit6') selectTool(ROCKET);
  if (e.code === 'Digit7') selectTool(PIPE);
  if (e.code === 'Digit8') selectTool(PLANK);
  if (e.code === 'Digit9' && VEHICLES) selectTool(CABLE);
  if (e.code === 'KeyR') nextDelay();
  if (e.code === 'KeyQ' || e.code === 'KeyE') detonateAll();
  if (e.code === 'KeyL') toggleLoad();
});
function toggleSpawn(): void {
  spawnOpen = !spawnOpen;
  hud.spawnBar(spawnOpen ? SPAWNS.map((s) => s.name) : null);
}
function nextHour(): void {
  dayHour = HOURS[(HOURS.indexOf(dayHour) + 1) % HOURS.length];
  setDayHour(dayHour);
  hud.toast(`Time of day: ${Math.floor(dayHour)}:${String(Math.round((dayHour % 1) * 60)).padStart(2, '0')}`);
}
function nextDelay(): void {
  fuseDelay = DELAYS[(DELAYS.indexOf(fuseDelay) + 1) % DELAYS.length];
  hud.toast(`Next charge fires ${fuseDelay ? `${fuseDelay} s after` : 'on'} the button`);
  sounds.click();
}
function toggleLoad(): void {
  overlayOn = !overlayOn;
  overlayAt = 0;
  view.overlay.value = overlayOn ? 1 : 0;
  hud.toast(overlayOn ? 'Load view on: storeys glow as they take load (L to hide)' : 'Load view off');
}
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => {
  keys.clear();
  held = false;
});
addEventListener('mousemove', (e) => {
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
  if (!captured && !freeLook) return;
  if (!active() && phase !== 'intro') return;
  look.x += e.movementX;
  look.y += e.movementY;
  hand.look(e.movementX, e.movementY);
});
addEventListener('mousedown', (e) => {
  if ((e.target as HTMLElement).closest?.('.screen, button')) return;
  if (cam.active && cam.kind === 'kill') {
    cam.skip = true;
    return;
  }
  if (phase === 'intro') {
    game.introT = 99;
    return;
  }
  if (!active()) return;
  if (!captured && (!freeLook || padLook)) {
    padLook = false;
    lockPointer();
    return;
  }
  if (e.button === 0) {
    held = true;
    wantFire = true;
  }
  if (e.button === 2 && !riding) detonateAll();
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) held = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener(
  'wheel',
  (e) => {
    if (!active() || riding) return;
    cycleTool(e.deltaY > 0 ? 1 : -1);
  },
  { passive: true },
);
/** The next tool along (1) or back (-1), past the locked ones. */
function cycleTool(by: 1 | -1): void {
  let next = tool;
  for (let k = 0; k < TOOLS.length; k++) {
    next = (next + (by > 0 ? 1 : TOOLS.length - 1)) % TOOLS.length;
    if (!toolLocked(next)) break;
  }
  selectTool(next);
}

// The controller (pad.ts), read at the top of each frame. On foot the left stick moves and the right one looks, RT
// uses the tool (held for the sledge and the jackhammer), LT or Y blows the charges, LB and RB change tools (held, the
// tool wheel: the right stick picks, letting go takes it), X takes loot and gets into or out of a machine, A jumps,
// B crouches, a left-stick click sprints until you stop, the D-pad's down changes the charge delay and up the load
// view, Start pauses. In a machine: the left stick drives and turns (the crane: raises and swings the boom), A and B
// lift and lower, RT works the arm, X climbs out. In the sandbox the View button opens the spawn bar (D-pad to pick,
// A to spawn, B to close) and a right-stick click changes the time of day. A, B or Start skips the intro and the
// replay. On the title, pause and results the pad moves a highlight over them (PadNav).
const pad = new Pad({ deadzone: () => settings.padDead });
const padNav = new PadNav(pad);
const padIn = { forward: 0, right: 0, jump: false, crouch: false, lift: 0 };
let padHeld = false;
let padSprint = false;
/** Playing without the pointer since the pad started or resumed: a click takes it. */
let padLook = false;
/** How long the look stick has been at its edge (it turns faster after a moment). */
let padEdge = 0;
/** A bumper held: since when, which way it steps, and the wheel's lit tool once it opens (-1: shut). */
let bumper = { at: -1, by: 0 as -1 | 0 | 1, lit: -1 };
/** The spawn bar's lit prop, on the pad. */
let spawnAt = 0;
const PAD_HELP = () =>
  `<b>L stick</b> move · <b>R stick</b> look · {RT} use tool · {LB} {RB} switch, hold for the wheel · {A} jump · {B} crouch · {LS} sprint · {LT} / {Y} detonate · {Down} charge delay · {X} take loot, drive · {Up} load view · {Start} pause`;
/** The keyboard's words in prompts and hints, and what the pad says instead. */
const PAD_WORDS: [RegExp, string][] = [
  [/<b>A<\/b>\/<b>D<\/b>/g, '<b>L stick</b> ←/→'],
  [/<b>W<\/b>\/<b>S<\/b>/g, '<b>L stick</b> ↑/↓'],
  [/<b>Space<\/b>\/<b>C<\/b>/g, '{A}/{B}'],
  [/<b>[Hh]old click<\/b>/g, 'hold {RT}'],
  [/Hold <b>Click<\/b>/g, 'Hold {RT}'],
  [/<b>[Cc]lick<\/b>/g, '{RT}'],
  [/<b>Right click<\/b> or <b>Q<\/b>/g, '{LT} or {Y}'],
  [/<b>Q<\/b>/g, '{Y}'],
  [/<b>F<\/b>/g, '{X}'],
  [/<b>Esc<\/b>/g, '{Start}'],
  [/<b>L<\/b>/g, '{Up}'],
  [/<em>B to close<\/em>/g, '<em>{B} to close</em>'],
  [/CLICK TO CLOSE/g, '{B} TO CLOSE'],
  // (plain text: toasts, the modes' lines)
  [/\(L to hide\)/g, '({Up} to hide)'],
  [/\bB spawns/g, '{Back} spawns'],
  [/\bT sets/g, '{RS} sets'],
];
const keyHelp = hud.help;
hud.help = () => (pad.used ? pad.text(PAD_HELP()) : keyHelp());
hud.words = (html, plain) => {
  if (!pad.used) return html;
  for (const [re, to] of PAD_WORDS) html = html.replace(re, to);
  return pad.text(html, plain);
};
pad.onDevice = () => {
  hud.ends = pad.used ? [pad.cap('LB'), pad.cap('RB')] : null;
  hud.refreshWords();
};
// Unplugged (or flat) in a job: pause, as losing the pointer does; plugged back in, it carries on
pad.onLost = () => {
  if (paused || !(phase === 'play' || phase === 'grace' || phase === 'intro' || phase === 'free')) return;
  if (document.pointerLockElement) document.exitPointerLock();
  setPaused(true);
};
function padStep(now: number): void {
  pad.poll();
  padIn.forward = padIn.right = padIn.lift = 0;
  padIn.jump = padIn.crouch = padHeld = false;
  const wheelWas = bumper.lit;
  const reset = () => {
    padSprint = false;
    bumper = { at: -1, by: 0, lit: -1 };
    if (wheelWas >= 0) hud.wheel(null, toolLocked);
  };
  // The best moment's replay over the results: A, B or Start closes it
  const replay = document.querySelector('.replayview');
  if (replay) {
    padNav.drive(null, now);
    if (pad.pressed('A') || pad.pressed('B') || pad.pressed('Start')) {
      replay.remove();
      pad.swallow();
    }
    return reset();
  }
  const screen: NavScreen | null = paused
    ? { root: hud.pause, back: () => setPaused(false), start: () => setPaused(false) }
    : !hud.endScreen.hidden
      ? { root: hud.endScreen, first: () => hud.endScreen.querySelector('.primary, .retry') }
      : hud.titleOpen
        ? {
            root: hud.title,
            first: () => hud.title.querySelector('.card.sel'),
            start: () => {
              lockPointer();
              void startLevel(nextContract());
            },
          }
        : null;
  if (padNav.drive(screen, now)) return reset();
  const inJob = phase === 'play' || phase === 'grace' || phase === 'intro' || phase === 'free';
  if (inJob && pad.pressed('Start')) {
    if (document.pointerLockElement) document.exitPointerLock();
    setPaused(true);
    return reset();
  }
  // The replay camera and the intro: skipped
  if (cam.active && cam.kind === 'kill') {
    if (pad.pressed('A') || pad.pressed('B')) cam.skip = true;
    return reset();
  }
  if (phase === 'intro') {
    if (pad.pressed('A') || pad.pressed('B')) {
      game.introT = 99;
      pad.swallow();
    }
    return reset();
  }
  if (!active()) return reset();
  padIn.forward = pad.move.y;
  padIn.right = pad.move.x;
  padHeld = pad.held('RT');
  if (pad.pressed('RT')) wantFire = true;
  if (pad.pressed('X') && (heistUse() || useMachine())) return reset();
  if (riding) {
    padIn.lift = (pad.held('A') ? 1 : 0) - (pad.held('B') ? 1 : 0);
    return reset();
  }
  // The sandbox's spawn bar, open: the D-pad picks, A spawns, B (or View) closes
  if (spawnOpen) {
    const n = SPAWNS.length;
    if (pad.pressed('Left') || pad.pressed('Right')) {
      spawnAt = (spawnAt + (pad.pressed('Right') ? 1 : n - 1)) % n;
      hud.spawnBar(SPAWNS.map((s) => s.name), spawnAt);
    }
    if (pad.pressed('A')) {
      spawnProp(SPAWNS[spawnAt].kind);
      toggleSpawn();
    } else if (pad.pressed('B') || pad.pressed('Back')) toggleSpawn();
    return reset();
  }
  if (mode === 'sandbox' && pad.pressed('Back')) {
    toggleSpawn();
    if (spawnOpen) hud.spawnBar(SPAWNS.map((s) => s.name), spawnAt);
  }
  if (mode === 'sandbox' && pad.pressed('RS')) nextHour();
  padIn.jump = pad.held('A');
  padIn.crouch = pad.held('B');
  if (pad.pressed('LS')) padSprint = !padSprint;
  if (Math.hypot(pad.move.x, pad.move.y) < 0.3 || padIn.crouch) padSprint = false;
  if (pad.pressed('LT') || pad.pressed('Y')) detonateAll();
  if (pad.pressed('Down')) nextDelay();
  if (pad.pressed('Up')) toggleLoad();
  if (pad.pressed('Left')) cycleTool(-1);
  if (pad.pressed('Right')) cycleTool(1);
  // The bumpers: a tap steps through the tools; held a moment, the wheel opens and the right stick picks
  if (pad.pressed('LB') || pad.pressed('RB')) bumper = { at: now, by: pad.pressed('LB') ? -1 : 1, lit: -1 };
  if (bumper.at >= 0) {
    const down = bumper.by < 0 ? pad.held('LB') : pad.held('RB');
    if (down && bumper.lit < 0 && now - bumper.at > 250) bumper.lit = tool;
    if (bumper.lit >= 0) {
      const raw = Math.hypot(pad.look.x, pad.look.y) > 0.5 ? pad.look : Math.hypot(pad.move.x, -pad.move.y) > 0.5 ? { x: pad.move.x, y: -pad.move.y } : null;
      if (raw) {
        const n = TOOLS.length;
        const a = Math.atan2(raw.x, -raw.y);
        bumper.lit = (Math.round((a / (2 * Math.PI)) * n) + n) % n;
      }
      hud.wheel(bumper.lit, toolLocked);
      padIn.forward = padIn.right = 0;
    }
    if (!down) {
      if (bumper.lit >= 0) {
        hud.wheel(null, toolLocked);
        selectTool(bumper.lit);
      } else cycleTool(bumper.by as 1 | -1);
      bumper = { at: -1, by: 0, lit: -1 };
    }
  }
}
/** A lot's number as its mode's menu counts them (the heist lot is in Salvage's own list). */
const lotNumber = (id: number) => lotsFor(mode === 'heist').indexOf(id) + 1;
/** Whether there's a next lot in the menu, open to play. */
const hasNextLot = (id: number) => {
  const lots = lotsFor(mode === 'heist');
  const next = lots[lots.indexOf(id) + 1];
  return next !== undefined && !lotLocked(next);
};

// ---------- progression: stars open tools and lots ----------
/** Stars each tool needs (the rest are open from the start). */
const TOOL_STARS: Record<number, number> = { [JACK]: 3, [CUTTER]: 6, [PIPE]: 9, [ROCKET]: 12 };
if (VEHICLES) TOOL_STARS[CABLE] = 15;
/** Stars each lot needs. */
const LOT_STARS: Record<number, number> = { 2: 4, 4: 7, 5: 10, 6: 13, 7: 9, 8: 16, 9: 19, 10: 22 };
/** Every star earned, in every mode (each lot's best in each). */
function starTotal(): number {
  const sum = (a: number[]) => a.reduce((n, s) => n + (s ?? 0), 0);
  return sum(progress.stars) + sum(progress.blowStars) + sum(progress.heistStars);
}
/** Whether locks apply: not in the sandbox, and not in tests (unless a test asks for them). */
const locksOn = () => mode !== 'sandbox' && (!TESTING || params.has('locks'));
const toolLocked = (i: number) => locksOn() && (TOOL_STARS[i] ?? 0) > starTotal();
const lotLocked = (id: number) => locksOn() && (LOT_STARS[id] ?? 0) > starTotal();
function showLocks(): void {
  for (let i = 0; i < TOOLS.length; i++) hud.lockSlot(i, toolLocked(i) ? TOOL_STARS[i] : null);
}
/** What a result just opened (names), comparing the stars before and after. */
function newlyOpened(before: number): string[] {
  const after = starTotal();
  const out: string[] = [];
  for (const [i, s] of Object.entries(TOOL_STARS)) if (s > before && s <= after) out.push(TOOLS[Number(i)].name);
  for (const [id, s] of Object.entries(LOT_STARS)) if (s > before && s <= after) out.push(LEVELS[Number(id)].name);
  return out;
}

/** On the results: what the stars just opened (and a chime for it). */
function unlockedRows(rows: [string, string][], had: number): void {
  if (!locksOn()) return;
  const opened = newlyOpened(had);
  if (!opened.length) return;
  rows.push(['Unlocked', opened.join(', ')]);
  sounds.pickup();
}

function selectTool(i: number): void {
  if (i === tool) return;
  if (toolLocked(i)) {
    hud.toast(`${TOOLS[i].name}: unlocks at ${TOOL_STARS[i]} stars (you have ${starTotal()})`);
    sounds.click();
    return;
  }
  // (A blowdown is wired, not shot: charges and cutters only)
  if (mode === 'blowdown' && phase !== 'free' && i !== CHARGE && i !== CUTTER) {
    hud.toast('Blowdown: charges and cutters only');
    return;
  }
  tool = i;
  hud.select(i);
  hand.select(i);
  sledgeCharge = 0;
  sounds.click();
}

function input(): Input {
  const k = (...codes: string[]) => (codes.some((c) => keys.has(c)) ? 1 : 0);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    forward: clamp(k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + padIn.forward),
    right: clamp(k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + padIn.right),
    jump: keys.has('Space') || padIn.jump,
    sprint: k('ShiftLeft', 'ShiftRight') === 1 || padSprint,
    crouch: k('KeyC', 'ControlLeft') === 1 || padIn.crouch,
    rise: 0,
    slow: false,
  };
}
function turn(dt: number): void {
  const k = 0.0017 * settings.sensitivity;
  player.yaw -= look.x * k;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - look.y * k * (settings.invertY ? -1 : 1)));
  look.x = look.y = 0;
  // The right stick (not while it picks on the tool wheel): about 3 rad/s at the edge, up to half as fast again after
  // a moment held there
  const m = bumper.lit >= 0 ? 0 : Math.hypot(pad.look.x, pad.look.y);
  padEdge = m > 0.9 ? padEdge + dt : 0;
  if (m > 0) {
    const rate = 3 * settings.padSens * (1 + 0.5 * Math.min(1, Math.max(0, (padEdge - 0.25) / 0.4))) * dt;
    player.yaw -= pad.look.x * rate;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - pad.look.y * rate * 0.75 * (settings.invertY ? -1 : 1)));
    hand.look((pad.look.x * rate) / 0.0017, (pad.look.y * rate * 0.75) / 0.0017);
  }
}

// ---------- the world ----------
let city: City = emptyCity();
let structure = new Structure(city);
const player = new Player(city);
player.flying = false;
let physics: CityPhysics;
let skylineMesh: THREE.Object3D | null = null;
// ---------- the machines (machines.ts): parked on the lot, F to climb in ----------
let machines: Machine[] = [];
let riding: Machine | null = null;
let machineWake = 0;
/** The view from behind the machine you're in (tests and the media turn it off to film from where you stand). */
let machineCam = true;
/** Tests drive the machine in the seat with these (and aim the arm at `aim`), instead of the keys. */
let testDrive: { forward?: number; turn?: number; lift?: number; action?: boolean; aim?: [number, number, number] } | null = null;
/** What the machines broke (voxels) and how hard they hit (the hardest, m/s), for the tests. */
const machineStats = { broke: 0, hits: 0, hardest: 0, clanks: 0 };
setRay((c, o, d, far) => {
  const h = raycast(c, o.toArray(), d.toArray(), far);
  return h ? h.t : null;
});
/** A point inside a machine (its frame, the bucket, the ball): what rests on it is held (physics.ts hovering). */
function machineSolid(x: number, y: number, z: number): boolean {
  for (const p of planks) if (p.contains(new THREE.Vector3(x, y, z), 0.15)) return true;
  for (const m of machines) {
    if (m instanceof Crane) {
      // (The ball's body in the solver is a 1.5 m box, there while it's worked or swinging)
      if (m.solid && Math.abs(x - m.ball.x) < 1.05 && Math.abs(y - m.ball.y) < 1.05 && Math.abs(z - m.ball.z) < 1.05) return true;
      const [dx, dy] = [x - m.x, y - m.y];
      if (z < 3.6 && Math.abs(dx * Math.cos(m.heading) + dy * Math.sin(m.heading)) < 3.4 && Math.abs(-dx * Math.sin(m.heading) + dy * Math.cos(m.heading)) < 2.6) return true;
    } else {
      if (Math.hypot(x - m.bucketAt.x, y - m.bucketAt.y, z - m.bucketAt.z) < 1.25) return true;
      const [dx, dy] = [x - m.position.x, y - m.position.y];
      if (z < 3.0 && Math.abs(dx * Math.cos(m.heading) + dy * Math.sin(m.heading)) < 2.5 && Math.abs(-dx * Math.sin(m.heading) + dy * Math.cos(m.heading)) < 1.7) return true;
    }
  }
  return false;
}
/** Whether the player's box at feet (x, y, z) meets a plank (points on its top face inside the box). */
function plankIn(x: number, y: number, z: number, height: number): boolean {
  for (const p of planks) {
    const m = p.middle;
    if (Math.abs(m.x - x) > p.length / 2 + 0.8 || Math.abs(m.y - y) > p.length / 2 + 0.8) continue;
    for (const q of p.topPoints()) if (Math.abs(q.x - x) < 0.3 && Math.abs(q.y - y) < 0.3 && q.z > z && q.z - PLANK_T < z + height) return true;
  }
  return false;
}
player.solid = (x, y, z, height) => {
  if (plankIn(x, y, z, height)) return true;
  for (const m of machines) {
    const [cx, cy, h, hl, hw, top] = m instanceof Crane ? [m.x, m.y, m.heading, 3.3, 2.5, 3.4] : [m.position.x, m.position.y, m.heading, 2.4, 1.6, 2.7];
    if (z > top || z + height < 0) continue;
    const [dx, dy] = [x - cx, y - cy];
    const along = dx * Math.cos(h) + dy * Math.sin(h);
    const across = -dx * Math.sin(h) + dy * Math.cos(h);
    if (Math.abs(along) < hl + 0.3 && Math.abs(across) < hw + 0.3) return true;
  }
  return false;
};
const chips = new Chips(city);
view.scene.add(chips.object);
const shards = Chips.glass(city);
view.scene.add(shards.object);
const impacts = new Impacts();
view.scene.add(impacts.object);
const dustRing = new THREE.Color(1.1, 1.0, 0.9);
const hotRing = new THREE.Color(2.2, 1.4, 0.8);
const dustTint: Record<number, THREE.Color> = {
  [Mat.Brick]: new THREE.Color(0.7, 0.56, 0.47),
  [Mat.Glass]: new THREE.Color(0.7, 0.72, 0.72),
  [Mat.LitGlass]: new THREE.Color(0.7, 0.72, 0.72),
  [Mat.Wood]: new THREE.Color(0.55, 0.45, 0.33),
  [Mat.Plaster]: new THREE.Color(0.78, 0.74, 0.66),
  [Mat.Dirt]: new THREE.Color(0.48, 0.38, 0.28),
  [Mat.Plastic]: new THREE.Color(0.6, 0.6, 0.6),
};
const concreteDust = new THREE.Color(0.66, 0.63, 0.58);
const smokeTint = new THREE.Color(0.5, 0.5, 0.5);
const tintOf = (v: number | undefined) => (v === undefined ? concreteDust : (dustTint[city.material[v]] ?? concreteDust));

interface Effects {
  explosion(at: ArrayLike<number>, radius: number): void;
  dust(points: ArrayLike<number>, amount: number, tint: THREE.Color): void;
  impact(at: ArrayLike<number>, speed: number, tint: THREE.Color): void;
  sparks(at: ArrayLike<number>, count: number, speed: number): void;
  spray(at: ArrayLike<number>, count: number, speed: number, tint: THREE.Color): void;
  smoulder(at: ArrayLike<number>, seconds: number, heavy?: number): void;
  update(dt: number, camera: THREE.Camera): void;
}
let effects: Effects = { explosion() {}, dust() {}, impact() {}, sparks() {}, spray() {}, smoulder() {}, update() {} };
let smoke: Particles | null = null;
let smokeLevel: Settings['quality'] = 'high';

function startEffects(): Effects {
  const particles = new Particles(view.renderer, undefined, view.sceneDepth);
  view.smokeScene.add(particles.object);
  // (The blasts light the scene through the renderer's pool of four lights now: view.flashLight)
  smoke = particles;
  // A breeze away from where the player starts, so the dust clears off the job
  const wind = new THREE.Vector3(1.8, 2.6, 0);
  const sun = new THREE.Color();
  return {
    explosion: (at, radius) => {
      particles.explosion(at, radius);
      if (radius >= 3.5) particles.smoulder([at[0], at[1], Math.max(0.5, at[2] - 1)], 12);
    },
    dust: (points, amount, tint) => particles.dust(points, amount, tint),
    impact: (at, speed, tint) => particles.impact(at, speed, tint),
    sparks: (at, count, speed) => particles.sparks(at, count, speed),
    spray: (at, count, speed, tint) => particles.spray(at, count, speed, tint),
    smoulder: (at, seconds, heavy) => particles.smoulder(at, seconds, heavy),
    update: (dt, camera) => {
      if (sky) {
        sun.copy(sky.sunColor).multiplyScalar(0.45 * sky.sunIntensity());
        particles.sunColour.value.copy(sun);
        particles.skyAmbient.value.copy(sky.horizon).multiplyScalar(0.75);
      }
      particles.update(dt, camera, view.sunDirection, wind);
    },
  };
}

// ---------- sky ----------
let sky: CitySky;
const SKIES: { hour: number; name: string; exposure: number }[] = [
  { hour: 17, name: 'late_afternoon', exposure: 1 },
  { hour: 18.8, name: 'sunset', exposure: 1.05 },
];
interface SkyInfo {
  file: string;
  sun: number[];
  sunColour: number[];
  sunIrradiance: number;
  skyColour: number[];
}
let skyIndex: Record<string, SkyInfo> | null = null;
const LIGHT_SCALE = 0.2;
let sunStrength = 3;
let sunHour = -1;
function setSun(hour: number): void {
  if (!sky || Math.abs(hour - sunHour) < 1e-3) return;
  sunHour = hour;
  const day = (hour - 6.3) / 12.8;
  const azimuth = level?.sunAz ?? Math.PI * (0.15 - day * 1.1);
  const preset = SKIES.reduce((best, s) => (Math.abs(s.hour - hour) < Math.abs(best.hour - hour) ? s : best));
  const info = skyIndex?.[preset.name];
  if (info) {
    const [x, y] = info.sun;
    const turn = azimuth - Math.atan2(y, x);
    const elevation = level?.sunEl !== undefined ? (level.sunEl * Math.PI) / 180 : Math.asin(Math.max(-1, Math.min(1, info.sun[2])));
    const flat = Math.cos(elevation) / Math.max(1e-6, Math.hypot(x, y));
    view.sunDirection.set((x * Math.cos(turn) - y * Math.sin(turn)) * flat, (x * Math.sin(turn) + y * Math.cos(turn)) * flat, Math.sin(elevation)).normalize();
    sunStrength = info.sunIrradiance * LIGHT_SCALE;
    sky.sun.copy(view.sunDirection);
    sky.update(view.camera, performance.now() / 1000);
    view.renderer.toneMappingExposure = preset.exposure;
    view
      .loadSky(info.file)
      .then((t) => {
        if (sunHour === hour) view.setSkyLight(t, turn, LIGHT_SCALE * 1.75);
      })
      .catch(() => view.setEnvironment(sky.horizon, sky.sunColor, sky.sunIntensity()));
  } else {
    const elevation = Math.sin(Math.PI * day) * 0.95;
    view.sunDirection.set(Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation)).normalize();
    sky.sun.copy(view.sunDirection);
    sky.update(view.camera, performance.now() / 1000);
    sunStrength = sky.sunIntensity();
    view.setEnvironment(sky.horizon, sky.sunColor, sky.sunIntensity());
  }
}
async function startSky(): Promise<void> {
  skyIndex = await fetch('hdri/index.json')
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, SkyInfo>>) : null))
    .catch(() => null);
  sky = new CitySky(view.sunDirection);
  view.scene.add(sky.object);
  sky.update(view.camera, 0);
  setSun(HOUR ?? level.hour);
}

// ---------- building a level ----------
/** Load contract `id`'s lot: a new world and physics, the ground, the sky, the bookkeeping. */
/** Let a frame go by (a long load is split into parts a frame apart, so no single task blocks the page for long). */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
/** A world is being swapped in: the loop draws nothing and steps nothing meanwhile. */
let swapping = false;
/** Whether the world loaded has the sandbox's spawn pool. */
let worldPool = false;
async function loadWorld(id: number, split = true): Promise<void> {
  swapping = true;
  veil(true);
  if (split) await nextFrame();
  levelId = id;
  const t0 = performance.now();
  // (The sandbox's lot comes with its spawn pool)
  worldPool = mode === 'sandbox';
  const built = buildLevel(id, SEED, worldPool);
  const t1 = performance.now();
  level = built.level;
  if (physics) physics.destroy();
  city = built.city;
  structure = new Structure(city);
  const t2 = performance.now();
  if (split) await nextFrame();
  loadTimes = { build: t1 - t0, structure: t2 - t1, physics: 0 };
  (player as unknown as { city: City }).city = city;
  chips.city = city;
  shards.city = city;
  chips.clear();
  shards.clear();
  smoke?.clear();
  alarms.clear();
  pending.length = 0;
  blows.length = 0;
  fuses.length = 0;
  fires.length = 0;
  for (const c of placed.splice(0)) c.mesh.removeFromParent();
  damage = new Map();
  stillFor = new Float32Array(0);
  lastImpact = new Float32Array(0);
  dustiness = 0;
  const buffer = view.attachVoxels(bodyCapacity(city), city);
  const t3 = performance.now();
  physics = new CityPhysics(device, city, buffer);
  physics.onCarry = (bodies, parent, offsets) => view.setLinks(bodies, parent, offsets);
  if (profile) physics.solver.params.iterations = profile.iterations;
  loadTimes.physics = performance.now() - t3;
  view.setPaints(city, physics.voxelOf);
  view.attachBalls(physics.spares);
  view.setStreets(city, level.grass);
  view.zone.value.set(level.zone?.x ?? 0, level.zone?.y ?? 0, level.zone?.r ?? 0, level.zone ? 1 : 0);
  occDirty = true;
  occAt = 0;
  setupMachines();
  setupRigging();
  setupHeist();
  setupSea();
  skylineMesh?.removeFromParent();
  // (Out to sea there's nothing round the lot but water)
  skylineMesh = level.sea !== undefined ? new THREE.Group() : level.grass ? suburb(city.pitch - city.street, SEED + level.id) : skyline(city);
  view.scene.add(skylineMesh);
  view.sunOnly(view.scene);
  baseFog = level.grass ? 0.0075 : 0.0032;
  (view.scene.fog as THREE.FogExp2).density = baseFog;
  if (sky) sky.coverage = level.grass ? 0.32 : 0.45;
  setSun(HOUR ?? level.hour);
  player.debrisCount = 0;
  // Bookkeeping: which voxels are the job, which to keep, which objects go off
  targetSet = new Set(level.targets);
  keepSet = new Set(level.keep);
  barrelSet = new Set(level.barrels);
  gasSet = new Set(level.gas ?? []);
  gasLit.clear();
  gasBlasts.length = 0;
  for (const b of pipeBombs.splice(0)) b.mesh.removeFromParent();
  barrelLit.clear();
  livePos = Float32Array.from(city.position);
  homePos = Float32Array.from(city.position);
  targetTotal = keepTotal = 0;
  targetVoxels = [];
  keepVoxels = [];
  for (let v = 0; v < city.count; v++) {
    if (targetSet.has(city.building[v])) {
      targetTotal++;
      targetVoxels.push(v);
    }
    if (keepSet.has(city.building[v])) {
      keepTotal++;
      keepVoxels.push(v);
    }
  }
  targetTotal = Math.max(1, targetTotal);
  keepTotal = Math.max(1, keepTotal);
  spawn();
  swapping = false;
  veil(false);
}
/** The lot's machines, parked where there's room (stepped back toward the lot's edge if something stands there). */
function setupMachines(): void {
  riding = null;
  testDrive = null;
  hud.machine(null);
  sounds.machinesOff();
  // (Their geometry is let go a couple of seconds later: disposed at once, a buffer could still be written by a frame
  // already on its way to the GPU)
  const old: THREE.BufferGeometry[] = [];
  for (const m of machines) {
    for (const o of [m.object, ...m.loose]) {
      o.removeFromParent();
      o.traverse((x) => {
        const g = (x as THREE.Mesh).geometry;
        if (g) old.push(g);
      });
    }
  }
  if (old.length) setTimeout(() => old.forEach((g) => g.dispose()), 2500);
  machines = [];
  physics.solidAt = machineSolid;
  if (!VEHICLES || mode === 'blowdown' || params.has('nomachines')) return;
  for (const spec of level.machines ?? []) {
    const [hl, hw] = spec.kind === 'crane' ? [4.4, 4.4] : [3.0, 2.2];
    let [x, y] = spec.at;
    for (let k = 0; k < 30 && sweepBox(city, x, y, spec.heading, hl, hw, 0.1, 4.5).length; k++) {
      x -= Math.cos(spec.heading) * 0.5;
      y -= Math.sin(spec.heading) * 0.5;
    }
    const m = makeMachine(spec.kind, x, y, spec.heading);
    view.scene.add(m.object);
    for (const o of m.loose) view.scene.add(o);
    if (m instanceof Crane) m.slot = physics.vehicle([1.5, 1.5, 1.5], m.ball.toArray());
    else {
      m.slot = physics.vehicle(Excavator.SIZE, [x, y, 0.95]);
      m.bucketSlot = physics.vehicle([1.3, 1.2, 1.0], m.bucketAt.toArray());
    }
    machines.push(m);
  }
}

/** What the seat's controls are this frame: the keys and where the camera looks, or the tests' drive. */
function machineControls(m: Machine): Controls | null {
  if (testDrive) {
    const seat = m.seat(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 1.2));
    const aim = testDrive.aim ? new THREE.Vector3(...testDrive.aim) : seat.clone().add(new THREE.Vector3(Math.cos(m.heading) * 8, Math.sin(m.heading) * 8, -2));
    return { forward: testDrive.forward ?? 0, turn: testDrive.turn ?? 0, lift: testDrive.lift ?? 0, action: !!testDrive.action, eye: seat, dir: aim.clone().sub(seat).normalize() };
  }
  if (!active()) return null;
  const k = (...codes: string[]) => (codes.some((c) => keys.has(c)) ? 1 : 0);
  const d = new THREE.Vector3();
  view.camera.getWorldDirection(d);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    forward: clamp(k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + padIn.forward),
    turn: clamp(k('KeyA', 'ArrowLeft') - k('KeyD', 'ArrowRight') - padIn.right),
    lift: clamp(k('Space') - k('KeyC', 'ControlLeft') + padIn.lift),
    action: held || padHeld,
    eye: view.camera.position.clone(),
    dir: d,
  };
}

/**
 * A machine's part driven into what stands: what the hit's energy breaks, by hardness. The speed into the
 * surface sets the reach (a heavier part reaches further: by √(mass / 4 t)); a bite (the bucket curling in)
 * always takes a mouthful of soft and medium. What it can't break, it rings off.
 */
function machineHit(c: Contact): Outcome {
  const k = Math.sqrt(c.mass / 4000);
  const v = c.vn * Math.min(1.6, k);
  let radii: [number, number, number] = [Math.min(2.1, 0.3 + 0.16 * v), Math.min(1.6, Math.max(0, 0.13 * v - 0.12)), v > 7 ? Math.min(0.9, (v - 7) * 0.12) : 0];
  // (The ball's tonnes of swinging steel bend girders a bucket can't)
  if (c.part === 'ball' && v > 5) radii[2] = Math.max(radii[2], Math.min(1.0, 0.3 + (v - 5) * 0.15));
  if (c.bite) radii = [Math.max(radii[0], 0.95), Math.max(radii[1], 0.8), radii[2]];
  if (c.part === 'tracks') radii = [Math.min(1.3, 0.7 + 0.25 * c.vn), Math.min(1.0, 0.45 + 0.2 * c.vn), 0];
  const struck = c.voxels[0];
  const distance = player.position.distanceTo(c.at);
  const at = c.at.toArray();
  if (radii[0] < 0.4 && !c.bite) return { brokeMass: 0 };
  const way = new THREE.Vector2(c.velocity.x, c.velocity.y);
  const hits: Hit[] = [{ at, radius: radii[0], radii, push: 1.5 + c.vn * 0.55, core: c.part === 'ball' ? 0.45 : 0.3, topple: way.lengthSq() > 0.01 ? way.normalize().toArray() : undefined }];
  // The tracks go in across their width
  if (c.part === 'tracks') {
    const side = new THREE.Vector3(-c.normal.y, c.normal.x, 0).multiplyScalar(1.1);
    for (const s of [-1, 1]) hits.push({ ...hits[0], at: c.at.clone().addScaledVector(side, s).toArray() });
  }
  const result = blasts(city, structure, physics, hits);
  unsettled = true;
  afterBlast(result, hits);
  const broke = result.gone.length + result.loose.length;
  machineStats.hits++;
  machineStats.broke += broke;
  machineStats.hardest = Math.max(machineStats.hardest, c.vn);
  const mat = city.material[struck] as Mat;
  const sfx = Sounds.material(mat);
  if (!broke) {
    machineStats.clanks++;
    sounds.clank(c.vn, distance, [at[0], at[1], at[2]]);
    effects.sparks(at, 10, 4 + c.vn * 0.5);
    impacts.hit(at, c.normal.toArray(), 0.8, 0.25, hotRing, 0.15);
    addTrauma(Math.min(0.35, c.vn * 0.05) * (riding ? 1 : 0.5));
    if (TIER[mat] >= 2 && !toldHard && riding) {
      toldHard = true;
      hud.toast(mat === Mat.Rock ? 'Bedrock: nothing breaks that' : 'Too hard for the machine: a charge or a cutter takes it');
    }
    return { brokeMass: 0 };
  }
  chips.burst(result.gone, at, 3, c.vn * 0.7 + 2);
  chips.burst(result.loose, at, 1, c.vn * 0.6 + 2);
  const energy = Math.min(1, (0.5 * c.mass * c.vn * c.vn) / 150000);
  sounds.impact(sfx, Math.max(0.35, energy), distance, broke, [at[0], at[1], at[2]]);
  if (c.part !== 'tracks') sounds.clank(c.vn * 0.5, distance, [at[0], at[1], at[2]]);
  addTrauma((0.15 + 0.45 * energy) * (riding ? 1 : (0.6 * 9) / (distance + 9)));
  if (energy > 0.45 && distance < 30 && screenOf(at)) hitstop = Math.max(hitstop, 0.03 + 0.03 * energy);
  effects.impact(at, 8 + 14 * energy * puffOf(result.gone[0]), tintOf(result.gone[0]));
  dustAt([...result.gone, ...result.loose], 0.3 + 0.3 * energy);
  charAround(at, 0.5 + radii[0] * 0.3, 0.2);
  scored(result, at);
  // A kilogram-ish per voxel by material (brick 0.25³ m × 1900 kg/m³ ≈ 30 kg)
  return { brokeMass: broke * 30 };
}

/** The machines: their step, their bodies in the solver, their noise, what they shake. */
function updateMachines(dt: number): void {
  machineWake -= dt;
  const wake = machineWake <= 0;
  if (wake) machineWake = 0.15;
  const snaps = new Map<Machine, unknown>();
  for (const m of machines) if (m instanceof Excavator) snaps.set(m, m.snapshot());
  machines.forEach((m) => {
    const c = m === riding ? machineControls(m) : null;
    m.update(dt, city, c, machineHit);
  });
  if (dt > 0) updateRigging(dt, snaps);
  machines.forEach((m, i) => {
    if (m instanceof Crane) {
      // The ball takes part in the world's physics only while it's worked or swinging: hanging still, a falling
      // storey that came down across it met a box that's never pushed back and was flung off it
      const speed = m.ballVel.length();
      m.solid = m === riding || speed > 0.3;
      if (m.slot >= 0) physics.drive(m.slot, m.solid ? m.ball.toArray() : [m.ball.x, m.ball.y, -400], [0, 0, 0, 1], m.solid ? m.ballVel.toArray() : [0, 0, 0], [0, 0, 0]);
      if (wake && speed > 1) physics.wake(m.ball.toArray(), 1.7);
      if (m.thud > 2) {
        const d = player.position.distanceTo(m.ball);
        sounds.play('thud', Math.min(1, m.thud / 8), d, { rate: 0.7, at: [m.ball.x, m.ball.y, 0] });
        effects.impact([m.ball.x, m.ball.y, 0.2], 6, concreteDust);
        addTrauma(Math.min(0.3, m.thud * 0.03) * (9 / (d + 9)));
      }
      sounds.machine(`m${i}`, [m.x, m.y, 2.5], m.noise.rpm, m.noise.load, m.noise.hydraulic, m.noise.winch);
    } else {
      const h = m.heading;
      if (m.slot >= 0) physics.drive(m.slot, [m.position.x, m.position.y, 0.95], [0, 0, Math.sin(h / 2), Math.cos(h / 2)], [Math.cos(h) * m.speed, Math.sin(h) * m.speed, 0], [0, 0, m.turnRate]);
      const y = m.yaw;
      if (m.bucketSlot >= 0) physics.drive(m.bucketSlot, m.bucketAt.toArray(), [0, 0, Math.sin(y / 2), Math.cos(y / 2)], m.bucketVel.toArray(), [0, 0, m.slewRate]);
      if (wake && Math.abs(m.speed) > 0.25) physics.wake([m.position.x, m.position.y, 0.6], 3.3);
      if (wake && m.bucketVel.length() > 0.5) physics.wake(m.bucketAt.toArray(), 1.5);
      sounds.machine(`m${i}`, [m.position.x, m.position.y, 1.6], m.noise.rpm, m.noise.load, m.noise.hydraulic, 0);
    }
    if (m.lastHit > 0) {
      const d = m === riding ? 0 : player.position.distanceTo(m instanceof Crane ? m.ball : m.position);
      addTrauma(Math.min(0.5, m.lastHit * 0.06) * (9 / (d + 9)));
      m.lastHit = 0;
    }
  });
}

/** F: climb into the nearest machine (its door within reach), or out of the one you're in. */
function useMachine(): boolean {
  if (riding) {
    const m = riding;
    riding = null;
    testDrive = null;
    hud.machine(null);
    // Out by the door, or on the other side, or on top if both are blocked
    const out = m.door.clone();
    const back = m instanceof Crane ? new THREE.Vector3(m.x, m.y, 0) : m.position.clone();
    const other = back.clone().multiplyScalar(2).sub(out);
    const spot = [out, other].find((p) => !player.blocked(p.x, p.y, 0, 1.8)) ?? out.setZ(3.5);
    player.position.copy(spot);
    player.velocity.set(0, 0, 0);
    sounds.play('clack', 0.4, 0, { rate: 0.8 });
    return true;
  }
  const near = machineNear();
  if (!near) return false;
  riding = near;
  sounds.play('clack', 0.5, 0, { rate: 0.7 });
  hud.hint('');
  // The view swings round behind the machine, looking along its arm
  turning = { from: [player.yaw, player.pitch], to: [player.yaw + Math.atan2(Math.sin(near.kind === 'crane' ? near.heading + near.slew - player.yaw : near.yaw - player.yaw), Math.cos(near.kind === 'crane' ? near.heading + near.slew - player.yaw : near.yaw - player.yaw)), near.kind === 'crane' ? -0.28 : -0.22], t: 0, seconds: 0.5 };
  hud.machine(
    near.kind === 'crane'
      ? '<b>A</b>/<b>D</b> swing the boom · <b>W</b>/<b>S</b> raise and lower it · <b>Space</b>/<b>C</b> wind the ball up and down · <b>F</b> climb out'
      : '<b>W</b>/<b>S</b> drive · <b>A</b>/<b>D</b> turn · the arm reaches where you look · <b>hold click</b> to dig · <b>F</b> climb out',
  );
  if (!toldMachine) {
    toldMachine = true;
    hud.toast(near.kind === 'crane' ? 'Swing the boom, then stop it: the ball keeps going' : 'Drive it into a wall, or dig the bucket in');
  }
  return true;
}
let toldMachine = false;
/** The machine whose door you're standing at (within 3.5 m), if any. */
function machineNear(): Machine | null {
  let best: Machine | null = null;
  let bestD = 3.5;
  for (const m of machines) {
    const d = Math.hypot(m.door.x - player.position.x, m.door.y - player.position.y);
    if (d < bestD) [best, bestD] = [m, d];
  }
  return best;
}

// ---------- the heist (Salvage): plan with no clock; the first piece taken starts the alarm; out by the truck ----------
interface Loot {
  name: string;
  required: boolean;
  at: THREE.Vector3;
  fall: number;
  mesh: THREE.Group;
  marker: THREE.Mesh;
  taken: boolean;
}
interface Snapshot {
  state: Uint8Array;
  rest: Float32Array;
  devices: { kind: 'charge' | 'cutter'; at: number[]; normal: number[]; along: number[]; delay: number }[];
  player: number[];
  supplies: { charges: number; cutters: number; rockets: number; pipes: number; planks: number; cables: number };
  loot: { at: number[]; taken: boolean }[];
  machines: { at: number[]; heading: number; slew: number }[];
  planks: { a: number[]; b: number[]; holds: number[] }[];
  cables: { ends: Anchor[]; pa: number[]; pb: number[]; rest: number }[];
  score: number;
}
const heist = {
  on: false,
  state: 'prep' as 'prep' | 'alarm' | 'out' | 'caught',
  timeLeft: 60,
  loot: [] as Loot[],
  boxes: [] as { mesh: THREE.Group; led: THREE.Mesh; voxel: number; gone: boolean }[],
  truck: null as THREE.Group | null,
  arrow: null as THREE.Mesh | null,
  truckAt: new THREE.Vector3(),
  truckHeading: 0,
  cause: '',
  save: null as Snapshot | null,
  leaving: 0,
};
const LOOT_LOOK: Record<string, Block[]> = {
  gold: [
    { s: [0.7, 0.5, 0.12], p: [0, 0, 0.06], c: 0x6e5034 },
    ...[-0.2, 0, 0.2].flatMap((x) => [-0.12, 0.12].map((y): Block => ({ s: [0.17, 0.2, 0.1], p: [x, y, 0.17], c: 0xe0a92a }))),
    { s: [0.17, 0.2, 0.1], p: [-0.1, 0, 0.27], c: 0xf0bd3a },
    { s: [0.17, 0.2, 0.1], p: [0.1, 0, 0.27], c: 0xe0a92a },
  ],
  drive: [
    { s: [0.55, 0.45, 0.7], p: [0, 0, 0.35], c: 0x1d2024 },
    ...[0.15, 0.3, 0.45, 0.6].map((z): Block => ({ s: [0.02, 0.38, 0.06], p: [0.28, 0, z], c: 0x2a2e33 })),
  ],
  ledger: [
    { s: [0.42, 0.32, 0.09], p: [0, 0, 0.05], c: 0x6a1a14 },
    { s: [0.4, 0.3, 0.02], p: [0, 0, 0.1], c: 0xe8e0c8 },
  ],
  paintings: [-0.25, 0, 0.25].flatMap((y, k): Block[] => [
    { s: [0.06, 0.9, 0.7], p: [k * 0.08, y * 0.4, 0.38], c: 0x8a6a2c, r: [0, 0, 0] },
    { s: [0.07, 0.75, 0.55], p: [k * 0.08 + 0.01, y * 0.4, 0.38], c: [0x2f5f8a, 0xb3261e, 0x3a7a3a][k] },
  ]),
  watches: [
    { s: [0.5, 0.36, 0.14], p: [0, 0, 0.07], c: 0x111214 },
    { s: [0.46, 0.32, 0.02], p: [0, 0, 0.145], c: 0xd8a520 },
  ],
  cash: [
    { s: [0.46, 0.32, 0.26], p: [0, 0, 0.13], c: 0x4a5a44 },
    { s: [0.48, 0.34, 0.04], p: [0, 0, 0.27], c: 0x3a4636 },
  ],
};
const geoCache = new Map<string, THREE.BufferGeometry>();
const geoOf = (key: string, list: Block[]) => {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = blocks(list)));
  return g;
};
/** The heist's props: the loot (props, not voxels), the alarm boxes on their walls, the truck. */
function setupHeist(): void {
  for (const l of heist.loot) l.mesh.removeFromParent();
  for (const b of heist.boxes) b.mesh.removeFromParent();
  heist.truck?.removeFromParent();
  heist.loot = [];
  heist.boxes = [];
  heist.truck = null;
  heist.save = null;
  heist.on = !!level.heist && mode === 'heist';
  heist.state = 'prep';
  heist.leaving = 0;
  sounds.siren(false);
  sounds.chopper(0);
  const spec = level.heist;
  if (!spec || !heist.on) return;
  heist.timeLeft = spec.alarm;
  for (const l of spec.loot) {
    const g = new THREE.Group();
    g.add(mesh(geoOf(l.look, LOOT_LOOK[l.look])));
    const marker = new THREE.Mesh(geoOf('marker', [{ s: [0.18, 0.18, 0.18], p: [0, 0, 0], c: l.required ? 0xffb030 : 0x60d0ff, r: [Math.PI / 4, Math.PI / 4, 0] }]), glowMat);
    marker.position.z = 1.2;
    g.add(marker);
    g.position.set(...l.at);
    view.scene.add(g);
    heist.loot.push({ name: l.name, required: l.required, at: new THREE.Vector3(...l.at), fall: 0, mesh: g, marker, taken: false });
  }
  for (const a of spec.alarms) {
    const g = new THREE.Group();
    g.add(mesh(geoOf('alarmbox', [
      { s: [0.32, 0.12, 0.42], p: [0, 0, 0], c: 0xb3261e },
      { s: [0.22, 0.06, 0.22], p: [0, -0.07, 0.04], c: 0xd8d2c4 },
    ])));
    const led = new THREE.Mesh(geoOf('led', [{ s: [0.06, 0.04, 0.06], p: [0, -0.09, -0.15], c: 0xff2010 }]), glowMat);
    g.add(led);
    g.position.set(...a.at);
    g.rotation.z = Math.atan2(a.facing[1], a.facing[0]) + Math.PI / 2;
    view.scene.add(g);
    // The wall it's screwed to
    const voxel = voxelAt(city, a.at[0] - a.facing[0] * 0.2, a.at[1] - a.facing[1] * 0.2, a.at[2]);
    heist.boxes.push({ mesh: g, led, voxel, gone: false });
  }
  heist.truckAt.set(spec.truck.at[0], spec.truck.at[1], 0);
  heist.truckHeading = spec.truck.heading;
  const t = new THREE.Group();
  t.add(mesh(geoOf('truck', [
    { s: [7.2, 2.4, 0.5], p: [0, 0, 0.75], c: 0x26282b },
    { s: [5.0, 2.5, 2.6], p: [-1.0, 0, 2.3], c: 0x2a3f5a },
    { s: [1.9, 2.4, 2.1], p: [2.6, 0, 2.05], c: 0x2f5f8a },
    { s: [0.05, 2.0, 0.8], p: [3.56, 0, 2.5], c: 0x1c2a33 },
    { s: [0.05, 2.45, 2.4], p: [-3.52, 0, 2.3], c: 0x3a4f6a },
    ...[-2.4, -1.3, 2.4].flatMap((x) => [-1.1, 1.1].map((y): Block => ({ s: [0.9, 0.35, 0.9], p: [x, y, 0.45], c: 0x111111 }))),
  ])));
  t.add(new THREE.Mesh(geoOf('truckLights', [
    { s: [0.05, 0.3, 0.18], p: [3.57, 0.85, 1.25], c: 0xfff1d0 },
    { s: [0.05, 0.3, 0.18], p: [3.57, -0.85, 1.25], c: 0xfff1d0 },
  ]), glowMat));
  t.position.copy(heist.truckAt);
  t.rotation.z = heist.truckHeading;
  view.scene.add(t);
  heist.truck = t;
  const arrow = new THREE.Mesh(geoOf('arrow', [
    { s: [0.5, 0.5, 0.5], p: [0, 0, 0], c: 0x60ff90, r: [Math.PI / 4, Math.PI / 4, 0] },
  ]), glowMat);
  arrow.visible = false;
  view.scene.add(arrow);
  heist.arrow = arrow;
  t.add(arrow);
  arrow.position.set(0, 0, 5);
}

/** The loot you're close enough to take (within 2.2 m, near where you look), if any. */
function lootNear(): Loot | null {
  player.eye(eye);
  player.look(dir);
  let best: Loot | null = null;
  let bestScore = 0;
  for (const l of heist.loot) {
    if (l.taken) continue;
    const to = l.at.clone().add(new THREE.Vector3(0, 0, 0.2)).sub(eye);
    const d = to.length();
    if (d > 2.6) continue;
    const facing = to.normalize().dot(dir);
    const score = facing + (2.6 - d);
    if ((facing > 0.5 || d < 1.4) && score > bestScore) [best, bestScore] = [l, score];
  }
  return best;
}
const truckNear = () => heist.truck && Math.hypot(player.position.x - heist.truckAt.x, player.position.y - heist.truckAt.y) < 5;
const requiredLeft = () => heist.loot.filter((l) => l.required && !l.taken).length;

/** F in a heist: take the loot in front of you, or get in the truck. True if it did something. */
function heistUse(): boolean {
  if (!heist.on || phase !== 'play' || riding) return false;
  const l = lootNear();
  if (l) {
    l.taken = true;
    l.mesh.removeFromParent();
    sounds.pickup();
    const got = heist.loot.filter((x) => x.required && x.taken).length;
    const need = heist.loot.filter((x) => x.required).length;
    hud.banner(l.name.toUpperCase(), l.required ? `${got} OF ${need} TAKEN` : 'A BONUS PIECE', true);
    award(l.required ? 2500 : 4000, l.at.toArray(), l.required ? 'TAKEN' : 'BONUS');
    raiseAlarm('You took the first piece');
    if (!requiredLeft()) hud.hint('All the required loot taken: get to the <b>truck</b>');
    return true;
  }
  if (truckNear()) {
    if (requiredLeft()) {
      hud.toast(`Take the rest of the required loot first (${requiredLeft()} left)`);
      return true;
    }
    finishHeist(true);
    return true;
  }
  return false;
}

/** The alarm: 60 s from now to be gone. Quicksave is off from here on. */
function raiseAlarm(cause: string): void {
  if (!heist.on || heist.state !== 'prep') return;
  heist.state = 'alarm';
  heist.cause = cause;
  heist.timeLeft = level.heist?.alarm ?? 60;
  sounds.siren(true);
  sounds.duck(4, 1.5);
  hud.banner('ALARM', `${cause.toUpperCase()} · ${heist.timeLeft} SECONDS`, true);
  addTrauma(0.15);
  if (PATCH_TEST) console.log('pass heist-alarm');
}

/** The heist each frame: the loot settles on what holds it, the alarm boxes watch their walls, the clock, the chopper. */
function updateHeist(dt: number): void {
  const t = simTime;
  const need = heist.loot.filter((l) => l.required).length;
  const got = heist.loot.filter((l) => l.required && l.taken).length;
  const bonus = heist.loot.filter((l) => !l.required && l.taken).length;
  const bonusAll = heist.loot.filter((l) => !l.required).length;
  hud.loot(need ? got / need : 1, `LOOT ${got}/${need} · BONUS ${bonus}/${bonusAll}`);
  for (const l of heist.loot) {
    if (l.taken) continue;
    // Held by the ground, a standing voxel or rubble under it; else it falls (nothing hovers, the loot neither)
    const under = l.at.z <= 0.01 || voxelAt(city, l.at.x, l.at.y, l.at.z - 0.05) >= 0 || physics.rubbleAt(l.at.x, l.at.y, l.at.z - 0.1) >= 0;
    if (!under) {
      l.fall -= 9.81 * dt;
      l.at.z = Math.max(0, l.at.z + l.fall * dt);
      const landed = l.at.z <= 0 || voxelAt(city, l.at.x, l.at.y, l.at.z - 0.05) >= 0;
      if (landed) {
        if (l.at.z > 0) l.at.z = Math.ceil((l.at.z - 0.05) / VOXEL) * VOXEL;
        if (l.fall < -3) sounds.bounce('metal', player.position.distanceTo(l.at), [l.at.x, l.at.y, l.at.z]);
        l.fall = 0;
      }
    }
    l.mesh.position.copy(l.at);
    // The marker over it shows within 8 m (the outline distance), turning and bobbing
    const d = player.position.distanceTo(l.at);
    l.marker.visible = d < 8;
    l.marker.position.z = 1.1 + Math.sin(t * 3 + l.at.x) * 0.08;
    l.marker.rotation.z = t * 1.5;
  }
  for (const b of heist.boxes) {
    if (b.gone) continue;
    b.led.visible = heist.state === 'alarm' ? Math.floor(t * 2) % 2 === 0 : t % 1 > 0.9;
    if (b.voxel >= 0 && city.state[b.voxel] !== State.Fixed) {
      b.gone = true;
      b.mesh.removeFromParent();
      raiseAlarm('An alarm box was broken');
    }
  }
  if (fires.length >= 30) raiseAlarm('The fire set off the alarm');
  // The truck: its arrow once the required loot is in hand
  if (heist.arrow) {
    heist.arrow.visible = !requiredLeft() && heist.state !== 'out';
    heist.arrow.position.z = 4.6 + Math.sin(t * 5) * 0.3 + 0.3;
    heist.arrow.rotation.z = t * 2;
  }
  if (heist.leaving > 0 && heist.truck) {
    heist.leaving += dt;
    const v = Math.min(20, heist.leaving * 6);
    heist.truck.position.x += Math.cos(heist.truckHeading) * v * dt;
    heist.truck.position.y += Math.sin(heist.truckHeading) * v * dt;
  }
  if (phase !== 'play') return;
  if (riding === null && !paused) {
    const l = lootNear();
    if (l) hud.prompt(`<b>F</b> Take the ${l.name.toLowerCase()}`);
    else if (truckNear()) hud.prompt(requiredLeft() ? `<b>F</b> ${requiredLeft()} more to take before you go` : '<b>F</b> Get in the truck');
  }
  if (heist.state === 'prep') {
    hud.clock(0, heist.save ? 'PREP · SAVED' : 'PREP · NO CLOCK');
    return;
  }
  if (heist.state !== 'alarm') return;
  if (!cam.active && !paused) heist.timeLeft -= dt;
  hud.clock(heist.timeLeft, 'ALARM', true);
  if (heist.timeLeft <= 10 && Math.ceil(heist.timeLeft) !== Math.ceil(heist.timeLeft + dt) && heist.timeLeft > 0) sounds.blip(880, 0.07, 0.07, 'square');
  // The chopper: in with 15 s left, louder as it closes (only a sound and a shake: the clock is the fail)
  sounds.chopper(heist.timeLeft < 15 ? Math.min(1, Math.sqrt((15 - heist.timeLeft) / 15)) : 0);
  if (heist.timeLeft < 15 && Math.random() < dt * 2) addTrauma(0.03);
  if (heist.timeLeft <= 0) finishHeist(false);
}

/** Away in the truck (stars for the time left), or caught when the clock ran out. */
function finishHeist(win: boolean): void {
  const spec = level.heist as HeistSpec;
  heist.state = win ? 'out' : 'caught';
  phase = 'end';
  sounds.siren(false);
  sounds.chopper(0);
  sounds.sting(win);
  hud.prompt(null);
  const need = heist.loot.filter((l) => l.required).length;
  const got = heist.loot.filter((l) => l.required && l.taken).length;
  const bonus = heist.loot.filter((l) => !l.required && l.taken).length;
  const left = heist.state === 'out' ? Math.max(0, heist.timeLeft) : 0;
  const raised = heist.cause !== '';
  const stars = win ? 1 + (left >= 15 || !raised ? 1 : 0) + (left >= 30 || !raised ? 1 : 0) : 0;
  const timeBonus = win ? Math.round(left * 100) : 0;
  const score = win ? game.score + timeBonus : Math.round(game.score * 0.25);
  const rows: [string, string][] = [
    ['Required loot', `${got} of ${need}`],
    ['Bonus loot', `${bonus} of ${heist.loot.length - need}`],
    ['Time left on the alarm', win ? `${left.toFixed(1)} s` : 'none'],
  ];
  if (heist.cause) rows.push(['Alarm', heist.cause]);
  if (timeBonus) rows.push(['Time bonus', `+${timeBonus.toLocaleString()}`]);
  void spec;
  game.score = score;
  const best = score > (progress.heistBest[levelId] ?? 0);
  if (best && win) progress.heistBest[levelId] = score;
  const had = starTotal();
  progress.heistStars[levelId] = Math.max(progress.heistStars[levelId] ?? 0, stars);
  save();
  unlockedRows(rows, had);
  const title = win ? (stars === 3 ? 'Clean getaway' : stars === 2 ? 'Away' : 'Just made it') : 'Caught';
  if (win) heist.leaving = 0.01;
  hud.showEnd({ title, sub: `${level.name.toUpperCase()} · SALVAGE`, stars, rows, score, best: best && win, hasNext: false, replay: replays.best() });
  hud.show(false);
  endCam();
  if (win) cam.centre.copy(heist.truckAt).setZ(2);
  sounds.music(true);
  if (document.pointerLockElement) document.exitPointerLock();
  if (PATCH_TEST) console.log(`pass heist-${win ? 'escaped' : 'caught'}`);
}

/** F5: one quicksave, in prep only, once the lot is still. */
function quicksave(): void {
  if (!heist.on || phase !== 'play') return;
  if (heist.state !== 'prep') {
    hud.toast('No saving once the alarm has gone');
    return;
  }
  if (physics.sections.size || physics.loose > 60 || pending.length || fuses.length || rockets.length || pipeBombs.length) {
    hud.toast('Wait for the dust to settle, then save');
    return;
  }
  heist.save = {
    state: city.state.slice(),
    rest: physics.rest.slice(),
    devices: placed.map((c) => ({ kind: c.kind, at: c.mesh.position.toArray(), normal: c.normal.toArray(), along: c.along.toArray(), delay: c.delay })),
    player: [player.position.x, player.position.y, player.position.z, player.yaw, player.pitch],
    supplies: { charges: game.charges, cutters: game.cutters, rockets: game.rockets, pipes: game.pipes, planks: game.planks, cables: game.cables },
    loot: heist.loot.map((l) => ({ at: l.at.toArray(), taken: l.taken })),
    machines: machines.map((m) => (m instanceof Crane ? { at: [m.x, m.y, 0], heading: m.heading, slew: m.slew } : { at: m.position.toArray(), heading: m.heading, slew: m.slew })),
    planks: planks.map((p) => ({ a: p.a.toArray(), b: p.b.toArray(), holds: [p.holdA, p.holdB] })),
    cables: cables.filter((c) => !c.cut).map((c) => ({ ends: c.ends.map((e) => structuredClone(e)), pa: c.points[0].toArray(), pb: c.points[c.points.length - 1].toArray(), rest: c.rest })),
    score: game.score,
  };
  hud.toast('Saved. F9 loads it (until the alarm)');
  sounds.blip(1320, 0.06, 0.1);
}

/** F9: back to the quicksave: the lot rebuilt as it was (what was gone is gone, the rubble where it lay), the devices, the machines, you. */
async function quickload(): Promise<void> {
  const s = heist.save;
  if (!heist.on || !s || heist.state !== 'prep' || phase !== 'play') {
    if (heist.on && !s) hud.toast('Nothing saved yet: F5 saves during the prep');
    return;
  }
  for (const c of placed.splice(0)) c.mesh.removeFromParent();
  await loadWorld(levelId);
  heist.save = s;
  const gone: number[] = [];
  const rubble: number[] = [];
  for (let v = 0; v < city.count; v++) {
    if (s.state[v] === State.Fixed) continue;
    if (s.state[v] === State.Rubble) rubble.push(v);
    else gone.push(v);
  }
  structure.leave([...gone, ...rubble]);
  physics.remove(gone);
  if (rubble.length) {
    physics.loosen(rubble);
    const poses = new Float32Array(rubble.length * 7);
    rubble.forEach((v, k) => poses.set(s.rest.subarray(7 * v, 7 * v + 7), 7 * k));
    physics.freeze(rubble, poses);
    for (const v of rubble) {
      livePos[3 * v] = s.rest[7 * v];
      livePos[3 * v + 1] = s.rest[7 * v + 1];
      livePos[3 * v + 2] = s.rest[7 * v + 2];
    }
  }
  for (const d of s.devices) putDevice(d.kind, new THREE.Vector3(...d.at), new THREE.Vector3(...d.normal), new THREE.Vector3(...d.along), d.delay);
  Object.assign(game, s.supplies);
  game.score = s.score;
  s.loot.forEach((l, k) => {
    const x = heist.loot[k];
    if (!x) return;
    x.at.set(l.at[0], l.at[1], l.at[2]);
    x.taken = l.taken;
    if (l.taken) x.mesh.removeFromParent();
  });
  s.machines.forEach((m, k) => {
    const x = machines[k];
    if (x instanceof Excavator) {
      x.position.set(m.at[0], m.at[1], 0);
      x.heading = m.heading;
      x.slew = m.slew;
    } else if (x instanceof Crane) x.slew = m.slew;
  });
  for (const p of s.planks) layPlank(new THREE.Vector3(...p.a), new THREE.Vector3(...p.b), p.holds[0], p.holds[1]);
  for (const c of s.cables) tieCable(structuredClone(c.ends[0]), structuredClone(c.ends[1]), new THREE.Vector3(...c.pa), new THREE.Vector3(...c.pb)).rest = c.rest;
  player.position.set(s.player[0], s.player[1], s.player[2]);
  player.yaw = s.player[3];
  player.pitch = s.player[4];
  view.setPaints(city, physics.voxelOf);
  unsettled = true;
  hud.toast('Loaded the quicksave');
}

/** A charge or cutter stuck at `at` on a face with normal `n` (placeCharge, and the quickload). */
function putDevice(kind: 'charge' | 'cutter', at: THREE.Vector3, n: THREE.Vector3, along: THREE.Vector3, delay: number): void {
  const { mesh: g, light } = chargeMesh();
  if (kind === 'cutter') {
    const strip = new THREE.Mesh(cutterGeo, cutterMat);
    strip.position.set(0, 0, -0.02);
    g.add(strip);
  }
  g.position.copy(at);
  g.up.set(0, 0, 1);
  g.lookAt(at.clone().add(n));
  view.scene.add(g);
  placed.push({ mesh: g, light, due: Infinity, normal: n, armedAt: simTime, kind, delay, along });
}

// ---------- the volume AO's picture of the lot (render.ts setOccupancy) ----------
let occDirty = true;
let occAt = 0;
/** Refill the occupancy volume (what stands, what's settled) at most three times a second while things change. */
function updateOccupancy(dt: number): void {
  occAt -= dt;
  if (physics.loose > 0 || physics.sections.size > 0) occDirty = true;
  if (!occDirty || occAt > 0 || view.volumeAO.value <= 0) return;
  occAt = 0.33;
  occDirty = false;
  const rubble: number[] = [];
  for (const v of physics.rubble) rubble.push(physics.rest[7 * v], physics.rest[7 * v + 1], physics.rest[7 * v + 2]);
  view.setOccupancy(city, rubble);
}

// ---------- the sea (water.ts; buoyancy in physics.ts) ----------
let sea: Sea | null = null;
/** One sea, made once (its shader compiles with the rest at the start), moved to each lot that has one. */
const theSea = new Sea(1);
const steamTint = new THREE.Color(0.85, 0.88, 0.9);
const sprayTint = new THREE.Color(0.75, 0.86, 0.92);
/** The tank on the lot that pours when holed: how long it's been pouring (s), -1 not yet. */
let pouring = -1;
let pourAt = 0;
let tankVoxels: number[] = [];
function setupSea(): void {
  theSea.mesh.removeFromParent();
  sea = null;
  pouring = -1;
  tankVoxels = [];
  if (level.sea === undefined) return;
  sea = theSea;
  sea.setLevel(level.sea);
  view.scene.add(sea.mesh);
  physics.setWater([-800, -800, 800, 800], level.sea);
  const t = level.tankBox;
  if (t)
    for (let v = 0; v < city.count; v++) {
      const [x, y, z] = [city.position[3 * v], city.position[3 * v + 1], city.position[3 * v + 2]];
      if (x > t[0] && x < t[3] && y > t[1] && y < t[4] && z > t[2] && z < t[5]) tankVoxels.push(v);
    }
}

/** Debris going into the sea (from the last readback): splashes, a ring of foam, spray and the sound. */
const splashes: number[] = [];
function splashDown(): void {
  if (!sea || !splashes.length) return;
  // Merged: one splash per couple of metres
  const done: number[][] = [];
  for (let k = 0; k < splashes.length && done.length < 4; k += 3) {
    const [x, y, s] = [splashes[k], splashes[k + 1], splashes[k + 2]];
    const near = done.find((d) => Math.hypot(d[0] - x, d[1] - y) < 2);
    if (near) {
      near[2] = Math.max(near[2], s);
      near[3]++;
      continue;
    }
    done.push([x, y, s, 1]);
  }
  splashes.length = 0;
  // (One sound for the biggest, and not more than six a second: a whole storey into the sea is one roar, not fifty)
  const loudest = done.reduce((a, b) => (b[2] * b[3] > a[2] * a[3] ? b : a), done[0]);
  const hear = simTime - splashHeard > 0.16;
  if (hear) splashHeard = simTime;
  for (const [x, y, speed, n] of done) {
    const size = Math.min(2, (speed / 6) * Math.sqrt(n));
    sea.splash(x, y, size);
    const at: [number, number, number] = [x, y, sea.level];
    effects.spray(at, 8 + 14 * size, 2.5 + speed * 0.4, sprayTint);
    effects.impact(at, 4 + 8 * size, steamTint);
    if (hear && x === loudest[0] && y === loudest[1]) sounds.splash(size, player.position.distanceTo(new THREE.Vector3(...at)), at);
    splashCount++;
  }
}
let splashCount = 0;
let splashHeard = 0;

/** The tank: once holed it pours for a few seconds, a stream of water falling into the sea. */
function pourTank(dt: number): void {
  if (!sea || !tankVoxels.length) return;
  if (pouring < 0) {
    pourAt -= dt;
    if (pourAt > 0) return;
    pourAt = 0.3;
    const left = tankVoxels.filter((v) => city.state[v] === State.Fixed).length;
    if (left < tankVoxels.length * 0.92) pouring = 0;
    return;
  }
  if (pouring > 7) return;
  pouring += dt;
  pourAt -= dt;
  if (pourAt > 0) return;
  pourAt = 0.08;
  const fixed = tankVoxels.filter((v) => city.state[v] === State.Fixed);
  const from = fixed.length ? fixed : tankVoxels;
  let [x, y, z] = [0, 0, 0];
  for (const v of from) {
    x += city.position[3 * v] / from.length;
    y += city.position[3 * v + 1] / from.length;
    z += city.position[3 * v + 2] / from.length;
  }
  const flow = Math.max(0.2, 1 - pouring / 7);
  effects.spray([x, y, z], 10 * flow, 2.5, sprayTint);
  if (Math.random() < 0.35) sea.splash(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, 0.4 * flow);
  if (Math.random() < 0.2) sounds.splash(0.25 * flow, player.position.distanceTo(new THREE.Vector3(x, y, z)), [x, y, sea.level]);
}

/** A quick fade over the swap. */
const veilEl = document.createElement('div');
veilEl.style.cssText = 'position:fixed;inset:0;z-index:5;background:#15130f;opacity:0;pointer-events:none;transition:opacity 180ms';
document.body.append(veilEl);
function veil(on: boolean): void {
  veilEl.style.transition = on ? 'none' : 'opacity 350ms';
  veilEl.style.opacity = on && phase !== 'loading' ? '1' : '0';
}

function spawn(): void {
  const [x, y, yaw, pitch] = level.spawn;
  player.position.set(x, y, level.spawnZ ?? 0);
  player.velocity.set(0, 0, 0);
  player.yaw = yaw;
  player.pitch = pitch;
  player.flying = false;
}

/** Start contract `id`: build it, reset the score and clock, fly in. */
async function startLevel(id: number): Promise<void> {
  if (phase === 'loading' || startingUp) return;
  if (lotLocked(id)) {
    hud.toast(`${LEVELS[id].name}: unlocks at ${LOT_STARS[id]} stars`);
    return;
  }
  if (!isReady) {
    startingUp = true;
    await getReady();
    startingUp = false;
  }
  hud.hideTitle();
  hud.showEnd(null);
  hud.cine(false);
  if (id !== levelId || phase !== 'title' || levelDirty || worldPool !== (mode === 'sandbox')) await loadWorld(id);
  levelDirty = true;
  // A blowdown: no clock, more charges and cutters (it's a plan, and it has to work in one go), no guns
  const blow = mode === 'blowdown';
  const sand = mode === 'sandbox';
  spawnUsed = {};
  spawnOpen = false;
  hud.spawnBar(null);
  Object.assign(game, { score: 0, combo: 1, comboAt: -10, bestCombo: 1, timeLeft: level.time, grace: 0, charges: sand ? 99 : level.charges + (blow ? 3 : 0), cutters: sand ? 99 : (level.cutters ?? 2) + (blow ? 2 : 0), rockets: blow ? 0 : sand ? 99 : (level.rockets ?? 2), pipes: blow ? 0 : sand ? 99 : (level.pipes ?? 3), planks: blow ? 0 : sand ? 99 : (level.planks ?? 8), cables: blow ? 0 : sand ? 99 : (level.cables ?? 6), biggest: 0, demolition: 0, keepShare: 1, zoneHit: false, barrelsBlown: 0, voxelsBroken: 0, introT: 0, endT: 0, demolishedCalled: false, timeLeftAtDemolish: 0, hint: 0 });
  blownAt = -1;
  fuseDelay = 0;
  replays.clear();
  for (const r of rockets.splice(0)) r.mesh.removeFromParent();
  hud.resetScore();
  hud.setJob(level.name, blow ? 'Wire it up with charges and cutters (R sets each one’s delay), then Q. Scored on a clean drop.' : level.brief, level.stars);
  hud.show(true);
  tool = -1;
  showLocks();
  selectTool(blow ? CHARGE : id === 0 || id === 1 || id === 3 ? CANNON : CHARGE);
  hud.select(tool);
  hand.select(tool);
  hud.banner(level.name, blow ? `BLOWDOWN ${lotNumber(id)}` : sand ? 'SANDBOX' : heist.on ? 'SALVAGE' : `CONTRACT ${lotNumber(id)}`);
  if (sand) hud.setJob(level.name, 'Sandbox: every tool, no limits. B spawns props, T sets the time of day.', level.stars);
  if (heist.on) hud.setJob(level.name, 'Plan with no clock (F5 saves, F9 loads). Take a piece and the alarm gives you 60 s to reach the truck.', level.stars);
  phase = 'intro';
  cam.active = false;
  timeScale = 1;
  sounds.music(true);
  sounds.play('horn', 0.5, 0, { spread: 0.02 });
  game.introT = params.has('test') && !params.has('intro') ? 99 : 0;
}
/** A contract was asked for while the rest of starting up finishes. */
let startingUp = false;
/** The world was played in (the title's attract view uses a fresh one). */
let levelDirty = false;
let loadTimes = { build: 0, structure: 0, physics: 0 };

async function showTitle(): Promise<void> {
  phase = 'title';
  cam.active = false;
  timeScale = 1;
  hud.show(false);
  hud.cine(false);
  sounds.music(false);
  if (levelDirty || levelId !== 0) {
    await loadWorld(0);
    levelDirty = false;
  }
  hud.showTitle(cards(), nextContract(), null);
  hud.setLoading(null);
}
const cards = (): ContractCard[] => {
  hud.starTotal = TESTING && !params.has('locks') ? null : starTotal();
  return lotsFor(mode === 'heist')
    .map((id) => LEVELS[id])
    .map((l) => ({
      id: l.id,
      name: l.name,
      brief: mode === 'blowdown' ? BLOWDOWN_BRIEFS[l.id] : l.brief,
      best: (mode === 'blowdown' ? progress.blowBest : mode === 'heist' ? progress.heistBest : progress.best)[l.id] ?? 0,
      stars: (mode === 'blowdown' ? progress.blowStars : mode === 'heist' ? progress.heistStars : progress.stars)[l.id] ?? 0,
      locked: lotLocked(l.id) ? LOT_STARS[l.id] : undefined,
    }));
};
const BLOWDOWN_BRIEFS = [
  'Drop the house on its own plot. Don’t touch the shed.',
  'Lay the tower in the ring with as few charges as it takes.',
  'Bring all eleven storeys straight down into the footprint.',
  'Flatten the barn and lay the silo into the field.',
  'Fell the chimney down the yard, clear of the boiler house.',
  'Pancake all five decks straight down. Spare the ticket hut.',
  'Drop the canopy and the shop without setting the street alight.',
  '',
  'Drop the boathouse and the pier end into the sea. Spare the lighthouse.',
  'Bring the crusher house and the conveyor down where they stand.',
  'Fell the steeple into the ring on the green, clear of the nave.',
];

// ---------- startup ----------
const loader = new Loader([
  { name: 'Starting the GPU and loading materials', weight: 4 },
  { name: 'Building the lot', weight: 2 },
  { name: 'Starting the physics', weight: 2 },
  { name: 'Lighting the sky', weight: 1 },
  { name: 'Compiling shaders', weight: 3 },
]);
let device: GPUDevice;

async function start(): Promise<void> {
  await loader.stage(0);
  performance.mark('boot-await loader.stage(0);');
  device = await view.init((share) => loader.progress(share));
  if (PATCH_TEST) console.log('pass webgpu');
  await loader.stage(1);
  performance.mark('boot-await loader.stage(1);');
  level = buildLevel(0, SEED).level;
  effects = startEffects();
  performance.mark('boot-effects = startEffects();');
  await loader.stage(2);
  performance.mark('boot-await loader.stage(2);');
  await loadWorld(0, false);
  performance.mark('boot-loadWorld(0);');
  await loader.stage(3);
  performance.mark('boot-await loader.stage(3);');
  await startSky();
  performance.mark('boot-await startSky();');
  sky.coverage = 0.32;
  view.camera.position.set(player.position.x, player.position.y, 1.7);
  await loader.stage(4);
  performance.mark('boot-await loader.stage(4);');
  // The scene's materials compile without blocking the page, and everything that appears later with them: every
  // tool in hand, a charge, the muzzle flash
  hand.compileAll(true);
  const dummy = chargeMesh();
  dummy.mesh.position.set(view.camera.position.x, view.camera.position.y + 3, 1);
  // (And a cutter strip, a rocket, a pipe bomb: compiled now, not at their first use)
  const strip = new THREE.Mesh(cutterGeo, cutterMat);
  dummy.mesh.add(strip);
  const rocketDummy = new THREE.Mesh(rocketGeo, rocketMat);
  rocketDummy.position.set(0.5, 0, 0);
  dummy.mesh.add(rocketDummy);
  const pipeDummy = pipeMesh();
  pipeDummy.position.set(-0.5, 0, 0);
  dummy.mesh.add(pipeDummy);
  // (A crane, its rope and ball, and what glows: the machines and the heist's props)
  const craneDummy = new Crane(0, 0, 0);
  craneDummy.object.scale.setScalar(0.05);
  dummy.mesh.add(craneDummy.object, ...craneDummy.loose);
  dummy.mesh.add(new THREE.Mesh(geoOf('marker', [{ s: [0.18, 0.18, 0.18], p: [0, 0, 0], c: 0xffb030 }]), glowMat));
  dummy.mesh.add(new THREE.Mesh(previewMesh.geometry, previewMat));
  dummy.mesh.add(new THREE.Mesh(previewMesh.geometry, theSea.mesh.material as THREE.Material));
  view.scene.add(dummy.mesh);
  // (Only the voxels and the ground take the blast lights: everything else compiles without them)
  view.sunOnly(view.scene);
  await view.renderer.compileAsync(view.scene, view.camera);
  performance.mark('boot-await view.renderer.compileAsy');
  view.render();
  performance.mark('boot-view.render();');
  dummy.mesh.removeFromParent();
  hand.compileAll(false);
  loader.progress(0.8);
  view.warm();
  performance.mark('boot-view.warm();');
  applySettings();
  // The fire, smoke and dust compile while the title is up (nothing needs them before a contract starts), and a
  // device seen before gets its saved profile now; a new one is tuned behind the contract card (getReady)
  smokeCompiled = view.renderer.compileAsync(view.smokeScene, view.camera);
  deviceName = deviceKey(view.adapterInfo, 'brickfall');
  profile = params.has('retune') ? null : savedProfile(deviceName);
  if (profile) applyProfile(profile);
  levelDirty = false;
  await loader.finish();
  performance.mark('boot-await loader.finish();');
  last = performance.now();
  accumulator = 0;
  phase = 'title';
  await showTitle();
  requestAnimationFrame(frame);
  if (PATCH_TEST) void selfTest();
}

/** The smoke scene's pipelines, compiling while the title is up. */
let smokeCompiled: Promise<void> = Promise.resolve();
let deviceName = '';
/** The rest of starting up, done once, behind the contract card: the fire and smoke compiled and warmed, the device tuned on its first visit. */
let readying: Promise<void> | null = null;
/** The device is being tuned: the loop stands still (the tuner steps the world itself). */
let tuning = false;
let isReady = false;
function getReady(): Promise<void> {
  readying ??= (async () => {
    hud.setLoading('Getting the fire and smoke ready…');
    await smokeCompiled;
    if (!profile) {
      hud.setLoading('Tuning for this device…');
      veil(true);
      phase = 'loading';
      tuning = true;
      profile = await tune(deviceName);
      saveProfile(profile);
      applyProfile(profile);
      levelDirty = true;
      phase = 'title';
    }
    // A blast far below the ground, unseen, compiles the fire, smoke and dust's compute work now rather than at the first one
    effects.explosion([0, 0, -400], 0.3);
    effects.dust(new Float32Array([0, 0, -400]), 0.2, concreteDust);
    effects.impact([0, 0, -400], 10, concreteDust);
    effects.smoulder([0, 0, -400], 0.1);
    for (let k = 0; k < 3; k++) {
      effects.update(1 / 60, view.camera);
      view.render();
    }
    smoke?.clear();
    tuning = false;
    isReady = true;
    last = performance.now();
    hud.setLoading(null);
  })();
  return readying;
}

async function tune(key: string): Promise<DeviceProfile> {
  loader.detail('Timing the physics…');
  const physicsTime = await measurePhysics(device, (share) => loader.progress(share * 0.35));
  loader.detail('Timing the drawing…');
  spawn();
  const [fx, fy] = level.focus;
  effects.explosion([fx, fy - 4, 3], 4.5);
  const dust: number[] = [];
  for (let k = 0; k < 400; k++) dust.push(fx + (Math.random() - 0.5) * 12, fy - 4 - Math.random() * 4, Math.random() * 5);
  effects.dust(Float32Array.from(dust), 0.6, concreteDust);
  const step = () => tick(last + 1000 / 60);
  for (let k = 0; k < 30; k++) step();
  const chosen = await chooseProfile(
    key,
    physicsTime,
    async (quality, resolution) => {
      loader.detail(`Timing the drawing: ${quality}${resolution < 1 ? `, ${Math.round(resolution * 100)}% resolution` : ''}…`);
      settings.quality = quality;
      view.baseResolution = resolution;
      view.setQuality(quality);
      sky.setQuality(quality);
      smoke?.setQuality(quality);
      return measureFrames(device, step);
    },
    (share) => loader.progress(0.35 + share * 0.65),
  );
  smoke?.clear();
  spawn();
  return chosen;
}

const LOADS = [1, 0.7, 0.45];
let loadStep = 0;
let fullLooseCap = 8000;
let looseCap = 8000;
function setLoad(step: number): void {
  loadStep = step;
  looseCap = Math.max(CAP_MIN, Math.round(fullLooseCap * LOADS[step]));
}
function applyProfile(p: DeviceProfile): void {
  fullLooseCap = p.looseCap;
  setLoad(loadStep);
  physics.solver.params.iterations = p.iterations;
  if (smoke) smoke.budget = p.particles;
  applySettings();
}

// ---------- frame pacing (the fork's adaptive smoke and debris budget) ----------
let frameMs = 16;
let slowFor = 0;
let quickFor = 0;
const intervals = new Float32Array(90).fill(1000 / 60);
let intervalAt = 0;
let workMs = 8;
let timingWork = false;
function timeWork(started: number): void {
  if (timingWork) return;
  timingWork = true;
  void device.queue.onSubmittedWorkDone().then(() => {
    workMs += (performance.now() - started - workMs) * 0.2;
    timingWork = false;
  });
}
function adaptSmoke(dt: number): void {
  if (!smoke) return;
  frameMs += (dt * 1000 - frameMs) * 0.12;
  intervals[intervalAt++ % intervals.length] = dt * 1000;
  const display = Math.max(1000 / 240, Math.min(...intervals));
  const slow = Math.max(15, display * 1.4);
  const slower = Math.max(12.5, display * 1.2);
  const quick = display < 12 ? frameMs < 9.5 : workMs < 10 && frameMs < display * 1.1;
  const lower: Record<Settings['quality'], Settings['quality']> = { high: 'medium', medium: 'low', low: 'low' };
  const want = frameMs > slow + 0.5 ? 'low' : frameMs > slower ? lower[settings.quality] : quick ? settings.quality : smokeLevel;
  if (want !== smokeLevel) {
    smokeLevel = want;
    smoke.setQuality(want);
  }
  slowFor = frameMs > slow ? slowFor + dt : 0;
  quickFor = quick ? quickFor + dt : 0;
  if (slowFor > 1 && loadStep < LOADS.length - 1) {
    setLoad(loadStep + 1);
    slowFor = 0;
  } else if (quickFor > 4 && loadStep > 0) {
    setLoad(loadStep - 1);
    quickFor = 0;
  }
}

// ---------- car alarms (the fork's) ----------
const alarms = {
  on: new Map<number, { alarm: NonNullable<ReturnType<Sounds['alarm']>>; until: number; at: THREE.Vector3; started: number }>(),
  dead: new Set<number>(),
  broken(i: number): boolean {
    const b = city.buildings[i];
    let body = 0;
    let gone = 0;
    for (const v of b.cells) {
      if (v < 0 || city.material[v] === Mat.Glass) continue;
      body++;
      if (city.state[v] !== 0) gone++;
    }
    return gone > body / 6;
  },
  hit(result: BlastResult): void {
    const cars = new Set<number>();
    for (const list of [result.gone, result.loose, result.falling]) for (const v of list) if (city.buildings[city.building[v]].kind === 'car') cars.add(city.building[v]);
    for (const p of result.panes) {
      const i = city.building[p.voxels[0]];
      if (city.buildings[i].kind === 'car') cars.add(i);
    }
    const now = performance.now() / 1000;
    for (const i of cars) {
      if (this.dead.has(i)) continue;
      let on = this.on.get(i);
      if (!on) {
        const alarm = sounds.alarm();
        if (!alarm) continue;
        const b = city.buildings[i];
        const at = new THREE.Vector3((b.x0 + b.w / 2) * VOXEL, (b.y0 + b.d / 2) * VOXEL, 0.8);
        on = { alarm, until: now + 20, at, started: now };
        this.on.set(i, on);
        award(300, at.toArray(), "CAR ALARM!", "big");
      }
      if (this.broken(i)) on.until = Math.min(on.until, Math.max(now + 0.05, on.started + 2.2));
    }
  },
  update(): void {
    const now = performance.now() / 1000;
    for (const [i, a] of this.on) {
      if (now > a.until) {
        a.alarm.stop();
        this.on.delete(i);
        this.dead.add(i);
        continue;
      }
      a.alarm.level(1 / (1 + player.position.distanceTo(a.at) / 12));
    }
  },
  clear(): void {
    for (const a of this.on.values()) a.alarm.stop();
    this.on.clear();
    this.dead.clear();
  },
};

// ---------- scoring ----------
const toScreen = new THREE.Vector3();
/** The highest combo banner shown in this chain. */
let comboBanner = 0;
function screenOf(at: ArrayLike<number>): [number, number] | null {
  toScreen.set(at[0], at[1], at[2]).project(view.camera);
  if (toScreen.z > 1 || Math.abs(toScreen.x) > 1.2 || Math.abs(toScreen.y) > 1.2) return null;
  return [((toScreen.x + 1) / 2) * innerWidth, ((1 - toScreen.y) / 2) * innerHeight];
}
/** Points for an event (multiplied by the combo), with a popup where it happened. */
/** Tests (?test): what was awarded under each label, before the combo (how many times, how many points). */
const scoreBy: Record<string, { n: number; points: number }> = {};
function award(points: number, at: ArrayLike<number> | null, label?: string, size: 'small' | 'big' | 'huge' = 'small', quiet = false): void {
  if (phase !== 'play' && phase !== 'grace' && phase !== 'free') return;
  if (points <= 0) return;
  if (TESTING) {
    const key = `${label ?? 'plain'}${quiet ? ' (quiet)' : ''}`;
    const row = (scoreBy[key] ??= { n: 0, points: 0 });
    row.n++;
    row.points += points;
  }
  if (quiet) {
    game.score += Math.round(points * game.combo);
    return;
  }
  const now = simTime;
  if (now - game.comboAt < 1.5) {
    const was = game.combo;
    game.combo = Math.min(5, game.combo + 0.25);
    if (Math.floor(game.combo) > Math.floor(was)) {
      sounds.blip(440 * 2 ** (Math.floor(game.combo) / 4), 0.08, 0.12);
      // A banner for a chain reaching x3 and x5, once each per chain (the meter shows the rest)
      const step = Math.floor(game.combo);
      if ((step === 3 || step === 5) && step > comboBanner) {
        comboBanner = step;
        callout(step === 5 ? 'MAX COMBO' : 'CHAIN REACTION', `COMBO x${step}`);
      }
    }
  } else {
    game.combo = 1;
    comboBanner = 0;
  }
  game.comboAt = now;
  game.bestCombo = Math.max(game.bestCombo, game.combo);
  const total = Math.round(points * game.combo);
  game.score += total;
  const s = at ? screenOf(at) : null;
  const [x, y] = s ?? [innerWidth / 2, innerHeight * 0.4];
  if (total >= 20 || label) hud.popup(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 20, label ? `${label} +${total.toLocaleString()}` : `+${total.toLocaleString()}`, size);
}
/**
 * What a blast did, scored: dust, loose, collapse, windows; the shed's losses counted against;
 * propane tanks and drums hit are lit; a big collapse rolls the replay camera.
 */
function scored(result: BlastResult, at: ArrayLike<number>, quiet = false): void {
  let pts = 0;
  let keepLost = 0;
  const weigh = (list: number[], each: number) => {
    for (const v of list) {
      const b = city.building[v];
      if (keepSet.has(b)) keepLost++;
      else pts += each;
      if (barrelSet.has(b)) light(b);
      if (gasSet.has(b) && !gasLit.has(b)) igniteGas(b, city.position.subarray(3 * v, 3 * v + 3));
    }
  };
  weigh(result.gone, 1);
  weigh(result.loose, 2);
  weigh(result.falling, 5);
  pts += result.panes.length * 250;
  game.voxelsBroken += result.gone.length + result.loose.length + result.falling.length;
  if (keepLost > 6 && (phase === 'play' || phase === 'grace')) {
    const s = screenOf(at);
    if (s) hud.popup(s[0], s[1] - 30, `${level.keepName.toUpperCase()} HIT`, 'bad');
  }
  const falling = result.falling.length;
  game.biggest = Math.max(game.biggest, falling);
  if (pts > 400 && !game.hint) {
    game.hint = 1;
    hud.hint(TOOLS[tool].hint);
  }
  const size = falling > 1500 ? 'huge' : falling > 300 || pts > 1500 ? 'big' : 'small';
  const label = falling > 1500 ? 'COLLAPSE!' : falling > 300 ? 'TOPPLED' : result.panes.length >= 3 ? 'SMASH' : undefined;
  award(pts, at, label === 'COLLAPSE!' ? undefined : label, size, quiet && falling < 300);
  if (falling > 300) {
    // The middle of what's coming down
    const c = new THREE.Vector3();
    let n = 0;
    for (let k = 0; k < falling; k += 7) {
      const v = result.falling[k];
      c.x += city.position[3 * v];
      c.y += city.position[3 * v + 1];
      c.z += city.position[3 * v + 2];
      n++;
    }
    c.divideScalar(Math.max(1, n));
    if (falling > 1200 || (falling > 500 && game.combo >= 3)) killcam(c, falling);
    // (During the replay, after its hold, so it doesn't sit over the fall itself)
    if (falling > 1500) callout('COLLAPSE!', `${falling.toLocaleString()} VOXELS`);
    if (falling > 1500) rumbleUntil = Math.max(rumbleUntil, simTime + Math.min(6, 1 + falling / 900));
    sounds.debrisTail(falling, player.position.distanceTo(c), 0.25, [c.x, c.y, c.z]);
  }
}

/** A call-out banner (short, in the top third); held back while the replay camera's slow part plays. */
let calloutDue: [string, string] | null = null;
function callout(text: string, sub: string): void {
  if (camDue || (cam.active && cam.kind === 'kill' && cam.t < cam.hold)) calloutDue = [text, sub];
  else hud.banner(text, sub, true);
}

/** Char the standing voxels within `radius` of `at`: `amount` at the middle, fading out, each kept with chance `dither`. */
function charAround(at: ArrayLike<number>, radius: number, amount: number, dither = 1, falloff = 1): void {
  if (!physics) return;
  const bodies: number[] = [];
  const amounts: number[] = [];
  for (const v of within(city, at, radius)) {
    if (Math.random() > dither) continue;
    const d = Math.hypot(city.position[3 * v] - at[0], city.position[3 * v + 1] - at[1], city.position[3 * v + 2] - at[2]);
    bodies.push(physics.body[v]);
    amounts.push(amount * Math.max(0, 1 - d / radius) ** falloff);
  }
  view.char(bodies, amounts);
}

// ---------- propane tanks and drums ----------
const fuses: { due: number; at: THREE.Vector3; object: number; scale: number }[] = [];
function light(b: number): void {
  if (barrelLit.has(b)) return;
  barrelLit.add(b);
  const o = city.buildings[b];
  const at = new THREE.Vector3((o.x0 + o.w / 2) * VOXEL, (o.y0 + o.d / 2) * VOXEL, Math.min(1.5, (o.h * VOXEL) / 2));
  // A bigger tank (the fuel tanker) goes up bigger
  let n = 0;
  for (const c of o.cells) if (c >= 0) n++;
  const scale = Math.max(1, Math.min(1.9, Math.sqrt(n / 70)));
  fuses.push({ due: simTime + 0.12 + Math.random() * 0.22, at, object: b, scale });
  effects.sparks(at.toArray(), 12, 5);
}

// ---------- fire 2.0: timber, fabric and plastic, hedges and trees burn, char, spread and smoke you can't see through ----------
const fires: { at: THREE.Vector3; until: number; next: number }[] = [];
const MAX_FIRES = 48;
/** What burns, and how readily (the chance it catches from a neighbour). */
const FLAMMABLE: Partial<Record<number, number>> = { [Mat.Wood]: 1, [Mat.Plastic]: 1.3, [Mat.Leaf]: 0.8 };
function ignite(at: THREE.Vector3, radius: number): void {
  const fuel = within(city, at.toArray(), radius).filter((v) => FLAMMABLE[city.material[v]] !== undefined);
  for (let k = 0; k < Math.min(5, fuel.length); k++) {
    if (fires.length >= MAX_FIRES) return;
    const v = fuel[Math.floor(Math.random() * fuel.length)];
    if (Math.random() > (FLAMMABLE[city.material[v]] ?? 0)) continue;
    const p = new THREE.Vector3(city.position[3 * v], city.position[3 * v + 1], city.position[3 * v + 2]);
    if (fires.some((f) => f.at.distanceToSquared(p) < 0.8)) continue;
    fires.push({ at: p, until: simTime + 7 + Math.random() * 6, next: simTime + 0.5 + Math.random() * 0.7 });
    // Thick, dark smoke from a building fire (plastic blackest)
    effects.smoulder(p.toArray(), 11, city.material[v] === Mat.Plastic ? 3 : 2);
  }
}
function burn(): void {
  for (let k = fires.length - 1; k >= 0; k--) {
    const f = fires[k];
    if (simTime > f.until) {
      fires.splice(k, 1);
      continue;
    }
    // In the sea: out, with a hiss and a puff of steam
    if (sea && physics.inWater(f.at.x, f.at.y, f.at.z - 0.15)) {
      fires.splice(k, 1);
      effects.impact(f.at.toArray(), 5, steamTint);
      sounds.splash(0.3, player.position.distanceTo(f.at), [f.at.x, f.at.y, f.at.z]);
      continue;
    }
    if (simTime < f.next) continue;
    f.next = simTime + 0.7 + Math.random() * 0.6;
    // Timber chars as it burns (black in about 3 s), and only some of the charred wood burns away
    const wood = within(city, f.at.toArray(), 0.6).filter((v) => FLAMMABLE[city.material[v]] !== undefined);
    const bodies = wood.map((v) => physics.body[v]);
    view.char(
      bodies,
      bodies.map((b) => view.charOf(b) + 0.3),
    );
    // (A third of the fully charred voxels burn through each time: the rest stay, black)
    const hits: Hit[] = wood.filter((_, i) => view.charOf(bodies[i]) >= 0.95 && Math.random() < 0.35).slice(0, 4).map((v) => ({ at: Array.from(city.position.subarray(3 * v, 3 * v + 3)), radius: VOXEL * 0.6, push: 0.6, core: 1, only: city.material[v] }));
    if (hits.length) {
      const result = blasts(city, structure, physics, hits);
      unsettled = true;
      effects.sparks(f.at.toArray(), 3, 2);
      scored(result, f.at.toArray(), true);
      if (result.falling.length > 30) sounds.play('hit_wood', 0.45, player.position.distanceTo(f.at), { rate: 0.8, at: [f.at.x, f.at.y, f.at.z] });
    }
    // Spread: up and sideways mostly, to what burns next to it (fire climbs: up more often than down)
    if (fires.length < MAX_FIRES && Math.random() < 0.7) ignite(f.at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 1.8, Math.random() * 1.4 - 0.2)), 0.7);
    // Gas lines and pipe bombs it reaches go
    for (const b of pipeBombs) if (b.p.distanceTo(f.at) < 0.8) b.fuse = Math.min(b.fuse, 0.3);
    // Fire under a charge or a tank sets it off
    for (const c of placed) if (c.mesh.position.distanceTo(f.at) < 1) c.due = Math.min(c.due, simTime + 0.2);
    for (const b of barrelSet) {
      if (barrelLit.has(b)) continue;
      const o = city.buildings[b];
      if (Math.hypot((o.x0 + o.w / 2) * VOXEL - f.at.x, (o.y0 + o.d / 2) * VOXEL - f.at.y) < 1.4) light(b);
    }
  }
}

// ---------- the tools ----------
let cooldown = 0;
let sledgeCharge = 0;
const eye = new THREE.Vector3();
const dir = new THREE.Vector3();
/** Camera trauma (0..1): blows add to it, it falls by 1 a second, the shake is its square. */
let trauma = 0;
const addTrauma = (x: number) => {
  trauma = Math.min(1, trauma + Math.max(0, x));
};
/** The ground rumbling under a big collapse (world clock, s): a slow shake on pitch alone. */
let rumbleUntil = 0;
/** The first charge of a ripple gets the hit-stop; the rest within 300 ms don't. */
let lastChargeStop = -10;
let hitstop = 0;
let fovKick = 0;
let fovVel = 0;
let pulse = 0;
let dip = 0;
let dustiness = 0;

/** Where the crosshair meets something within `reach` (and the voxel, -1 for the ground). */
function aim(reach: number): { t: number; voxel: number; normal: [number, number, number]; debris?: 'rubble' | 'loose' | 'section'; slot?: number } | null {
  player.eye(eye);
  player.look(dir);
  const hit = raycast(city, eye.toArray(), dir.toArray(), reach);
  const d = debrisRay(eye, dir, hit ? hit.t : reach);
  return d ?? hit;
}
/**
 * The first debris along a ray before `far` (m): settled rubble, loose voxels, or a piece still falling whole.
 * The world's raycast sees only what still stands, so the tools passed straight through heaps and falling
 * storeys: the rest of a wrecked building seemed unbreakable. Marched in 12 cm steps.
 */
function debrisRay(o: THREE.Vector3, d: THREE.Vector3, far: number, withLoose = true): { t: number; voxel: number; normal: [number, number, number]; debris: 'rubble' | 'loose' | 'section'; slot?: number } | null {
  if (!physics || (physics.rubble.size === 0 && physics.loose === 0 && physics.sections.size === 0)) return null;
  const normal: [number, number, number] = [-d.x, -d.y, -d.z];
  for (let t = 0.3; t < Math.min(far, 120); t += 0.12) {
    const [x, y, z] = [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t];
    if (z < -0.2) return null;
    const r = physics.rubbleAt(x, y, z);
    if (r >= 0) return { t, voxel: r, normal, debris: 'rubble' };
    const loose = withLoose ? lastLooseCells.get(cellOf(x, y, z)) : undefined;
    if (loose && loose.length) return { t, voxel: loose[0], normal, debris: 'loose' };
    if (physics.sections.size) {
      const slot = physics.sectionAt(x, y, z);
      if (slot >= 0) return { t, voxel: physics.sections.get(slot)!.voxels[0], normal, debris: 'section', slot };
    }
  }
  return null;
}
/** A tool's blow landing on debris: a piece falling whole breaks there; heaps and loose bits are thrown. */
function hitDebris(at: THREE.Vector3, slot: number | undefined, radius: number, push: number): void {
  if (slot !== undefined) {
    const sec = physics.sections.get(slot);
    if (sec) {
      const low = physics.shatter(slot, sec.pose, sec.velocity, 0.5);
      if (low.length) effects.dust(low, 0.4, concreteDust);
      unsettled = true;
    }
  }
  physics.blast(at.toArray(), radius * 1.8, push);
  unsettled = true;
}
/** Which way pieces should tip after a hit from the player (horizontal, unit). */
function away(at: THREE.Vector3): number[] {
  const d = new THREE.Vector2(at.x - player.position.x, at.y - player.position.y);
  if (d.lengthSq() < 1e-4) d.set(Math.cos(player.yaw), Math.sin(player.yaw));
  d.normalize();
  return [d.x, d.y];
}

function useTool(): void {
  const t = TOOLS[tool];
  if (tool === CANNON) {
    fireCannon();
    return;
  }
  if (tool === CHARGE || tool === CUTTER) {
    placeCharge(tool === CUTTER ? 'cutter' : 'charge');
    return;
  }
  if (tool === ROCKET) {
    fireRocket();
    return;
  }
  if (tool === PIPE) {
    throwPipe();
    return;
  }
  if (tool === PLANK || tool === CABLE) {
    rigClick(tool === PLANK ? 'plank' : 'cable');
    return;
  }
  void t;
}

// ---------- planks and cables (rigging.ts) ----------
let planks: Plank[] = [];
let cables: Cable[] = [];
/** The first click of a plank or a cable: where, and what holds it. */
let rigStart: { kind: 'plank' | 'cable'; at: THREE.Vector3; hold: number; anchor: Anchor } | null = null;
const previewMat = new THREE.MeshBasicMaterial({ color: 0x60ff90, transparent: true, opacity: 0.45, depthWrite: false });
const previewMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previewMat);
previewMesh.visible = false;
view.scene.add(previewMesh);
/** Strength of an anchor (kN) by the hardness of what it's set in: past it the cable tears it out. */
const HOLDS = [25, 60, 180, Infinity];
/** What a machine pulls with (kN) before it stalls against a cable that holds. */
const PULL = { excavator: 150, crane: 200 };

/** Where the crosshair puts a rigging end: a machine's part near the line of sight, else what it meets. */
function rigTarget(kind: 'plank' | 'cable'): { at: THREE.Vector3; hold: number; anchor: Anchor } | null {
  player.eye(eye);
  player.look(dir);
  const reach = TOOLS[kind === 'plank' ? PLANK : CABLE].reach;
  if (kind === 'cable') {
    // A machine's bucket, hitch or ball within a metre and a half of the line of sight
    let best: { at: THREE.Vector3; anchor: Anchor } | null = null;
    let bestD = 1.5;
    machines.forEach((m, i) => {
      const parts: [Anchor & { kind: 'machine' }, THREE.Vector3][] = m instanceof Crane ? [[{ kind: 'machine', m: i, part: 'ball' }, m.ball.clone()]] : [
        [{ kind: 'machine', m: i, part: 'bucket' }, m.bucketAt.clone()],
        [{ kind: 'machine', m: i, part: 'hitch' }, machinePoint(m, 'hitch')],
      ];
      for (const [anchor, p] of parts) {
        const t = p.clone().sub(eye).dot(dir);
        if (t < 0 || t > reach) continue;
        const d = eye.clone().addScaledVector(dir, t).distanceTo(p);
        if (d < bestD) [best, bestD] = [{ at: p, anchor }, d];
      }
    });
    if (best) return { ...(best as { at: THREE.Vector3; anchor: Anchor }), hold: -2 };
  }
  const hit = aim(reach);
  if (!hit) return null;
  const at = eye.clone().addScaledVector(dir, hit.t).addScaledVector(new THREE.Vector3(...hit.normal), kind === 'plank' ? PLANK_T / 2 + 0.02 : 0.05);
  if (hit.voxel < 0) return { at, hold: -1, anchor: { kind: 'ground', at: at.toArray() as [number, number, number] } };
  const v = hit.voxel;
  const c = city.state[v] === State.Rubble ? [physics.rest[7 * v], physics.rest[7 * v + 1], physics.rest[7 * v + 2]] : city.state[v] === State.Fixed ? Array.from(city.position.subarray(3 * v, 3 * v + 3)) : [livePos[3 * v], livePos[3 * v + 1], livePos[3 * v + 2]];
  return { at, hold: city.state[v] === State.Fixed ? v : -1, anchor: { kind: 'voxel', v, offset: [at.x - c[0], at.y - c[1], at.z - c[2]] } };
}

/** A machine's anchor points: the excavator's hitch (its tail) and bucket, the crane's hook. */
function machinePoint(m: Machine, part: 'bucket' | 'hitch' | 'ball'): THREE.Vector3 {
  if (m instanceof Crane) return m.ball.clone().add(new THREE.Vector3(0, 0, 1.1));
  if (part === 'bucket') return m.bucketAt.clone();
  return new THREE.Vector3(m.position.x - Math.cos(m.heading) * 2.45, m.position.y - Math.sin(m.heading) * 2.45, 0.9);
}

/** Where an anchor is now (null: it's gone). */
function anchorAt(a: Anchor): THREE.Vector3 | null {
  if (a.kind === 'ground' || a.kind === 'none') return new THREE.Vector3(...a.at);
  if (a.kind === 'machine') {
    const m = machines[a.m];
    return m ? machinePoint(m, a.part) : null;
  }
  const v = a.v;
  const st = city.state[v];
  if (st === State.Gone) return null;
  const c = st === State.Rubble ? [physics.rest[7 * v], physics.rest[7 * v + 1], physics.rest[7 * v + 2]] : st === State.Fixed ? [city.position[3 * v], city.position[3 * v + 1], city.position[3 * v + 2]] : [livePos[3 * v], livePos[3 * v + 1], livePos[3 * v + 2]];
  const o = st === State.Fixed ? a.offset : [0, 0, 0];
  return new THREE.Vector3(c[0] + o[0], c[1] + o[1], c[2] + o[2]);
}

/** The first click sets the start; the second lays the plank or the cable (if it's in reach and not too long). */
function rigClick(kind: 'plank' | 'cable'): void {
  const left = kind === 'plank' ? game.planks : game.cables;
  if (left <= 0 && !unlimited()) {
    hud.toast(kind === 'plank' ? 'Out of planks' : 'Out of cables');
    return;
  }
  const t = rigTarget(kind);
  if (!t) {
    hud.toast('Nothing there to fix it to');
    return;
  }
  if (!rigStart || rigStart.kind !== kind) {
    rigStart = { kind, ...t };
    sounds.play('clack', 0.3, 0, { rate: 1.2 });
    hud.hint(kind === 'plank' ? '<b>Click</b> where the other end goes' : '<b>Click</b> what the other end ties to');
    return;
  }
  const len = rigStart.at.distanceTo(t.at);
  const max = kind === 'plank' ? PLANK_MAX : CABLE_MAX;
  if (len > max || len < 0.6) {
    hud.toast(len > max ? `Too long: ${kind === 'plank' ? 'a plank' : 'a cable'} reaches ${max} m` : 'Too short');
    return;
  }
  if (kind === 'plank') layPlank(rigStart.at, t.at, rigStart.hold, t.hold);
  else tieCable(rigStart.anchor, t.anchor, rigStart.at, t.at);
  if (!unlimited()) {
    if (kind === 'plank') game.planks--;
    else game.cables--;
  }
  rigStart = null;
  previewMesh.visible = false;
  hud.hint('');
}

function layPlank(a: THREE.Vector3, b: THREE.Vector3, holdA: number, holdB: number): Plank {
  const p = new Plank(a, b, holdA, holdB);
  view.scene.add(p.object);
  view.sunOnly(p.object);
  p.slot = physics.vehicle([p.length, PLANK_W, PLANK_T], p.middle.toArray());
  if (p.slot >= 0) {
    const q = p.quaternion;
    physics.drive(p.slot, p.middle.toArray(), [q.x, q.y, q.z, q.w], [0, 0, 0], [0, 0, 0]);
  }
  planks.push(p);
  sounds.play('wood_M', 0.5, player.position.distanceTo(p.middle), { at: [p.middle.x, p.middle.y, p.middle.z] });
  return p;
}

function tieCable(a: Anchor, b: Anchor, pa: THREE.Vector3, pb: THREE.Vector3): Cable {
  const c = new Cable(a, b, pa, pb);
  view.scene.add(c.object);
  view.sunOnly(c.object);
  cables.push(c);
  sounds.play('metal_S', 0.4, 0, { rate: 0.9 });
  return c;
}

/** A plank broken (a blast, or what fell on it): gone in splinters. */
function breakPlank(p: Plank): void {
  p.broken = true;
  p.object.removeFromParent();
  physics.release(p.slot);
  p.slot = -1;
  const m = p.middle;
  effects.impact(m.toArray(), 6, dustTint[Mat.Wood]);
  sounds.play('wood_M', 0.7, player.position.distanceTo(m), { at: [m.x, m.y, m.z] });
}

/** Clear the lot's planks and cables (a new world). */
function setupRigging(): void {
  for (const p of planks) p.object.removeFromParent();
  for (const c of cables) c.object.removeFromParent();
  planks = [];
  cables = [];
  rigStart = null;
  previewMesh.visible = false;
}

/** A blast breaks the planks it reaches and cuts the cables it catches. */
function rigBlast(hits: { at: ArrayLike<number>; radius?: number }[]): void {
  if (!planks.length && !cables.length) return;
  for (const h of hits) {
    const at = new THREE.Vector3(h.at[0], h.at[1], h.at[2]);
    const r = (h.radius ?? 1.2) * 0.8;
    for (const p of planks) {
      if (p.broken) continue;
      const seg = new THREE.Line3(p.a, p.b);
      if (seg.closestPointToPoint(at, true, new THREE.Vector3()).distanceTo(at) < r + 0.2) breakPlank(p);
    }
    for (const c of cables) if (!c.cut && r > 0.9 && c.distanceTo(at) < r * 0.6) cutCable(c);
  }
  planks = planks.filter((p) => !p.broken);
}

function cutCable(c: Cable): void {
  c.cut = true;
  for (const [k, e] of c.ends.entries()) {
    const at = anchorAt(e) ?? c.points[k === 0 ? 0 : c.points.length - 1];
    if (e.kind === 'machine') c.ends[k] = { kind: 'none', at: [at.x, at.y, 0.05] };
  }
  sounds.play('metal_S', 0.6, 0, { rate: 1.3 });
}

/** The rigging each frame: planks settle on what holds them; cables pull, tear their anchors out, drag what came loose. */
function updateRigging(dt: number, before: Map<Machine, unknown>): void {
  const rubbleAt = (x: number, y: number, z: number) => physics.rubbleAt(x, y, z) >= 0;
  for (const p of planks) {
    if (p.update(dt, city, rubbleAt) && p.slot >= 0) {
      const q = p.quaternion;
      physics.drive(p.slot, p.middle.toArray(), [q.x, q.y, q.z, q.w], [0, 0, 0], [0, 0, 0]);
    }
  }
  for (const c of cables) {
    let pa = anchorAt(c.ends[0]);
    let pb = anchorAt(c.ends[1]);
    // An end whose voxel went (blown to dust): it drops loose
    for (const k of [0, 1]) {
      if ((k === 0 ? pa : pb) !== null) continue;
      const last = c.points[k === 0 ? 0 : c.points.length - 1];
      c.ends[k] = { kind: 'none', at: [last.x, last.y, Math.max(0.05, last.z)] };
    }
    pa ??= anchorAt(c.ends[0]) as THREE.Vector3;
    pb ??= anchorAt(c.ends[1]) as THREE.Vector3;
    // A loose end falls to the ground
    for (const e of c.ends) if (e.kind === 'none' && e.at[2] > 0.05) e.at[2] = Math.max(0.05, e.at[2] - 6 * dt);
    c.update(dt, pa, pb);
    const machineEnd = c.ends.findIndex((e) => e.kind === 'machine');
    if (machineEnd < 0 || c.cut || c.tension <= 0) continue;
    const other = c.ends[1 - machineEnd];
    const m = machines[(c.ends[machineEnd] as { m: number }).m];
    const from = machineEnd === 0 ? pa : pb;
    const to = machineEnd === 0 ? pb : pa;
    const pull = from.clone().sub(to).normalize();
    const kN = c.tension * 5;
    if (other.kind === 'voxel') {
      const v = other.v;
      const st = city.state[v];
      if (st === State.Fixed) {
        const hold = HOLDS[TIER[city.material[v] as Mat]] ?? 60;
        if (kN > hold) tearAnchor(c, 1 - machineEnd, to, pull);
        else if (kN > (m instanceof Crane ? PULL.crane : PULL.excavator)) restrain(m, before.get(m), to, c.rest, machineEnd === 0 ? pa : pb);
      } else {
        // Dragging what came loose: a tug toward the machine
        if (tugIn <= 0) {
          physics.blast(to.clone().addScaledVector(pull, -0.8).toArray(), 1.3, Math.min(7, 2 + c.tension * 6), 0.8, 1.5);
          unsettled = true;
        }
      }
    } else if (other.kind === 'ground') {
      if (kN > PULL.excavator) restrain(m, before.get(m), to, c.rest, from);
    }
  }
  tugIn = tugIn <= 0 ? 0.1 : tugIn - dt;
}
let tugIn = 0;

/** The cable holds and the machine can't pull harder: it stops where it was (and strains). */
function restrain(m: Machine | undefined, snap: unknown, anchor: THREE.Vector3, rest: number, end: THREE.Vector3): void {
  if (!m) return;
  if (m instanceof Excavator) {
    if (snap) m.restore(snap as ReturnType<Excavator['snapshot']>);
    m.strain = 1;
  } else {
    // The crane's ball swings on the cable about the anchor
    const d = m.ball.clone().sub(anchor);
    const over = end.distanceTo(anchor) - rest;
    if (over > 0) {
      d.normalize();
      m.ball.addScaledVector(d, -over);
      const out = m.ballVel.dot(d);
      if (out > 0) m.ballVel.addScaledVector(d, -out);
    }
  }
}

/** Past what it holds: the anchor torn out toward the pull, and the cable left on what came loose (or deeper in). */
function tearAnchor(c: Cable, end: number, at: THREE.Vector3, pull: THREE.Vector3): void {
  const hits: Hit[] = [{ at: at.toArray(), radius: 0.8, radii: [0.75, 0.6, 0.35], push: 3.5, core: 0.15, topple: [pull.x, pull.y] }];
  const result = blasts(city, structure, physics, hits);
  unsettled = true;
  afterBlast(result, hits);
  const near = (list: number[]) =>
    list
      .map((v) => [v, Math.hypot(city.position[3 * v] - at.x, city.position[3 * v + 1] - at.y, city.position[3 * v + 2] - at.z)] as [number, number])
      .filter(([, d]) => d < 1.2)
      .sort((a, b) => a[1] - b[1]);
  const loose = near([...result.loose, ...result.falling]);
  const deeper = near(within(city, at.toArray(), 0.9));
  const pick = loose[0]?.[0] ?? deeper[0]?.[0];
  c.ends[end] = pick !== undefined ? { kind: 'voxel', v: pick, offset: [0, 0, 0] } : { kind: 'none', at: at.toArray() as [number, number, number] };
  // The machine's pull carries on into the next bite
  c.rest = Math.max(0.5, c.rest + 0.15);
  const struck = result.gone[0] ?? result.loose[0];
  sounds.impact(struck === undefined ? 'brick' : Sounds.material(city.material[struck]), 0.6, player.position.distanceTo(at), result.gone.length + result.loose.length, [at.x, at.y, at.z]);
  sounds.play('metal_M', 0.5, player.position.distanceTo(at), { rate: 1.2, at: [at.x, at.y, at.z] });
  chips.burst(result.loose, at.toArray(), 1, 4);
  effects.impact(at.toArray(), 6, tintOf(result.gone[0]));
  addTrauma(0.12);
  scored(result, at.toArray());
  rigStats.tears++;
  rigStats.torn += result.gone.length + result.loose.length;
}
const rigStats = { tears: 0, torn: 0 };

/** The preview of the second click: green if it fits, red if not. */
function rigPreview(): void {
  if (!rigStart || (tool !== PLANK && tool !== CABLE) || riding) {
    previewMesh.visible = false;
    return;
  }
  const t = rigTarget(rigStart.kind);
  if (!t) {
    previewMesh.visible = false;
    return;
  }
  const len = rigStart.at.distanceTo(t.at);
  const ok = len <= (rigStart.kind === 'plank' ? PLANK_MAX : CABLE_MAX) && len >= 0.6;
  previewMat.color.set(ok ? 0x60ff90 : 0xff4030);
  previewMesh.visible = true;
  previewMesh.position.copy(rigStart.at).lerp(t.at, 0.5);
  previewMesh.lookAt(t.at);
  previewMesh.scale.set(rigStart.kind === 'plank' ? PLANK_W : 0.06, rigStart.kind === 'plank' ? PLANK_T : 0.06, Math.max(0.01, len));
}

// ---------- the sandbox: the spawn menu and the time of day ----------
let spawnOpen = false;
let spawnUsed: Record<string, number> = {};
const HOURS = [7.5, 10, 13, 15.5, 17.4, 18.6, 19.3];
let dayHour = 17.4;
/** Move a waiting prop of `kind` from the pool onto the lot where the crosshair meets the ground or a roof. */
function spawnProp(kind: string): void {
  const pool = level.pool?.[kind] ?? [];
  const used = spawnUsed[kind] ?? 0;
  if (used >= pool.length) {
    hud.toast(`No more ${kind === 'bottles' ? 'gas bottles' : `${kind}s`} to spawn here`);
    return;
  }
  const b = pool[used];
  player.eye(eye);
  player.look(dir);
  const hit = raycast(city, eye.toArray(), dir.toArray(), 40);
  let t = hit ? hit.t : 40;
  if (dir.z < -0.01) t = Math.min(t, -eye.z / dir.z);
  const at = eye.clone().addScaledVector(dir, Math.max(2.5, t - 0.8));
  if (!moveObject(b, at.x, at.y)) {
    hud.toast('Can’t put it there');
    return;
  }
  spawnUsed[kind] = used + 1;
  sounds.play('clack', 0.4, 0, { rate: 0.8 });
  effects.impact([at.x, at.y, 0.3], 4, concreteDust);
}
/** Move object `b` (all of it standing) so its middle is at (x, y) on the ground. False if any of it has moved or broken. */
function moveObject(b: number, x: number, y: number): boolean {
  const o = city.buildings[b];
  const voxels: number[] = [];
  for (const v of o.cells) if (v >= 0) voxels.push(v);
  if (voxels.some((v) => city.state[v] !== State.Fixed)) return false;
  const dx = Math.round(x / VOXEL - (o.x0 + o.w / 2));
  const dy = Math.round(y / VOXEL - (o.y0 + o.d / 2));
  o.x0 += dx;
  o.y0 += dy;
  for (const v of voxels) {
    city.position[3 * v] += dx * VOXEL;
    city.position[3 * v + 1] += dy * VOXEL;
    livePos[3 * v] = city.position[3 * v];
    livePos[3 * v + 1] = city.position[3 * v + 1];
    homePos[3 * v] = city.position[3 * v];
    homePos[3 * v + 1] = city.position[3 * v + 1];
  }
  for (const p of city.panes) {
    if (!p.voxels.length || city.building[p.voxels[0]] !== b) continue;
    p.centre[0] += dx * VOXEL;
    p.centre[1] += dy * VOXEL;
  }
  resetColumns(city);
  physics.moveFixed(voxels);
  view.setPaints(city, physics.voxelOf);
  return true;
}
/** The time of day (h): the sun round the sky and up or down with it. */
function setDayHour(h: number): void {
  const day = (h - 6) / 13.5;
  level.sunAz = Math.PI * (0.2 - day * 1.15);
  level.sunEl = Math.max(4, Math.sin(Math.PI * day) * 62);
  setSun(h);
}

// ---------- pipe bombs ----------
const pipeGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.3, 10);
const pipeMat = new THREE.MeshStandardMaterial({ color: 0x5a5e62, roughness: 0.45, metalness: 0.7 });
const capMat = new THREE.MeshStandardMaterial({ color: 0x8a2a1c, roughness: 0.5 });
const capGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 10);
/** Explosions so far (tests), and clumps the jackhammer broke out. */
let explosions = 0;
let jackBreaks = 0;
const pipeBombs: { mesh: THREE.Group; p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; fuse: number; spark: number }[] = [];
function pipeMesh(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(pipeGeo, pipeMat));
  for (const y of [-0.16, 0.16]) {
    const c = new THREE.Mesh(capGeo, capMat);
    c.position.y = y;
    g.add(c);
  }
  return g;
}
/** A pipe bomb thrown where the player looks: it flies, bounces and rolls, the fuse fizzing, and goes in three seconds. */
function throwPipe(): void {
  if (game.pipes <= 0 && !unlimited()) {
    hud.toast('Out of pipe bombs');
    sounds.click();
    return;
  }
  if (!unlimited()) game.pipes--;
  player.eye(eye);
  player.look(dir);
  const mesh = pipeMesh();
  const p = eye.clone().addScaledVector(dir, 0.7);
  mesh.position.copy(p);
  view.scene.add(mesh);
  const v = dir.clone().multiplyScalar(14).add(new THREE.Vector3(0, 0, 3)).add(player.velocity);
  pipeBombs.push({ mesh, p, v, spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6), fuse: 3, spark: 0 });
  hand.place();
  sounds.swing(0.6);
  sounds.blip(3200, 0.03, 0.2, 'sawtooth');
}
function updatePipes(dt: number): void {
  for (let k = pipeBombs.length - 1; k >= 0; k--) {
    const b = pipeBombs[k];
    b.fuse -= dt;
    if (b.fuse <= 0) {
      pipeBombs.splice(k, 1);
      b.mesh.removeFromParent();
      explode(b.p.clone().setZ(Math.max(0.3, b.p.z)), RADII.pipe[0], 9, { radii: RADII.pipe, fire: 0.8, topple: away(b.p) });
      continue;
    }
    b.v.z -= 9.81 * dt;
    const step = b.v.clone().multiplyScalar(dt);
    const len = step.length();
    if (len > 1e-5) {
      const unit = step.clone().normalize();
      const hit = raycast(city, b.p.toArray(), unit.toArray(), len + 0.06);
      if (hit && hit.voxel >= 0) {
        // Off a wall: bounce, losing most of it
        const n = new THREE.Vector3(...hit.normal);
        b.p.addScaledVector(unit, Math.max(0, hit.t - 0.06));
        b.v.addScaledVector(n, -2 * b.v.dot(n)).multiplyScalar(0.35);
        b.spin.multiplyScalar(0.6);
        if (b.v.length() > 2) sounds.play('clack', 0.25, player.position.distanceTo(b.p), { rate: 1.6, at: [b.p.x, b.p.y, b.p.z] });
      } else b.p.add(step);
    }
    if (b.p.z < 0.06) {
      b.p.z = 0.06;
      if (b.v.z < -1.5) sounds.play('clack', 0.2, player.position.distanceTo(b.p), { rate: 1.8, at: [b.p.x, b.p.y, b.p.z] });
      b.v.z = Math.abs(b.v.z) * 0.3;
      b.v.x *= 0.7;
      b.v.y *= 0.7;
      b.spin.multiplyScalar(0.7);
    }
    b.mesh.position.copy(b.p);
    b.mesh.rotation.x += b.spin.x * dt;
    b.mesh.rotation.y += b.spin.y * dt;
    b.mesh.rotation.z += b.spin.z * dt;
    b.spark -= dt;
    if (b.spark <= 0) {
      b.spark = 0.07;
      effects.sparks([b.p.x, b.p.y, b.p.z + 0.12], 2, 1.5);
    }
  }
}
/** Sandbox and free play: every tool without limit. */
const unlimited = () => mode === 'sandbox' || phase === 'free';

// ---------- gas lines: break one and the fire runs along it, blowing as it goes ----------
const gasLit = new Set<number>();
const gasBlasts: { due: number; at: THREE.Vector3 }[] = [];
function igniteGas(b: number, from: ArrayLike<number>): void {
  if (gasLit.has(b)) return;
  gasLit.add(b);
  const o = city.buildings[b];
  const points: THREE.Vector3[] = [];
  for (let c = 0; c < o.cells.length; c++) {
    const v = o.cells[c];
    if (v < 0) continue;
    const p = new THREE.Vector3(city.position[3 * v], city.position[3 * v + 1], city.position[3 * v + 2]);
    // A blast every 1.8 m along it
    if (points.every((q) => q.distanceToSquared(p) > 1.8 * 1.8)) points.push(p);
  }
  const start = new THREE.Vector3(from[0], from[1], from[2]);
  effects.smoulder(start.toArray(), 1.5, 3);
  effects.sparks(start.toArray(), 30, 6);
  sounds.gasJet([start.x, start.y, start.z]);
  hud.toast('Gas line ruptured!');
  for (const p of points) gasBlasts.push({ due: simTime + 0.5 + p.distanceTo(start) * 0.07, at: p.setZ(Math.max(0.4, p.z)) });
}
function gasDue(): void {
  for (let k = gasBlasts.length - 1; k >= 0; k--) {
    if (gasBlasts[k].due > simTime) continue;
    const [g] = gasBlasts.splice(k, 1);
    explode(g.at, RADII.gas[0], 8, { radii: RADII.gas, fire: 1.4, sample: 'propane', chain: true });
  }
}

// ---------- the rocket launcher ----------
const rocketGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 10);
rocketGeo.rotateX(Math.PI / 2);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x4f5a34, roughness: 0.6, emissive: 0xff7020, emissiveIntensity: 0 });
const rockets: { mesh: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; trail: number; life: number }[] = [];
/** A rocket: fast, flat, a smoke trail; it bursts on the first thing it meets, standing or fallen. */
function fireRocket(): void {
  if (game.rockets <= 0 && phase !== 'free') {
    hud.toast('Out of rockets');
    sounds.click();
    return;
  }
  if (phase !== 'free') game.rockets--;
  player.eye(eye);
  player.look(dir);
  const p = eye.clone().addScaledVector(dir, 1.2).add(new THREE.Vector3(0, 0, -0.1));
  const mesh = new THREE.Mesh(rocketGeo, rocketMat);
  mesh.position.copy(p);
  mesh.lookAt(p.clone().add(dir));
  view.scene.add(mesh);
  rockets.push({ mesh, p, v: dir.clone().multiplyScalar(38), trail: 0, life: 6 });
  hand.fire();
  hud.kick();
  addTrauma(0.22);
  sounds.rocket();
  effects.impact(eye.clone().addScaledVector(dir, -0.6).toArray(), 7, smokeTint);
  view.flashLight(p.toArray(), 60 * LIGHT_SCALE, 0.08, 'flash', 8);
}
function updateRockets(dt: number): void {
  for (let k = rockets.length - 1; k >= 0; k--) {
    const r = rockets[k];
    r.life -= dt;
    r.v.z -= 2 * dt;
    const step = r.v.clone().multiplyScalar(dt);
    const len = step.length();
    const unit = step.clone().normalize();
    const hit = raycast(city, r.p.toArray(), unit.toArray(), len + 0.3);
    const deb = debrisRay(r.p, unit, hit ? hit.t : len + 0.3, true);
    const t = deb ? deb.t : hit ? hit.t : -1;
    const ground = r.p.z + step.z < 0.1;
    if (t >= 0 || ground || r.life <= 0) {
      const at = t >= 0 ? r.p.clone().addScaledVector(unit, t) : r.p.clone().add(step);
      at.z = Math.max(0.2, at.z);
      r.mesh.removeFromParent();
      rockets.splice(k, 1);
      explode(at, RADII.rocket[0], 11, { radii: RADII.rocket, fire: 0.8, topple: away(at) });
      continue;
    }
    r.p.add(step);
    r.mesh.position.copy(r.p);
    r.mesh.lookAt(r.p.clone().add(r.v));
    r.trail -= dt;
    if (r.trail <= 0) {
      r.trail = 0.035;
      effects.impact(r.p.clone().addScaledVector(unit, -0.5).toArray(), 2.5, smokeTint);
      effects.sparks(r.p.clone().addScaledVector(unit, -0.4).toArray(), 2, 2);
    }
  }
}

// ---------- the jackhammer ----------
let jackAt = 0;
let jackBounce = 0;
/** One bite of the jackhammer where the crosshair meets something within reach. */
function jackHit(): void {
  const hit = aim(TOOLS[JACK].reach);
  if (!hit || hit.voxel < 0) {
    jackWork = Math.max(0, jackWork - 1);
    return;
  }
  const n = new THREE.Vector3(...hit.normal);
  const at = eye.clone().addScaledVector(dir, hit.t).addScaledVector(n, -0.12);
  const mat = city.material[hit.voxel];
  if (hit.debris) hitDebris(at, hit.slot, 0.45, 3);
  // Working the same spot builds up: every bite there fills the ring, and the sixth breaks a whole clump out
  if (jackSpot.distanceTo(at) > 0.8) jackWork = 0;
  jackSpot.copy(at);
  jackWork++;
  const through = jackWork >= JACK_BREAK;
  const radii: [number, number, number] = through ? [1.0, 0.85, 0] : RADII.jack;
  const result = blasts(city, structure, physics, [{ at: at.toArray(), radius: radii[0], radii, push: through ? 5 : 2.5, core: through ? 0.3 : 0.45, topple: through ? away(at) : undefined }]);
  unsettled = true;
  afterBlast(result, [{ at: at.toArray() }]);
  const broke = result.gone.length + result.loose.length;
  hand.jolt(through ? 0.6 : 0.16);
  addTrauma(through ? 0.3 : 0.06);
  if (!broke && !hit.debris && TIER[mat as Mat] > 1) {
    jackWork = 0;
    if (simTime - jackBounce > 0.45) {
      jackBounce = simTime;
      tooHard(at, hit.normal, mat, hit.t);
    }
    return;
  }
  if (through) {
    jackWork = 0;
    jackBreaks++;
  }
  const out = at.clone().addScaledVector(n, 0.3);
  sounds.jackHit(Sounds.material(mat), broke, hit.t, [at.x, at.y, at.z], through);
  chips.burst(result.gone, out.toArray(), through ? 3 : 2.2, through ? 7 : 5);
  chips.burst(result.loose, out.toArray(), through ? 1 : 0.6, 4);
  effects.impact(out.toArray(), through ? 9 : 4.5, tintOf(result.gone[0] ?? result.loose[0]));
  dustAt(result.gone, through ? 0.35 : 0.12);
  effects.sparks(at.clone().addScaledVector(n, 0.2).toArray(), through ? 8 : 3, 4);
  if (through) {
    impacts.hit(out.toArray(), hit.normal, 1.4, 0.3, dustRing, 0.2);
    hitstop = Math.max(hitstop, 0.04);
  }
  scored(result, at.toArray(), !through);
}
/** Where the jackhammer is working, and how many bites it's taken there (JACK_BREAK breaks a clump out). */
const jackSpot = new THREE.Vector3(1e9, 0, 0);
let jackWork = 0;
const JACK_BREAK = 6;

/** The sledge: released after winding up for `power` (0..1). The blow lands a moment later. */
function swingSledge(power: number): void {
  hand.swingSledge(power);
  sounds.swing(power);
  blows.push({ due: performance.now() / 1000 + ViewModel.STRIKE, power });
}
const blows: { due: number; power: number }[] = [];
function sledgeLands(power: number): void {
  const hit = aim(TOOLS[SLEDGE].reach);
  if (!hit || hit.voxel < 0) return;
  const at = eye.clone().addScaledVector(dir, hit.t).addScaledVector(new THREE.Vector3(...hit.normal), -0.2);
  if (hit.debris) hitDebris(at, hit.slot, 0.5 + power * 0.85, 5 + power * 8);
  // How far it breaks each hardness: a tap only soft things, a full swing chips brick, nothing hard
  const radii = RADII.sledge(power);
  const result = blasts(city, structure, physics, [{ at: at.toArray(), radius: radii[0], radii, push: 4 + power * 9, core: 0.5, topple: power > 0.9 ? away(at) : undefined }]);
  unsettled = true;
  afterBlast(result, [{ at: at.toArray() }]);
  const broke = result.gone.length + result.loose.length;
  const mat = city.material[hit.voxel];
  lastSledge = { power, broke, material: mat, same: [...result.gone, ...result.loose].filter((v) => city.material[v] === mat).length };
  if (!broke && !hit.debris && TIER[mat as Mat] > 0) {
    // Too hard for it: the material wins, and the player hears and sees that it did
    tooHard(at, hit.normal, mat, hit.t);
    hud.kick();
    return;
  }
  sounds.sledgeHit(Sounds.material(mat), power, hit.t, broke, [at.x, at.y, at.z]);
  if (broke) {
    addTrauma(0.15 + 0.2 * power);
    hitstop = Math.max(hitstop, 0.045 + 0.035 * power);
    hand.hitstop(0.05 + power * 0.04);
  } else {
    addTrauma(0.08);
    hand.hitstop(0.06);
  }
  hud.kick();
  effects.sparks(at.toArray(), 10 + power * 14, 6);
  impacts.hit(at.toArray(), hit.normal, 1.2 + power, 0.3, broke ? dustRing : hotRing, 0.18);
  effects.impact(at.toArray(), (9 + power * 6) * puffOf(result.gone[0] ?? result.loose[0]), tintOf(result.gone[0] ?? result.loose[0]));
  chips.burst(result.gone, at.toArray(), 3, 6 + power * 6);
  chips.burst(result.loose, at.toArray(), 0.8, 4 + power * 4);
  dustAt([...result.gone, ...result.loose], 0.2);
  scored(result, at.toArray());
}

/** The last sledge blow (tests): its power, what it broke, what it hit. */
let lastSledge = { power: 0, broke: 0, material: -1, same: 0 };
/** Times a tool bounced off something too hard (tests), and whether the player's been told why. */
let bounces = 0;
let toldHard = false;
/**
 * A sledge or a cannonball met something too hard for it (a girder, reinforced concrete, bedrock): no hole, but
 * a small hit of the material and a dull thud pitched up, sparks off steel or a grey puff off masonry, a scuff
 * on it, the tool kicked back harder, and no hit-stop.
 */
function tooHard(at: THREE.Vector3, normal: ArrayLike<number>, mat: number, distance: number): void {
  bounces++;
  sounds.bounce(Sounds.material(mat), distance, [at.x, at.y, at.z]);
  const face = at.clone().addScaledVector(new THREE.Vector3(normal[0], normal[1], normal[2]), 0.22);
  if (mat === Mat.Girder || mat === Mat.Steel) effects.sparks(face.toArray(), 6, 5);
  else effects.impact(face.toArray(), 3, concreteDust);
  charAround(at.toArray(), 0.2, 0.15);
  impacts.hit(face.toArray(), normal, 0.6, 0.2, hotRing, 0.12);
  hand.bounce(1.5);
  addTrauma(0.08);
  if (!toldHard && (phase === 'play' || phase === 'free')) {
    toldHard = true;
    hud.toast(mat === Mat.Rock ? 'Bedrock: nothing breaks that' : mat === Mat.Girder ? 'Steel girder: too hard. A charge cuts it' : 'Reinforced concrete: too hard. Use a charge');
  }
}

/** The cannon: a heavy iron ball, flat and fast; where its path meets the lot it smashes through. */
const BALL: [number, number, number] = [0.36, 7, 62];
function fireCannon(): void {
  const [r, density, speed] = BALL;
  player.eye(eye);
  player.look(dir);
  const from = eye.clone().addScaledVector(dir, 1.1).add(new THREE.Vector3(0, 0, -0.12));
  const v = dir.clone().multiplyScalar(speed).add(player.velocity);
  physics.throwBall(from.toArray(), v.toArray(), r, density);
  planBall(from, v, r);
  hand.fire();
  hud.kick();
  sounds.cannonFire();
  addTrauma(0.2);
  fovKick += 5;
  const muzzle = eye.clone().addScaledVector(dir, 1.0).add(new THREE.Vector3(0, 0, -0.15));
  view.flashLight(muzzle.toArray(), 80 * LIGHT_SCALE, 0.06, 'flash', 8);
  effects.impact(muzzle.toArray(), 6, smokeTint);
  effects.sparks(muzzle.toArray(), 8, 7);
  player.velocity.addScaledVector(dir, -1.6);
}
const pending: { time: number; at: THREE.Vector3; radius: number; radii?: [number, number, number]; push: number; first: boolean; way: number[]; slot?: number; hard?: number; normal?: [number, number, number] }[] = [];
function planBall(from: THREE.Vector3, v: THREE.Vector3, r: number): void {
  const p = from.clone();
  const vel = v.clone();
  const dt = 1 / 120;
  let first = true;
  let wall = 0;
  const way = [v.x, v.y];
  const l = Math.hypot(way[0], way[1]) || 1;
  way[0] /= l;
  way[1] /= l;
  for (let t = 0; t < 4 && vel.length() > 12; t += dt) {
    vel.z -= 9.81 * dt;
    const step = vel.clone().multiplyScalar(dt);
    const unit = step.clone().normalize();
    let hit: { t: number; voxel: number; normal: [number, number, number]; debris?: string; slot?: number } | null = raycast(city, p.toArray(), unit.toArray(), step.length() + r);
    // Heaps and falling pieces stop the ball too (once, where it meets them)
    const deb = t > 0.04 ? debrisRay(p, unit, hit ? hit.t : step.length() + r, false) : null;
    if (deb) hit = deb;
    p.add(step);
    if (!hit) continue;
    if (deb) {
      pending.push({ time: simTime + t, at: p.clone(), radius: 0.9, push: vel.length() * 0.3, first, way, slot: deb.slot });
      first = false;
      vel.multiplyScalar(0.5);
      continue;
    }
    if (hit.voxel < 0) {
      // Into the ground: a thump and a spray of dirt, and it rolls on
      pending.push({ time: simTime + t, at: p.clone(), radius: 0.4, push: 3, first: false, way });
      break;
    }
    // Each wall it goes through takes 30% off what it breaks next; it stops in a hard one, or once it can't
    // break a medium wall's worth (under 0.3 m), or after four walls
    const radii = RADII.cannon(wall);
    const hard = TIER[city.material[hit.voxel] as Mat] >= 2 ? city.material[hit.voxel] : undefined;
    pending.push({ time: simTime + t - 0.02, at: p.clone().addScaledVector(vel.clone().normalize(), r), radius: radii[0], radii, push: vel.length() * 0.32, first, way, hard, normal: hit.normal });
    first = false;
    wall++;
    if (hard !== undefined || RADII.cannon(wall)[1] < 0.3 || wall >= 4) break;
    vel.multiplyScalar(0.9);
    p.addScaledVector(vel.clone().normalize(), r * 1.5);
  }
}
function ballHits(): void {
  for (let k = pending.length - 1; k >= 0; k--) {
    if (pending[k].time > simTime) continue;
    const { at, radius, radii, push, first, way, slot, hard, normal } = pending.splice(k, 1)[0];
    if (slot !== undefined) hitDebris(at, slot, radius, push);
    const result = blasts(city, structure, physics, [{ at: at.toArray(), radius, radii, push, core: 0.4, topple: way }]);
    unsettled = true;
    afterBlast(result, [{ at: at.toArray(), radius }]);
    chips.burst(result.gone, at.toArray(), 4, push * 0.8);
    chips.burst(result.loose, at.toArray(), 1, push * 0.6);
    const distance = player.position.distanceTo(at);
    const broke = result.gone.length + result.loose.length;
    if (hard !== undefined && broke === 0) {
      tooHard(at, normal ?? [0, 0, 1], hard, distance);
      continue;
    }
    const struck = result.gone[0] ?? result.loose[0];
    sounds.impact(struck === undefined ? 'brick' : Sounds.material(city.material[struck]), Math.min(1, push / 20) * (broke ? 1 : 0.6), distance, broke, [at.x, at.y, at.z]);
    addTrauma((0.45 * 9) / (distance + 9));
    // A hit-stop only for a hit you see, near enough to read
    if (first && broke && distance < 25 && screenOf(at.toArray())) hitstop = Math.max(hitstop, 0.04);
    if (first || broke) view.flashLight(at.toArray(), 150 * LIGHT_SCALE, 0.15, 'flash', 12 * radius);
    charAround(at.toArray(), 0.6 + radius * 0.3, 0.35);
    const back = at.clone().sub(player.position).normalize().negate();
    impacts.hit(at.toArray(), back.toArray(), radius * 3, 0.5, dustRing, radius * 0.9);
    effects.sparks(at.toArray(), 22, 9);
    effects.impact(at.toArray(), 14 * puffOf(result.gone[0]), tintOf(result.gone[0]));
    dustAt([...result.gone, ...result.loose], 0.4);
    scored(result, at.toArray());
  }
}

/** Sticky charges: stuck where the crosshair meets a wall, blown together (a ripple, a beat apart). */
const placed: { mesh: THREE.Object3D; light: THREE.Mesh; due: number; normal: THREE.Vector3; armedAt: number; kind: 'charge' | 'cutter'; delay: number; along: THREE.Vector3 }[] = [];
const cutterGeo = new THREE.BoxGeometry(1.2, 0.12, 0.08);
const cutterMat = new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.6, emissive: 0xff5010, emissiveIntensity: 0.6 });
const chargeGeo = new THREE.BoxGeometry(0.34, 0.22, 0.14);
const chargeMat = new THREE.MeshStandardMaterial({ color: 0x8a8458, roughness: 0.8 });
const tapeMat = new THREE.MeshStandardMaterial({ color: 0xe0782a, roughness: 0.6 });
const ledOn = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2010, emissiveIntensity: 8 });
const ledOff = new THREE.MeshStandardMaterial({ color: 0x300404, roughness: 0.5 });
const tapeGeo = new THREE.BoxGeometry(0.05, 0.225, 0.145);
const ledGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
function chargeMesh(): { mesh: THREE.Group; light: THREE.Mesh } {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(chargeGeo, chargeMat));
  for (const x of [-0.09, 0.09]) {
    const t = new THREE.Mesh(tapeGeo, tapeMat);
    t.position.x = x;
    g.add(t);
  }
  const light = new THREE.Mesh(ledGeo, ledOn);
  light.position.set(0.02, 0.06, 0.08);
  g.add(light);
  // (Inside the block, unseen: so the blink's dark material is compiled with the rest)
  const off = new THREE.Mesh(ledGeo, ledOff);
  g.add(off);
  return { mesh: g, light };
}
function placeCharge(kind: 'charge' | 'cutter' = 'charge'): void {
  if (kind === 'charge' ? game.charges <= 0 : game.cutters <= 0) {
    hud.toast(kind === 'charge' ? 'Out of charges' : 'Out of cutters');
    sounds.click();
    return;
  }
  const hit = aim(TOOLS[CHARGE].reach);
  if (!hit) {
    hud.toast('Too far: get up close to a wall');
    return;
  }
  const n = new THREE.Vector3(...hit.normal);
  const at = eye.clone().addScaledVector(dir, hit.t).addScaledVector(n, 0.07);
  // A cutter lies across the face, level (a cut across a column or a girder): a long strip, the pack on it
  const along = new THREE.Vector3(0, 0, 1).cross(n);
  if (along.lengthSq() < 0.01) along.set(1, 0, 0);
  along.normalize();
  putDevice(kind, at, n, along, fuseDelay);
  if (kind === 'charge') game.charges--;
  else game.cutters--;
  if (fuseDelay > 0) hud.toast(`${kind === 'charge' ? 'Charge' : 'Cutter'} set: fires ${fuseDelay} s after the button`);
  hand.place();
  hand.armed = true;
  sounds.play('clack', 0.3, 0, { rate: 0.7 });
  sounds.blip(1800, 0.05, 0.06, 'square');
  effects.impact(at.toArray(), 2, smokeTint);
  if (placed.length === 1) hud.hint('<b>Right click</b> or <b>Q</b> to blow the charges');
}
function detonateAll(): void {
  const waiting = placed.filter((c) => c.due === Infinity);
  if (!waiting.length) return;
  hand.detonate();
  sounds.play('clack', 0.35, 0, { rate: 1.5 });
  sounds.blip(2400, 0.04, 0.05, 'square');
  // Nearest first: the ripple runs away from the player; each set delay on top
  waiting.sort((a, b) => a.mesh.position.distanceTo(player.position) - b.mesh.position.distanceTo(player.position));
  waiting.forEach((c, k) => (c.due = simTime + 0.25 + (mode === 'blowdown' ? 0 : k * 0.12) + c.delay));
  if (mode === 'blowdown' && blownAt < 0) {
    blownAt = simTime;
    hud.banner('FIRE IN THE HOLE', 'BLOWDOWN', true);
  }
}
function chargesDue(): void {
  for (let k = placed.length - 1; k >= 0; k--) {
    const c = placed[k];
    c.light.material = Math.sin(simTime * (c.due < Infinity ? 40 : 9) + k) > 0 ? ledOn : ledOff;
    if (c.due > simTime) continue;
    placed.splice(k, 1);
    c.mesh.removeFromParent();
    const at = c.mesh.position.clone().addScaledVector(c.normal, -0.35);
    if (c.kind === 'cutter') cutLine(at, c.along, c.normal);
    else explode(at, RADII.charge[0], 10, { topple: params.has('notopple') ? undefined : away(at), fire: 1.6, charge: true, radii: RADII.charge });
  }
  hand.armed = placed.length > 0;
}

/**
 * A cutter going off at `at`: a line 1.2 m long across the face (`along`), cutting through anything within
 * 0.45 m of it, steel and reinforced concrete too, a hot white flash and a spray of sparks, little push. What's
 * cut through tips toward the side the cut is on.
 */
function cutLine(at: THREE.Vector3, along: THREE.Vector3, normal: THREE.Vector3): void {
  const hits: Hit[] = [];
  for (let k = -2; k <= 2; k++) hits.push({ at: at.clone().addScaledVector(along, k * 0.3).toArray(), radius: RADII.cutter[0], radii: RADII.cutter, push: 1.5, core: 0.85, topple: [normal.x, normal.y] });
  const result = blasts(city, structure, physics, hits);
  unsettled = true;
  afterBlast(result, hits);
  const distance = player.position.distanceTo(at);
  sounds.cutter(distance, [at.x, at.y, at.z]);
  view.flashLight(at.toArray(), 260 * LIGHT_SCALE, 0.22, 'flash', 9);
  for (let k = -2; k <= 2; k++) effects.sparks(at.clone().addScaledVector(along, k * 0.3).addScaledVector(normal, 0.3).toArray(), 14, 7);
  effects.impact(at.clone().addScaledVector(normal, 0.4).toArray(), 6, smokeTint);
  charAround(at.toArray(), 1.1, 1, 0.9, 0.5);
  addTrauma(0.18 + 0.3 / (1 + distance / 8));
  chips.burst(result.gone, at.toArray(), 0.5, 4);
  scored(result, at.toArray());
}

/** A blast: a demolition charge or a tank going up. Damage, fire, light, sound, shake. */
function explode(at: THREE.Vector3, radius: number, push: number, opts: { topple?: number[]; fire?: number; sample?: string; charge?: boolean; radii?: [number, number, number]; chain?: boolean } = {}): void {
  explosions++;
  // Pipe bombs caught in it go off too
  for (const b of pipeBombs) if (b.p.distanceTo(at) < radius + 0.8) b.fuse = Math.min(b.fuse, 0.08);
  const distance = player.position.distanceTo(at);
  const result = blasts(city, structure, physics, [{ at: at.toArray(), radius, radii: opts.radii ?? [radius, radius * 0.8, radius * 0.3], push, core: 0.42, topple: opts.topple }]);
  unsettled = true;
  afterBlast(result, [{ at: at.toArray(), radius }]);
  chips.burst(result.gone, at.toArray(), 1, push * 0.9 + 3);
  chips.burst(result.loose, at.toArray(), 0.6, push * 0.6 + 2);
  effects.explosion(at.toArray(), radius * (opts.sample === 'propane' ? 0.75 : 0.9));
  dustiness = Math.min(1.2, dustiness + radius / 5 + result.falling.length / 40000);
  const where: [number, number, number] = [at.x, at.y, at.z];
  if (opts.sample === 'propane') sounds.propane(distance, where);
  else sounds.charge(distance, 1, where);
  sounds.debrisTail(result.gone.length + result.loose.length, distance, 0.15, where);
  const near = 1 / (1 + distance / 8);
  hud.flash(Math.min(1, (radius * 6) / (distance + 5)));
  addTrauma(0.35 + 0.55 * near + (opts.sample === 'propane' ? 0.1 : 0));
  // Hit-stop for the first charge of a ripple only; none for tanks set off by other blasts (chains)
  if (opts.charge && simTime - lastChargeStop > 0.3) hitstop = Math.max(hitstop, 0.07);
  if (opts.charge) lastChargeStop = simTime;
  // Light: a flash, then a flicker; the wall blackened round the hole, soot on the ground under it
  const light = (opts.sample === 'propane' ? 900 : 600) * LIGHT_SCALE;
  view.flashLight(at.toArray(), light, 0.18 + Math.random() * 0.2, 'flash', 12 * radius);
  view.flashLight([at.x, at.y, at.z + 0.6], light, 0.8 + Math.random() * 0.4, 'flicker', 12 * radius);
  // (Past the hole's edge, toward the reach: a fall-off of 0.85·(1 − d/R) came out faint where the wall still stands)
  charAround(at.toArray(), 1.5 * radius, 1.2, 0.85, 0.5);
  if (physics) view.char(result.loose.map((v) => physics.body[v]), 0.55);
  if (at.z < radius) view.scorchGround(at.x, at.y, radius * (1.1 - at.z / (2 * radius)), 0.9);
  if (distance < 12) fovKick += 4 * near * 2;
  pulse = Math.max(pulse, Math.min(0.7, (radius * 3) / (distance + 4)));
  hand.jolt(near * 1.5);
  view.glow = 1.2;
  dustAt([...result.gone, ...result.loose], 0.16);
  if (result.falling.length > 50) {
    // Dust where it broke (the bottom of what's falling), not all up the falling piece: that hid it
    let low = Infinity;
    for (const v of result.falling) low = Math.min(low, city.position[3 * v + 2]);
    const sample = result.falling.filter((v, k) => k % 4 === 0 && city.position[3 * v + 2] < low + 2.5);
    const fp = new Float32Array(sample.length * 3);
    sample.forEach((v, k) => fp.set(city.position.subarray(3 * v, 3 * v + 3), 3 * k));
    effects.dust(fp, 0.15, tintOf(sample[0]));
  }
  // (Round the hole: what was within the blast is gone, the fire takes what stands at its edge)
  if (opts.fire) ignite(at, opts.fire + (opts.radii?.[0] ?? radius) * 0.9);
  // Charges caught in it go off too
  for (const c of placed) if (c.mesh.position.distanceTo(at) < radius + 0.6) c.due = Math.min(c.due, simTime + 0.1);
  scored(result, at.toArray());
}

/**
 * Dust from what broke, by its material: plaster twice the dust and paler, concrete grey, steel none (sparks
 * instead: 20 a hit), the rest as before.
 */
const plasterDust = new THREE.Color(0.9, 0.86, 0.78);
/** How much dust a broken voxel's material throws, against masonry's: plaster twice, timber little (it splinters), glass less. */
function puffOf(v: number | undefined): number {
  if (v === undefined) return 1;
  const m = city.material[v];
  return m === Mat.Plaster || m === Mat.Trim ? 2 : m === Mat.Wood || m === Mat.Plastic ? 0.3 : m === Mat.Glass || m === Mat.LitGlass ? 0.4 : m === Mat.Steel || m === Mat.Girder ? 0.2 : 1;
}
function dustAt(broken: number[], amount: number): void {
  if (!broken.length) return;
  const m = city.material[broken[0]];
  if (m === Mat.Steel || m === Mat.Girder) {
    const v = broken[0];
    effects.sparks([city.position[3 * v], city.position[3 * v + 1], city.position[3 * v + 2]], 20, 7);
    return;
  }
  const points = new Float32Array(broken.length * 3);
  broken.forEach((v, k) => points.set(city.position.subarray(3 * v, 3 * v + 3), 3 * k));
  const plaster = m === Mat.Plaster || m === Mat.Trim;
  effects.dust(points, amount * puffOf(broken[0]), plaster ? plasterDust : tintOf(broken[0]));
}

/** Windows a blast (or the frame giving way) shattered: shards, a puff of dust, and the sound once for all of them. */
function afterBlast(result: BlastResult, hits: { at: ArrayLike<number>; radius?: number }[]): void {
  alarms.hit(result);
  occDirty = true;
  rigBlast(hits);
  if (!result.panes.length) return;
  let nearest = Infinity;
  let nearAt: [number, number, number] = [0, 0, 0];
  let high = 0;
  const puffs: number[] = [];
  const total = result.panes.reduce((n, p) => n + p.voxels.length, 0);
  const each = Math.min(1.2, 2500 / Math.max(1, total));
  for (const { pane, voxels, by } of result.panes) {
    const { centre, normal } = city.panes[pane];
    let from: ArrayLike<number>;
    let speed: number;
    if (by >= 0) {
      from = hits[by].at;
      speed = Math.max(3, 16 - 1.2 * Math.hypot(centre[0] - from[0], centre[1] - from[1], centre[2] - from[2]));
    } else {
      from = [centre[0] - normal[0] * 2, centre[1] - normal[1] * 2, centre[2]];
      speed = 3;
      puffs.push(centre[0] + normal[0] * 0.6, centre[1] + normal[1] * 0.6, centre[2]);
    }
    shards.burst(voxels, from, each, speed, 0xd4e4ea);
    const d = player.position.distanceTo(new THREE.Vector3(centre[0], centre[1], centre[2]));
    if (d < nearest) {
      nearest = d;
      nearAt = [centre[0], centre[1], centre[2]];
    }
    high = Math.max(high, centre[2]);
  }
  if (puffs.length) effects.dust(puffs, 6 * Math.min(1, 8 / (puffs.length / 3)), concreteDust);
  sounds.glass(result.panes.length, nearest, Math.min(2, high / 12), nearAt);
}

// ---------- the debris readback (the fork's, scoring what debris breaks) ----------
const CRUSH_SPEED = 7;
const SECTION_JOLT = 2.5;
/** A falling piece crumbles where it lands when it comes down faster than this (m/s): slower, it lands whole. */
const CRUMBLE_SPEED = 3;
/** What crushing a layer of a piece takes (J per kg of the layer, for brick; by material from there). */
const CRUSH_ENERGY = 35;
/** The most of one bite that goes to dust (chips and a puff where it was) when there's no room for it as bodies. */
const DUST_MAX = 0.35;
/** How fast a piece carrying another gives way under it (m/s). */
const GIVE_SPEED = 2.5;
/**
 * Voxels the crumbling pieces had no room for at the last readback. Debris that has all but come to rest on
 * something solid is laid down as rubble early to make that room (it would be in a second and a half anyway).
 */
let crumbleShort = 0;
/** Tests: how much debris was laid down early for that. */
let laidEarly = 0;
const CRUSH_DAMAGE = 2500;
let damage = new Map<number, number>();
const crushes: { voxel: number; speed: number }[] = [];
const REST_SPEED = 0.25;
const REST_SECONDS = 1.5;
let stillFor = new Float32Array(0);
let lastRead = 0;
let reading = false;
let unsettled = false;
let settleUntil = 0;
let lastSettle = 0;
let lastFullSettle = 0;
let lastSettleMs = 0;
let lastHover = 0;
/** Loose debris lying still at the last readback (xyz triples): it holds up what lies on it. */
let lastStill: number[] = [];
/** What the no-hover rule dropped (tests): rubble masses dropped as bodies, voxels woken, fixed pieces cut off. */
const nothingHovers = { masses: 0, bodies: 0, woken: 0, cutOff: 0, ms: 0 };
/**
 * Rubble with nothing under it falls, now: masses as bodies, cut into storey-high bands a section wide (as a
 * tower's falling storeys are: they land on each other and pancake), bottom band first; what won't make a box
 * (a sliver, or a box that would start inside something) wakes a voxel at a time, still bonded.
 */
function dropHovering(still: ArrayLike<number> = []): void {
  const t0 = performance.now();
  const masses = physics.hovering(still);
  for (const mass of masses) {
    nothingHovers.masses++;
    if (mass.length < 24) {
      physics.wakeBonded(mass);
      nothingHovers.woken += mass.length;
      continue;
    }
    const bands = new Map<number, number[]>();
    for (const v of mass) {
      const o = 7 * v;
      const key = Math.floor(physics.rest[o + 2] / 3) * 10000 + Math.floor(physics.rest[o] / 10) * 100 + Math.floor(physics.rest[o + 1] / 10) + 5000;
      const list = bands.get(key);
      if (list) list.push(v);
      else bands.set(key, [v]);
    }
    // A band that won't make a box (it would start inside something) is halved across its longer side and tried
    // again, down to small bits, which wake a voxel at a time (a slab's worth of single bodies blew the budget)
    const drop = (band: number[]) => {
      if (band.length >= 24 && physics.dropRubble(band, rubbleBond)) {
        nothingHovers.bodies++;
        return;
      }
      if (band.length < 48) {
        physics.wakeBonded(band);
        nothingHovers.woken += band.length;
        return;
      }
      let [lx, hx, ly, hy] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const v of band) {
        lx = Math.min(lx, physics.rest[7 * v]);
        hx = Math.max(hx, physics.rest[7 * v]);
        ly = Math.min(ly, physics.rest[7 * v + 1]);
        hy = Math.max(hy, physics.rest[7 * v + 1]);
      }
      const axis = hx - lx > hy - ly ? 0 : 1;
      const mid = axis === 0 ? (lx + hx) / 2 : (ly + hy) / 2;
      drop(band.filter((v) => physics.rest[7 * v + axis] < mid));
      drop(band.filter((v) => physics.rest[7 * v + axis] >= mid));
    };
    for (const key of [...bands.keys()].sort((a, b) => a - b)) drop(bands.get(key)!);
    if (mass.length > 400) {
      let [x, y, z] = [0, 0, 0];
      for (const v of mass) {
        x += physics.rest[7 * v];
        y += physics.rest[7 * v + 1];
        z += physics.rest[7 * v + 2];
      }
      const at: [number, number, number] = [x / mass.length, y / mass.length, z / mass.length];
      sounds.creak('masonry', 1, at);
    }
  }
  if (masses.length) unsettled = true;
  nothingHovers.ms = Math.max(nothingHovers.ms, performance.now() - t0);
}
/** How rubble dropped as a body holds together when it lands: as rubble does, by material. */
const rubbleBond = (v: number, u: number) => 1400 * VOXEL ** 2 * Math.min(MAT_BOND[city.material[v] as Mat] ?? 1, MAT_BOND[city.material[u] as Mat] ?? 1);
let settleCount = 0;
/** Loose voxels by half-metre cell at the last readback: what a falling piece stands on, and what tools can hit. */
let lastLooseCells = new Map<number, number[]>();
const cellOf = (x: number, y: number, z: number) => (Math.floor(x * 2) + 2048) * 4194304 + (Math.floor(y * 2) + 2048) * 1024 + Math.max(0, Math.floor(z * 2) + 8);
const SETTLE_WATCH = 2.5;
let lastImpact = new Float32Array(0);
/** The debris budget's work (tests): voxels frozen, deleted, and deleted where they shouldn't be (near, in view). */
const cleanup = { frozen: 0, deleted: 0, deletedNear: 0, deletedInView: 0 };
const viewFrustum = new THREE.Frustum();
const viewMatrix = new THREE.Matrix4();
const scratchV = new THREE.Vector3();
/** Each voxel's speed at the last readback: a drop of more than 3 m/s from over 4 is a hit you hear. */
let lastSpeed = new Float32Array(0);
let frames = 0;
/** Debris hits this readback, by 4 m cell: how many, the hardest (m/s lost), where (sum), the voxel that hit hardest. */
const knocks = new Map<number, { n: number; dv: number; x: number; y: number; z: number; v: number }>();
/** The sounds of debris hitting things this readback: one per piece, a clump's, or a whole wall's as one set. */
function soundKnocks(): void {
  if (!knocks.size) return;
  // The strongest places, at most 6 and fewer the more there are (a dense collapse heard as a few distinct hits
  // a beat, not a wash): a whole wall's worth (30 or more pieces) as one set, a clump (6 or more) as one clump's
  // hit, single pieces one each. A place a set just covered (within 8 m, 0.5 s) gets a clump's hit instead.
  const all = [...knocks.values()].sort((a, b) => b.n * b.dv - a.n * a.dv);
  knocks.clear();
  const room = all.length > 12 ? 3 : all.length > 6 ? 4 : 6;
  // (Single pieces get one of the places even in a collapse: the clatter between the crashes)
  const single = all.filter((k) => k.n < 6).slice(0, 1);
  const list = [...all.filter((k) => k.n >= 6).slice(0, room - single.length), ...single];
  for (const k of list) {
    const at: [number, number, number] = [k.x / k.n, k.y / k.n, k.z / k.n];
    const material = Sounds.material(city.material[k.v]);
    if (k.n >= 30 && sounds.collapseSet(material, k.n, at)) continue;
    sounds.debrisHit(material, k.n >= 6 ? 'M' : 'S', k.dv, k.n >= 6 ? k.n : 1, at);
  }
}
const lagTest = Number(params.get('lag') ?? 0);
const lagWaits: { at: number; done: () => void }[] = [];
/** A pose (centre xyz, quaternion xyzw) `t` seconds on, moving at `vel` and turning at `spin` (rad/s). */
function ahead(pose: number[], vel: ArrayLike<number>, spin: ArrayLike<number>, t: number): number[] {
  if (t <= 0) return pose;
  const [x, y, z, w] = [pose[3], pose[4], pose[5], pose[6]];
  const [sx, sy, sz] = [spin[0] * t * 0.5, spin[1] * t * 0.5, spin[2] * t * 0.5];
  // q + ½·t·(spin ⊗ q), made a unit again
  const q = [x + sx * w + sy * z - sz * y, y + sy * w + sz * x - sx * z, z + sz * w + sx * y - sy * x, w - sx * x - sy * y - sz * z];
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [pose[0] + vel[0] * t, pose[1] + vel[1] * t, pose[2] + vel[2] * t, q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
async function readDebris(): Promise<void> {
  if (reading || (physics.loose === 0 && physics.rubble.size === 0)) return;
  reading = true;
  const reader = physics;
  try {
    const counters = await reader.solver.readCounters();
    if (reader !== physics) return;
    reader.solver.adapt(counters);
    const readAt = physicsSteps;
    const { voxels, data, spin, sections, sectionData, sectionSpin } = await reader.readLoose();
    // (Tests, ?lag=n: the readback lands n frames late, as it does on a real frame loop; stepped by hand it never would)
    if (TESTING && lagTest > 0) await new Promise<void>((done) => lagWaits.push({ at: readAt + lagTest, done }));
    if (reader !== physics) return;
    // (What was read is this old by now, in the world's time: sections are taken to where they've got to since)
    const lag = Math.max(0, physicsSteps - readAt) / 60;
    /**
     * Where loose voxel `k` of the readback was (xyz, quaternion xyzw). (Not taken on by its velocity as the sections
     * are: debris nearly at rest in a heap reads as moving while the solver holds it still, and laid down where that
     * would take it, three times as much of it jumped.)
     */
    const poseNow = (k: number) => [data[12 * k], data[12 * k + 1], data[12 * k + 2], data[12 * k + 8], data[12 * k + 9], data[12 * k + 10], data[12 * k + 11]];
    const readStart = performance.now();
    let rbAt = readStart;
    const rbLap = (n: string) => {
      const t = performance.now();
      rbProf[n] = Math.max(rbProf[n] ?? 0, t - rbAt);
      rbAt = t;
    };
    const out: number[] = [];
    const { x, y } = player.position;
    const now = performance.now() / 1000;
    if (lastImpact.length !== city.count) lastImpact = new Float32Array(city.count);
    if (lastSpeed.length !== city.count) lastSpeed = new Float32Array(city.count);
    let mx = 0;
    let my = 0;
    let mz = 0;
    let puffs = 0;
    if (stillFor.length !== city.count) stillFor = new Float32Array(city.count);
    const since = (now - lastRead) * timeScale;
    lastRead = now;
    const resting: number[] = [];
    const poses: number[] = [];
    const still: number[] = [];
    let moving = 0;
    let inZone = 0;
    /** Raycasts for debris strikes this readback, at most a few hundred (a tower's collapse has thousands of fast voxels). */
    let rays = 0;
    const zone = level.zone;
    const looseCells = new Map<number, number[]>();
    lastLooseCells = looseCells;
    /**
     * Half-metre cells with debris lying nearly still, and those of them where it lies low or on something solid:
     * what a falling piece comes down on, as rubble is. (Only the second kind is seen coming: a tank's own legs,
     * loose and still standing under it, aren't a heap to land on.)
     */
    const stillCells = new Set<number>();
    const heapCells = new Set<number>();
    /** Debris all but at rest on the ground or on something solid (its speed, voxel and place in the readback). */
    /** Debris all but at rest (its height, voxel and place in the readback), for laying down early. */
    const slow: [number, number, number][] = [];
    const census = { slow: 0, slowish: 0, fastHigh: 0, fastLow: 0, settled: 0 };
    for (const [k, v] of voxels.entries()) {
      const o = 12 * k;
      const [px, py, pz] = [data[o], data[o + 1], data[o + 2]];
      if (pz < PARKED_BELOW) continue;
      const ck = cellOf(px, py, pz);
      const cell = looseCells.get(ck);
      if (cell) cell.push(v);
      else looseCells.set(ck, [v]);
      // Into the sea since the last look, and fast: a splash
      if (sea && data[o + 6] < -2.5 && livePos[3 * v + 2] > sea.level && pz <= sea.level + 0.1 && splashes.length < 600) splashes.push(px, py, -data[o + 6]);
      livePos[3 * v] = px;
      livePos[3 * v + 1] = py;
      livePos[3 * v + 2] = pz;
      if (zone && city.building[v] === zone.object && Math.hypot(px - zone.x, py - zone.y) < zone.r && pz < 3) inZone++;
      if (Math.abs(px - x) < 12 && Math.abs(py - y) < 12) out.push(px, py, pz);
      const speed = Math.hypot(data[o + 4], data[o + 5], data[o + 6]);
      if (speed < 1.5) {
        stillCells.add(ck);
        const solid = voxelAt(city, px, py, pz - VOXEL) >= 0 || physics.rubbleAt(px, py, pz - VOXEL) >= 0;
        if (pz < 1.5 || solid) heapCells.add(ck);
        if (crumbleShort > 0 && speed < 0.5 && Math.hypot(spin[4 * k], spin[4 * k + 1], spin[4 * k + 2]) < 3) slow.push([pz, v, k]);
        if (TESTING) {
          if (speed < 0.5) census.slow++;
          else census.slowish++;
        }
      } else if (TESTING) {
        if (pz > 3) census.fastHigh++;
        else census.fastLow++;
      }
      if (speed > 1.5) {
        moving++;
        mx += px;
        my += py;
        mz += pz;
      }
      // A hit: it was going over 4 m/s and lost more than 3 since the last readback
      const was = lastSpeed[v];
      lastSpeed[v] = speed;
      if (was > 4 && was - speed > 3) {
        const key = (Math.floor(px / 4) + 512) * 1048576 + (Math.floor(py / 4) + 512) * 1024 + Math.max(0, Math.floor(pz / 4) + 4);
        const k = knocks.get(key);
        const dv = was - speed;
        if (k) {
          k.n++;
          k.x += px;
          k.y += py;
          k.z += pz;
          if (dv > k.dv) {
            k.dv = dv;
            k.v = v;
          }
        } else knocks.set(key, { n: 1, dv, x: px, y: py, z: pz, v });
      }
      if (speed < 1 && stillFor[v] > 1) still.push(px, py, pz);
      stillFor[v] = speed < REST_SPEED ? stillFor[v] + since : 0;
      if (stillFor[v] > REST_SECONDS && resting.length < 4000) {
        resting.push(v);
        poses.push(px, py, pz, data[o + 8], data[o + 9], data[o + 10], data[o + 11]);
      }
      if (speed > CRUSH_SPEED && crushes.length < 24 && rays++ < 260) {
        const d = [data[o + 4] / speed, data[o + 5] / speed, data[o + 6] / speed];
        const hit = raycast(city, [px, py, pz], d, speed * 0.12 + 0.6);
        if (hit && hit.voxel >= 0) {
          const chunk = structure.chunk[hit.voxel];
          const total = (damage.get(chunk) ?? 0) + speed * speed;
          damage.set(chunk, total);
          if (total > CRUSH_DAMAGE) {
            damage.delete(chunk);
            crushes.push({ voxel: hit.voxel, speed });
          }
        }
      }
      if (speed > 6 && pz < 2.5 && puffs < 20 && now - lastImpact[v] > 3) {
        lastImpact[v] = now;
        puffs++;
        if (puffOf(v) > 0.5) effects.impact([px, py, Math.max(0.2, pz - 0.4)], speed * puffOf(v), tintOf(v));
      }
    }
    rbLap('rb.loop');
    // The debris hitting things, and the rubble still sliding: one loop at the middle of what moves
    soundKnocks();
    sounds.rubble(moving > 40 ? moving : 0, moving ? [mx / moving, my / moving, mz / moving] : null);
    for (const [chunk, total] of damage) (total < 50 ? damage.delete(chunk) : damage.set(chunk, total * 0.5));
    if (resting.length) {
      physics.freeze(resting, Float32Array.from(poses));
      unsettled = true;
    }
    if (crumbleShort > 0 && slow.length) {
      // Room for what's crumbling: what lies on the ground, on something standing, on rubble, or on debris that
      // is itself laid down here (bottom first, so a heap goes from its base up)
      slow.sort((a, b) => a[0] - b[0]);
      const most = Math.min(4000, Math.ceil(crumbleShort * 1.2));
      const laidAt = new Set<number>();
      const quarter = (x: number, y: number, z: number) => (Math.floor(x * 4) + 4096) * 67108864 + (Math.floor(y * 4) + 4096) * 8192 + (Math.floor(z * 4) + 64);
      const early: [number, number, number][] = [];
      for (const s of slow) {
        if (early.length >= most) break;
        const [pz, v, k] = s;
        if (city.state[v] !== State.Loose) continue;
        const [px, py] = [data[12 * k], data[12 * k + 1]];
        let held = pz < 0.45;
        for (let i = 0; !held && i < 5; i++) {
          const [qx, qy] = [px + [0, 0.5, -0.5, 0, 0][i] * VOXEL, py + [0, 0, 0, 0.5, -0.5][i] * VOXEL];
          held = voxelAt(city, qx, qy, pz - VOXEL) >= 0 || physics.rubbleAt(qx, qy, pz - VOXEL) >= 0 || laidAt.has(quarter(qx, qy, pz - VOXEL));
        }
        if (!held) continue;
        laidAt.add(quarter(px, py, pz));
        early.push(s);
      }
      census.settled = early.length;
      const earlyPoses = new Float32Array(early.length * 7);
      early.forEach(([, , k], i) => earlyPoses.set(poseNow(k), 7 * i));
      physics.freeze(
        early.map(([, v]) => v),
        earlyPoses,
      );
      laidEarly += early.length;
      if (early.length) unsettled = true;
    }
    if (TESTING && params.has('sections') && physics.sections.size) collapseLog.push({ f: physicsSteps, what: 'census', ...census, short: crumbleShort, loose: physics.loose });
    // (Nobody may be reading it: Patch's own test runs under the flag too)
    if (collapseLog.length > 20000) collapseLog.splice(0, 10000);
    crumbleShort = 0;
    rbLap('rb.freeze');
    // Over the budget (with some slack, so the sort runs now and then, not every readback): down to 92% of it
    if (physics.loose > looseCap * 1.04) {
      const target = Math.round(looseCap * 0.92);
      const candidates = voxels
        .map((v, k) => ({ v, d: (data[12 * k] - x) ** 2 + (data[12 * k + 1] - y) ** 2, k }))
        .filter(({ k, v }) => data[12 * k + 2] > PARKED_BELOW && city.state[v] === State.Loose)
        .sort((a, b) => b.d - a.d);
      const settleNow = candidates.filter(({ k }) => data[12 * k + 2] < 2.5 && Math.hypot(data[12 * k + 4], data[12 * k + 5], data[12 * k + 6]) < 1.5).slice(0, physics.loose - target);
      if (settleNow.length) {
        const settlePoses = new Float32Array(settleNow.length * 7);
        settleNow.forEach(({ k }, i) => settlePoses.set(poseNow(k), 7 * i));
        physics.freeze(
          settleNow.map(({ v }) => v),
          settlePoses,
        );
        unsettled = true;
      }
      cleanup.frozen += settleNow.length;
      // The rule for the rest: nothing within 20 m of the camera is ever deleted (only frozen, above),
      // nor anything in view. Beyond that, small clumps (under 8) barely moving go first, as a puff of chips;
      // then anything out there that's low is frozen where it lies; then the rest out of view goes.
      const cam = view.camera.position;
      viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse));
      const farOff = (k: number) => (data[12 * k] - cam.x) ** 2 + (data[12 * k + 1] - cam.y) ** 2 + (data[12 * k + 2] - cam.z) ** 2 > 400;
      const seen = (k: number) => viewFrustum.containsPoint(scratchV.set(data[12 * k], data[12 * k + 1], data[12 * k + 2]));
      const clump = (k: number) => {
        let n = 0;
        const [px, py, pz] = [data[12 * k], data[12 * k + 1], data[12 * k + 2]];
        for (let dx = -0.5; dx <= 0.5; dx += 0.5) for (let dy = -0.5; dy <= 0.5; dy += 0.5) for (let dz = -0.5; dz <= 0.5; dz += 0.5) n += looseCells.get(cellOf(px + dx, py + dy, pz + dz))?.length ?? 0;
        return n;
      };
      const speedOf = (k: number) => Math.hypot(data[12 * k + 4], data[12 * k + 5], data[12 * k + 6]);
      let over = physics.loose - target;
      const out = candidates.filter(({ v, k }) => city.state[v] === State.Loose && farOff(k) && !seen(k));
      const small = over > 0 ? out.filter(({ k }) => speedOf(k) < 1 && clump(k) < 8).slice(0, over) : [];
      over -= small.length;
      const taken = new Set(small.map((s) => s.v));
      const stillOut = out.filter(({ v }) => !taken.has(v));
      // (Only what's nearly still: freezing a voxel in flight left it hanging in the air)
      const lowFar = over > 0 ? candidates.filter(({ v, k }) => city.state[v] === State.Loose && farOff(k) && data[12 * k + 2] < 2.5 && speedOf(k) < 1.5).slice(0, over) : [];
      if (lowFar.length) {
        const poses = new Float32Array(lowFar.length * 7);
        lowFar.forEach(({ k }, i) => poses.set(poseNow(k), 7 * i));
        physics.freeze(
          lowFar.map(({ v }) => v),
          poses,
        );
        cleanup.frozen += lowFar.length;
        over -= lowFar.length;
      }
      const rest = over > 0 ? stillOut.filter(({ v }) => city.state[v] === State.Loose).slice(0, over) : [];
      const far = [...small, ...rest];
      const gone = far.map(({ v }) => v);
      for (const { v, k } of far) {
        city.position.set(data.subarray(12 * k, 12 * k + 3), 3 * v);
        cleanup.deleted++;
        if (!farOff(k)) cleanup.deletedNear++;
        if (seen(k)) cleanup.deletedInView++;
      }
      if (gone.length) chips.burst(gone.slice(0, 400), [cam.x, cam.y, 0], 1, 2);
      if (gone.length) physics.remove(gone);
      unsettled = true;
    }
    rbLap('rb.cap');
    for (const v of physics.rubble) {
      const o = 7 * v;
      const [rx, ry, rz] = [physics.rest[o], physics.rest[o + 1], physics.rest[o + 2]];
      if (zone && city.building[v] === zone.object && Math.hypot(rx - zone.x, ry - zone.y) < zone.r) inZone++;
      if (Math.abs(rx - x) < 12 && Math.abs(ry - y) < 12) out.push(rx, ry, rz);
    }
    if (zone && !game.zoneHit && inZone > 220 && (phase === 'play' || phase === 'grace')) {
      game.zoneHit = true;
      hud.banner('BULLSEYE', 'DROPPED IN THE RING');
      award(5000, [zone.x, zone.y, 0.5], 'BULLSEYE', 'huge');
      sounds.play('horn', 0.4, 0);
    }
    player.debris = Float32Array.from(out);
    player.debrisCount = out.length / 3;
    rbLap('rb.rubble');
    const crushAt: Hit[] = [];
    // Where each piece is by now, and its lowest voxels there (found once a piece: everything below asks for them)
    const lows = new Map<number, Float32Array>();
    for (const [k, slot] of sections.entries()) {
      const sec = physics.sections.get(slot);
      if (!sec) continue;
      const o = 12 * k;
      sec.pose = ahead([sectionData[o], sectionData[o + 1], sectionData[o + 2], sectionData[o + 8], sectionData[o + 9], sectionData[o + 10], sectionData[o + 11]], sectionData.subarray(o + 4, o + 7), sectionSpin.subarray(4 * k, 4 * k + 3), lag);
      lows.set(slot, physics.underside(slot, sec.pose, 16));
    }
    const lowest = (slot: number, n: number) => lows.get(slot)?.subarray(0, 3 * n) ?? new Float32Array(0);
    // The pieces that have all but stopped: another piece comes down on them as on rubble (few, while most still fall)
    const stopped = [...physics.sections.values()].filter((sec) => Math.hypot(sec.velocity[0], sec.velocity[1], sec.velocity[2]) < 1.5).map((sec) => sec.slot);
    const onStopped = (x: number, y: number, z: number, except: number) => stopped.some((s) => s !== except && physics.inBox(s, x, y, z));
    // Which pieces have another lying on them, however they lean: the pieces going slowly, by what's under their lowest voxels
    const loaded = new Set<number>();
    if (physics.sections.size > 1)
      for (const sec of physics.sections.values()) {
        if (Math.hypot(sec.velocity[0], sec.velocity[1], sec.velocity[2]) > 4) continue;
        const under = lowest(sec.slot, 9);
        for (let i = 0; i < under.length; i += 3) {
          const on = physics.sectionAt(under[i], under[i + 1], under[i + 2] - 0.3, sec.slot);
          if (on >= 0) loaded.add(on);
        }
      }
    for (const [k, slot] of sections.entries()) {
      const section = physics.sections.get(slot);
      if (!section) continue;
      const o = 12 * k;
      const vel = [sectionData[o + 4], sectionData[o + 5], sectionData[o + 6]];
      const jolt = Math.hypot(vel[0] - section.velocity[0], vel[1] - section.velocity[1], vel[2] - section.velocity[2]);
      const speed = Math.hypot(vel[0], vel[1], vel[2]);
      const age = now - section.born;
      section.before = section.velocity;
      section.velocity = [vel[0], vel[1], vel[2]];
      const pose = section.pose;
      if (zone && city.building[section.voxels[0]] === zone.object && Math.hypot(pose[0] - zone.x, pose[1] - zone.y) < zone.r && pose[2] < 4) inZone += section.voxels.length;
      const resting = age > 1 && speed < 0.5;
      // A piece that has barely moved for a while breaks whatever it's waiting on (two pieces resting on each
      // other used to wait for each other for ever: a whole storey stayed one rigid, unbreakable box)
      if (speed < 0.8) section.slowSince ??= now;
      else section.slowSince = undefined;
      // (Something resting on it: it carries a storey or more, and doesn't get to wait)
      const topZ = pose[2] + section.size[2] / 2 + 0.3;
      const carries = physics.sections.size > 1 && (loaded.has(slot) || physics.covered(slot, pose) || physics.inSection(pose[0], pose[1], topZ, slot));
      // (A piece resting on another falling piece waits for that one to go first, up to 8 s: broken up where
      // it rested, its rubble lay in the air once the piece under it went)
      let onAnother = false;
      if (!carries && section.slowSince !== undefined && physics.sections.size > 1) {
        const under = lowest(slot, 9);
        for (let i = 0; !onAnother && i < under.length; i += 3) for (let d = 0.3; !onAnother && d <= 1.3; d += VOXEL) onAnother = physics.inSection(under[i], under[i + 1], under[i + 2] - d, slot);
      }
      // Standing on its own loose, still-bonded parts (a tank on the legs that fell with it): snap them so it
      // comes down instead of stilting on them
      if (age > 0.3 && !params.has('nostilt')) {
        const low = lowest(slot, 16);
        let ground = false;
        const stilts: number[] = [];
        for (let i = 0; i < low.length; i += 3) {
          if (low[i + 2] < 1.2) ground = true;
          // (Down the whole column under it: a leg bonded all the way down is a stilt too)
          for (let dz = 0.4; dz <= low[i + 2] + 0.2; dz += 0.5)
            for (const [dx, dy] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
              const c = looseCells.get(cellOf(low[i] + dx, low[i + 1] + dy, low[i + 2] - dz));
              if (c) stilts.push(...c);
            }
        }
        if (stilts.length && !ground) {
          physics.snap(stilts);
          const s0 = stilts[0];
          physics.blast([livePos[3 * s0], livePos[3 * s0 + 1], livePos[3 * s0 + 2]], 1.5, 2.5);
        }
      }
      // Out of the world: laid to rest where it went
      if (sectionData[o + 2] <= PARKED_BELOW) {
        physics.shatter(slot, pose, vel, 0.02);
        unsettled = true;
        continue;
      }
      /**
       * How far down from its lowest voxels to what it's coming down on, within `reach` (m): the ground, anything
       * standing, rubble, debris lying still, another piece that has itself all but stopped. (One still falling
       * doesn't count: it waits on that one.)
       */
      const gapUnder = (reach: number, cells = stillCells): number => {
        const low = lowest(slot, 16);
        let gap = Infinity;
        for (let i = 0; i < low.length; i += 3) {
          const [lx, ly, lz] = [low[i], low[i + 1], low[i + 2]];
          if (!city.weightless) gap = Math.min(gap, Math.max(0, lz - VOXEL / 2));
          for (let d = VOXEL; d <= reach + VOXEL && d - VOXEL < gap; d += VOXEL)
            if (voxelAt(city, lx, ly, lz - d) >= 0 || physics.rubbleAt(lx, ly, lz - d) >= 0 || cells.has(cellOf(lx, ly, lz - d)) || (stopped.length > 0 && onStopped(lx, ly, lz - d, slot))) {
              gap = Math.min(gap, d - VOXEL);
              break;
            }
        }
        return gap;
      };
      /** The slam, once a piece: its sound, the shake, the score, and the crush on what it came down on. */
      const slam = (v: number, gap: number) => {
        if (section.landed) return;
        section.landed = true;
        const count = section.voxels.length;
        const first = section.voxels[0];
        const at = new THREE.Vector3(pose[0], pose[1], pose[2]);
        const distance = player.position.distanceTo(at);
        const low = lowest(slot, 12);
        if (low.length) effects.dust(low, 0.35, concreteDust);
        if (v > SECTION_JOLT) sounds.debrisHit(Sounds.material(city.material[first]), 'L', v, count, [pose[0], pose[1], pose[2]]);
        if (count > 200) {
          sounds.impact(Sounds.material(city.material[first]), Math.min(1, 0.3 + count / 3000), distance, 0, [pose[0], pose[1], pose[2]]);
          addTrauma(Math.min(0.6, count / 5000) / (1 + distance / 30));
          // (Scored as 1.6 scored it, so bests still compare: half a point a voxel of what a slam left whole then, and a
          // hard slam sent up to half the piece to dust before it was counted)
          const left = v > 4 ? 1 - Math.min(0.5, (v - 3) / 10) : 1;
          award(Math.round(count * 0.5 * left), at.toArray(), 'IMPACT', count > 1500 ? 'big' : 'small');
        }
        if (v > CRUSH_SPEED) for (let i = 0; i < low.length; i += 9) crushAt.push({ at: [low[i], low[i + 1], low[i + 2] - gap - 0.3], radius: RADII.crush(v)[0], radii: RADII.crush(v), push: v * 0.12, core: 0.35 });
      };
      /** A bite off its underside (physics.bite), with its dust and chips. False if there was no room for it. */
      const crumble = (v: number, depth: number, ride: boolean, way: number[], energy: number, why: string): boolean => {
        // (How hard it is to crush: by what it's made of, from a few of its voxels)
        let strength = 0;
        const step = Math.max(1, Math.floor(section.voxels.length / 24));
        let sampled = 0;
        for (let i = 0; i < section.voxels.length; i += step, sampled++) strength += MAT_BOND[city.material[section.voxels[i]] as Mat] ?? 1;
        strength = Math.min(2.5, Math.max(0.5, strength / Math.max(1, sampled)));
        const count = section.voxels.length;
        const tint = tintOf(section.voxels[0]);
        const r = physics.bite(slot, pose, v, depth, { energy: energy * strength, room: Math.max(0, looseCap - physics.loose), dustMax: DUST_MAX, ride, way, scatter: ride ? 0.5 : 2 });
        if (!r) return false;
        crumbleShort += r.short;
        const noRoom = !r.layers && r.short > 0;
        if (TESTING && (r.layers || noRoom)) collapseLog.push({ f: physicsSteps, what: noRoom ? 'no room' : 'bite', why, slot, n: count, v: +v.toFixed(2), depth: +depth.toFixed(2), ride, layers: r.layers, loose: r.loose.length, dust: r.dust.length, short: r.short, out: +r.speed.toFixed(2), gone: r.gone, z: +pose[2].toFixed(1), lag: +lag.toFixed(3), live: physics.loose, early: laidEarly });
        // (No room for it yet: it's still owed, and tried again at the next look)
        // (Only what drove it down: once it's stopped it is sent on straight down, never along the ground)
        const share = ride ? Math.abs(way[2]) : 1;
        if (noRoom) {
          section.crush = Math.max(section.crush ?? 0, v * share);
          return false;
        }
        section.crush = r.gone ? 0 : r.speed * share;
        if (r.dust.length) {
          // Crushed to powder where it was: chips and a puff of its dust there
          r.dust.forEach((u, i) => city.position.set(r.dustAt.subarray(3 * i, 3 * i + 3), 3 * u));
          chips.burst(r.dust.slice(0, 300), [pose[0], pose[1], pose[2] + 1], 1.5, 2 + v * 0.2);
          effects.dust(r.dustAt.subarray(0, Math.min(r.dustAt.length, 36)), 0.3 + Math.min(0.5, r.dust.length / 600), tint);
          game.voxelsBroken += r.dust.length;
        }
        if (r.layers) unsettled = true;
        return true;
      };
      const before = section.before ?? [0, 0, 0];
      const waited = section.slowSince !== undefined ? now - section.slowSince : 0;
      if (TESTING && params.has('sections') && Math.floor(physicsSteps / 6) % 5 === 0) collapseLog.push({ f: physicsSteps, what: 'state', slot, n: section.voxels.length, speed: +speed.toFixed(2), vz: +vel[2].toFixed(2), waited: +waited.toFixed(2), carries, onAnother, resting, crush: +(section.crush ?? 0).toFixed(1), z: +pose[2].toFixed(1), age: +age.toFixed(1), gap: +gapUnder(1).toFixed(2) });
      // About to come down on something: what would be driven into it before the next look crumbles now, while
      // it's still moving, so no piece ever stops whole and then turns to rubble
      const horizon = 0.1 + 1 / 60 + lag;
      let bitten = false;
      if (age > 0.15 && speed > CRUMBLE_SPEED && vel[2] < -1.5) {
        const fall = -vel[2] * horizon + 0.5 * 9.81 * horizon * horizon;
        const gap = gapUnder(fall, heapCells);
        if (gap < fall) {
          slam(speed, gap);
          crumble(speed, fall - gap, true, [vel[0] / speed, vel[1] / speed, vel[2] / speed], CRUSH_ENERGY, 'landing');
          bitten = true;
        }
      }
      if (!bitten) {
        // Stopped by what it hit before that saw it coming: what's left of its fall drives it on
        if (age > 0.2 && jolt > SECTION_JOLT && gapUnder(VOXEL) <= VOXEL) {
          slam(jolt, 0);
          if (-before[2] > CRUMBLE_SPEED && -before[2] > (section.crush ?? 0)) section.crush = -before[2];
        }
        const crush = section.crush ?? 0;
        if (crush > CRUMBLE_SPEED) {
          // (Owed its bites for a while yet: what there was no room for is done as room comes)
          if (waited > 6) section.crush = 0;
          else if (speed < crush * 0.5 && gapUnder(VOXEL) <= VOXEL) {
            crumble(crush, crush * horizon, false, [0, 0, -1], CRUSH_ENERGY, 'driven');
            bitten = true;
          }
        }
      }
      if (bitten) continue;
      // Going nowhere with another piece on top of it: it gives way under that, a layer a look, and goes on giving
      // way while it's loaded (every storey of a stack at once: the whole stack comes down through itself)
      if (!carries) section.giving = false;
      else if (waited > 0.3 || resting) section.giving = true;
      if (carries && section.giving && speed < GIVE_SPEED + 1.5) {
        crumble(GIVE_SPEED, VOXEL * 0.9, false, [0, 0, -1], 0, 'gives way');
        continue;
      }
      // At rest, or going nowhere for too long: it lies where it is as rubble, in its shape (what hangs falls again)
      const stale = (section.slowSince !== undefined && !onAnother && waited > 1.2) || (age > 8 && speed < 2);
      if (!resting && !stale) continue;
      if (!stale) {
        const low = lowest(slot, 16);
        let onSection = false;
        for (let i = 0; !onSection && i < low.length; i += 3) for (let d = 0.3; !onSection && d <= 1.3; d += VOXEL) onSection = physics.inSection(low[i], low[i + 1], low[i + 2] - d, slot);
        if (onSection) continue;
      }
      if (TESTING) collapseLog.push({ f: physicsSteps, what: 'laid', slot, n: section.voxels.length, speed: +speed.toFixed(2), age: +age.toFixed(2), z: +pose[2].toFixed(1), lag: +lag.toFixed(3) });
      const low = physics.shatter(slot, pose, vel, 0);
      if (low.length && speed > 0.2) effects.dust(low, 0.2, concreteDust);
      unsettled = true;
    }
    rbLap('rb.sections');
    if (zone && !game.zoneHit && inZone > 220 && (phase === 'play' || phase === 'grace')) {
      game.zoneHit = true;
      hud.banner('BULLSEYE', 'DROPPED IN THE RING');
      award(5000, [zone.x, zone.y, 0.5], 'BULLSEYE', 'huge');
    }
    if (crushAt.length) {
      const r = blasts(city, structure, physics, crushAt);
      afterBlast(r, crushAt);
      scored(r, crushAt[0].at);
      unsettled = true;
    }
    rbLap('rb.crush');
    const strikes = crushes.splice(0).filter(({ voxel }) => city.state[voxel] === State.Fixed);
    if (strikes.length) {
      const hits: Hit[] = strikes.map(({ voxel, speed }) => ({
        at: Array.from(city.position.subarray(3 * voxel, 3 * voxel + 3)),
        radius: 0.35 + Math.min(0.6, speed / 40),
        radii: RADII.crush(speed),
        push: speed * 0.2,
        core: 0.25,
      }));
      const result = blasts(city, structure, physics, hits);
      unsettled = true;
      afterBlast(result, hits);
      result.hits.forEach((hit, k) => chips.burst([...hit.gone, ...hit.loose], hits[k].at, 2, strikes[k].speed * 0.3));
      dustAt([...result.gone, ...result.loose, ...result.falling.filter((_, k) => k % 6 === 0)], 0.5);
      const near = new THREE.Vector3(...hits[0].at);
      if (result.falling.length > 50) sounds.collapse(result.falling.length, player.position.distanceTo(near), [near.x, near.y, near.z]);
      else sounds.hammer(player.position.distanceTo(near) * 0.3, [near.x, near.y, near.z]);
      scored(result, hits[0].at);
    }
    rbLap('rb.strikes');
    if (unsettled) settleUntil = now + SETTLE_WATCH;
    unsettled = false;
    if ((now < settleUntil && now - lastSettle > 0.3) || now - lastSettle > 3) {
      // A full check now and then (debris that drifted off a ledge), otherwise only where things changed
      const full = now - lastFullSettle > 8;
      if (full) lastFullSettle = now;
      lastSettle = now;
      const ts = performance.now();
      physics.settle(still, full);
      lastSettleMs = performance.now() - ts;
      settleCount++;
    }
    rbLap('rb.settle');
    // Nothing hovers: rubble with nothing under it falls, a mass of it as bodies (four times a second while
    // anything is moving at all, once a second otherwise), and so does anything fixed the chunk graph says is cut
    // off. (It was every 2 s once the settle watch ran out: debris still sliding out from under a frozen voxel
    // left it hanging for up to two seconds.)
    const stirring = now < settleUntil || physics.loose > 0 || physics.sections.size > 0;
    if (now - lastHover > (stirring ? 0.25 : 1)) {
      lastHover = now;
      lastStill = still;
      dropHovering(still);
      for (const [i, t] of structure.lastHit) {
        if (now - t > 6) continue;
        if (structure.unsupported(i).length) {
          const r = blasts(city, structure, physics, [], [i]);
          nothingHovers.cutOff += r.falling.length;
          unsettled = true;
        }
      }
    }
    lap('readback', readStart);
  } finally {
    reading = false;
  }
}

// ---------- the replay camera ----------
const cam = {
  active: false,
  kind: 'kill' as 'kill' | 'end',
  t: 0,
  hold: 1.9,
  centre: new THREE.Vector3(),
  radius: 12,
  angle: 0,
  height: 6,
  skip: false,
  lastAt: -100,
};
let camDue: { at: number; centre: THREE.Vector3; size: number } | null = null;
/** Roll the replay camera on a big collapse, a beat after it starts (once the fireball has burst). */
function killcam(centre: THREE.Vector3, size: number): void {
  if (phase !== 'play' && phase !== 'grace' && phase !== 'free') return;
  if (cam.active || camDue || simTime - cam.lastAt < 9 || params.has('nocam')) return;
  camDue = { at: simTime + 0.22, centre: centre.clone(), size };
}
function rollCam(centre: THREE.Vector3, size: number): void {
  cam.active = true;
  cam.kind = 'kill';
  cam.t = 0;
  cam.skip = false;
  cam.hold = 1.9;
  cam.lastAt = simTime;
  cam.centre.copy(centre);
  cam.centre.z = Math.max(2, centre.z * 0.7);
  cam.radius = Math.min(30, 15 + Math.sqrt(size) * 0.12);
  cam.height = cam.radius * 0.22;
  // From the side the player watches, a little round
  cam.angle = Math.atan2(player.position.y - centre.y, player.position.x - centre.x) + (Math.random() < 0.5 ? -0.55 : 0.55);
  hud.cine(true);
  sounds.slowMo(true);
  // Recorded while it plays: the best of these are on the results to watch again
  replays.capture(cam.hold + 0.9, size, size > 20000 ? 'TOTAL COLLAPSE' : size > 5000 ? 'COLLAPSE' : 'TOPPLED');
}
function endCam(): void {
  cam.active = true;
  cam.kind = 'end';
  cam.t = 0;
  cam.centre.set(...level.focus);
  cam.radius = level.id === 2 ? 34 : 19;
  cam.height = cam.radius * 0.5;
  cam.angle = Math.atan2(player.position.y - level.focus[1], player.position.x - level.focus[0]);
}

// ---------- the loop ----------
const fireAt: number[] = [];
/** How blinded the player is by smoke (0..1, eased), and the lot's own fog. */
let smokeVeil = 0;
let baseFog = 0.0075;
const earForward = new THREE.Vector3();
const earUp = new THREE.Vector3();
let last = performance.now();
let accumulator = 0;
let fps = 60;
let simTime = 0;
let timeScale = 1;
let demoClock = 0;
/** Physics steps taken (each 1/60 s of the world): on a slow machine the world falls behind the wall clock. */
let physicsSteps = 0;
/** Tests: the loop stands still and the bot steps frames by hand (frame-stepped clips, the jump detector). */
let manualClock = false;
const jumps = new JumpDetector();
/** Tests: where each voxel was drawn at the last restProbe. */
let restSeen = new Float32Array(0);
/** Tests: what the section loop did (break-ups, bites, landings), a record each. */
const collapseLog: Record<string, unknown>[] = [];
function frame(now: number): void {
  if (!tuning && !manualClock) tick(now);
  requestAnimationFrame(frame);
}
/** One frame at time `now` (ms): input, the game, physics, effects, the render. */
/** Where the frame's CPU time goes (ms, the worst of the last second per part), for ?debug and the bot. */
const rbProf: Record<string, number> = {};
const prof = { input: 0, physics: 0, game: 0, camera: 0, effects: 0, render: 0, readback: 0, total: 0, at: 0 };
const profNow = { input: 0, physics: 0, game: 0, camera: 0, effects: 0, render: 0, readback: 0, total: 0, at: 0 };
function lap(part: keyof typeof prof, since: number): number {
  const t = performance.now();
  profNow[part] = Math.max(profNow[part], t - since);
  return t;
}
function tick(now: number): void {
  if (swapping) {
    last = now;
    return;
  }
  const began = performance.now();
  if (began - profNow.at > 1000) {
    Object.assign(prof, profNow);
    for (const k of Object.keys(profNow) as (keyof typeof prof)[]) profNow[k] = 0;
    profNow.at = began;
  }
  let lapAt = began;
  const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  padStep(now);
  const playing = active();

  // Time: the replay camera slows the world, a hit-stop freezes it for a few hundredths
  let want = 1;
  if (cam.active && cam.kind === 'kill') {
    cam.t += dt;
    const t = cam.t;
    const end = cam.hold + 0.4;
    if (cam.skip && t < cam.hold) cam.t = cam.hold;
    want = t < 0.08 ? 1 - (0.8 * t) / 0.08 : t < cam.hold ? 0.2 : t < end ? 0.2 + (0.8 * (t - cam.hold)) / 0.4 : 1;
    if (t >= end) {
      cam.active = false;
      hud.cine(false);
      sounds.slowMo(false);
    }
    if (calloutDue && t >= cam.hold) {
      hud.banner(calloutDue[0], calloutDue[1], true);
      calloutDue = null;
    }
  }
  if (hitstop > 0) {
    hitstop -= dt;
    want = 0;
  }
  if (paused) want = 0;
  timeScale = want;

  if (turning) {
    turning.t += dt;
    const u = Math.min(1, turning.t / turning.seconds);
    const e = u * u * (3 - 2 * u);
    player.yaw = turning.from[0] + (turning.to[0] - turning.from[0]) * e;
    player.pitch = turning.from[1] + (turning.to[1] - turning.from[1]) * e;
    if (u >= 1) turning = null;
  }
  if (playing) {
    turn(dt);
    cooldown -= dt;
    const move = input();
    const stride = Math.floor(player.walk / Math.PI);
    if (riding) {
      // In the seat: you go where the machine goes (for the lot's edge, the sounds, the tests)
      if (machineCam) {
        riding.seat(eye);
        player.position.set(eye.x, eye.y, 0);
      }
      player.velocity.set(0, 0, 0);
    } else player.update(dt, move);
    // The lot's edge
    const b = level.bounds;
    player.position.x = Math.max(-b, Math.min(b, player.position.x));
    player.position.y = Math.max(-b, Math.min(b, player.position.y));
    if (player.onGround && Math.floor(player.walk / Math.PI) !== stride) sounds.step(keys.has('ShiftLeft') || padSprint);
    if (player.landed > 4) {
      sounds.land(player.landed);
      dip = Math.min(0.25, player.landed * 0.02);
      hand.land(player.landed);
    }
    // The tool: the sledge winds up while held and swings on release; the others fire on click
    if (riding) {
      hud.chargeRing(0);
      hud.prompt(null);
    } else if (tool === SLEDGE) {
      if ((held || padHeld) && cooldown <= 0) {
        sledgeCharge = Math.min(1, sledgeCharge + dt / 0.6);
        if (sledgeCharge >= 1 && hand.charge < 1) sounds.blip(220, 0.05, 0.1, 'sawtooth');
      } else if (sledgeCharge > 0) {
        swingSledge(sledgeCharge > 0.35 ? sledgeCharge : 0);
        cooldown = 0.38;
        sledgeCharge = 0;
      }
      hand.charge = sledgeCharge;
      hud.chargeRing(sledgeCharge);
    } else if (tool === JACK) {
      const on = held || padHeld;
      hand.running = on;
      sounds.jackMotor(on);
      if (on && simTime - jackAt > TOOLS[JACK].cooldown) {
        jackAt = simTime;
        jackHit();
      }
      // The ring fills as it works through the spot
      hud.chargeRing(on ? jackWork / JACK_BREAK : 0);
    } else {
      hud.chargeRing(0);
      if (wantFire && cooldown <= 0) {
        useTool();
        cooldown = TOOLS[tool].cooldown;
      }
    }
    if (!riding) {
      const near = machineNear();
      hud.prompt(near ? `<b>F</b> Climb into the ${near.kind}` : null);
    }
    if ((tool !== JACK || riding) && hand.running) {
      hand.running = false;
      sounds.jackMotor(false);
    }
    wantFire = false;
  } else {
    wantFire = false;
    hud.chargeRing(0);
  }
  for (let k = blows.length - 1; k >= 0; k--) {
    if (blows[k].due > now / 1000) continue;
    const [b] = blows.splice(k, 1);
    sledgeLands(b.power);
  }

  lapAt = lap('input', lapAt);
  // Physics at 60 Hz of the world's clock, at most two steps a frame
  const sim = dt * timeScale;
  simTime += sim;
  accumulator += sim;
  let steps = 0;
  while (accumulator >= 1 / 60 && steps < 2) {
    physics.step();
    physicsSteps++;
    if (lagWaits.length) for (const w of lagWaits.splice(0)) (w.at <= physicsSteps ? w.done() : lagWaits.push(w));
    accumulator -= 1 / 60;
    steps++;
  }
  if (steps === 2) accumulator = 0;
  if (++frames % 6 === 0) readDebris().catch(() => {});
  lapAt = lap('physics', lapAt);
  ballHits();
  updateOccupancy(dt);
  if (sea) {
    sea.update(sim);
    splashDown();
    pourTank(sim);
    // Wading: slower, and the jump shorter, the deeper you stand
    const depth = physics.inWater(player.position.x, player.position.y, player.position.z + 0.05) ? sea.level - player.position.z : 0;
    player.slow = depth > 0 ? Math.max(0.4, 1 - depth * 0.6) : 1;
  } else player.slow = 1;
  updateMachines(sim);
  updateRockets(sim);
  chargesDue();
  for (let k = fuses.length - 1; k >= 0; k--) {
    if (fuses[k].due > simTime) continue;
    const [f] = fuses.splice(k, 1);
    game.barrelsBlown++;
    const s = f.scale;
    explode(f.at, RADII.propane[0] * s, 13 * s, { fire: 2.2 * s, sample: 'propane', radii: [RADII.propane[0] * s, RADII.propane[1] * s, RADII.propane[2] * s] });
    award(500 * Math.round(s * s), f.at.toArray(), s > 1.4 ? 'MEGA KABOOM' : 'KABOOM', 'big');
  }
  gasDue();
  updatePipes(sim);
  burn();
  if (camDue && simTime >= camDue.at) {
    const d = camDue;
    camDue = null;
    if (phase === 'play' || phase === 'grace' || phase === 'free') rollCam(d.centre, d.size);
  }

  // The game's clock, the job, the end
  updateGame(dt);
  watchLoads(dt);
  lapAt = lap('game', lapAt);

  // Camera
  const c = view.camera;
  player.eye(eye);
  player.look(dir);
  // Shake: the square of the trauma, rotation only (2° yaw and pitch, 3.5° roll at most), noise at about 18 Hz
  trauma = Math.max(0, trauma - dt);
  const shakeNow = trauma * trauma * (settings.shake ? 1 : 0.15);
  const t = now / 1000;
  const wander = (k: number) => Math.sin(t * 113 + k * 1.7) * 0.5 + Math.sin(t * 89 + k * 4.1) * 0.3 + Math.sin(t * 151 + k) * 0.2;
  // A big collapse's ground rumble: slow (6 Hz), on pitch alone, ±0.6°
  const rumbling = simTime < rumbleUntil ? Math.min(1, rumbleUntil - simTime) * (settings.shake ? 1 : 0.15) : 0;
  const rumblePitch = rumbling * 0.0105 * (Math.sin(t * 37.7) * 0.6 + Math.sin(t * 23.1 + 1) * 0.4);
  dip *= Math.exp(-dt * 10);
  let fov = settings.fov + ((keys.has('ShiftLeft') || padSprint) && Math.hypot(player.velocity.x, player.velocity.y) > 6 ? 5 : 0);
  // FOV kick: a spring back to rest
  fovVel += (-fovKick * 120 - fovVel * 16) * dt;
  fovKick += fovVel * dt;
  let tilt = 0;
  let showHand = playing || phase === 'grace';
  if (phase === 'title' || phase === 'loading') {
    // The attract view: a slow orbit of the first lot at golden hour
    demoClock += dt;
    const a = -1.9 + demoClock * 0.05;
    const [fx, fy, fz] = level.focus;
    c.position.set(fx + Math.cos(a) * 21, fy + Math.sin(a) * 21, 7.5);
    c.lookAt(fx, fy, fz + 1.5);
    tilt = 0.55;
    showHand = false;
  } else if (phase === 'intro') {
    // Fly in from the contract's establishing shot to the player's eye
    game.introT += dt;
    const u = Math.min(1, game.introT / 2.6);
    const e = u * u * (3 - 2 * u);
    const from = new THREE.Vector3(...level.intro.from);
    const lookFrom = new THREE.Vector3(...level.intro.look);
    const lookTo = eye.clone().add(dir.clone().multiplyScalar(10));
    const mid = from.clone().lerp(eye, 0.5).add(new THREE.Vector3(0, 0, 4 * (1 - e)));
    c.position.copy(from.clone().lerp(mid, e).lerp(mid.clone().lerp(eye, e), e));
    c.lookAt(lookFrom.lerp(lookTo, e * e));
    tilt = 0.4 * (1 - e);
    showHand = u > 0.85;
    if (u >= 1) {
      phase = 'play';
      hud.hint(TOOLS[tool].hint);
      if (levelId === 0) hud.hint('Shoot the <b>red tanks</b> by the house');
      if (levelId === 1) hud.hint('Cut the legs on the <b>ring&#8217;s side</b>: it falls toward the cut');
      if (levelId === 2) hud.hint('Girders and the concrete core take a charge · <b>L</b> shows the load on each storey');
    }
  } else if (cam.active) {
    cam.t += cam.kind === 'end' ? dt : 0;
    const spin = cam.kind === 'kill' ? cam.t * 0.22 : cam.t * 0.12;
    const a = cam.angle + spin;
    c.position.set(cam.centre.x + Math.cos(a) * cam.radius, cam.centre.y + Math.sin(a) * cam.radius, cam.centre.z + cam.height);
    c.position.z = Math.max(1.2, c.position.z);
    c.lookAt(cam.centre);
    tilt = cam.kind === 'kill' ? 0.8 : 0.6;
    showHand = false;
    fov = 55;
  } else if (riding && machineCam) {
    // Behind and above the machine, turned by the mouse: the crane's view takes in the ball, the excavator's its arm
    const f = riding.focus(new THREE.Vector3());
    let far = riding instanceof Crane ? 17 : 9.5;
    // (Pulled in short of a wall behind)
    const back = raycast(city, f.toArray(), dir.clone().negate().toArray(), far);
    if (back) far = Math.max(2.5, back.t - 0.5);
    c.position.copy(f).addScaledVector(dir, -far);
    // (The crane's view from over the cab's shoulder, so the boom doesn't stand in the middle of it)
    if (riding instanceof Crane) c.position.add(new THREE.Vector3(Math.sin(player.yaw), -Math.cos(player.yaw), 0).multiplyScalar(-5)).add(new THREE.Vector3(0, 0, 2));
    c.position.z = Math.max(1.2, c.position.z);
    c.lookAt(c.position.clone().add(dir));
    c.rotateX(wander(4) * shakeNow * 0.0349 + rumblePitch);
    c.rotateY(wander(5) * shakeNow * 0.0349);
    c.rotateZ(wander(6) * shakeNow * 0.0611);
    showHand = false;
  } else {
    c.position.copy(eye).add(new THREE.Vector3(0, 0, -dip));
    c.lookAt(eye.clone().add(dir));
    c.rotateX(wander(4) * shakeNow * 0.0349 + rumblePitch);
    c.rotateY(wander(5) * shakeNow * 0.0349);
    c.rotateZ(wander(6) * shakeNow * 0.0611);
  }
  hand.object.visible = showHand;
  // The ears go where the camera goes (z up)
  c.getWorldDirection(earForward);
  earUp.set(0, 1, 0).applyQuaternion(c.quaternion);
  sounds.listen([c.position.x, c.position.y, c.position.z], [earForward.x, earForward.y, earForward.z], [earUp.x, earUp.y, earUp.z]);
  fov += fovKick;
  if (Math.abs(c.fov - fov) > 0.05) {
    c.fov += (fov - c.fov) * Math.min(1, dt * (cam.active ? 4 : 14));
    c.updateProjectionMatrix();
  }
  // Depth of field: background soft beyond the lot; the replay camera's tilt-shift
  view.tilt.value += (tilt - view.tilt.value) * Math.min(1, dt * 5);
  const toFocus = cam.active || phase === 'title' || phase === 'intro' ? c.position.distanceTo(cam.active ? cam.centre : new THREE.Vector3(...level.focus)) : 30;
  view.setFocus(cam.active || phase === 'title' ? toFocus : Math.max(30, toFocus), cam.active || phase === 'title' ? 8 : 90, settings.dof && view.quality === 'high' ? (cam.active || phase === 'title' ? 6 : 4) : 0);
  view.saturation.value = 1.2 + (cam.active && cam.kind === 'kill' ? 0.15 : 0);
  pulse *= Math.exp(-dt * 7);
  view.pulse.value = 1 + pulse;
  const pace = Math.hypot(player.velocity.x, player.velocity.y);
  hand.update(dt * (timeScale === 0 && hitstop > 0 ? 0.2 : 1), player.walk, player.onGround ? Math.min(1, pace / 9) : 0, (keys.has('ShiftLeft') || padSprint) && pace > 6);
  view.glow = Math.max(0.35, (view as unknown as { bloomPass: { strength: { value: number } } }).bloomPass.strength.value - dt * 1.5);
  if (playing && !riding) {
    const a = aim(TOOLS[tool].reach);
    hud.aim(!!a && a.voxel >= 0);
  }
  lapAt = lap('camera', lapAt);
  if (calloutDue && !cam.active && !camDue) {
    hud.banner(calloutDue[0], calloutDue[1], true);
    calloutDue = null;
  }
  // The light pool: blasts fade, the two nearest fires take what's free
  if (fires.length) {
    const near = fires.map((f) => f.at).sort((a, b) => a.distanceToSquared(c.position) - b.distanceToSquared(c.position)).slice(0, 2);
    fireAt.length = 0;
    for (const p of near) fireAt.push(p.x, p.y, p.z);
  } else fireAt.length = 0;
  view.updateLights(sim, fireAt, 40 * LIGHT_SCALE);
  dustiness *= Math.exp(-sim / 25);
  view.dust = dustiness;
  alarms.update();
  impacts.update(dt);
  adaptSmoke(dt);
  chips.update(sim);
  shards.update(sim);
  effects.update(sim, c);
  sky.update(c, now / 1000);
  view.heatClock.value = simTime;
  view.update(phase === 'play' || phase === 'grace' || phase === 'free' ? player.position : new THREE.Vector3(...level.focus), sky.sunColor, sunStrength, sky.horizon);
  lapAt = lap('effects', lapAt);
  view.render();
  lapAt = lap('render', lapAt);
  lap('total', began);
  timeWork(began);
  hud.tick(dt);
  hud.slot(CANNON, '', tool === CANNON ? 1 - Math.max(0, cooldown) / TOOLS[CANNON].cooldown : 1);
  const delay = fuseDelay ? ` ·${fuseDelay}s` : '';
  hud.slot(CHARGE, `${game.charges}${delay}`, 1);
  hud.slot(SLEDGE, '', 1);
  hud.slot(CUTTER, `${game.cutters}${delay}`, 1);
  hud.slot(JACK, '', 1);
  hud.slot(ROCKET, unlimited() ? '∞' : `${game.rockets}`, tool === ROCKET ? 1 - Math.max(0, cooldown) / TOOLS[ROCKET].cooldown : 1);
  hud.slot(PIPE, unlimited() ? '∞' : `${game.pipes}`, 1);
  hud.slot(PLANK, unlimited() ? '∞' : `${game.planks}`, 1);
  if (VEHICLES) hud.slot(CABLE, unlimited() ? '∞' : `${game.cables}`, 1);
  rigPreview();
  // Thick smoke round the player blots the view out (fires near, or a blast's dust)
  let smokeNear = 0;
  for (const f of fires) {
    const d = f.at.distanceTo(c.position);
    if (d < 9) smokeNear += (1 - d / 9) * 0.2;
  }
  smokeNear = Math.min(1, smokeNear + Math.max(0, dustiness - 0.6) * 0.5);
  smokeVeil += (smokeNear - smokeVeil) * Math.min(1, dt * 1.5);
  hud.smoke(smokeVeil);
  (view.scene.fog as THREE.FogExp2).density = baseFog * (1 + smokeVeil * 6);
  if (frames % 15 === 0) hud.stats(`${fps.toFixed(0)} fps\n${city.count.toLocaleString()} voxels · ${physics.loose.toLocaleString()} loose`);
}

// ---------- the load, made readable ----------
/**
 * Four times a second, the job's objects and anything hit in the last 5 s: how near its most loaded storey is to
 * giving way (structure.ts stress, 1 = it goes). From 80%: it creaks (wood, steel) or groans (masonry), dust
 * trickles from that storey, and the HUD shows the load; from 95% a voxel or two lets go. A storey carried by
 * steel sags for a moment before it goes (destruction.ts): it creaks hard meanwhile, then lets go here.
 */
let loadAt = 0;
const creakAt = new Map<number, number>();
const trickleAt = new Map<number, number>();
const tellAt = new Map<number, number>();
let overlayAt = 0;
let overlayOn = false;
/** Loads seen (tests): creaks played, trickles, tells (voxels let go), sags that let go. */
const loadStats = { creaks: 0, trickles: 0, tells: 0, sagged: 0, maxR: 0 };
function storeyName(z: number): string {
  if (level.id === 1) return z < 48 ? 'LEGS' : 'TANK';
  if (level.id === 2) return z < 18 ? 'GROUND FLOOR' : `STOREY ${2 + Math.floor((z - 18) / 12)}`;
  return z <= 12 ? 'GROUND FLOOR' : 'UPSTAIRS';
}
function layerPoint(i: number, z: number): [number, number, number] {
  const o = city.buildings[i];
  return [(o.x0 + o.w / 2) * VOXEL, (o.y0 + o.d / 2) * VOXEL, (z + 0.5) * VOXEL];
}
function watchLoads(dt: number): void {
  if (!physics || (phase !== 'play' && phase !== 'grace' && phase !== 'free' && phase !== 'intro')) {
    hud.load(null);
    return;
  }
  // Sagging frames let go when their time is up
  const now = performance.now() / 1000;
  for (const [i, due] of [...structure.fatigue]) {
    if (now < due) continue;
    const result = blasts(city, structure, physics, [], [i]);
    // (If it didn't let go after all, it's done sagging)
    if (structure.fatigue.get(i) === due) structure.fatigue.delete(i);
    unsettled = true;
    loadStats.sagged++;
    const at = layerPoint(i, structure.stress(i).z);
    afterBlast(result, [{ at }]);
    scored(result, at);
    sounds.creak('steel', 1, at);
  }
  loadAt -= dt;
  if (loadAt > 0) return;
  loadAt = 0.25;
  const watch = new Set<number>(level.targets);
  for (const [i, t] of structure.lastHit) if (now - t < 5) watch.add(i);
  let job = { r: 0, z: -1 };
  for (const i of watch) {
    const { z, r } = structure.stress(i);
    if (z < 0) continue;
    if (level.targets.includes(i) && r > job.r) job = { r, z };
    loadStats.maxR = Math.max(loadStats.maxR, Math.min(r, 5));
    const sagging = structure.fatigue.has(i);
    if (r < 0.8 && !sagging) continue;
    // (Small things, a fence, a crate, carry too little to creak about)
    if (!level.targets.includes(i) && structure.layerCounts(i).reduce((n, c) => n + c, 0) < 300) continue;
    const m = structure.layerMaterial(i, z);
    const at = layerPoint(i, z);
    // A creak or a groan, at most one each 0.8 s (sagging steel: every 0.5 s, loud)
    if (now - (creakAt.get(i) ?? 0) > (sagging ? 0.5 : 0.8)) {
      creakAt.set(i, now);
      sounds.creak(m === Mat.Wood ? 'wood' : m === Mat.Steel || m === Mat.Girder ? 'steel' : 'masonry', sagging ? 1 : Math.min(1, r), at);
      loadStats.creaks++;
    }
    // Dust trickling from that storey: three of its voxels, every 0.4 s
    if (now - (trickleAt.get(i) ?? 0) > 0.4) {
      trickleAt.set(i, now);
      const layer = structure.layerVoxels(i, z);
      if (layer.length) {
        const pts = new Float32Array(9);
        for (let k = 0; k < 3; k++) {
          const v = layer[(Math.random() * layer.length) | 0];
          pts.set(city.position.subarray(3 * v, 3 * v + 3), 3 * k);
        }
        effects.dust(pts, 0.05, tintOf(layer[0]));
        loadStats.trickles++;
      }
    }
    // Near giving way: a voxel or two lets go (once a second)
    if ((r >= 0.95 || sagging) && now - (tellAt.get(i) ?? 0) > 1) {
      tellAt.set(i, now);
      const layer = structure.layerVoxels(i, z).filter((v) => !isGlassMat(city.material[v]));
      const n = Math.min(layer.length, 1 + (Math.random() < 0.5 ? 1 : 0));
      const go: number[] = [];
      for (let k = 0; k < n; k++) go.push(layer[(Math.random() * layer.length) | 0]);
      const uniq = [...new Set(go)];
      if (uniq.length) {
        structure.leave(uniq);
        physics.loosen(uniq);
        unsettled = true;
        loadStats.tells += uniq.length;
      }
    }
  }
  if (job.z >= 0 && job.r >= 0.75 && phase !== 'intro') hud.load(`${storeyName(job.z)} · ${Math.round(Math.min(job.r, 1) * 100)}% LOAD`, job.r, job.r > 0.95);
  else hud.load(null);
  // The load overlay (L): every storey of the job by its load
  if (overlayOn && now - overlayAt > 0.5) {
    overlayAt = now;
    const bodies: number[] = [];
    const values: number[] = [];
    for (const i of level.targets) {
      const s = structure.layerStress(i);
      for (let z = 0; z < s.length; z++) {
        if (s[z] < 0.5) continue;
        for (const v of structure.layerVoxels(i, z)) {
          bodies.push(physics.body[v]);
          values.push(s[z]);
        }
      }
    }
    view.setStress(bodies, values);
  }
}
const isGlassMat = (m: number) => m === Mat.Glass || m === Mat.LitGlass;

/** The clock, the job's progress, the shed, the end of the contract. */
let jobAt = 0;
function updateGame(dt: number): void {
  if (phase !== 'play' && phase !== 'grace' && phase !== 'end' && phase !== 'free') return;
  // The job's share down, four times a second
  jobAt -= dt;
  if (jobAt <= 0) {
    jobAt = 0.25;
    let fixed = 0;
    let kept = 0;
    // (A piece still falling whole doesn't count as down until it lands and breaks)
    for (const v of targetVoxels) if (city.state[v] === State.Fixed || city.state[v] === State.Carried) fixed++;
    for (const v of keepVoxels) if (city.state[v] === State.Fixed) kept++;
    game.demolition = 1 - fixed / targetTotal;
    game.keepShare = kept / keepTotal;
    if (heist.on) hud.keep(heist.state === 'prep' ? 'No clock until you take something' : heist.state === 'alarm' ? (requiredLeft() ? `${requiredLeft()} required piece${requiredLeft() > 1 ? 's' : ''} left` : 'Get to the truck!') : '', heist.state === 'alarm');
    else hud.job(game.demolition, level.stars, level.job.toUpperCase());
    if (heist.on) {
      // (the heist's panel: updateHeist)
    } else if (level.keep.length) hud.keep(`${level.keepName}: ${Math.round(game.keepShare * 100)}% standing${game.keepShare >= 0.9 ? ' · bonus kept' : ' · bonus lost'}`, game.keepShare < 0.9);
    else if (level.zone) hud.keep(game.zoneHit ? 'In the ring: bonus earned' : 'Drop it in the ring for a bonus', false);
    else hud.keep('', false);
  }
  if (simTime - game.comboAt > 1.5 && game.combo > 1) game.combo = 1;
  hud.score(game.score, game.combo, Math.max(0, 1 - (simTime - game.comboAt) / 1.5));
  if (heist.on && (phase === 'play' || phase === 'end')) {
    updateHeist(dt);
  } else if (phase === 'play' && mode === 'sandbox') {
    hud.clock(0, 'SANDBOX');
  } else if (phase === 'play' && mode === 'blowdown') {
    // No clock: plan, then blow it once; the result once it has settled (or 15 s after)
    if (blownAt < 0) hud.clock(0, 'PLANNING');
    else {
      hud.clock(Math.max(0, simTime - blownAt), 'BLOWDOWN');
      const quiet = physics.sections.size === 0 && physics.loose < 400 && placed.length === 0;
      if (!cam.active && ((quiet && simTime - blownAt > 4) || simTime - blownAt > 15)) finish();
    }
  } else if (phase === 'play') {
    if (!cam.active && !paused) game.timeLeft -= dt;
    hud.clock(game.timeLeft);
    if (game.timeLeft <= 10 && Math.ceil(game.timeLeft) !== Math.ceil(game.timeLeft + dt) && game.timeLeft > 0) sounds.blip(880, 0.07, 0.07, 'square');
    if (game.demolition >= level.stars[2] && !game.demolishedCalled) {
      game.demolishedCalled = true;
      game.timeLeftAtDemolish = game.timeLeft;
      hud.banner('DEMOLISHED', 'THREE STARS · TIME BONUS');
      game.timeLeft = Math.min(game.timeLeft, 0.01);
    }
    if (game.timeLeft <= 0) {
      phase = 'grace';
      game.grace = 4;
      sounds.play('whistle', 0.6, 0, { spread: 0.02 }) || sounds.blip(660, 0.1, 0.4);
      if (!game.demolishedCalled) hud.banner("TIME'S UP", 'LET IT SETTLE');
    }
  } else if (phase === 'free') {
    hud.clock(0, 'FREE PLAY');
  } else if (phase === 'grace') {
    game.grace -= dt;
    hud.clock(0, 'SETTLING');
    // A collapse under way gets to finish (up to 6 s more): you can't cut off a falling tower
    const busy = physics.sections.size > 0 || physics.loose > 2500;
    if (game.grace <= 0 && !cam.active && (!busy || game.grace < -6)) finish();
  }
}

/**
 * A blowdown's result: how much of the job came down, how much of it landed in its own footprint (its plot, two
 * metres round, or the ring), and what else got hit (collateral).
 */
function blowdownResult(): { share: number; inside: number; collateral: number } {
  let [inside, outside] = [0, 0];
  const boxes = level.targets.map((i) => {
    const o = city.buildings[i];
    return [o.x0 * VOXEL - 2, o.y0 * VOXEL - 2, (o.x0 + o.w) * VOXEL + 2, (o.y0 + o.d) * VOXEL + 2];
  });
  for (const v of targetVoxels) {
    const st = city.state[v];
    if (st === State.Fixed || st === State.Gone) continue;
    const [x, y] = st === State.Rubble ? [physics.rest[7 * v], physics.rest[7 * v + 1]] : [livePos[3 * v], livePos[3 * v + 1]];
    // (A lot with a ring: it's to be felled into it, so the line from where it stood to the ring counts too)
    const z = level.zone;
    let inZone = false;
    if (z) {
      const o = city.buildings[z.object];
      const [ox, oy] = [(o.x0 + o.w / 2) * VOXEL, (o.y0 + o.d / 2) * VOXEL];
      const [lx, ly] = [z.x - ox, z.y - oy];
      // (A felled tower lands in a fan: bricks skid on past the ring and spray to the sides of the line)
      const u = Math.max(0, Math.min(1.2, ((x - ox) * lx + (y - oy) * ly) / (lx * lx + ly * ly)));
      inZone = Math.hypot(x - (ox + lx * u), y - (oy + ly * u)) < Math.max(4.5, z.r) || Math.hypot(x - z.x, y - z.y) < z.r + 3;
    }
    if (inZone || boxes.some((b) => x > b[0] && x < b[2] && y > b[1] && y < b[3])) inside++;
    else outside++;
  }
  let collateral = 0;
  for (let v = 0; v < city.count; v++) if (!targetSet.has(city.building[v]) && city.state[v] !== State.Fixed) collateral++;
  return { share: game.demolition, inside: inside + outside ? inside / (inside + outside) : 1, collateral };
}

function finish(): void {
  phase = 'end';
  if (mode === 'blowdown') {
    finishBlowdown();
    return;
  }
  const share = game.demolition;
  const stars = level.stars.filter((s) => share >= s).length;
  const rows: [string, string][] = [[`${level.job} demolished`, `${Math.floor(share * 100)}%`]];
  let bonus = 0;
  if (level.keep.length) {
    const kept = game.keepShare >= 0.9;
    rows.push([`${level.keepName} left standing`, kept ? '+3,000' : `${Math.round(game.keepShare * 100)}% · no bonus`]);
    if (kept && share > 0.3) bonus += 3000;
  }
  if (level.zone) rows.push(['Dropped in the ring', game.zoneHit ? 'yes' : 'no']);
  const timeBonus = game.demolishedCalled ? Math.round(Math.max(0, game.timeLeftAtDemolish) * 100) : 0;
  rows.push(['Best combo', `x${game.bestCombo.toFixed(2)}`]);
  rows.push(['Biggest collapse', `${game.biggest.toLocaleString()} voxels`]);
  if (game.barrelsBlown) rows.push(['Tanks blown', `${game.barrelsBlown}`]);
  if (timeBonus) rows.push(['Time bonus', `+${timeBonus.toLocaleString()}`]);
  game.score += bonus + timeBonus;
  const best = game.score > (progress.best[levelId] ?? 0);
  if (best) progress.best[levelId] = game.score;
  const had = starTotal();
  progress.stars[levelId] = Math.max(progress.stars[levelId] ?? 0, stars);
  save();
  unlockedRows(rows, had);
  const title = stars === 3 ? 'Demolished' : stars === 2 ? 'Flattened' : stars === 1 ? 'Knocked down' : 'Still standing';
  hud.showEnd({ title, sub: `${level.name.toUpperCase()} · CONTRACT ${lotNumber(levelId)}`, stars, rows, score: game.score, best, hasNext: hasNextLot(levelId) && stars > 0, replay: replays.best() });
  hud.show(false);
  endCam();
  sounds.music(true);
  if (document.pointerLockElement) document.exitPointerLock();
  if (PATCH_TEST && game.score > 0) console.log('pass contract-ends');
}

function finishBlowdown(): void {
  const r = blowdownResult();
  const clean = Math.round(r.inside * 100);
  const score = Math.max(0, Math.round(r.share * 6000 + r.inside * 4000 * r.share - r.collateral * 3 + (game.zoneHit ? 2000 : 0)));
  const stars = (r.share >= 0.6 ? 1 : 0) + (r.share >= 0.6 && r.inside >= 0.75 ? 1 : 0) + (r.share >= 0.85 && r.inside >= 0.75 && r.collateral < 400 ? 1 : 0);
  const rows: [string, string][] = [
    [`${level.job} demolished`, `${Math.floor(r.share * 100)}%`],
    ['Landed in its footprint', `${clean}%`],
    ['Collateral damage', `${r.collateral.toLocaleString()} voxels`],
  ];
  if (level.zone) rows.push(['Dropped in the ring', game.zoneHit ? '+2,000' : 'no']);
  rows.push(['Devices set', `${(level.charges + 3 - game.charges) + ((level.cutters ?? 2) + 2 - game.cutters)}`]);
  game.score = score;
  const best = score > (progress.blowBest[levelId] ?? 0);
  if (best) progress.blowBest[levelId] = score;
  const had = starTotal();
  progress.blowStars[levelId] = Math.max(progress.blowStars[levelId] ?? 0, stars);
  save();
  unlockedRows(rows, had);
  const title = stars === 3 ? 'Clean drop' : stars === 2 ? 'Down' : stars === 1 ? 'Messy' : 'Still standing';
  hud.showEnd({ title, sub: `${level.name.toUpperCase()} · BLOWDOWN ${lotNumber(levelId)}`, stars, rows, score, best, hasNext: hasNextLot(levelId) && stars > 0, replay: replays.best() });
  hud.show(false);
  endCam();
  sounds.music(true);
  if (document.pointerLockElement) document.exitPointerLock();
}

// ---------- test hooks ----------
/** Turn to face world point (x, y, z). */
let turning: { from: number[]; to: number[]; t: number; seconds: number } | null = null;
function aimAt(x: number, y: number, z: number): void {
  player.eye(eye);
  player.yaw = Math.atan2(y - eye.y, x - eye.x);
  player.pitch = Math.atan2(z - eye.z, Math.hypot(x - eye.x, y - eye.y));
}
const hook = {
  get phase() {
    return phase;
  },
  /** The world's clock (s): tests time the physics by it, not the wall clock (a loaded machine runs it slower). */
  get simTime() {
    return physicsSteps / 60;
  },
  /**
   * What hangs, by identity (tests): rubble voxels with no chain of contact to the ground, fixed pieces cut off from
   * it (by their first voxel), sections sitting still in mid-air (by slot). The same ones hanging twice, a moment
   * apart, is a hover: a mass that has only just lost its support is let go within a few frames.
   */
  hoverIds: () => {
    const rubble = physics.hovering(lastStill).flat();
    const cut: number[] = [];
    for (let i = 0; i < city.buildings.length; i++) for (const p of structure.unsupported(i)) cut.push(p.voxels[0]);
    const still: number[] = [];
    for (const sec of physics.sections.values()) {
      const speed = Math.hypot(sec.velocity[0], sec.velocity[1], sec.velocity[2]);
      if (speed > 0.3 || sec.pose[2] - sec.size[2] / 2 < 1) continue;
      const low = physics.underside(sec.slot, sec.pose, 16);
      let under = false;
      for (let k = 0; !under && k < low.length; k += 3) under = low[k + 2] < 0.6 || voxelAt(city, low[k], low[k + 1], low[k + 2] - 0.3) >= 0 || physics.rubbleAt(low[k], low[k + 1], low[k + 2] - 0.3) >= 0 || physics.inSection(low[k], low[k + 1], low[k + 2] - 0.3, sec.slot);
      if (!under) still.push(sec.slot);
    }
    return { rubble, cut, still };
  },
  /** What's still hanging after half a second of the world's clock (the hover invariant, as the tests check it). */
  hoverPersist: async (gap = 0.5) => {
    const ids = () => (hook as unknown as { hoverIds: () => { rubble: number[]; cut: number[]; still: number[] } }).hoverIds();
    const a = ids();
    const t0 = physicsSteps;
    const w0 = performance.now();
    while ((physicsSteps - t0) / 60 < gap && performance.now() - w0 < 20000) await new Promise((r) => setTimeout(r, 30));
    const b = ids();
    const both = (x: number[], y: number[]) => x.filter((v) => y.includes(v)).length;
    const r = { rubble: both(a.rubble, b.rubble), cut: both(a.cut, b.cut), still: both(a.still, b.still) };
    return { ...r, total: r.rubble + r.cut + r.still };
  },
  /** What hangs, where (tests: a failing hover check says what it found). */
  hoverDetail: () => {
    const masses = physics.hovering(lastStill);
    return {
      rubble: masses.map((m) => {
        const z = m.map((v) => physics.rest[7 * v + 2]);
        const v = m[z.indexOf(Math.min(...z))];
        return { n: m.length, low: +Math.min(...z).toFixed(2), high: +Math.max(...z).toFixed(2), mat: city.material[v], obj: city.building[v], why: physics.whyHeld(v) };
      }),
      sections: [...physics.sections.values()].map((s) => ({ n: s.voxels.length, z: +(s.pose[2] - s.size[2] / 2).toFixed(2), speed: +Math.hypot(s.velocity[0], s.velocity[1], s.velocity[2]).toFixed(2) })),
      loose: physics.loose,
      hoverProf: physics.hoverProf,
    };
  },
  /** The sea (tests): splashes so far, and where the broken pieces are: timber afloat, what sank on the bottom. */
  get sea() {
    if (!sea) return null;
    let afloat = 0;
    let sunk = 0;
    let woodDown = 0;
    for (let v = 0; v < city.count; v++) {
      const st = city.state[v];
      if (st !== State.Loose && st !== State.Rubble) continue;
      const z = st === State.Rubble ? physics.rest[7 * v + 2] : livePos[3 * v + 2];
      const wood = city.material[v] === Mat.Wood;
      if (wood && Math.abs(z - sea.level) < 0.45) afloat++;
      if (wood && z < 0.4) woodDown++;
      if (!wood && z < 0.5) sunk++;
    }
    return { level: sea.level, splashes: splashCount, afloat, woodDown, sunk, pouring, slow: player.slow };
  },
  /** Lay a plank between two points (m), held by what's there (tests). */
  plank: (a: [number, number, number], b: [number, number, number]) => {
    const hold = (p: number[]) => (p[2] <= PLANK_T ? -1 : voxelAt(city, p[0], p[1], p[2] - VOXEL * 0.6));
    layPlank(new THREE.Vector3(...a), new THREE.Vector3(...b), hold(a), hold(b));
  },
  /** Tie a cable from machine `m`'s part to the standing voxel at `at` (tests). */
  cable: (m: number, part: 'bucket' | 'hitch' | 'ball', at: [number, number, number]) => {
    const mm = machines[m];
    const v = voxelAt(city, at[0], at[1], at[2]);
    if (!mm || v < 0) return false;
    const c = Array.from(city.position.subarray(3 * v, 3 * v + 3));
    tieCable({ kind: 'machine', m, part }, { kind: 'voxel', v, offset: [at[0] - c[0], at[1] - c[1], at[2] - c[2]] }, machinePoint(mm, part), new THREE.Vector3(...at));
    return true;
  },
  get rigging() {
    return { planks: planks.map((p) => ({ a: p.a.toArray(), b: p.b.toArray(), holds: [p.holdA, p.holdB] })), cables: cables.map((c) => ({ ends: c.ends.map((e) => e.kind), tension: +c.tension.toFixed(2), rest: +c.rest.toFixed(2), cut: c.cut })), ...rigStats };
  },
  /** Where the player stands (tests). */
  get feet() {
    return player.position.toArray();
  },
  /** Walk: hold W (and look along yaw) for the tests. */
  walk: (forward: number) => {
    if (forward) keys.add('KeyW');
    else keys.delete('KeyW');
  },
  /** The job's objects' boxes (m: x0, y0, x1, y1, height), for the contract bot. */
  get targetBoxes() {
    return level.targets.map((i) => {
      const o = city.buildings[i];
      return [o.x0 * VOXEL, o.y0 * VOXEL, (o.x0 + o.w) * VOXEL, (o.y0 + o.d) * VOXEL, o.h * VOXEL];
    });
  },
  /** A still-standing voxel of the job, picked at random (m), or null when it's all down (the contract bot aims at it). */
  targetSpot: () => {
    const left = targetVoxels.filter((v) => city.state[v] === State.Fixed);
    if (!left.length) return null;
    const v = left[Math.floor(Math.random() * left.length)];
    return Array.from(city.position.subarray(3 * v, 3 * v + 3));
  },
  /** The heist (tests): where it stands, the loot, the quicksave. */
  get heist() {
    return { on: heist.on, state: heist.state, timeLeft: heist.timeLeft, cause: heist.cause, saved: !!heist.save, loot: heist.loot.map((l) => ({ name: l.name, required: l.required, taken: l.taken, at: l.at.toArray() })), truck: heist.truckAt.toArray() };
  },
  /** F in a heist (tests): take what's in front of you, or get in the truck. */
  use: () => heistUse() || useMachine(),
  quicksave: () => quicksave(),
  quickload: () => quickload(),
  /** The lot's machines (tests). */
  get machines() {
    return machines.map((m) =>
      m instanceof Crane
        ? { kind: m.kind, ball: m.ball.toArray(), ballSpeed: m.ballVel.length(), slew: m.slew, luff: m.luff, rope: m.rope, riding: m === riding }
        : { kind: m.kind, at: m.position.toArray(), heading: m.heading, speed: m.speed, bucket: m.bucketAt.toArray(), slew: m.slew, strain: m.strain, riding: m === riding },
    );
  },
  get machineStats() {
    return { ...machineStats, engines: sounds.enginesOn };
  },
  /** Climb into machine `i` (or out, with -1), and drive it with these controls (tests). */
  ride: (i: number) => {
    if (i < 0) {
      if (riding) useMachine();
      return;
    }
    const m = machines[i];
    if (!m) return;
    if (riding) useMachine();
    player.position.set(m.door.x, m.door.y, 0);
    useMachine();
  },
  drive: (c: typeof testDrive) => {
    testDrive = c;
  },
  /** Film a machine from outside: the view stays where you are while it's driven (media). */
  machineView: (on: boolean) => {
    machineCam = on;
  },
  /** Push the crane's ball (tests: a swing to start from). */
  swingBall: (i: number, v: [number, number, number]) => {
    const m = machines[i];
    if (m instanceof Crane) m.push(v);
  },
  get level() {
    return levelId;
  },
  get score() {
    return game.score;
  },
  get combo() {
    return game.combo;
  },
  get timeLeft() {
    return game.timeLeft;
  },
  get demolition() {
    return game.demolition;
  },
  get loose() {
    return physics?.loose ?? 0;
  },
  get broken() {
    return game.voxelsBroken;
  },
  get voxels() {
    return city.count;
  },
  get fps() {
    return fps;
  },
  /** The frame's work, CPU start to GPU done (ms, smoothed): the headroom under the display's cap. */
  get workMs() {
    return workMs;
  },
  /**
   * Where the job's voxels built at or above `minZ` (m) are now: their mean and highest height, and how many are
   * in each state (fixed, loose, gone, rubble, carried by a falling section). For the fall tests.
   */
  track: (minZ = 0) => {
    const carried = new Map<number, [number[], Float32Array]>();
    for (const sec of physics.sections.values()) {
      const q = sec.pose.slice(3, 7);
      sec.voxels.forEach((v, k) => {
        const o = [sec.offsets[3 * k], sec.offsets[3 * k + 1], sec.offsets[3 * k + 2]];
        // rotate by q
        const [x, y, z, w] = q;
        const t = [2 * (y * o[2] - z * o[1]), 2 * (z * o[0] - x * o[2]), 2 * (x * o[1] - y * o[0])];
        const r = [o[0] + w * t[0] + (y * t[2] - z * t[1]), o[1] + w * t[1] + (z * t[0] - x * t[2]), o[2] + w * t[2] + (x * t[1] - y * t[0])];
        carried.set(v, [sec.pose.slice(0, 3), Float32Array.from(r)]);
      });
    }
    const counts = [0, 0, 0, 0, 0];
    let sum = 0;
    let sumY = 0;
    let n = 0;
    let top = 0;
    let low = Infinity;
    let topState = -1;
    let topVoxel = -1;
    for (const v of targetVoxels) {
      if (homePos[3 * v + 2] < minZ) continue;
      const st = city.state[v];
      counts[st]++;
      let z: number;
      let y: number;
      if (st === State.Fixed) [y, z] = [city.position[3 * v + 1], city.position[3 * v + 2]];
      else if (st === State.Loose) [y, z] = [livePos[3 * v + 1], livePos[3 * v + 2]];
      else if (st === State.Rubble) [y, z] = [physics.rest[7 * v + 1], physics.rest[7 * v + 2]];
      else if (st === State.Carried) {
        const c = carried.get(v);
        [y, z] = c ? [c[0][1] + c[1][1], c[0][2] + c[1][2]] : [homePos[3 * v + 1], homePos[3 * v + 2]];
      } else continue;
      sum += z;
      sumY += y;
      n++;
      if (z < low) low = z;
      if (z > top) {
        top = z;
        topState = st;
        topVoxel = v;
      }
    }
    return { mean: n ? sum / n : 0, meanY: n ? sumY / n : 0, top, low: n ? low : 0, topState, topVoxel, topMat: topVoxel >= 0 ? city.material[topVoxel] : -1, fixed: counts[0], loose: counts[1], gone: counts[2], rubble: counts[3], carried: counts[4], sections: physics.sections.size };
  },
  trackY: (minZ = 0) => hook.track(minZ).meanY,
  /**
   * Take out a band of the job (z0..z1 m) with a tool's holes on a grid through it, as that many shots would
   * (tests): 'cannon' (first-wall radii, nothing hard), 'charges' (charge radii) or 'mixed' (alternating).
   */
  clearBand: (z0: number, z1: number, kind: 'cannon' | 'charges' | 'mixed') => {
    const i = level.targets[0];
    const o = city.buildings[i];
    const [ax, ay, bx, by] = [o.x0 * VOXEL, o.y0 * VOXEL, (o.x0 + o.w) * VOXEL, (o.y0 + o.d) * VOXEL];
    let k = 0;
    // All the holes at once (as a ripple of charges, or a burst of shots, lands before anything falls), then what
    // no longer stands falls
    const hits: Hit[] = [];
    for (let z = z0 + 0.6; z <= z1; z += 1.6)
      for (let x = ax + 0.6; x <= bx; x += 1.6)
        for (let y = ay + 0.6; y <= by; y += 1.6) {
          const charge = kind === 'charges' || (kind === 'mixed' && k++ % 2 === 0);
          const radii = charge ? RADII.charge : RADII.cannon(0);
          if (!within(city, [x, y, z], 1.2).length) continue;
          hits.push({ at: [x, y, z], radius: radii[0], radii, push: 4, core: 0.6 });
        }
    const r = blasts(city, structure, physics, hits);
    unsettled = true;
    return r.gone.length + r.loose.length;
  },
  /** Anything hanging in the air (tests): rubble with nothing under it, fixed pieces cut off, bodies still in mid-air. */
  hoverCheck: () => {
    const rubble = physics.hovering(lastStill).reduce((n, m) => n + m.length, 0);
    let cut = 0;
    for (let i = 0; i < city.buildings.length; i++) cut += structure.unsupported(i).reduce((n, p) => n + p.voxels.length, 0);
    let still = 0;
    for (const sec of physics.sections.values()) {
      const speed = Math.hypot(sec.velocity[0], sec.velocity[1], sec.velocity[2]);
      if (speed > 0.3 || sec.pose[2] - sec.size[2] / 2 < 1) continue;
      const low = physics.underside(sec.slot, sec.pose, 16);
      let under = false;
      for (let k = 0; !under && k < low.length; k += 3) under = low[k + 2] < 0.6 || voxelAt(city, low[k], low[k + 1], low[k + 2] - 0.3) >= 0 || physics.rubbleAt(low[k], low[k + 1], low[k + 2] - 0.3) >= 0 || physics.inSection(low[k], low[k + 1], low[k + 2] - 0.3, sec.slot);
      if (!under) still += sec.voxels.length;
    }
    return { rubble, cut, still, total: rubble + cut + still };
  },
  /** Find a rubble heap, stand by it, swing the sledge at it: whether the swing hit it and how much woke (tests). */
  rubbleHit: async () => {
    const list = [...physics.rubble];
    if (!list.length) return { hit: false, woke: 0, rubble: 0 };
    const v = list[Math.floor(list.length / 2)];
    const [x, y, z] = [physics.rest[7 * v], physics.rest[7 * v + 1], physics.rest[7 * v + 2]];
    player.position.set(x - 2, y - 1.2, 0);
    aimAt(x, y, z);
    const a = aim(TOOLS[SLEDGE].reach);
    const near = list.filter((u) => Math.hypot(physics.rest[7 * u] - x, physics.rest[7 * u + 1] - y, physics.rest[7 * u + 2] - z) < 1.2);
    selectTool(SLEDGE);
    swingSledge(1);
    await new Promise((r) => setTimeout(r, 250));
    const woke = near.filter((u) => city.state[u] !== State.Rubble).length;
    return { hit: !!a && a.voxel >= 0, kind: a?.debris ?? 'standing', woke, near: near.length };
  },
  /**
   * Render a sound scene offline through the game's own mix (buses, reverb, compressor, limiter, ducking) and
   * return it as a 16-bit WAV in base64: 'cannon', 'impact', 'sledge', 'charge', 'ripple', 'music' (the bed alone)
   * or 'mix' (15 s: the music, a cannon shot into propane tanks, a ripple of four charges, a 6,000-voxel collapse,
   * windows, a sledge, another shot). For loudness checks without listening. 'pan': a hit 6 m to the listener's
   * right (left and right RMS returned). 'collapse': the sound events the game started since `markSounds()`,
   * played back as they happened (a real collapse's, with the listener where it was).
   */
  renderAudio: async (scene: string, only?: string[]) => {
    sounds.resume();
    for (let k = 0; k < 100 && sounds.loaded < 60; k++) await new Promise((r) => setTimeout(r, 100));
    const sr = 44100;
    const dur = scene === 'mix' || scene === 'music' ? 15 : scene === 'ripple' || scene === 'collapse' ? 9 : 5;
    const off = new OfflineAudioContext(2, sr * dur, sr);
    const s = new Sounds();
    s.volume = 0.8;
    s.musicLevel = 0.5 * 0.6;
    s.setBuffers(sounds.bufferMap);
    s.attach(off);
    const at = (t: number, f: () => void) => {
      s.offset = t;
      f();
    };
    if (scene === 'cannon') at(0.1, () => s.cannonFire());
    if (scene === 'impact') at(0.1, () => s.impact('brick', 1, 12, 400));
    if (scene === 'sledge') at(0.1, () => s.sledgeHit('brick', 1, 2.5, 120));
    if (scene === 'charge') at(0.1, () => s.charge(15));
    if (scene === 'ripple') for (let k = 0; k < 4; k++) at(0.1 + k * 0.12, () => s.charge(15 + k * 2));
    if (scene === 'pan') {
      // Facing +y, z up: +x is to the right
      s.listen([0, 0, 1.7], [0, 1, 0], [0, 0, 1]);
      at(0.1, () => s.impact('brick', 0.8, 6, 20, [6, 0, 1.7]));
    }
    if (scene === 'collapse') {
      const events = soundLog.slice(soundMark);
      const t0 = events.length ? events[0][0] : 0;
      const ss = s as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const [t, ear, name, args] of events) {
        if (t - t0 > dur - 1) break;
        // (The charges that started it are left out: their booms would cover the collapse's own sound)
        if (name === 'charge' || name === 'propane' || name === 'cannonFire') continue;
        if (only && !only.includes(name)) continue;
        at(0.1 + t - t0, () => {
          s.listen(ear, [0, 1, 0], [0, 0, 1]);
          ss[name](...args);
        });
      }
    }
    if (scene === 'music' || scene === 'mix') at(0, () => s.music(true));
    if (scene === 'mix') {
      at(1.0, () => s.cannonFire());
      at(1.25, () => s.impact('brick', 1, 14, 300));
      at(1.4, () => s.propane(13));
      at(1.65, () => s.propane(14));
      at(1.7, () => s.glass(10, 13, 1));
      at(1.9, () => s.debrisTail(5000, 14, 0.2));
      for (let k = 0; k < 4; k++) at(5 + k * 0.12, () => s.charge(18 + k));
      at(5.6, () => s.debrisTail(6000, 18, 0.2));
      for (let k = 0; k < 12; k++) at(6 + k * 0.3, () => s.impact(k % 3 ? 'brick' : 'wood', 0.3 + Math.random() * 0.5, 12 + Math.random() * 10, 40));
      at(10, () => s.sledgeHit('brick', 1, 2.5, 90));
      at(12, () => s.cannonFire());
      at(12.25, () => s.impact('brick', 0.9, 16, 200));
    }
    const buf = await off.startRendering();
    // 16-bit WAV
    const n = buf.length;
    const data = new DataView(new ArrayBuffer(44 + n * 4));
    const w = (o: number, t: string) => [...t].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF');
    data.setUint32(4, 36 + n * 4, true);
    w(8, 'WAVEfmt ');
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, 2, true);
    data.setUint32(24, sr, true);
    data.setUint32(28, sr * 4, true);
    data.setUint16(32, 4, true);
    data.setUint16(34, 16, true);
    w(36, 'data');
    data.setUint32(40, n * 4, true);
    const [l, r] = [buf.getChannelData(0), buf.getChannelData(1)];
    let peak = 0;
    let clipped = 0;
    let sumL = 0;
    let sumR = 0;
    for (let i = 0; i < n; i++) {
      sumL += l[i] * l[i];
      sumR += r[i] * r[i];
    }
    for (let i = 0; i < n; i++)
      for (const [c, x] of [
        [0, l[i]],
        [1, r[i]],
      ]) {
        const a = Math.abs(x);
        peak = Math.max(peak, a);
        if (a >= 1) clipped++;
        data.setInt16(44 + i * 4 + c * 2, Math.max(-32768, Math.min(32767, Math.round(x * 32767))), true);
      }
    let bin = '';
    const bytes = new Uint8Array(data.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { wav: btoa(bin), peak, clipped, rmsL: Math.sqrt(sumL / n), rmsR: Math.sqrt(sumR / n), events: scene === 'collapse' ? soundLog.length - soundMark : 0, counts: { ...s.counts } };
  },
  /** The sound events since markSounds (debugging). */
  soundLogDump: () => soundLog.slice(soundMark).map(([t, , n, a]) => [+t.toFixed(3), n, JSON.stringify(a).slice(0, 120)]),
  /** Start a sound log for renderAudio('collapse'). */
  markSounds: () => {
    soundMark = soundLog.length;
  },
  /** The sound events since markSounds (name and count). */
  get soundEvents() {
    const c: Record<string, number> = {};
    for (const e of soundLog.slice(soundMark)) c[e[2]] = (c[e[2]] ?? 0) + 1;
    return c;
  },
  /** Top up the charges (tests). */
  giveCharges: (n: number) => {
    game.charges = n;
  },
  /** End the contract now (tests). */
  finishNow: () => {
    if (phase === 'play' || phase === 'grace') finish();
  },
  /** Draw calls in the last frame, triangles, and render pipelines compiled so far (none should appear mid-play). */
  get drawCalls() {
    return view.renderer.info.render.drawCalls;
  },
  get triangles() {
    return view.renderer.info.render.triangles;
  },
  get pipelines() {
    return (view.renderer as unknown as { _pipelines?: { caches: Map<string, unknown> } })._pipelines?.caches.size ?? -1;
  },
  get loadTimes() {
    return loadTimes;
  },
  get prof() {
    const out = { ...prof, ...rbProf };
    for (const k of Object.keys(rbProf)) rbProf[k] = 0;
    return out;
  },
  get tool() {
    return tool;
  },
  get charges() {
    return game.charges;
  },
  get placed() {
    return placed.length;
  },
  get seed() {
    return SEED;
  },
  get player() {
    return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch };
  },
  get killcam() {
    return cam.active && cam.kind === 'kill';
  },
  state: () => ({ phase, level: levelId, score: game.score, combo: game.combo, timeLeft: game.timeLeft, demolition: game.demolition, loose: physics?.loose ?? 0, fps: Math.round(fps), tool, charges: game.charges }),
  start: (id = 0) => startLevel(id),
  select: (i: number) => selectTool(i),
  aimAt,
  /** Use the tool in hand now (the sledge: a full swing). */
  fire: () => {
    if (tool === SLEDGE) swingSledge(1);
    else useTool();
  },
  /** Keep wrecking after the results (free play), as the end card's button does. */
  keepWrecking: () => {
    if (phase !== 'end') finish();
    hud.onKeep();
  },
  /** The mode for the next start ('rush' or 'blowdown'), the delay the next charge or cutter gets, holding the button. */
  setMode: (m: Mode) => {
    mode = m;
    hud.mode = m;
    if (phase === 'title') hud.onMode(m);
  },
  /** Whether a fixed voxel stands at (x, y, z) m (tests). */
  fixedAt: (x: number, y: number, z: number) => voxelAt(city, x, y, z) >= 0,
  /** Set the heist's alarm clock (tests: run it out). */
  heistTime: (t: number) => {
    heist.timeLeft = t;
  },
  get mode() {
    return mode;
  },
  setDelay: (s: number) => {
    fuseDelay = s;
  },
  hold: (on: boolean) => {
    held = on;
  },
  get rocketsLeft() {
    return game.rockets;
  },
  /** Best moments recorded this contract, and the best one (tests). */
  get replays() {
    return { recorded: replays.recorded, best: replays.best()?.label ?? null };
  },
  get explosions() {
    return explosions;
  },
  get jackBreaks() {
    return jackBreaks;
  },
  get fires() {
    return fires.length;
  },
  get smoke() {
    return smokeVeil;
  },
  /** Spawn a sandbox prop at the crosshair (tests). */
  spawn: (kind: string) => spawnProp(kind),
  setHour: (h: number) => setDayHour(h),
  /** A blowdown's result so far (tests). */
  blowdown: () => blowdownResult(),
  /** Swing the sledge at `power` (0..1). */
  swing: (power: number) => swingSledge(power),
  /** The last sledge blow, the tools' bounces off things too hard, the debris budget's work, the load's tells. */
  get lastSledge() {
    return { ...lastSledge };
  },
  get bounces() {
    return bounces;
  },
  get cleanup() {
    return { ...cleanup };
  },
  get loads() {
    return { ...loadStats };
  },
  /** The debris budget (loose voxels) for tests: lower it to make the cleanup run. */
  setCap: (n: number) => {
    looseCap = n;
  },
  /** Point lights of the pool lit now. */
  get lightsLit() {
    return view.lights.filter((l) => l.intensity > 0).length;
  },
  /** A fixed voxel of material `m` (its centre), the one nearest (x, y), or null. */
  voxelOf: (m: number, x = 0, y = 0, minZ = 0) => {
    let best = -1;
    let bestD = Infinity;
    for (let v = 0; v < city.count; v++) {
      if (city.material[v] !== m || city.state[v] !== State.Fixed || city.position[3 * v + 2] < minZ) continue;
      const d = (city.position[3 * v] - x) ** 2 + (city.position[3 * v + 1] - y) ** 2;
      if (d < bestD) [best, bestD] = [v, d];
    }
    return best < 0 ? null : [city.position[3 * best], city.position[3 * best + 1], city.position[3 * best + 2]];
  },
  /**
   * A tool's hole at (x, y, z), as that tool makes it (tests): 'sledge' (power p), 'cannon' (wall p), 'charge',
   * 'propane'. Returns what it removed per material and the farthest removed of each hardness (m).
   */
  hole: (kind: 'sledge' | 'cannon' | 'charge' | 'propane', x: number, y: number, z: number, p = 1) => {
    const radii = kind === 'sledge' ? RADII.sledge(p) : kind === 'cannon' ? RADII.cannon(p) : kind === 'charge' ? RADII.charge : RADII.propane;
    const result = blasts(city, structure, physics, [{ at: [x, y, z], radius: radii[0], radii, push: 2, core: 0.5 }]);
    unsettled = true;
    const byMat: Record<number, number> = {};
    const far = [0, 0, 0, 0];
    for (const v of [...result.gone, ...result.loose]) {
      const m = city.material[v];
      byMat[m] = (byMat[m] ?? 0) + 1;
      const t = TIER[m as Mat];
      far[t] = Math.max(far[t], Math.hypot(city.position[3 * v] - x, city.position[3 * v + 1] - y, city.position[3 * v + 2] - z));
    }
    return { radii, byMat, far, removed: result.gone.length + result.loose.length };
  },
  /** How much the char buffer holds near (x, y, z): the most charred body within 1 m. */
  charNear: (x: number, y: number, z: number) => {
    let most = 0;
    for (const v of within(city, [x, y, z], 1.5)) most = Math.max(most, view.charOf(physics.body[v]));
    return most;
  },
  /**
   * What hangs where (tests): for object `i`, per 1 m band of height, its voxels fixed, rubble, loose, carried,
   * and how many of its fixed voxels the chunk graph says have no path to the ground.
   */
  diag: (i = 0) => {
    const bands: Record<number, number[]> = {};
    for (let v = 0; v < city.count; v++) {
      if (city.building[v] !== i) continue;
      const st = city.state[v];
      if (st === State.Gone) continue;
      const z = st === State.Rubble ? physics.rest[7 * v + 2] : st === State.Fixed ? city.position[3 * v + 2] : livePos[3 * v + 2];
      const b = Math.floor(z);
      bands[b] ??= [0, 0, 0, 0];
      bands[b][st === State.Fixed ? 0 : st === State.Rubble ? 1 : st === State.Loose ? 2 : 3]++;
    }
    const pieces = structure.unsupported(i);
    const t0 = performance.now();
    const hov = physics.hovering().flat();
    const hoverMs = performance.now() - t0;
    hov.sort((a, b) => physics.rest[7 * a + 2] - physics.rest[7 * b + 2]);
    return { bands, unsupported: pieces.reduce((n, p) => n + p.voxels.length, 0), sections: physics.sections.size, fatigue: [...structure.fatigue.keys()], hovering: hov.length, hoverTop: hov.length ? +physics.rest[7 * hov[hov.length - 1] + 2].toFixed(1) : 0, hoverLow: hov.length ? +physics.rest[7 * hov[0] + 2].toFixed(1) : 0, hoverMs: +hoverMs.toFixed(1), rubble: physics.rubble.size, settleMs: lastSettleMs, settles: settleCount, dropped: { ...nothingHovers }, prof: { ...physics.hoverProf } };
  },
  /** Char what stands within `r` m of (x, y, z) (tests and shots). */
  charSphere: (x: number, y: number, z: number, r: number, amount = 1) => charAround([x, y, z], r, amount),
  /** The job's most loaded storey: its layer and load (1 = it goes). */
  jobStress: () => level.targets.map((i) => structure.stress(i)),
  detonate: detonateAll,
  /** Put the player at (x, y), on the ground, or hovering at z (flying: media's camera heights). */
  moveTo: (x: number, y: number, z = 0) => {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.flying = z > 0.05;
  },
  /** Run `n` frames of 1/60 s by hand (a hidden page gets no animation frames). */
  step: (n = 1) => {
    for (let k = 0; k < n; k++) tick(last + 1000 / 60);
  },
  /** Tests: stop the loop (frames only by step) or let it run again. */
  manual: (on: boolean) => {
    manualClock = on;
    last = performance.now();
    jumps.reset();
  },
  /** Tests: wait for the debris readback in flight to land (frame-stepped runs keep the readback in step). */
  drain: async () => {
    for (let k = 0; k < 400 && reading; k++) await new Promise((r) => setTimeout(r, 1));
  },
  /** Tests: the jump detector's look at this frame (every voxel as drawn, against the frame before). */
  probe: async () => {
    // (Everything the shader reads, as it is when the bodies are read: the readback in flight may change it meanwhile)
    const read = physics.solver.readBodies();
    const links = view.linkArray().slice();
    const state = city.state.slice();
    const generation = new Map(physics.generation);
    const bodies = await read;
    const cam = view.camera;
    viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const near = (x: number, y: number, z: number) => (x - cam.position.x) ** 2 + (y - cam.position.y) ** 2 + (z - cam.position.z) ** 2 < 120 * 120 && viewFrustum.containsPoint(scratchV.set(x, y, z));
    return jumps.frame({ bodies, links, tweenA: null, tweenB: null, time: 0, body: physics.body, state, inView: near, parkedBelow: PARKED_BELOW, generation: (slot) => generation.get(slot) ?? 0 });
  },
  sectionCount: () => physics.sections.size,
  collapseLog: () => collapseLog.splice(0),
  /** Tests: the score so far, and what was awarded under each label. */
  scoreBy: () => ({ score: game.score, combo: game.combo, by: scoreBy }),
  /**
   * Tests: what has moved since the last call, of everything drawn (a heap at rest must not stir): how many voxels
   * are somewhere else by more than 2 mm, the furthest, and what's still loose or carried.
   */
  restProbe: async () => {
    const bodies = await physics.solver.readBodies();
    const links = view.linkArray();
    if (restSeen.length !== 3 * city.count) restSeen = new Float32Array(3 * city.count).fill(NaN);
    let moved = 0;
    let furthest = 0;
    let carried = 0;
    for (let v = 0; v < city.count; v++) {
      const b = physics.body[v];
      const o = b * 40;
      if (links[4 * b + 3] >= 0) {
        carried++;
        continue;
      }
      if (bodies[o + 2] < PARKED_BELOW) continue;
      const d = Math.hypot(bodies[o] - restSeen[3 * v], bodies[o + 1] - restSeen[3 * v + 1], bodies[o + 2] - restSeen[3 * v + 2]);
      if (d > 0.002) {
        moved++;
        furthest = Math.max(furthest, d);
      }
      restSeen.set(bodies.subarray(o, o + 3), 3 * v);
    }
    return { moved, furthest, carried, loose: physics.loose, sections: physics.sections.size, rubble: physics.rubble.size };
  },
  /** Tests: the job's box (m: x0, y0, z0, x1, y1, z1). */
  targetBox: () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const i of level.targets) {
      const b = city.buildings[i];
      lo[0] = Math.min(lo[0], b.x0 * VOXEL);
      lo[1] = Math.min(lo[1], b.y0 * VOXEL);
      lo[2] = 0;
      hi[0] = Math.max(hi[0], (b.x0 + b.w) * VOXEL);
      hi[1] = Math.max(hi[1], (b.y0 + b.d) * VOXEL);
      hi[2] = Math.max(hi[2], b.h * VOXEL);
    }
    return [...lo, ...hi];
  },
  /** Tests: charges' holes at all these points at once (as a ripple lands before anything falls), cut toward `way`. */
  blastMany: (points: number[][], kind: 'charge' | 'cutter' = 'charge', way?: number[]) => {
    const radii = kind === 'charge' ? RADII.charge : RADII.cutter;
    const hits: Hit[] = points.map((at) => ({ at, radius: radii[0], radii, push: kind === 'charge' ? 4 : 0.5, core: 0.6, topple: way }));
    const r = blasts(city, structure, physics, hits);
    afterBlast(r, hits);
    unsettled = true;
    return { gone: r.gone.length, loose: r.loose.length, falling: r.falling.length, carried: r.carried, sections: physics.sections.size };
  },
  /**
   * Tests: every drawn voxel has a physics owner (owners.ts), and nothing drawn hangs in the air: fixed voxels each
   * reach the ground through fixed neighbours in their object, and the no-hover rule's own check for rubble and sections.
   */
  ownerCheck: async () => {
    const read = physics.solver.readBodies();
    const links = view.linkArray().slice();
    const sections = new Map<number, Set<number>>();
    for (const [slot, sec] of physics.sections) sections.set(slot, new Set(sec.voxels));
    const paints = view.paintArray().slice();
    const state = city.state.slice();
    const rest = physics.rest.slice();
    const rubble = new Set(physics.rubble);
    const bodies = await read;
    const r = owners({ bodies, links, paints, tweenA: null, tweenB: null, time: 0, body: physics.body, state, material: city.material, exposed: city.exposed, home: city.position, rest, rubble, sections, parkedBelow: PARKED_BELOW });
    const floating: { v: number; mat: number; at: number[] }[] = [];
    let floatingCount = 0;
    for (const b of city.buildings) {
      const n = b.w * b.d * b.h;
      const seen = new Uint8Array(n);
      const queue: number[] = [];
      for (let c = 0; c < b.w * b.d; c++) {
        const v = b.cells[c];
        if (v >= 0 && city.state[v] === State.Fixed) {
          seen[c] = 1;
          queue.push(c);
        }
      }
      for (let k = 0; k < queue.length; k++) {
        const c = queue[k];
        const x = c % b.w;
        const y = Math.floor(c / b.w) % b.d;
        const z = Math.floor(c / (b.w * b.d));
        const near = [x > 0 ? c - 1 : -1, x + 1 < b.w ? c + 1 : -1, y > 0 ? c - b.w : -1, y + 1 < b.d ? c + b.w : -1, z > 0 ? c - b.w * b.d : -1, z + 1 < b.h ? c + b.w * b.d : -1];
        for (const m of near) {
          if (m < 0 || seen[m]) continue;
          const u = b.cells[m];
          if (u < 0 || city.state[u] !== State.Fixed) continue;
          seen[m] = 1;
          queue.push(m);
        }
      }
      for (let c = 0; c < n; c++) {
        const v = b.cells[c];
        if (v < 0 || seen[c] || city.state[v] !== State.Fixed) continue;
        floatingCount++;
        if (floating.length < 200) floating.push({ v, mat: city.material[v], at: Array.from(city.position.subarray(3 * v, 3 * v + 3), (x) => +x.toFixed(2)) });
      }
    }
    const hover = hook.hoverCheck();
    return { ...r, floatingCount, floating, framelessPanes: [], hover, meshes: { glass: true, balls: true }, count: city.count, sections: physics.sections.size, loose: physics.loose };
  },
  skipIntro: () => {
    game.introT = 99;
  },
  /** A standing voxel of the job below `maxZ` m (the `k`-th, spread), or null: for shooting a tower from below. */
  targetBelow: (maxZ: number, k = 0) => {
    const cells: number[] = [];
    for (const v of targetVoxels) if (city.state[v] === State.Fixed && city.position[3 * v + 2] < maxZ) cells.push(v);
    if (!cells.length) return null;
    const v = cells[Math.floor((k * 7919) % cells.length)];
    return [city.position[3 * v], city.position[3 * v + 1], city.position[3 * v + 2]];
  },
  /** Point at a voxel of the job (for bots): its centre, or null. */
  targetPoint: (k = 0) => {
    const cells: number[] = [];
    // (A lot with no job to knock down, the heist's: its biggest building, what you cut your way into)
    let pool = targetVoxels;
    if (!pool.length && city.count) {
      const counts = new Map<number, number>();
      for (let v = 0; v < city.count; v++) counts.set(city.building[v], (counts.get(city.building[v]) ?? 0) + 1);
      const big = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      pool = [];
      for (let v = 0; v < city.count; v++) if (city.building[v] === big && city.position[3 * v + 2] > 0.3) pool.push(v);
    }
    for (const v of pool) if (city.state[v] === State.Fixed) cells.push(v);
    if (!cells.length) return null;
    const v = cells[Math.floor((k * 7919) % cells.length)];
    return [city.position[3 * v], city.position[3 * v + 1], city.position[3 * v + 2]];
  },
  barrels: () => level.barrels.map((i) => city.buildings[i]).map((b) => [(b.x0 + b.w / 2) * VOXEL, (b.y0 + b.d / 2) * VOXEL, 0.6]),
  get sounds() {
    return sounds.loaded;
  },
  /** Hide the tool in hand (for screenshots). */
  hand: (on: boolean) => {
    hand.object.scale.setScalar(on ? 1 : 0.0001);
  },
  /** Hide the HUD (for clean screenshots). */
  hud: (on: boolean) => {
    hud.root.style.visibility = on ? '' : 'hidden';
  },
  /** Turn smoothly toward a point over `seconds` (for recordings). */
  turnTo: (x: number, y: number, z: number, seconds = 0.5) => {
    player.eye(eye);
    const yaw = Math.atan2(y - eye.y, x - eye.x);
    const pitch = Math.atan2(z - eye.z, Math.hypot(x - eye.x, y - eye.y));
    turning = { from: [player.yaw, player.pitch], to: [player.yaw + Math.atan2(Math.sin(yaw - player.yaw), Math.cos(yaw - player.yaw)), pitch], t: 0, seconds };
  },
};
// The collapse tests' own hooks (the detectors, stepping by hand, the logs) are there only under ?test: a release
// played as it is carries none of them
if (!TESTING) for (const k of ['manual', 'drain', 'probe', 'restProbe', 'ownerCheck', 'blastMany', 'collapseLog', 'scoreBy', 'sectionCount', 'targetBox']) delete (hook as Record<string, unknown>)[k];
Object.assign(window, { __game: hook });

/** ?patch-test=1: play the first contract by itself and say what worked. */
async function selfTest(): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await startLevel(0);
  game.introT = 99;
  await wait(600);
  const [x, y, z] = hook.barrels()[0];
  aimAt(x, y, z);
  selectTool(CANNON);
  fireCannon();
  await wait(3500);
  if (game.voxelsBroken > 0) console.log('pass voxels-break');
  if (game.score > 0) console.log('pass score');
  if (fps > 20) console.log('pass frame-rate');
}

addEventListener('resize', () => view.resize(innerWidth, innerHeight));
addEventListener('pagehide', () => (view.renderer.backend as unknown as { device?: GPUDevice }).device?.destroy());
view.resize(innerWidth, innerHeight);
hud.select(tool);
start().catch((e: unknown) => {
  console.warn(e);
  loader.fail(e);
});
