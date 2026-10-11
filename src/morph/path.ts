/**
 * Advanced Morphing Engine — geometry core.
 *
 * True path morphing (not a crossfade): the same body continuously becomes
 * another. Following the approach Manim uses for Transform (align the point
 * structure of both shapes, then interpolate) and the normalisation every
 * serious SVG morpher needs:
 *
 *   1. parse any SVG path (M L H V C S Q T A Z, absolute or relative)
 *   2. convert every command to cubic Béziers (lines/arcs/quads become cubics)
 *   3. resample each closed sub-path by ARC LENGTH to the same point count
 *   4. align winding direction and the start point (rotation that minimises
 *      total travel) so nothing turns inside out or spins
 *   5. match sub-paths between shapes (by area/centroid); extra sub-paths grow
 *      from / shrink into their nearest partner's centroid
 *   6. interpolate points (optionally along arcs) → a path string at any t
 *
 * Pure TypeScript, no dependencies, deterministic.
 */

export interface P2 {
  x: number;
  y: number;
}
export type Cubic = [P2, P2, P2, P2];
export interface SubPath {
  segs: Cubic[];
  closed: boolean;
}

// ── parsing ───────────────────────────────────────────────────────────────────────

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

const lineCubic = (a: P2, b: P2): Cubic => [a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 }, b];
const quadCubic = (a: P2, q: P2, b: P2): Cubic => [a, { x: a.x + (2 / 3) * (q.x - a.x), y: a.y + (2 / 3) * (q.y - a.y) }, { x: b.x + (2 / 3) * (q.x - b.x), y: b.y + (2 / 3) * (q.y - b.y) }, b];

/** SVG elliptical arc → cubic segments (endpoint parameterisation, W3C F.6). */
function arcCubics(p0: P2, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: P2): Cubic[] {
  if (rx === 0 || ry === 0) return [lineCubic(p0, p1)];
  const phi = (phiDeg * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cp * dx + sp * dy;
  const y1 = -sp * dx + cp * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cxp = (co * rx * y1) / ry;
  const cyp = (-co * ry * x1) / rx;
  const cx = cp * cxp - sp * cyp + (p0.x + p1.x) / 2;
  const cy = sp * cxp + cp * cyp + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const step = dth / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Cubic[] = [];
  const pt = (t: number) => ({ x: cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, y: cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp });
  const dpt = (t: number) => ({ x: -rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, y: -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp });
  for (let i = 0; i < n; i++) {
    const a = th1 + i * step;
    const b = a + step;
    const pa = i === 0 ? p0 : pt(a);
    const pb = i === n - 1 ? p1 : pt(b);
    const da = dpt(a);
    const db = dpt(b);
    out.push([pa, { x: pa.x + k * da.x, y: pa.y + k * da.y }, { x: pb.x - k * db.x, y: pb.y - k * db.y }, pb]);
  }
  return out;
}

/** Parse an SVG path into sub-paths of absolute cubic segments. */
export function parsePath(d: string): SubPath[] {
  const tk = tokenize(d);
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let p: P2 = { x: 0, y: 0 };
  let start: P2 = { x: 0, y: 0 };
  let lastCtrl: P2 | null = null;
  let lastQ: P2 | null = null;
  let cmd = '';
  let i = 0;
  const num = () => tk[i++] as number;
  while (i < tk.length) {
    if (typeof tk[i] === 'string') cmd = tk[i++] as string;
    else if (!cmd) {
      i++;
      continue;
    }
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (up === 'Z') {
      if (cur) {
        if (Math.hypot(p.x - start.x, p.y - start.y) > 1e-9) cur.segs.push(lineCubic(p, start));
        cur.closed = true;
      }
      p = { ...start };
      lastCtrl = lastQ = null;
      cur = null;
      cmd = '';
      continue;
    }
    if (i + ARITY[up] > tk.length || tk.slice(i, i + ARITY[up]).some((x) => typeof x !== 'number')) break;
    const ox = rel ? p.x : 0;
    const oy = rel ? p.y : 0;
    if (up === 'M') {
      const q = { x: ox + num(), y: oy + num() };
      cur = { segs: [], closed: false };
      subs.push(cur);
      p = start = q;
      lastCtrl = lastQ = null;
      cmd = rel ? 'l' : 'L'; // implicit lineto after moveto
      continue;
    }
    if (!cur) {
      cur = { segs: [], closed: false };
      subs.push(cur);
      start = p;
    }
    let seg: Cubic[] = [];
    if (up === 'L') {
      const q = { x: ox + num(), y: oy + num() };
      seg = [lineCubic(p, q)];
      lastCtrl = lastQ = null;
    } else if (up === 'H') {
      const q = { x: (rel ? p.x : 0) + num(), y: p.y };
      seg = [lineCubic(p, q)];
      lastCtrl = lastQ = null;
    } else if (up === 'V') {
      const q = { x: p.x, y: (rel ? p.y : 0) + num() };
      seg = [lineCubic(p, q)];
      lastCtrl = lastQ = null;
    } else if (up === 'C') {
      const c1 = { x: ox + num(), y: oy + num() };
      const c2 = { x: ox + num(), y: oy + num() };
      const q = { x: ox + num(), y: oy + num() };
      seg = [[p, c1, c2, q]];
      lastCtrl = c2;
      lastQ = null;
    } else if (up === 'S') {
      const c1: P2 = lastCtrl ? { x: 2 * p.x - lastCtrl.x, y: 2 * p.y - lastCtrl.y } : p;
      const c2 = { x: ox + num(), y: oy + num() };
      const q = { x: ox + num(), y: oy + num() };
      seg = [[p, c1, c2, q]];
      lastCtrl = c2;
      lastQ = null;
    } else if (up === 'Q') {
      const c = { x: ox + num(), y: oy + num() };
      const q = { x: ox + num(), y: oy + num() };
      seg = [quadCubic(p, c, q)];
      lastQ = c;
      lastCtrl = null;
    } else if (up === 'T') {
      const c: P2 = lastQ ? { x: 2 * p.x - lastQ.x, y: 2 * p.y - lastQ.y } : p;
      const q = { x: ox + num(), y: oy + num() };
      seg = [quadCubic(p, c, q)];
      lastQ = c;
      lastCtrl = null;
    } else if (up === 'A') {
      const rx = num();
      const ry = num();
      const rot = num();
      const la = num();
      const sw = num();
      const q = { x: ox + num(), y: oy + num() };
      seg = arcCubics(p, rx, ry, rot, la, sw, q);
      lastCtrl = lastQ = null;
    }
    cur.segs.push(...seg);
    p = seg[seg.length - 1][3];
  }
  return subs.filter((s) => s.segs.length);
}

// ── sampling ──────────────────────────────────────────────────────────────────────

const bez = (c: Cubic, t: number): P2 => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const cc = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * c[0].x + b * c[1].x + cc * c[2].x + d * c[3].x, y: a * c[0].y + b * c[1].y + cc * c[2].y + d * c[3].y };
};

