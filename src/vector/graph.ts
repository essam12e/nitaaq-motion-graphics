/**
 * Non-Destructive Vector Graph: procedural, animatable vector art as data.
 *
 *   shape → transform → boolean → mask → fill / stroke / gradient → effect → output
 *
 * A graph is plain JSON (zod-validated, versioned): nodes by id, each naming its inputs.
 * Nothing is baked: every parameter can be a number or keyframes `{ k: [{ t, v, ease }] }`
 * (seconds), so the same graph is a still at any time and an animation over time.
 * evaluateGraph(graph, t) is pure and deterministic (no random, no clock); results are
 * memoised per node by the node's resolved parameters, so a node whose parameters do
 * not change is not recomputed between frames (cacheable). Output is SVG markup with
 * ids scoped by a prefix, drawn by <VectorGraphArt> or anywhere an SVG goes.
 *
 * The Creative Director writes these graphs into video.json (scene `vector-draw`,
 * variant `graph`); they can also be edited by hand.
 */
import { z } from 'zod';
import { curve } from '../motion/easing';
import { aroundOrigin, multiplyAll, rotate as rotateM, scale as scaleM, translate, toSvg, type Mat } from './matrix';
import { subsToPath, trimSubs, transformSubs, pathBounds, normalizePath } from './geometry';
import { parsePath } from '../morph/path';
import { exactBoolean, renderBoolean, type BooleanOp } from './boolean';
import { parseColor } from './paint';

export const VECTOR_GRAPH_VERSION = 1;

// ── parameters

const Key = z.object({ t: z.number().min(0), v: z.number(), ease: z.string().max(40).optional() });
export const ParamSchema = z.union([z.number(), z.object({ k: z.array(Key).min(1).max(64) })]);
export type Param = z.infer<typeof ParamSchema>;

const ColorKey = z.object({ t: z.number().min(0), v: z.string().max(40), ease: z.string().max(40).optional() });
export const ColorParamSchema = z.union([z.string().max(40), z.object({ k: z.array(ColorKey).min(1).max(64) })]);

const easeOf = (name: string | undefined) => (name === 'linear' ? (x: number) => x : name === 'hold' ? (x: number) => (x >= 1 ? 1 : 0) : curve(name ?? 'ease-in-out-cubic'));

/** Value of a parameter at time t (keyframes: eased between neighbours, held outside). */
export function paramAt(p: Param | undefined, t: number, fallback = 0): number {
  if (p === undefined) return fallback;
  if (typeof p === 'number') return p;
  const k = [...p.k].sort((a, b) => a.t - b.t);
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const a = k[i - 1];
      const b = k[i];
      const e = easeOf(b.ease)((t - a.t) / Math.max(1e-9, b.t - a.t));
      return a.v + (b.v - a.v) * e;
    }
  }
  return last.v;
}

