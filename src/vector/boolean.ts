/**
 * Boolean shape operations: union / subtract / intersect / exclude.
 *
 * Two ways, chosen per use:
 *
 *   render   (stable, the default) the operation is done by the SVG renderer itself:
 *            intersect = clip-path, subtract = mask (A white, B black), union = both
 *            drawn as one group, exclude = evenodd of both. Exact at every pixel, any
 *            curves, any number of rings, nothing to go wrong — but the result is not a
 *            new outline (it cannot be traced or morphed).
 *   exact    (EXPERIMENTAL) Greiner–Hormann polygon clipping on the flattened outlines
 *            (curves sampled to `tolerance`): returns a real outline. Limited to one ring
 *            per input; degenerate touches are resolved by a deterministic nudge; when it
 *            cannot give a trustworthy answer it returns null with the reason, and the
 *            caller falls back to `render`.
 *
 * Pure and deterministic (no random, no clock).
 */
import type { P2 } from '../morph/path';
import { parsePath } from '../morph/path';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

// ── render-level

/**
 * SVG for A ⊕ B drawn by the renderer. `id` must be unique in the document. Paint goes on the
 * returned group (`fill` attribute), so the result is styled like one shape.
 */
export function renderBoolean(op: BooleanOp, aD: string, bD: string, id: string, attrs = ''): { defs: string; body: string } {
  switch (op) {
    case 'intersect':
      return { defs: `<clipPath id="${id}"><path d="${bD}"/></clipPath>`, body: `<path d="${aD}" clip-path="url(#${id})" ${attrs}/>` };
    case 'subtract':
      return {
        defs: `<mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000"><path d="${aD}" fill="#fff"/><path d="${bD}" fill="#000"/></mask>`,
        body: `<path d="${aD}" mask="url(#${id})" ${attrs}/>`,
      };
    case 'exclude':
      return { defs: '', body: `<path d="${aD} ${bD}" fill-rule="evenodd" ${attrs}/>` };
    default:
      return { defs: '', body: `<g ${attrs}><path d="${aD}"/><path d="${bD}"/></g>` };
  }
}

// ── exact (Greiner–Hormann)

interface V {
  x: number;
  y: number;
  next: V;
  prev: V;
  inter: boolean;
  entry: boolean;
  neighbour: V | null;
  alpha: number;
  visited: boolean;
}

const mk = (x: number, y: number, inter = false, alpha = 0): V => {
  const v = { x, y, inter, alpha, entry: false, neighbour: null, visited: false } as unknown as V;
  v.next = v;
  v.prev = v;
  return v;
};

function ring(pts: P2[]): V {
  const first = mk(pts[0].x, pts[0].y);
  let last = first;
  for (let i = 1; i < pts.length; i++) {
    const v = mk(pts[i].x, pts[i].y);
    v.prev = last;
    last.next = v;
    last = v;
  }
  last.next = first;
  first.prev = last;
  return first;
}

/** Point in polygon (even-odd). */
export function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return s / 2;
}

const straight = (c: [P2, P2, P2, P2]) => {
  const dx = c[3].x - c[0].x;
  const dy = c[3].y - c[0].y;
  const L = Math.hypot(dx, dy) || 1;
  const off = (p: P2) => Math.abs((p.x - c[0].x) * dy - (p.y - c[0].y) * dx) / L;
  return off(c[1]) < 1e-6 && off(c[2]) < 1e-6;
};

/** Outline of a path as one polygon per closed ring: corners kept exactly, curves sampled to `tolerance`. */
export function pathToRings(d: string, tolerance = 0.25): P2[][] {
  return parsePath(d)
    .map((sp) => {
      const pts: P2[] = sp.segs.length ? [sp.segs[0][0]] : [];
      for (const c of sp.segs) {
        if (straight(c)) {
          pts.push(c[3]);
          continue;
        }
        const len = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) + Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y) + Math.hypot(c[3].x - c[2].x, c[3].y - c[2].y);
        const n = Math.max(2, Math.min(96, Math.ceil(Math.sqrt(len / Math.max(0.01, tolerance)) * 2)));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          pts.push({ x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y });
        }
      }
      // drop repeated points (closing point, zero-length segments)
      return pts.filter((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
      });
    })
    .filter((pts) => pts.length >= 3 && Math.abs(polygonArea(pts)) > 1e-6);
}

export function ringsToPath(rings: P2[][]): string {
  const f = (v: number) => String(Math.round(v * 1000) / 1000);
  return rings.map((r) => `M${f(r[0].x)} ${f(r[0].y)}` + r.slice(1).map((p) => `L${f(p.x)} ${f(p.y)}`).join('') + 'Z').join(' ');
}

const EPS = 1e-9;

