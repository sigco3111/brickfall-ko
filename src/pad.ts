// Gamepads, shared by Siege and Brickfall. `Pad` reads the standard-mapping pad once a frame: buttons with their
// presses and releases, both sticks through a radial deadzone (the look stick also through a response curve), and which
// device was used last, so the words on screen can follow it. `PadNav` lets the pad drive a DOM screen: a highlight
// moves over its buttons, sliders, lists and boxes, A presses, left/right nudges a slider or a list, B goes back.
// The highlight is a class, never real focus, so a pad or key press in play can't press a hidden button.

export type PadKind = 'xbox' | 'ps' | 'generic';

/** The standard mapping's button numbers. */
export const PB = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, Back: 8, Start: 9, LS: 10, RS: 11, Up: 12, Down: 13, Left: 14, Right: 15 } as const;
export type PadButton = keyof typeof PB;

const NAMES: Record<PadKind, Record<PadButton, string>> = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', Back: 'View', Start: 'Menu', LS: 'LS', RS: 'RS', Up: 'D-pad ↑', Down: 'D-pad ↓', Left: 'D-pad ←', Right: 'D-pad →' },
  ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', Back: 'Share', Start: 'Options', LS: 'L3', RS: 'R3', Up: 'D-pad ↑', Down: 'D-pad ↓', Left: 'D-pad ←', Right: 'D-pad →' },
  generic: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', Back: 'Back', Start: 'Start', LS: 'LS', RS: 'RS', Up: 'D-pad ↑', Down: 'D-pad ↓', Left: 'D-pad ←', Right: 'D-pad →' },
};
const kindOf = (id: string): PadKind => (/045e|xbox|xinput/i.test(id) ? 'xbox' : /054c|playstation|dualshock|dualsense/i.test(id) ? 'ps' : 'generic');

/** The face buttons' colours, for the glyphs (`.pg-a` and so on). */
export const PAD_CSS = `
b.pg { white-space: nowrap; }
.pad-xbox b.pg-A { color: #7ee07e; } .pad-xbox b.pg-B { color: #ff7a6b; } .pad-xbox b.pg-X { color: #7fb7ff; } .pad-xbox b.pg-Y { color: #ffd65c; }
.pad-ps b.pg-A { color: #9fb8ff; } .pad-ps b.pg-B { color: #ff8a8a; } .pad-ps b.pg-X { color: #ffa3e0; } .pad-ps b.pg-Y { color: #7fe3c8; }
.padfocus { outline: 3px solid #ffb347 !important; outline-offset: 3px; box-shadow: 0 0 0 6px rgba(255,179,71,0.25) !important; }
.padrow { background: rgba(255,179,71,0.12); border-radius: 8px; box-shadow: 0 0 0 6px rgba(255,179,71,0.12); }
body.pad-on canvas { cursor: none !important; }
`;

export interface PadOptions {
  /** Stick deadzone (0-0.5) and look speed (1 = normal), read each frame. */
  deadzone: () => number;
}

export class Pad {
  kind: PadKind = 'generic';
  /** A pad, not the keyboard or mouse, was the last thing used. */
  used = false;
  /** A pad is connected now. */
  connected = false;
  /** Left stick, after the deadzone (x right, y forward, each -1..1). */
  readonly move = { x: 0, y: 0 };
  /** Right stick, after the deadzone and the response curve (x right, y down, each -1..1). */
  readonly look = { x: 0, y: 0 };
  /** The triggers, 0..1. */
  lt = 0;
  rt = 0;
  /** Called when the pad in use goes away (unplugged, out of battery), and when the device in use changes. */
  onLost: () => void = () => {};
  onDevice: () => void = () => {};
  private down: boolean[] = [];
  private prev: boolean[] = [];
  private id = '';
  private index = -1;
  /** When each pad (by index) was last used, as a running count. */
  private readonly lastUse = new Map<number, number>();
  private uses = 0;
  /** This pad was used since it connected (so losing it pauses). */
  private touched = false;
  /** Buttons held when something took them (a card closed, the pad came back): ignored until let go. */
  private swallowed = new Set<number>();
  private readonly opts: PadOptions;

  constructor(opts: PadOptions) {
    this.opts = opts;
    const kbm = () => this.setUsed(false);
    addEventListener('keydown', kbm, true);
    addEventListener('mousedown', kbm, true);
    addEventListener('wheel', kbm, { capture: true, passive: true });
    addEventListener('gamepaddisconnected', (e) => {
      if ((e as GamepadEvent).gamepad.index === this.index) this.lose();
    });
  }

  /** The pad's own name for a button: ✕ on a PlayStation pad, A on an Xbox one. */
  label(b: PadButton): string {
    return NAMES[this.kind][b];
  }
  /** A button as a key cap for the HUD: `<b class="pg pg-A">✕</b>`. */
  cap(b: PadButton): string {
    return `<b class="pg pg-${b}">${this.label(b)}</b>`;
  }
  /** Fills {A}, {RT}, {Start}... with key caps (or plain names, for text that isn't HTML). */
  text(s: string, plain = false): string {
    return s.replace(/\{(\w+)\}/g, (m, b: string) => (b in PB ? (plain ? this.label(b as PadButton) : this.cap(b as PadButton)) : m));
  }

