/**
 * SVG → VectorDoc: a group tree with matrices, resolved paint and normalised paths
 * that the vector engine can measure, draw, trim, morph and re-render (pure).
 *
 *   - well-formed SVG from Illustrator, Figma, Inkscape, Affinity, hand-written
 *   - <style> rules (tag / .class / #id compounds, descendant and child combinators), style="", presentation
 *     attributes and inheritance are resolved once into plain values
 *   - rect / circle / ellipse / line / polyline / polygon / path → absolute cubic paths
 *   - g / a / switch / nested svg / use + symbol → groups with matrices
 *   - gradients are parsed into data (src/vector/paint.ts); clip paths, masks,
 *     patterns, filters and markers stay as SVG defs (rendered exactly as authored)
 *   - text and embedded images render as authored ("raw" nodes, not animatable)
 *   - unsafe content is dropped: <script>, <foreignObject>, on* handlers, external links
 *
 * All ids inside the document are written with the placeholder prefix `__P__`;
 * the renderer replaces it per instance so two copies never share defs.
 */
import { parseXml, serialize, elements, type XmlElement, type XmlNode } from '../character/xml';
import { parsePath } from '../morph/path';
import { IDENTITY, multiply, parseTransform, translate, scale as scaleM, apply, type Mat } from './matrix';
import { normalizePath, pathLength, subsBounds, transformSubs, unionBox, segmentCount, type Box } from './geometry';
import { LINEAR_DEFAULTS, RADIAL_DEFAULTS, parseColor, paintRef, type Gradient, type GradientStop } from './paint';

export const ID_PREFIX = '__P__';
export const VECTOR_DOC_VERSION = 1;

export interface Paint {
  /** '#RRGGBB', 'none' or 'url(#__P__id)'. */
  fill: string;
  fillOpacity: number;
  fillRule: 'nonzero' | 'evenodd';
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  linecap: 'butt' | 'round' | 'square';
  linejoin: 'miter' | 'round' | 'bevel';
  miterlimit: number;
  dasharray?: string;
  dashoffset?: number;
  /** stroke width not scaled by transforms */
  nonScalingStroke?: boolean;
}

interface VBase {
  id: string;
  /** The author's id / layer name, when there was one. */
  name?: string;
  transform: Mat;
  opacity: number;
  clipPath?: string;
  mask?: string;
  filter?: string;
  /** Bounds in the node's own coordinates (before its transform). */
  bounds: Box;
}
export interface VGroup extends VBase {
  type: 'group';
  children: VNode[];
}
export interface VShape extends VBase {
  type: 'shape';
  /** The SVG element it came from. */
  tag: string;
  /** Absolute cubic path. */
  d: string;
  paint: Paint;
  length: number;
  segments: number;
}
export interface VRaw extends VBase {
  type: 'raw';
  tag: string;
  /** Serialized element, ids prefixed, inherited paint inlined. */
  xml: string;
}
export type VNode = VGroup | VShape | VRaw;

export interface VectorDoc {
  version: number;
  viewBox: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  root: VGroup;
  /** Clip paths, masks, gradients, patterns, filters, markers as SVG (ids prefixed). */
  defs: string;
  gradients: Record<string, Gradient>;
  stats: { shapes: number; groups: number; raw: number; segments: number; maxDepth: number; clips: number; masks: number; gradients: number };
  warnings: string[];
  errors: string[];
}

// ── CSS

const INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'color', 'visibility', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing', 'direction', 'clip-rule', 'vector-effect'];
const PRESENTATION = new Set([...INHERITED, 'opacity', 'display', 'clip-path', 'mask', 'filter', 'stop-color', 'stop-opacity', 'transform', 'mix-blend-mode', 'isolation']);

interface SelPart {
  tag?: string;
  id?: string;
  classes: string[];
  /** How this part relates to the next one: ' ' descendant, '>' child. */
  comb?: ' ' | '>';
}

interface Rule {
  /** Compound selectors, outermost first; the last one is the element itself. */
  parts: SelPart[];
  spec: number;
  order: number;
  decls: Record<string, string>;
}