/** Resample a sub-path to exactly n points equally spaced by arc length. */
export function resample(sp: SubPath, n: number): P2[] {
  const dense: P2[] = [];
  for (const s of sp.segs) for (let k = 0; k < 24; k++) dense.push(bez(s, k / 24));
  dense.push(sp.segs[sp.segs.length - 1][3]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
  const total = cum[cum.length - 1] || 1;
  const out: P2[] = [];
  let j = 1;
  const count = sp.closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const target = (i / count) * total;
    while (j < cum.length - 1 && cum[j] < target) j++;
    const a = dense[j - 1];
    const b = dense[j];
    const span = cum[j] - cum[j - 1] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[j - 1]) / span));
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

export function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(pts: P2[]): P2 {
  const n = pts.length || 1;
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
}

export function bounds(pts: P2[]): { x: number; y: number; width: number; height: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Rotate `b` (same length as `a`) to the start index that minimises squared travel; fix winding. */
export function alignRing(a: P2[], b: P2[]): P2[] {
  let ring = b;
  if (Math.sign(signedArea(a)) !== Math.sign(signedArea(b)) && Math.abs(signedArea(b)) > 1e-6) ring = [...b].reverse();
  const n = ring.length;
  let best = 0;
  let bestCost = Infinity;
  const stride = Math.max(1, Math.floor(n / 64));
  const cost = (off: number) => {
    let c = 0;
    for (let i = 0; i < n; i += stride) {
      const q = ring[(i + off) % n];
      c += (a[i].x - q.x) ** 2 + (a[i].y - q.y) ** 2;
    }
    return c;
  };
  for (let off = 0; off < n; off++) {
    const c = cost(off);
    if (c < bestCost) {
      bestCost = c;
      best = off;
    }
  }
  return ring.map((_, i) => ring[(i + best) % n]);
}

// ── shape pairs ───────────────────────────────────────────────────────────────────

export interface MorphPlan {
  /** Matched rings: [from, to] point arrays of equal length. */
  rings: [P2[], P2[]][];
  closed: boolean[];
}

/** Prepare a morph between two SVG paths (do once, interpolate many times). */
export function prepareMorph(fromD: string, toD: string, points = 96): MorphPlan {
  const A = parsePath(fromD).map((s) => ({ s, pts: resample(s, points) }));
  const B = parsePath(toD).map((s) => ({ s, pts: resample(s, points) }));
  if (!A.length || !B.length) throw new Error('morph: empty path');
  const area = (x: { pts: P2[] }) => Math.abs(signedArea(x.pts));
  // biggest first so the main bodies pair with each other
  A.sort((x, y) => area(y) - area(x));
  B.sort((x, y) => area(y) - area(x));
  const rings: [P2[], P2[]][] = [];
  const closed: boolean[] = [];
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const a = A[i];
    const b = B[i];
    if (a && b) {
      rings.push([a.pts, a.s.closed && b.s.closed ? alignRing(a.pts, b.pts) : b.pts]);
      closed.push(a.s.closed || b.s.closed);
    } else if (a) {
      // shrink into the centroid of the nearest destination body
      const near = nearestCentroid(centroid(a.pts), B.map((x) => centroid(x.pts)));
      rings.push([a.pts, a.pts.map(() => near)]);
      closed.push(a.s.closed);
    } else if (b) {
      const near = nearestCentroid(centroid(b.pts), A.map((x) => centroid(x.pts)));
      rings.push([b.pts.map(() => near), b.pts]);
      closed.push(b.s.closed);
    }
  }
  return { rings, closed };
}

