/**
 * Pixel-level detector for the banned "generic template" backgrounds: dot
 * lattices, particle fields and line grids. Runs on real frames (probe stills
 * and frames decoded from the MP4), with text/media/card rectangles masked out
 * so Arabic i'jam dots, icons and UI details never count as a pattern.
 *
 * Pure function of a greyscale buffer — unit-tested with synthetic images.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PatternFinding {
  kind: 'dot-lattice' | 'particle-field' | 'line-grid';
  count: number;
  regularity: number;
  message: string;
}

export interface PatternScan {
  findings: PatternFinding[];
  blobs: number;
  lattice: number;
  gridLines: { cols: number; rows: number };
}

/** Separable box blur on a Float32 greyscale image. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / k;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

const cv = (xs: number[]) => {
  if (xs.length < 2) return 1;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return m > 0 ? Math.sqrt(v) / m : 1;
};

/**
 * @param grey  greyscale pixels (0..255), row-major
 * @param masks rectangles (image coordinates) to ignore — text, media, cards
 */
export function detectPatterns(grey: Uint8Array | Uint8ClampedArray, w: number, h: number, masks: Rect[] = [], opts: { threshold?: number; debug?: boolean } = {}): PatternScan & { points?: { x: number; y: number }[]; threshold?: number; sigma?: number } {
  const T = opts.threshold ?? 7;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = grey[i];
  const blur = boxBlur(L, w, h, Math.max(3, Math.round(w / 90)));
  const masked = new Uint8Array(w * h);
  for (const r of masks) {
    const pad = 2;
    const x0 = Math.max(0, Math.floor(r.x) - pad);
    const y0 = Math.max(0, Math.floor(r.y) - pad);
    const x1 = Math.min(w, Math.ceil(r.x + r.width) + pad);
    const y1 = Math.min(h, Math.ceil(r.y + r.height) + pad);
    for (let y = y0; y < y1; y++) masked.fill(1, y * w + x0, y * w + x1);
  }
  // Bright marks on dark and dark marks on light are scanned separately: with
  // high-contrast dots the halo around each dot also differs from the local mean,
  // and an unsigned test would merge dot + halo into one large blob.
  // Film grain (allowed up to 0.15) and codec noise raise the residual everywhere; a designed
  // dot/particle pattern stands well above that floor. Threshold = max(T, 4.5 σ) with σ from the
  // median absolute residual (robust: text edges and patterns are a small minority of pixels).
  const res: number[] = [];
  const step = Math.max(1, Math.floor((w * h) / 60000));
  for (let i = 0; i < w * h; i += step) if (!masked[i]) res.push(Math.abs(L[i] - blur[i]));
  res.sort((a, b) => a - b);
  const sigma = res.length ? res[Math.floor(res.length / 2)] * 1.4826 : 0;
  const thr = Math.max(T, 4.5 * sigma);
  const pos = scanSign(L, blur, masked, w, h, thr, 1);
  const neg = scanSign(L, blur, masked, w, h, thr, -1);
  const score = (r: SignScan) => r.findings.length * 1000 + r.centroids;
  const best = score(neg) > score(pos) ? neg : pos;
  return { findings: best.findings, blobs: best.centroids, lattice: best.lattice, gridLines: best.gridLines, ...(opts.debug ? { points: best.points, threshold: thr, sigma } : {}) };
}

interface SignScan {
  findings: PatternFinding[];
  centroids: number;
  lattice: number;
  gridLines: { cols: number; rows: number };
  points?: { x: number; y: number }[];
}

/**
 * A particle field covers the frame: points in at least 12 of 36 coarse cells, across ≥3 columns
 * and ≥3 rows. Anti-aliased edges of a few shapes (rings, glows, icons) cluster in a band and are not one.
 */