function parseDecls(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of s.split(';')) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const k = d.slice(0, i).trim().toLowerCase();
    const v = d.slice(i + 1).replace(/!important/i, '').trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function parseCss(css: string, warnings: Set<string>): Rule[] {
  const rules: Rule[] = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let order = 0;
  if (/@media|@supports/.test(src)) warnings.add('CSS @media / @supports rules are ignored');
  while ((m = re.exec(src))) {
    const decls = parseDecls(m[2]);
    for (const selRaw of m[1].split(',')) {
      const sel = selRaw.trim();
      if (!sel) continue;
      // compounds joined by descendant / child combinators; siblings, pseudo-classes and attributes are not supported
      if (/[+~:[\]*]/.test(sel)) {
        warnings.add(`CSS selector "${sel}" is not supported (tag / .class / #id, descendant and child combinators)`);
        continue;
      }
      const tokens = sel.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
      const parts: SelPart[] = [];
      let bad = false;
      for (const tk of tokens) {
        if (tk === '>') {
          if (!parts.length) bad = true;
          else parts[parts.length - 1].comb = '>';
          continue;
        }
        const tag = /^[a-zA-Z][\w-]*/.exec(tk)?.[0];
        const id = /#([\w-]+)/.exec(tk)?.[1];
        const classes = [...tk.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
        if (!tag && !id && !classes.length) bad = true;
        if (parts.length && !parts[parts.length - 1].comb) parts[parts.length - 1].comb = ' ';
        parts.push({ tag, id, classes });
      }
      if (bad || !parts.length || parts[parts.length - 1].comb) {
        warnings.add(`CSS selector "${sel}" is not supported`);
        continue;
      }
      const spec = parts.reduce((a, p) => a + (p.id ? 100 : 0) + p.classes.length * 10 + (p.tag ? 1 : 0), 0);
      rules.push({ parts, spec, order: order++, decls });
    }
  }
  return rules;
}

/** Writes CSS rules and style="" into presentation attributes (in place, on a copy of the tree). */
function inlineStyles(root: XmlElement, rules: Rule[]) {
  const matches = (p: SelPart, el: { name: string; id?: string; cls: string[] }) => (!p.tag || p.tag === el.name) && (!p.id || p.id === el.id) && p.classes.every((c) => el.cls.includes(c));
  /** Selector parts[0..i] against the ancestor chain ending at chain[j] (right to left, backtracking). */
  const matchChain = (parts: SelPart[], i: number, chain: { name: string; id?: string; cls: string[] }[], j: number): boolean => {
    if (!matches(parts[i], chain[j])) return false;
    if (i === 0) return true;
    if (parts[i - 1].comb === '>') return j > 0 && matchChain(parts, i - 1, chain, j - 1);
    for (let k = j - 1; k >= 0; k--) if (matchChain(parts, i - 1, chain, k)) return true;
    return false;
  };
  const chain: { name: string; id?: string; cls: string[] }[] = [];
  const walk = (el: XmlElement) => {
    const cls = (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
    chain.push({ name: el.name, id: el.attrs.id, cls });
    const matched = rules
      .filter((r) => matchChain(r.parts, r.parts.length - 1, chain, chain.length - 1))
      .sort((a, b) => a.spec - b.spec || a.order - b.order);
    const decl: Record<string, string> = {};
    for (const r of matched) Object.assign(decl, r.decls);
    Object.assign(decl, parseDecls(el.attrs.style ?? ''));
    for (const [k, v] of Object.entries(decl)) if (PRESENTATION.has(k) && k !== 'transform') el.attrs[k] = v;
    delete el.attrs.style;
    delete el.attrs.class;
    for (const c of elements(el)) walk(c);
    chain.pop();
  };
  walk(root);
}

// ── safety

const DROP = new Set(['script', 'foreignObject', 'iframe', 'audio', 'video', 'canvas', 'animate', 'animateTransform', 'animateMotion', 'set', 'discard']);

function sanitize(el: XmlElement, warnings: Set<string>): XmlElement {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.attrs)) {
    if (/^on/i.test(k)) {
      warnings.add('event handlers (on…) removed');
      continue;
    }
    if ((k === 'href' || k === 'xlink:href') && !v.startsWith('#') && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(v)) {
      warnings.add('external links removed (only #references and embedded images are kept)');
      continue;
    }
    if (/url\(\s*['"]?(?!#)/i.test(v) && k !== 'href') {
      warnings.add('external url() references removed');
      continue;
    }
    attrs[k] = v;
  }
  const children: XmlNode[] = [];
  for (const c of el.children) {
    if (c.type === 'text') {
      children.push(c);
      continue;
    }
    if (DROP.has(c.name)) {
      warnings.add(c.name.startsWith('anim') || c.name === 'set' ? 'SMIL animation removed (motion is driven by the film timeline)' : `<${c.name}> removed`);
      continue;
    }
    children.push(sanitize(c, warnings));
  }
  return { ...el, attrs, children };
}

// ── ids

const prefixUrl = (v: string) => v.replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, (_m, id) => `url(#${ID_PREFIX}${id})`);

function prefixIds(el: XmlElement): XmlElement {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k === 'id') attrs[k] = `${ID_PREFIX}${v}`;
    else if ((k === 'href' || k === 'xlink:href') && v.startsWith('#')) attrs[k] = `#${ID_PREFIX}${v.slice(1)}`;
    else attrs[k] = prefixUrl(v);
  }
  return { ...el, attrs, children: el.children.map((c) => (c.type === 'element' ? prefixIds(c) : c)) };
}

