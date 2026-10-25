import type { Participant } from '../shared/protocol.ts';

export const THUMBNAIL_INTERVAL = 3 * 60_000;
export const THUMBNAIL_MAX_BYTES = 64 * 1024;
interface ThumbnailState { thumbnailPhotographer?: string; thumbnail?: string; nextRequest: number }

export class SessionThumbnails {
  private sessions = new Map<string, ThumbnailState>();

  constructor(private request: (id: string, sid: string) => void,
    private changed: () => void,
    private reject: () => void = () => console.warn('[thumbnail] rejected upload')) {}

  register(sid: string) { this.sessions.set(sid, { nextRequest: 0 }); }
  delete(sid: string) { this.sessions.delete(sid); }

  update(sid: string, participants: Pick<Participant, 'id' | 'mode'>[], now = Date.now()) {
    const state = this.sessions.get(sid);
    if (!state) return;
    const eligible = participants.filter((u) => u.mode === '3d');
    const previous = state.thumbnailPhotographer;
    const hadThumbnail = !!state.thumbnail;
    if (!eligible.some((u) => u.id === previous)) {
      state.thumbnailPhotographer = eligible[0]?.id;
      state.nextRequest = 0;
    }
    if (!participants.length) state.thumbnail = undefined;
    if (previous !== state.thumbnailPhotographer || (!participants.length && hadThumbnail)) this.changed();
    if (state.thumbnailPhotographer && now >= state.nextRequest) {
      state.nextRequest = now + THUMBNAIL_INTERVAL;
      this.request(state.thumbnailPhotographer, sid);
    }
  }

  thumbnail(sid: string) {
    const state = this.sessions.get(sid);
    return state?.thumbnailPhotographer ? state.thumbnail : undefined;
  }

  upload(sid: string, id: string, value: unknown) {
    const state = this.sessions.get(sid);
    if (!state || state.thumbnailPhotographer !== id || typeof value !== 'string' ||
        value.length > 23 + 4 * Math.ceil(THUMBNAIL_MAX_BYTES / 3) ||
        !/^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      this.reject(); return;
    }
    const bytes = Buffer.from(value.slice(23), 'base64');
    if (bytes.length > THUMBNAIL_MAX_BYTES || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
        bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      this.reject(); return;
    }
    state.thumbnail = value;
    this.changed();
  }
}
