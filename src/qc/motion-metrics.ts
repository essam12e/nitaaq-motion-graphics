/**
 * Motion Metrics (P0-A): measures how a film MOVES, from its decoded frames plus what the
 * spec says each shot intends. Pure: the node side (src/node/motion-analysis.ts) decodes the
 * video into small grey frames and hands them here.
 *
 * Measured from pixels (analysis at 10 fps on a ~64×114 grey thumbnail, the same method as the
 * architecture review so numbers are comparable):
 *   still frame ratio · longest static hold · average hold · motion energy curve ·
 *   frame occupancy (approx.) · motion density · detected cuts · camera activity (proxy) ·
 *   entrance-then-hold pattern per shot · word sync error (when word timings exist)
 * Inferred from the spec (labelled `source: 'spec'`):
 *   planned camera activity · typography activity · cut rhythm of the edit
 *
 * Holds are classified, not just counted:
 *   intentional — the shot declared a deliberate hold (lifecycle.hold) and it is within maxSec
 *   resolve     — the closing logo/CTA settling, up to 1.5 s without a declaration
 *   beat        — a short pause (≤ 1 s): rhythm, not a problem
 *   dead        — anything else: nothing moves and nothing said it should be still
 *
 * P0 rule: measure first. Nothing here blocks delivery; findings are warnings and a baseline.
 */
import type { VideoSpec } from '../schema/video';
import { buildTimeline } from '../core/timeline';

export const METRICS_VERSION = 1;
/** Mean absolute grey difference (0–255) under which two analysis frames count as "the same picture". */
export const STILL_THRESHOLD = 0.15;
export const ANALYSIS_FPS = 10;

export interface FrameSeries {
  fps: number;
  width: number;
  height: number;
  /** Grey frames, row-major, width*height each. */
  frames: Uint8Array[];
}

export type HoldClass = 'intentional' | 'resolve' | 'beat' | 'dead';

export interface StaticRange {
  start: number;
  end: number;
  sec: number;
  scene: string | null;
  class: HoldClass;
  why: string;
}

export interface SceneMetrics {
  id: string;
  type: string;
  start: number;
  end: number;
  stillFrameRatio: number;
  longestStaticHold: number;
  motionEnergy: number;
  /** Share of the shot's motion energy in its first 35 % (≥ 0.75 = "entrance then nothing"). */
  frontLoad: number;
  occupancy: number;
  motionDensity: number;
  cameraPlanned: string | null;
  cameraMeasured: number;
  deadHoldSec: number;
  intentionalHoldSec: number;
  exitMotion: number;
}

export interface MotionMetrics {
  version: number;
  source: { video: string; stage: string; analysisFps: number; size: [number, number]; threshold: number; durationSec: number };
  profile: { id: string; stillTarget: number; why: string };
  global: {
    score: number;
    stillFrameRatio: number;
    longestStaticHold: { sec: number; start: number; end: number; scene: string | null; class: HoldClass | null };
    longestDeadHold: number;
    averageHoldDuration: number;
    holds: number;
    deadHoldSec: number;
    intentionalHoldSec: number;
    motionEnergy: { mean: number; p50: number; p90: number; curve: { t: number; e: number }[] };
    frameOccupancy: { mean: number; min: number; note: string };
    motionDensity: { mean: number; note: string };
    cutRhythm: { source: string; shots: number; meanShot: number; cv: number; detectedCuts: number[] };
    repeatedEntrance: { pairs: number; repeated: number; ratio: number; frontLoadedShots: number; note: string };
    cameraActivity: { planned: number; measuredProxy: number; note: string };
    typographyActivity: { inferred: number; source: 'spec'; note: string };
    wordSync?: WordSync;
  };
  scenes: SceneMetrics[];
  staticRanges: StaticRange[];
  suspiciousHolds: StaticRange[];
  warnings: { code: string; scene?: string; message: string }[];
  notes: string[];
}

