/**
 * P0 (Better Directed Movement): shot script validation + compiler, principled lifecycle, motion
 * metrics, voice map (with and without Whisper), Full vs Fast mode, legacy fallback.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateShotScript, type ShotScript } from '../../src/director/shot-script';
import { compileShots, plannedScenes, reapplyShotDecisions, applyShotSpec, wordTime, anchorTime, type VoiceWords } from '../../src/director/shot-compiler';
import { framingFor, matchTarget } from '../../src/director/camera-target';
import { resolveExit, sustainFor, exitWindow, exitP, exitStyle, lifecycleStyle, emphasisPulse, type LifeCtx } from '../../src/motion/lifecycle';
import { computeMotionMetrics, classifyHold, staticRuns, compareMetrics, occupancy, motionProfileOf, METRICS_VERSION, type FrameSeries } from '../../src/qc/motion-metrics';
import { normWord, tokenize, estimateWordTimes, pausesFrom, keywordsOf, buildVoiceMap, refineWithEnergy, findWord } from '../../src/audio/voice-map';
import { voiceMap } from '../../src/node/voice-map';
import { analyzeMotion, analysisSize } from '../../src/node/motion-analysis';
import { isFullDirector } from '../../src/node/produce';
import { ffmpegRun } from '../../src/node/audio';
import { VideoSchema, type VideoSpec } from '../../src/schema/video';
import { SceneRegistry } from '../../src/scenes';

const fx = (f: string) => join(__dirname, '../fixtures', f);

// ───────────────────────────── shot script
const shot = (over: Record<string, unknown> = {}) => ({
  id: 'hook',
  purpose: 'hook',
  message: 'كل المواعيد في مكان واحد',
  subject: 'headline',
  sceneFamily: 'kinetic-title',
  elements: { title: 'مواعيدك كلها في مكان واحد', highlight: ['مكان واحد'] },
  motionIntent: 'the promise lands',
  timing: { duration: 3 },
  ...over,
});
const two = (a: Record<string, unknown> = {}, b: Record<string, unknown> = {}) => ({
  version: 1,
  shots: [shot({ transitionOut: 'push', transitionReason: 'the energy continues into the problem', ...a }), shot({ id: 'end', purpose: 'cta', ...b })],
});

describe('Shot script validation', () => {
  it('accepts a complete script and the camera shorthand', () => {
    const r = validateShotScript(two({ camera: 'push-in', cameraReason: 'lean in on the promise' }));
    expect(r.ok).toBe(true);
  });
  it('requires a reason for every camera move', () => {
    const r = validateShotScript(two({ camera: { move: 'push-in' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/shots\[0\]\.cameraReason/);
  });
  it('requires a reason for every transition, and a transition out of every shot but the last', () => {
    const noReason = validateShotScript(two({ transitionReason: undefined }));
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.errors.join('\n')).toMatch(/transitionReason/);
    const noTransition = validateShotScript(two({ transitionOut: undefined, transitionReason: undefined }));
    expect(noTransition.ok).toBe(false);
    const lastOut = validateShotScript(two({}, { transitionOut: 'push', transitionReason: 'nowhere to go' }));
    expect(lastOut.ok).toBe(false);
  });
  it('requires a reason for motion events and rejects bad targets / ids / missing timing', () => {
    expect(validateShotScript(two({ motionChain: [{ element: 'headline', action: 'exit' }] })).ok).toBe(false);
    expect(validateShotScript(two({ transitionTarget: 'somewhere' })).ok).toBe(false);
    expect(validateShotScript(two({}, { id: 'hook' })).ok).toBe(false);
    expect(validateShotScript(two({ timing: {} })).ok).toBe(false);
    expect(validateShotScript(two({ timing: {}, voiceAnchor: { text: 'مواعيدك' } })).ok).toBe(true);
  });
});

const compile = (raw: unknown, voice: VoiceWords | null = null) => {
  const v = validateShotScript(raw);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return compileShots({ script: v.script, voice, rtl: true, orientation: 'landscape' });
};

describe('Shot compiler', () => {
  it('compiles script decisions verbatim (camera, transition, typography, timing, intensity)', () => {
    const { resolved, report } = compile(two({ camera: { move: 'dolly-in', amplitude: 0.5 }, cameraReason: 'weight on the promise', typography: { headline: 'ar-cluster-rise' }, expectedEnergy: 0.9 }));
    expect(resolved[0].camera?.plan).toMatchObject({ move: 'dolly-in', amplitude: 0.5, reason: 'weight on the promise' });
    expect(resolved[0].transition).toEqual({ type: 'push', duration: 0.45, reason: 'the energy continues into the problem' });
    expect(resolved[0].text).toEqual({ headline: 'ar-cluster-rise' });
    expect(resolved[0].intensity).toBe(0.9);
    expect(resolved[0].duration).toBe(3);
    expect(resolved[1].start).toBeCloseTo(3 - 0.45, 5);
    expect(report.decisions.filter((d) => d.shot === 'hook' && d.source === 'script').map((d) => d.field)).toEqual(expect.arrayContaining(['camera', 'transitionOut', 'typography.headline', 'intensity']));
  });
  it('is deterministic: the same script compiles to the same decisions', () => {
    const raw = two({ camera: 'drift', cameraReason: 'keep the reading hold alive' });
    expect(JSON.stringify(compile(raw).resolved)).toBe(JSON.stringify(compile(raw).resolved));
  });
  it('maps unsupported capabilities to the nearest one and reports it (never silently)', () => {
    const { resolved, report } = compile(two({ camera: 'dolly', cameraReason: 'a slow approach', transitionOut: 'dissolve', typography: { headline: 'no-such-family' } }));
    expect(resolved[0].camera?.plan.move).toBe('dolly-in');
    expect(resolved[0].transition?.type).toBe('crossfade');
    expect(resolved[0].text).toEqual({});
    expect(report.mappings.map((m) => `${m.field}:${m.requested}->${m.used}`)).toEqual(['transitionOut:dissolve->crossfade', 'camera:dolly->dolly-in', 'typography.headline:no-such-family->(engine choice)']);
    expect(report.warnings.filter((w) => w.code === 'MAPPED')).toHaveLength(3);
    const shared = compile(two({ transitionOut: 'shared' }));
    expect(shared.resolved[0].transition?.type).toBe('scale-match');
    const unknownMove = compile(two({ camera: 'barrel-roll', cameraReason: 'because' + ' it is fun' }));
    expect(unknownMove.resolved[0].camera?.plan.move).toBe('drift');
  });
  it('records what P0 does not implement yet instead of dropping it', () => {
    const { report } = compile(two({ audioCues: [{ at: 1, sound: 'whoosh' }], continuity: { element: 'logo' }, motionChain: [{ element: 'title', action: 'enter', reason: 'arrives first' }], shotSize: 'close' }));
    expect(report.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['AUDIO_CUES_RECORDED', 'CONTINUITY_RECORDED', 'ENTRANCE_SCENE_OWNED', 'SHOT_SIZE_NO_TARGET']));
  });
  it('rejects unknown scene families and content that does not fit the family', () => {
    expect(() => compile(two({ sceneFamily: 'no-such-scene' }))).toThrow(/unknown sceneFamily/);
    expect(() => compile(two({ elements: { nope: 1 } }))).toThrow(/do not fit kinetic-title/);
  });
  it('falls back to the family variant for this aspect and reports an unknown variant', () => {
    const { resolved, report } = compile(two({ variant: 'nonexistent' }));
    expect(SceneRegistry.get('kinetic-title')!.manifest.variants).toContain(resolved[0].variant);
    expect(report.mappings[0]).toMatchObject({ field: 'variant', requested: 'nonexistent' });
  });
  it('turns the motion chain into a lifecycle (sustain, exit, hold, emphasis) and adds emphasis to the copy', () => {
    const { resolved } = compile(
      two({
        motionChain: [
          { element: 'card', action: 'sustain', style: 'drift', reason: 'alive while read' },
          { element: 'headline', action: 'exit', style: 'lift', direction: 'up', reason: 'lift into the next idea' },
          { element: 'word:كلها', action: 'emphasis', at: 1.2, reason: 'the scope word' },
        ],
        hold: { reason: 'let the promise rest', maxSec: 1.2 },
      }),
    );
    expect(resolved[0].lifecycle).toMatchObject({ sustain: 'drift', exit: { style: 'lift', direction: 'up' }, hold: { intentional: true, maxSec: 1.2 } });
    expect(resolved[0].lifecycle.emphasis).toEqual([{ word: 'كلها', at: 1.2, source: 'script', accent: 'pulse' }]);
    expect(resolved[0].content.highlight).toEqual(['مكان واحد', 'كلها']);
  });
});

// a voice map stand-in: "مواعيدك كلها في مكان واحد" then "ابدأ الآن"
const VOICE: VoiceWords = {
  words: [
    ['مواعيدك', 0.4, 0.95],
    ['كلها', 1.0, 1.3],
    ['في', 1.35, 1.45],
    ['مكان', 1.5, 1.85],
    ['واحد', 1.9, 2.3],
    ['ابدأ', 3.4, 3.8],
    ['الآن', 3.85, 4.3],
  ].map(([t, s, e]) => ({ text: t as string, norm: normWord(t as string), start: s as number, end: e as number, source: 'measured' as const })),
};

describe('Voice-timed shots (voice is the primary clock)', () => {
  it('finds spoken words and phrases (Arabic-aware)', () => {
    expect(wordTime(VOICE, 'الان')?.start).toBe(3.85);
    expect(wordTime(VOICE, 'مَكانٍ')?.start).toBe(1.5);
    expect(anchorTime(VOICE, 'مكان واحد', 0)).toEqual({ start: 1.5, end: 2.3, source: 'measured' });
    expect(wordTime(VOICE, 'مكان', 2)).toBeNull();
  });
  it('cuts each shot so the next one is on screen when its words begin; emphasis lands on the spoken word', () => {
    const raw = {
      shots: [
        shot({ timing: {}, voiceAnchor: { text: 'مواعيدك كلها في مكان واحد' }, emphasisWords: ['مكان واحد'], transitionOut: 'cut', transitionReason: 'a hard cut on the next phrase' }),
        shot({ id: 'cta', purpose: 'cta', timing: {}, voiceAnchor: { text: 'ابدأ الآن' } }),
      ],
    };
    const { resolved, report } = compile(raw, VOICE);
    // next phrase starts 3.4 s → the cut lands 0.12 s before it
    expect(resolved[1].start).toBeCloseTo(3.28, 2);
    expect(report.timing.map((t) => t.source)).toEqual(['voice', 'voice']);
    expect(resolved[0].lifecycle.emphasis?.[0]).toMatchObject({ word: 'مكان واحد', at: 1.5, source: 'voice' });
    expect(resolved[0].accents).toEqual([1.5]);
    // the last shot runs to the end of its words + 1.2 s
    expect(resolved[1].start + resolved[1].duration).toBeCloseTo(4.3 + 1.2, 1);
  });
  it('camera times can be spoken words', () => {
    const { resolved } = compile(two({ camera: { move: 'push-in', startAt: 'word:مكان', accents: ['word:واحد'] }, cameraReason: 'push in as the promise is said' }), VOICE);
    expect(resolved[0].camera?.plan.start).toBeCloseTo(0.5, 2);
    expect(resolved[0].camera?.plan.accents).toEqual([1.9]);
  });
  it('reports anchors and words that are not in the voice', () => {
    const { report } = compile(two({ voiceAnchor: { text: 'كلمة غير موجودة' }, emphasisWords: ['غائبة'] }), VOICE);
    expect(report.warnings.map((w) => w.code)).toContain('ANCHOR_NOT_FOUND');
    expect(report.decisions.find((d) => d.field === 'emphasis:غائبة')?.source).toBe('fallback');
  });
});

describe('Full Director Mode spec (compiler → existing VideoSpec)', () => {
  const baseSpec = (): VideoSpec =>
    VideoSchema.parse({
      project: { id: 'p0', title: 'p0' },
      canvas: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
      style: { preset: 'clean-corporate' },
      scenes: [
        { id: 'hook', type: 'kinetic-title', duration: 3, content: { title: 'مواعيدك كلها في مكان واحد' }, transition: { type: 'crossfade', duration: 0.5 }, motion: { camera: 'drift', cameraPlan: { move: 'arc' } } },
        { id: 'end', type: 'kinetic-title', duration: 3, content: { title: 'ابدأ الآن' } },
      ],
    });
  it('the script wins over the engine (camera, transition) and switches on the principled model', () => {
    const { resolved } = compile(two({ camera: 'static', transitionOut: 'whip', transitionReason: 'a fast handover', motionChain: [{ element: 'headline', action: 'exit', style: 'handoff', reason: 'carry the energy out' }] }));
    const board = plannedScenes(resolved);
    // the Creative Director's seeded choices…
    board.scenes[0].camera = 'push';
    board.scenes[0].cameraPlan = { move: 'orbit-left', amplitude: 1 } as never;
    board.scenes[0].transition = 'iris';
    reapplyShotDecisions(board, resolved);
    expect(board.scenes[0].camera).toBe('none');
    expect(board.scenes[0].cameraPlan).toBeUndefined();
    expect(board.scenes[0].transition).toBe('whip');
    const spec = applyShotSpec(baseSpec(), resolved, { shotScript: 'shots.json' });
    expect(spec.motion.model).toBe('principled');
    expect(isFullDirector(spec)).toBe(true);
    expect(spec.scenes[0].motion.cameraPlan).toBeUndefined();
    expect(spec.scenes[0].transition).toMatchObject({ type: 'whip', reason: 'a fast handover' });
    expect(spec.scenes[0].motion.lifecycle?.exit?.style).toBe('handoff');
    expect((spec.scenes[0] as { shot?: { purpose: string } }).shot?.purpose).toBe('hook');
    expect(VideoSchema.safeParse(spec).success).toBe(true);
  });
  it('Fast Mode is the default: an old video.json has no director block and keeps the legacy model', () => {
    const spec = baseSpec();
    expect(isFullDirector(spec)).toBe(false);
    expect(spec.motion.model).toBeUndefined();
    expect(spec.scenes[0].motion.lifecycle).toBeUndefined();
  });
});

describe('Camera targets', () => {
  const boxes = [
    { scene: 'a', role: 'title', text: 'مواعيدك كلها', fontSize: 90, rect: { x: 600, y: 300, width: 700, height: 120 } },
    { scene: 'a', role: 'title', text: 'صغير', fontSize: 30, rect: { x: 100, y: 100, width: 100, height: 40 } },
    { scene: 'a', role: 'logo', src: 'assets/logo.png', rect: { x: 900, y: 600, width: 120, height: 120 } },
    { scene: 'b', role: 'headline', text: 'x', fontSize: 50, rect: { x: 0, y: 0, width: 10, height: 10 } },
  ];
  it('matches a role (biggest headline), an asset id, or shown words — in the right scene', () => {
    expect(matchTarget(boxes, 'a', 'headline')[0].fontSize).toBe(90);
    expect(matchTarget(boxes, 'a', 'logo', { logo: 'assets/logo.png' })).toHaveLength(1);
    expect(matchTarget(boxes, 'a', 'كلها')[0].text).toBe('مواعيدك كلها');
    expect(matchTarget(boxes, 'a', 'nothing')).toEqual([]);
  });
  it('turns a shot size into framing, and never reframes a subject that already fills the frame', () => {
    const wide = framingFor([boxes[0].rect], 1920, 1080, 'wide');
    expect(wide.target).toBeUndefined();
    expect(wide.focus.x).toBeCloseTo(950 / 1920, 3);
    const close = framingFor([boxes[2].rect], 1920, 1080, 'close');
    expect(close.target?.fill).toBe(0.68);
    expect(framingFor([{ x: 0, y: 0, width: 1800, height: 1000 }], 1920, 1080, 'close').target).toBeUndefined();
  });
});

// ───────────────────────────── principled lifecycle
const life = (over: Partial<LifeCtx> = {}): LifeCtx => ({
  holdFrames: 90,
  totalFrames: 105,
  outFrames: 15,
  last: false,
  exit: resolveExit({ rtl: true, energy: 0.5 }),
  sustain: 'auto',
  intentionalHold: false,
  emphasis: [],
  ...over,
});

describe('Principled lifecycle (anticipation → entrance → settle → sustain → exit)', () => {
  it('resolves the exit vector: shot direction > transition > reading direction', () => {
    expect(resolveExit({ rtl: true }).vector.dx).toBe(-1);
    expect(resolveExit({ rtl: false }).vector.dx).toBe(1);
    expect(resolveExit({ rtl: true, transition: { direction: 'up' } }).vector).toMatchObject({ dx: 0, dy: -1 });
    expect(resolveExit({ rtl: true, exit: { direction: 'down' }, transition: { direction: 'up' } }).vector).toMatchObject({ dx: 0, dy: 1 });
    expect(resolveExit({ rtl: true, exit: { handoffVector: { dx: 3, dy: 4 } } }).vector).toMatchObject({ dx: 0.6, dy: 0.8 });
    expect(resolveExit({ rtl: true, exit: { style: 'auto' } }).style).toBe('handoff');
  });
  it('keeps readable text still and lets other elements live', () => {
    expect(sustainFor('auto', 'text')).toBe('still');
    expect(sustainFor('auto', 'hero-title')).toBe('still');
    expect(sustainFor('auto', 'logo')).toBe('breathe');
    expect(sustainFor('auto', 'card')).toBe('drift');
    expect(sustainFor('parallax', 'text')).toBe('parallax');
  });
  it('has no exit on the last scene or with style none; a hard cut ends the exit at the cut', () => {
    expect(exitWindow(life({ last: true }), 30)).toBeNull();
    expect(exitWindow(life({ exit: { ...life().exit, style: 'none' } }), 30)).toBeNull();
    expect(exitWindow(life({ outFrames: 0 }), 30)!.end).toBe(90);
    const w = exitWindow(life(), 30)!;
    expect(w.start).toBeLessThan(90);
    expect(w.end).toBeGreaterThan(90);
  });
  it('exit accelerates monotonically and a handoff keeps the picture until late (no fake fade)', () => {
    const L = life();
    const ps = [60, 70, 80, 90, 100].map((f) => exitP(L, f, 30));
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
    expect(exitStyle(L.exit, 0.5, 10).opacity).toBe(1);
    expect(Number(exitStyle(L.exit, 1, 10).opacity)).toBeCloseTo(0.15, 5);
  });
  it('an intentional hold keeps the element still; an owned element only enters', () => {
    const base = { fps: 30, speed: 1, delay: 0, kind: 'card' as const, family: 'rise' as const, intensity: 0.6, u: 10, dir: 'rtl' as const };
    const held = lifecycleStyle({ ...base, frame: 60, life: life({ intentionalHold: true }) });
    expect(held.transform ?? '').not.toMatch(/translate\((?!0\.00px, 0\.00px)/);
    const drifting = lifecycleStyle({ ...base, frame: 60, life: life({ holdFrames: 200, totalFrames: 215 }) });
    expect(drifting.transform).toMatch(/translate/);
    const owned = lifecycleStyle({ ...base, frame: 100, owned: true, life: life() });
    expect(owned.opacity ?? 1).toBe(1);
  });
  it('emphasis pulses on the spoken word and decays', () => {
    expect(emphasisPulse(1.0, 1.5)).toBe(0);
    expect(emphasisPulse(1.6, 1.5)).toBeGreaterThan(0.5);
    expect(emphasisPulse(2.2, 1.5)).toBe(0);
  });
});

// ───────────────────────────── motion metrics
const series = (frames: number[][], w = 4, h = 4, fps = 10): FrameSeries => ({ fps, width: w, height: h, frames: frames.map((f) => Uint8Array.from(f)) });
const flat = (v: number) => new Array(16).fill(v);

describe('Motion metrics', () => {
  it('counts still frames and static runs like the architecture review (|Δ| < 0.15 at 10 fps)', () => {
    const f = [...Array.from({ length: 10 }, (_, i) => flat(i * 10)), ...Array.from({ length: 21 }, () => flat(100))];
    const m = computeMotionMetrics({ series: series(f), spec: null, video: 'x', stage: 'external' });
    expect(m.global.stillFrameRatio).toBeCloseTo(20 / 30, 3);
    expect(m.global.longestStaticHold.sec).toBe(2);
    expect(staticRuns([1, 0, 0, 0, 0, 0, 1], 10, 0.5)).toEqual([{ start: 0.1, end: 0.6 }]);
  });
  it('separates intentional, resolving, beat and dead holds', () => {
    const spec = VideoSchema.parse({
      project: { id: 'm', title: 'm' },
      canvas: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
      style: { preset: 'clean-corporate' },
      scenes: [
        { id: 'a', type: 'kinetic-title', duration: 4, content: { title: 'x' }, motion: { lifecycle: { hold: { intentional: true, reason: 'let it land', maxSec: 2 } } } },
        { id: 'b', type: 'kinetic-title', duration: 4, content: { title: 'y' } },
        { id: 'c', type: 'logo-animation', duration: 4, content: { logo: 'logo' } },
      ],
    });
    expect(classifyHold({ start: 0, end: 0.8 }, null, spec, 3).class).toBe('beat');
    expect(classifyHold({ start: 1, end: 2.9 }, { id: 'a', type: 'kinetic-title', index: 0 }, spec, 3).class).toBe('intentional');
    expect(classifyHold({ start: 1, end: 3.5 }, { id: 'a', type: 'kinetic-title', index: 0 }, spec, 3).class).toBe('dead');
    expect(classifyHold({ start: 5, end: 7 }, { id: 'b', type: 'kinetic-title', index: 1 }, spec, 3).class).toBe('dead');
    expect(classifyHold({ start: 9, end: 10.4 }, { id: 'c', type: 'logo-animation', index: 2 }, spec, 3).class).toBe('resolve');
    expect(classifyHold({ start: 9, end: 12 }, { id: 'c', type: 'logo-animation', index: 2 }, spec, 3).class).toBe('dead');
  });
  it('uses a motion profile per kind of film, not one threshold', () => {
    expect(motionProfileOf(null).id).toBe('ad');
    expect(motionProfileOf({ genre: 'logo', direction: { pace: 'medium' } } as VideoSpec).stillTarget).toBeGreaterThan(motionProfileOf({ genre: 'kinetic', direction: { pace: 'medium' } } as VideoSpec).stillTarget);
  });
  it('measures frame occupancy against the background', () => {
    const f = Uint8Array.from([0, 0, 0, 0, 0, 200, 200, 0, 0, 200, 200, 0, 0, 0, 0, 0]);
    expect(occupancy(f, 4, 4)).toBeCloseTo(0.25, 5);
  });
  it('measures word sync: distance from a spoken word to the visual onset', () => {
    const f = [...Array.from({ length: 15 }, () => flat(50)), ...Array.from({ length: 5 }, (_, i) => flat(60 + i * 20)), ...Array.from({ length: 10 }, () => flat(140))];
    const m = computeMotionMetrics({ series: series(f), spec: null, video: 'x', stage: 'external', words: [{ word: 'مكان', start: 1.4, end: 1.8 }] });
    expect(m.global.wordSync?.matched).toBe(1);
    expect(m.global.wordSync!.meanErrorMs!).toBeLessThanOrEqual(100);
  });
  it('compares before/after with direction-aware "improved"', () => {
    const still = computeMotionMetrics({ series: series(Array.from({ length: 30 }, () => flat(10))), spec: null, video: 'a', stage: 'external' });
    const moving = computeMotionMetrics({ series: series(Array.from({ length: 30 }, (_, i) => flat((i * 7) % 250))), spec: null, video: 'b', stage: 'external' });
    const rows = compareMetrics(still, moving);
    expect(rows.find((r) => r.metric === 'still frame ratio')).toMatchObject({ improved: true });
    expect(rows.find((r) => r.metric === 'motion energy (mean)')).toMatchObject({ improved: true });
    expect(rows.find((r) => r.metric === 'word sync error (mean)')).toMatchObject({ improved: null });
  });
  it('decodes a real video: 2 s of motion then a frozen 2 s tail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitaaq-mm-'));
    const out = join(dir, 'test-16x9.mp4');
    ffmpegRun(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-vf', 'tpad=stop_mode=clone:stop_duration=2', '-pix_fmt', 'yuv420p', out], 'test video');
    expect(analysisSize(320, 180)).toEqual([114, 64]);
    const { metrics, file } = analyzeMotion(out, { out: join(dir, 'motion_metrics.json') });
    expect(metrics.global.longestStaticHold.sec).toBeGreaterThan(1.8);
    expect(metrics.global.stillFrameRatio).toBeGreaterThan(0.4);
    expect(metrics.global.stillFrameRatio).toBeLessThan(0.6);
    expect(JSON.parse(readFileSync(file!, 'utf8')).version).toBe(METRICS_VERSION);
  });
});

// ───────────────────────────── voice map
describe('Voice map (pure)', () => {
  it('normalises Arabic for matching (tashkeel, tatweel, alef forms, ta marbuta, Arabic digits)', () => {
    expect(normWord('مَـوْعِدٌ')).toBe('موعد');
    expect(normWord('أإآا')).toBe('اااا');
    expect(normWord('ساعة')).toBe(normWord('ساعه'));
    expect(normWord('٢٠')).toBe('20');
  });
  it('tokenises with clause ends', () => {
    expect(tokenize('مرحبا، كيف الحال؟ جيد').map((t) => `${t.text}${t.clauseEnd ? '|' : ''}`)).toEqual(['مرحبا|', 'كيف', 'الحال|', 'جيد']);
  });
  it('estimates word times only inside speech and never across a silence', () => {
    const segs = [{ start: 0, end: 1 }, { start: 2, end: 3 }];
    const w = estimateWordTimes('واحد اثنان ثلاثة اربعة', segs);
    expect(w).toHaveLength(4);
    for (const x of w) {
      const seg = segs[x.segment];
      expect(x.start).toBeGreaterThanOrEqual(seg.start - 1e-9);
      expect(x.end).toBeLessThanOrEqual(seg.end + 1e-9);
      expect(x.source).toBe('estimated');
    }
    // clause-aligned when clauses and segments match one-to-one
    const c = estimateWordTimes('هذا أول. وهذا ثاني', segs);
    expect(c.map((x) => x.segment)).toEqual([0, 0, 1, 1]);
  });
  it('snaps estimated word boundaries to measured energy dips', () => {
    const words = estimateWordTimes('ab cd', [{ start: 0, end: 1 }]);
    const curve = Array.from({ length: 20 }, (_, i) => (i === 14 ? 0.01 : 1));
    const r = refineWithEnergy(words, { hop: 0.05, curve });
    expect(r[1].start).toBeCloseTo(0.75, 2);
  });
  it('classifies pauses and finds keywords (article folded, stopwords out)', () => {
    expect(pausesFrom([{ start: 0, end: 1 }, { start: 1.2, end: 2 }, { start: 2.6, end: 3 }, { start: 4, end: 5 }]).map((p) => p.kind)).toEqual(['breath', 'phrase', 'section']);
    const k = keywordsOf([{ text: 'المنصة', start: 0 }, { text: 'منصة', start: 1 }, { text: 'في', start: 2 }, { text: '20', start: 3 }]);
    expect(k[0]).toMatchObject({ word: 'المنصة', count: 2 });
    expect(k.map((x) => x.word)).not.toContain('في');
    expect(k.map((x) => x.word)).toContain('20');
  });
  it('labels measured vs estimated vs inferred, applies the offset, and never claims emotion', () => {
    const whisper = { language: 'ar', model: 'small', text: ' مرحبا بكم', segments: [{ start: 0.2, end: 1.2, text: ' مرحبا بكم' }], words: [{ word: ' مرحبا', start: 0.2, end: 0.6, probability: 0.9 }, { word: ' بكم', start: 0.65, end: 1.1, probability: 0.8 }] };
    const m = buildVoiceMap({ audio: 'a.wav', duration: 2, offset: 0.35, speech: [{ start: 0.2, end: 1.2 }], whisper, energy: { hop: 0.05, curve: [] } });
    expect(m.engine.name).toBe('faster-whisper');
    expect(m.words[0]).toMatchObject({ text: 'مرحبا', start: 0.55, confidence: 0.9, source: 'measured' });
    expect(m.provenance).toMatchObject({ words: 'measured', emphasisCandidates: 'inferred', keywords: 'inferred' });
    expect(m.confidence.timing).toBe('word-measured');
    expect(JSON.stringify(m)).not.toMatch(/"emotion"\s*:/);
    expect(m.notes[0]).toMatch(/No emotion detection/);
    const est = buildVoiceMap({ audio: 'a.wav', duration: 2, speech: [{ start: 0.2, end: 1.2 }], whisper: null, whisperReason: 'not installed', transcript: 'مرحبا بكم' });
    expect(est.engine).toMatchObject({ name: 'silencedetect+transcript', whisper: { available: false, reason: 'not installed' } });
    expect(est.provenance.words).toBe('estimated');
    const seg = buildVoiceMap({ audio: 'a.wav', duration: 2, speech: [{ start: 0.2, end: 1.2 }] });
    expect(seg.confidence.timing).toBe('segment-only');
    expect(findWord(m, 'بِكُم')?.start).toBe(1.0);
  });
});

describe('Voice map (node, real Arabic speech with exact word times)', () => {
  const truth = JSON.parse(readFileSync(fx('voice/speech-ar.truth.json'), 'utf8')) as { text: string; words: { word: string; start: number; end: number }[] };
  it('falls back to silencedetect + transcript when Whisper is unavailable, within ~0.1 s per word', () => {
    const { map } = voiceMap(fx('voice/speech-ar.wav'), { transcript: truth.text, out: false, runner: () => ({ result: null, reason: 'faster-whisper is not installed' }) });
    expect(map.engine.name).toBe('silencedetect+transcript');
    expect(map.engine.whisper.reason).toMatch(/not installed/);
    expect(map.words).toHaveLength(truth.words.length);
    const errs = map.words.map((w, i) => Math.abs(w.start - truth.words[i].start));
    expect(errs.reduce((a, b) => a + b, 0) / errs.length).toBeLessThan(0.1);
    expect(Math.max(...errs)).toBeLessThan(0.25);
    expect(map.pauses.filter((p) => p.sec > 0.5)).toHaveLength(2);
  });
  it('uses Whisper word times when the local model runs (measured)', () => {
    const fake = { language: 'ar', model: 'small', text: truth.text, segments: [{ start: 0.4, end: 10.9, text: truth.text }], words: truth.words.map((w) => ({ word: w.word, start: w.start, end: w.end, probability: 0.95 })) };
    const { map } = voiceMap(fx('voice/speech-ar.wav'), { out: false, offset: 0.35, runner: () => ({ result: fake }) });
    expect(map.engine.name).toBe('faster-whisper');
    expect(map.words[3]).toMatchObject({ text: 'تجمع', source: 'measured' });
    expect(map.words[3].start).toBeCloseTo(truth.words[3].start + 0.35, 3);
  });
  it('without Whisper and without a transcript: segments and pauses only', () => {
    const { map } = voiceMap(fx('voice/speech-ar.wav'), { out: false, engine: 'silence' });
    expect(map.words).toHaveLength(0);
    expect(map.confidence.timing).toBe('segment-only');
    expect(map.segments).toHaveLength(3);
  });
  it('engine "whisper" refuses to fall back silently', () => {
    expect(() => voiceMap(fx('voice/speech-ar.wav'), { out: false, engine: 'whisper', runner: () => ({ result: null, reason: 'model download blocked' }) })).toThrow(/model download blocked/);
  });
});
