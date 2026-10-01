/**
 * AI Creative Director — the film-level pass that runs after the storyboard:
 *
 *  - ONE motion personality for the whole film (brand/tone/style/reference)
 *  - a purpose ("motion job") for every scene: motion that has no job is removed
 *  - an escalation curve: restraint early, one hero moment, a clean resolve
 *  - a camera budget: camera moves only where they mean something (hook, hero, CTA)
 *  - transitions from the personality's family, varied with the beat
 *  - optional beat alignment: cuts snap to musical beats/downbeats (never with voice)
 *
 * Outputs the decisions as data: motion_spec.json and shotlist.json.
 * Pure and deterministic (seeded).
 */
import type { CreativePlan, Beat } from '../schema/plan';
import type { PlannedScene, PlannedStoryboard } from './storyboard';
import { SceneRegistry } from '../scenes';
import { TRANSITIONS } from '../transitions/presentations';
import { chooseTransitions, type CutScene } from '../transitions/engine';
import { planTextMotion } from '../text-motion/planner';
import { hasArabic } from '../typography/arabic';
import { motionProfile } from '../motion/principles';
import { PERSONALITIES, pickPersonality, physicsFor, type MotionPersonalityId } from '../motion/personality';
import type { ElementKind } from '../motion/physics';
import { createRng } from '../core/rng';
import { buildTimeline } from '../core/timeline';
import type { Brief } from '../schema/brief';

export const MOTION_JOBS: Record<Beat, string[]> = {
  hook: ['stop-the-scroll', 'establish-hierarchy'],
  problem: ['create-tension', 'show-the-pain'],
  bridge: ['turn-the-story'],
  solution: ['release-tension', 'reveal-the-answer'],
  demo: ['show-how-it-works', 'connect-states'],
  feature: ['sequence-benefits', 'direct-attention'],
  product: ['hero-reveal', 'show-the-product'],
  offer: ['create-urgency', 'make-the-price-legible'],
  proof: ['prove-the-claim'],
  data: ['make-the-number-land', 'prove-the-claim'],
  social: ['build-trust'],
  process: ['guide-through-steps'],
  comparison: ['contrast-before-after'],
  brand: ['brand-recall'],
  tease: ['build-curiosity', 'withhold-the-reveal'],
  reveal: ['hero-reveal', 'release-tension'],
  montage: ['escalate-rhythm', 'sequence-benefits'],
  detail: ['show-craft', 'direct-attention'],
  map: ['locate-the-story', 'connect-places'],
  cta: ['resolve', 'direct-action'],
};

const HERO_BEATS: Beat[] = ['solution', 'product', 'brand', 'demo', 'offer', 'reveal'];

export interface BeatGrid {
  bpm: number;
  beats: number[];
  downbeats: number[];
}

export interface SceneDirection {
  id: string;
  beat: Beat;
  family: string;
  variant: string;
  jobs: string[];
  hero: boolean;
  intensity: number;
  camera: PlannedScene['camera'];
  transitionOut: string;
  physics: Partial<Record<ElementKind, string>>;
  /** Text Motion Engine families per role group. */
  text?: Record<string, string>;
  transitionReason?: string;
  why: string;
}

export interface MotionSpec {
  version: 1;
  personality: MotionPersonalityId;
  personalityReason: string;
  seed: string | number;
  escalation: number[];
  heroScene: string | null;
  cameraBudget: { allowed: number; used: number };
  beatSync: { bpm: number; aligned: number } | null;
  physics: Partial<Record<ElementKind, string>>;
  /** Animation principles per element under this personality (anticipation, overshoot, arcs, squash…). */
  principles: Record<string, string>;
  textMotion: Record<string, number>;
  transitions: Record<string, number>;
  /** Shared-element continuity pairs (same identity asset across a cut). */
  shared: { asset: string; fromScene: string; toScene: string }[];
  rules: string[];
  scenes: SceneDirection[];
}

export interface ShotListEntry {
  shot: number;
  id: string;
  start: number;
  duration: number;
  beat: Beat;
  scene: string;
  framing: string;
  camera: string;
  transitionOut: string;
  message: string;
  motionJobs: string[];
  sound: string[];
  voice?: string;
}

const ELEMENTS: ElementKind[] = ['hero-title', 'text', 'card', 'button', 'icon', 'logo', 'product', 'dashboard', 'number', 'camera', 'transition'];