export interface WordSync {
  words: number;
  matched: number;
  meanErrorMs: number | null;
  p90ErrorMs: number | null;
  missed: number;
  /** Words where the picture reacts (response ≥ 1.5). */
  responsive: number;
  perWord: { word: string; at: number; onset: number | null; errorMs: number | null; response: number }[];
  source: string;
  note: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Nearest-rank quantile (p90 of [10, 400] is 400, not 10). */
const quant = (a: number[], q: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
};

/** Frame-to-frame statistics: mean abs diff, share of pixels that changed, share that changed a lot. */
export function frameDiffs(series: FrameSeries): { d: number[]; changed: number[]; wide: number[] } {
  const d: number[] = [];
  const changed: number[] = [];
  const wide: number[] = [];
  const n = series.width * series.height;
  for (let i = 1; i < series.frames.length; i++) {
    const a = series.frames[i - 1];
    const b = series.frames[i];
    let sum = 0;
    let ch = 0;
    for (let k = 0; k < n; k++) {
      const x = Math.abs(a[k] - b[k]);
      sum += x;
      if (x > 2) ch++;
    }
    d.push(sum / n);
    changed.push(ch / n);
    wide.push(ch / n > 0.5 ? 1 : 0);
  }
  return { d, changed, wide };
}

/** Rough frame occupancy: share of pixels that differ from the frame's border colour (its background). */
export function occupancy(frame: Uint8Array, w: number, h: number, tol = 10): number {
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(frame[x], frame[(h - 1) * w + x]);
  for (let y = 0; y < h; y++) border.push(frame[y * w], frame[y * w + w - 1]);
  border.sort((a, b) => a - b);
  const bg = border[Math.floor(border.length / 2)];
  let n = 0;
  for (let k = 0; k < frame.length; k++) if (Math.abs(frame[k] - bg) > tol) n++;
  return n / frame.length;
}

/** Static runs (≥ minSec) in a diff series sampled at `fps`. Times are in seconds of the video. */
export function staticRuns(d: number[], fps: number, minSec = 0.5, threshold = STILL_THRESHOLD): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let runStart = -1;
  for (let i = 0; i <= d.length; i++) {
    const still = i < d.length && d[i] < threshold;
    if (still && runStart < 0) runStart = i;
    if (!still && runStart >= 0) {
      // diff i compares frame i and i+1: a run of k still diffs spans k/fps seconds
      const len = (i - runStart) / fps;
      if (len >= minSec - 1e-9) out.push({ start: r2(runStart / fps), end: r2(i / fps) });
      runStart = -1;
    }
  }
  return out;
}

/** The film's motion profile: how much stillness is normal for this kind of film (not one threshold for all). */
export function motionProfileOf(spec: VideoSpec | null): { id: string; stillTarget: number; why: string } {
  const genre = spec?.genre ?? 'auto';
  const pace = spec?.direction.pace ?? 'medium';
  if (genre === 'logo') return { id: 'logo-sting', stillTarget: 0.5, why: 'a logo sting resolves on a held mark' };
  if (genre === 'kinetic' || genre === 'music' || pace === 'fast') return { id: 'kinetic', stillTarget: 0.25, why: 'kinetic / fast films keep moving' };
  if (genre === 'explainer' || genre === 'saas' || genre === 'whiteboard' || genre === 'data') return { id: 'explainer', stillTarget: 0.35, why: 'explainers need reading time but not frozen slides' };
  if (pace === 'slow') return { id: 'calm', stillTarget: 0.4, why: 'a slow, premium pace allows longer settles' };
  return { id: 'ad', stillTarget: 0.3, why: 'social ads keep the frame alive' };
}

interface SceneWindow {
  id: string;
  type: string;
  start: number;
  end: number;
  holdEnd: number;
  index: number;
}

function sceneWindows(spec: VideoSpec | null): SceneWindow[] {
  if (!spec) return [];
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  return tl.entries.map((e, i) => ({ id: e.id, type: spec.scenes[i].type, start: e.from / tl.fps, end: (e.from + e.durationInFrames) / tl.fps, holdEnd: (e.from + e.durationInFrames - e.transitionOut) / tl.fps, index: i }));
}

