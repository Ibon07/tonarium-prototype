import { get, set, save } from './store.ts';

export type VolumeKind = 'voice' | 'fx' | 'media';

export function setMasterVolume(k: VolumeKind, v: number) {
  set((s) => {
    const audioVol = { ...s.audioVol, [k]: Math.max(0, Math.min(1, v)) };
    save('tonarium.audioVol', audioVol);
    return { audioVol };
  });
}

/** ミュート中でも、解除したときに戻せるよう音量は残しておく */
export const peerLevel = (name: string, s = get()) => s.peerVolume[name] ?? 1;
export const peerGain = (name: string, s = get()) => (s.peerMuted.includes(name) ? 0 : peerLevel(name, s));

export function setPeerVolume(name: string, v: number) {
  set((s) => {
    const peerVolume = { ...s.peerVolume, [name]: Math.max(0, Math.min(2, v)) };
    if (peerVolume[name] === 1) delete peerVolume[name];
    save('tonarium.peerVolume', peerVolume);
    return { peerVolume };
  });
}

export function togglePeerMute(name: string) {
  set((s) => {
    const peerMuted = s.peerMuted.includes(name) ? s.peerMuted.filter((n) => n !== name) : [...s.peerMuted, name];
    save('tonarium.peerMuted', peerMuted);
    return { peerMuted };
  });
}

export const fxVolume = () => get().audioVol.fx;
