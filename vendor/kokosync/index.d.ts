export type Value = null | boolean | number | string | Uint8Array | Value[] | { [key: string]: Value };
export interface Frame { v?: number; type: string; id?: string; [key: string]: any }
export interface ConnectOptions {
  url?: string; room: string; peer?: string; state?: boolean;
  transport?: "webrtc" | "websocket"; timeout?: number;
  connectTimeout?: number;
  offerUrl?: string; offerHeaders?: Record<string, string>;
  websocketUrl?: string; websocketFactory?: (url: URL) => WebSocket;
  /** Omit to negotiate default limits; false retains legacy small envelopes. */
  fragmentation?: Partial<FragmentationLimits> | false;
}
export interface FragmentationLimits {
  logicalBytes: number; chunkBytes: number; reassemblyBytes: number;
  inflightBytes: number; concurrent: number; timeoutMs: number; queueBytes: number;
}
export interface BlobSink {
  write(bytes: Uint8Array): void | Promise<void>;
  close?(): void | Promise<void>;
  abort?(error: Error): void | Promise<void>;
}
export interface Capabilities {
  transport: string; reliableOrdered: boolean; datagram: boolean; boundedLatest: boolean;
  insecureDevelopment: boolean; maxFrame: number; maxRealtimeFrame?: number; blobResume: boolean;
  fragmentation?: FragmentationLimits;
}
export interface BlobResult { transfer: string; size?: bigint; sha256?: string }
export interface RequestOptions { id?: string; signal?: AbortSignal }
export interface Follower {
  readonly seq: bigint;
  checkpoint(): Promise<Frame>;
  stop(): void;
}
export class KokosyncError extends Error { code: string; constructor(code: string, message: string) }
export function counter(value: bigint, name?: string): bigint;
export function validateValue(value: Value, maxBytes?: number): Value;
export class KokosyncClient {
  static connect(options: ConnectOptions): Promise<KokosyncClient>;
  readonly transport: string;
  readonly joined: Frame;
  readonly capabilities: Capabilities;
  readonly options: ConnectOptions;
  readonly state: Map<string, Frame>;
  readonly seq: bigint;
  readonly revision: bigint;
  readonly closed: boolean;
  on(type: string, listener: (frame: Frame) => void | Promise<void>): () => void;
  send(type: string, fields?: Record<string, any>): void;
  request(type: string, fields?: Record<string, any>, response?: string, options?: { signal?: AbortSignal }): Promise<Frame>;
  message(topic: string, value: Value, idOrOptions?: string | RequestOptions): Promise<Frame>;
  event(topic: string, value: Value, ttlMs?: number): Promise<Frame>;
  latest(key: string, value: Value, seq: bigint): void;
  live(stream: string, value: Uint8Array, seq: bigint, ttlMs?: number, codecName?: string): void;
  set(key: string, value: Value, expected?: bigint, idOrOptions?: string | RequestOptions): Promise<Frame>;
  delete(key: string, expected?: bigint, id?: string): Promise<Frame>;
  snapshot(): Promise<Frame>;
  checkpoint(seq: bigint, value: Value): Promise<Frame>;
  catchup(): Promise<Frame>;
  ping(): Promise<Frame>;
  stats(): Promise<Frame>;
  get(key: string): Value | undefined;
  follow(handlers: {
    restore(value: Value): void;
    apply(message: Frame): void;
    capture(): Value;
  }): Promise<Follower>;
  acceptBlob(offer: Frame & { transfer: string; size: bigint }, sink: BlobSink): Promise<BlobResult>;
  sendBlob(to: string, source: Uint8Array | Blob | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    options?: { size?: bigint; transfer?: string; signal?: AbortSignal }): Promise<BlobResult>;
  cancelBlob(transfer: string, reason?: Error): void;
  close(): void;
}
