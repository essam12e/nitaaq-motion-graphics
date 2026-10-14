import { describe, expect, it } from 'vitest';
import { cameraVector, heroSceneOf, spatialQc, spatialSpecQc, transitionTravel } from '../../src/qc/spatial-qc';
import { VideoSchema, type VideoSpec } from '../../src/schema/video';
import { buildTimeline } from '../../src/core/timeline';
import { makeCanvasProfile } from '../../src/layout/canvas';
import type { ProbeResult } from '../../src/engine/QCProbe';
import type { VqaSample } from '../../src/qc/vqa';

const CANVAS = { '9:16': { aspect: '9:16', width: 1080, height: 1920, fps: 30 }, '16:9': { aspect: '16:9', width: 1920, height: 1080, fps: 30 } } as const;
const mk = (aspect: keyof typeof CANVAS, scenes: object[], extra: object = {}): VideoSpec =>
  VideoSchema.parse({ project: { id: 'sq', title: 't', language: 'ar' }, canvas: CANVAS[aspect], style: { preset: 'saudi-modern' }, scenes, ...extra }) as VideoSpec;
const sc = (id: string, extra: object = {}) => ({ id, type: 'title-card', duration: 3, content: { title: id }, ...extra });

const probe = (frame: number, p: Partial<ProbeResult>): ProbeResult => ({ frame, scenes: [], texts: [], media: [], boxes: [], errors: [], fonts: null, debugOverlay: false, canvas: { width: 0, height: 0 }, ...p });
const text = (scene: string, rect: { x: number; y: number; width: number; height: number }, extra: object = {}) => ({ scene, role: 'title', text: 'نص', arabic: true, critical: true, fit: 'ok', fontSize: 60, minSize: 30, lines: 1, color: '#fff', rect, overflowX: false, opacity: 1, letterSpacing: 0, direction: 'rtl', splitGlyphs: false, ...extra });
const media = (scene: string, rect: { x: number; y: number; width: number; height: number }, extra: object = {}) => ({ scene, role: 'product', src: 'p.png', fit: 'contain', identity: true, loaded: true, naturalWidth: 800, naturalHeight: 800, rect, objectFit: 'contain', opacity: 1, ...extra });

function run(spec: VideoSpec, frames: Record<number, Partial<ProbeResult>>, kinds: Record<number, VqaSample['kind']> = {}) {
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const samples: VqaSample[] = Object.keys(frames).map((f) => {
    const n = Number(f);
    const i = tl.entries.findIndex((e) => n >= e.from && n < e.from + e.durationInFrames);
    return { frame: n, time: n / 30, scene: spec.scenes[i].id, sceneIndex: i, kind: kinds[n] ?? 'hold' };
  });
  const probes = new Map(Object.entries(frames).map(([f, p]) => [Number(f), probe(Number(f), p)]));
  const canvas = makeCanvasProfile(spec.canvas.width, spec.canvas.height, spec.safeArea.preset, spec.safeArea.margin);
  return spatialQc({ spec, tl, samples, probes, canvas });
}

