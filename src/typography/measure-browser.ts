/** Canvas-based text measurement (browser). Requires fonts loaded (FontGate). */
import type { Measurer } from './fit';
import { estimateMeasure } from './fit';

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

export const canvasMeasure: Measurer = (text, font) => {
  if (typeof document === 'undefined') return estimateMeasure(text, font);
  const key = `${font.weight}|${font.size}|${font.family}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return estimateMeasure(text, font);
  ctx.font = `${font.weight} ${font.size}px ${font.family}`;
  // Arabic shaping requires direction; canvas measures shaped runs correctly in Chromium.
  (ctx as unknown as { direction: string }).direction = /[؀-ۿ]/.test(text) ? 'rtl' : 'ltr';
  const w = ctx.measureText(text).width;
  if (cache.size > 20000) cache.clear();
  cache.set(key, w);
  return w;
};
