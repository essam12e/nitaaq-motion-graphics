/**
 * Vector animation programs (pure: a function of the doc, the program and time).
 *
 *   draw   the art is drawn the way a hand would: each shape's outline is traced by
 *          arc length (pen speed ∝ length, in reading order), then its fill floods in
 *          and the guide line fades. Shapes without a stroke are traced in their fill colour.
 *   build  groups assemble: scale + rise from their own bounds' centre (transform origin),
 *          staggered in reading order, with a spring settle
 *   morph  every shape of A becomes its partner in B (matched by position, size and
 *          colour); extra shapes shrink into / grow out of their nearest partner; fills,
 *          strokes and gradients interpolate in OKLab
 *   static the art as authored
 *
 * The same numbers drive the component, `seek` and QC.
 */
import { prepareMorph, morphAt, centroid, resample, signedArea, parsePath, type MorphPlan } from '../morph/path';
import { springAt } from '../motion/spring';
import { curve } from '../motion/easing';
import { aroundOrigin, multiply, scale as scaleM, translate, IDENTITY, type Mat } from './matrix';
import { subsToPath, trimSubs, transformSubs, type Box } from './geometry';
import { flattenDoc, transformBox, type Paint, type VectorDoc, type VNode, type VRaw, type VShape } from './svg';
import { lerpColor, lerpGradient, solidStops, parseColor, type Gradient } from './paint';

export type VectorOrder = 'document' | 'rtl' | 'ltr' | 'ttb' | 'center-out';

