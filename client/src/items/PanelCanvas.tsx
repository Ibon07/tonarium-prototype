import { useEffect, useRef } from 'react';
import type { Item } from '../../../shared/items.ts';
import { useStore } from '../store.ts';
import { PANELS } from './panels.ts';

const NO_UI = {};
/** 描画倍率（拡大しても文字がつぶれないように） */
export const PANEL_SCALE = 2;

export function drawPanel(canvas: HTMLCanvasElement, item: Item, ui: { sel?: number }) {
  const panel = PANELS[item.kind];
  if (!panel) return;
  if (canvas.width !== panel.w * PANEL_SCALE) {
    canvas.width = panel.w * PANEL_SCALE;
    canvas.height = panel.h * PANEL_SCALE;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(PANEL_SCALE, 0, 0, PANEL_SCALE, 0, 0);
  panel.draw(ctx, item, ui);
}

/** アイテムの 2D 画面。interactive のときだけクリックを受け付ける */
export function PanelCanvas({ item, interactive }: { item: Item; interactive: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ui = useStore((s) => s.itemUi[item.id] ?? NO_UI);
  const panel = PANELS[item.kind]!;
  useEffect(() => { drawPanel(ref.current!, item, ui); }, [item, ui]);
  return (
    <canvas
      ref={ref}
      className="panelcanvas"
      style={{ aspectRatio: `${panel.w} / ${panel.h}` }}
      onClick={(e) => {
        if (!interactive) return;
        const r = e.currentTarget.getBoundingClientRect();
        panel.click(((e.clientX - r.left) / r.width) * panel.w, ((e.clientY - r.top) / r.height) * panel.h, item, ui);
      }}
    />
  );
}
