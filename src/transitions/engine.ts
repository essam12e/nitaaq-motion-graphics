/**
 * Scene Transition Engine — a transition must MEAN something.
 *
 * For every cut it looks at the relationship between the two scenes and picks:
 *
 *   same identity object in both     → shared element (the object glides, nothing is rebuilt)
 *   same kind of content (feature→feature, UI→UI)  → hard cut / match cut / page
 *   tension → answer (problem → solution, bridge)  → a contrast transition
 *   into the hero / reveal           → the personality's reveal transition
 *   montage / fast pace / on a beat  → hard cut (rhythm does the work)
 *   into the CTA                     → calm and clean, or a cut after a flashy run
 *
 * Budgets keep the film honest: flashy transitions are rationed, no type is used
 * more than ⌈cuts/3⌉ times (cuts excepted), never the same flashy type twice in a
 * row, and energetic/launch films keep at least a quarter of hard cuts.
 * Pure and deterministic (seeded).
 */
import { TRANSITIONS, TransitionRegistry, type TransitionDef } from './presentations';
import type { MotionPersonalityId } from '../motion/personality';
import { createRng } from '../core/rng';

export interface CutScene {
  id: string;
  beat: string;
  family: string;
  category: string;
  /** Identity assets the scene shows (logo / product / screenshot ids). */
  identity: string[];
  /** The scene's headline has a short word a text-driven transition can carry. */
  hasWord: boolean;
}

export interface TransitionChoice {
  type: string;
  duration: number;
  reason: string;
  shared?: { asset: string };
}

export interface TransitionEngineInput {
  scenes: CutScene[];
  personality: MotionPersonalityId;
  pace: 'slow' | 'medium' | 'fast';
  genre?: string;
  heroIndex: number;
  seed: string | number;
  /** Cut times (seconds) that land on a musical beat — rhythm cuts there. */
  onBeat?: boolean[];
  sharedElements: boolean;
  hasProduct: boolean;
  /** Style preset's transition family (preferred within a meaning). */
  styleFamily?: string[];
}

const REVEAL: Record<MotionPersonalityId, string[]> = {
  premium: ['light-sweep', 'camera-push', 'morph'],
  cinematic: ['camera-push', 'depth', 'light-sweep'],
  corporate: ['wipe', 'push', 'split'],
  tech: ['mask-wipe', 'camera-push', 'morph'],
  energetic: ['zoom-in', 'whip', 'object-sweep'],
  sport: ['whip', 'zoom-in', 'speed-ramp'],
  playful: ['shape', 'iris', 'zoom-in'],
};
const CONTRAST: Record<MotionPersonalityId, string[]> = {
  premium: ['light-sweep', 'split', 'blur'],
  cinematic: ['depth', 'blur', 'split'],
  corporate: ['split', 'wipe', 'mask-wipe'],
  tech: ['mask-wipe', 'split', 'color-dip'],
  energetic: ['color-dip', 'whip', 'text-sweep'],
  sport: ['whip', 'color-dip', 'speed-ramp'],
  playful: ['color-dip', 'shape', 'iris'],
};
const CALM: Record<MotionPersonalityId, string[]> = {
  premium: ['crossfade', 'blur', 'camera-pull'],
  cinematic: ['crossfade', 'camera-pull', 'blur'],
  corporate: ['crossfade', 'push'],
  tech: ['push', 'crossfade'],
  energetic: ['push', 'zoom-out'],
  sport: ['push', 'cut'],
  playful: ['push', 'zoom-out'],
};
const UI_CATS = new Set(['ui', 'mobile', 'flow']);
const RHYTHM_GENRES = new Set(['launch', 'music', 'kinetic', 'sport']);
const PACE_K = { slow: 1.2, medium: 1, fast: 0.8 } as const;

const def = (id: string): TransitionDef | undefined => TransitionRegistry.get(id) ?? TRANSITIONS[id];
const flashy = (id: string) => (def(id)?.energy ?? 0) >= 0.6 && id !== 'cut';