export interface VectorProgram {
  mode: 'draw' | 'build' | 'morph' | 'static';
  /** Seconds after the scene starts. */
  start?: number;
  /** Seconds the whole program takes (draw: until the last fill is in). */
  duration?: number;
  order?: VectorOrder;
  /** draw: share of each shape's window spent tracing before the fill (0..1). */
  traceShare?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// parsed outlines, reused frame after frame (bounded: a film shows a handful of documents)
const subsCache = new Map<string, ReturnType<typeof parsePath>>();
export function subsOf(d: string) {
  let s = subsCache.get(d);
  if (!s) {
    if (subsCache.size > 4000) subsCache.clear();
    s = parsePath(d);
    subsCache.set(d, s);
  }
  return s;
}

/** Reading-order key of a box (Arabic films read right-to-left). */
function orderKey(order: VectorOrder, b: Box, docBox: Box): number {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const row = Math.round(cy / Math.max(1, docBox.height / 6));
  switch (order) {
    case 'rtl':
      return row * 1e6 - cx;
    case 'ltr':
      return row * 1e6 + cx;
    case 'ttb':
      return cy * 1e3 + cx;
    case 'center-out':
      return Math.hypot(cx - (docBox.x + docBox.width / 2), cy - (docBox.y + docBox.height / 2));
    default:
      return 0;
  }
}

export interface DrawWindow {
  id: string;
  /** Seconds from the program start. */
  traceStart: number;
  traceEnd: number;
  fillStart: number;
  fillEnd: number;
}

/** When each shape is traced and filled. Pen speed ∝ length, clamped so tiny details still show. */
export function drawSchedule(doc: VectorDoc, p: VectorProgram = { mode: 'draw' }): DrawWindow[] {
  const flat = flattenDoc(doc);
  if (!flat.length) return [];
  const total = Math.max(0.2, p.duration ?? 2.4);
  const share = clamp01(p.traceShare ?? 0.7);
  const docBox = { x: doc.viewBox.x, y: doc.viewBox.y, width: doc.viewBox.width, height: doc.viewBox.height };
  const items = flat.map((f, i) => {
    const wb = transformBox(f.shape.bounds, f.world);
    const scaleK = Math.sqrt(Math.abs(f.world[0] * f.world[3] - f.world[1] * f.world[2])) || 1;
    return { id: f.shape.id, i, len: f.shape.length * scaleK, key: orderKey(p.order ?? 'document', wb, docBox) };
  });
  if ((p.order ?? 'document') !== 'document') items.sort((a, b) => a.key - b.key || a.i - b.i);
  const totalLen = items.reduce((a, x) => a + x.len, 0) || 1;
  // the pen moves at a speed ∝ length; every shape gets at least `minW` so small details read
  const traceTime = total * share;
  const fillTime = Math.max(0.3, total - traceTime);
  const minW = Math.min(traceTime, Math.max(0.25, traceTime / 4));
  let cum = 0;
  const out = items.map((x) => {
    const traceStart = (cum / totalLen) * (traceTime - minW);
    cum += x.len;
    const traceEnd = Math.min(traceTime, traceStart + Math.max(minW, (x.len / totalLen) * traceTime));
    const fillStart = traceStart + (traceEnd - traceStart) * 0.75;
    return { id: x.id, traceStart, traceEnd, fillStart, fillEnd: fillStart + fillTime };
  });
  // keep everything inside the program
  const last = Math.max(...out.map((o) => o.fillEnd));
  const fit = last > total ? total / last : 1;
  return out.map((o) => ({ id: o.id, traceStart: o.traceStart * fit, traceEnd: o.traceEnd * fit, fillStart: o.fillStart * fit, fillEnd: o.fillEnd * fit }));
}

export interface ShapeState {
  /** The traced part of the outline (null: not started or no guide line). */
  trace: string | null;
  /** Guide line colour and width (in the shape's own units). */
  traceColor: string;
  traceWidth: number;
  traceOpacity: number;
  /** 0..1 multiplier of the authored fill / stroke. */
  fill: number;
  stroke: number;
}

const solidOf = (paint: Paint): string | null => {
  if (paint.stroke !== 'none' && !paint.stroke.startsWith('url(')) return paint.stroke;
  if (paint.fill !== 'none' && !paint.fill.startsWith('url(')) return paint.fill;
  return null;
};

/** State of every shape at program time `t` (seconds from program start). */
export function drawStateAt(doc: VectorDoc, sched: DrawWindow[], t: number, ink = '#1F2937'): Map<string, ShapeState> {
  const byId = new Map(flattenDoc(doc).map((f) => [f.shape.id, f]));
  const out = new Map<string, ShapeState>();
  const ease = curve('ease-in-out-cubic');
  const diag = Math.hypot(doc.viewBox.width, doc.viewBox.height);
  for (const w of sched) {
    const f = byId.get(w.id);
    if (!f) continue;
    const sh = f.shape;
    const tk = clamp01((t - w.traceStart) / Math.max(1e-6, w.traceEnd - w.traceStart));
    const fk = ease(clamp01((t - w.fillStart) / Math.max(1e-6, w.fillEnd - w.fillStart)));
    const hasStroke = sh.paint.stroke !== 'none' && sh.paint.strokeWidth > 0;
    const scaleK = Math.sqrt(Math.abs(f.world[0] * f.world[3] - f.world[1] * f.world[2])) || 1;
    const traceWidth = hasStroke ? sh.paint.strokeWidth : Math.max(1, (diag * 0.0035) / scaleK);
    const tracing = tk > 0 && tk < 1;
    out.set(sh.id, {
      trace: tk <= 0 ? null : tk >= 1 && (hasStroke || fk >= 1) ? null : subsToPath(trimSubs(subsOf(sh.d), { end: ease(tk) })),
      traceColor: hasStroke ? 'stroke' : solidOf(sh.paint) ?? ink,
      traceWidth,
      // a guide line on a fill-only shape fades as the fill arrives
      traceOpacity: hasStroke ? 1 : tracing ? 1 : 1 - fk,
      fill: fk,
      // an authored stroke stays once traced
      stroke: tk >= 1 ? 1 : 0,
    });
  }
  return out;
}

// ── build

export interface BuildWindow {
  id: string;
  start: number;
  /** Transform origin: centre of the group's own bounds (its coordinates). */
  origin: { x: number; y: number };
}

/** The units that assemble: top-level groups (or the shapes, when the art is flat). */
function buildUnits(doc: VectorDoc): VNode[] {
  let units = doc.root.children;
  // descend through single wrapper groups (exports often wrap everything in one <g>)
  while (units.length === 1 && units[0].type === 'group' && units[0].children.length > 1) units = units[0].children;
  return units;
}

export function buildSchedule(doc: VectorDoc, p: VectorProgram = { mode: 'build' }): BuildWindow[] {
  const units = buildUnits(doc);
  const total = Math.max(0.3, p.duration ?? 1.8);
  const docBox = { x: doc.viewBox.x, y: doc.viewBox.y, width: doc.viewBox.width, height: doc.viewBox.height };
  const items = units.map((u, i) => ({ u, i, key: orderKey(p.order ?? 'document', transformBox(u.bounds, u.transform), docBox) }));
  if ((p.order ?? 'document') !== 'document') items.sort((a, b) => a.key - b.key || a.i - b.i);
  const settle = Math.min(0.9, total * 0.5);
  const step = items.length > 1 ? (total - settle) / (items.length - 1) : 0;
  return items.map((x, j) => ({ id: x.u.id, start: j * step, origin: { x: x.u.bounds.x + x.u.bounds.width / 2, y: x.u.bounds.y + x.u.bounds.height / 2 } }));
}

/** Extra transform (applied inside the unit's own transform) and opacity at program time t. */
export function buildStateAt(sched: BuildWindow[], t: number): Map<string, { m: Mat; opacity: number }> {
  const out = new Map<string, { m: Mat; opacity: number }>();
  for (const w of sched) {
    const local = t - w.start;
    if (local <= 0) {
      out.set(w.id, { m: aroundOrigin(scaleM(0.6), w.origin), opacity: 0 });
      continue;
    }
    const s = springAt(local, 0, 1, { stiffness: 170, damping: 16 }).value;
    const k = 0.6 + 0.4 * s;
    out.set(w.id, { m: multiply(translate(0, (1 - s) * 18), aroundOrigin(scaleM(k), w.origin)), opacity: clamp01(local / 0.25) });
  }
  return out;
}

// ── morph between two documents

/**
 * A clip / mask / filter a shape is drawn inside: the element that references it and that element's
 * world matrix (its defs live in that element's user space). Morphed paths are in world space, so each
 * context is re-entered as  <g transform=W clip-path=…><g transform=W⁻¹> path </g></g>.
 */
export interface DrawContext {
  world: Mat;
  clipPath?: string;
  mask?: string;
  filter?: string;
  /** Which document's defs it points to. */
  doc: 'a' | 'b';
}

export interface FlatItem {
  node: VShape | VRaw;
  world: Mat;
  /** Product of the opacities of the node and its groups. */
  opacity: number;
  ctx: DrawContext[];
}

/** Every shape and raw node with its world matrix, accumulated opacity and clip / mask contexts. */
export function flattenWithContext(doc: VectorDoc, base: Mat = [...IDENTITY], tag: 'a' | 'b' = 'a'): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (n: VNode, m: Mat, op: number, ctx: DrawContext[]) => {
    const w = multiply(m, n.transform);
    const o = op * n.opacity;
    const c = n.clipPath || n.mask || n.filter ? [...ctx, { world: w, doc: tag, ...(n.clipPath ? { clipPath: n.clipPath } : {}), ...(n.mask ? { mask: n.mask } : {}), ...(n.filter ? { filter: n.filter } : {}) }] : ctx;
    if (n.type === 'group') for (const ch of n.children) walk(ch, w, o, c);
    else out.push({ node: n, world: w, opacity: o, ctx: c });
  };
  walk(doc.root, base, 1, []);
  return out;
}