export function colorAt(p: z.infer<typeof ColorParamSchema> | undefined, t: number, fallback = '#000000'): string {
  if (p === undefined) return fallback;
  if (typeof p === 'string') return p;
  const k = [...p.k].sort((a, b) => a.t - b.t);
  if (t <= k[0].t) return k[0].v;
  if (t >= k[k.length - 1].t) return k[k.length - 1].v;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const a = k[i - 1];
      const b = k[i];
      const e = easeOf(b.ease)((t - a.t) / Math.max(1e-9, b.t - a.t));
      const A = parseColor(a.v);
      const B = parseColor(b.v);
      if (!A || !B) return e < 0.5 ? a.v : b.v;
      // OKLab via paint.lerpColor would pull in the gradient module; sRGB-linear is enough for keyed fills
      const h = (s: string) => [1, 3, 5].map((j) => parseInt(s.slice(j, j + 2), 16));
      const ca = h(A.hex);
      const cb = h(B.hex);
      return `#${ca.map((x, j) => Math.round(x + (cb[j] - x) * e).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    }
  }
  return k[k.length - 1].v;
}

// ── nodes

const Id = z.string().min(1).max(40).regex(/^[\w-]+$/);
const Base = { id: Id, label: z.string().max(80).optional() };

const ShapeNode = z.object({
  ...Base,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'polygon', 'star', 'path']),
  x: ParamSchema.optional(),
  y: ParamSchema.optional(),
  width: ParamSchema.optional(),
  height: ParamSchema.optional(),
  /** rect corner radius · star inner radius ratio */
  radius: ParamSchema.optional(),
  /** polygon / star point count */
  sides: z.number().int().min(3).max(64).optional(),
  d: z.string().max(20000).optional(),
});
const TransformNode = z.object({
  ...Base,
  type: z.literal('transform'),
  input: Id,
  x: ParamSchema.optional(),
  y: ParamSchema.optional(),
  rotate: ParamSchema.optional(),
  scale: ParamSchema.optional(),
  scaleX: ParamSchema.optional(),
  scaleY: ParamSchema.optional(),
  /** Transform origin as a fraction of the input's bounds (0.5, 0.5 = centre). */
  originX: z.number().min(-2).max(3).default(0.5),
  originY: z.number().min(-2).max(3).default(0.5),
});
const BooleanNode = z.object({ ...Base, type: z.literal('boolean'), a: Id, b: Id, op: z.enum(['union', 'subtract', 'intersect', 'exclude']), mode: z.enum(['render', 'exact']).default('render') });
const PaintNode = z.object({
  ...Base,
  type: z.literal('fill'),
  input: Id,
  color: ColorParamSchema.optional(),
  /** Gradient fill (wins over color). */
  gradient: z
    .object({ type: z.enum(['linear', 'radial']).default('linear'), angle: ParamSchema.optional(), stops: z.array(z.object({ offset: z.number().min(0).max(1), color: ColorParamSchema })).min(2).max(8) })
    .optional(),
  opacity: ParamSchema.optional(),
});
const StrokeNode = z.object({
  ...Base,
  type: z.literal('stroke'),
  input: Id,
  color: ColorParamSchema.optional(),
  width: ParamSchema.optional(),
  /** Trim the outline (0..1): drawing on = animate `end` 0 → 1. */
  start: ParamSchema.optional(),
  end: ParamSchema.optional(),
  offset: ParamSchema.optional(),
  cap: z.enum(['butt', 'round', 'square']).default('round'),
  join: z.enum(['miter', 'round', 'bevel']).default('round'),
  /** Keep the input's fill under the stroke. */
  keepFill: z.boolean().default(true),
});
const MaskNode = z.object({ ...Base, type: z.literal('mask'), input: Id, mask: Id, mode: z.enum(['clip', 'alpha', 'invert']).default('clip') });
const EffectNode = z.object({ ...Base, type: z.literal('effect'), input: Id, effect: z.enum(['shadow', 'glow', 'blur']), amount: ParamSchema.optional(), color: ColorParamSchema.optional(), x: ParamSchema.optional(), y: ParamSchema.optional() });
const GroupNode = z.object({ ...Base, type: z.literal('group'), inputs: z.array(Id).min(1).max(64), opacity: ParamSchema.optional() });

export const GraphNodeSchema = z.discriminatedUnion('type', [ShapeNode, TransformNode, BooleanNode, PaintNode, StrokeNode, MaskNode, EffectNode, GroupNode]);
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const VectorGraphSchema = z
  .object({
    version: z.literal(VECTOR_GRAPH_VERSION).default(VECTOR_GRAPH_VERSION),
    width: z.number().positive().max(10000),
    height: z.number().positive().max(10000),
    nodes: z.array(GraphNodeSchema).min(1).max(200),
    output: Id,
  })
  .superRefine((g, ctx) => {
    const ids = new Set<string>();
    for (const n of g.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate node id ${n.id}` });
      ids.add(n.id);
    }
    const refs = (n: GraphNode): string[] => (n.type === 'shape' ? [] : n.type === 'boolean' ? [n.a, n.b] : n.type === 'mask' ? [n.input, n.mask] : n.type === 'group' ? n.inputs : [n.input]);
    for (const n of g.nodes) for (const r of refs(n)) if (!ids.has(r)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `node ${n.id} uses missing input ${r}` });
    if (!ids.has(g.output)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `output ${g.output} is not a node` });
    // no cycles
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const state = new Map<string, 1 | 2>();
    const visit = (id: string): boolean => {
      if (state.get(id) === 2) return true;
      if (state.get(id) === 1) return false;
      state.set(id, 1);
      const n = byId.get(id);
      const ok = n ? refs(n).every(visit) : true;
      state.set(id, 2);
      return ok;
    };
    for (const n of g.nodes) if (!visit(n.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `cycle through ${n.id}` });
  });
