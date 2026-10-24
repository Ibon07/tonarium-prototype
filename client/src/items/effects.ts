import { createAudioContext } from '../audioDevices.ts';
import { get, set } from '../store.ts';
import { fxVolume } from '../volume.ts';

let audio: AudioContext | null = null;

export function playPico() {
  try {
    audio ??= createAudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(2600, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.12);
    gain.gain.setValueAtTime(Math.max(0.0001, 0.12 * fxVolume()), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  } catch { /* 音が出せない環境では無視 */ }
}

export function playShutter() {
  try {
    audio ??= createAudioContext();
    const t = audio.currentTime;
    const len = Math.floor(audio.sampleRate * 0.08);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    gain.gain.value = 0.25 * fxVolume();
    src.buffer = buf;
    src.connect(gain).connect(audio.destination);
    src.start(t);
  } catch { /* 音が出せない環境では無視 */ }
}

let fxKey = 0;

export function onHit(from: string, to: string) {
  const now = performance.now();
  set((s) => ({
    hits: { ...s.hits, [to]: now },
    swings: { ...s.swings, [from]: now },
    hitFx: [...s.hitFx, { key: ++fxKey, from, to }].slice(-8),
  }));
  playPico();
  // 叩かれた人の表示は時間で戻すので、終わったら再描画させる
  setTimeout(() => set((s) => ({ hits: { ...s.hits } })), 700);
}

export function consumeHitFx(key: number) {
  set((s) => ({ hitFx: s.hitFx.filter((f) => f.key !== key) }));
}

/** 経過に応じて 0 → 1 → 0 */
export function bump(at: number | undefined, now = performance.now(), dur = 450) {
  if (at === undefined) return 0;
  const t = (now - at) / dur;
  if (t < 0 || t > 1) return 0;
  return Math.sin(Math.PI * Math.min(1, t * 2.2)) * (1 - t);
}

export const recentlyHit = (id: string) => {
  const at = get().hits[id];
  return at !== undefined && performance.now() - at < 650;
};
