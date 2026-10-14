/**
 * Path geometry on top of the morph parser (src/morph/path.ts): every SVG path is
 * absolute cubic Béziers, so transforms, lengths, bounds and trims are exact.
 *
 *   transformSubs   affine map (control points map exactly)
 *   pathLength      arc length (Gauss–Legendre per segment)
 *   trimSubs        After-Effects-style trim paths: start / end / offset, across the
 *                   whole path ('sequential') or each sub-path at once ('parallel')
 *   subsBounds      tight bounds from the curve extrema, not the control points
 *   simplifyPath    Ramer–Douglas–Peucker on the flattened path (budget repair)
 *
 * Pure and deterministic.
 */
import { parsePath, resample, type Cubic, type P2, type SubPath } from '../morph/path';
import { apply, type Mat } from './matrix';

export type { Cubic, P2, SubPath };

const f = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Absolute cubic path string. */
export function subsToPath(subs: SubPath[]): string {
  return subs
    .map((s) => {
      if (!s.segs.length) return '';
      const p0 = s.segs[0][0];
      return `M${f(p0.x)} ${f(p0.y)}` + s.segs.map((c) => `C${f(c[1].x)} ${f(c[1].y)} ${f(c[2].x)} ${f(c[2].y)} ${f(c[3].x)} ${f(c[3].y)}`).join('') + (s.closed ? 'Z' : '');
    })
    .join('');
}

/** Any SVG path → the same path as absolute cubics (M C … Z). */
export const normalizePath = (d: string) => subsToPath(parsePath(d));

export const transformSubs = (subs: SubPath[], m: Mat): SubPath[] => subs.map((s) => ({ closed: s.closed, segs: s.segs.map((c) => c.map((p) => apply(m, p)) as Cubic) }));

export const transformPath = (d: string, m: Mat) => subsToPath(transformSubs(parsePath(d), m));

// ── evaluation

export const pointAt = (c: Cubic, t: number): P2 => {
  const u = 1 - t;
  return {
    x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x,
    y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y,
  };
};

const deriv = (c: Cubic, t: number): P2 => {
  const u = 1 - t;
  return {
    x: 3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x),
    y: 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y),
  };
};

// 8-point Gauss–Legendre on [0,1]
const GL_X = [0.0198550717512319, 0.1016667612931866, 0.2372337950418355, 0.4082826787521751, 0.5917173212478249, 0.7627662049581645, 0.8983332387068134, 0.9801449282487681];
const GL_W = [0.0506142681451881, 0.1111905172266872, 0.1568533229389436, 0.1813418916891810, 0.1813418916891810, 0.1568533229389436, 0.1111905172266872, 0.0506142681451881];

/** Arc length of a cubic from 0 to t. */
export function cubicLength(c: Cubic, t = 1): number {
  // split into 4 pieces so long, sharply bent segments stay accurate
  let s = 0;
  const pieces = 4;
  for (let k = 0; k < pieces; k++) {
    const a = (k / pieces) * t;
    const b = ((k + 1) / pieces) * t;
    for (let i = 0; i < 8; i++) {
      const d = deriv(c, a + (b - a) * GL_X[i]);
      s += GL_W[i] * (b - a) * Math.hypot(d.x, d.y);
    }
  }
  return s;
}

/** Parameter t where the arc length from 0 reaches `len` (bisection, monotone). */
export function tAtLength(c: Cubic, len: number, total = cubicLength(c)): number {
  if (len <= 0) return 0;
  if (len >= total) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cubicLength(c, mid) < len) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** de Casteljau split at t. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const l = (a: P2, b: P2): P2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = l(c[0], c[1]);
  const p12 = l(c[1], c[2]);
  const p23 = l(c[2], c[3]);
  const a = l(p01, p12);
  const b = l(p12, p23);
  const m = l(a, b);
  return [
    [c[0], p01, a, m],
    [m, b, p23, c[3]],
  ];
}

/** Piece of a cubic between t0 and t1. */
export function subCubic(c: Cubic, t0: number, t1: number): Cubic {
  if (t0 <= 0 && t1 >= 1) return c;
  const right = t0 > 0 ? splitCubic(c, t0)[1] : c;
  const k = t0 >= 1 ? 0 : (t1 - t0) / (1 - t0);
  return k >= 1 ? right : splitCubic(right, Math.max(0, k))[0];
}

export const subLength = (s: SubPath) => s.segs.reduce((a, c) => a + cubicLength(c), 0);
export const pathLength = (subs: SubPath[] | string) => (typeof subs === 'string' ? parsePath(subs) : subs).reduce((a, s) => a + subLength(s), 0);

/** The part of one sub-path between arc lengths a and b (a < b, both within the sub-path). */
function sliceSub(s: SubPath, a: number, b: number): SubPath | null {
  if (b - a <= 1e-9) return null;
  const out: Cubic[] = [];
  let pos = 0;
  for (const c of s.segs) {
    const L = cubicLength(c);
    const s0 = pos;
    const s1 = pos + L;
    pos = s1;
    if (s1 <= a || s0 >= b || L <= 0) continue;
    const t0 = a > s0 ? tAtLength(c, a - s0, L) : 0;
    const t1 = b < s1 ? tAtLength(c, b - s0, L) : 1;
    out.push(subCubic(c, t0, t1));
  }
  return out.length ? { segs: out, closed: false } : null;
}

export interface TrimOptions {
  /** 0..1 of the length. */
  start?: number;
  end?: number;
  /** Shifts the window along the path (0..1, wraps on closed paths). */
  offset?: number;
  /** 'sequential': one window over all sub-paths in order (a pen drawing); 'parallel': each sub-path trimmed at once. */
  mode?: 'sequential' | 'parallel';
}