export type VectorGraph = z.infer<typeof VectorGraphSchema>;

// ── evaluation

const normalized = new WeakMap<object, VectorGraph>();
/**
 * The graph with every default filled in (a graph read from video.json has not been through this schema:
 * scene content is stored as written). Validated once per graph object.
 */
export function normalizeGraph(g: VectorGraph): VectorGraph {
  let n = normalized.get(g);
  if (!n) {
    n = VectorGraphSchema.parse(g);
    normalized.set(g, n);
  }
  return n;
}

/** What flows along an edge: an outline (until painted) and/or drawn SVG. */
export interface GraphValue {
  /** Outline in graph coordinates (absolute cubic path), when the value still is one shape. */
  d: string | null;
  /** Drawn markup (painted), or null while only an outline. */
  svg: string | null;
  defs: string;
  /** Outline is a boolean result: holes are drawn with the even-odd rule. */
  evenodd?: boolean;
}

function shapeD(n: z.infer<typeof ShapeNode>, t: number): string {
  const x = paramAt(n.x, t);
  const y = paramAt(n.y, t);
  const w = Math.max(0, paramAt(n.width, t, 100));
  const h = Math.max(0, paramAt(n.height, t, w));
  switch (n.shape) {
    case 'rect': {
      const r = Math.max(0, Math.min(paramAt(n.radius, t), w / 2, h / 2));
      if (!r) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    }
    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      const cx = x + rx;
      return `M${cx} ${y}A${rx} ${ry} 0 1 1 ${cx} ${y + h}A${rx} ${ry} 0 1 1 ${cx} ${y}Z`;
    }
    case 'polygon':
    case 'star': {
      const k = n.sides ?? (n.shape === 'star' ? 5 : 6);
      const inner = n.shape === 'star' ? Math.min(1, Math.max(0.05, paramAt(n.radius, t, 0.45))) : 1;
      const pts: string[] = [];
      const cx = x + w / 2;
      const cy = y + h / 2;
      const steps = n.shape === 'star' ? k * 2 : k;
      for (let i = 0; i < steps; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
        const r = n.shape === 'star' && i % 2 ? inner : 1;
        pts.push(`${(cx + Math.cos(a) * (w / 2) * r).toFixed(3)} ${(cy + Math.sin(a) * (h / 2) * r).toFixed(3)}`);
      }
      return `M${pts.join('L')}Z`;
    }
    default:
      return n.d ?? '';
  }
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** Every parameter of a node resolved at time t (the memo key: same resolved node → same result). */
function resolved(n: GraphNode, t: number): unknown {
  return JSON.stringify(n, (_k, v) => (v && typeof v === 'object' && Array.isArray((v as { k?: unknown }).k) ? (typeof (v as { k: { v: unknown }[] }).k[0]?.v === 'number' ? paramAt(v as Param, t) : colorAt(v as never, t)) : v));
}

export interface GraphEvaluation {
  svg: string;
  defs: string;
  /** Nodes recomputed this call (the rest came from the memo). */
  computed: number;
  warnings: string[];
}

/** Per-graph memo of node results keyed by resolved parameters and inputs. */
export class GraphCache {
  private m = new Map<string, GraphValue>();
  get(k: string) {
    return this.m.get(k);
  }
  set(k: string, v: GraphValue) {
    if (this.m.size > 5000) this.m.clear();
    this.m.set(k, v);
  }
}

/**
 * Evaluates the graph at second t. `prefix` scopes every id it emits (gradients, clips, masks, filters).
 */
