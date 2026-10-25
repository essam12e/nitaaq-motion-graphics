/**
 * Composition Engine (P1-B): where each element of a shot sits and how big it is.
 *
 * Not "scale everything up": the hero gets a size from the shot size × the subject type (a logo
 * resolve is small on purpose, a dashboard wide shot is big, kinetic type dominates), the reading
 * direction decides which side text takes (RTL: text starts on the right, the visual answers on the
 * left), secondary elements take the complementary column, supports orbit the hero in the free
 * space without covering it, background elements are large and quiet. Negative space is left on the
 * side the next shot's energy will travel to (lead room).
 *
 * Everything is in canvas fractions (x, y = centre). Pure and deterministic.
 */
import type { StageKind } from '../director/shot-script';

export type ShotSize = 'wide' | 'medium' | 'close' | 'extreme-close' | 'insert' | 'hero' | 'detail';
export type CastRole = 'hero' | 'secondary' | 'support' | 'background';
export type SubjectType = 'text' | 'ui' | 'image' | 'product' | 'logo' | 'card' | 'number' | 'button' | 'shape' | 'line' | 'small';

export interface Box {
  /** Centre (fractions of the canvas, or of the region / parent box). */
  x: number;
  y: number;
  /** Size (fractions of the canvas width / height). */
  w: number;
  h: number;
}

export interface ComposeElement {
  id: string;
  kind: StageKind;
  role: CastRole;
  /** Pixel aspect (w / h) of the element's box. */
  aspect: number;
  /** Asset kind for image elements (logo, product, screenshot …). */
  assetKind?: string;
  /** Explicit placement from the script (wins). */
  at?: { x: number; y: number };
  w?: number;
  /** Characters of text (text / chip / button), for the text box shape. */
  chars?: number;
}

export interface ComposeInput {
  W: number;
  H: number;
  /** Safe area (fractions of the canvas). */
  safe: { x: number; y: number; w: number; h: number };
  rtl: boolean;
  shotSize: ShotSize;
  purpose: string;
  elements: ComposeElement[];
  /** Direction the energy leaves this shot to (lead room is kept on that side). */
  exitDirection?: 'left' | 'right' | 'up' | 'down' | 'in' | 'out';
  /** Composition strategy (P2-C, shot.composition). Absent / "centered": the P1 layout. */
  strategy?: string;
  /** Style Library v2: × the hero's linear size (a luxury hero isolated small, a sport hero breaking the frame). Absent → 1. */
  heroScale?: number;
}

export interface CompositionReport {
  subject: string | null;
  subjectType: SubjectType | null;
  shotSize: ShotSize;
  /** Target hero occupancy (fraction of the frame area) for this shot size × subject type. */
  target: [number, number];
  heroOccupancy: number;
  /** Union of the non-background boxes (approx., boxes may overlap). */
  totalOccupancy: number;
  readingOrder: string[];
  layout: string;
  leadRoom?: string;
  notes: string[];
}

/**
 * Hero occupancy targets (fraction of the frame AREA covered by the hero's box) by subject × shot size.
 * Deliberately different per subject: a logo resolve stays small, type and interfaces fill.
 */
export const OCCUPANCY: Record<SubjectType, Record<ShotSize, [number, number]>> = {
  text: { wide: [0.12, 0.24], medium: [0.18, 0.32], close: [0.28, 0.45], 'extreme-close': [0.4, 0.6], insert: [0.25, 0.4], hero: [0.3, 0.5], detail: [0.25, 0.4] },
  ui: { wide: [0.3, 0.45], medium: [0.42, 0.58], close: [0.55, 0.75], 'extreme-close': [0.7, 0.9], insert: [0.5, 0.7], hero: [0.5, 0.68], detail: [0.55, 0.75] },
  image: { wide: [0.12, 0.22], medium: [0.2, 0.32], close: [0.3, 0.48], 'extreme-close': [0.45, 0.65], insert: [0.3, 0.45], hero: [0.32, 0.5], detail: [0.3, 0.45] },
  product: { wide: [0.14, 0.24], medium: [0.24, 0.36], close: [0.36, 0.52], 'extreme-close': [0.5, 0.7], insert: [0.35, 0.5], hero: [0.38, 0.55], detail: [0.35, 0.5] },
  logo: { wide: [0.03, 0.07], medium: [0.06, 0.12], close: [0.12, 0.22], 'extreme-close': [0.2, 0.32], insert: [0.1, 0.18], hero: [0.1, 0.18], detail: [0.1, 0.18] },
  card: { wide: [0.08, 0.16], medium: [0.14, 0.24], close: [0.24, 0.4], 'extreme-close': [0.38, 0.55], insert: [0.2, 0.32], hero: [0.22, 0.36], detail: [0.2, 0.32] },
  number: { wide: [0.06, 0.12], medium: [0.1, 0.18], close: [0.18, 0.3], 'extreme-close': [0.28, 0.42], insert: [0.15, 0.25], hero: [0.2, 0.32], detail: [0.15, 0.25] },
  button: { wide: [0.02, 0.05], medium: [0.04, 0.08], close: [0.08, 0.14], 'extreme-close': [0.14, 0.22], insert: [0.07, 0.12], hero: [0.06, 0.1], detail: [0.07, 0.12] },
  shape: { wide: [0.04, 0.1], medium: [0.08, 0.16], close: [0.16, 0.28], 'extreme-close': [0.28, 0.45], insert: [0.12, 0.22], hero: [0.14, 0.24], detail: [0.12, 0.22] },
  line: { wide: [0.12, 0.25], medium: [0.2, 0.35], close: [0.3, 0.5], 'extreme-close': [0.45, 0.65], insert: [0.25, 0.4], hero: [0.25, 0.4], detail: [0.25, 0.4] },
  small: { wide: [0.004, 0.012], medium: [0.008, 0.02], close: [0.015, 0.035], 'extreme-close': [0.03, 0.06], insert: [0.015, 0.035], hero: [0.015, 0.035], detail: [0.015, 0.035] },
};

