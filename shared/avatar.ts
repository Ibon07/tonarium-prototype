// お絵描きアバター（https://github.com/anthrotech-dev/oekaki-avatar）の形式

export interface AvatarParams {
  headSize: number;
  neckLength: number;
  headInFront: boolean;
  handSize: number;
  bodySize: number;
  tailSize: number;
  tailPosition: number;
  tailRotation: number;
  disableTail: boolean;
  legsSize: number;
  legsDistance: number;
  legsDistanceFromBody: number;
  legsInFront: boolean;
}

export const DEFAULT_PARAMS: AvatarParams = {
  headSize: 0, neckLength: 0, headInFront: true, handSize: 0, bodySize: 0,
  tailSize: 0, tailPosition: 0, tailRotation: 0, disableTail: false,
  legsSize: 0, legsDistance: 0, legsDistanceFromBody: 0, legsInFront: true,
};

/** manifest.json の params だけを取り出す（数値・真偽値以外は既定値） */
export function sanitizeParams(raw: unknown): AvatarParams {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PARAMS } as Record<string, number | boolean>;
  for (const [k, v] of Object.entries(DEFAULT_PARAMS)) {
    const x = src[k];
    if (typeof v === 'boolean' && typeof x === 'boolean') out[k] = x;
    if (typeof v === 'number' && typeof x === 'number' && Number.isFinite(x)) out[k] = Math.max(-100, Math.min(100, x));
  }
  return out as unknown as AvatarParams;
}

export const AVATAR_SAMPLES = ['/oekaki/sample.png'];

/** 未設定の人のサンプル。名前から決まるようにハッシュで選ぶ */
export function sampleFor(name: string) {
  let h = 0x811c9dc5;
  for (const ch of name.trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return AVATAR_SAMPLES[h % AVATAR_SAMPLES.length];
}