export function evaluateGraph(input: VectorGraph, t: number, prefix = 'g', cache: GraphCache = new GraphCache()): GraphEvaluation {
  const graph = normalizeGraph(input);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const warnings = new Set<string>();
  const keys = new Map<string, string>();
  let computed = 0;
  const pid = (n: GraphNode, s = '') => `${prefix}-${n.id}${s}`;

  const evalNode = (id: string): { v: GraphValue; key: string } => {
    const n = byId.get(id)!;
    const inputs = n.type === 'shape' ? [] : n.type === 'boolean' ? [n.a, n.b] : n.type === 'mask' ? [n.input, n.mask] : n.type === 'group' ? n.inputs : [n.input];
    const ins = inputs.map(evalNode);
    const key = `${prefix}|${resolved(n, t)}|${ins.map((x) => x.key).join(',')}`;
    keys.set(id, key);
    const hit = cache.get(key);
    if (hit) return { v: hit, key };
    computed++;
    const v = compute(n, ins.map((x) => x.v));
    cache.set(key, v);
    return { v, key };
  };

  const asSvg = (v: GraphValue, fallbackFill = '#000000') => v.svg ?? (v.d ? `<path d="${v.d}" fill="${fallbackFill}"/>` : '');

  const compute = (n: GraphNode, ins: GraphValue[]): GraphValue => {
    switch (n.type) {
      case 'shape': {
        const d = shapeD(n, t);
        return { d: d ? normalizePath(d) : null, svg: null, defs: '' };
      }
      case 'transform': {
        const src = ins[0];
        const box = src.d ? pathBounds(src.d) : { x: 0, y: 0, width: graph.width, height: graph.height };
        const o = { x: box.x + box.width * n.originX, y: box.y + box.height * n.originY };
        const s = paramAt(n.scale, t, 1);
        const m: Mat = multiplyAll(translate(paramAt(n.x, t), paramAt(n.y, t)), aroundOrigin(multiplyAll(rotateM(paramAt(n.rotate, t)), scaleM(s * paramAt(n.scaleX, t, 1), s * paramAt(n.scaleY, t, 1))), o));
        // outlines are transformed exactly (they stay editable outlines); drawn markup is wrapped
        return { d: src.d ? subsToPath(transformSubs(parsePath(src.d), m)) : null, svg: src.svg ? `<g transform="${toSvg(m)}">${src.svg}</g>` : null, defs: src.defs, ...(src.evenodd ? { evenodd: true } : {}) };
      }
      case 'boolean': {
        const [a, b] = ins;
        if (!a.d || !b.d) {
          warnings.add(`boolean ${n.id}: inputs must be outlines (put fill / stroke after the boolean)`);
          return { d: a.d, svg: a.svg, defs: a.defs + b.defs };
        }
        if (n.mode === 'exact') {
          const r = exactBoolean(n.op as BooleanOp, a.d, b.d);
          if (!('error' in r)) return { d: r.d || null, svg: null, defs: '', evenodd: true };
          warnings.add(`boolean ${n.id}: ${r.error}; drawn by the renderer instead`);
        }
        const r = renderBoolean(n.op as BooleanOp, a.d, b.d, pid(n));
        // a render-level result is drawn markup (no single outline) without its own fill: a fill node around it colours it
        return { d: null, svg: r.body, defs: r.defs };
      }
      case 'fill': {
        const src = ins[0];
        const op = Math.min(1, Math.max(0, paramAt(n.opacity, t, 1)));
        let fill = colorAt(n.color, t, '#000000');
        let defs = src.defs;
        if (n.gradient) {
          const gid = pid(n, '-grad');
          const stops = n.gradient.stops.map((s) => `<stop offset="${s.offset}" stop-color="${esc(colorAt(s.color, t))}"/>`).join('');
          if (n.gradient.type === 'radial') defs += `<radialGradient id="${gid}" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`;
          else {
            const a = (paramAt(n.gradient.angle, t, 90) * Math.PI) / 180;
            const dx = Math.cos(a) / 2;
            const dy = Math.sin(a) / 2;
            defs += `<linearGradient id="${gid}" x1="${(0.5 - dx).toFixed(4)}" y1="${(0.5 - dy).toFixed(4)}" x2="${(0.5 + dx).toFixed(4)}" y2="${(0.5 + dy).toFixed(4)}">${stops}</linearGradient>`;
          }
          fill = `url(#${gid})`;
        }
        if (src.d) return { d: src.d, svg: `<path d="${src.d}" fill="${esc(fill)}"${src.evenodd ? ' fill-rule="evenodd"' : ''}${op < 1 ? ` fill-opacity="${op}"` : ''}/>`, defs, ...(src.evenodd ? { evenodd: true } : {}) };
        // drawn markup (a render-level boolean): its paths inherit the group's fill (gradients use the group's bounding box)
        return { d: null, svg: `<g fill="${esc(fill)}"${op < 1 ? ` opacity="${op}"` : ''}>${src.svg ?? ''}</g>`, defs };
      }
      case 'stroke': {
        const src = ins[0];
        if (!src.d) {
          warnings.add(`stroke ${n.id}: needs an outline input`);
          return src;
        }
        const start = paramAt(n.start, t, 0);
        const end = paramAt(n.end, t, 1);
        const trimmed = start <= 0 && end >= 1 && !paramAt(n.offset, t) ? src.d : subsToPath(trimSubs(parsePath(src.d), { start, end, offset: paramAt(n.offset, t) }));
        const line = trimmed ? `<path d="${trimmed}" fill="none" stroke="${esc(colorAt(n.color, t))}" stroke-width="${paramAt(n.width, t, 2)}" stroke-linecap="${n.cap}" stroke-linejoin="${n.join}"/>` : '';
        return { d: src.d, svg: `${n.keepFill && src.svg ? src.svg : ''}${line}`, defs: src.defs };
      }
      case 'mask': {
        const [src, m] = ins;
        const id = pid(n);
        const body = src.svg ?? (src.d ? `<path d="${src.d}"/>` : '');
        if (n.mode === 'clip') {
          if (!m.d) {
            warnings.add(`mask ${n.id}: clip mode needs an outline as the mask`);
            return src;
          }
          return { d: null, svg: `<g clip-path="url(#${id})">${body}</g>`, defs: `${src.defs}<clipPath id="${id}"><path d="${m.d}"/></clipPath>` };
        }
        const maskArt = m.svg ?? (m.d ? `<path d="${m.d}" fill="#fff"/>` : '');
        // invert: the mask art with its luminance flipped, over white (shows everything except the mask)
        const inv = `${id}-inv`;
        const inner = n.mode === 'invert' ? `<rect x="-100000" y="-100000" width="200000" height="200000" fill="#fff"/><g filter="url(#${inv})">${maskArt}</g>` : maskArt;
        const invDef = n.mode === 'invert' ? `<filter id="${inv}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter>` : '';
        return { d: null, svg: `<g mask="url(#${id})">${body}</g>`, defs: `${src.defs}${m.defs}${invDef}<mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">${inner}</mask>` };
      }
      case 'effect': {
        const src = ins[0];
        const id = pid(n);
        const amt = Math.max(0, paramAt(n.amount, t, n.effect === 'blur' ? 4 : 8));
        const color = esc(colorAt(n.color, t, n.effect === 'glow' ? '#FFFFFF' : '#000000'));
        const filter =
          n.effect === 'blur'
            ? `<feGaussianBlur stdDeviation="${amt}"/>`
            : n.effect === 'glow'
              ? `<feGaussianBlur in="SourceAlpha" stdDeviation="${amt}" result="b"/><feFlood flood-color="${color}" result="c"/><feComposite in="c" in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>`
              : `<feDropShadow dx="${paramAt(n.x, t, 0)}" dy="${paramAt(n.y, t, amt / 2)}" stdDeviation="${amt}" flood-color="${color}" flood-opacity="0.45"/>`;
        return { d: src.d, svg: `<g filter="url(#${id})">${asSvg(src)}</g>`, defs: `${src.defs}<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${filter}</filter>` };
      }
      case 'group': {
        const op = Math.min(1, Math.max(0, paramAt(n.opacity, t, 1)));
        return { d: null, svg: `<g${op < 1 ? ` opacity="${op}"` : ''}>${ins.map((x) => asSvg(x)).join('')}</g>`, defs: ins.map((x) => x.defs).join('') };
      }
    }
  };

  const out = evalNode(graph.output).v;
  return { svg: asSvg(out), defs: out.defs, computed, warnings: [...warnings] };
}

/** A whole SVG document of the graph at time t. */
export function graphToSvg(graph: VectorGraph, t: number, prefix = 'g'): string {
  const r = evaluateGraph(graph, t, prefix);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${graph.width} ${graph.height}" width="${graph.width}" height="${graph.height}"><defs>${r.defs}</defs>${r.svg}</svg>`;
}

/** Last keyframe time in the graph (how long it animates). */
export function graphDuration(graph: VectorGraph): number {
  let end = 0;
  JSON.stringify(graph, (_k, v) => {
    if (v && typeof v === 'object' && Array.isArray((v as { k?: unknown }).k)) for (const x of (v as { k: { t: number }[] }).k) end = Math.max(end, x.t);
    return v;
  });
  return end;
}