export function subjectTypeOf(kind: StageKind, assetKind?: string): SubjectType {
  if (kind === 'image') return assetKind === 'logo' ? 'logo' : assetKind === 'product' ? 'product' : assetKind === 'screenshot' ? 'ui' : 'image';
  if (kind === 'chip' || kind === 'icon' || kind === 'cursor') return 'small';
  if (kind === 'ui') return 'ui';
  return kind as SubjectType;
}

/** Default pixel aspect (w / h) of an element box. */
export function defaultAspect(kind: StageKind, chars = 0, assetAspect?: number): number {
  switch (kind) {
    case 'text':
      return chars <= 10 ? 3.2 : chars <= 22 ? 4.2 : chars <= 40 ? 3.4 : 2.6;
    case 'ui':
      return (assetAspect ?? 1.6) * 0.94; // browser chrome adds a bar on top
    case 'image':
      return assetAspect ?? 1;
    case 'card':
      return 1.3;
    case 'chip':
      return Math.max(2.2, Math.min(5, 1.4 + chars * 0.28));
    case 'button':
      return Math.max(2.6, Math.min(5.5, 1.6 + chars * 0.3));
    case 'number':
      return 1.5;
    case 'line':
      return 1.9;
    default:
      return 1;
  }
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const mid = (r: [number, number]) => (r[0] + r[1]) / 2;

/** Width fraction that gives a box of `area` (frame fraction) at pixel aspect `a`. */
export function widthForArea(area: number, a: number, W: number, H: number): number {
  return Math.sqrt((area * a * H) / W);
}

export const heightOf = (w: number, a: number, W: number, H: number) => (w * W) / a / H;

function overlap(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2));
  const y = Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
  return x * y;
}

/** Area of the union of boxes (sampled on a grid; boxes clipped to the frame). */
export function unionArea(boxes: Box[], n = 80): number {
  if (!boxes.length) return 0;
  let hit = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const px = (i + 0.5) / n;
      const py = (j + 0.5) / n;
      if (boxes.some((b) => Math.abs(px - b.x) <= b.w / 2 && Math.abs(py - b.y) <= b.h / 2)) hit++;
    }
  return hit / (n * n);
}

/**
 * Compose one shot. Returns a box per element and a report of the decisions (subject, target
 * occupancy, reading order, lead room).
 */
