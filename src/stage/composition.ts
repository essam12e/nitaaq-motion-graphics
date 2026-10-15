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