// ── numbers

const num = (v: string | undefined, def = 0, rel?: number): number => {
  if (v === undefined || v === '') return def;
  const s = v.trim();
  if (s.endsWith('%') && rel !== undefined) return (parseFloat(s) / 100) * rel;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return def;
  if (s.endsWith('mm')) return n * 3.7795;
  if (s.endsWith('cm')) return n * 37.795;
  if (s.endsWith('in')) return n * 96;
  if (s.endsWith('pt')) return n * (4 / 3);
  return n;
};
const nums = (v: string | undefined) => (v?.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function viewBoxMatrix(vb: number[] | null, w: number, h: number, par: string | undefined): Mat {
  if (!vb || vb.length !== 4 || vb[2] <= 0 || vb[3] <= 0) return [...IDENTITY];
  const [x, y, vw, vh] = vb;
  const p = (par ?? 'xMidYMid meet').trim();
  if (p.startsWith('none')) return multiply(scaleM(w / vw, h / vh), translate(-x, -y));
  const slice = /slice/.test(p);
  const k = slice ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
  const ax = /xMin/.test(p) ? 0 : /xMax/.test(p) ? 1 : 0.5;
  const ay = /YMin/.test(p) ? 0 : /YMax/.test(p) ? 1 : 0.5;
  return multiply(translate((w - vw * k) * ax, (h - vh * k) * ay), multiply(scaleM(k), translate(-x, -y)));
}

// ── shapes → path

function shapePath(el: XmlElement, vw: number, vh: number): string | null {
  const a = el.attrs;
  const diag = Math.hypot(vw, vh) / Math.SQRT2;
  switch (el.name) {
    case 'path':
      return a.d ?? null;
    case 'rect': {
      const x = num(a.x, 0, vw);
      const y = num(a.y, 0, vh);
      const w = num(a.width, 0, vw);
      const h = num(a.height, 0, vh);
      if (w <= 0 || h <= 0) return null;
      let rx = a.rx !== undefined ? num(a.rx, 0, vw) : a.ry !== undefined ? num(a.ry, 0, vh) : 0;
      let ry = a.ry !== undefined ? num(a.ry, 0, vh) : rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(a.cx, 0, vw);
      const cy = num(a.cy, 0, vh);
      const rx = el.name === 'circle' ? num(a.r, 0, diag) : num(a.rx, 0, vw);
      const ry = el.name === 'circle' ? rx : num(a.ry, 0, vh);
      if (rx <= 0 || ry <= 0) return null;
      // starts at the top and runs clockwise, like a pen would draw it
      return `M${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}Z`;
    }
    case 'line':
      return `M${num(a.x1, 0, vw)} ${num(a.y1, 0, vh)}L${num(a.x2, 0, vw)} ${num(a.y2, 0, vh)}`;
    case 'polyline':
    case 'polygon': {
      const p = nums(a.points);
      if (p.length < 4) return null;
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return el.name === 'polygon' ? `${d}Z` : d;
    }
  }
  return null;
}

// ── gradients

function parseGradients(all: Map<string, XmlElement>): Record<string, Gradient> {
  const out: Record<string, Gradient> = {};
  const resolve = (el: XmlElement, depth = 0): { attrs: Record<string, string>; stops: XmlElement[] } => {
    const href = el.attrs.href ?? el.attrs['xlink:href'];
    const parent = href?.startsWith('#') && depth < 8 ? all.get(href.slice(1)) : undefined;
    const base = parent && /Gradient$/.test(parent.name) ? resolve(parent, depth + 1) : { attrs: {}, stops: [] };
    const own = elements(el).filter((c) => c.name === 'stop');
    return { attrs: { ...base.attrs, ...el.attrs }, stops: own.length ? own : base.stops };
  };
  for (const [id, el] of all) {
    if (el.name !== 'linearGradient' && el.name !== 'radialGradient') continue;
    const { attrs, stops } = resolve(el);
    const units = attrs.gradientUnits === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';
    const frac = (v: string | undefined, d: number) => (v === undefined ? d : v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v));
    const coords: Record<string, number> = {};
    if (el.name === 'linearGradient') for (const k of Object.keys(LINEAR_DEFAULTS) as (keyof typeof LINEAR_DEFAULTS)[]) coords[k] = frac(attrs[k], LINEAR_DEFAULTS[k]);
    else {
      for (const k of Object.keys(RADIAL_DEFAULTS) as (keyof typeof RADIAL_DEFAULTS)[]) coords[k] = frac(attrs[k], RADIAL_DEFAULTS[k]);
      coords.fx = frac(attrs.fx, coords.cx);
      coords.fy = frac(attrs.fy, coords.cy);
    }
    let last = 0;
    const st: GradientStop[] = stops.map((s) => {
      const c = parseColor(s.attrs['stop-color'] ?? 'black') ?? { hex: '#000000', alpha: 1 };
      last = Math.max(last, Math.min(1, Math.max(0, frac(s.attrs.offset, 0))));
      return { offset: last, color: c.hex, opacity: c.alpha * Math.min(1, Math.max(0, Number(s.attrs['stop-opacity'] ?? 1))) };
    });
    out[id] = {
      id,
      type: el.name === 'linearGradient' ? 'linear' : 'radial',
      units,
      coords,
      transform: parseTransform(attrs.gradientTransform),
      spread: attrs.spreadMethod === 'reflect' ? 'reflect' : attrs.spreadMethod === 'repeat' ? 'repeat' : 'pad',
      stops: st,
    };
  }
  return out;
}

