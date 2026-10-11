/**
 * Silhouette of an image (logo / product) as an SVG path, traced in the
 * browser from its alpha channel (marching squares + RDP, src/morph/trace.ts).
 * Deterministic: same image → same path. Rendering waits for it (delayRender).
 * Returns null while loading or when the image has no usable alpha.
 */
import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import { silhouettePath } from './trace';

const cache = new Map<string, string | null>();

export function useSilhouette(url: string | undefined, box: { width: number; height: number }, res = 160): string | null {
  const key = url ? `${url}|${Math.round(box.width)}x${Math.round(box.height)}|${res}` : '';
  const [d, setD] = useState<string | null>(key && cache.has(key) ? cache.get(key)! : null);
  useEffect(() => {
    if (!url || cache.has(key)) return;
    const handle = delayRender(`silhouette ${url}`);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = (v: string | null) => {
      cache.set(key, v);
      setD(v);
      continueRender(handle);
    };
    img.onload = () => {
      try {
        const k = Math.min(1, res / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(8, Math.round(img.naturalWidth * k));
        const h = Math.max(8, Math.round(img.naturalHeight * k));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        const mask = new Uint8Array(w * h);
        let on = 0;
        for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 110) (mask[i] = 1), on++;
        // no alpha (opaque rectangle) → no silhouette: the caller falls back to another reveal
        if (on === 0 || on > w * h * 0.97) return done(null);
        // object-fit: contain box inside the layer
        const ar = w / h;
        const dw = box.width / box.height > ar ? box.height * ar : box.width;
        const dh = box.width / box.height > ar ? box.height : box.width / ar;
        done(silhouettePath(mask, w, h, { x: (box.width - dw) / 2, y: (box.height - dh) / 2, width: dw, height: dh }, { maxRings: 12, minShare: 0.004, eps: 0.6 }));
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = url;
  }, [key, url, box.width, box.height, res]);
  return d;
}
