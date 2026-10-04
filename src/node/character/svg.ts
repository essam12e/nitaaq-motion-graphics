/**
 * Layered SVG → Rig (node). Reads the artist's groups, maps their names to
 * logical parts, keeps the hierarchy (nesting, else anatomical defaults),
 * measures each part's real geometry by rasterising it alone (so transforms,
 * clip paths and strokes are all accounted for) and places joint pivots.
 *
 * Degrades gracefully: an SVG without recognisable part groups becomes a
 * "grouped" rig (one part — the whole artwork moves as one), never an error.
 * Manual pivots: data-pivot="x,y" on a group (viewBox units) wins over detection.
 */
import sharp from 'sharp';
import { parseXml, serialize, elements, type XmlElement } from '../../character/xml';
import { kindOf, stateOf, defaultParent, limitsOf } from '../../character/parts';
import type { Rig, RigPart } from '../../character/schema';

interface RawPart {
  id: string;
  kind: string;
  el: XmlElement;
  /** transforms of ancestor groups (outermost first) */
  ancestors: string[];
  nestedParent?: string;
  order: number;
  pivotAttr?: { x: number; y: number };
}

function viewBoxOf(svg: XmlElement): [number, number, number, number] {
  const vb = svg.attrs.viewBox ?? svg.attrs.viewbox;
  if (vb) {
    const n = vb.split(/[\s,]+/).map(Number);
    if (n.length === 4 && n.every(Number.isFinite)) return [n[0], n[1], n[2], n[3]];
  }
  const w = parseFloat(svg.attrs.width ?? '0');
  const h = parseFloat(svg.attrs.height ?? '0');
  if (w > 0 && h > 0) return [0, 0, w, h];
  throw new Error('SVG has neither a viewBox nor width/height');
}

const labelOf = (el: XmlElement) => el.attrs.id ?? el.attrs['inkscape:label'] ?? el.attrs['data-name'] ?? el.attrs['serif:id'] ?? '';

/** Markup of an element's children, excluding child part groups and state groups. */
function ownMarkup(el: XmlElement, isPart: (e: XmlElement) => boolean, isState: (e: XmlElement) => boolean): string {
  return el.children
    .filter((c) => c.type === 'text' || (!isPart(c) && !isState(c)))
    .map(serialize)
    .join('');
}

const wrap = (markup: string, transforms: string[]) => (transforms.length ? `<g transform="${transforms.join(' ')}">${markup}</g>` : markup);

/** Alpha bounding box of an SVG fragment in viewBox units (null when empty). */
export async function fragmentBBox(markup: string, defs: string, vb: [number, number, number, number], px = 600): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const k = px / Math.max(vb[2], vb[3]);
  const W = Math.max(8, Math.round(vb[2] * k));
  const H = Math.max(8, Math.round(vb[3] * k));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb.join(' ')}" width="${W}" height="${H}"><defs>${defs}</defs>${markup}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width;
  let y0 = info.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x: vb[0] + x0 / k, y: vb[1] + y0 / k, width: (x1 - x0 + 1) / k, height: (y1 - y0 + 1) / k };
}

type Box = { x: number; y: number; width: number; height: number };

/** Joint pivot per kind from the part's box (and its parent's box). */
export function pivotFor(kind: string, b: Box, parent: Box | undefined, centreX: number): { x: number; y: number } {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (kind === 'head') return { x: cx, y: b.y + b.height * 0.92 };
  if (kind === 'neck') return { x: cx, y: b.y + b.height };
  if (kind === 'torso') return { x: cx, y: b.y + b.height * 0.62 };
  if (kind === 'hips' || kind === 'legs') return { x: cx, y: b.y };
  if (/^(upperArm|arm)[LR]$/.test(kind)) {
    // shoulder: the end of the segment nearest the body's top
    if (b.height >= b.width) return { x: cx + (centreX - cx) * 0.12, y: b.y + Math.min(b.width * 0.45, b.height * 0.2) };
    const inner = Math.abs(b.x - centreX) < Math.abs(b.x + b.width - centreX) ? b.x : b.x + b.width;
    return { x: inner + (inner === b.x ? 1 : -1) * Math.min(b.height * 0.45, b.width * 0.2), y: cy };
  }
  if (/^(lowerArm|hand)[LR]$/.test(kind) && parent) {
    // elbow / wrist: the end nearest the parent segment's far end
    const ends = b.height >= b.width ? [{ x: cx, y: b.y + Math.min(b.width * 0.4, b.height * 0.15) }, { x: cx, y: b.y + b.height - Math.min(b.width * 0.4, b.height * 0.15) }] : [{ x: b.x + Math.min(b.height * 0.4, b.width * 0.15), y: cy }, { x: b.x + b.width - Math.min(b.height * 0.4, b.width * 0.15), y: cy }];
    const pc = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 };
    // the end farther from the parent's centre is not the joint
    ends.sort((p, q) => Math.hypot(p.x - pc.x, p.y - pc.y) - Math.hypot(q.x - pc.x, q.y - pc.y));
    return ends[0];
  }
  if (['headwear', 'hair', 'ears', 'eyes', 'eyebrows', 'mouth', 'nose', 'facialHair'].includes(kind)) return { x: cx, y: cy };
  return { x: cx, y: cy };
}