// ── main

type Inherited = Record<string, string>;

const paintOf = (st: Inherited): Paint => {
  const fillSrc = st.fill ?? 'black';
  const strokeSrc = st.stroke ?? 'none';
  const color = (src: string) => {
    if (src === 'currentColor') src = st.color ?? 'black';
    const ref = paintRef(src);
    if (ref) return { v: `url(#${ID_PREFIX}${ref})`, a: 1 };
    const c = parseColor(src);
    return c ? { v: c.hex, a: c.alpha } : { v: 'none', a: 1 };
  };
  const f = color(fillSrc);
  const s = color(strokeSrc);
  const cap = st['stroke-linecap'];
  const join = st['stroke-linejoin'];
  const dash = st['stroke-dasharray'];
  return {
    fill: f.v,
    fillOpacity: r3(f.a * Math.min(1, Math.max(0, Number(st['fill-opacity'] ?? 1)))),
    fillRule: st['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
    stroke: s.v,
    strokeOpacity: r3(s.a * Math.min(1, Math.max(0, Number(st['stroke-opacity'] ?? 1)))),
    strokeWidth: num(st['stroke-width'], 1),
    linecap: cap === 'round' || cap === 'square' ? cap : 'butt',
    linejoin: join === 'round' || join === 'bevel' ? join : 'miter',
    miterlimit: num(st['stroke-miterlimit'], 4),
    ...(dash && dash !== 'none' ? { dasharray: dash } : {}),
    ...(st['stroke-dashoffset'] ? { dashoffset: num(st['stroke-dashoffset'], 0) } : {}),
    ...(st['vector-effect'] === 'non-scaling-stroke' ? { nonScalingStroke: true } : {}),
  };
};

/** Parses an SVG document. Never throws: problems go to `errors` (unusable) and `warnings`. */
export function parseSvg(src: string): VectorDoc {
  const warnings = new Set<string>();
  const errors: string[] = [];
  const empty = (msg: string): VectorDoc => ({
    version: VECTOR_DOC_VERSION,
    viewBox: { x: 0, y: 0, width: 0, height: 0 },
    width: 0,
    height: 0,
    root: { type: 'group', id: 'root', transform: [...IDENTITY], opacity: 1, children: [], bounds: { x: 0, y: 0, width: 0, height: 0 } },
    defs: '',
    gradients: {},
    stats: { shapes: 0, groups: 0, raw: 0, segments: 0, maxDepth: 0, clips: 0, masks: 0, gradients: 0 },
    warnings: [...warnings],
    errors: [msg],
  });
  let doc: XmlElement;
  try {
    doc = parseXml(src.replace(/^﻿/, ''));
  } catch (e) {
    return empty(`not well-formed XML: ${(e as Error).message}`);
  }
  const svg0 = elements(doc).find((e) => e.name === 'svg');
  if (!svg0) return empty('no <svg> root element');
  const svg = sanitize(svg0, warnings);

  // CSS → attributes
  const css: string[] = [];
  const collectCss = (el: XmlElement) => {
    for (const c of elements(el)) {
      if (c.name === 'style') css.push(c.children.map((x) => (x.type === 'text' ? x.raw : '')).join(''));
      else collectCss(c);
    }
  };
  collectCss(svg);
  inlineStyles(svg, parseCss(css.join('\n'), warnings));

  // every element with an id (defs can be anywhere)
  const byId = new Map<string, XmlElement>();
  const index = (el: XmlElement) => {
    if (el.attrs.id && !byId.has(el.attrs.id)) byId.set(el.attrs.id, el);
    for (const c of elements(el)) index(c);
  };
  index(svg);

  const vbNums = nums(svg.attrs.viewBox);
  const vb = vbNums.length === 4 && vbNums[2] > 0 && vbNums[3] > 0 ? vbNums : null;
  const width = num(svg.attrs.width, vb ? vb[2] : 0, vb ? vb[2] : undefined) || (vb ? vb[2] : 0);
  const height = num(svg.attrs.height, vb ? vb[3] : 0, vb ? vb[3] : undefined) || (vb ? vb[3] : 0);
  const viewBox = vb ? { x: vb[0], y: vb[1], width: vb[2], height: vb[3] } : { x: 0, y: 0, width, height };
  if (!(viewBox.width > 0 && viewBox.height > 0)) errors.push('missing size: no viewBox and no width / height');

  const gradients = parseGradients(byId);
  const prefixedGradients: Record<string, Gradient> = {};
  for (const [k, g] of Object.entries(gradients)) prefixedGradients[`${ID_PREFIX}${k}`] = { ...g, id: `${ID_PREFIX}${k}` };

  const DEF_TAGS = new Set(['linearGradient', 'radialGradient', 'pattern', 'clipPath', 'mask', 'filter', 'marker']);
  const NON_RENDER = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'symbol', ...DEF_TAGS]);
  const stats = { shapes: 0, groups: 0, raw: 0, segments: 0, maxDepth: 0, clips: 0, masks: 0, gradients: Object.keys(gradients).length };
  let auto = 0;
  const used = new Set<string>();
  const nextId = (el: XmlElement) => {
    let id = el.attrs.id ? el.attrs.id : `${el.name}-${++auto}`;
    while (used.has(id)) id = `${el.attrs.id || el.name}-${++auto}`;
    used.add(id);
    return id;
  };

  const ownTransform = (el: XmlElement) => parseTransform(el.attrs.transform);
  const refOf = (v: string | undefined) => {
    const r = paintRef(v);
    return r ? `${ID_PREFIX}${r}` : undefined;
  };

  const walk = (el: XmlElement, inherited: Inherited, depth: number, useDepth: number, extra?: Mat): VNode | null => {
    if (el.attrs.display === 'none') return null;
    const st: Inherited = { ...inherited };
    for (const k of INHERITED) if (el.attrs[k] !== undefined && el.attrs[k] !== 'inherit') st[k] = el.attrs[k];
    if (st.visibility === 'hidden' && !['g', 'svg', 'a', 'switch'].includes(el.name)) return null;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    let transform = ownTransform(el);
    if (extra) transform = multiply(extra, transform);
    const base = {
      id: nextId(el),
      ...(el.attrs.id || el.attrs['inkscape:label'] || el.attrs['data-name'] ? { name: el.attrs['data-name'] ?? el.attrs['inkscape:label'] ?? el.attrs.id } : {}),
      transform,
      opacity: Math.min(1, Math.max(0, Number(el.attrs.opacity ?? 1))),
      ...(refOf(el.attrs['clip-path']) ? { clipPath: refOf(el.attrs['clip-path']) } : {}),
      ...(refOf(el.attrs.mask) ? { mask: refOf(el.attrs.mask) } : {}),
      ...(refOf(el.attrs.filter) ? { filter: refOf(el.attrs.filter) } : {}),
    };
    if (base.clipPath) stats.clips++;
    if (base.mask) stats.masks++;
    const group = (children: VNode[], t: Mat = base.transform): VGroup => {
      stats.groups++;
      const bounds = unionBox(children.map((c) => transformBox(c.bounds, c.transform)));
      return { type: 'group', ...base, transform: t, children, bounds };
    };
    const kids = (parent: XmlElement, d = depth + 1) => elements(parent).map((c) => walk(c, st, d, useDepth)).filter((x): x is VNode => Boolean(x));

    switch (el.name) {
      case 'g':
      case 'a':
        return group(kids(el));
      case 'switch': {
        const first = elements(el).find((c) => !NON_RENDER.has(c.name));
        return group(first ? [walk(first, st, depth + 1, useDepth)].filter((x): x is VNode => Boolean(x)) : []);
      }
      case 'svg': {
        // nested viewport: position + its own viewBox
        const w = num(el.attrs.width, viewBox.width, viewBox.width);
        const h = num(el.attrs.height, viewBox.height, viewBox.height);
        const m = multiply(translate(num(el.attrs.x, 0, viewBox.width), num(el.attrs.y, 0, viewBox.height)), viewBoxMatrix(nums(el.attrs.viewBox).length === 4 ? nums(el.attrs.viewBox) : null, w, h, el.attrs.preserveAspectRatio));
        return group(kids(el), multiply(base.transform, m));
      }
      case 'use': {
        const href = el.attrs.href ?? el.attrs['xlink:href'];
        const target = href?.startsWith('#') ? byId.get(href.slice(1)) : undefined;
        if (!target || useDepth > 8) {
          warnings.add(target ? '<use> nested too deep' : `<use> points to a missing element (${href ?? 'no href'})`);
          return null;
        }
        const at = translate(num(el.attrs.x, 0, viewBox.width), num(el.attrs.y, 0, viewBox.height));
        if (target.name === 'symbol') {
          const vbS = nums(target.attrs.viewBox);
          const w = num(el.attrs.width ?? target.attrs.width, vbS[2] ?? 0);
          const h = num(el.attrs.height ?? target.attrs.height, vbS[3] ?? 0);
          const inner = elements(target).map((c) => walk(c, st, depth + 2, useDepth + 1)).filter((x): x is VNode => Boolean(x));
          return group(inner, multiply(base.transform, multiply(at, viewBoxMatrix(vbS.length === 4 ? vbS : null, w, h, target.attrs.preserveAspectRatio))));
        }
        const inner = walk({ ...target, attrs: { ...target.attrs, id: '' } }, st, depth + 1, useDepth + 1);
        return group(inner ? [inner] : [], multiply(base.transform, at));
      }
      case 'path':
      case 'rect':
      case 'circle':
      case 'ellipse':
      case 'line':
      case 'polyline':
      case 'polygon': {
        const raw = shapePath(el, viewBox.width, viewBox.height);
        if (!raw) return null;
        const subs = parsePath(raw);
        if (!subs.length) return null;
        const paint = paintOf(st);
        if (el.name === 'line' || el.name === 'polyline') paint.fill = el.name === 'line' ? 'none' : paint.fill;
        const segments = segmentCount(subs);
        stats.shapes++;
        stats.segments += segments;
        const d = normalizePath(raw);
        return { type: 'shape', ...base, tag: el.name, d, paint, length: r3(pathLength(subs)), segments, bounds: subsBounds(subs) };
      }
      case 'text':
      case 'image': {
        if (el.name === 'text') warnings.add('text is drawn with the viewer\'s fonts: convert text to outlines for exact type');
        stats.raw++;
        // inherited paint and type written onto the element itself (it is rendered outside its groups' style)
        const attrs: Record<string, string> = { ...el.attrs };
        for (const k of INHERITED) if (st[k] !== undefined && attrs[k] === undefined) attrs[k] = st[k];
        delete attrs.transform;
        const xml = serialize(prefixIds({ ...el, attrs }));
        const x = num(el.attrs.x, 0, viewBox.width);
        const y = num(el.attrs.y, 0, viewBox.height);
        const w = el.name === 'image' ? num(el.attrs.width, 0, viewBox.width) : num(st['font-size'], 16) * 4;
        const h = el.name === 'image' ? num(el.attrs.height, 0, viewBox.height) : num(st['font-size'], 16);
        return { type: 'raw', ...base, tag: el.name, xml, bounds: el.name === 'image' ? { x, y, width: w, height: h } : { x, y: y - h, width: w, height: h } };
      }
      default:
        if (!NON_RENDER.has(el.name) && el.name !== '#document') warnings.add(`<${el.name}> is not drawn`);
        return null;
    }
  };

  const rootKids = elements(svg)
    .map((c) => walk(c, {}, 1, 0))
    .filter((x): x is VNode => Boolean(x));
  const root: VGroup = { type: 'group', id: 'root', transform: [...IDENTITY], opacity: Math.min(1, Math.max(0, Number(svg.attrs.opacity ?? 1))), children: rootKids, bounds: unionBox(rootKids.map((c) => transformBox(c.bounds, c.transform))) };

  // defs kept as SVG: every def-type element, wherever it was declared
  const defs: string[] = [];
  const collectDefs = (el: XmlElement) => {
    for (const c of elements(el)) {
      if (DEF_TAGS.has(c.name)) defs.push(serialize(prefixIds(c)));
      else collectDefs(c);
    }
  };
  collectDefs(svg);
  if (!stats.shapes && !stats.raw) errors.push('nothing to draw: no shapes found');
  if (stats.segments > 20000) warnings.add(`${stats.segments} path segments: heavy to animate (simplify, or it is drawn as a still)`);

  return { version: VECTOR_DOC_VERSION, viewBox, width: r3(width), height: r3(height), root, defs: defs.join(''), gradients: prefixedGradients, stats, warnings: [...warnings], errors };
}