const CLOSING = /logo|cta|brand|end-card|outro/;

/** Classify one static run against what its shot declared. */
export function classifyHold(run: { start: number; end: number }, scene: { id: string; type: string; index: number } | null, spec: VideoSpec | null, sceneCount: number): { class: HoldClass; why: string } {
  const sec = run.end - run.start;
  if (sec <= 1.0) return { class: 'beat', why: 'short pause (≤ 1 s)' };
  const sc = scene && spec ? spec.scenes[scene.index] : undefined;
  const hold = sc?.motion?.lifecycle?.hold;
  if (hold?.intentional) {
    const max = hold.maxSec ?? 2.5;
    if (sec <= max + 0.05) return { class: 'intentional', why: `declared hold${hold.reason ? `: ${hold.reason}` : ''} (≤ ${max} s)` };
    return { class: 'dead', why: `declared hold is ${r2(sec)} s, longer than its ${max} s${hold.reason ? ` (${hold.reason})` : ''}` };
  }
  if (scene && scene.index === sceneCount - 1 && CLOSING.test(scene.type) && sec <= 1.5) return { class: 'resolve', why: 'closing logo/CTA settles (≤ 1.5 s without a declared hold)' };
  return { class: 'dead', why: `${r2(sec)} s with no visible change and no declared reason` };
}

export interface MetricsInput {
  series: FrameSeries;
  spec: VideoSpec | null;
  video: string;
  stage: 'animatic' | 'final' | 'external';
  /** Word timings (video seconds) to check visual sync against (emphasis words). */
  words?: { word: string; start: number; end: number }[];
  wordSource?: string;
}

/**
 * The motion onset nearest to t within ±win: a step where the picture starts changing (rises above
 * twice the still threshold from below it, or jumps by ≥ 50 %). Diff i compares frames i and i+1, so
 * the change begins at i/fps.
 */
export function nearestOnset(d: number[], fps: number, t: number, win = 0.6): number | null {
  const i0 = Math.max(1, Math.floor((t - win) * fps));
  const i1 = Math.min(d.length - 1, Math.ceil((t + win) * fps));
  let best: number | null = null;
  for (let i = i0; i <= i1; i++) {
    const onset = d[i] >= STILL_THRESHOLD * 2 && (d[i - 1] < STILL_THRESHOLD * 2 || d[i] >= d[i - 1] * 1.5);
    if (onset && (best === null || Math.abs(i / fps - t) < Math.abs(best - t))) best = i / fps;
  }
  return best;
}

/** Motion response to a word: energy in the 0.4 s after it starts ÷ energy in the 0.5 s before (≥ 1.5 = the picture reacts). */
export function wordResponse(d: number[], fps: number, t: number): number {
  const mean = (a: number, b: number) => {
    const sl = d.slice(Math.max(0, Math.floor(a * fps)), Math.max(0, Math.ceil(b * fps)));
    return sl.length ? sl.reduce((x, y) => x + y, 0) / sl.length : 0;
  };
  const before = mean(t - 0.6, t - 0.1);
  const after = mean(t, t + 0.4);
  return Math.round((after / Math.max(STILL_THRESHOLD, before)) * 100) / 100;
}