  /** Held now. */
  held(b: PadButton): boolean {
    return !!this.down[PB[b]];
  }
  /** Went down this frame. */
  pressed(b: PadButton): boolean {
    return !!this.down[PB[b]] && !this.prev[PB[b]];
  }
  /** Let go this frame. */
  released(b: PadButton): boolean {
    return !this.down[PB[b]] && !!this.prev[PB[b]];
  }

  /** Reads the pad for this frame. */
  poll(): void {
    this.move.x = this.move.y = this.look.x = this.look.y = this.lt = this.rt = 0;
    const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((p): p is Gamepad => !!p?.connected);
    // Several pads on one PC (a PlayStation and an Xbox pad): the one used last, else the first with the standard mapping
    let g: Gamepad | null = null;
    let best = -1;
    for (const p of pads) {
      const ax = (i: number) => p.axes[i] ?? 0;
      if (p.buttons.some((x) => x.pressed) || Math.hypot(ax(0), ax(1)) > 0.5 || Math.hypot(ax(2), ax(3)) > 0.5) this.lastUse.set(p.index, ++this.uses);
      const score = (this.lastUse.get(p.index) ?? 0) * 2 + (p.mapping === 'standard' ? 1 : 0);
      if (score > best) {
        best = score;
        g = p;
      }
    }
    if (!g) {
      if (this.connected) this.lose();
      this.prev = this.down = [];
      return;
    }
    if (!this.connected || g.id !== this.id || g.index !== this.index) {
      // Another pad picked up while this one stays plugged in: its press counts. A new pad, or the same one back: what
      // it holds as it arrives is ignored until let go
      const switched = this.connected && pads.some((p) => p.index === this.index);
      this.connected = true;
      this.touched = false;
      this.id = g.id;
      this.index = g.index;
      this.kind = kindOf(g.id);
      this.swallowed.clear();
      this.prev = this.down = [];
      if (!switched)
        g.buttons.forEach((x, i) => {
          if (x.pressed || x.value > 0.35) this.swallowed.add(i);
        });
      if (this.used) {
        this.used = false;
        this.setUsed(true);
      }
    }
    for (const i of this.swallowed) if (!(g.buttons[i]?.pressed || (g.buttons[i]?.value ?? 0) > 0.35)) this.swallowed.delete(i);
    this.prev = this.down;
    this.down = g.buttons.map((x, i) => (x.pressed || x.value > 0.35) && !this.swallowed.has(i));
    const ax = (i: number) => g.axes[i] ?? 0;
    // A resting stick that drifts a little doesn't take the words from the keyboard
    if (this.down.some(Boolean) || Math.hypot(ax(0), ax(1)) > 0.5 || Math.hypot(ax(2), ax(3)) > 0.5) {
      this.touched = true;
      this.setUsed(true);
    }
    const dz = Math.max(0, Math.min(0.5, this.opts.deadzone()));
    const radial = (x: number, y: number, curve: boolean): [number, number] => {
      const m = Math.hypot(x, y);
      if (m <= dz) return [0, 0];
      // The last few percent count as full (worn sticks rarely reach 1)
      let k = Math.min(1, (m - dz) / (1 - dz - 0.04));
      // Fine near the middle, quick at the edge
      if (curve) k = 0.3 * k + 0.7 * k * k * k;
      return [(x / m) * k, (y / m) * k];
    };
    [this.move.x, this.move.y] = radial(ax(0), -ax(1), false);
    [this.look.x, this.look.y] = radial(ax(2), ax(3), true);
    this.lt = this.swallowed.has(PB.LT) ? 0 : (g.buttons[PB.LT]?.value ?? 0);
    this.rt = this.swallowed.has(PB.RT) ? 0 : (g.buttons[PB.RT]?.value ?? 0);
  }

  /** Ignore the buttons held now until they're let go (the A that closed a card doesn't also jump). */
  swallow(): void {
    this.down.forEach((d, i) => d && this.swallowed.add(i));
    this.down = this.down.map(() => false);
    this.prev = [];
  }

  private setUsed(on: boolean): void {
    if (on === this.used) return;
    this.used = on;
    document.body.classList.toggle('pad-on', on);
    document.body.classList.toggle('pad-xbox', on && this.kind === 'xbox');
    document.body.classList.toggle('pad-ps', on && this.kind === 'ps');
    this.onDevice();
  }
  private lose(): void {
    const wasUsed = this.touched;
    this.connected = false;
    this.index = -1;
    this.id = '';
    this.touched = false;
    this.prev = this.down = [];
    if (wasUsed) this.onLost();
  }
}

type Item = HTMLButtonElement | HTMLInputElement | HTMLSelectElement;

export interface NavScreen {
  /** The screen's root (shown now). */
  root: HTMLElement;
  /** B: back out (resume, close the card). */
  back?: () => void;
  /** Start: the screen's main action (by default its `.primary` button). */
  start?: () => void;
  /** Lit first when the screen opens (by default its `.primary` button, else the first). */
  first?: () => HTMLElement | null;
}

