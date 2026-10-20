import { encode, decode } from '@msgpack/msgpack';
import { KokosyncClient, type Frame, type Value } from '../vendor/kokosync/index.js';

export const PACKET_TOPIC = 'tonarium.v1';
export const MAX_PACKET = 32 * 1024 * 1024;
export const BLOB_THRESHOLD = 48 * 1024;
export interface SyncConfig {
  sid: string; room: string; peer: string; server: string; token: string; key: string; slot: number;
}
export interface Envelope {
  grant: string; seq: number; lane: string; iv: Uint8Array; body: Uint8Array;
}
export const pack = (value: unknown) => encode(value, { ignoreUndefined: true });
export const unpack = (bytes: Uint8Array): unknown => decode(bytes, {
  maxStrLength: MAX_PACKET, maxBinLength: MAX_PACKET, maxArrayLength: MAX_PACKET, maxMapLength: 100_000,
});
export const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
export const unbase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const importKey = (value: string) => crypto.subtle.importKey('raw', unbase64(value), 'AES-GCM', false, ['encrypt', 'decrypt']);
const aad = (grant: string, lane: string, seq: number) => pack([PACKET_TOPIC, grant, lane, seq]);

export async function seal(key: CryptoKey, grant: string, lane: string, seq: number, value: unknown): Promise<Envelope> {
  return sealBytes(key, grant, lane, seq, pack(value));
}
export async function sealBytes(key: CryptoKey, grant: string, lane: string, seq: number, bytes: Uint8Array): Promise<Envelope> {
  if (bytes.length > MAX_PACKET - 1024) throw new Error('同期データが 32 MiB を超えています');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(grant, lane, seq) }, key, new Uint8Array(bytes)));
  return { grant, lane, seq, iv, body };
}

export async function open(key: CryptoKey, grant: string, lane: string, raw: unknown): Promise<{ seq: number; value: any }> {
  const p = raw as Envelope;
  if (!p || p.grant !== grant || p.lane !== lane || !Number.isSafeInteger(p.seq) || p.seq < 1 ||
      !(p.iv instanceof Uint8Array) || p.iv.length !== 12 || !(p.body instanceof Uint8Array) || p.body.length > MAX_PACKET)
    throw new Error('Invalid session packet');
  const value = unpack(new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: new Uint8Array(p.iv), additionalData: aad(grant, lane, p.seq),
  }, key, new Uint8Array(p.body))));
  return { seq: p.seq, value };
}

export async function sendPacket(client: KokosyncClient, peer: string, packet: Envelope) {
  const bytes = pack(packet);
  if (bytes.length > BLOB_THRESHOLD) await client.sendBlob(peer, bytes);
  else await client.message(PACKET_TOPIC, packet as unknown as Value);
}

export function receiveBlob(client: KokosyncClient, offer: Frame, accept: (peer: string) => boolean,
  receive: (packet: unknown, peer: string) => Promise<void>) {
  if (!accept(offer.peer) || typeof offer.size !== 'bigint' || offer.size > BigInt(MAX_PACKET) || offer.size < 1n) {
    client.cancelBlob(offer.transfer, new Error('Unexpected session blob'));
    return Promise.resolve();
  }
  const bytes = new Uint8Array(Number(offer.size));
  let offset = 0;
  return client.acceptBlob(offer as Frame & { transfer: string; size: bigint }, {
    write(chunk) { bytes.set(chunk, offset); offset += chunk.length; },
    async close() { await receive(unpack(bytes), offer.peer); },
  }).then(() => {});
}
