/**
 * Shape library for the Morphing Engine: geometric primitives, organic blobs
 * (seeded, deterministic), UI/story shapes, Lucide icons (ISC) as paths, and
 * SVG primitives (circle/rect/ellipse/line/polyline/polygon) → path data.
 * Every generator returns an SVG path string in a `size × size` box.
 */
import { icons } from 'lucide-react';
import { createRng } from '../core/rng';
import { pointsToPath, type P2 } from './path';

const f = (v: number) => (Math.round(v * 100) / 100).toString();

export function circlePath(cx: number, cy: number, r: number): string {
  // four arcs → cubic in the parser (start at the top so rings align naturally)
  return `M${f(cx)} ${f(cy - r)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 0 1 ${f(cx)} ${f(cy + r)}A${f(r)} ${f(r)} 0 0 1 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 0 1 ${f(cx)} ${f(cy - r)}Z`;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx)} ${f(cy - ry)}A${f(rx)} ${f(ry)} 0 0 1 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 0 1 ${f(cx)} ${f(cy + ry)}A${f(rx)} ${f(ry)} 0 0 1 ${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 0 1 ${f(cx)} ${f(cy - ry)}Z`;
}

export function roundRectPath(x: number, y: number, w: number, h: number, r = 0): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!rr) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  return `M${f(x + rr)} ${f(y)}H${f(x + w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y + rr)}V${f(y + h - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${f(y + h)}H${f(x + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y + h - rr)}V${f(y + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${f(y)}Z`;
}

export function polygonPath(cx: number, cy: number, r: number, sides: number, rot = -Math.PI / 2): string {
  const pts: P2[] = Array.from({ length: sides }, (_, i) => ({ x: cx + r * Math.cos(rot + (i / sides) * Math.PI * 2), y: cy + r * Math.sin(rot + (i / sides) * Math.PI * 2) }));
  return pointsToPath(pts);
}

export function starPath(cx: number, cy: number, r: number, points = 5, inner = 0.45): string {
  const pts: P2[] = Array.from({ length: points * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * inner : r;
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) };
  });
  return pointsToPath(pts);
}

/**
 * Organic blob: a closed smooth curve through `n` seeded radii around a centre.
 * `phase` animates the blob (liquid motion) while staying periodic and seeded.
 */
export function blobPath(cx: number, cy: number, r: number, seed: string | number, opts: { n?: number; wobble?: number; phase?: number } = {}): string {
  const n = opts.n ?? 7;
  const wob = opts.wobble ?? 0.22;
  const rng = createRng(`blob:${seed}`).next;
  const base = Array.from({ length: n }, () => ({ k: 1 - wob / 2 + rng() * wob, w: 0.5 + rng() * 1.5, ph: rng() * Math.PI * 2 }));
  const ph = opts.phase ?? 0;
  const pts: P2[] = base.map((b, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rr = r * (b.k + Math.sin(ph * b.w + b.ph) * wob * 0.35);
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) };
  });
  // closed Catmull-Rom → cubic Béziers (smooth body)
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d + 'Z';
}

/** Named story shapes in a size×size box (centred). */
export function shapePath(name: string, size = 100, seed: string | number = 1): string {
  const c = size / 2;
  const r = size * 0.42;
  switch (name) {
    case 'circle':
      return circlePath(c, c, r);
    case 'square':
      return roundRectPath(c - r, c - r, 2 * r, 2 * r, 0);
    case 'rounded':
    case 'card':
      return roundRectPath(c - r, c - r * 0.7, 2 * r, 1.4 * r, r * 0.18);
    case 'squircle':
      return roundRectPath(c - r, c - r, 2 * r, 2 * r, r * 0.45);
    case 'pill':
      return roundRectPath(c - r, c - r * 0.42, 2 * r, 0.84 * r, r * 0.42);
    case 'phone':
      return roundRectPath(c - r * 0.5, c - r, r, 2 * r, r * 0.16);
    case 'triangle':
      return polygonPath(c, c + r * 0.12, r, 3);
    case 'diamond':
      return polygonPath(c, c, r, 4);
    case 'hexagon':
      return polygonPath(c, c, r, 6);
    case 'star':
      return starPath(c, c, r, 5);
    case 'burst':
      return starPath(c, c, r, 12, 0.72);
    case 'heart': {
      const s = r / 40;
      const ox = c - 40 * s;
      const oy = c - 36 * s;
      const p = (x: number, y: number) => `${f(ox + x * s)} ${f(oy + y * s)}`;
      return `M${p(40, 72)}C${p(12, 52)} ${p(0, 36)} ${p(0, 22)}C${p(0, 8)} ${p(10, 0)} ${p(22, 0)}C${p(30, 0)} ${p(36, 4)} ${p(40, 10)}C${p(44, 4)} ${p(50, 0)} ${p(58, 0)}C${p(70, 0)} ${p(80, 8)} ${p(80, 22)}C${p(80, 36)} ${p(68, 52)} ${p(40, 72)}Z`;
    }
    case 'drop':
      return `M${f(c)} ${f(c - r)}C${f(c + r * 0.6)} ${f(c - r * 0.2)} ${f(c + r * 0.75)} ${f(c + r * 0.25)} ${f(c + r * 0.62)} ${f(c + r * 0.55)}A${f(r * 0.66)} ${f(r * 0.66)} 0 0 1 ${f(c - r * 0.62)} ${f(c + r * 0.55)}C${f(c - r * 0.75)} ${f(c + r * 0.25)} ${f(c - r * 0.6)} ${f(c - r * 0.2)} ${f(c)} ${f(c - r)}Z`;
    case 'bubble':
      return `${roundRectPath(c - r, c - r * 0.7, 2 * r, 1.25 * r, r * 0.3).replace(/Z$/, '')}Z M${f(c - r * 0.45)} ${f(c + r * 0.5)}L${f(c - r * 0.7)} ${f(c + r * 0.95)}L${f(c - r * 0.1)} ${f(c + r * 0.55)}Z`;
    case 'arrow':
      return pointsToPath([
        { x: c - r, y: c - r * 0.22 },
        { x: c + r * 0.15, y: c - r * 0.22 },
        { x: c + r * 0.15, y: c - r * 0.6 },
        { x: c + r, y: c },
        { x: c + r * 0.15, y: c + r * 0.6 },
        { x: c + r * 0.15, y: c + r * 0.22 },
        { x: c - r, y: c + r * 0.22 },
      ]);
    case 'check':
      return pointsToPath([
        { x: c - r * 0.75, y: c },
        { x: c - r * 0.45, y: c - r * 0.3 },
        { x: c - r * 0.15, y: c + r * 0.05 },
        { x: c + r * 0.55, y: c - r * 0.65 },
        { x: c + r * 0.85, y: c - r * 0.35 },
        { x: c - r * 0.15, y: c + r * 0.65 },
      ]);
    case 'blob':
    default:
      return blobPath(c, c, r, seed);
  }
}

export const SHAPE_NAMES = ['circle', 'square', 'rounded', 'card', 'squircle', 'pill', 'phone', 'triangle', 'diamond', 'hexagon', 'star', 'burst', 'heart', 'drop', 'bubble', 'arrow', 'check', 'blob'] as const;

// ── SVG primitives and icons → paths ─────────────────────────────────────────────

type SvgNode = [string, Record<string, string | number>];

/** One SVG primitive element as path data. */
export function elementToPath(tag: string, a: Record<string, string | number>): string {
  const n = (k: string, d = 0) => Number(a[k] ?? d);
  switch (tag) {
    case 'path':
      // a standalone path's leading relative 'm' is measured from the origin: make it absolute so
      // the element stays put when joined with the icon's other elements into one path
      return String(a.d ?? '').replace(/^\s*m/, 'M0 0m');
    case 'circle':
      return circlePath(n('cx'), n('cy'), n('r'));
    case 'ellipse':
      return ellipsePath(n('cx'), n('cy'), n('rx'), n('ry'));
    case 'rect':
      return roundRectPath(n('x'), n('y'), n('width'), n('height'), n('rx', n('ry')));
    case 'line':
      return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline':
    case 'polygon': {
      const nums = String(a.points ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      const pts: P2[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
      return pointsToPath(pts, tag === 'polygon');
    }
    default:
      return '';
  }
}

/** A Lucide icon (by PascalCase or kebab name) as one compound path in its 24×24 box. */
export function iconPath(name: string): string | null {
  // kebab-case or single lowercase word ('rocket') → Lucide's PascalCase export ('Rocket')
  const key = name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
  const Comp = (icons as Record<string, unknown>)[key] as { render?: (p: object, r: null) => { props: { iconNode: SvgNode[] } } } | undefined;
  const node = Comp?.render?.({}, null)?.props?.iconNode;
  if (!node) return null;
  return node
    .map(([tag, attrs]) => elementToPath(tag, attrs))
    .filter(Boolean)
    .join(' ');
}
