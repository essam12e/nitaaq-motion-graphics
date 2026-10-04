/**
 * Storyboard: Scene Planner + Motion Composer.
 *  - Planner picks one recipe (family + content) per beat with diversity rules
 *    (no family back-to-back, penalise repeats and same-category runs, respect
 *    assets, aspect support and variant text capacity), seeded for reproducibility.
 *  - Composer sets durations (reading time, pace, target length or voice
 *    phrase boundaries), transitions, camera and intensity.
 */
import type { Beat, CreativePlan, Storyboard, StoryboardScene } from '../schema/plan';
import { SceneRegistry } from '../scenes';
import { STYLE_PRESETS } from '../styles/presets';
import { TRANSITIONS } from '../transitions/presentations';
import { createRng, hashString } from '../core/rng';
import { buildTimeline } from '../core/timeline';
import { RECIPES, GENRE_PREFER, type Recipe, type RecipeCtx } from './recipes';
import { BEAT_ENERGY } from './plan';

type Aspect = '9:16' | '16:9' | '1:1' | '4:5';

export interface PlannedScene extends StoryboardScene {
  content: Record<string, unknown>;
  camera: 'none' | 'push' | 'pull' | 'drift' | 'rise' | 'pan-left' | 'pan-right';
  intensity: number;
  transitionDuration: number;
}

export interface PlannedStoryboard extends Storyboard {
  scenes: PlannedScene[];
}

export interface VoiceTiming {
  /** Speech segments in video time (offset already applied). */
  segments: { start: number; end: number }[];
  end: number;
  transcript?: string[];
}

const strip = (o: unknown) => JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
const wordsIn = (v: unknown): number => {
  // SVG path data / ids are not read on screen
  if (typeof v === 'string') return /\.(png|jpe?g|webp|svg)$/i.test(v) || /^https?:/.test(v) || /^[MLHVCQZmlhvcqz][\d\s.,MLHVCQZmlhvcqz-]{8,}$/.test(v) ? 0 : v.split(/\s+/).filter(Boolean).length;
  if (Array.isArray(v)) return v.reduce((s, x) => s + wordsIn(x), 0);
  if (v && typeof v === 'object') return Object.entries(v).reduce((s, [k, x]) => (k === 'source' || k === 'icon' || k === 'image' || k === 'logo' || k === 'highlight' || k === 'structure' || k === 'd' || k === 'path' || k === 'land' || k === 'viewBox' || k === 'warnings' ? s : s + wordsIn(x)), 0);
  return 0;
};
const charsOfMain = (family: string, content: Record<string, unknown>): number => {
  if (family === 'feature-set' || family === 'process-steps') {
    const arr = (content.features ?? content.steps) as { title: string; text?: string }[];
    return Math.max(...arr.map((f) => f.title.length + (f.text?.length ?? 0)));
  }
  const main = content.title ?? content.word ?? content.text ?? content.quote ?? content.headline ?? (Array.isArray(content.lines) ? (content.lines as string[]).join(' ') : '');
  return typeof main === 'string' ? main.length : 0;
};

function chooseVariant(r: Recipe, ctx: RecipeCtx, content: Record<string, unknown>, usedVariants: Map<string, string[]>, rng: () => number): string {
  const m = SceneRegistry.get(r.family)!.manifest;
  const pref = r.variants?.(ctx) ?? m.aspectVariants?.[ctx.orientation] ?? [m.defaultVariant, ...m.variants];
  let cands = [...new Set(pref)].filter((v) => m.variants.includes(v));
  if (!cands.length) cands = [m.defaultVariant];
  const len = charsOfMain(r.family, content);
  if (m.textCapacity) {
    const fits = cands.filter((v) => (m.textCapacity![v] ?? Infinity) >= len);
    if (fits.length) cands = fits;
    else cands = [...m.variants].sort((a, b) => (m.textCapacity![b] ?? 0) - (m.textCapacity![a] ?? 0)).slice(0, 1);
  }
  const used = usedVariants.get(r.family) ?? [];
  const fresh = cands.filter((v) => !used.includes(v));
  const pool = (fresh.length ? fresh : cands).slice(0, 2);
  return pool.length > 1 && rng() < 0.35 ? pool[1] : pool[0];
}

