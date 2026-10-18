import { sampleFor } from '../../shared/avatar.ts';
import { send } from './net/ws.ts';

const q = (name: string) => encodeURIComponent(name.trim());

/** その人のアバター画像。未設定ならサンプル */
export const avatarTextureUrl = (name: string, v: string | null | undefined) =>
  v ? `/avatar?name=${q(name)}&v=${v}` : sampleFor(name);

export const avatarParamsUrl = (name: string, v: string) => `/avatar/params?name=${q(name)}&v=${v}`;

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

async function post(path: string, body: Blob | string) {
  const res = await fetch(path, { method: 'POST', body });
  if (!res.ok) return null;
  send({ t: 'profileUpdated' });
  return ((await res.json()) as { avatar: string | null }).avatar;
}

/** テンプレートに描いた画像を選ばせ、2048×1024 の PNG にして保存する */
export async function uploadAvatarImage(name: string) {
  const file = await pickFile('image/*');
  if (!file) return null;
  const img = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  canvas.getContext('2d')!.drawImage(img, 0, 0, 2048, 1024);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return blob ? post(`/avatar?name=${q(name)}`, blob) : null;
}

/** oekaki-avatar から書き出した manifest.json の調整値を保存する */
export async function uploadAvatarManifest(name: string) {
  const file = await pickFile('application/json,.json');
  if (!file) return null;
  try {
    const manifest = JSON.parse(await file.text());
    return post(`/avatar/params?name=${q(name)}`, JSON.stringify(manifest.params ?? manifest));
  } catch {
    return null;
  }
}