export function computeMotionMetrics(input: MetricsInput): MotionMetrics {
  const { series, spec } = input;
  const fps = series.fps;
  const { d, changed, wide } = frameDiffs(series);
  const dur = series.frames.length / fps;
  const scenes = sceneWindows(spec);
  const sceneAt = (t: number) => scenes.find((s) => t >= s.start && t < s.end) ?? null;
  const transitionAt = (t: number) => scenes.some((s, i) => i > 0 && t >= s.start && t < scenes[i - 1].end);
  const profile = motionProfileOf(spec);

  // ── stills and holds
  const stillRatio = d.length ? d.filter((x) => x < STILL_THRESHOLD).length / d.length : 0;
  const runs = staticRuns(d, fps, 0.5);
  const ranges: StaticRange[] = runs.map((r) => {
    // the scene that owns most of the run
    const mid = (r.start + r.end) / 2;
    const sc = sceneAt(mid);
    const c = classifyHold(r, sc, spec, scenes.length);
    return { start: r.start, end: r.end, sec: r2(r.end - r.start), scene: sc?.id ?? null, class: c.class, why: c.why };
  });
  const longest = ranges.reduce<StaticRange | null>((b, r) => (!b || r.sec > b.sec ? r : b), null);
  const dead = ranges.filter((r) => r.class === 'dead');
  const holdRanges = ranges.filter((r) => r.sec > 1.0);
  const deadSec = dead.reduce((a, r) => a + r.sec, 0);
  const intentSec = ranges.filter((r) => r.class === 'intentional' || r.class === 'resolve').reduce((a, r) => a + r.sec, 0);

  // ── energy curve (0.5 s bins)
  const bin = Math.max(1, Math.round(fps * 0.5));
  const curve: { t: number; e: number }[] = [];
  for (let i = 0; i < d.length; i += bin) {
    const sl = d.slice(i, i + bin);
    curve.push({ t: r2(i / fps), e: r3(sl.reduce((a, x) => a + x, 0) / sl.length) });
  }

  // ── occupancy (sampled every 0.5 s)
  const occ: number[] = [];
  for (let i = 0; i < series.frames.length; i += bin) occ.push(occupancy(series.frames[i], series.width, series.height));

  // ── detected cuts (a big change in one step)
  const cuts: number[] = [];
  d.forEach((x, i) => {
    if (x > 12 && (i === 0 || d[i - 1] < x * 0.5)) cuts.push(r2((i + 1) / fps));
  });

  // ── per scene
  const sceneMetrics: SceneMetrics[] = scenes.map((s) => {
    const i0 = Math.max(0, Math.floor(s.start * fps));
    const i1 = Math.min(d.length, Math.ceil(s.end * fps));
    const holdI1 = Math.min(d.length, Math.ceil(s.holdEnd * fps));
    const sd = d.slice(i0, i1);
    const inner = d.slice(i0, holdI1);
    const energy = inner.reduce((a, x) => a + x, 0);
    const k35 = Math.max(1, Math.round(inner.length * 0.35));
    const front = inner.slice(0, k35).reduce((a, x) => a + x, 0);
    const sceneRuns = staticRuns(sd, fps, 0.5);
    const rs = ranges.filter((r) => r.scene === s.id);
    const occS = occ.filter((_, k) => k * bin >= i0 && k * bin < i1);
    const sc = spec?.scenes[s.index];
    const plan = sc?.motion?.cameraPlan;
    const exitI0 = Math.max(i0, holdI1 - Math.round(0.45 * fps));
    const exitE = d.slice(exitI0, holdI1).reduce((a, x) => a + x, 0) / Math.max(1, holdI1 - exitI0);
    return {
      id: s.id,
      type: s.type,
      start: r2(s.start),
      end: r2(s.end),
      stillFrameRatio: r3(sd.length ? sd.filter((x) => x < STILL_THRESHOLD).length / sd.length : 0),
      longestStaticHold: r2(sceneRuns.reduce((a, r) => Math.max(a, r.end - r.start), 0)),
      motionEnergy: r3(sd.length ? sd.reduce((a, x) => a + x, 0) / sd.length : 0),
      frontLoad: r3(energy > 0 ? front / energy : 1),
      occupancy: r3(occS.length ? occS.reduce((a, x) => a + x, 0) / occS.length : 0),
      motionDensity: r3(sd.length ? changed.slice(i0, i1).reduce((a, x) => a + x, 0) / sd.length : 0),
      cameraPlanned: plan && plan.move !== 'static' ? plan.move : plan?.preset ?? (sc?.motion?.camera && sc.motion.camera !== 'none' ? sc.motion.camera : null),
      cameraMeasured: r3(sd.length ? wide.slice(i0, i1).filter((x, k) => x && !transitionAt((i0 + k) / fps)).length / sd.length : 0),
      deadHoldSec: r2(rs.filter((r) => r.class === 'dead').reduce((a, r) => a + r.sec, 0)),
      intentionalHoldSec: r2(rs.filter((r) => r.class === 'intentional' || r.class === 'resolve').reduce((a, r) => a + r.sec, 0)),
      exitMotion: r3(exitE),
    };
  });

  // ── repeated "entrance then hold" pattern: consecutive shots whose motion envelopes look the same
  const envelope = (s: SceneWindow) => {
    const i0 = Math.floor(s.start * fps);
    const out: number[] = [];
    for (let k = 0; k < 20; k++) {
      const a = i0 + Math.floor((k / 20) * (s.holdEnd - s.start) * fps);
      const b = i0 + Math.floor(((k + 1) / 20) * (s.holdEnd - s.start) * fps);
      const sl = d.slice(a, Math.max(a + 1, b));
      out.push(sl.reduce((x, y) => x + y, 0) / Math.max(1, sl.length));
    }
    const tot = out.reduce((a, x) => a + x, 0) || 1;
    return out.map((x) => x / tot);
  };
  const cos = (a: number[], b: number[]) => {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < a.length; i++) {
      ab += a[i] * b[i];
      aa += a[i] * a[i];
      bb += b[i] * b[i];
    }
    return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
  };
  const envs = scenes.map(envelope);
  let repeated = 0;
  for (let i = 1; i < envs.length; i++) if (cos(envs[i - 1], envs[i]) > 0.9 && sceneMetrics[i - 1].frontLoad >= 0.7 && sceneMetrics[i].frontLoad >= 0.7) repeated++;
  const frontLoaded = sceneMetrics.filter((s) => s.frontLoad >= 0.75).length;

  // ── cut rhythm of the edit (spec) + detected cuts (pixels)
  const shotLens = scenes.map((s) => s.holdEnd - s.start);
  const meanShot = shotLens.length ? shotLens.reduce((a, x) => a + x, 0) / shotLens.length : 0;
  const cv = meanShot ? Math.sqrt(shotLens.reduce((a, x) => a + (x - meanShot) ** 2, 0) / shotLens.length) / meanShot : 0;

  // ── camera: planned share of film time vs a pixel proxy (whole-frame change outside transitions)
  const plannedSec = sceneMetrics.reduce((a, s, i) => a + (s.cameraPlanned ? scenes[i].holdEnd - scenes[i].start : 0), 0);
  const wideOutside = wide.filter((x, i) => x && !transitionAt(i / fps)).length;

  // ── typography activity (spec-inferred): seconds in which text is entering, emphasised or leaving
  let typoSec = 0;
  if (spec) {
    const principled = spec.motion?.model === 'principled';
    scenes.forEach((s, i) => {
      const sc = spec.scenes[i];
      const len = s.holdEnd - s.start;
      let t = Math.min(len, 1.2); // entrances
      t += Math.min(len * 0.3, (sc.motion?.lifecycle?.emphasis?.length ?? 0) * 0.5);
      if (principled && i < scenes.length - 1) t += Math.min(0.5, len * 0.15);
      typoSec += Math.min(len, t);
    });
  }

  // ── word sync (measured): distance from each emphasised word to the nearest visual motion onset
  let wordSync: WordSync | undefined;
  if (input.words?.length) {
    const errs: number[] = [];
    let missed = 0;
    const perWord: WordSync['perWord'] = [];
    for (const w of input.words) {
      const on = nearestOnset(d, fps, w.start);
      const err = on === null ? null : Math.round(Math.abs(on - w.start) * 1000);
      if (err === null) missed++;
      else errs.push(err);
      perWord.push({ word: w.word, at: r2(w.start), onset: on === null ? null : r2(on), errorMs: err, response: wordResponse(d, fps, w.start) });
    }
    wordSync = {
      words: input.words.length,
      matched: errs.length,
      meanErrorMs: errs.length ? Math.round(errs.reduce((a, x) => a + x, 0) / errs.length) : null,
      p90ErrorMs: errs.length ? Math.round(quant(errs, 0.9)) : null,
      missed,
      responsive: perWord.filter((w) => w.response >= 1.5).length,
      perWord,
      source: input.wordSource ?? 'voice map',
      note: 'onset = nearest step within ±0.6 s where the picture starts changing (10 fps: ±100 ms resolution); response = motion energy in the 0.4 s after the word ÷ the 0.5 s before. Pixel-level only: it cannot tell WHICH element moved, so unrelated motion near a word counts',
    };
  }

  // ── warnings + score (informational in P0)
  const warnings: MotionMetrics['warnings'] = [];
  for (const r of dead) if (r.sec >= 1.5) warnings.push({ code: r.sec >= 3 ? 'DEAD_HOLD_LONG' : 'DEAD_HOLD', scene: r.scene ?? undefined, message: `${r.sec} s frozen at ${r.start}–${r.end} s: ${r.why}` });
  for (const s of sceneMetrics) if (s.frontLoad >= 0.8 && s.end - s.start > 2.2) warnings.push({ code: 'ENTRANCE_THEN_HOLD', scene: s.id, message: `${Math.round(s.frontLoad * 100)}% of the shot's motion happens in its first 35%: entrance → hold` });
  if (stillRatio > profile.stillTarget + 0.15) warnings.push({ code: 'STILL_RATIO_HIGH', message: `${Math.round(stillRatio * 100)}% still frames (profile ${profile.id} expects about ≤ ${Math.round(profile.stillTarget * 100)}%)` });
  if (repeated >= 2) warnings.push({ code: 'REPEATED_ENTRANCE', message: `${repeated} consecutive shot pairs share the same entrance → hold envelope` });
  const occMean = occ.length ? occ.reduce((a, x) => a + x, 0) / occ.length : 0;
  if (occMean < 0.12) warnings.push({ code: 'LOW_OCCUPANCY', message: `elements cover about ${Math.round(occMean * 100)}% of the frame on average` });

  const pen =
    Math.max(0, stillRatio - profile.stillTarget) * 80 +
    Math.max(0, deadSec - 1) * 4 +
    Math.max(0, (longest && longest.class === 'dead' ? longest.sec : 0) - 2) * 5 +
    (envs.length > 1 ? (repeated / (envs.length - 1)) * 15 : 0) +
    frontLoaded * 2;
  const score = Math.max(0, Math.min(100, Math.round(100 - pen)));

  return {
    version: METRICS_VERSION,
    source: { video: input.video, stage: input.stage, analysisFps: fps, size: [series.width, series.height], threshold: STILL_THRESHOLD, durationSec: r2(dur) },
    profile,
    global: {
      score,
      stillFrameRatio: r3(stillRatio),
      longestStaticHold: longest ? { sec: longest.sec, start: longest.start, end: longest.end, scene: longest.scene, class: longest.class } : { sec: 0, start: 0, end: 0, scene: null, class: null },
      longestDeadHold: r2(dead.reduce((a, r) => Math.max(a, r.sec), 0)),
      averageHoldDuration: r2(holdRanges.length ? holdRanges.reduce((a, r) => a + r.sec, 0) / holdRanges.length : 0),
      holds: holdRanges.length,
      deadHoldSec: r2(deadSec),
      intentionalHoldSec: r2(intentSec),
      motionEnergy: { mean: r3(d.length ? d.reduce((a, x) => a + x, 0) / d.length : 0), p50: r3(quant(d, 0.5)), p90: r3(quant(d, 0.9)), curve },
      frameOccupancy: { mean: r3(occMean), min: r3(occ.length ? Math.min(...occ) : 0), note: 'share of pixels that differ from the border colour by > 10 grey levels (approximate: gradients and textures count as content)' },
      motionDensity: { mean: r3(changed.length ? changed.reduce((a, x) => a + x, 0) / changed.length : 0), note: 'share of pixels that change between analysis frames' },
      cutRhythm: { source: spec ? 'spec + pixels' : 'pixels', shots: scenes.length, meanShot: r2(meanShot), cv: r3(cv), detectedCuts: cuts },
      repeatedEntrance: { pairs: Math.max(0, envs.length - 1), repeated, ratio: r3(envs.length > 1 ? repeated / (envs.length - 1) : 0), frontLoadedShots: frontLoaded, note: 'consecutive shots whose motion envelopes match (cosine > 0.9) and are both front-loaded' },
      cameraActivity: { planned: r3(dur ? plannedSec / dur : 0), measuredProxy: r3(wide.length ? wideOutside / wide.length : 0), note: 'planned = share of film time with a camera move in the spec; proxy = share of analysis frames where > 50% of pixels change outside transitions' },
      typographyActivity: { inferred: r3(dur ? typoSec / dur : 0), source: 'spec', note: 'inferred from the spec (entrances, word-timed emphasis, exits), not measured from pixels' },
      ...(wordSync ? { wordSync } : {}),
    },
    scenes: sceneMetrics,
    staticRanges: ranges,
    suspiciousHolds: dead.filter((r) => r.sec >= 1.5),
    warnings,
    notes: [
      `still = mean |Δgrey| < ${STILL_THRESHOLD} between frames ${1 / fps}s apart on a ${series.width}×${series.height} grey thumbnail (same method as the architecture review)`,
      'a very slow camera drift can count as still at this resolution; contact sheets confirm what the numbers say',
      'P0: metrics are a baseline and warnings only — they never block delivery',
    ],
  };
}