function pickTransition(prev: PlannedScene, next: { beat: Beat; family: string }, styleId: string, last: string | undefined, rng: () => number, pace: CreativePlan['pace']): string {
  const tokens = STYLE_PRESETS[styleId];
  const known = (id: string) => Boolean(TRANSITIONS[id]);
  if (next.beat === 'bridge' || prev.beat === 'bridge') return known('speed-ramp') && pace !== 'slow' ? 'speed-ramp' : 'zoom-in';
  if (next.beat === 'cta' && tokens.transitions.includes('light-sweep')) return 'light-sweep';
  const nextPref = SceneRegistry.get(next.family)?.manifest.preferredTransitions ?? [];
  const styleSet = tokens.transitions.filter(known);
  const both = nextPref.filter((t) => styleSet.includes(t));
  const pool = (both.length ? both : styleSet.length ? styleSet : ['crossfade']).filter((t) => t !== last && t !== 'cut' && t !== 'none');
  const list = pool.length ? pool : ['crossfade'];
  return list[Math.floor(rng() * list.length)];
}

const CAMERA_BY_CATEGORY: Record<string, PlannedScene['camera'][]> = {
  typography: ['push', 'drift', 'none'],
  brand: ['push', 'pull'],
  commerce: ['push', 'drift'],
  media: ['push', 'pan-left', 'pan-right'],
  cinematic: ['push', 'pull'],
  ui: ['none', 'push'],
  mobile: ['drift', 'none'],
  data: ['none'],
  infographic: ['none', 'drift'],
  social: ['drift', 'none'],
  cta: ['push', 'none'],
  // the Character Director runs its own camera (shot sizes + moves) inside the scene
  character: ['none'],
};

/** Split speech segments into `n` contiguous groups of roughly equal speaking time. */
export function groupSegments(segs: { start: number; end: number }[], n: number): { start: number; end: number }[] {
  let groups = segs.map((s) => ({ ...s }));
  // too few phrases → split the longest ones at their midpoint
  while (groups.length < n) {
    let li = 0;
    groups.forEach((g, i) => {
      if (g.end - g.start > groups[li].end - groups[li].start) li = i;
    });
    const g = groups[li];
    const mid = (g.start + g.end) / 2;
    groups.splice(li, 1, { start: g.start, end: mid }, { start: mid, end: g.end });
  }
  // too many → merge the pair with the smallest gap/combined length
  while (groups.length > n) {
    let bi = 0;
    let best = Infinity;
    for (let i = 0; i < groups.length - 1; i++) {
      const cost = groups[i + 1].end - groups[i].start + (groups[i + 1].start - groups[i].end) * 2;
      if (cost < best) {
        best = cost;
        bi = i;
      }
    }
    groups.splice(bi, 2, { start: groups[bi].start, end: groups[bi + 1].end });
  }
  return groups;
}

