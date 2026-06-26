// Lightweight synthesized sound effects via the Web Audio API.
// No audio files to download — everything is generated on the fly.

type SfxName =
  | "join"
  | "submit"
  | "vote"
  | "reveal"
  | "correct"
  | "wrong"
  | "tick"
  | "win"
  | "click";

const MUTE_KEY = "matah.muted";

let ctx: AudioContext | null = null;
let muted = readMutedPref();

function readMutedPref(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // Browsers suspend audio until a user gesture; resume opportunistically.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.18
): void {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.02);
}

const recipes: Record<SfxName, () => void> = {
  click: () => tone(420, 0, 0.06, "triangle", 0.1),
  join: () => {
    tone(523, 0, 0.1, "triangle");
    tone(784, 0.08, 0.14, "triangle");
  },
  submit: () => {
    tone(440, 0, 0.08, "square", 0.12);
    tone(660, 0.07, 0.12, "square", 0.12);
  },
  vote: () => tone(600, 0, 0.12, "sine", 0.16),
  reveal: () => {
    tone(300, 0, 0.12, "sawtooth", 0.1);
    tone(450, 0.1, 0.16, "sawtooth", 0.1);
  },
  correct: () => {
    tone(523, 0, 0.1, "triangle");
    tone(659, 0.09, 0.1, "triangle");
    tone(784, 0.18, 0.18, "triangle");
  },
  wrong: () => {
    tone(220, 0, 0.18, "sawtooth", 0.14);
    tone(160, 0.12, 0.22, "sawtooth", 0.14);
  },
  tick: () => tone(880, 0, 0.04, "square", 0.07),
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone(f, i * 0.12, 0.22, "triangle", 0.2)
    );
  },
};

export function playSfx(name: SfxName): void {
  if (muted) return;
  try {
    recipes[name]();
  } catch {
    /* ignore audio errors */
  }
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable (private mode) — keep the in-memory preference */
  }
}

export function isMuted(): boolean {
  return muted;
}