export function chooseTransitions(input: TransitionEngineInput): TransitionChoice[] {
  const { scenes, personality: P, pace } = input;
  const rng = createRng(`${input.seed}:transitions`).next;
  const cuts = Math.max(0, scenes.length - 1);
  const cap = Math.max(1, Math.ceil(cuts / 3));
  const flashyCap = Math.max(1, Math.round(cuts * (P === 'premium' || P === 'corporate' ? 0.25 : 0.4)));
  const rhythmic = RHYTHM_GENRES.has(input.genre ?? '') || P === 'sport' || P === 'energetic' || pace === 'fast';
  const minCuts = rhythmic ? Math.ceil(cuts * 0.25) : 0;
  const usage: Record<string, number> = {};
  let flashUsed = 0;
  let objectUsed = false;
  let textUsed = false;
  const out: TransitionChoice[] = [];

  const ok = (id: string, prev: string | undefined, next: CutScene) => {
    const d = def(id);
    if (!d) return false;
    if (id !== 'cut' && (usage[id] ?? 0) >= cap) return false;
    if (id !== 'cut' && id === prev) return false;
    if (flashy(id) && flashUsed >= flashyCap) return false;
    if (d.requires === 'product' && (!input.hasProduct || objectUsed || !next.identity.some((a) => a.startsWith('product')))) return false;
    if (d.requires === 'text' && (textUsed || !next.hasWord)) return false;
    if (d.requires === 'shared') return false; // only through the shared rule
    return true;
  };
  const pick = (pool: string[], prev: string | undefined, next: CutScene) => {
    const style = input.styleFamily ?? [];
    const cands = pool.filter((id) => ok(id, prev, next));
    if (!cands.length) return undefined;
    const preferred = cands.filter((c) => style.includes(c));
    const list = preferred.length && rng() < 0.6 ? preferred : cands;
    return list[Math.floor(rng() * Math.min(2, list.length))];
  };

  for (let i = 0; i < cuts; i++) {
    const a = scenes[i];
    const b = scenes[i + 1];
    const prev = out[i - 1]?.type;
    let type: string | undefined;
    let reason = '';
    let shared: TransitionChoice['shared'];
    const common = a.identity.find((x) => b.identity.includes(x));
    if (input.sharedElements && common) {
      type = 'shared';
      shared = { asset: common! };
      reason = `continuity: the same ${common} stays on screen and moves to its next place`;
    } else if (input.onBeat?.[i] && rhythmic && b.beat !== 'cta') {
      type = 'cut';
      reason = 'hard cut on the musical beat — rhythm carries the edit';
    } else if (i + 1 === input.heroIndex || b.beat === 'reveal') {
      type = pick(REVEAL[P], prev, b);
      reason = 'into the hero moment: a reveal that earns the peak';
    } else if ((a.beat === 'problem' && (b.beat === 'solution' || b.beat === 'bridge')) || a.beat === 'bridge' || (a.beat === 'tease' && b.beat !== 'tease')) {
      type = pick(CONTRAST[P], prev, b);
      reason = `contrast: ${a.beat} → ${b.beat} turns the story`;
    } else if (b.beat === 'montage' || a.beat === 'montage') {
      type = rng() < 0.75 ? 'cut' : pick(['whip', 'speed-ramp'], prev, b);
      reason = 'montage: rhythm over effect';
    } else if (UI_CATS.has(a.category) && UI_CATS.has(b.category)) {
      type = pick(['page', 'push', 'match-cut'], prev, b);
      reason = 'UI to UI: the interface moves like an interface';
    } else if (a.category === b.category || a.beat === b.beat) {
      type = rng() < 0.6 ? 'cut' : pick(['match-cut', 'push'], prev, b);
      reason = `same kind of content (${a.category}) — a hard cut keeps it moving`;
    } else if (b.beat === 'cta') {
      const flashyRun = prev && flashy(prev);
      type = flashyRun ? 'cut' : pick(CALM[P], prev, b);
      reason = flashyRun ? 'clean cut into the CTA after an energetic run' : 'calm, clean arrival on the call to action';
    } else if (b.beat === 'product' && input.hasProduct && (P === 'energetic' || P === 'playful' || P === 'sport')) {
      type = pick(['object-sweep', ...REVEAL[P]], prev, b);
      reason = 'product-driven: the product itself wipes to its scene';
    } else if (input.genre && ['kinetic', 'launch'].includes(input.genre) && b.hasWord && !textUsed) {
      type = pick(['text-sweep', ...CONTRAST[P]], prev, b);
      reason = 'text-driven: the next word carries the cut';
    } else {
      type = rng() < (rhythmic ? 0.45 : 0.3) ? 'cut' : pick([...CALM[P], ...(input.styleFamily ?? [])], prev, b);
      reason = type === 'cut' ? 'nothing to express — a hard cut is the honest choice' : `${P} film language`;
    }
    if (!type) {
      type = 'cut';
      reason += ' (budget reached → hard cut)';
    }
    const d = def(type)!;
    usage[type] = (usage[type] ?? 0) + 1;
    if (flashy(type)) flashUsed++;
    if (d.requires === 'product') objectUsed = true;
    if (d.requires === 'text') textUsed = true;
    const duration = type === 'cut' ? 0 : Math.round((d.duration ?? 0.5) * PACE_K[pace] * 100) / 100;
    out.push({ type, duration, reason, ...(shared ? { shared } : {}) });
  }
  // rhythm floor: energetic / launch films keep enough hard cuts (replace the weakest soft transitions)
  let have = out.filter((t) => t.type === 'cut').length;
  for (let i = 0; i < out.length && have < minCuts; i++) {
    const t = out[i];
    if (t.type !== 'cut' && t.type !== 'shared' && !flashy(t.type) && i + 1 !== input.heroIndex) {
      out[i] = { type: 'cut', duration: 0, reason: `${t.reason}; hard cut kept for rhythm` };
      have++;
    }
  }
  return out;
}

/** Repetition summary for QC. */
export function transitionStats(types: string[]): { counts: Record<string, number>; maxShare: number; consecutiveRepeats: number; cutShare: number } {
  const counts: Record<string, number> = {};
  let consecutive = 0;
  types.forEach((t, i) => {
    counts[t] = (counts[t] ?? 0) + 1;
    if (i > 0 && t === types[i - 1] && t !== 'cut' && t !== 'none') consecutive++;
  });
  const nonCut = Object.entries(counts).filter(([k]) => k !== 'cut' && k !== 'none');
  const maxShare = types.length ? Math.max(0, ...nonCut.map(([, v]) => v)) / types.length : 0;
  return { counts, maxShare, consecutiveRepeats: consecutive, cutShare: types.length ? (counts.cut ?? 0) / types.length : 0 };
}