export function buildStoryboard(plan: CreativePlan, ctx: RecipeCtx, opts: { seed?: string | number; voice?: VoiceTiming; prefer?: string[]; avoid?: string[] } = {}): PlannedStoryboard {
  const aspect = plan.aspect as Aspect;
  const seed = opts.seed ?? hashString(JSON.stringify(ctx.brief.content));
  const rng = createRng(seed).next;
  const picked: { r: Recipe; beat: Beat; content: Record<string, unknown>; message: string }[] = [];
  const usedFamilies = new Map<string, number>();
  // user-supplied material each family shows: unseen material is preferred, shown material is not repeated
  const shown = new Set<string>();
  const payloadOf = (family: string): string | null => {
    if (['browser-scene', 'screenshot-focus', 'landing-page'].includes(family)) return ctx.assets.screenshot ? 'screenshot' : null;
    if (family === 'integration-hub') return 'integrations';
    if (family === 'form-fill') return 'form';
    if (family === 'state-flow') return 'flow';
    if (family === 'data-table') return 'table';
    if (['process-steps', 'workflow', 'timeline'].includes(family)) return 'steps';
    // a whiteboard writes out the brief's steps (or features) — the same payload as a steps/features scene
    if (family === 'whiteboard') return ctx.brief.content.steps?.length ? 'steps' : ctx.brief.content.features?.length ? 'features' : null;
    if (['feature-set', 'icon-list', 'product-details'].includes(family)) return 'features';
    return null;
  };
  const beats = plan.narrativeArc.map((a) => a.beat);
  const skip = new Set<number>();
  const prefer = [...(opts.prefer ?? []), ...(ctx.genre ? GENRE_PREFER[ctx.genre] ?? [] : [])];
  // lazy modules: a family that belongs to an unselected module is never used
  const moduleOk = (family: string) => {
    const mod = SceneRegistry.get(family)?.manifest.module;
    return !mod || !ctx.modules || ctx.modules.includes(mod);
  };
  // the structure-aware logo engine replaces the generic logo reveal when it ran
  const avoid = [...(opts.avoid ?? []), ...(ctx.logo ? ['logo-reveal'] : [])];

  beats.forEach((beat, bi) => {
    if (skip.has(bi)) return;
    const prev = picked[picked.length - 1];
    const prevCat = prev ? SceneRegistry.get(prev.r.family)!.manifest.category : undefined;
    let cands = RECIPES.filter((r) => r.beats.includes(beat) && SceneRegistry.has(r.family) && SceneRegistry.get(r.family)!.manifest.aspectRatios.includes(aspect) && !avoid.includes(r.family) && moduleOk(r.family) && r.when(ctx));
    // after problem-solution, the "solution" beat must add something new (a brand moment), not repeat the line
    if (beat === 'solution' && picked.some((p) => p.r.family === 'problem-solution')) cands = cands.filter((r) => r.family === 'logo-reveal' || r.family === 'brand-intro');
    if (!cands.length) return;
    const catOf = (f: string) => SceneRegistry.get(f)!.manifest.category;
    // later middle beats that can ONLY be cards (no other category available) cannot break the template
    const onlyCards = (b: (typeof beats)[number]) =>
      RECIPES.filter((r) => r.beats.includes(b) && SceneRegistry.has(r.family) && SceneRegistry.get(r.family)!.manifest.aspectRatios.includes(aspect) && !avoid.includes(r.family) && moduleOk(r.family) && r.when(ctx)).every((r) => catOf(r.family) === 'infographic');
    // a bridge after the problem disappears when problem-solution (cards) is picked, so it can't be relied on
    // and a solution beat after it only survives as a brand moment (logo-reveal / brand-intro)
    const brandSolution = RECIPES.some((r) => r.beats.includes('solution') && (r.family === 'logo-reveal' || r.family === 'brand-intro') && SceneRegistry.has(r.family) && !avoid.includes(r.family) && moduleOk(r.family) && r.when(ctx));
    const rest = beats.slice(bi + 1).filter((b, k) => !skip.has(bi + 1 + k) && !(beat === 'problem' && (b === 'bridge' || (b === 'solution' && !brandSolution))));
    const templateRisk =
      picked.length >= 1 &&
      catOf(picked[0].r.family) === 'typography' &&
      picked.slice(1).every((p) => catOf(p.r.family) === 'infographic') &&
      rest[rest.length - 1] === 'cta' &&
      rest.slice(0, -1).every((b) => b !== 'cta' && onlyCards(b));
    // the same family with the same content twice in one film is a repeated scene, not a new beat
    const seen = new Set(picked.map((p) => `${p.r.family}|${JSON.stringify(p.content)}`));
    const scored = cands
      .filter((r) => r.family !== prev?.r.family && !seen.has(`${r.family}|${JSON.stringify(strip(r.build(ctx)))}`))
      .map((r) => {
        const m = SceneRegistry.get(r.family)!.manifest;
        let w = r.weight;
        const uses = usedFamilies.get(r.family) ?? 0;
        if (uses) w *= 0.25 / uses;
        if (m.category === prevCat) w *= 0.6;
        // never three scenes of one category in a row when there is a choice
        if (m.category === prevCat && picked.length >= 2 && catOf(picked[picked.length - 2].r.family) === prevCat) w *= 0.3;
        // banned look «heading → cards → CTA»: the last middle scene breaks the template when it can
        if (templateRisk && m.category === 'infographic') w *= 0.12;
        if (prefer.includes(r.family)) w *= 2.2;
        const pay = payloadOf(r.family);
        if (pay) w *= shown.has(pay) ? 0.12 : pay === 'screenshot' ? 1.8 : 1.5; // the user's real screenshot first
        // match the beat's energy
        w *= 1 - Math.abs(m.energy - BEAT_ENERGY[beat]) * 0.5;
        // copy longer than every variant of the family can hold → strongly prefer roomier families
        if (m.textCapacity) {
          const cap = Math.max(...Object.values(m.textCapacity));
          const len = charsOfMain(r.family, strip(r.build(ctx)));
          if (len > cap) w *= 0.15;
          else if (len > cap * 0.8) w *= 0.7;
        }
        w *= 0.85 + rng() * 0.3;
        return { r, w };
      })
      .sort((a, b) => b.w - a.w);
    if (!scored.length) return;
    // a beat whose best option would only re-show steps/features already on screen is dropped, not repeated
    const topPay = payloadOf(scored[0].r.family);
    if (topPay && (topPay === 'steps' || topPay === 'features') && shown.has(topPay)) return;
    const r = scored[0].r;
    const content = strip(r.build(ctx));
    const m = SceneRegistry.get(r.family)!.manifest;
    const parsed = m.content.safeParse(content);
    if (!parsed.success) return; // recipe could not be satisfied by the brief — skip rather than guess
    picked.push({ r, beat, content, message: r.message(ctx) });
    usedFamilies.set(r.family, (usedFamilies.get(r.family) ?? 0) + 1);
    const pay = payloadOf(r.family);
    if (pay) shown.add(pay);
    if (r.family === 'problem-solution') beats.forEach((b, j) => j > bi && b === 'bridge' && skip.add(j));
  });

  // A kinetic script (content.lines) is told ONCE across the film: when several scenes picked up the
  // whole script, the lines are split between them in order instead of repeating every line in every scene.
  const script = ctx.brief.content.lines ?? [];
  if (script.length >= 2) {
    const carriers = picked
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        const ls = (p.content as { lines?: unknown }).lines;
        return Array.isArray(ls) && ls.length === script.length && ls.every((l, k) => typeof l === 'string' && script[k].startsWith(l));
      });
    if (carriers.length >= 2) {
      const tryK = (k: number) => {
        const out: { i: number; content: Record<string, unknown> }[] = [];
        for (let g = 0; g < k; g++) {
          const { p, i } = carriers[g];
          const all = (p.content as { lines: string[] }).lines;
          const part = all.slice(Math.round((g * all.length) / k), Math.round(((g + 1) * all.length) / k));
          const hl = (p.content as { highlight?: string[] }).highlight?.filter((h) => part.some((l) => l.includes(h)));
          const content = { ...(p.content as Record<string, unknown>), lines: part, highlight: hl?.length ? hl : undefined };
          if (!SceneRegistry.get(p.r.family)!.manifest.content.safeParse(strip(content)).success) return null;
          out.push({ i, content: strip(content) as Record<string, unknown> });
        }
        return out;
      };
      for (let k = Math.min(carriers.length, script.length); k >= 1; k--) {
        const plan2 = tryK(k);
        if (!plan2) continue;
        for (const { i, content } of plan2) picked[i] = { ...picked[i], content, message: (content.lines as string[]).join(' / ') };
        const drop = new Set(carriers.slice(k).map((c) => c.i));
        for (let i = picked.length - 1; i >= 0; i--) if (drop.has(i)) picked.splice(i, 1);
        break;
      }
    }
  }

  const usedVariants = new Map<string, string[]>();
  const pace = plan.pace;
  const tDur = pace === 'fast' ? 0.38 : pace === 'slow' ? 0.62 : 0.48;
  const scenes: PlannedScene[] = [];
  let lastTransition: string | undefined;
  picked.forEach((p, i) => {
    const m = SceneRegistry.get(p.r.family)!.manifest;
    const variant = chooseVariant(p.r, ctx, p.content, usedVariants, rng);
    usedVariants.set(p.r.family, [...(usedVariants.get(p.r.family) ?? []), variant]);
    const words = wordsIn(p.content);
    const paceK = pace === 'fast' ? 0.85 : pace === 'slow' ? 1.2 : 1;
    // Arabic reading ≈ 3 words/s for motion copy + entrance time
    const want = Math.min(m.maxDuration, Math.max(m.minDuration, Math.max(m.defaultDuration * paceK, 1.1 + words / 3)));
    const cams = CAMERA_BY_CATEGORY[m.category] ?? ['none'];
    const camera = m.safeArea === 'strict' ? 'none' : cams[Math.floor(rng() * cams.length)];
    const energy = BEAT_ENERGY[p.beat];
    const scene: PlannedScene = {
      id: `s${i + 1}-${p.beat}`,
      beat: p.beat,
      purpose: `${p.beat}: ${p.r.visual}`,
      start: 0,
      duration: Math.round(want * 100) / 100,
      visibleMessage: p.message,
      supportingVisual: p.r.visual,
      family: p.r.family,
      variant,
      composition: `${m.category}/${variant} (${ctx.orientation})`,
      movement: camera === 'none' ? 'static frame, element motion only' : `camera ${camera}`,
      transition: 'cut',
      soundEvents: m.sfx.map((s) => s.category),
      emphasis: Array.isArray(p.content.highlight) ? (p.content.highlight as string[]).join('، ') : '',
      ctaRelation: p.beat === 'cta' ? 'the call to action' : i === picked.length - 2 ? 'sets up the CTA' : 'builds toward the CTA',
      content: p.content,
      camera,
      intensity: Math.round(Math.min(1, 0.35 + energy * 0.6) * 100) / 100,
      transitionDuration: tDur,
    };
    if (i > 0) {
      const t = pickTransition(scenes[i - 1], { beat: p.beat, family: p.r.family }, plan.visualStyle, lastTransition, rng, pace);
      scenes[i - 1].transition = t;
      lastTransition = t;
    }
    scenes.push(scene);
  });
  if (!scenes.length) return { totalDuration: 0, scenes };
  scenes[scenes.length - 1].transition = 'none';

  if (opts.voice && opts.voice.segments.length) fitToVoice(scenes, opts.voice, plan.duration);
  else fitToDuration(scenes, plan.duration);

  const tl = buildTimeline(toTimeline(scenes), 30);
  tl.entries.forEach((e, i) => (scenes[i].start = Math.round(e.startSec * 100) / 100));
  return { totalDuration: Math.round(tl.totalSec * 100) / 100, scenes };
}

