let ctx: AudioContext | null = null;

function tone(c: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c: AudioContext, out: AudioNode, t: number, dur: number, vol: number) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(out);
  src.start(t);
}

const SYNTH: Record<string, (c: AudioContext, out: AudioNode, t: number) => void> = {
  clap: (c, out, t) => { for (let i = 0; i < 8; i++) noise(c, out, t + i * 0.11 + Math.random() * 0.03, 0.06, 0.5); },
  laugh: (c, out, t) => { for (let i = 0; i < 4; i++) tone(c, out, t + i * 0.16, 420 - i * 30, 300 - i * 30, 0.12, 'sawtooth', 0.12); },
  wow: (c, out, t) => tone(c, out, t, 260, 520, 0.7, 'triangle', 0.25),
  drum: (c, out, t) => {
    tone(c, out, t, 140, 50, 0.25, 'sine', 0.6);
    noise(c, out, t + 0.25, 0.08, 0.4);
    tone(c, out, t + 0.45, 140, 50, 0.3, 'sine', 0.6);
    noise(c, out, t + 0.45, 0.35, 0.35);
  },
  bell: (c, out, t) => { tone(c, out, t, 880, 870, 0.6, 'sine', 0.25); tone(c, out, t + 0.3, 660, 650, 0.8, 'sine', 0.25); },
  boo: (c, out, t) => tone(c, out, t, 150, 110, 0.6, 'square', 0.12),
};

/** つんつんされたときの音（自分だけに鳴る） */
export function playPoke() {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    tone(ctx, ctx.destination, t, 700, 1100, 0.09, 'sine', 0.3);
    tone(ctx, ctx.destination, t + 0.13, 800, 1300, 0.09, 'sine', 0.3);
  } catch { /* 音が出せない環境では無視 */ }
}

export function playSynth(id: string, volume: number) {
  const f = SYNTH[id];
  if (!f || volume <= 0.001) return;
  try {
    ctx ??= new AudioContext();
    const g = ctx.createGain();
    g.gain.value = volume;
    g.connect(ctx.destination);
    f(ctx, g, ctx.currentTime);
  } catch { /* 音が出せない環境では無視 */ }
}
