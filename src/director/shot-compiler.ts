/**
 * Shot compiler (P0-C): a validated Shot Script → decisions the existing pipeline already knows how
 * to render (PlannedScene for the Creative Director, then VideoSpec fields). Nothing new is drawn:
 * every shot becomes an existing scene family with an existing camera move, transition and text
 * motion family. What the engine cannot do yet is mapped to the nearest capability or reported —
 * never silently dropped.
 *
 * Decision rule in Full Director Mode: what the script specifies wins over every seeded/random
 * choice of the automatic director; what it leaves out is filled by the engine and reported as such.
 * Pure (no node APIs): the node side passes the voice map in.
 */
import { isObjectTransition, type Shot, type ShotScript, type ShotTime } from './shot-script';
import type { PlannedScene, PlannedStoryboard } from './storyboard';
import type { Beat } from '../schema/plan';
import type { LifecycleSpec, VideoSpec } from '../schema/video';
import type { CameraPlan } from '../camera/moves';
import { CAMERA_MOVES, CAMERA_PRESETS } from '../camera/moves';
import { TRANSITIONS } from '../transitions/presentations';
import { TextMotionRegistry } from '../text-motion/families';
import { SceneRegistry } from '../scenes';
import { RECIPES, type RecipeCtx } from './recipes';
import { normWord } from '../audio/voice-map';

export type DecisionSource = 'script' | 'engine' | 'mapped' | 'fallback' | 'voice';

export interface ShotDecision {
  shot: string;
  field: string;
  value: unknown;
  source: DecisionSource;
  note?: string;
}

export interface CompileReport {
  version: 1;
  shots: number;
  decisions: ShotDecision[];
  mappings: { shot: string; field: string; requested: string; used: string; why: string }[];
  warnings: { shot?: string; code: string; message: string }[];
  timing: { shot: string; start: number; duration: number; source: 'voice' | 'script'; anchor?: string }[];
  rng: { field: string; scope: string; note: string }[];
}

/** The voice timing the compiler needs (a VoiceMap satisfies it). Times are film seconds. */
export interface VoiceWords {
  words: { text: string; norm: string; start: number; end: number; source: 'measured' | 'estimated' }[];
}

