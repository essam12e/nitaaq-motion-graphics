/**
 * Silhouette tracing for morph targets (logo reveal, object morphs).
 *
 * From a binary mask (e.g. the alpha channel of the user's logo) it extracts
 * the outer contours with marching squares, then simplifies them with
 * Ramer–Douglas–Peucker. The traced outline is only a MORPH TARGET: the real
 * logo is always shown from the user's own file, never redrawn or distorted.
 * Pure and deterministic.
 */
import type { P2 } from './path';
import { pointsToPath, signedArea } from './path';

/** Marching-squares contours of `mask` (w×h, 1 = inside). Returns closed rings in pixel space. */
export function traceContours(mask: Uint8Array, w: number, h: number): P2[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  // edge segments per cell (cell = 2×2 samples, coordinates on half-pixels)
  const segs = new Map<string, P2[]>();
  const key = (p: P2) => `${p.x},${p.y}`;
  const addSeg = (a: P2, b: P2) => {
    const k = key(a);
    if (!segs.has(k)) segs.set(k, []);
    segs.get(k)!.push(b);
  };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;
      const T = { x: x + 1, y: y + 0.5 };
      const R = { x: x + 1.5, y: y + 1 };
      const B = { x: x + 1, y: y + 1.5 };
      const L = { x: x + 0.5, y: y + 1 };
      // oriented so the inside is on the left (consistent winding)
      switch (c) {
        case 1: addSeg(B, L); break;
        case 2: addSeg(R, B); break;
        case 3: addSeg(R, L); break;
        case 4: addSeg(T, R); break;
        case 5: addSeg(T, L); addSeg(B, R); break;
        case 6: addSeg(T, B); break;
        case 7: addSeg(T, L); break;
        case 8: addSeg(L, T); break;
        case 9: addSeg(B, T); break;
        case 10: addSeg(L, B); addSeg(R, T); break;
        case 11: addSeg(R, T); break;
        case 12: addSeg(L, R); break;
        case 13: addSeg(B, R); break;
        case 14: addSeg(L, B); break;
      }
    }
  }
  const rings: P2[][] = [];
  const used = new Set<string>();
  for (const [k0, outs] of segs) {
    for (let oi = 0; oi < outs.length; oi++) {
      const edgeKey = `${k0}>${key(outs[oi])}`;
      if (used.has(edgeKey)) continue;
      const ring: P2[] = [];
      let curK = k0;
      let next = outs[oi];
      used.add(edgeKey);
      const [sx, sy] = k0.split(',').map(Number);
      ring.push({ x: sx, y: sy });
      let guard = 0;
      while (guard++ < w * h * 4) {
        const nk = key(next);
        if (nk === k0) break;
        ring.push(next);
        const cand = segs.get(nk) ?? [];
        const pick = cand.find((p) => !used.has(`${nk}>${key(p)}`));
        if (!pick) break;
        used.add(`${nk}>${key(pick)}`);
        curK = nk;
        next = pick;
      }
      void curK;
      if (ring.length >= 8) rings.push(ring);
    }
  }
  return rings;
}

/** Ramer–Douglas–Peucker simplification of a closed ring. */
export function simplify(ring: P2[], eps: number): P2[] {
  if (ring.length < 4) return ring;
  const rdp = (pts: P2[]): P2[] => {
    if (pts.length < 3) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    let idx = 0;
    let dmax = 0;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b.y - a.y) * pts[i].x - (b.x - a.x) * pts[i].y + b.x * a.y - b.y * a.x) / len;
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax <= eps) return [a, b];
    const left = rdp(pts.slice(0, idx + 1));
    const right = rdp(pts.slice(idx));
    return [...left.slice(0, -1), ...right];
  };
  // split the ring at its farthest pair so RDP works on two open chains
  const mid = Math.floor(ring.length / 2);
  const out = [...rdp(ring.slice(0, mid + 1)).slice(0, -1), ...rdp([...ring.slice(mid), ring[0]]).slice(0, -1)];
  return out.length >= 3 ? out : ring;
}

/**
 * Silhouette path of a mask, normalised into a target box. Keeps only the
 * significant outer bodies (≥ minShare of the largest), max `maxRings`.
 */
export function silhouettePath(mask: Uint8Array, w: number, h: number, box: { x: number; y: number; width: number; height: number }, opts: { maxRings?: number; minShare?: number; eps?: number } = {}): string | null {
  const rings = traceContours(mask, w, h)
    .map((r) => ({ r, a: signedArea(r) }))
    // outer bodies only (holes have the opposite winding)
    .filter((x) => x.a !== 0);
  if (!rings.length) return null;
  const sign = Math.sign(rings.reduce((best, x) => (Math.abs(x.a) > Math.abs(best.a) ? x : best)).a);
  const outer = rings.filter((x) => Math.sign(x.a) === sign).sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
  const maxA = Math.abs(outer[0].a);
  const keep = outer.filter((x) => Math.abs(x.a) >= maxA * (opts.minShare ?? 0.02)).slice(0, opts.maxRings ?? 12);
  const k = Math.min(box.width / w, box.height / h);
  const ox = box.x + (box.width - w * k) / 2;
  const oy = box.y + (box.height - h * k) / 2;
  const eps = opts.eps ?? Math.max(0.6, Math.max(w, h) / 300);
  return keep.map((x) => pointsToPath(simplify(x.r, eps).map((p) => ({ x: ox + p.x * k, y: oy + p.y * k })))).join(' ');
}
