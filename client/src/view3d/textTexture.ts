import * as THREE from 'three';

/** 日本語を含む文字列を Canvas に描いてテクスチャ化する（フォントはブラウザ任せ） */
export function drawText(
  canvas: HTMLCanvasElement,
  lines: { text: string; color?: string; size?: number }[] | string,
  opts: { bg: string; fg?: string; size?: number; pad?: number },
) {
  const ctx = canvas.getContext('2d')!;
  const pad = opts.pad ?? 28;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const items = typeof lines === 'string' ? [{ text: lines }] : lines;
  let y = pad;
  for (const item of items) {
    const size = item.size ?? opts.size ?? 44;
    ctx.font = `${size}px "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif`;
    ctx.fillStyle = item.color ?? opts.fg ?? '#222';
    ctx.textBaseline = 'top';
    for (const para of item.text.split('\n')) {
      // 1文字ずつ詰めて折り返す（日本語向けの簡易版）
      let line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > canvas.width - pad * 2) {
          ctx.fillText(line, pad, y);
          y += size * 1.3;
          line = ch;
        } else line += ch;
      }
      ctx.fillText(line, pad, y);
      y += size * 1.3;
      if (y > canvas.height) return;
    }
  }
}

export function makeCanvasTexture(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, tex };
}
