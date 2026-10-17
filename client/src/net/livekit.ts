// LiveKit 接続はアプリのルート（このモジュール）で1つだけ持つ。
// 2D/3D の表示コンポーネントは接続に触らないので、表示切替で通話・配信が切れない。
// セッションを移るときだけ、前のルームから切断して次のルームへつなぎ直す。
import {
  Room, RoomEvent, Track, LocalVideoTrack,
  type RemoteTrack, type RemoteTrackPublication, type Participant as LkParticipant, type LocalTrackPublication,
} from 'livekit-client';
import { get, set, useStore } from '../store.ts';
import { addVoice, removeAllVoices, removeVoice } from '../spatial.ts';
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

/** カメラアイテムの配信映像（アイテムID → 受信用の <video>）。トラック名は `camera:<アイテムID>` */
export const camVideos = new Map<string, HTMLVideoElement>();
export const camHolder = document.createElement('div');
Object.assign(camHolder.style, { position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
document.body.appendChild(camHolder);
/**
 * 映像フィードのキー: カメラアイテムは `camera:<アイテムID>` → アイテムID、
 * フォローされた人の視点は `view:<ユーザーID>` → そのまま
 */
const camIdOf = (name: string | undefined) =>
  name?.startsWith('camera:') ? name.slice(7) : name?.startsWith('view:') ? name : null;

function setCamFeed(id: string, on: boolean) {
  set((s) => {
    const camFeeds = { ...s.camFeeds };
    if (on) camFeeds[id] = performance.now();
    else delete camFeeds[id];
    return { camFeeds };
  });
}

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

function attachRemote(track: RemoteTrack, pub: RemoteTrackPublication, identity: string) {
  const camId = camIdOf(pub.trackName);
  if (camId && track.kind === Track.Kind.Video) {
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    camHolder.appendChild(el);
    track.attach(el);
    camVideos.set(camId, el);
    setCamFeed(camId, true);
    return;
  }
  if (track.kind === Track.Kind.Audio) {
    // マイク音声・配信音声とも1回だけ attach する（二重音声防止）
    const el = track.attach();
    if (track.source === Track.Source.Microphone) {
      // マイクは空間オーディオの経路で鳴らす（Chrome では要素にもつないでおかないと音が流れないので、要素はミュート）
      el.muted = true;
      addVoice(identity, track.mediaStreamTrack);
    }
    audioHost.appendChild(el);
  } else if (track.source === Track.Source.ScreenShare) {
    track.attach(shareVideoEl);
  }
}

room
  .on(RoomEvent.TrackSubscribed, (track, pub, p) => { attachRemote(track, pub, p.identity); syncViewSubscriptions(); syncParticipants(); })
  .on(RoomEvent.TrackUnsubscribed, (track, pub, p) => {
    if (track.source === Track.Source.Microphone) removeVoice(p.identity);
    track.detach().forEach((el) => { if (el !== shareVideoEl) el.remove(); });
    const camId = camIdOf(pub.trackName);
    if (camId) { camVideos.delete(camId); setCamFeed(camId, false); }
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
  .on(RoomEvent.TrackPublished, () => { syncViewSubscriptions(); syncParticipants(); })
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
  camHolder.replaceChildren();
  removeAllVoices();
  camVideos.clear();
  set({ camFeeds: {} });
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

/** カメラアイテムの視点を配信する。戻り値で配信を止める */
export async function publishCamera(itemId: string, mediaTrack: MediaStreamTrack) {
  const track = new LocalVideoTrack(mediaTrack, undefined, true);
  const pub = await room.localParticipant.publishTrack(track, {
    name: `camera:${itemId}`,
    source: Track.Source.Camera,
    videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 15 },
    simulcast: false,
  });
  return async () => {
    if (pub.track) await room.localParticipant.unpublishTrack(pub.track);
    track.stop();
  };
}

/** フォローされている間、自分の視点（メインの 3D キャンバス）を配信する。戻り値で止める */
export async function publishView(canvas: HTMLCanvasElement) {
  const mediaTrack = canvas.captureStream(15).getVideoTracks()[0];
  const track = new LocalVideoTrack(mediaTrack, undefined, true);
  const pub = await room.localParticipant.publishTrack(track, {
    name: `view:${get().selfId}`,
    source: Track.Source.Camera,
    videoEncoding: { maxBitrate: 1_500_000, maxFramerate: 15 },
    simulcast: false,
  });
  return async () => {
    if (pub.track) await room.localParticipant.unpublishTrack(pub.track);
    track.stop();
  };
}

/** 視点の配信は、その人をフォローしている人だけが受信する */
function syncViewSubscriptions() {
  const s = get();
  const myFollow = s.participants.find((p) => p.id === s.selfId)?.follow ?? null;
  for (const p of room.remoteParticipants.values())
    for (const pub of p.trackPublications.values()) {
      if (!pub.trackName.startsWith('view:')) continue;
      const want = myFollow === p.identity;
      if (pub.isSubscribed !== want) pub.setSubscribed(want);
    }
}
useStore.subscribe((s, prev) => { if (s.participants !== prev.participants) syncViewSubscriptions(); });
