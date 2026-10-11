/**
 * Anti-Template System — two films from the same engine must not feel like the
 * same template with new words.
 *
 *   fingerprint   the film's structural DNA as a set of features: scene
 *                 family/variant sequence, cut vocabulary and order, camera
 *                 moves, background kinds, text-motion families, personality
 *   similarity    Jaccard between two fingerprints (0 = nothing shared, 1 = same)
 *   diversify     when a new film is too close to a recent one, vary the
 *                 non-semantic choices only, in order of safety:
 *                   1. cuts without a continuity/beat reason → another cut the
 *                      next scene prefers
 *                   2. camera moves → a sibling move of the same intent
 *                      (orbit-left ↔ orbit-right, push-in ↔ dolly-in, …)
 *                   3. scene variants → another variant the family recommends
 *                      for this aspect with at least the same text capacity
 *                 Content, story order, brand, product and timing never change.
 *
 * Pure and deterministic (the history is passed in; the node side stores it).
 */
import type { VideoSpec } from '../schema/video';
import { createRng } from '../core/rng';

export interface FilmFingerprint {
  id: string;
  at: string;
  features: string[];
}

export function fingerprint(spec: VideoSpec): string[] {
  const f = new Set<string>();
  const sc = spec.scenes;
  sc.forEach((s, i) => {
    f.add(`fam:${s.type}/${s.variant ?? ''}`);
    f.add(`seq:${i}:${s.type}/${s.variant ?? ''}`);
    if (s.transition?.type) {
      f.add(`cut:${s.transition.type}`);
      f.add(`cutseq:${i}:${s.transition.type}`);
    }
    const cam = s.motion.cameraPlan?.move ?? s.motion.camera;
    if (cam) f.add(`cam:${i}:${cam}`);
    if (s.background?.kind) f.add(`bg:${s.background.kind}`);
    for (const fam of Object.values(s.motion.text ?? {})) f.add(`text:${fam}`);
  });
  f.add(`style:${spec.style.preset}`);
  if (spec.motion?.personality) f.add(`personality:${spec.motion.personality}`);
  return [...f].sort();
}

export function similarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const B = new Set(b);
  const inter = a.filter((x) => B.has(x)).length;
  return inter / (a.length + b.length - inter);
}

export function nearest(features: string[], history: FilmFingerprint[]): { id: string | null; score: number } {
  let best = { id: null as string | null, score: 0 };
  for (const h of history) {
    const s = similarity(features, h.features);
    if (s > best.score) best = { id: h.id, score: Math.round(s * 1000) / 1000 };
  }
  return best;
}

/** Camera moves that serve the same intent (safe swaps). */
const CAMERA_SIBLINGS: string[][] = [
  ['orbit-left', 'orbit-right', 'arc'],
  ['push-in', 'dolly-in'],
  ['pull-out', 'dolly-out'],
  ['truck-left', 'pan-left'],
  ['truck-right', 'pan-right'],
  ['pedestal-up', 'tilt-up'],
];
/** Cuts chosen for a reason the film depends on are never swapped. */
const KEEP_REASON = /continuity|match|beat|shared|morph|hero|character|chapter|loop/i;

export interface VariationInfo {
  /** scene type → available variants for this aspect, with text capacity per variant. */
  variants: (type: string) => { list: string[]; capacity?: Record<string, number> } | null;
  /** scene type → transitions the family prefers. */
  preferredTransitions: (type: string) => string[];
}

export interface AntiTemplateReport {
  version: 1;
  threshold: number;
  historySize: number;
  before: { nearest: string | null; similarity: number };
  after: { nearest: string | null; similarity: number };
  changes: string[];
}

export function diversify(spec: VideoSpec, history: FilmFingerprint[], info: VariationInfo, opts: { threshold?: number; seed?: string | number } = {}): AntiTemplateReport {
  const threshold = opts.threshold ?? 0.6;
  const before = nearest(fingerprint(spec), history);
  const report: AntiTemplateReport = { version: 1, threshold, historySize: history.length, before: { nearest: before.id, similarity: before.score }, after: { nearest: before.id, similarity: before.score }, changes: [] };
  if (!history.length || before.score < threshold) return report;
  const rng = createRng(`${opts.seed ?? spec.project.id}:anti-template:${history.length}`).next;
  const close = history.find((h) => h.id === before.id)!;
  const used = new Set(close.features);
  const steps: (() => void)[] = [];
  const n = spec.scenes.length;
  // 1. cuts with no story reason
  for (let i = 0; i < n - 1; i++) {
    const s = spec.scenes[i];
    const tr = s.transition;
    if (!tr || tr.type === 'none' || tr.type === 'cut' || KEEP_REASON.test(tr.reason ?? '')) continue;
    if (!used.has(`cutseq:${i}:${tr.type}`)) continue;
    const pool = info.preferredTransitions(spec.scenes[i + 1].type).filter((x) => x !== tr.type && !KEEP_REASON.test(x) && x !== 'cut' && !used.has(`cutseq:${i}:${x}`));
    if (!pool.length) continue;
    steps.push(() => {
      const next = pool[Math.floor(rng() * pool.length)];
      report.changes.push(`${s.id}: cut ${tr.type} → ${next}`);
      s.transition = { ...tr, type: next, reason: `${tr.reason ? `${tr.reason}; ` : ''}anti-template variation` };
    });
  }
  // 2. camera siblings
  for (let i = 0; i < n; i++) {
    const s = spec.scenes[i];
    const plan = s.motion.cameraPlan;
    if (!plan || !used.has(`cam:${i}:${plan.move}`)) continue;
    const group = CAMERA_SIBLINGS.find((g) => g.includes(plan.move));
    const alt = group?.filter((m) => m !== plan.move && !used.has(`cam:${i}:${m}`)) ?? [];
    if (!alt.length) continue;
    steps.push(() => {
      const move = alt[Math.floor(rng() * alt.length)];
      report.changes.push(`${s.id}: camera ${plan.move} → ${move}`);
      s.motion.cameraPlan = { ...plan, move: move as typeof plan.move, reason: `${plan.reason ? `${plan.reason}; ` : ''}anti-template variation` };
    });
  }
  // 3. variants with at least the same text capacity
  for (let i = 0; i < n; i++) {
    const s = spec.scenes[i];
    if (s.type.startsWith('character-') || !used.has(`seq:${i}:${s.type}/${s.variant ?? ''}`)) continue;
    const v = info.variants(s.type);
    if (!v) continue;
    const cap = (x: string) => v.capacity?.[x] ?? Infinity;
    const alt = v.list.filter((x) => x !== s.variant && cap(x) >= cap(s.variant ?? '') && !used.has(`seq:${i}:${s.type}/${x}`));
    if (!alt.length) continue;
    steps.push(() => {
      const next = alt[Math.floor(rng() * alt.length)];
      report.changes.push(`${s.id}: variant ${s.variant} → ${next}`);
      s.variant = next;
    });
  }
  for (const step of steps) {
    step();
    const now = nearest(fingerprint(spec), history);
    report.after = { nearest: now.id, similarity: now.score };
    if (now.score < threshold) break;
  }
  return report;
}