export interface MorphPair {
  plan: MorphPlan;
  from: Paint;
  to: Paint;
  fromOpacity: number;
  toOpacity: number;
  fromCtx: DrawContext[];
  toCtx: DrawContext[];
  /** 'pair' | 'shrink' (A shape with no partner) | 'grow' (B shape with no partner). */
  kind: 'pair' | 'shrink' | 'grow';
  fromId: string;
  toId: string;
}

export interface DocMorph {
  pairs: MorphPair[];
  /** B's art mapped into A's viewBox (contain, centred). */
  fit: Mat;
  gradients: Record<string, Gradient>;
  /** Text / images: A's fade out, B's fade in (they cannot be morphed). */
  rawsA: FlatItem[];
  rawsB: FlatItem[];
}

const paintKey = (p: Paint) => {
  const c = parseColor(p.fill) ?? parseColor(p.stroke);
  return c ? c.hex : '#808080';
};

/** Pairs the shapes of two documents and prepares every morph (do once, evaluate per frame). */
export function prepareDocMorph(a: VectorDoc, b: VectorDoc, points = 72): DocMorph {
  const vbA = a.viewBox;
  const vbB = b.viewBox;
  const k = Math.min(vbA.width / (vbB.width || 1), vbA.height / (vbB.height || 1));
  const fit = multiply(translate(vbA.x + (vbA.width - vbB.width * k) / 2, vbA.y + (vbA.height - vbB.height * k) / 2), multiply(scaleM(k), translate(-vbB.x, -vbB.y)));
  const flatA = flattenWithContext(a, [...IDENTITY], 'a');
  const flatB = flattenWithContext(b, fit, 'b');
  const prep = (items: FlatItem[]) =>
    items
      .filter((f): f is FlatItem & { node: VShape } => f.node.type === 'shape')
      .map((f) => {
        const subs = transformSubs(subsOf(f.node.d), f.world);
        const pts = subs.length ? resample(subs[0], 48) : [];
        // stroke widths live in the shape's own units: carried into world units with the path
        const sw = Math.sqrt(Math.abs(f.world[0] * f.world[3] - f.world[1] * f.world[2])) || 1;
        const shape = { ...f.node, paint: { ...f.node.paint, strokeWidth: f.node.paint.strokeWidth * sw } };
        return { f, shape, d: subsToPath(subs), c: centroid(pts), area: Math.abs(signedArea(pts)) + 1, color: paintKey(f.node.paint) };
      });
  const A = prep(flatA);
  const B = prep(flatB);
  const diag = Math.hypot(vbA.width, vbA.height) || 1;
  const colorDist = (x: string, y: string) => {
    const h = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
    const [r1, g1, b1] = h(x);
    const [r2, g2, b2] = h(y);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2) / Math.sqrt(3);
  };
  const costs: { i: number; j: number; c: number }[] = [];
  A.forEach((x, i) => B.forEach((y, j) => costs.push({ i, j, c: Math.hypot(x.c.x - y.c.x, x.c.y - y.c.y) / diag + Math.abs(Math.log(x.area / y.area)) * 0.25 + colorDist(x.color, y.color) * 0.3 })));
  costs.sort((p, q) => p.c - q.c || p.i - q.i || p.j - q.j);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const match: [number, number][] = [];
  for (const c of costs) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i);
    usedB.add(c.j);
    match.push([c.i, c.j]);
  }
  // drawing order follows A (then B's newcomers on top), so the stacking stays the artist's
  match.sort((p, q) => p[0] - q[0]);
  const pairs: MorphPair[] = [];
  const point = (p: { x: number; y: number }) => `M${p.x} ${p.y}L${p.x + 0.01} ${p.y}Z`;
  // a user-space gradient is drawn in its shape's user space; the morph draws in world space, so each
  // shape gets its own copy of the gradient carried by the shape's world matrix (B's include the fit)
  const gradients: Record<string, Gradient> = {};
  const worldPaint = (p: Paint, world: Mat, grads: Record<string, Gradient>, tag: string, shapeId: string): Paint => {
    const re = (v: string) =>
      v.replace(/url\(#([^)]+)\)/, (m0, id: string) => {
        const g = grads[id];
        if (!g) return m0;
        const nid = `${id}@${tag}${shapeId}`;
        gradients[nid] = { ...g, id: nid, transform: g.units === 'userSpaceOnUse' ? multiply(world, g.transform) : g.transform };
        return `url(#${nid})`;
      });
    return { ...p, fill: re(p.fill), stroke: re(p.stroke) };
  };
  for (const x of A) x.shape.paint = worldPaint(x.shape.paint, x.f.world, a.gradients, 'a', x.shape.id);
  for (const y of B) y.shape.paint = worldPaint(y.shape.paint, y.f.world, b.gradients, 'b', y.shape.id);
  for (const [i, j] of match)
    pairs.push({ plan: prepareMorph(A[i].d, B[j].d, points), from: A[i].shape.paint, to: B[j].shape.paint, fromOpacity: A[i].f.opacity, toOpacity: B[j].f.opacity, fromCtx: A[i].f.ctx, toCtx: B[j].f.ctx, kind: 'pair', fromId: A[i].shape.id, toId: B[j].shape.id });
  const nearest = (p: { x: number; y: number }, list: { c: { x: number; y: number } }[]) => list.reduce((best, x) => (Math.hypot(x.c.x - p.x, x.c.y - p.y) < Math.hypot(best.c.x - p.x, best.c.y - p.y) ? x : best), list[0] ?? { c: p });
  A.forEach((x, i) => {
    if (usedA.has(i)) return;
    pairs.push({ plan: prepareMorph(x.d, point(nearest(x.c, B).c), points), from: x.shape.paint, to: x.shape.paint, fromOpacity: x.f.opacity, toOpacity: 0, fromCtx: x.f.ctx, toCtx: x.f.ctx, kind: 'shrink', fromId: x.shape.id, toId: '' });
  });
  B.forEach((y, j) => {
    if (usedB.has(j)) return;
    pairs.push({ plan: prepareMorph(point(nearest(y.c, A).c), y.d, points), from: y.shape.paint, to: y.shape.paint, fromOpacity: 0, toOpacity: y.f.opacity, fromCtx: y.f.ctx, toCtx: y.f.ctx, kind: 'grow', fromId: '', toId: y.shape.id });
  });
  return { pairs, fit, gradients, rawsA: flatA.filter((f) => f.node.type === 'raw'), rawsB: flatB.filter((f) => f.node.type === 'raw') };
}