/** Compact Before/After comparison of two metric reports. */
export function compareMetrics(before: MotionMetrics, after: MotionMetrics) {
  const g = (m: MotionMetrics) => m.global;
  const row = (label: string, a: number | null | undefined, b: number | null | undefined, unit = '', better: 'lower' | 'higher' = 'lower') => ({
    metric: label,
    before: a ?? null,
    after: b ?? null,
    unit,
    change: a != null && b != null ? r3(b - a) : null,
    improved: a != null && b != null ? (better === 'lower' ? b < a : b > a) : null,
  });
  return [
    row('still frame ratio', g(before).stillFrameRatio, g(after).stillFrameRatio, 'ratio'),
    row('longest static hold', g(before).longestStaticHold.sec, g(after).longestStaticHold.sec, 's'),
    row('longest dead hold', g(before).longestDeadHold, g(after).longestDeadHold, 's'),
    row('average hold', g(before).averageHoldDuration, g(after).averageHoldDuration, 's'),
    row('dead hold total', g(before).deadHoldSec, g(after).deadHoldSec, 's'),
    row('motion energy (mean)', g(before).motionEnergy.mean, g(after).motionEnergy.mean, 'grey/frame', 'higher'),
    row('motion density', g(before).motionDensity.mean, g(after).motionDensity.mean, 'ratio', 'higher'),
    row('frame occupancy', g(before).frameOccupancy.mean, g(after).frameOccupancy.mean, 'ratio', 'higher'),
    row('camera activity (proxy)', g(before).cameraActivity.measuredProxy, g(after).cameraActivity.measuredProxy, 'ratio', 'higher'),
    row('camera activity (planned)', g(before).cameraActivity.planned, g(after).cameraActivity.planned, 'ratio', 'higher'),
    row('repeated entrance pairs', g(before).repeatedEntrance.repeated, g(after).repeatedEntrance.repeated, 'pairs'),
    row('front-loaded shots', g(before).repeatedEntrance.frontLoadedShots, g(after).repeatedEntrance.frontLoadedShots, 'shots'),
    row('word sync error (mean)', g(before).wordSync?.meanErrorMs, g(after).wordSync?.meanErrorMs, 'ms'),
    row('motion score', g(before).score, g(after).score, '/100', 'higher'),
  ];
}