export function composeShot(input: ComposeInput): { boxes: Record<string, Box>; report: CompositionReport } {
  const strat = input.strategy ? resolveStrategy(input.strategy) : null;
  if (strat && strat !== 'centered') return scaleHero(input, composeStrategy(input, strat));
  if (input.heroScale && input.heroScale !== 1) return scaleHero(input, composeShot({ ...input, heroScale: undefined }));
  const { W, H, safe, rtl, shotSize } = input;
  const landscape = W / H > 1.05;
  const notes: string[] = [];
  const boxes: Record<string, Box> = {};
  const els = input.elements;
  const hero = els.find((e) => e.role === 'hero') ?? els.find((e) => e.role !== 'background' && e.role !== 'support') ?? null;
  const subjectType = hero ? subjectTypeOf(hero.kind, hero.assetKind) : null;
  const target: [number, number] = subjectType ? OCCUPANCY[subjectType][shotSize] : [0, 0];
  const secondaries = els.filter((e) => e.role === 'secondary');
  const supports = els.filter((e) => e.role === 'support');
  const backgrounds = els.filter((e) => e.role === 'background');
  const start = rtl ? 1 : -1; // +1: the reading start is on the right
  const textLed = hero?.kind === 'text';
  const sx0 = safe.x;
  const sx1 = safe.x + safe.w;
  const sy0 = safe.y;
  const sy1 = safe.y + safe.h;
  let layout = 'single';

  const place = (e: ComposeElement, box: Box) => {
    // keep inside the safe area (an explicit `at` from the script is trusted)
    if (!e.at) {
      const hw = Math.min(box.w, safe.w) / 2;
      const hh = Math.min(box.h, safe.h) / 2;
      box.x = Math.min(sx1 - hw, Math.max(sx0 + hw, box.x));
      box.y = Math.min(sy1 - hh, Math.max(sy0 + hh, box.y));
    }
    boxes[e.id] = { x: r4(box.x), y: r4(box.y), w: r4(box.w), h: r4(box.h) };
  };

  const sizeFor = (e: ComposeElement, area: number, maxW: number, maxH: number): { w: number; h: number } => {
    let w = e.w ?? widthForArea(area, e.aspect, W, H);
    let h = heightOf(w, e.aspect, W, H);
    if (!e.w) {
      if (w > maxW) {
        w = maxW;
        // text reflows: a column narrower than its natural line takes the area in height (more lines)
        h = e.kind === 'text' ? Math.max(heightOf(w, e.aspect, W, H), Math.min(area / w, (w * W) / H / 1.15)) : heightOf(w, e.aspect, W, H);
      }
      if (h > maxH) {
        h = maxH;
        w = (h * H * e.aspect) / W;
      }
    }
    return { w, h };
  };

  // ── hero (+ the main secondary): one column, or two columns in reading order
  const main2 = secondaries[0];
  if (hero) {
    const heroArea = mid(target);
    if (main2 && landscape) {
      layout = textLed ? 'text-start / visual-end' : main2.kind === 'text' ? 'visual-end / text-start' : 'two columns';
      // text takes the reading-start column; the hero column is wider
      const heroCol = (textLed ? 0.46 : 0.56) * safe.w;
      const secCol = safe.w - heroCol - 0.04;
      const heroOnStart = textLed || main2.kind !== 'text';
      const heroSign = heroOnStart ? start : -start;
      const hs = sizeFor(hero, heroArea, heroCol, safe.h * 0.86);
      const hx = 0.5 + heroSign * (safe.w / 2 - heroCol / 2);
      place(hero, hero.at ? { ...hero.at, ...hs } : { x: hx, y: 0.5, ...hs });
      const secType = subjectTypeOf(main2.kind, main2.assetKind);
      const secArea = Math.min(heroArea * 0.8, mid(OCCUPANCY[secType][shotSize]));
      const ss = sizeFor(main2, secArea, secCol, safe.h * 0.8);
      const sx = 0.5 - heroSign * (safe.w / 2 - secCol / 2);
      place(main2, main2.at ? { ...main2.at, ...ss } : { x: sx, y: 0.5, ...ss });
    } else if (main2) {
      layout = 'stacked';
      const top = textLed ? hero : main2;
      const bottom = textLed ? main2 : hero;
      const hs = sizeFor(hero, heroArea, safe.w * 0.92, safe.h * 0.5);
      const ss = sizeFor(main2, mid(OCCUPANCY[subjectTypeOf(main2.kind, main2.assetKind)][shotSize]) * 0.8, safe.w * 0.92, safe.h * 0.4);
      const tb = top === hero ? hs : ss;
      const bb = bottom === hero ? hs : ss;
      const gap = 0.04;
      const total = tb.h + bb.h + gap;
      const y0 = 0.5 - total / 2;
      place(top, top.at ? { ...top.at, ...tb } : { x: 0.5, y: y0 + tb.h / 2, ...tb });
      place(bottom, bottom.at ? { ...bottom.at, ...bb } : { x: 0.5, y: y0 + tb.h + gap + bb.h / 2, ...bb });
    } else {
      const hs = sizeFor(hero, heroArea, safe.w * 0.9, safe.h * 0.86);
      // a lone headline sits on the reading-start side of centre (it reads as type, not as a centred slide)
      const lean = textLed && landscape ? start * Math.min(0.06, (safe.w - hs.w) / 2) : 0;
      place(hero, hero.at ? { ...hero.at, ...hs } : { x: 0.5 + lean, y: 0.5, ...hs });
      layout = textLed && lean ? 'single (reading-start lean)' : 'single';
    }
  }

  // ── further secondaries: a row under the hero / main pair
  const rest2 = secondaries.slice(hero && main2 ? 1 : 0);
  if (rest2.length) {
    const taken = Object.values(boxes);
    const bottomY = taken.length ? Math.max(...taken.map((b) => b.y + b.h / 2)) : 0.5;
    const n = rest2.length;
    const colW = (safe.w * 0.92) / n;
    rest2.forEach((e, i) => {
      const t = subjectTypeOf(e.kind, e.assetKind);
      const s = sizeFor(e, mid(OCCUPANCY[t][shotSize]) * 0.7, colW * 0.9, Math.max(0.12, sy1 - bottomY - 0.04));
      // reading order: the first item on the reading-start side
      const k = rtl ? n - 1 - i : i;
      const x = sx0 + safe.w * 0.04 + colW * (k + 0.5);
      place(e, e.at ? { ...e.at, ...s } : { x, y: Math.min(sy1 - s.h / 2, bottomY + 0.035 + s.h / 2), ...s });
    });
    layout += ` + row of ${n}`;
  }

  // ── supports: around the hero, in the free space, never on top of it
  const anchor = hero && boxes[hero.id] ? boxes[hero.id] : { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
  supports.forEach((e, i) => {
    const s = sizeFor(e, mid(OCCUPANCY[subjectTypeOf(e.kind, e.assetKind)][shotSize]), safe.w * 0.3, safe.h * 0.25);
    if (e.at) return place(e, { ...e.at, ...s });
    const n = supports.length;
    let best: Box | null = null;
    let bestCost = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + (i / Math.max(1, n)) * 0.7;
      for (const ring of [0.62, 0.8, 1]) {
        const rx = (anchor.w / 2 + s.w / 2 + 0.03) * ring + 0.04;
        const ry = (anchor.h / 2 + s.h / 2 + 0.03) * ring + 0.03;
        const c: Box = { x: anchor.x + Math.cos(a) * rx * (1 + 0.3 * ring), y: anchor.y + Math.sin(a) * ry * (1 + 0.3 * ring), ...s };
        const out = Math.max(0, sx0 - (c.x - c.w / 2)) + Math.max(0, c.x + c.w / 2 - sx1) + Math.max(0, sy0 - (c.y - c.h / 2)) + Math.max(0, c.y + c.h / 2 - sy1);
        const cover = Object.values(boxes).reduce((acc, b) => acc + overlap(b, c), 0);
        // spread supports round the hero; prefer the side the energy is NOT leaving to (lead room)
        const lead = input.exitDirection === 'left' && c.x < anchor.x ? 0.002 : input.exitDirection === 'right' && c.x > anchor.x ? 0.002 : 0;
        const cost = cover * 40 + out * 10 + lead + Math.abs(ring - 0.8) * 0.001;
        if (cost < bestCost) {
          bestCost = cost;
          best = c;
        }
      }
    }
    place(e, best!);
  });

  // ── backgrounds: large, centred behind everything
  for (const e of backgrounds) {
    const w = e.w ?? 0.9;
    place(e, { x: e.at?.x ?? 0.5, y: e.at?.y ?? 0.5, w, h: heightOf(w, e.aspect, W, H) });
  }

  // ── report
  const readingOrder = els
    .filter((e) => e.role !== 'background' && boxes[e.id])
    .slice()
    .sort((a, b) => {
      const A = boxes[a.id];
      const B = boxes[b.id];
      if (Math.abs(A.y - B.y) > 0.18) return A.y - B.y;
      return rtl ? B.x - A.x : A.x - B.x;
    })
    .map((e) => e.id);
  const heroBox = hero ? boxes[hero.id] : null;
  const heroOccupancy = heroBox ? r4(Math.min(1, heroBox.w) * Math.min(1, heroBox.h)) : 0;
  const totalOccupancy = r4(unionArea(els.filter((e) => e.role !== 'background' && boxes[e.id]).map((e) => boxes[e.id])));
  if (hero && heroOccupancy < target[0] * 0.95) notes.push(`hero ${hero.id} fills ${Math.round(heroOccupancy * 100)}% (target ${Math.round(target[0] * 100)}–${Math.round(target[1] * 100)}%): limited by its column / explicit size`);
  for (const s of secondaries) {
    const b = boxes[s.id];
    if (heroBox && b && b.w * b.h > heroBox.w * heroBox.h * 1.05) notes.push(`secondary ${s.id} is larger than the hero — check the hierarchy`);
  }
  const leadRoom = input.exitDirection && input.exitDirection !== 'in' && input.exitDirection !== 'out' ? `energy leaves ${input.exitDirection}: supports kept off that side` : undefined;
  return { boxes, report: { subject: hero?.id ?? null, subjectType, shotSize, target, heroOccupancy, totalOccupancy, readingOrder, layout, leadRoom, notes } };
}