const toTimeline = (scenes: PlannedScene[]) =>
  scenes.map((s) => ({ id: s.id, duration: s.duration, transition: s.transition === 'none' ? undefined : { type: s.transition, duration: s.transitionDuration } }));

/** Scale scene durations (within each family's min/max) so the video lands on the target length. */
function fitToDuration(scenes: PlannedScene[], target: number): void {
  const total = () => buildTimeline(toTimeline(scenes), 30).totalSec;
  for (let iter = 0; iter < 6; iter++) {
    const cur = total();
    if (Math.abs(cur - target) < 0.25) break;
    const k = target / cur;
    let moved = false;
    for (const s of scenes) {
      const m = SceneRegistry.get(s.family)!.manifest;
      const floor = Math.max(m.minDuration, s.beat === 'hook' ? 2.2 : s.beat === 'cta' ? 2.8 : 0, 0.9 + wordsIn(s.content) / 3.6);
      const next = Math.round(Math.min(m.maxDuration, Math.max(floor, s.duration * k)) * 100) / 100;
      if (next !== s.duration) moved = true;
      s.duration = next;
    }
    if (!moved) break;
  }
}

/**
 * Voice-led timing: scene k becomes visible at the phrase boundary before its
 * group of speech, so cuts land in pauses, never mid-word. The last scene holds
 * past the end of the voice.
 */