function nearestCentroid(p: P2, cs: P2[]): P2 {
  return cs.reduce((best, c) => (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? c : best), cs[0] ?? p);
}

/**
 * Interpolated path at t (0..1). `arc` bends each point's travel around the
 * shapes' common centre (Manim's path_arc) — 0 = straight lines.
 */
export function morphAt(plan: MorphPlan, t: number, arc = 0): string {
  const k = Math.min(1, Math.max(0, t));
  const parts: string[] = [];
  plan.rings.forEach(([a, b], ri) => {
    let pts: P2[];
    if (arc) {
      const ca = centroid(a);
      const cb = centroid(b);
      const c = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
      const ang = arc * k;
      pts = a.map((p, i) => {
        const q = b[i];
        const x = p.x + (q.x - p.x) * k;
        const y = p.y + (q.y - p.y) * k;
        // rotate the in-between point around the centre by an angle that vanishes at both ends
        const w = Math.sin(Math.PI * k) * ang;
        const dx = x - c.x;
        const dy = y - c.y;
        return { x: c.x + dx * Math.cos(w) - dy * Math.sin(w), y: c.y + dx * Math.sin(w) + dy * Math.cos(w) };
      });
    } else pts = a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k }));
    parts.push(pointsToPath(pts, plan.closed[ri]));
  });
  return parts.join(' ');
}

export function pointsToPath(pts: P2[], closed = true): string {
  if (!pts.length) return '';
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  return `M${f(pts[0].x)} ${f(pts[0].y)}` + pts.slice(1).map((p) => `L${f(p.x)} ${f(p.y)}`).join('') + (closed ? 'Z' : '');
}

/** Max distance any point travels (for motion events / sound anchors). */
export function morphTravel(plan: MorphPlan): number {
  let m = 0;
  for (const [a, b] of plan.rings) for (let i = 0; i < a.length; i++) m = Math.max(m, Math.hypot(b[i].x - a[i].x, b[i].y - a[i].y));
  return m;
}

/** Mid-morph silhouette sanity: the in-between must not collapse (area ≥ ratio × smaller end). */
export function midSilhouetteOk(plan: MorphPlan, ratio = 0.35): boolean {
  const areaOf = (t: number) => plan.rings.reduce((s, [a, b]) => s + Math.abs(signedArea(a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t })))), 0);
  const a0 = areaOf(0);
  const a1 = areaOf(1);
  return areaOf(0.5) >= Math.min(a0, a1) * ratio;
}