function spread(pts: { x: number; y: number }[], w: number, h: number): boolean {
  const cells = new Set<number>();
  const cols = new Set<number>();
  const rows = new Set<number>();
  for (const p of pts) {
    const cx = Math.min(5, Math.floor((p.x / w) * 6));
    const cy = Math.min(5, Math.floor((p.y / h) * 6));
    cells.add(cy * 6 + cx);
    cols.add(cx);
    rows.add(cy);
  }
  return cells.size >= 12 && cols.size >= 3 && rows.size >= 3;
}

function scanSign(L: Float32Array, blur: Float32Array, masked: Uint8Array, w: number, h: number, T: number, sign: 1 | -1): SignScan {
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (!masked[i] && sign * (L[i] - blur[i]) > T) on[i] = 1;

  // ── connected components (4-neighbour) → small round blobs
  const seen = new Uint8Array(w * h);
  const maxArea = Math.max(6, Math.round(w * h * 0.0004));
  const centroids: { x: number; y: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!on[i] || seen[i]) continue;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minx = w;
    let maxx = 0;
    let miny = h;
    let maxy = 0;
    stack.push(i);
    seen[i] = 1;
    let big = false;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (area > maxArea * 4) big = true;
      sx += x;
      sy += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && on[q] && !seen[q]) {
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (big || area < 2 || area > maxArea) continue;
    const bw = maxx - minx + 1;
    const bh = maxy - miny + 1;
    const aspect = bw / bh;
    const fill = area / (bw * bh);
    if (aspect < 0.5 || aspect > 2 || fill < 0.35) continue;
    centroids.push({ x: sx / area, y: sy / area });
  }

  // ── lattice regularity: nearest-neighbour distance spread
  let lattice = 1;
  if (centroids.length >= 12) {
    const sample = centroids.length > 400 ? centroids.filter((_, i) => i % Math.ceil(centroids.length / 400) === 0) : centroids;
    const nn = sample.map((a) => {
      let best = Infinity;
      for (const b of centroids) {
        if (a === b) continue;
        const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (d < best && d > 0) best = d;
      }
      return Math.sqrt(best);
    });
    lattice = cv(nn);
  }

  // ── line grid: many long, regularly spaced straight lines in both axes
  const lines = (axis: 'col' | 'row') => {
    const n = axis === 'col' ? w : h;
    const len = axis === 'col' ? h : w;
    const hits: number[] = [];
    for (let a = 0; a < n; a++) {
      let c = 0;
      let avail = 0;
      for (let b = 0; b < len; b++) {
        const i = axis === 'col' ? b * w + a : a * w + b;
        if (masked[i]) continue;
        avail++;
        if (on[i]) c++;
      }
      if (avail > len * 0.4 && c / avail > 0.45) hits.push(a);
    }
    // merge adjacent indices (a 2px line is one line)
    const merged: number[] = [];
    for (const x of hits) if (!merged.length || x - merged[merged.length - 1] > 2) merged.push(x);
    const gaps = merged.slice(1).map((x, i) => x - merged[i]);
    return { count: merged.length, regular: gaps.length >= 3 ? cv(gaps) : 1 };
  };
  const colL = lines('col');
  const rowL = lines('row');

  const findings: PatternFinding[] = [];
  if (centroids.length >= 30 && lattice < 0.35) findings.push({ kind: 'dot-lattice', count: centroids.length, regularity: Math.round((1 - lattice) * 100) / 100, message: `${centroids.length} small dots in a regular lattice` });
  else if (centroids.length >= 70 && spread(centroids, w, h)) findings.push({ kind: 'particle-field', count: centroids.length, regularity: Math.round((1 - lattice) * 100) / 100, message: `${centroids.length} scattered small points (particle field)` });
  if (colL.count >= 4 && rowL.count >= 4 && colL.regular < 0.25 && rowL.regular < 0.25) findings.push({ kind: 'line-grid', count: colL.count + rowL.count, regularity: 1, message: `${colL.count}×${rowL.count} regularly spaced grid lines` });
  return { findings, centroids: centroids.length, lattice: Math.round(lattice * 100) / 100, gridLines: { cols: colL.count, rows: rowL.count }, points: centroids };
}