/** Axis-aligned bounds of a box after a transform. */
export function transformBox(b: Box, m: Mat): Box {
  if (b.width === 0 && b.height === 0 && b.x === 0 && b.y === 0) return b;
  const pts = [apply(m, { x: b.x, y: b.y }), apply(m, { x: b.x + b.width, y: b.y }), apply(m, { x: b.x, y: b.y + b.height }), apply(m, { x: b.x + b.width, y: b.y + b.height })];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Shapes in drawing order, each with its accumulated (world) matrix. */
export function flattenDoc(doc: VectorDoc): { shape: VShape; world: Mat; path: string[] }[] {
  const out: { shape: VShape; world: Mat; path: string[] }[] = [];
  const walk = (n: VNode, m: Mat, path: string[]) => {
    const w = multiply(m, n.transform);
    if (n.type === 'shape') out.push({ shape: n, world: w, path });
    else if (n.type === 'group') for (const c of n.children) walk(c, w, [...path, n.id]);
  };
  walk(doc.root, [...IDENTITY], []);
  return out;
}

/** A shape's path in document (viewBox) coordinates. */
export const worldPath = (shape: VShape, world: Mat) => transformSubs(parsePath(shape.d), world);

/** Vector complexity for the effect budget: segments + clips/masks/filters weighted. */
export const docComplexity = (d: VectorDoc) => Math.round(d.stats.segments + d.stats.shapes * 2 + d.stats.clips * 20 + d.stats.masks * 30 + d.stats.raw * 4);