/** Segment intersection with the parameters on both; null when parallel or outside. Degenerate (touching) → 'touch'. */
function segX(a: P2, b: P2, c: P2, d: P2): { x: number; y: number; ta: number; tb: number } | null | 'touch' {
  const den = (d.y - c.y) * (b.x - a.x) - (d.x - c.x) * (b.y - a.y);
  if (Math.abs(den) < EPS) return null;
  const ta = ((d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)) / den;
  const tb = ((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / den;
  const lo = 1e-7;
  if (ta < -lo || ta > 1 + lo || tb < -lo || tb > 1 + lo) return null;
  if (ta < lo || ta > 1 - lo || tb < lo || tb > 1 - lo) return 'touch';
  return { x: a.x + ta * (b.x - a.x), y: a.y + ta * (b.y - a.y), ta, tb };
}

function insertSorted(v: V, start: V, end: V) {
  let cur = start;
  while (cur.next !== end && cur.next.inter && cur.next.alpha < v.alpha) cur = cur.next;
  v.next = cur.next;
  v.prev = cur;
  cur.next.prev = v;
  cur.next = v;
}

const nextOriginal = (v: V): V => {
  let c = v;
  while (c.inter) c = c.next;
  return c;
};

/** Greiner–Hormann on two simple polygons. Returns rings, or 'degenerate' when an edge only touches. */
function clipRings(subject: P2[], clip: P2[], op: 'union' | 'subtract' | 'intersect'): P2[][] | 'degenerate' {
  const s = ring(subject);
  const c = ring(clip);
  const sVerts: V[] = [];
  for (let v = s, i = 0; i < subject.length; i++, v = v.next) sVerts.push(v);
  const cVerts: V[] = [];
  for (let v = c, i = 0; i < clip.length; i++, v = v.next) cVerts.push(v);
  let found = 0;
  for (const sv of sVerts) {
    const sn = nextOriginal(sv.next);
    for (const cv of cVerts) {
      const cn = nextOriginal(cv.next);
      const x = segX(sv, sn, cv, cn);
      if (x === 'touch') return 'degenerate';
      if (!x) continue;
      const i1 = mk(x.x, x.y, true, x.ta);
      const i2 = mk(x.x, x.y, true, x.tb);
      i1.neighbour = i2;
      i2.neighbour = i1;
      insertSorted(i1, sv, sn);
      insertSorted(i2, cv, cn);
      found++;
    }
  }
  if (found % 2 === 1) return 'degenerate';
  if (!found) return [];
  // entry / exit marks (w8r/greiner-hormann semantics: intersect = forward, forward; union = back, back; subtract = back, forward)
  const [sf, cf] = op === 'intersect' ? [true, true] : op === 'union' ? [false, false] : [false, true];
  const mark = (start: V, other: P2[], forwards: boolean) => {
    let f = forwards !== pointInPolygon(start, other);
    let v = start;
    do {
      if (v.inter) {
        v.entry = f;
        f = !f;
      }
      v = v.next;
    } while (v !== start);
  };
  mark(s, clip, sf);
  mark(c, subject, cf);
  const out: P2[][] = [];
  const unvisited = () => {
    let v = s;
    do {
      if (v.inter && !v.visited) return v;
      v = v.next;
    } while (v !== s);
    return null;
  };
  let guard = 0;
  for (let start = unvisited(); start; start = unvisited()) {
    const poly: P2[] = [{ x: start.x, y: start.y }];
    let cur: V = start;
    for (;;) {
      cur.visited = true;
      cur.neighbour!.visited = true;
      const fwd = cur.entry;
      do {
        cur = fwd ? cur.next : cur.prev;
        poly.push({ x: cur.x, y: cur.y });
        if (++guard > 1e6) return 'degenerate';
      } while (!cur.inter);
      cur = cur.neighbour!;
      if (cur.visited) break;
    }
    // the walk ends where it began: drop the repeated point
    if (poly.length > 1 && Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) < 1e-9) poly.pop();
    out.push(poly);
  }
  return out;
}

export interface ExactResult {
  d: string;
  rings: P2[][];
}

/**
 * EXPERIMENTAL exact boolean of two outlines. Returns null with a reason when it cannot be trusted
 * (several rings in an input, or touching edges that a nudge does not separate).
 */
export function exactBoolean(op: BooleanOp, aD: string, bD: string, tolerance = 0.25): ExactResult | { error: string } {
  const A = pathToRings(aD, tolerance);
  const B = pathToRings(bD, tolerance);
  // an empty side (a shape animated down to nothing) is a valid input, not an error
  if (!A.length && !B.length) return { d: '', rings: [] };
  if (!B.length) {
    const keep = op === 'intersect' ? [] : A;
    return { d: ringsToPath(keep), rings: keep };
  }
  if (!A.length) {
    const keep = op === 'union' || op === 'exclude' ? B : [];
    return { d: ringsToPath(keep), rings: keep };
  }
  if (A.length > 1 || B.length > 1) return { error: 'exact booleans take one ring per shape (use the render mode)' };
  const a = A[0];
  if (op === 'exclude') {
    const u = exactBoolean('union', aD, bD, tolerance);
    const i = exactBoolean('intersect', aD, bD, tolerance);
    if ('error' in u) return u;
    if ('error' in i) return i;
    return { d: `${u.d} ${i.d}`.trim(), rings: [...u.rings, ...i.rings] };
  }
  // deterministic nudges for touching edges: shift B by a growing, fixed offset
  const nudges = [0, 1e-4, -2.3e-4, 3.7e-4];
  for (const n of nudges) {
    const b = B[0].map((p) => ({ x: p.x + n, y: p.y + n * 0.618 }));
    const r = clipRings(a, b, op);
    if (r === 'degenerate') continue;
    let rings = r;
    if (!rings.length) {
      // no crossing: containment decides
      const aInB = pointInPolygon(a[0], b);
      const bInA = pointInPolygon(b[0], a);
      if (op === 'intersect') rings = aInB ? [a] : bInA ? [b] : [];
      else if (op === 'union') rings = aInB ? [b] : bInA ? [a] : [a, b];
      else rings = aInB ? [] : bInA ? [a, [...b].reverse()] : [a];
    }
    // holes come out with the opposite winding; evenodd keeps them holes either way
    rings = rings.filter((x) => x.length >= 3 && Math.abs(polygonArea(x)) > 1e-6);
    return { d: ringsToPath(rings), rings };
  }
  return { error: 'edges only touch (degenerate): use the render mode' };
}
