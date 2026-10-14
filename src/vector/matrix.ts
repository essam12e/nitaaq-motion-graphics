/**
 * 2D affine matrices (pure). SVG order: [a b c d e f] maps (x, y) to
 * (a·x + c·y + e, b·x + d·y + f). Parses every SVG transform function, composes
 * with a transform origin, decomposes for animation (translate / rotate / scale /
 * skew) and interpolates in decomposed space so rotations turn instead of shearing.
 */
import type { P2 } from '../morph/path';

export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m × n: apply n first, then m (SVG nesting order: parent × child). */
export function multiply(m: Mat, n: Mat): Mat {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

export const multiplyAll = (...ms: Mat[]): Mat => ms.reduce((acc, m) => multiply(acc, m), IDENTITY);

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const apply = (m: Mat, p: P2): P2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export const translate = (x: number, y = 0): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0];
export const rotate = (deg: number, cx = 0, cy = 0): Mat => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const m: Mat = [c, s, -s, c, 0, 0];
  return cx || cy ? multiplyAll(translate(cx, cy), m, translate(-cx, -cy)) : m;
};
export const skewX = (deg: number): Mat => [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0];
export const skewY = (deg: number): Mat => [1, Math.tan((deg * Math.PI) / 180), 0, 1, 0, 0];

/** A transform applied around an origin point (CSS transform-origin). */
export const aroundOrigin = (m: Mat, o: P2): Mat => multiplyAll(translate(o.x, o.y), m, translate(-o.x, -o.y));

/** Parses an SVG `transform` attribute (matrix, translate, scale, rotate, skewX, skewY; any order, commas or spaces). */
export function parseTransform(src: string | undefined): Mat {
  if (!src) return [...IDENTITY];
  let m: Mat = [...IDENTITY];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(src))) {
    const a = (x[2].match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let t: Mat = [...IDENTITY];
    switch (x[1]) {
      case 'matrix':
        if (a.length === 6) t = a as Mat;
        break;
      case 'translate':
        t = translate(a[0] ?? 0, a[1] ?? 0);
        break;
      case 'scale':
        t = scale(a[0] ?? 1, a[1] ?? a[0] ?? 1);
        break;
      case 'rotate':
        t = rotate(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
        break;
      case 'skewX':
        t = skewX(a[0] ?? 0);
        break;
      case 'skewY':
        t = skewY(a[0] ?? 0);
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

export const isIdentity = (m: Mat, eps = 1e-9) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < eps);

export function toSvg(m: Mat): string {
  const f = (v: number) => String(Math.round(v * 1e5) / 1e5);
  return `matrix(${m.map(f).join(' ')})`;
}

/** Translate · rotate · scale · skewX (the decomposition CSS uses). */
export interface Decomposed {
  tx: number;
  ty: number;
  rotation: number;
  sx: number;
  sy: number;
  skew: number;
}

export function decompose(m: Mat): Decomposed {
  const [a, b, c, d, e, f] = m;
  let sx = Math.hypot(a, b);
  let ra = a / (sx || 1);
  let rb = b / (sx || 1);
  let skew = ra * c + rb * d;
  let c2 = c - ra * skew;
  let d2 = d - rb * skew;
  let sy = Math.hypot(c2, d2);
  c2 /= sy || 1;
  d2 /= sy || 1;
  skew /= sy || 1;
  if (ra * d2 - rb * c2 < 0) {
    // reflection: carried by a negative x scale
    ra = -ra;
    rb = -rb;
    sx = -sx;
    skew = -skew;
  }
  void c2;
  return { tx: e, ty: f, rotation: (Math.atan2(rb, ra) * 180) / Math.PI, sx, sy, skew: (Math.atan(skew) * 180) / Math.PI };
}

export function recompose(d: Decomposed): Mat {
  return multiplyAll(translate(d.tx, d.ty), rotate(d.rotation), skewX(d.skew), scale(d.sx, d.sy));
}

/** Interpolates two matrices in decomposed space (shortest rotation). */
export function lerpMat(a: Mat, b: Mat, t: number): Mat {
  const A = decompose(a);
  const B = decompose(b);
  let dr = B.rotation - A.rotation;
  if (dr > 180) dr -= 360;
  if (dr < -180) dr += 360;
  const l = (x: number, y: number) => x + (y - x) * t;
  return recompose({ tx: l(A.tx, B.tx), ty: l(A.ty, B.ty), rotation: A.rotation + dr * t, sx: l(A.sx, B.sx), sy: l(A.sy, B.sy), skew: l(A.skew, B.skew) });
}
