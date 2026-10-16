/**
 * Visual Hierarchy Engine (P2-B).
 *
 * Two views of the same shot:
 *  - the INTENDED hierarchy, from the script: primary / secondary / supporting / background /
 *    decorative tiers (cast roles + what each element is);
 *  - the SEEN hierarchy, from what the browser drew (a DOM probe sample): a dominance score per
 *    element from seven factors — area, scale, contrast, position (RTL reading start), depth,
 *    motion, isolation — never area alone. Sorting by dominance gives the first / second / third read.
 *
 * "role: hero" is a claim; dominance is the evidence. A hero that is not the first read, or wins it
 * by a hair, fails the hierarchy no matter what the metadata says.
 * Pure (no node APIs).
 */
import type { StagePlan, StageElement } from './plan';
import type { StageProbeSample } from '../qc/stage-probes';

export type Tier = 'primary' | 'secondary' | 'supporting' | 'background' | 'decorative';

export interface DominanceFactors {
  area: number;
  scale: number;
  contrast: number;
  position: number;
  depth: number;
  motion: number;
  isolation: number;
}

export interface SeenElement {
  id: string;
  kind: string;
  tier: Tier;
  /** Frame fraction covered (clipped to the frame). */
  area: number;
  factors: DominanceFactors;
  score: number;
}

export interface SeenHierarchy {
  shot: string;
  t: number;
  elements: SeenElement[];
  readOrder: string[];
  hero: string | null;
  /** 1 = the hero is the first read. 0 = the hero is not on screen. */
  heroRank: number;
  /** Hero dominance ÷ the strongest other element (≥ 1.3: a clear hero). */
  margin: number;
  /** Rows of similar objects (same kind, similar size): the "row of small cards" pattern. */
  groups: { ids: string[]; kind: string; sizeSpread: number; meanArea: number }[];
}