export interface MorphedShape {
  d: string;
  fill: string | { gradient: Gradient };
  fillOpacity: number;
  fillRule: Paint['fillRule'];
  stroke: string | { gradient: Gradient };
  strokeOpacity: number;
  strokeWidth: number;
  linecap: Paint['linecap'];
  linejoin: Paint['linejoin'];
  /** Element opacity under each context: one entry when both ends share it, else [from, to] crossfading. */
  layers: { ctx: DrawContext[]; opacity: number }[];
}

const refId = (v: string) => /url\(#([^)]+)\)/.exec(v)?.[1];

function lerpChannel(a: string, b: string, aOp: number, bOp: number, t: number, grads: Record<string, Gradient>): { v: string | { gradient: Gradient }; op: number } {
  const ga = refId(a) ? grads[refId(a)!] : undefined;
  const gb = refId(b) ? grads[refId(b)!] : undefined;
  if (a === 'none' && b === 'none') return { v: 'none', op: 0 };
  if (!ga && !gb) {
    if (a === 'none') return { v: b, op: bOp * t };
    if (b === 'none') return { v: a, op: aOp * (1 - t) };
    return { v: lerpColor(a, b, t), op: aOp + (bOp - aOp) * t };
  }
  // at least one gradient: interpolate as gradients (a solid colour is a flat gradient)
  const asG = (g: Gradient | undefined, solid: string, other: Gradient): Gradient => g ?? { ...other, stops: solidStops({ hex: solid === 'none' ? other.stops[0]?.color ?? '#000000' : parseColor(solid)?.hex ?? '#000000', alpha: solid === 'none' ? 0 : 1 }) };
  const A = asG(ga, a, gb!);
  const B = asG(gb, b, ga ?? gb!);
  return { v: { gradient: lerpGradient(A, B, t) }, op: (a === 'none' ? 0 : aOp) + ((b === 'none' ? 0 : bOp) - (a === 'none' ? 0 : aOp)) * t };
}

const sameCtx = (x: DrawContext[], y: DrawContext[]) => x === y || JSON.stringify(x) === JSON.stringify(y);

export function docMorphAt(m: DocMorph, t: number, arc = 0): MorphedShape[] {
  const k = clamp01(t);
  return m.pairs.map((p) => {
    const f = lerpChannel(p.from.fill, p.to.fill, p.from.fillOpacity, p.to.fillOpacity, k, m.gradients);
    const s = lerpChannel(p.from.stroke, p.to.stroke, p.from.strokeOpacity, p.to.strokeOpacity, k, m.gradients);
    const op = p.fromOpacity + (p.toOpacity - p.fromOpacity) * k;
    return {
      d: morphAt(p.plan, k, arc),
      fill: f.v,
      fillOpacity: f.op,
      fillRule: k < 0.5 ? p.from.fillRule : p.to.fillRule,
      stroke: s.v,
      strokeOpacity: s.op,
      strokeWidth: p.from.strokeWidth + (p.to.strokeWidth - p.from.strokeWidth) * k,
      linecap: k < 0.5 ? p.from.linecap : p.to.linecap,
      linejoin: k < 0.5 ? p.from.linejoin : p.to.linejoin,
      layers: sameCtx(p.fromCtx, p.toCtx)
        ? [{ ctx: p.fromCtx, opacity: op }]
        : [
            { ctx: p.fromCtx, opacity: op * (1 - k) },
            { ctx: p.toCtx, opacity: op * k },
          ],
    };
  });
}

// ── program clock

export interface ProgramState {
  mode: VectorProgram['mode'];
  /** 0..1 through the program. */
  progress: number;
  phase: 'before' | 'running' | 'done';
}

export const PROGRAM_DEFAULTS: Record<VectorProgram['mode'], number> = { draw: 2.4, build: 1.8, morph: 1.2, static: 0 };

/** Where a program is at scene-local second `sec` (what seek and QC report). */
export function programAt(p: VectorProgram, sec: number): ProgramState {
  const start = p.start ?? 0;
  const dur = p.duration ?? PROGRAM_DEFAULTS[p.mode];
  if (p.mode === 'static' || dur <= 0) return { mode: p.mode, progress: 1, phase: 'done' };
  const k = (sec - start) / dur;
  return { mode: p.mode, progress: Math.round(clamp01(k) * 1e4) / 1e4, phase: k <= 0 ? 'before' : k >= 1 ? 'done' : 'running' };
}