describe('Spatial QC', () => {
  it('a plain film passes with neutral continuity and no spatial issues (9:16 and 16:9)', () => {
    for (const a of ['9:16', '16:9'] as const) {
      const s = mk(a, [sc('a'), sc('b'), sc('c')]);
      const W = s.canvas.width;
      const H = s.canvas.height;
      const r = run(s, { 40: { texts: [text('a', { x: W * 0.2, y: H * 0.4, width: W * 0.6, height: H * 0.1 })] } });
      expect(r.issues, a).toEqual([]);
      expect(r.metrics.continuity.score).toBe(0.75);
      expect(r.metrics.score).toBe(100);
    }
  });
  it('DEPTH_TOO_CLOSE: a dolly through the hero plane without pass-through, with a repaired plan; flythrough is allowed', () => {
    const s = mk('9:16', [sc('a', { motion: { cameraPlan: { move: 'fly-through', amplitude: 1.4 } } }), sc('b')]);
    const q = spatialSpecQc(s, buildTimeline(s.scenes, 30));
    const i = q.issues.find((x) => x.code === 'DEPTH_TOO_CLOSE');
    expect(i).toBeDefined();
    const solved = i!.repair!.data!.plan as { amplitude: number };
    expect(solved.amplitude).toBeLessThan(1);
    const fixed = mk('9:16', [sc('a', { motion: { cameraPlan: solved } }), sc('b')]);
    expect(spatialSpecQc(fixed, buildTimeline(fixed.scenes, 30)).issues.filter((x) => x.code === 'DEPTH_TOO_CLOSE')).toEqual([]);
    const fly = mk('9:16', [sc('a', { motion: { cameraPlan: { preset: 'flythrough' } } }), sc('b')]);
    expect(spatialSpecQc(fly, buildTimeline(fly.scenes, 30)).issues.filter((x) => x.code === 'DEPTH_TOO_CLOSE')).toEqual([]);
  });
  it('DEPTH_OCCLUSION: a foreground card over critical text; a card behind the hero plane is fine', () => {
    const s = mk('9:16', [sc('a'), sc('b')]);
    const t = text('a', { x: 300, y: 800, width: 480, height: 120 });
    const card = (depth: number) => ({ scene: 'a', depth, pass: 1, card: true, video: false, rect: { x: 280, y: 760, width: 520, height: 300 }, opacity: 1 });
    expect(run(s, { 40: { texts: [t], layers: [card(-0.3)] } }).issues.map((i) => i.code)).toContain('DEPTH_OCCLUSION');
    expect(run(s, { 40: { texts: [t], layers: [card(0.4)] } }).issues).toEqual([]);
    // a pass-through layer already fading out does not count
    expect(run(s, { 40: { texts: [t], layers: [{ ...card(-0.3), pass: 0.2 }] } }).issues).toEqual([]);
  });
  it('hero visibility: never fully visible → error; small → warning; large and visible → coverage reported', () => {
    const s = mk('16:9', [sc('a'), sc('b', { beat: 'reveal' }), sc('c')]);
    const f = 100; // inside scene b
    expect(heroSceneOf(s)).toBe(1);
    const off = run(s, { [f]: { media: [media('b', { x: 1800, y: 300, width: 400, height: 400 })] } });
    expect(off.issues.map((i) => i.code)).toContain('HERO_NOT_VISIBLE');
    expect(off.metrics.hero?.visible).toBe(false);
    const small = run(s, { [f]: { media: [media('b', { x: 900, y: 500, width: 80, height: 80 })] } });
    expect(small.issues.map((i) => i.code)).toEqual(['HERO_TOO_SMALL']);
    const big = run(s, { [f]: { media: [media('b', { x: 660, y: 240, width: 600, height: 600 })] } });
    expect(big.issues).toEqual([]);
    expect(big.metrics.hero?.coverage).toBeCloseTo((600 * 600) / (1920 * 1080), 3);
  });
  it('safe areas for identity media differ by orientation (logo near the 9:16 bottom UI)', () => {
    const v = mk('9:16', [sc('a'), sc('b')], { safeArea: { preset: 'tiktok' } });
    const logo = media('a', { x: 440, y: 1780, width: 200, height: 100 }, { role: 'logo' });
    expect(run(v, { 40: { media: [logo] } }).issues.map((i) => i.code)).toContain('LOGO_OUTSIDE_SAFE');
    const h = mk('16:9', [sc('a'), sc('b')]);
    expect(run(h, { 40: { media: [media('a', { x: 860, y: 440, width: 200, height: 200 }, { role: 'logo' })] } }).issues).toEqual([]);
  });
  it('transition corridor: the next subject landing behind a push is flagged; landing ahead is fine', () => {
    const s = mk('16:9', [sc('a', { transition: { type: 'push', duration: 0.5 } }), sc('b')]);
    // Arabic: push travels right → left (sx = −1)
    expect(transitionTravel(s.scenes[0].transition!, 'ar')).toEqual({ sx: -1, sy: 0 });
    const left = { x: 200, y: 400, width: 300, height: 100 };
    const right = { x: 1400, y: 400, width: 300, height: 100 };
    const back = run(s, { 60: { texts: [text('a', left)] }, 100: { texts: [text('b', right)] } });
    expect(back.issues.map((i) => i.code)).toEqual(['TRANSITION_CORRIDOR']);
    expect(back.metrics.corridors[0].ok).toBe(false);
    const ahead = run(s, { 60: { texts: [text('a', right)] }, 100: { texts: [text('b', left)] } });
    expect(ahead.issues).toEqual([]);
    expect(ahead.metrics.corridors[0].ok).toBe(true);
  });
  it('transition text clash: two solid titles on top of each other mid-transition', () => {
    const s = mk('9:16', [sc('a', { transition: { type: 'crossfade', duration: 0.6 } }), sc('b')]);
    const r = { x: 200, y: 800, width: 600, height: 120 };
    expect(run(s, { 85: { texts: [text('a', r), text('b', r)] } }, { 85: 'transition' }).issues.map((i) => i.code)).toEqual(['TRANSITION_TEXT_CLASH']);
    expect(run(s, { 85: { texts: [text('a', r, { opacity: 0.5 }), text('b', r, { opacity: 0.5 })] } }, { 85: 'transition' }).issues).toEqual([]);
    // a wipe clips each scene to its side of the seam: both solid is not a clash
    const w = mk('9:16', [sc('a', { transition: { type: 'glass-wipe', duration: 0.6 } }), sc('b')]);
    expect(run(w, { 85: { texts: [text('a', r), text('b', r)] } }, { 85: 'transition' }).issues).toEqual([]);
  });
  it('motion continuity: opposing camera moves score low, matched moves high; a bridge transition helps', () => {
    const pan = (move: string) => ({ motion: { cameraPlan: { move, amplitude: 0.8 } } });
    const W = 1080;
    const v = cameraVector({ move: 'truck-left', amplitude: 0.8 } as never, 1, 2, { W, H: 1920, durationSec: 3, fps: 30 });
    expect(v?.speed).toBeGreaterThan(0);
    const fight = mk('9:16', [sc('a', pan('truck-left')), sc('b', pan('truck-right'))]);
    const same = mk('9:16', [sc('a', pan('truck-left')), sc('b', pan('truck-left'))]);
    const f = spatialSpecQc(fight, buildTimeline(fight.scenes, 30)).continuity.score;
    const m = spatialSpecQc(same, buildTimeline(same.scenes, 30)).continuity.score;
    expect(m).toBeGreaterThan(f);
    const bridged = mk('9:16', [sc('a', { ...pan('truck-left'), transition: { type: 'directional-blur', duration: 0.5 } }), sc('b', pan('truck-right'))]);
    expect(spatialSpecQc(bridged, buildTimeline(bridged.scenes, 30)).continuity.score).toBeGreaterThan(f);
  });
  it('FX budget: hand-placed accents over the film budget are flagged; peak concurrent cost measured on frames', () => {
    const fx = Array.from({ length: 6 }, (_, k) => ({ kind: 'burst', at: 0.3 + k * 0.4, x: 0.5, y: 0.5 }));
    const s = mk('9:16', [sc('a', { fx }), sc('b')], { design: { fxBudget: 'LOW' } });
    const q = spatialSpecQc(s, buildTimeline(s.scenes, 30));
    expect(q.issues.map((i) => i.code)).toContain('FX_BUDGET');
    expect(q.fx.count).toBe(6);
    const r = run(s, { 20: { fx: [{ scene: 'a', kinds: ['burst', 'sparks', 'energy-pulse'] }] } });
    expect(r.metrics.fx.peakConcurrent).toBeGreaterThan(1.2);
    expect(r.issues.filter((i) => i.code === 'FX_BUDGET').length).toBe(2);
  });
  it('performance: too many live videos on one frame', () => {
    const s = mk('16:9', [sc('a'), sc('b')]);
    const vids = Array.from({ length: 8 }, (_, k) => media('a', { x: k * 200, y: 100, width: 180, height: 100 }, { kind: 'video', identity: false }));
    const r = run(s, { 40: { media: vids } });
    expect(r.issues.map((i) => i.code)).toEqual(['PERF_LAYERS']);
    expect(r.metrics.perf.peakVideos).toBe(8);
  });
});
