// Tiny WebAudio-synthesised sound effects (no asset files). Plays on user
// gestures (build/place/win), so the AudioContext is allowed to start.
let ctx: AudioContext | null = null;
let muted = false;

export function setSfxMuted(m: boolean): void {
  muted = m;
}
export function isSfxMuted(): boolean {
  return muted;
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
  const c = ac();
  if (!c) return;
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  } catch {}
}

export type Sfx = "tick" | "place" | "clack" | "gong";

export function playSfx(kind: Sfx): void {
  if (muted) return;
  switch (kind) {
    case "tick": // soft boarding/UI tick
      tone(640, 0.05, "square", 0.035);
      break;
    case "place": // a station dropped
      tone(880, 0.06, "sine", 0.05);
      break;
    case "clack": // rail laid / line finished
      tone(330, 0.09, "triangle", 0.09);
      setTimeout(() => tone(210, 0.12, "triangle", 0.07), 45);
      break;
    case "gong": // goal reached — a soft Lanna gong
      tone(180, 1.3, "sine", 0.13, 95);
      tone(272, 1.3, "sine", 0.06, 150);
      break;
  }
}