export interface ResolvedShot {
  shot: Shot;
  index: number;
  beat: Beat;
  family: string;
  variant: string;
  start: number;
  duration: number;
  transition: { type: string; duration: number; reason: string } | null;
  camera: { plan: CameraPlan; reason: string; target?: string } | null;
  text?: Partial<Record<'headline' | 'support' | 'cta' | 'label', string>>;
  lifecycle: LifecycleSpec;
  content: Record<string, unknown>;
  accents: number[];
  intensity: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

const BEATS: Beat[] = ['hook', 'problem', 'solution', 'demo', 'feature', 'product', 'offer', 'proof', 'data', 'social', 'process', 'comparison', 'brand', 'bridge', 'tease', 'reveal', 'montage', 'cta'] as Beat[];
const PURPOSE_BEAT: Record<string, Beat> = { intro: 'hook', opening: 'hook', pain: 'problem', answer: 'solution', features: 'feature', benefit: 'feature', steps: 'process', how: 'process', testimonial: 'social', stats: 'data', logo: 'brand', outro: 'cta', close: 'cta', closing: 'cta', transition: 'bridge' };

export const CAMERA_ALIASES: Record<string, string> = {
  none: 'static', locked: 'static', still: 'static',
  push: 'push-in', 'push in': 'push-in', 'slow push': 'push-in', pull: 'pull-out', 'pull back': 'pull-out',
  dolly: 'dolly-in', 'dolly in': 'dolly-in', 'dolly out': 'dolly-out',
  zoom: 'zoom-in', crane: 'crane-up', rise: 'crane-up', orbit: 'orbit-left', truck: 'truck-left', track: 'truck-left',
  pan: 'pan-left', tilt: 'tilt-up', pedestal: 'pedestal-up', handheld: 'drift', float: 'drift', 'rack focus': 'rack-focus',
};
export const TRANSITION_ALIASES: Record<string, string> = {
  dissolve: 'crossfade', 'cross-dissolve': 'crossfade', 'hard-cut': 'cut', 'hard cut': 'cut', 'whip-pan': 'whip', 'whip pan': 'whip',
  match: 'match-cut', zoom: 'zoom-through', 'dip-to-black': 'color-dip', 'dip-to-white': 'color-dip', 'dip-to-color': 'color-dip',
  'push-through': 'card-push-through', 'light-leak': 'light-sweep', glitch: 'speed-ramp',
};

const LEGACY_CAMERA = (move: string): PlannedScene['camera'] => (/push|dolly-in|zoom-in|fly/.test(move) ? 'push' : /pull|dolly-out|zoom-out/.test(move) ? 'pull' : /crane|pedestal-up|tilt-up/.test(move) ? 'rise' : /left/.test(move) ? 'pan-left' : /right/.test(move) ? 'pan-right' : 'drift');

/** Spoken word lookup inside [from, to] (film seconds), Arabic-aware. */
export function wordTime(voice: VoiceWords | null, word: string, from = 0, to = Infinity): { start: number; end: number; source: 'measured' | 'estimated' } | null {
  if (!voice) return null;
  const n = normWord(word);
  if (!n) return null;
  const strip = (x: string) => (x.startsWith('ال') && x.length > 3 ? x.slice(2) : x);
  const inWin = voice.words.filter((w) => w.start >= from - 0.05 && w.start <= to + 0.05);
  const hit = inWin.find((w) => w.norm === n) ?? inWin.find((w) => strip(w.norm) === strip(n)) ?? inWin.find((w) => n.length >= 3 && (w.norm.includes(n) || (w.norm.length >= 3 && n.includes(w.norm))));
  return hit ? { start: hit.start, end: hit.end, source: hit.source } : null;
}

/** First and last spoken word of an anchor phrase, searched from `from` (film seconds). */
export function anchorTime(voice: VoiceWords | null, text: string, from: number): { start: number; end: number; source: 'measured' | 'estimated' } | null {
  if (!voice) return null;
  const toks = text.split(/\s+/).map(normWord).filter(Boolean);
  if (!toks.length) return null;
  const first = wordTime(voice, toks[0], from);
  if (!first) return null;
  let end = first.end;
  let cursor = first.start;
  for (const t of toks.slice(1)) {
    const w = wordTime(voice, t, cursor, first.start + 30);
    if (w) {
      end = Math.max(end, w.end);
      cursor = w.start;
    }
  }
  return { start: first.start, end, source: first.source };
}

export interface CompileInput {
  script: ShotScript;
  voice: VoiceWords | null;
  /** Recipe context for shots that leave `elements` out (content built from the brief). */
  recipeCtx?: RecipeCtx;
  rtl: boolean;
  orientation: 'portrait' | 'landscape' | 'square';
  /** Film seconds before the voice starts (direct() puts it 0.35 s in). */
  voiceOffset?: number;
}

export function compileShots(input: CompileInput): { resolved: ResolvedShot[]; report: CompileReport } {
  const { script, voice } = input;
  const report: CompileReport = { version: 1, shots: script.shots.length, decisions: [], mappings: [], warnings: [], timing: [], rng: [] };
  const decide = (shot: string, field: string, value: unknown, source: DecisionSource, note?: string) => report.decisions.push({ shot, field, value, source, note });
  const warn = (code: string, message: string, shot?: string) => report.warnings.push({ shot, code, message });
  const map = (shot: string, field: string, requested: string, used: string, why: string) => {
    report.mappings.push({ shot, field, requested, used, why });
    warn('MAPPED', `${field} "${requested}" → "${used}" (${why})`, shot);
  };

  // ── families, variants, content
  // P1 Stage mode: shots.json carries a `stage`; stage-shot families are drawn by the Stage (global
  // elements + camera), so their camera, motion chain and transitions belong to the Stage Compiler.
  const stageMode = !!script.stage;
  const base = script.shots.map((s, i) => {
    const def = SceneRegistry.get(s.sceneFamily);
    if (!def) throw new Error(`shots[${i}] (${s.id}): unknown sceneFamily "${s.sceneFamily}" — use one of the existing scene families (nitaaq scenes)`);
    const m = def.manifest;
    let variant = s.variant ?? '';
    if (!variant || !m.variants.includes(variant)) {
      const pref = m.aspectVariants?.[input.orientation]?.[0] ?? m.defaultVariant;
      if (s.variant) map(s.id, 'variant', s.variant, pref, `not a variant of ${m.id} (${m.variants.join(', ')})`);
      else decide(s.id, 'variant', pref, 'engine', 'script left it out: the family’s preferred variant for this aspect (deterministic)');
      variant = pref;
    } else decide(s.id, 'variant', variant, 'script');
    let content = s.elements as Record<string, unknown> | undefined;
    if (!content && m.id === 'stage-shot') content = {};
    if (!content) {
      const recipe = input.recipeCtx ? RECIPES.find((r) => r.family === m.id && r.when(input.recipeCtx!)) : undefined;
      if (!recipe) throw new Error(`shots[${i}] (${s.id}): no elements given and no recipe can build "${m.id}" from the brief — write the scene's content in "elements"`);
      content = recipe.build(input.recipeCtx!);
      decide(s.id, 'elements', '(built from the brief)', 'engine', `recipe for ${m.id}`);
    }
    const parsed = m.content.safeParse(content);
    if (!parsed.success) throw new Error(`shots[${i}] (${s.id}) elements do not fit ${m.id}: ${parsed.error.issues.slice(0, 4).map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
    content = parsed.data as Record<string, unknown>;
    const beat = (BEATS as string[]).includes(s.purpose) ? (s.purpose as Beat) : PURPOSE_BEAT[s.purpose.toLowerCase()] ?? (m.beats[0] as Beat) ?? 'bridge';
    if (beat !== s.purpose) decide(s.id, 'beat', beat, 'mapped', `purpose "${s.purpose}" → beat`);
    return { s, i, m, variant, content, beat };
  });

  // ── transitions (needed for timing: the next scene starts `duration` before this one ends)
  const transitions = base.map(({ s, i }) => {
    const last = i === base.length - 1;
    const raw = typeof s.transitionOut === 'string' ? s.transitionOut : s.transitionOut?.type;
    if (last || !raw || raw === 'none') return null;
    if (stageMode && (base[i].m.id === 'stage-shot' || isObjectTransition(raw))) {
      // the Stage performs it (object transition) or falls back on stage (reported in stage_report.json):
      // scene time = film time, no overlap
      decide(s.id, 'transitionOut', `${raw} (stage)`, 'script', s.transitionReason);
      return { type: 'cut', duration: 0, reason: (s.transitionReason ?? raw).trim() };
    }
    let type = raw;
    if (!TRANSITIONS[type]) {
      const alias = TRANSITION_ALIASES[type.toLowerCase()];
      const used = alias && TRANSITIONS[alias] ? alias : 'crossfade';
      map(s.id, 'transitionOut', type, used, alias ? 'nearest existing transition' : 'unknown transition: the calmest existing one');
      type = used;
    }
    const req = TRANSITIONS[type].requires;
    if (req === 'shared') {
      map(s.id, 'transitionOut', type, 'scale-match', 'a measured shared element is not planned from the script yet (element persistence is P1)');
      type = 'scale-match';
    } else if (req === 'product' && !JSON.stringify(base[i].content).match(/"product(-\d+)?"/)) {
      map(s.id, 'transitionOut', type, 'light-sweep', 'object-sweep needs a product in the outgoing shot');
      type = 'light-sweep';
    } else if (req === 'text' && !base[i + 1]) type = 'crossfade';
    const asked = typeof s.transitionOut === 'object' ? s.transitionOut.duration : undefined;
    const duration = type === 'cut' ? 0 : asked ?? TRANSITIONS[type].duration ?? 0.5;
    decide(s.id, 'transitionOut', `${type} ${duration}s`, 'script', s.transitionReason);
    return { type, duration: r2(duration), reason: s.transitionReason!.trim() };
  });

  // ── timing: voice first (anchors), script durations otherwise
  const anchors = base.map(({ s }) => s.voiceAnchor);
  const starts: number[] = [];
  const voiceStarts: (number | null)[] = [];
  let cursor = 0;
  for (const { s } of base) {
    let t: number | null = null;
    if (s.voiceAnchor?.start !== undefined) t = s.voiceAnchor.start;
    else if (s.voiceAnchor?.text) {
      const a = anchorTime(voice, s.voiceAnchor.text, cursor);
      if (a) t = a.start;
      else warn('ANCHOR_NOT_FOUND', `voiceAnchor "${s.voiceAnchor.text}" not found in the voice map${voice ? '' : ' (no voice map)'}; using timing.duration`, s.id);
    }
    voiceStarts.push(t);
    if (t !== null) cursor = t;
  }
  const lead = 0.12; // the picture changes just before the phrase begins
  const durations: number[] = [];
  let film = 0;
  base.forEach(({ s, i, m }) => {
    const out = transitions[i]?.duration ?? 0;
    let dur: number;
    let source: 'voice' | 'script' = 'script';
    const nextV = voiceStarts[i + 1];
    if (i < base.length - 1 && nextV !== null && nextV !== undefined) {
      // the next shot should be fully on screen when its words start: next start = nextV − lead − its transition-in
      const nextStart = Math.max(film + 0.5, nextV - lead - out * 0.5);
      dur = nextStart - film + out;
      source = 'voice';
    } else if (i === base.length - 1 && anchors[i]?.text && voice) {
      const a = anchorTime(voice, anchors[i]!.text!, voiceStarts[i] ?? film);
      dur = Math.max(s.timing.duration ?? 0, a ? a.end - film + 1.2 : 0);
      source = a ? 'voice' : 'script';
    } else dur = s.timing.duration ?? m.defaultDuration;
    if (source === 'voice' && s.timing.duration && Math.abs(s.timing.duration - dur) > 0.6) warn('TIMING_VOICE_WINS', `script duration ${s.timing.duration}s differs from the voice timing ${r2(dur)}s — voice wins`, s.id);
    const min = Math.max(m.minDuration, s.timing.minHold ? s.timing.minHold + out : 0);
    if (dur < min) {
      warn('DURATION_RAISED', `${r2(dur)}s is below ${m.id}'s minimum ${min}s`, s.id);
      dur = min;
    }
    if (dur > m.maxDuration) {
      warn('DURATION_CAPPED', `${r2(dur)}s is above ${m.id}'s maximum ${m.maxDuration}s`, s.id);
      dur = m.maxDuration;
    }
    dur = r2(dur);
    durations.push(dur);
    starts.push(r2(film));
    report.timing.push({ shot: s.id, start: r2(film), duration: dur, source, anchor: anchors[i]?.text });
    film += dur - out;
  });

  // ── per-shot direction
  const resolved: ResolvedShot[] = base.map(({ s, i, m, variant, content, beat }) => {
    const start = starts[i];
    const dur = durations[i];
    const winEnd = start + dur;
    const local = (t: ShotTime | undefined, what: string): number | null => {
      if (t === undefined) return null;
      if (typeof t === 'number') return Math.min(dur, t);
      const w = wordTime(voice, t.slice(5), start - 0.3, winEnd);
      if (!w) {
        warn('WORD_NOT_FOUND', `${what}: spoken word "${t.slice(5)}" not found inside this shot${voice ? '' : ' (no voice map)'}`, s.id);
        return null;
      }
      return r2(Math.max(0, w.start - start));
    };

    const staged = stageMode && m.id === 'stage-shot';
    // camera (stage shots: the global camera of the Stage)
    let camera: ResolvedShot['camera'] = null;
    if (staged) decide(s.id, 'camera', s.camera === 'static' ? 'static' : s.camera.move, 'script', 'global stage camera');
    else if (s.camera !== 'static') {
      let move = s.camera.move;
      let preset: string | undefined;
      if (CAMERA_PRESETS[move]) {
        preset = move;
        move = CAMERA_PRESETS[move].move;
      } else if (!(CAMERA_MOVES as readonly string[]).includes(move)) {
        const alias = CAMERA_ALIASES[move.toLowerCase()];
        const used = alias ?? 'drift';
        map(s.id, 'camera', move, used, alias ? 'nearest existing move' : 'unknown move: a barely-there drift');
        move = used;
      }
      // a generic "pan"/"truck" follows the reading direction (RTL reads right → left)
      if (!input.rtl && /^(pan|truck|track)$/i.test(s.camera.move)) move = move.replace('left', 'right');
      const st = local(s.camera.startAt, 'camera.startAt');
      const en = local(s.camera.endAt, 'camera.endAt');
      const accents = (s.camera.accents ?? []).map((a) => local(a, 'camera.accents')).filter((x): x is number => x !== null);
      const plan: CameraPlan = {
        move: move as CameraPlan['move'],
        amplitude: s.camera.amplitude ?? 0.8,
        ...(st !== null ? { start: r2(Math.min(0.9, st / dur)) } : {}),
        ...(en !== null ? { end: r2(Math.max(0.1, Math.min(1, en / dur))) } : {}),
        ...(s.camera.ease ? { ease: s.camera.ease } : {}),
        ...(accents.length ? { accents } : {}),
        ...(preset ? { preset } : {}),
        reason: s.cameraReason!.trim(),
      } as CameraPlan;
      if (move !== 'static') camera = { plan, reason: s.cameraReason!.trim(), target: s.cameraTarget };
      decide(s.id, 'camera', `${move}${preset ? ` (${preset})` : ''}`, 'script', s.cameraReason);
    } else {
      decide(s.id, 'camera', 'static', 'script');
      if (s.cameraTarget && s.shotSize !== 'wide') camera = { plan: { move: 'static', amplitude: 0, reason: `framing: ${s.shotSize} on ${s.cameraTarget}` } as CameraPlan, reason: `static ${s.shotSize} framing`, target: s.cameraTarget };
    }

    // typography
    let text: ResolvedShot['text'];
    if (s.typography) {
      text = {};
      for (const [role, fam] of Object.entries(s.typography) as [keyof NonNullable<ResolvedShot['text']>, string | undefined][]) {
        if (!fam) continue;
        if (TextMotionRegistry.get(fam)) {
          text[role] = fam;
          decide(s.id, `typography.${role}`, fam, 'script');
        } else {
          map(s.id, `typography.${role}`, fam, '(engine choice)', 'unknown text motion family');
        }
      }
    }

    // lifecycle: sustain / exit / emphasis / hold
    const lifecycle: LifecycleSpec = {};
    const scriptedAt = new Map<string, number>();
    for (const ev of staged ? [] : s.motionChain) {
      if (ev.action === 'sustain') {
        const mode = ev.style && ['still', 'drift', 'breathe', 'parallax', 'auto'].includes(ev.style) ? (ev.style as LifecycleSpec['sustain']) : 'auto';
        if (ev.style && mode === 'auto') map(s.id, 'motionChain.sustain', ev.style, 'auto', 'sustain styles: still, drift, breathe, parallax');
        if (lifecycle.sustain && lifecycle.sustain !== mode) warn('SUSTAIN_PER_ELEMENT', `per-element sustain (${ev.element}: ${mode}) is applied to the whole shot — element-level sustain is P1`, s.id);
        lifecycle.sustain = mode;
        decide(s.id, 'sustain', mode, 'script', ev.reason);
      } else if (ev.action === 'exit') {
        const style = ev.style && ['handoff', 'lift', 'fade', 'scale-down', 'none'].includes(ev.style) ? ev.style : 'handoff';
        if (ev.style && style !== ev.style) map(s.id, 'motionChain.exit', ev.style, style, 'exit styles: handoff, lift, fade, scale-down, none');
        const at = local(ev.at, 'motionChain.exit.at');
        lifecycle.exit = {
          style: style as NonNullable<LifecycleSpec['exit']>['style'],
          ...(ev.direction ? { direction: ev.direction } : {}),
          ...(ev.velocity !== undefined ? { velocity: ev.velocity } : {}),
          ...(at !== null ? { lead: r2(Math.max(0.15, dur - (transitions[i]?.duration ?? 0) - at)) } : {}),
          ...(s.transitionTarget ? { handoffTarget: s.transitionTarget } : {}),
        } as LifecycleSpec['exit'];
        decide(s.id, 'exit', style, 'script', ev.reason);
      } else if (ev.action === 'emphasis') {
        const word = ev.element.startsWith('word:') ? ev.element.slice(5) : typeof ev.at === 'string' ? ev.at.slice(5) : ev.element;
        if (!s.emphasisWords.includes(word)) s.emphasisWords.push(word);
        if (typeof ev.at === 'number') scriptedAt.set(word, Math.min(dur, ev.at));
      } else if (ev.action === 'enter') {
        warn('ENTRANCE_SCENE_OWNED', `entrance of "${ev.element}" keeps the scene's own choreography (per-element entrance timing is Stage Composition, P1)`, s.id);
      }
    }
    const emphasis: NonNullable<LifecycleSpec['emphasis']> = [];
    const accents: number[] = [];
    for (const w of staged ? [] : s.emphasisWords) {
      const hit = wordTime(voice, w, start - 0.3, winEnd);
      if (hit) {
        const at = r2(Math.max(0, hit.start - start));
        emphasis.push({ word: w, at, end: r2(hit.end - start), source: hit.source === 'measured' ? 'voice' : 'estimated', accent: 'pulse' });
        accents.push(at);
        decide(s.id, `emphasis:${w}`, `${at}s`, 'voice', hit.source);
      } else {
        const given = scriptedAt.get(w);
        const at = r2(given ?? Math.min(dur * 0.5, 0.9));
        emphasis.push({ word: w, at, source: 'script', accent: 'pulse' });
        if (given !== undefined) decide(s.id, `emphasis:${w}`, `${at}s`, 'script', 'time written in the motion chain');
        else decide(s.id, `emphasis:${w}`, `${at}s`, 'fallback', voice ? 'word not found in the voice map: shown after the entrance' : 'no voice: shown after the entrance');
      }
    }
    if (emphasis.length) lifecycle.emphasis = emphasis;
    if (s.hold) lifecycle.hold = { intentional: s.hold.intentional, reason: s.hold.reason, ...(s.hold.maxSec ? { maxSec: s.hold.maxSec } : {}) };
    // the highlight array of the content is where text emphasis lives — add emphasised words that occur in the copy (never invented)
    if (emphasis.length) {
      const copy = JSON.stringify(content);
      const hl = Array.isArray(content.highlight) ? [...(content.highlight as string[])] : [];
      for (const e of emphasis) if (copy.includes(e.word) && !hl.includes(e.word)) hl.push(e.word);
      if (hl.length && m.content.safeParse({ ...content, highlight: hl }).success) content = { ...content, highlight: hl };
    }
    if (staged) {
      // emphasis, continuity and framing are compiled by the Stage
    } else if (s.audioCues.length) warn('AUDIO_CUES_RECORDED', `${s.audioCues.length} audio cue(s) recorded in the shot; the Sound Director keeps placing cues automatically (cue authoring from the script is P1)`, s.id);
    if (!staged && s.continuity) warn('CONTINUITY_RECORDED', `continuity "${s.continuity.element ?? s.continuity.note ?? s.continuity.from}" recorded; element persistence across shots is P1`, s.id);
    if (!staged && s.shotSize !== 'wide' && !s.cameraTarget) warn('SHOT_SIZE_NO_TARGET', `shotSize "${s.shotSize}" needs a cameraTarget to frame; kept at the scene's own framing`, s.id);
    decide(s.id, 'intensity', s.expectedEnergy, 'script');
    return {
      shot: s,
      index: i,
      beat,
      family: m.id,
      variant,
      start,
      duration: dur,
      transition: transitions[i],
      camera,
      text,
      lifecycle,
      content,
      accents,
      intensity: r2(Math.max(0.25, Math.min(1, s.expectedEnergy))),
    };
  });
  report.rng.push(
    { field: 'element micro-motion', scope: 'scene components', note: 'seeded per scene (particle drift, stagger jitter): non-directorial details' },
    ...resolved.filter((r) => !r.text).map((r) => ({ field: 'typography', scope: r.shot.id, note: 'not in the script: the text motion planner chose (seeded, deterministic)' })),
  );
  return { resolved, report };
}

/** PlannedScene list for the existing Creative Director (it adds intents, hero, physics; we re-apply script decisions after). */
export function plannedScenes(resolved: ResolvedShot[]): PlannedStoryboard {
  const scenes: PlannedScene[] = resolved.map((r) => ({
    id: r.shot.id,
    beat: r.beat,
    purpose: r.shot.message,
    start: r.start,
    duration: r.duration,
    visibleMessage: r.shot.message,
    supportingVisual: r.shot.subject,
    family: r.family,
    variant: r.variant,
    composition: r.shot.composition,
    movement: r.shot.motionIntent,
    transition: r.transition?.type ?? 'none',
    soundEvents: r.shot.audioCues.map((c) => c.sound),
    emphasis: r.shot.emphasisWords.join(', '),
    ctaRelation: r.beat === 'cta' ? 'is the CTA' : 'leads to the CTA',
    content: r.content,
    camera: r.camera && r.camera.plan.move !== 'static' ? LEGACY_CAMERA(r.camera.plan.move) : 'none',
    intensity: r.intensity,
    transitionDuration: r.transition?.duration ?? 0,
    ...(r.shot.voiceAnchor?.text ? { narration: { start: r.start, end: r.start + r.duration, text: r.shot.voiceAnchor.text } } : {}),
  }));
  return { totalDuration: r2(resolved.reduce((a, r) => a + r.duration - (r.transition?.duration ?? 0), 0)), scenes };
}

/** After the Creative Director: the script's decisions win over its seeded choices. */
export function reapplyShotDecisions(board: PlannedStoryboard, resolved: ResolvedShot[], directions?: { scenes: { text?: Record<string, string>; transitionReason?: string }[] }): void {
  board.scenes.forEach((s, i) => {
    const r = resolved[i];
    s.duration = r.duration;
    s.start = r.start;
    s.variant = r.variant;
    s.content = r.content;
    s.intensity = r.intensity;
    const engineType = s.transition;
    s.transition = r.transition?.type ?? 'none';
    s.transitionDuration = r.transition?.duration ?? 0;
    // the continuity hint belongs to the transition the engine chose; keep it only when the script chose the same one
    if (s.transitionHint && engineType !== s.transition) delete s.transitionHint;
    if (r.camera) {
      s.camera = r.camera.plan.move === 'static' ? 'none' : LEGACY_CAMERA(r.camera.plan.move);
      s.cameraPlan = { ...r.camera.plan };
    } else {
      s.camera = 'none';
      delete s.cameraPlan;
    }
    // voice emphasis first; music downbeats the engine found stay as secondary micro accents away from spoken words
    const music = (s.accents ?? []).filter((a) => a < r.duration && !r.accents.some((v) => Math.abs(v - a) < 0.35));
    const acc = [...r.accents, ...music].sort((a, b) => a - b);
    s.accents = acc.length ? acc : undefined;
    const d = directions?.scenes[i];
    if (d) {
      if (r.text) d.text = { ...(d.text ?? {}), ...r.text };
      if (r.transition) d.transitionReason = r.transition.reason;
    }
  });
}

/** VideoSpec fields only a shot script carries: lifecycle, shot metadata, principled model, director metadata. */
export function applyShotSpec(spec: VideoSpec, resolved: ResolvedShot[], meta: { shotScript: string; voiceMap?: string }): VideoSpec {
  spec.scenes.forEach((sc, i) => {
    const r = resolved[i];
    if (!r || sc.id !== r.shot.id) return;
    sc.motion = { ...sc.motion, intensity: r.intensity };
    if (Object.keys(r.lifecycle).length) sc.motion.lifecycle = r.lifecycle;
    if (r.camera) sc.motion.cameraPlan = { ...r.camera.plan };
    else delete sc.motion.cameraPlan;
    if (r.text) sc.motion.text = { ...(sc.motion.text ?? {}), ...r.text };
    if (sc.transition && r.transition) sc.transition = { ...sc.transition, type: r.transition.type, duration: r.transition.duration, reason: r.transition.reason };
    (sc as { shot?: unknown }).shot = {
      id: r.shot.id,
      purpose: r.shot.purpose,
      message: r.shot.message,
      shotSize: r.shot.shotSize,
      subject: r.shot.subject,
      ...(r.shot.cameraTarget ? { cameraTarget: r.shot.cameraTarget } : {}),
      ...(r.camera ? { cameraReason: r.camera.reason } : {}),
      ...(r.transition ? { transitionReason: r.transition.reason } : {}),
      expectedEnergy: r.shot.expectedEnergy,
      ...(r.shot.voiceAnchor ? { voiceAnchor: { text: r.shot.voiceAnchor.text, start: r.start, end: r.start + r.duration, source: 'voice' } } : {}),
    };
  });
  const staged = resolved.some((r) => r.family === 'stage-shot');
  spec.motion = { ...spec.motion, model: staged ? 'stage' : 'principled' };
  spec.metadata = { ...spec.metadata, director: { mode: 'full', shotScript: meta.shotScript, ...(meta.voiceMap ? { voiceMap: meta.voiceMap } : {}) } } as VideoSpec['metadata'];
  return spec;
}