const norm = (x: string) => x.replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase();
const tokensOf = (x: string) => new Set(norm(x).split(/\s+/).filter((w) => w.length > 1));
const textOf = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).join(' ') : v && typeof v === 'object' ? Object.values(v).map(textOf).join(' ') : '');

/**
 * When the transcript has one line per detected phrase, assign lines to the scene
 * whose on-screen words overlap most (in order), so each scene is on screen while
 * its words are spoken. Returns null when the mapping is not reliable.
 */
export function transcriptGroups(scenes: { content: Record<string, unknown> }[], segs: { start: number; end: number }[], transcript?: string[]): { start: number; end: number; text?: string }[] | null {
  if (!transcript || transcript.length !== segs.length || segs.length < scenes.length) return null;
  const sceneTok = scenes.map((s) => tokensOf(textOf(s.content)));
  const owner: number[] = [];
  let cur = 0;
  transcript.forEach((line, li) => {
    const lt = [...tokensOf(line)];
    const score = (k: number) => (lt.length ? lt.filter((w) => sceneTok[k].has(w)).length / lt.length : 0);
    // stay monotonic: a line belongs to the current scene or a later one
    let best = cur;
    let bestScore = score(cur);
    for (let k = cur + 1; k < scenes.length; k++) {
      const sc = score(k);
      if (sc > bestScore + 0.05) {
        best = k;
        bestScore = sc;
      }
    }
    // lines left must still cover the scenes left
    const remainingLines = transcript.length - li;
    const remainingScenes = scenes.length - best;
    if (remainingLines < remainingScenes) best = scenes.length - remainingLines;
    owner.push(best);
    cur = best;
  });
  for (let k = 0; k < scenes.length; k++) if (!owner.includes(k)) return null;
  return scenes.map((_, k) => {
    const idx = owner.map((o, i) => (o === k ? i : -1)).filter((i) => i >= 0);
    return { start: segs[idx[0]].start, end: segs[idx[idx.length - 1]].end, text: idx.map((i) => transcript[i]).join(' ') };
  });
}

