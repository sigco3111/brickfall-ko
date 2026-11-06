// The best moments, kept as video: when the replay camera rolls on a big collapse, the canvas is recorded for those
// few seconds (the slow-motion replay itself), and the biggest few are kept to watch again from the results. The
// world can't be run back (the physics is on the GPU and doesn't rewind), so the moment is recorded as it plays.

export interface Clip {
  /** How big the moment was (voxels coming down), to keep the best. */
  size: number;
  label: string;
  url: string;
}

const KEEP = 3;

export class Replays {
  private readonly canvas: HTMLCanvasElement;
  private recorder: MediaRecorder | null = null;
  private clips: Clip[] = [];
  /** Clips recorded this contract (tests). */
  recorded = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  private static type(): string | null {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) if (MediaRecorder.isTypeSupported(t)) return t;
    return null;
  }

  /** Record the next `seconds` of the canvas as a moment of `size` (skipped if one is recording already). */
  capture(seconds: number, size: number, label: string): void {
    if (this.recorder || !('captureStream' in this.canvas)) return;
    const type = Replays.type();
    if (!type) return;
    try {
      const stream = this.canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        this.recorder = null;
        if (!chunks.length) return;
        const url = URL.createObjectURL(new Blob(chunks, { type }));
        this.recorded++;
        this.clips.push({ size, label, url });
        this.clips.sort((a, b) => b.size - a.size);
        for (const c of this.clips.splice(KEEP)) URL.revokeObjectURL(c.url);
      };
      rec.start(500);
      this.recorder = rec;
      setTimeout(() => {
        if (rec.state !== 'inactive') rec.stop();
      }, seconds * 1000);
    } catch {
      this.recorder = null;
    }
  }

  /** The biggest moment kept, or null. */
  best(): Clip | null {
    return this.clips[0] ?? null;
  }

  /** Forget them all (a new contract). */
  clear(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    for (const c of this.clips) URL.revokeObjectURL(c.url);
    this.clips = [];
    this.recorded = 0;
  }
}