/** The pad drives one open screen at a time: the D-pad or left stick moves a highlight, A presses, B backs out. */
export class PadNav {
  private readonly pad: Pad;
  private root: HTMLElement | null = null;
  private at: Item | null = null;
  /** What the lit item is (its tag, data, name and words), to find it again when the screen draws itself anew. */
  private atSig = '';
  private dir = '';
  private repeatAt = 0;

  constructor(pad: Pad) {
    this.pad = pad;
  }

  /** Call every frame with the open screen (or null in play). Returns true when the pad's buttons went to a screen. */
  drive(s: NavScreen | null, now: number): boolean {
    if (!s) {
      this.clear();
      return false;
    }
    const pad = this.pad;
    if (s.root !== this.root) {
      this.clear();
      this.root = s.root;
      // The button that opened this screen doesn't also press something on it
      pad.swallow();
    }
    const items = this.items(s.root);
    if (this.at && !items.includes(this.at)) {
      const sig = this.atSig;
      this.light(items.find((el) => this.sig(el) === sig) ?? null);
    }
    if (!pad.used || !items.length) {
      this.light(null);
      return true;
    }
    // (The touch that wakes the highlight only shows it)
    const fresh = !this.at;
    if (fresh) this.light((s.first?.() as Item | null) ?? s.root.querySelector<Item>('.primary') ?? items[0]);
    // Which way: D-pad, or the left stick past halfway; held, it repeats
    const m = pad.move;
    const dir = pad.held('Up') || m.y > 0.6 ? 'up' : pad.held('Down') || m.y < -0.6 ? 'down' : pad.held('Left') || m.x < -0.6 ? 'left' : pad.held('Right') || m.x > 0.6 ? 'right' : '';
    let step = '';
    if (dir !== this.dir) {
      this.dir = dir;
      step = dir;
      this.repeatAt = now + 380;
    } else if (dir && now >= this.repeatAt) {
      step = dir;
      this.repeatAt = now + 110;
    }
    const at = this.at;
    if (step && at && !fresh) {
      if ((step === 'left' || step === 'right') && this.nudge(at, step === 'right' ? 1 : -1)) {
        // (a slider or a list moved)
      } else {
        const next = this.near(at, items, step);
        if (next) this.light(next);
      }
    }
    if (pad.pressed('A') && this.at) {
      const el = this.at;
      pad.swallow();
      if (el instanceof HTMLInputElement && el.type === 'checkbox') {
        el.checked = !el.checked;
        this.changed(el);
      } else if (el instanceof HTMLSelectElement) this.nudge(el, 1, true);
      else if (el instanceof HTMLInputElement && el.type === 'range') this.nudge(el, 1);
      else el.click();
    } else if (pad.pressed('B') && s.back) {
      pad.swallow();
      s.back();
    } else if (pad.pressed('Start')) {
      pad.swallow();
      if (s.start) s.start();
      else s.root.querySelector<HTMLButtonElement>('.primary')?.click();
    }
    return true;
  }

  /** Takes the highlight off (in play, or when the keyboard or mouse is used). */
  clear(): void {
    this.light(null);
    this.root = null;
    this.dir = '';
  }

  private items(root: HTMLElement): Item[] {
    return [...root.querySelectorAll<Item>('button, input[type=range], input[type=checkbox], select')].filter((el) => !el.disabled && el.getClientRects().length > 0 && !el.closest('[hidden]'));
  }
  private light(el: Item | null): void {
    if (this.at) {
      this.at.classList.remove('padfocus');
      this.at.closest('.row')?.classList.remove('padrow');
    }
    this.at = el;
    if (!el) return;
    this.atSig = this.sig(el);
    el.classList.add('padfocus');
    el.closest('.row')?.classList.add('padrow');
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  private sig(el: Item): string {
    return `${el.tagName}|${el.getAttribute('name') ?? ''}|${JSON.stringify(el.dataset)}|${(el.textContent ?? '').trim().slice(0, 24)}`;
  }
  /** Left/right on a slider or list moves its value; true if it did. */
  private nudge(el: Item, by: number, wrap = false): boolean {
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const step = Number(el.step) || 1;
      // About twenty presses end to end, on the slider's own steps
      const jump = Math.max(step, Math.round((max - min) / 20 / step) * step);
      const v = Math.max(min, Math.min(max, Number(el.value) + by * jump));
      el.value = String(Math.round(v / step) * step);
      this.changed(el);
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      const n = el.options.length;
      let i = el.selectedIndex + by;
      if (wrap) i = (i + n) % n;
      el.selectedIndex = Math.max(0, Math.min(n - 1, i));
      this.changed(el);
      return true;
    }
    return false;
  }
  private changed(el: Item): void {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  /** The nearest item that way, by where they sit on screen. */
  private near(from: Item, items: Item[], dir: string): Item | null {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: Item | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === from) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - ax;
      const dy = r.top + r.height / 2 - ay;
      // Along the way asked, and how far off to the side (which counts for more)
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along < 4) continue;
      const score = along + side * (dir === 'up' || dir === 'down' ? 0.5 : 2.5);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }
}