// ═════════════════════════════ P2-C: composition strategies ═════════════════════════════
/**
 * A strategy is a way of ORGANISING a shot, not a scene template: it takes whatever elements the
 * shot already has (any kind, any count) and decides who leads, how big, where the rest go and what
 * stays free. The Re-Director chooses one when the critic shows the P1 layout failing
 * (e.g. a row of equal small cards); the script names it in `shot.composition`.
 */
export const STRATEGIES = ['centered', 'hero-focus', 'asymmetric-split', 'split', 'stack', 'card-cascade', 'spatial-cluster', 'focus-sequence', 'center-stage', 'full-frame-typography', 'ui-zoom', 'timeline-flow', 'radial', 'cta-lockup'] as const;
export type Strategy = (typeof STRATEGIES)[number];
/** Names from the direction vocabulary that are performed by an existing strategy (+ timing from the Re-Director). */
export const STRATEGY_ALIASES: Record<string, Strategy> = {
  'focus-supporting': 'hero-focus',
  'focus+supporting': 'hero-focus',
  carousel: 'focus-sequence',
  'progressive-reveal': 'focus-sequence',
  'before-after': 'split',
  'detail-insert': 'ui-zoom',
  'edge-to-center': 'center-stage',
  'hero-first': 'hero-focus',
};
/** Style-native strategies (Style Library v2): performed here, chosen by a style's composition grammar (not offered to the Re-Director). */
export const STYLE_STRATEGIES = ['grid-flush', 'iso-diorama', 'scatter', 'axis-center', 'diagonal'] as const;
export type StyleStrategy = (typeof STYLE_STRATEGIES)[number];
export function resolveStrategy(name: string): Strategy | StyleStrategy | null {
  if ((STRATEGIES as readonly string[]).includes(name)) return name as Strategy;
  if ((STYLE_STRATEGIES as readonly string[]).includes(name)) return name as StyleStrategy;
  return STRATEGY_ALIASES[name] ?? null;
}

function sizeBox(e: ComposeElement, area: number, maxW: number, maxH: number, W: number, H: number): { w: number; h: number } {
  let w = widthForArea(area, e.aspect, W, H);
  let h = heightOf(w, e.aspect, W, H);
  if (w > maxW) {
    w = maxW;
    h = e.kind === 'text' ? Math.max(heightOf(w, e.aspect, W, H), Math.min(area / w, (w * W) / H / 1.15)) : heightOf(w, e.aspect, W, H);
  }
  if (h > maxH) {
    h = maxH;
    w = e.kind === 'text' ? Math.min(maxW, Math.max(w, (h * H * e.aspect) / W)) : (h * H * e.aspect) / W;
  }
  return { w, h };
}

/** Style Library v2: the style's hero scale (centre kept, clamped to the safe area). */
function scaleHero(input: ComposeInput, r: { boxes: Record<string, Box>; report: CompositionReport }): { boxes: Record<string, Box>; report: CompositionReport } {
  const k = input.heroScale;
  const id = r.report.subject;
  if (!k || k === 1 || !id || !r.boxes[id]) return r;
  const b = r.boxes[id];
  const fit = Math.min(k, (input.safe.w * 1.0) / Math.max(1e-4, b.w), (input.safe.h * 1.0) / Math.max(1e-4, b.h));
  const f = Math.max(0.5, k > 1 ? Math.max(1, fit) : k);
  const w = b.w * f;
  const h = b.h * f;
  // the scaled hero stays inside the safe area (its centre moves in if an edge would leave it)
  const cx = Math.min(Math.max(b.x, input.safe.x + w / 2), input.safe.x + input.safe.w - w / 2);
  const cy = Math.min(Math.max(b.y, input.safe.y + h / 2), input.safe.y + input.safe.h - h / 2);
  const nb = { ...b, x: r4(w <= input.safe.w ? cx : b.x), y: r4(h <= input.safe.h ? cy : b.y), w: r4(w), h: r4(h) };
  const boxes = { ...r.boxes, [id]: nb };
  return { boxes, report: { ...r.report, heroOccupancy: r4(Math.min(1, nb.w) * Math.min(1, nb.h)), notes: [...r.report.notes, `style hero scale ×${r4(f)}`] } };
}

