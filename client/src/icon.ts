import { send } from './net/ws.ts';

export const iconUrl = (name: string, v?: string | null) =>
  `/icon?name=${encodeURIComponent(name.trim())}${v ? `&v=${v}` : `&t=${Date.now()}`}`;

/** 画像を選ばせて中央を正方形に切り抜き、128px の JPEG にしてその名前のアイコンとして保存する */
export function pickIcon(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const img = await createImageBitmap(file);
      const size = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      canvas.getContext('2d')!.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 128, 128);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) { resolve(null); return; }
      const res = await fetch(`/icon?name=${encodeURIComponent(name.trim())}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      if (!res.ok) { resolve(null); return; }
      send({ t: 'profileUpdated' });
      resolve(((await res.json()) as { icon: string | null }).icon);
    };
    input.click();
  });
}