function fitToVoice(scenes: PlannedScene[], voice: VoiceTiming, target: number): void {
  const groups: { start: number; end: number; text?: string }[] = transcriptGroups(scenes, voice.segments, voice.transcript) ?? groupSegments(voice.segments, scenes.length);
  const bounds: number[] = [0];
  for (let k = 1; k < groups.length; k++) {
    const gap = { a: groups[k - 1].end, b: groups[k].start };
    // cut a little before the next phrase starts (inside the pause)
    bounds.push(Math.round(Math.max(gap.a, gap.b - 0.12) * 100) / 100);
  }
  const end = Math.max(target, voice.end + 0.8);
  bounds.push(end);
  scenes.forEach((s, k) => {
    const out = k === scenes.length - 1 ? 0 : s.transitionDuration;
    s.duration = Math.round((bounds[k + 1] - bounds[k] + out) * 100) / 100;
    // a very short gap between phrases can't host a long transition
    if (s.duration * 0.4 < s.transitionDuration) s.transitionDuration = Math.max(0.2, Math.round(s.duration * 0.35 * 100) / 100);
    const r2 = (x: number) => Math.round(x * 100) / 100;
    s.narration = { start: r2(groups[k].start), end: r2(groups[k].end), text: groups[k].text ?? (voice.transcript?.length === scenes.length ? voice.transcript[k] : undefined) };
  });
  // recompute durations after any transition shortening so scene starts stay on bounds
  scenes.forEach((s, k) => {
    const out = k === scenes.length - 1 ? 0 : s.transitionDuration;
    s.duration = Math.round((bounds[k + 1] - bounds[k] + out) * 100) / 100;
  });
}