/** Trim paths (exact cubic splitting). start = 0, end = 1 returns the path unchanged. */
export function trimSubs(subs: SubPath[], o: TrimOptions = {}): SubPath[] {
  const start = Math.min(1, Math.max(0, o.start ?? 0));
  const end = Math.min(1, Math.max(0, o.end ?? 1));
  const off = o.offset ?? 0;
  if (start <= 0 && end >= 1 && !off) return subs;
  if (end <= start) return [];
  const window = (s: SubPath, L: number, from: number, to: number): SubPath[] => {
    // [from, to] in this sub-path's length, wrapping only on closed paths
    const res: SubPath[] = [];
    if (s.closed) {
      let a = (((from % L) + L) % L);
      const len = to - from;
      if (len >= L - 1e-9) return [{ ...s, closed: true }];
      let b = a + len;
      if (b > L) {
        const p1 = sliceSub(s, a, L);
        const p2 = sliceSub(s, 0, b - L);
        if (p1 && p2) res.push({ segs: [...p1.segs, ...p2.segs], closed: false });
        else if (p1 ?? p2) res.push((p1 ?? p2)!);
        return res;
      }
      a = Math.max(0, a);
      b = Math.min(L, b);
      const p = sliceSub(s, a, b);
      if (p) res.push(p);
      return res;
    }
    const a = Math.max(0, from);
    const b = Math.min(L, to);
    const p = sliceSub(s, a, b);
    if (p) res.push(p);
    return res;
  };
  if ((o.mode ?? 'sequential') === 'parallel') {
    return subs.flatMap((s) => {
      const L = subLength(s);
      return window(s, L, (start + off) * L, (end + off) * L);
    });
  }
  const lens = subs.map(subLength);
  const total = lens.reduce((a, b) => a + b, 0);
  // one closed outline: the window wraps around it as one piece
  if (subs.length === 1 && subs[0].closed) return window(subs[0], total, (start + off) * total, (end + off) * total);
  // several sub-paths: the window is wrapped over their combined length (an offset past the end continues at the start)
  const f0 = ((((start + off) * total) % total) + total) % total;
  const t0 = f0 + (end - start) * total;
  const ranges: [number, number][] = t0 > total ? [[f0, total], [0, t0 - total]] : [[f0, t0]];
  const out: SubPath[] = [];
  for (const [from, to] of ranges) {
    let pos = 0;
    subs.forEach((s, i) => {
      const L = lens[i];
      const a = pos;
      pos += L;
      if (to <= a || from >= a + L) return;
      out.push(...window({ ...s, closed: false }, L, from - a, to - a));
    });
  }
  return out;
}

export const trimPath = (d: string, o: TrimOptions) => subsToPath(trimSubs(parsePath(d), o));

// ── bounds

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tight bounds of one cubic: endpoints plus the extrema where the derivative is 0. */
export function cubicBounds(c: Cubic): Box {
  const xs = [c[0].x, c[3].x];
  const ys = [c[0].y, c[3].y];
  const roots = (p0: number, p1: number, p2: number, p3: number) => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const cc = p1 - p0;
    const r: number[] = [];
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) r.push(-cc / b);
    } else {
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        r.push((-b + s) / (2 * a), (-b - s) / (2 * a));
      }
    }
    return r.filter((t) => t > 0 && t < 1);
  };
  for (const t of roots(c[0].x, c[1].x, c[2].x, c[3].x)) xs.push(pointAt(c, t).x);
  for (const t of roots(c[0].y, c[1].y, c[2].y, c[3].y)) ys.push(pointAt(c, t).y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export const EMPTY_BOX: Box = { x: 0, y: 0, width: 0, height: 0 };

export function unionBox(boxes: Box[]): Box {
  const real = boxes.filter((b) => Number.isFinite(b.x) && (b.width > 0 || b.height > 0 || b.x || b.y));
  if (!real.length) return { ...EMPTY_BOX };
  const x = Math.min(...real.map((b) => b.x));
  const y = Math.min(...real.map((b) => b.y));
  return { x, y, width: Math.max(...real.map((b) => b.x + b.width)) - x, height: Math.max(...real.map((b) => b.y + b.height)) - y };
}

export const subsBounds = (subs: SubPath[]): Box => unionBox(subs.flatMap((s) => s.segs.map(cubicBounds)));

export const pathBounds = (d: string, m?: Mat) => subsBounds(m ? transformSubs(parsePath(d), m) : parsePath(d));

// ── flatten / simplify

/** Polyline per sub-path with about `tolerance` px between points. */
export function flatten(subs: SubPath[], tolerance = 1): { pts: P2[]; closed: boolean }[] {
  return subs.map((s) => {
    const L = subLength(s);
    const n = Math.max(s.closed ? 3 : 2, Math.min(4000, Math.ceil(L / Math.max(0.05, tolerance))));
    return { pts: resample(s, n), closed: s.closed };
  });
}

function rdp(pts: P2[], eps: number): P2[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let max = -1;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/** Fewer segments, same look within `tolerance` px (the budget's "simplify vector" repair). */
export function simplifyPath(d: string, tolerance = 0.75): string {
  return flatten(parsePath(d), tolerance / 2)
    .map(({ pts, closed }) => {
      const s = rdp(pts, tolerance);
      return `M${f(s[0].x)} ${f(s[0].y)}` + s.slice(1).map((p) => `L${f(p.x)} ${f(p.y)}`).join('') + (closed ? 'Z' : '');
    })
    .join('');
}

/** Number of cubic segments: the vector cost unit of the effect budget. */
export const segmentCount = (d: string | SubPath[]) => (typeof d === 'string' ? parsePath(d) : d).reduce((a, s) => a + s.segs.length, 0);