/** How much each factor counts (they sum to 1). Area matters most, never alone. */
export const DOMINANCE_WEIGHTS: DominanceFactors = { area: 0.3, scale: 0.16, contrast: 0.14, position: 0.12, depth: 0.08, motion: 0.08, isolation: 0.12 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
type Rect = { x: number; y: number; width: number; height: number };

/** The tier an element plays in a shot (intended hierarchy). */
export function tierOf(el: Pick<StageElement, 'kind' | 'content'>, role: string | undefined, isSubject: boolean): Tier {
  if (isSubject || role === 'hero') return 'primary';
  if (role === 'background') return 'background';
  if (role === 'secondary') return 'secondary';
  const hasCopy = Boolean(el.content.text || el.content.title);
  if ((el.kind === 'shape' || el.kind === 'line' || el.kind === 'icon' || el.kind === 'cursor') && !hasCopy) return 'decorative';
  return 'supporting';
}

/** The intended hierarchy of every shot (tiers + the reading order the script asks for). */
export function intendedHierarchy(plan: StagePlan): { shot: string; tiers: { id: string; tier: Tier }[] }[] {
  return plan.shots.map((s) => ({
    shot: s.id,
    tiers: (s.cast ?? [])
      .filter((c) => !plan.elements.find((e) => e.id === c.id)?.parent)
      .map((c) => {
        const el = plan.elements.find((e) => e.id === c.id)!;
        return { id: c.id, tier: tierOf(el, c.role, s.composition.subject === c.id) };
      }),
  }));
}

/** Contrast of an element against the world it sits on (heuristic: from its kind and colour token). */
export function contrastOf(el: Pick<StageElement, 'kind' | 'content'>): number {
  const c = String(el.content.color ?? '');
  const coloured = c === 'primary' || c === 'accent' || c.startsWith('#');
  switch (el.kind) {
    case 'text':
      return el.content.role === 'caption' || el.content.role === 'body' ? 0.6 : 0.9;
    case 'number':
    case 'button':
      return 0.9;
    case 'shape':
      return coloured || !c ? 0.8 : 0.45;
    case 'card':
      return coloured ? 0.8 : 0.42; // a white card on a light world is a quiet surface
    case 'chip':
      return coloured ? 0.7 : 0.45;
    case 'ui':
      return 0.6;
    case 'image':
      return 0.7;
    case 'line':
      return 0.55;
    default:
      return 0.5;
  }
}

const clipArea = (r: Rect, W: number, H: number) => (Math.max(0, Math.min(r.x + r.width, W) - Math.max(r.x, 0)) * Math.max(0, Math.min(r.y + r.height, H) - Math.max(r.y, 0))) / (W * H);
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const gapBetween = (a: Rect, b: Rect) => {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.hypot(dx, dy);
};

/** Rows of similar objects on screen: ≥ 3 top-level elements of one kind whose sizes differ < 35%. */
export function similarGroups(els: { id: string; kind: string; area: number }[], min = 3): SeenHierarchy['groups'] {
  const byKind = new Map<string, typeof els>();
  for (const e of els) if (e.area > 0.002) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  const out: SeenHierarchy['groups'] = [];
  for (const [kind, list] of byKind) {
    if (list.length < min || kind === 'text') continue;
    const areas = list.map((e) => e.area);
    const spread = Math.max(...areas) / Math.max(1e-6, Math.min(...areas));
    if (spread < 1.35 * 1.35) out.push({ ids: list.map((e) => e.id), kind, sizeSpread: r3(Math.sqrt(spread)), meanArea: r3(areas.reduce((a, b) => a + b, 0) / areas.length) });
  }
  return out;
}

/**
 * The seen hierarchy of one shot at one sample (usually its settle frame). `prev` (a sample a little
 * earlier) lets the motion factor see what is moving.
 */
export function seenHierarchy(plan: StagePlan, shotId: string, sample: StageProbeSample, opts: { W: number; H: number; rtl: boolean; prev?: StageProbeSample }): SeenHierarchy {
  const { W, H, rtl } = opts;
  const shot = plan.shots.find((s) => s.id === shotId)!;
  const roleOf = (id: string) => shot.cast?.find((c) => c.id === id)?.role;
  const byId = new Map(plan.elements.map((e) => [e.id, e]));
  // what is on screen: top-level, visible, not a full-frame world backdrop
  const vis = sample.els.filter((e) => !e.parent && e.opacity > 0.3 && byId.has(e.id) && clipArea(e.rect, W, H) > 0.0005 && !(e.kind === 'shape' && e.rect.width >= W * 0.98 && e.rect.height >= H * 0.98));
  const maxSide = Math.max(1e-6, ...vis.map((e) => Math.sqrt(clipArea(e.rect, W, H))));
  const textPx = new Map<string, number>();
  for (const t of sample.texts ?? []) if (t.opacity > 0.3) textPx.set(t.el, Math.max(textPx.get(t.el) ?? 0, t.px));
  const elements: SeenElement[] = vis.map((e) => {
    const el = byId.get(e.id)!;
    const area = clipArea(e.rect, W, H);
    const cx = (e.rect.x + e.rect.width / 2) / W;
    const cy = (e.rect.y + e.rect.height / 2) / H;
    const others = vis.filter((o) => o.id !== e.id);
    const covered = others.reduce((a, o) => a + overlapArea(e.rect, o.rect), 0) / Math.max(1, e.rect.width * e.rect.height);
    const nearest = others.length ? Math.min(...others.map((o) => gapBetween(e.rect, o.rect))) / Math.hypot(W, H) : 0.2;
    const pe = opts.prev?.els.find((x) => x.id === e.id);
    const moved = pe ? Math.hypot(pe.rect.x - e.rect.x, pe.rect.y - e.rect.y) / Math.hypot(W, H) + Math.abs(Math.log(Math.max(1, e.rect.width) / Math.max(1, pe.rect.width))) : 0;
    const centrality = clamp01(1 - Math.hypot(cx - 0.5, cy - 0.45) / 0.7);
    const readingStart = rtl ? cx : 1 - cx;
    const depthTrack = e.z ?? 0;
    const factors: DominanceFactors = {
      area: clamp01(Math.sqrt(area) / 0.62),
      // text: its rendered type size; anything else: its size relative to the largest thing on screen
      scale: textPx.has(e.id) ? clamp01(textPx.get(e.id)! / H / 0.11) : clamp01(Math.sqrt(area) / maxSide),
      contrast: contrastOf(el),
      position: clamp01(0.6 * centrality + 0.4 * clamp01(0.15 + readingStart * 0.85) * (1 - 0.35 * clamp01((cy - 0.55) / 0.45))),
      depth: clamp01(0.8 - depthTrack * 1.3),
      motion: clamp01(moved * 40),
      isolation: clamp01(1 - covered) * (0.55 + 0.45 * clamp01(nearest / 0.05)),
    };
    const score = (Object.keys(DOMINANCE_WEIGHTS) as (keyof DominanceFactors)[]).reduce((a, k) => a + DOMINANCE_WEIGHTS[k] * factors[k], 0);
    return { id: e.id, kind: e.kind, tier: tierOf(el, roleOf(e.id), shot.composition.subject === e.id), area: r3(area), factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, r3(v)])) as unknown as DominanceFactors, score: r3(score) };
  });
  elements.sort((a, b) => b.score - a.score);
  const readOrder = elements.filter((e) => e.kind !== 'cursor').map((e) => e.id);
  const hero = shot.composition.subject ?? null;
  const heroRank = hero ? readOrder.indexOf(hero) + 1 : 0;
  const hs = elements.find((e) => e.id === hero)?.score ?? 0;
  const best = elements.filter((e) => e.id !== hero && e.kind !== 'cursor')[0]?.score ?? 0;
  const margin = hs > 0 ? r3(best > 0 ? hs / best : 3) : 0;
  return { shot: shotId, t: sample.t, elements, readOrder, hero, heroRank, margin, groups: similarGroups(elements) };
}
