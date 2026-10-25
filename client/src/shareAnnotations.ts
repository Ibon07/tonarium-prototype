export type Point = { x: number; y: number };
export type Segment = { id: string; owner: string; a: Point; b: Point };
type Packet = { share: string; kind: 'request' | 'history' | 'segment' | 'cursor'; segments?: Segment[]; point?: Point | null };
export const ANNOTATION_TOPIC = 'share-annotations-v1';

export function videoRect(width: number, height: number, videoWidth: number, videoHeight: number) {
  if (Math.min(width, height, videoWidth, videoHeight) <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const w = videoWidth * scale, h = videoHeight * scale;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

export function normalizedPoint(x: number, y: number, rect: ReturnType<typeof videoRect>): Point | null {
  if (!rect.width || !rect.height) return null;
  const point = { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
  return validPoint(point) ? point : null;
}

function validPoint(p: unknown): p is Point {
  if (!p || typeof p !== 'object') return false;
  const { x, y } = p as Point;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

export function annotationColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 85% 65%)`;
}

export class ShareAnnotations {
  private share: string | null = null;
  private authority = '';
  private self = '';
  private hydrated = false;
  private segments = new Map<string, Segment>();
  private cursors = new Map<string, Point>();
  private listeners = new Set<() => void>();
  private state = { share: this.share, segments: [] as Segment[], cursors: new Map<string, Point>() };
  constructor(private transmit: (packet: Packet, to?: string) => void) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private notify() {
    this.state = { share: this.share, segments: [...this.segments.values()], cursors: new Map(this.cursors) };
    this.listeners.forEach((listener) => listener());
  }
  setShare(share: string | null, authority: string, self: string) {
    if (share === this.share && self === this.self) return;
    this.share = share;
    this.authority = authority;
    this.self = self;
    this.hydrated = false;
    this.segments.clear();
    this.cursors.clear();
    this.notify();
    this.requestHistory();
  }
  requestHistory() {
    if (this.share && !this.hydrated && this.self !== this.authority) this.transmit({ share: this.share, kind: 'request' }, this.authority);
  }
  removeParticipant(id: string) {
    if (this.cursors.delete(id)) this.notify();
  }
  cursor(point: Point | null) {
    if (!this.share) return;
    if (point) this.cursors.set(this.self, point); else this.cursors.delete(this.self);
    this.notify();
    this.transmit({ share: this.share, kind: 'cursor', point });
  }
  draw(a: Point, b: Point) {
    if (!this.share || !validPoint(a) || !validPoint(b)) return;
    const segment = { id: crypto.randomUUID(), owner: this.self, a, b };
    this.segments.set(segment.id, segment);
    this.notify();
    this.transmit({ share: this.share, kind: 'segment', segments: [segment] }, this.self === this.authority ? undefined : this.authority);
  }
  receive(input: unknown, sender: string) {
    if (!input || typeof input !== 'object' || !sender || !this.share) return;
    const packet = input as Packet;
    if (packet.share !== this.share) return;
    if (packet.kind === 'request' && this.self === this.authority) {
      const history = [...this.segments.values()];
      if (!history.length) this.transmit({ share: this.share, kind: 'history', segments: [] }, sender);
      // 履歴も小分けにして LiveKit のデータパケット上限内に収める。
      for (let i = 0; i < history.length; i += 40) this.transmit({ share: this.share, kind: 'history', segments: history.slice(i, i + 40) }, sender);
      return;
    }
    if (packet.kind === 'cursor') {
      if (packet.point === null) this.cursors.delete(sender);
      else if (validPoint(packet.point)) this.cursors.set(sender, packet.point);
      else return;
      this.notify();
    } else if (packet.kind === 'segment' || (packet.kind === 'history' && sender === this.authority)) {
      if (!Array.isArray(packet.segments) || packet.segments.length > 40) return;
      if (packet.kind === 'segment' && sender !== this.authority && this.self !== this.authority) return;
      if (packet.kind === 'history') this.hydrated = true;
      const added: Segment[] = [];
      for (const s of packet.segments) {
        if (!s || typeof s.id !== 'string' || s.id.length > 80 || typeof s.owner !== 'string' || s.owner.length > 128 || !validPoint(s.a) || !validPoint(s.b)) continue;
        if (packet.kind === 'segment' && sender !== this.authority && s.owner !== sender) continue;
        if (!this.segments.has(s.id)) {
          const segment = { id: s.id, owner: s.owner, a: s.a, b: s.b };
          this.segments.set(s.id, segment);
          added.push(segment);
        }
      }
      if (packet.kind === 'segment' && this.self === this.authority && added.length) this.transmit({ share: this.share, kind: 'segment', segments: added });
      this.notify();
    }
  }
}