function composeStrategy(input: ComposeInput, strat: Strategy | StyleStrategy): { boxes: Record<string, Box>; report: CompositionReport } {
  const { W, H, safe, rtl, shotSize } = input;
  const landscape = W / H > 1.05;
  const notes: string[] = [`strategy: ${strat}`];
  const boxes: Record<string, Box> = {};
  const els = input.elements;
  const hero = els.find((e) => e.role === 'hero') ?? els.find((e) => e.role !== 'background' && e.role !== 'support') ?? els[0] ?? null;
  const subjectType = hero ? subjectTypeOf(hero.kind, hero.assetKind) : null;
  const target: [number, number] = subjectType ? OCCUPANCY[subjectType][shotSize] : [0, 0];
  const start = rtl ? 1 : -1;
  const sx0 = safe.x;
  const sx1 = safe.x + safe.w;
  const sy0 = safe.y;
  const sy1 = safe.y + safe.h;
  // the cursor and explicitly placed elements are not re-organised (the script placed them on purpose)
  const fixed = els.filter((e) => e !== hero && (e.kind === 'cursor' || e.at));
  const backgrounds = els.filter((e) => e.role === 'background' && !fixed.includes(e));
  const rest = els.filter((e) => e !== hero && !fixed.includes(e) && !backgrounds.includes(e));
  // reading order of the rest: secondaries first, then supports, script order inside each
  rest.sort((a, b) => (a.role === b.role ? 0 : a.role === 'secondary' ? -1 : b.role === 'secondary' ? 1 : 0));
  const texts = rest.filter((e) => e.kind === 'text');
  const things = rest.filter((e) => e.kind !== 'text');
  const place = (e: ComposeElement, b: Box) => {
    const hw = Math.min(b.w, safe.w) / 2;
    const hh = Math.min(b.h, safe.h) / 2;
    const x = Math.min(sx1 - hw, Math.max(sx0 + hw, b.x));
    const y = Math.min(sy1 - hh, Math.max(sy0 + hh, b.y));
    boxes[e.id] = { x: r4(x), y: r4(y), w: r4(b.w), h: r4(b.h) };
  };
  const areaOf = (e: ComposeElement, size: ShotSize = shotSize) => mid(OCCUPANCY[subjectTypeOf(e.kind, e.assetKind)][size]);
  const hiArea = (e: ComposeElement, size: ShotSize = shotSize) => OCCUPANCY[subjectTypeOf(e.kind, e.assetKind)][size][1];
  /** Stack `list` vertically inside a column (centre x, width cw), filling [ya, yb]. */
  const column = (list: ComposeElement[], cx: number, cw: number, ya: number, yb: number, areaK: number) => {
    if (!list.length) return;
    const gap = 0.035;
    const slot = (yb - ya - gap * (list.length - 1)) / list.length;
    const sizes = list.map((e) => sizeBox(e, Math.max(areaOf(e) * areaK, 0.004), cw, slot, W, H));
    const total = sizes.reduce((a, s) => a + s.h, 0) + gap * (list.length - 1);
    let y = (ya + yb) / 2 - total / 2;
    list.forEach((e, i) => {
      place(e, { x: cx, y: y + sizes[i].h / 2, ...sizes[i] });
      y += sizes[i].h + gap;
    });
  };
  /** A horizontal row of `list` across [xa, xb] in reading order, centred on y. */
  const row = (list: ComposeElement[], xa: number, xb: number, y: number, maxH: number, areaFor: (e: ComposeElement) => number) => {
    if (!list.length) return;
    const gap = 0.025;
    const slot = (xb - xa - gap * (list.length - 1)) / list.length;
    list.forEach((e, i) => {
      const s = sizeBox(e, areaFor(e), slot, maxH, W, H);
      const k = rtl ? list.length - 1 - i : i;
      place(e, { x: xa + k * (slot + gap) + slot / 2, y, ...s });
    });
  };
  const notHero = (l: ComposeElement[]) => l.filter((e) => e !== hero);
  let layout: string = strat;

  if (hero) {
    switch (strat) {
      case 'hero-focus':
      case 'focus-sequence':
      case 'asymmetric-split':
      case 'split': {
        // the hero owns the reading-start column; the rest is an ordered supporting column
        const share = strat === 'split' ? 0.5 : strat === 'asymmetric-split' ? 0.6 : 0.62;
        if (landscape) {
          const heroCol = safe.w * share - 0.02;
          const restCol = safe.w - heroCol - 0.04;
          const hx = 0.5 + start * (safe.w / 2 - heroCol / 2);
          const rx = 0.5 - start * (safe.w / 2 - restCol / 2);
          const ha = strat === 'split' ? areaOf(hero) : Math.max(hiArea(hero), areaOf(hero, 'close'));
          // a headline among the rest goes with the hero (above it) when the hero is not text
          const headline = hero.kind !== 'text' ? texts[0] : undefined;
          let hy0 = sy0;
          if (headline) {
            const hs = sizeBox(headline, areaOf(headline), heroCol, safe.h * 0.2, W, H);
            place(headline, { x: hx, y: sy0 + hs.h / 2, ...hs });
            hy0 = sy0 + hs.h + 0.03;
          }
          const hs = sizeBox(hero, ha, heroCol, sy1 - hy0, W, H);
          place(hero, { x: hx, y: (hy0 + sy1) / 2, ...hs });
          const side = notHero(rest).filter((e) => e !== headline);
          const k = strat === 'split' ? 0.9 : strat === 'asymmetric-split' ? 0.7 : 0.5;
          column(side, rx, restCol, sy0 + 0.04, sy1 - 0.04, k);
          layout = `${strat}: hero ${Math.round(share * 100)}% column (reading start), ${side.length} in the supporting column`;
        } else {
          const hs = sizeBox(hero, Math.max(hiArea(hero), areaOf(hero, 'close')), safe.w * 0.92, safe.h * 0.55, W, H);
          place(hero, { x: 0.5, y: sy0 + hs.h / 2 + 0.02, ...hs });
          row(notHero(rest), sx0, sx1, Math.min(sy1 - 0.12, sy0 + hs.h + 0.16), safe.h * 0.25, (e) => areaOf(e) * 0.6);
          layout = `${strat}: hero on top, supporting row below`;
        }
        break;
      }
      case 'stack': {
        // tiers top to bottom: a headline (when the hero is not text), the hero, then the rest; same-kind
        // things share ONE row tier (five cards are a row under the headline, never a column of five)
        const head = hero.kind !== 'text' && texts.length ? texts[0] : undefined;
        const others = rest.filter((e) => e !== head);
        const tiers: ComposeElement[][] = [];
        if (head) tiers.push([head]);
        tiers.push([hero]);
        const byKind = new Map<string, ComposeElement[]>();
        for (const e of others) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
        for (const e of others) {
          const g = byKind.get(e.kind)!;
          if (g.length >= 2) {
            if (g[0] === e) tiers.push(g);
          } else tiers.push([e]);
        }
        const gap = 0.035;
        const avail = safe.h - gap * (tiers.length - 1);
        const heroH = tiers.length === 1 ? avail : avail * (tiers.length === 2 ? 0.55 : 0.45);
        const otherH = tiers.length === 1 ? 0 : (avail - heroH) / (tiers.length - 1);
        const sized = tiers.map((t) => {
          const isHero = t.includes(hero);
          const maxH = isHero ? heroH : otherH;
          if (t.length === 1) return [sizeBox(t[0], isHero ? hiArea(t[0]) : areaOf(t[0]) * 0.7, safe.w * 0.9, maxH, W, H)];
          const slot = (safe.w * 0.92 - 0.025 * (t.length - 1)) / t.length;
          return t.map((e) => sizeBox(e, areaOf(e) * 0.7, slot, maxH, W, H));
        });
        const tierH = sized.map((ss) => Math.max(...ss.map((x) => x.h)));
        const total = tierH.reduce((a, h) => a + h, 0) + gap * (tiers.length - 1);
        let y = 0.5 - total / 2;
        tiers.forEach((t, i) => {
          const cy = y + tierH[i] / 2;
          if (t.length === 1) place(t[0], { x: 0.5, y: cy, ...sized[i][0] });
          else {
            const ws = sized[i].map((x) => x.w);
            const rowW = ws.reduce((a, w) => a + w, 0) + 0.025 * (t.length - 1);
            let x = 0.5 - rowW / 2;
            t.forEach((e, j) => {
              const idx = rtl ? t.length - 1 - j : j;
              const w = ws[idx];
              place(t[idx], { x: x + w / 2, y: cy, ...sized[i][idx] });
              x += w + 0.025;
            });
          }
          y += tierH[i] + gap;
        });
        layout = `stack: ${tiers.map((t) => (t.length > 1 ? `row of ${t.length}` : t[0] === hero ? 'hero' : t[0].kind)).join(' / ')}`;
        break;
      }
      case 'card-cascade': {
        // a fanned deck: the hero in front and largest, the others step back toward the reading end
        const deck = [hero, ...things];
        const hs = sizeBox(hero, Math.max(hiArea(hero), areaOf(hero, 'close')), safe.w * 0.5, safe.h * 0.72, W, H);
        const cx = 0.5 + start * safe.w * 0.12;
        place(hero, { x: cx, y: 0.54, ...hs });
        deck.slice(1).forEach((e, i) => {
          const k = 0.8 - i * 0.12;
          const s = sizeBox(e, hs.w * hs.h * k * k, hs.w * k, hs.h * k, W, H);
          place(e, { x: cx - start * (hs.w * 0.62 + i * hs.w * 0.42), y: 0.5 - (i + 1) * 0.06, ...s });
        });
        if (texts.length) row(texts, sx0, sx1, sy1 - 0.06, 0.12, (e) => areaOf(e) * 0.6);
        layout = `card cascade: hero front, ${deck.length - 1} stepping back`;
        break;
      }
      case 'spatial-cluster':
      case 'radial':
      case 'center-stage': {
        const big = strat === 'center-stage' ? Math.max(hiArea(hero), areaOf(hero, 'close')) : hiArea(hero);
        const hs = sizeBox(hero, big, safe.w * (strat === 'radial' ? 0.4 : 0.6), safe.h * (strat === 'radial' ? 0.45 : 0.62), W, H);
        place(hero, { x: 0.5, y: strat === 'center-stage' && texts.length ? 0.46 : 0.5, ...hs });
        if (strat === 'center-stage') {
          row(notHero(rest), sx0 + 0.05, sx1 - 0.05, Math.min(sy1 - 0.07, 0.5 + hs.h / 2 + 0.11), safe.h * 0.16, (e) => areaOf(e) * 0.45);
        } else {
          const list = notHero(rest);
          const n = list.length;
          list.forEach((e, i) => {
            const s = sizeBox(e, areaOf(e) * (strat === 'radial' ? 0.55 : 0.6), safe.w * 0.26, safe.h * 0.24, W, H);
            const a = (strat === 'radial' ? -Math.PI / 2 : -Math.PI / 3) + (i / Math.max(1, n)) * Math.PI * 2 * (rtl ? 1 : -1);
            const rx = hs.w / 2 + s.w / 2 + 0.04;
            const ry = hs.h / 2 + s.h / 2 + 0.04;
            place(e, { x: 0.5 + Math.cos(a) * rx, y: 0.5 + Math.sin(a) * ry, ...s });
          });
        }
        break;
      }
      case 'full-frame-typography': {
        const hs = sizeBox(hero, hero.kind === 'text' ? OCCUPANCY.text['extreme-close'][0] : hiArea(hero), safe.w * 0.94, safe.h * 0.62, W, H);
        place(hero, { x: 0.5, y: 0.47, ...hs });
        row(notHero(rest), sx0 + 0.1, sx1 - 0.1, Math.min(sy1 - 0.06, 0.47 + hs.h / 2 + 0.1), safe.h * 0.14, (e) => areaOf(e) * 0.4);
        break;
      }
      case 'ui-zoom': {
        const hs = sizeBox(hero, Math.max(hiArea(hero), areaOf(hero, 'close')), safe.w, safe.h * 0.92, W, H);
        place(hero, { x: 0.5, y: 0.5, ...hs });
        const list = notHero(rest);
        list.forEach((e, i) => {
          const s = sizeBox(e, areaOf(e) * 0.5, safe.w * 0.22, safe.h * 0.16, W, H);
          place(e, { x: 0.5 - start * (safe.w / 2 - s.w / 2), y: sy0 + s.h / 2 + i * (s.h + 0.03), ...s });
        });
        break;
      }
      case 'timeline-flow': {
        // items of the flow in reading order across the frame, as large as the row allows;
        // a line (if any) runs through them; a headline sits above
        const line = [hero, ...rest].find((e) => e.kind === 'line');
        const items = [hero, ...things].filter((e) => e !== line);
        const headline = texts[0];
        const top = headline ? sy0 + 0.16 : sy0;
        if (headline) {
          const hs = sizeBox(headline, areaOf(headline), safe.w * 0.8, 0.14, W, H);
          place(headline, { x: 0.5, y: sy0 + hs.h / 2, ...hs });
        }
        const cy = (top + sy1) / 2;
        const maxH = (sy1 - top) * 0.82;
        const n = items.length;
        const gap = 0.03;
        const slot = (safe.w - gap * (n - 1)) / n;
        items.forEach((e, i) => {
          const s = sizeBox(e, 0.5, slot, maxH * (e === hero && hero.kind !== 'line' ? 1 : 0.92), W, H);
          const k = rtl ? n - 1 - i : i;
          // a gentle wave keeps the row from reading as a table
          place(e, { x: sx0 + k * (slot + gap) + slot / 2, y: cy + (i % 2 ? 0.04 : -0.03), ...s });
        });
        if (line) {
          const lw = safe.w * 0.96;
          place(line, { x: 0.5, y: cy, w: lw, h: heightOf(lw, line.aspect, W, H) });
        }
        texts.slice(1).forEach((t) => place(t, { x: 0.5, y: sy1 - 0.04, ...sizeBox(t, areaOf(t) * 0.5, safe.w * 0.6, 0.08, W, H) }));
        layout = `timeline flow: ${items.length} items across the frame in reading order${line ? ', the line through them' : ''}`;
        break;
      }
      case 'cta-lockup': {
        // one lock-up: the action line leads, the button sits under it, the brand signs above, the url closes
        const all = [hero, ...rest];
        const ctaText = all.find((e) => e.kind === 'text' && e.role !== 'support') ?? all.find((e) => e.kind === 'text');
        const button = all.find((e) => e.kind === 'button');
        const logo = all.find((e) => e.kind === 'image' && e.assetKind === 'logo');
        const small = all.filter((e) => e !== ctaText && e !== button && e !== logo);
        const parts: { e: ComposeElement; s: { w: number; h: number } }[] = [];
        if (logo) parts.push({ e: logo, s: sizeBox(logo, OCCUPANCY.logo.close[0], safe.w * 0.2, safe.h * 0.16, W, H) });
        if (ctaText) parts.push({ e: ctaText, s: sizeBox(ctaText, OCCUPANCY.text.close[1], safe.w * 0.86, safe.h * 0.32, W, H) });
        if (button) parts.push({ e: button, s: sizeBox(button, OCCUPANCY.button.close[1], safe.w * 0.4, safe.h * 0.15, W, H) });
        for (const e of small) parts.push({ e, s: sizeBox(e, areaOf(e) * 0.35, safe.w * 0.4, safe.h * 0.07, W, H) });
        const gap = 0.04;
        const total = parts.reduce((a, p) => a + p.s.h, 0) + gap * (parts.length - 1);
        let y = 0.5 - total / 2;
        for (const p of parts) {
          place(p.e, { x: 0.5, y: y + p.s.h / 2, ...p.s });
          y += p.s.h + gap;
        }
        layout = `CTA lock-up: ${parts.map((p) => p.e.id).join(' / ')}`;
        break;
      }
      case 'grid-flush': {
        // Swiss grid: 6 columns, everything flush to the reading-start edge, edges on column lines, a giant hero next to small notes
        const cols = 6;
        const gut = 0.012;
        const cw = (safe.w - gut * (cols - 1)) / cols;
        const span = (n: number) => n * cw + (n - 1) * gut;
        const flush = (w: number, offsetCols = 0) => (rtl ? sx1 - (offsetCols ? span(offsetCols) + gut : 0) - w / 2 : sx0 + (offsetCols ? span(offsetCols) + gut : 0) + w / 2);
        const notes2 = notHero(rest);
        // landscape keeps at least two free columns for the notes (a text hero takes 4 of 6)
        const heroCols = !landscape ? 6 : notes2.length ? 4 : 6;
        const hs = sizeBox(hero, Math.max(hiArea(hero), areaOf(hero, 'close')), span(heroCols), safe.h * (landscape ? 0.78 : 0.5), W, H);
        const hw = Math.min(hs.w, span(heroCols));
        place(hero, { x: flush(hw), y: sy0 + hs.h / 2 + safe.h * 0.04, w: hw, h: hs.h });
        if (landscape) {
          // the notes run down the remaining columns, baseline-aligned from the bottom
          const restCols = cols - heroCols;
          const cwR = span(restCols);
          let y = sy1;
          [...notes2].reverse().forEach((e) => {
            const s = sizeBox(e, areaOf(e) * 0.45, cwR, safe.h * 0.22, W, H);
            place(e, { x: flush(s.w, heroCols), y: y - s.h / 2, ...s });
            y -= s.h + 0.03;
          });
        } else {
          // portrait: notes stack under the hero on the start columns, small, a 3-column measure
          let y = sy0 + hs.h + safe.h * 0.1;
          notes2.forEach((e, i) => {
            const n = e.kind === 'text' ? 4 : 3;
            const s = sizeBox(e, areaOf(e) * 0.5, span(n), safe.h * 0.16, W, H);
            place(e, { x: flush(s.w, i % 2 && e.kind !== 'text' ? 3 : 0), y: y + s.h / 2, ...s });
            if (!(i % 2 === 0 && notes2[i + 1] && notes2[i + 1].kind !== 'text' && e.kind !== 'text')) y += s.h + 0.03;
          });
        }
        layout = `grid-flush: 6-column grid, hero ${heroCols} columns flush to the reading start, ${notes2.length} notes on the grid`;
        break;
      }
      case 'iso-diorama': {
        // an isometric diorama: the hero on the floor centre, the rest on the iso axes around it (30°), labels above
        const hs = sizeBox(hero, hiArea(hero) * 0.8, safe.w * 0.48, safe.h * 0.4, W, H);
        const cy = 0.56;
        place(hero, { x: 0.5, y: cy, ...hs });
        const list = notHero(things);
        const c30 = Math.cos(Math.PI / 6);
        const slots: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [-2, 0], [2, 0], [0, 2]];
        list.forEach((e, i) => {
          const [a, b] = slots[i % slots.length];
          const s = sizeBox(e, areaOf(e) * 0.45, safe.w * 0.24, safe.h * 0.18, W, H);
          const step = Math.max(hs.w, 0.22) * 0.55;
          const dx = (a - b) * c30 * step * (rtl ? -1 : 1);
          const dy = ((a + b) / 2) * step * (W / H) * 0.6;
          place(e, { x: 0.5 + dx, y: cy + dy, ...s });
        });
        texts.forEach((t, i) => place(t, { x: 0.5, y: sy0 + 0.06 + i * 0.09, ...sizeBox(t, areaOf(t) * 0.55, safe.w * 0.86, 0.12, W, H) }));
        layout = `iso diorama: hero on the floor centre, ${list.length} on the iso axes, ${texts.length} label(s) above`;
        break;
      }
      case 'scatter': {
        // a collage: the hero slightly off-centre, the rest scattered on a golden-angle spiral, overlapping a little
        const hs = sizeBox(hero, hiArea(hero), safe.w * 0.62, safe.h * 0.5, W, H);
        const hx = 0.5 + start * 0.05;
        const hy = 0.5;
        place(hero, { x: hx, y: hy, ...hs });
        const list = notHero(rest);
        list.forEach((e, i) => {
          const s = sizeBox(e, areaOf(e) * (e.kind === 'text' ? 0.55 : 0.5), safe.w * (e.kind === 'text' ? 0.7 : 0.3), safe.h * 0.2, W, H);
          const a = i * 2.39996 + (rtl ? 0.6 : 2.5);
          const r = 0.55 + (i % 3) * 0.12;
          place(e, { x: hx + Math.cos(a) * (hs.w / 2 + s.w / 2) * r, y: hy + Math.sin(a) * (hs.h / 2 + s.h / 2) * (r + 0.15), ...s });
        });
        layout = `scatter: hero off-centre, ${list.length} pieces scattered (golden angle) and overlapping`;
        break;
      }
      case 'axis-center': {
        // the centre axis: one isolated hero, large negative space, the copy small under it on the same axis
        const hs = sizeBox(hero, areaOf(hero) * 0.75, safe.w * 0.6, safe.h * 0.42, W, H);
        place(hero, { x: 0.5, y: texts.length ? 0.45 : 0.5, ...hs });
        let y = (texts.length ? 0.45 : 0.5) + hs.h / 2 + 0.07;
        for (const e of notHero(rest)) {
          const s = sizeBox(e, areaOf(e) * 0.4, safe.w * 0.62, safe.h * 0.1, W, H);
          place(e, { x: 0.5, y: y + s.h / 2, ...s });
          y += s.h + 0.035;
        }
        layout = 'axis-center: one hero on the centre axis, the rest small under it';
        break;
      }
      case 'diagonal': {
        // a 15–20° diagonal from the bottom of the reading start to the top of the reading end; the hero breaks it in the middle
        const hs = sizeBox(hero, hiArea(hero), safe.w * 0.7, safe.h * 0.48, W, H);
        place(hero, { x: 0.5, y: 0.5, ...hs });
        const list = notHero(rest);
        const n = list.length;
        list.forEach((e, i) => {
          const s = sizeBox(e, areaOf(e) * 0.5, safe.w * 0.4, safe.h * 0.16, W, H);
          const f = n === 1 ? 1 : i / (n - 1);
          const side = i % 2 ? 1 : -1;
          // start side low, end side high
          const t = side < 0 ? 0.15 + f * 0.1 : 0.75 + f * 0.1;
          const x = rtl ? sx1 - t * safe.w : sx0 + t * safe.w;
          const y = sy1 - t * safe.h * 0.9;
          place(e, { x, y, ...s });
        });
        layout = `diagonal: hero breaks a rising diagonal, ${n} along it`;
        break;
      }
      default:
        break;
    }
  }
  for (const e of fixed) {
    const s = e.w ? { w: e.w, h: heightOf(e.w, e.aspect, W, H) } : sizeBox(e, areaOf(e), safe.w * 0.3, safe.h * 0.25, W, H);
    boxes[e.id] = { x: r4(e.at?.x ?? 0.5), y: r4(e.at?.y ?? 0.5), w: r4(s.w), h: r4(s.h) };
  }
  for (const e of backgrounds) {
    const w = e.w ?? 0.9;
    boxes[e.id] = { x: 0.5, y: 0.5, w: r4(w), h: r4(heightOf(w, e.aspect, W, H)) };
  }
  for (const e of els) if (!boxes[e.id]) place(e, { x: 0.5, y: 0.5, ...sizeBox(e, areaOf(e) * 0.5, safe.w * 0.3, safe.h * 0.25, W, H) });
  const readingOrder = els
    .filter((e) => e.role !== 'background' && boxes[e.id])
    .slice()
    .sort((a, b) => {
      if (a === hero) return -1;
      if (b === hero) return 1;
      const A = boxes[a.id];
      const B = boxes[b.id];
      if (Math.abs(A.y - B.y) > 0.18) return A.y - B.y;
      return rtl ? B.x - A.x : A.x - B.x;
    })
    .map((e) => e.id);
  const heroBox = hero ? boxes[hero.id] : null;
  const heroOccupancy = heroBox ? r4(Math.min(1, heroBox.w) * Math.min(1, heroBox.h)) : 0;
  const totalOccupancy = r4(unionArea(els.filter((e) => e.role !== 'background' && boxes[e.id]).map((e) => boxes[e.id])));
  return { boxes, report: { subject: hero?.id ?? null, subjectType, shotSize, target, heroOccupancy, totalOccupancy, readingOrder, layout, notes } };
}
