// LiveKit 接続はアプリのルート（このモジュール）で1つだけ持つ。
// 2D/3D の表示コンポーネントは接続に触らないので、表示切替で通話・配信が切れない。
// セッションを移るときだけ、前のルームから切断して次のルームへつなぎ直す。
import {
  Room, RoomEvent, Track, type RemoteTrack, type Participant as LkParticipant, type LocalTrackPublication,
} from 'livekit-client';
import { get, set } from '../store.ts';
import { send } from './ws.ts';

export const room = new Room({ adaptiveStream: false, dynacast: true });

/** 配信映像を表示する唯一の <video>。2D パネルと 3D スクリーン (VideoTexture) の両方がこれを使う */
export const shareVideoEl = document.createElement('video');
shareVideoEl.muted = true;
shareVideoEl.playsInline = true;
shareVideoEl.autoplay = true;

/** 音声要素の置き場（表示とは無関係に常駐） */
const audioHost = document.createElement('div');
audioHost.style.display = 'none';
document.body.appendChild(audioHost);

let reported = { micOn: false, sharing: false };

function syncParticipants() {
  if (get().voice !== 'connected') return;
  const all: LkParticipant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  const speaking: Record<string, boolean> = {};
  const micOn: Record<string, boolean> = {};
  let sharer: string | null = null;
  let shareHasAudio = false;
  for (const p of all) {
    speaking[p.identity] = p.isSpeaking;
    micOn[p.identity] = p.isMicrophoneEnabled;
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    if (pub && pub.track && !pub.isMuted) {
      sharer = p.identity;
      shareHasAudio = !!p.getTrackPublication(Track.Source.ScreenShareAudio);
    }
  }
  const lp = room.localParticipant;
  set({ speaking, micOn, sharer, shareHasAudio, micEnabled: lp.isMicrophoneEnabled });
  // 他セッションの人にもミュート・配信状態が見えるようにサーバーへ伝える
  const status = { micOn: lp.isMicrophoneEnabled, sharing: lp.isScreenShareEnabled };
  if (status.micOn !== reported.micOn || status.sharing !== reported.sharing) {
    reported = status;
    send({ t: 'status', ...status });
  }
}

function attachRemote(track: RemoteTrack) {
  if (track.kind === Track.Kind.Audio) {
    // マイク音声・配信音声とも1回だけ attach する（二重音声防止）
    audioHost.appendChild(track.attach());
  } else if (track.source === Track.Source.ScreenShare) {
    track.attach(shareVideoEl);
  }
}

room
  .on(RoomEvent.TrackSubscribed, (track) => { attachRemote(track); syncParticipants(); })
  .on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => { if (el !== shareVideoEl) el.remove(); });
    syncParticipants();
  })
  .on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
    if (pub.source === Track.Source.ScreenShare) pub.track?.attach(shareVideoEl);
    syncParticipants();
  })
  .on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
    if (pub.source === Track.Source.ScreenShare) pub.track?.detach(shareVideoEl);
    syncParticipants();
  })
  .on(RoomEvent.TrackMuted, syncParticipants)
  .on(RoomEvent.TrackUnmuted, syncParticipants)
  .on(RoomEvent.TrackPublished, syncParticipants)
  .on(RoomEvent.TrackUnpublished, syncParticipants)
  .on(RoomEvent.ParticipantConnected, syncParticipants)
  .on(RoomEvent.ParticipantDisconnected, syncParticipants)
  .on(RoomEvent.ActiveSpeakersChanged, syncParticipants)
  .on(RoomEvent.Reconnecting, () => set({ voice: 'connecting' }))
  .on(RoomEvent.Reconnected, () => { set({ voice: 'connected' }); syncParticipants(); });

/** 接続要求の世代。素早くセッションを移ったとき、古い接続結果を捨てるため */
let generation = 0;

function resetVoiceState() {
  audioHost.replaceChildren();
  shareVideoEl.srcObject = null;
  reported = { micOn: false, sharing: false };
  set({ speaking: {}, micOn: {}, sharer: null, shareHasAudio: false });
}

export async function leaveVoice() {
  generation++;
  await room.disconnect();
  resetVoiceState();
  set({ voice: 'off', voiceError: null });
}

export async function connectVoice(sid: string) {
  const gen = ++generation;
  await room.disconnect();
  resetVoiceState();
  if (gen !== generation) return;
  const s = get();
  set({ voice: 'connecting', voiceError: null });
  try {
    const q = new URLSearchParams({ id: s.selfId, name: s.selfName, session: sid });
    const j = await (await fetch(`/token?${q}`)).json();
    if (j.error) throw new Error(j.error);
    if (gen !== generation) return;
    await room.connect(j.url, j.token);
    if (gen !== generation) { await room.disconnect(); return; }
    await room.startAudio();
    set({ voice: 'connected' });
  } catch (e) {
    if (gen === generation) set({ voice: 'unavailable', voiceError: String((e as Error).message ?? e) });
    return;
  }
  if (get().micEnabled) {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      set({ micEnabled: false, voiceError: `マイクを開始できません: ${(e as Error).message}` });
    }
  }
  syncParticipants();
}

/** 未接続中は希望設定だけを切り替える（次に入ったセッションで適用） */
export async function toggleMic() {
  const next = !get().micEnabled;
  set({ micEnabled: next });
  if (get().voice !== 'connected') return;
  try {
    await room.localParticipant.setMicrophoneEnabled(next);
  } catch (e) {
    set({ voiceError: `マイク: ${(e as Error).message}` });
  }
  syncParticipants();
}

export async function toggleShare() {
  if (get().voice !== 'connected') return;
  const on = room.localParticipant.isScreenShareEnabled;
  try {
    await room.localParticipant.setScreenShareEnabled(
      !on,
      // Chrome/Edge: タブ共有ならタブ音声、Windows の画面全体共有ならシステム音声が付く
      { audio: true, systemAudio: 'include', suppressLocalAudioPlayback: false, selfBrowserSurface: 'exclude' },
      { videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 } },
    );
  } catch (e) {
    if ((e as Error).name !== 'NotAllowedError') set({ voiceError: `画面共有: ${(e as Error).message}` });
  }
  syncParticipants();
}
