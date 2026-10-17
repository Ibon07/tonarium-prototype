import { get, set } from '../store.ts';

let audio: AudioContext | null = null;

/** ピコッという音（WebAudio で合成） */
export function playPico() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(2600, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.12);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  } catch { /* 音が出せない環境では無視 */ }
}

let fxKey = 0;

/** サーバーから叩いた通知が来た（自分が叩いた場合も含む） */
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

/** 叩かれてからの経過に応じた 0..1..0 の値（へこみ量など） */
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