export function directFilm(input: {
  brief: Brief;
  plan: CreativePlan;
  storyboard: PlannedStoryboard;
  seed: string | number;
  referenceEnergy?: number;
  beats?: BeatGrid | null;
  voiceLed: boolean;
  genre?: string;
  sharedElements?: boolean;
}): { storyboard: PlannedStoryboard; motion: MotionSpec; shotlist: ShotListEntry[] } {
  const { brief, plan, storyboard } = input;
  const rng = createRng(`${input.seed}:creative`).next;
  const pick = pickPersonality({ explicit: brief.motion, tone: brief.tone, request: brief.request, styleId: plan.visualStyle, referenceEnergy: input.referenceEnergy });
  const P = PERSONALITIES[pick.id];
  const scenes = storyboard.scenes.map((s) => ({ ...s }));
  const n = scenes.length;

  // ── hero moment: the strongest solution/product/brand beat in the middle of the film
  const HERO_BONUS: Partial<Record<Beat, number>> = { reveal: 0.4, product: 0.3, solution: 0.25, brand: 0.2, demo: 0.15, offer: 0.1 };
  const heroScore = (s: PlannedScene) => s.intensity + (HERO_BONUS[s.beat] ?? 0);
  let hero = -1;
  scenes.forEach((s, i) => {
    if (i === 0 || i === n - 1 || !HERO_BEATS.includes(s.beat)) return;
    if (hero < 0 || heroScore(s) > heroScore(scenes[hero])) hero = i;
  });

  // ── escalation: restraint → build → hero peak → resolve (scaled by personality amplitude)
  const escalation = scenes.map((_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    let e = 0.55 + 0.35 * t;
    if (i === 0) e = 0.8; // the hook must stop the scroll
    if (i === hero) e = 1;
    if (i === n - 1) e = 0.7; // the CTA resolves, it does not shout
    return Math.round(e * 100) / 100;
  });

  // ── camera budget: only meaningful moves, at most ⌈n·activity⌉ of them
  const allowed = Math.max(1, Math.ceil(n * P.camera.activity * 0.6));
  const moves = P.camera.moves.filter((m) => m !== 'none');
  const priority = scenes.map((s, i) => ({ i, score: (i === hero ? 3 : 0) + (i === 0 ? 2 : 0) + (s.beat === 'cta' ? 1.5 : 0) + (s.camera !== 'none' ? 0.5 : 0) })).sort((a, b) => b.score - a.score);
  const camOn = new Set(priority.filter((p) => p.score >= 1.5).slice(0, allowed).map((p) => p.i));
  let used = 0;

  // ── Scene Transition Engine: every cut chosen from the relationship between its two scenes
  const known = (id: string) => Boolean(TRANSITIONS[id]);
  const identityOf = (v: unknown, acc: Set<string>): Set<string> => {
    if (typeof v === 'string' && /^(logo|product(-\d+)?|screenshot|screen-\d+)$/.test(v)) acc.add(v);
    else if (Array.isArray(v)) v.forEach((x) => identityOf(x, acc));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => identityOf(x, acc));
    return acc;
  };
  const textOf = (c: Record<string, unknown>) => JSON.stringify(c);
  const cutScenes: CutScene[] = scenes.map((s) => {
    const cat = SceneRegistry.get(s.family)?.manifest.category ?? 'typography';
    const main = [s.content.word, s.content.title, s.content.headline].find((x) => typeof x === 'string') as string | undefined;
    return { id: s.id, beat: s.beat, family: s.family, category: s.family.includes('flow') ? 'flow' : cat, identity: [...identityOf(s.content, new Set())], hasWord: Boolean((Array.isArray(s.content.highlight) && s.content.highlight.length) || (main && main.split(/\s+/).some((w) => w.length >= 3 && w.length <= 12))) };
  });
  let onBeat: boolean[] | undefined;
  if (input.beats && input.beats.beats.length > 4 && !input.voiceLed) {
    const grid = [...input.beats.downbeats, ...input.beats.beats];
    const tl0 = buildTimeline(scenes.map((s) => ({ id: s.id, duration: s.duration, transition: undefined })), 30);
    onBeat = tl0.entries.slice(1).map((e) => grid.some((g) => Math.abs(g - e.startSec) < 0.22));
  }
  const cutChoices = chooseTransitions({
    scenes: cutScenes,
    personality: pick.id,
    pace: plan.pace,
    genre: input.genre,
    heroIndex: hero,
    seed: input.seed,
    onBeat,
    sharedElements: input.sharedElements !== false,
    hasProduct: Object.values(cutScenes).some((c) => c.identity.some((x) => x.startsWith('product'))),
    styleFamily: P.transitions.filter(known),
  });
  // ── Text Motion Engine: hierarchy + variety per scene
  const textPlan = planTextMotion(
    scenes.map((s) => ({ id: s.id, beat: s.beat, arabic: hasArabic(textOf(s.content)) && brief.language !== 'en', hasHighlight: Array.isArray(s.content.highlight) && (s.content.highlight as unknown[]).length > 0 })),
    pick.id,
    input.seed,
  );

  const directions: SceneDirection[] = scenes.map((s, i) => {
    const m = SceneRegistry.get(s.family)?.manifest;
    const strict = m?.safeArea === 'strict';
    if (!camOn.has(i) || strict || !moves.length) s.camera = 'none';
    else {
      if (s.camera === 'none' || !moves.includes(s.camera)) s.camera = moves[Math.floor(rng() * moves.length)];
      used++;
    }
    s.intensity = Math.round(Math.min(1, Math.max(0.25, escalation[i] * (0.55 + P.intensity * 0.6))) * 100) / 100;
    if (i < n - 1 && cutChoices[i]) {
      s.transition = cutChoices[i].type === 'cut' ? 'cut' : cutChoices[i].type;
      if (cutChoices[i].duration > 0) s.transitionDuration = cutChoices[i].duration;
    }
    const jobs = [...MOTION_JOBS[s.beat]];
    if (i === hero) jobs.unshift('hero-moment');
    if (s.camera !== 'none') jobs.push(`camera-${s.camera}-for-${i === hero ? 'emphasis' : i === 0 ? 'energy' : 'focus'}`);
    s.movement = s.camera === 'none' ? `still frame; ${pick.id} element motion (${jobs[0]})` : `camera ${s.camera}; ${pick.id} element motion`;
    const physics: Partial<Record<ElementKind, string>> = {};
    for (const el of ELEMENTS) physics[el] = physicsFor(pick.id, el).id;
    return { id: s.id, beat: s.beat, family: s.family, variant: s.variant, jobs, hero: i === hero, intensity: s.intensity, camera: s.camera, transitionOut: s.transition, transitionReason: cutChoices[i]?.reason, text: textPlan.scenes[i]?.text as Record<string, string>, physics, why: i === hero ? 'peak of the film: the answer/product lands here' : i === 0 ? 'hook: stop the scroll in the first second' : i === n - 1 ? 'resolve on one clear action' : `carries the ${s.beat} beat` };
  });

  // ── beat alignment (music without voice): snap cut points to the nearest beat within ±0.18 s
  let beatSync: MotionSpec['beatSync'] = null;
  if (input.beats && input.beats.beats.length > 4 && !input.voiceLed) {
    const grid = [...input.beats.downbeats, ...input.beats.beats].sort((a, b) => a - b);
    let aligned = 0;
    const tl = buildTimeline(scenes.map((s) => ({ id: s.id, duration: s.duration, transition: s.transition === 'none' ? undefined : { type: s.transition, duration: s.transitionDuration } })), 30);
    let shift = 0;
    tl.entries.forEach((e, i) => {
      if (i === 0) return;
      const cut = e.startSec + shift;
      const near = grid.reduce((b, x) => (Math.abs(x - cut) < Math.abs(b - cut) ? x : b), grid[0]);
      const d = near - cut;
      if (Math.abs(d) <= 0.18 && Math.abs(d) > 0.01) {
        const prev = scenes[i - 1];
        const min = SceneRegistry.get(prev.family)?.manifest.minDuration ?? 1;
        const next = Math.round((prev.duration + d) * 100) / 100;
        if (next >= min) {
          prev.duration = next;
          shift += d;
          aligned++;
        }
      } else if (Math.abs(d) <= 0.01) aligned++;
    });
    beatSync = { bpm: input.beats.bpm, aligned };
  }

  const tl = buildTimeline(scenes.map((s) => ({ id: s.id, duration: s.duration, transition: s.transition === 'none' ? undefined : { type: s.transition, duration: s.transitionDuration } })), 30);
  tl.entries.forEach((e, i) => (scenes[i].start = Math.round(e.startSec * 100) / 100));
  const physics: Partial<Record<ElementKind, string>> = {};
  for (const el of ELEMENTS) physics[el] = physicsFor(pick.id, el).id;
  const motion: MotionSpec = {
    version: 1,
    personality: pick.id,
    personalityReason: pick.reason,
    seed: input.seed,
    escalation,
    heroScene: hero >= 0 ? scenes[hero].id : null,
    cameraBudget: { allowed, used },
    beatSync,
    physics,
    principles: Object.fromEntries(ELEMENTS.filter((el) => el !== 'transition').map((el) => [el, motionProfile(pick.id, el).why])),
    textMotion: textPlan.usage,
    shared: cutChoices.flatMap((c, i) => (c.shared && c.type === 'shared' && scenes[i + 1] ? [{ asset: c.shared.asset, fromScene: scenes[i].id, toScene: scenes[i + 1].id }] : [])),
    transitions: cutChoices.reduce((a, c) => ((a[c.type] = (a[c.type] ?? 0) + 1), a), {} as Record<string, number>),
    rules: [
      `one personality for the whole film: ${P.label} — ${P.description}`,
      'every scene has a motion job; decorative motion is removed',
      `camera moves on at most ${allowed} scene(s)`,
      `overshoot ≤ ${Math.round(P.overshootMax * 100)}%, stagger ${P.stagger}s`,
      'randomness is seeded: the same brief renders the same film',
      'every transition has a reason (continuity, contrast, reveal, rhythm); a hard cut is often right',
      'text motion follows hierarchy: headline ≠ support ≠ CTA, no family twice in a row',
    ],
    scenes: directions,
  };
  const shotlist: ShotListEntry[] = scenes.map((s, i) => ({
    shot: i + 1,
    id: s.id,
    start: s.start,
    duration: s.duration,
    beat: s.beat,
    scene: `${s.family}/${s.variant}`,
    framing: s.composition,
    camera: s.camera,
    transitionOut: s.transition,
    message: s.visibleMessage,
    motionJobs: directions[i].jobs,
    sound: s.soundEvents,
    voice: s.narration?.text,
  }));
  return { storyboard: { totalDuration: Math.round(tl.totalSec * 100) / 100, scenes }, motion, shotlist };
}