export interface SvgRigResult {
  rig: Rig;
  /** Logical parts found (for the manifest). */
  parts: string[];
  /** Full-art bounding box in viewBox units. */
  bbox: Box;
}

export async function svgToRig(source: string): Promise<SvgRigResult> {
  const doc = parseXml(source);
  const svg = elements(doc).find((e) => e.name === 'svg');
  if (!svg) throw new Error('not an SVG document');
  const vb = viewBoxOf(svg);
  const warnings: string[] = [];
  // shared defs + styles
  const defsParts: string[] = [];
  const collectDefs = (el: XmlElement) => {
    for (const c of elements(el)) {
      if (c.name === 'defs') defsParts.push(c.children.map(serialize).join(''));
      else if (c.name === 'style') defsParts.push(serialize(c));
      else if (c.name === 'g' || c.name === 'svg') collectDefs(c);
    }
  };
  collectDefs(svg);
  const defs = defsParts.join('');
  const isDefs = (e: XmlElement) => e.name === 'defs' || e.name === 'style' || e.name === 'title' || e.name === 'desc' || e.name === 'metadata' || e.name.startsWith('sodipodi:');

  // find part groups
  const raw: RawPart[] = [];
  const kindCount = new Map<string, number>();
  const partEls = new Set<XmlElement>();
  const stateEls = new Set<XmlElement>();
  let order = 0;
  const walk = (el: XmlElement, ancestors: string[], parentPart?: string) => {
    for (const c of elements(el)) {
      if (isDefs(c)) continue;
      if (c.name !== 'g') continue;
      const label = labelOf(c);
      const st = stateOf(label, c.attrs['data-state']);
      if (st && parentPart && (label.includes('--') || c.attrs['data-state'])) {
        stateEls.add(c);
        continue;
      }
      const kind = kindOf(label.replace(/--.*$/, ''));
      const t = c.attrs.transform ? [...ancestors, c.attrs.transform] : ancestors;
      if (kind) {
        const n = (kindCount.get(kind) ?? 0) + 1;
        kindCount.set(kind, n);
        const id = n === 1 ? kind : `${kind}${n}`;
        const pv = c.attrs['data-pivot']?.split(/[\s,]+/).map(Number);
        raw.push({ id, kind, el: c, ancestors: t, nestedParent: parentPart, order: order++, pivotAttr: pv && pv.length === 2 && pv.every(Number.isFinite) ? { x: pv[0], y: pv[1] } : undefined });
        partEls.add(c);
        walk(c, t, id);
      } else walk(c, t, parentPart);
    }
  };
  walk(svg, []);

  const isPart = (e: XmlElement) => partEls.has(e);
  const isState = (e: XmlElement) => stateEls.has(e);
  const hasKind = (k: string) => raw.some((r) => r.kind === k);
  const fullArms = (hasKind('upperArmL') && hasKind('lowerArmL')) || (hasKind('upperArmR') && hasKind('lowerArmR'));
  const mode: Rig['mode'] = raw.length === 0 ? 'grouped' : fullArms && hasKind('head') ? 'full' : 'partial';

  const whole = svg.children.filter((c) => c.type === 'text' || !isDefs(c as XmlElement)).map(serialize).join('');
  const bboxAll = (await fragmentBBox(whole, defs, vb)) ?? { x: vb[0], y: vb[1], width: vb[2], height: vb[3] };
  if (mode === 'grouped') {
    warnings.push('no recognisable part groups (head, torso, arms…) — the artwork moves as one piece (grouped transform mode)');
    const rig: Rig = {
      schema: 'nitaaq.rig/1',
      viewBox: vb,
      mode,
      defs,
      warnings,
      parts: [{ id: 'body', kind: 'torso', pivot: { x: bboxAll.x + bboxAll.width / 2, y: bboxAll.y + bboxAll.height }, z: 0, markup: whole, states: {}, bbox: bboxAll }],
    };
    return { rig, parts: [], bbox: bboxAll };
  }

  // markup outside every part group (outlines, shadows not named) stays attached to the root as a static part
  const leftover = (el: XmlElement, anc: string[]): string =>
    el.children
      .map((c) => {
        if (c.type === 'text') return '';
        if (isDefs(c) || isPart(c) || isState(c)) return '';
        if (c.name === 'g') {
          const inner = leftover(c, c.attrs.transform ? [...anc, c.attrs.transform] : anc);
          return inner;
        }
        return wrap(serialize(c), anc);
      })
      .join('');
  const loose = leftover(svg, []);

  const present = new Set(raw.map((r) => r.kind));
  const boxes = await Promise.all(
    raw.map(async (r) => {
      const markup = wrap(ownMarkup(r.el, isPart, isState), r.ancestors);
      const stateMarkups: Record<string, string> = {};
      for (const c of elements(r.el)) if (isState(c)) stateMarkups[stateOf(labelOf(c), c.attrs['data-state'])!] = wrap(c.children.map(serialize).join(''), c.attrs.transform ? [...r.ancestors, c.attrs.transform] : r.ancestors);
      const firstState = Object.values(stateMarkups)[0] ?? '';
      const box = (await fragmentBBox(markup + firstState, defs, vb)) ?? (await fragmentBBox(serialize(r.el), defs, vb));
      return { r, markup, stateMarkups, box };
    }),
  );
  const boxOf = new Map(boxes.map((b) => [b.r.id, b.box]));
  const torso = boxes.find((b) => b.r.kind === 'torso')?.box;
  const centreX = torso ? torso.x + torso.width / 2 : bboxAll.x + bboxAll.width / 2;
  const parts: RigPart[] = [];
  for (const b of boxes) {
    if (!b.box) {
      warnings.push(`part "${labelOf(b.r.el)}" is empty — skipped`);
      continue;
    }
    const parent = b.r.nestedParent ?? defaultParent(b.r.kind, present);
    const pBox = parent ? boxOf.get(parent) ?? undefined : undefined;
    const pivot = b.r.pivotAttr ?? pivotFor(b.r.kind, b.box, pBox, centreX);
    const states = b.stateMarkups;
    const prefOrder = ['relaxed', 'rest', 'default', 'neutral', 'normal', 'open', 'closed', 'hidden'];
    const defaultState = prefOrder.find((s) => s in states) ?? Object.keys(states).find((s) => ['relaxed', 'rest', 'open', 'neutral', 'normal', 'default', 'closed', 'hidden'].includes(s)) ?? Object.keys(states)[0];
    parts.push({
      id: b.r.id,
      kind: b.r.kind,
      parent: parent !== b.r.id ? parent : undefined,
      pivot: { x: Math.round(pivot.x * 100) / 100, y: Math.round(pivot.y * 100) / 100 },
      z: b.r.order,
      markup: b.markup,
      states,
      defaultState: b.r.kind === 'prop' ? undefined : defaultState,
      limits: limitsOf(b.r.kind),
      bbox: b.box,
    });
  }
  if (loose.trim()) {
    const box = await fragmentBBox(loose, defs, vb);
    if (box) parts.push({ id: 'unassigned', kind: 'other', z: -1, pivot: { x: box.x + box.width / 2, y: box.y + box.height }, markup: loose, states: {}, bbox: box });
    warnings.push('some artwork is outside named part groups; it stays fixed with the body');
  }
  // a prop with states only (e.g. phone--shown) is hidden unless a pose asks for it
  for (const p of parts) if (p.kind === 'prop' && !p.markup.trim() && Object.keys(p.states).length) p.defaultState = undefined;
  if (!hasKind('head')) warnings.push('no head group: head turns / tilts are not available (camera + pose motion only)');
  if (!fullArms) warnings.push('arms are not split into upper/lower segments: gestures use whole-arm rotation or prepared poses');
  return { rig: { schema: 'nitaaq.rig/1', viewBox: vb, mode, parts, defs, warnings }, parts: [...present], bbox: bboxAll };
}
