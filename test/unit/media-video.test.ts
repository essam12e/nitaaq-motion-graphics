/**
 * Phase 1 — Media Foundation: media kind detection, the clip model (trim / rate /
 * loop / hold / delay), deterministic seek of video time, segment selection and
 * the Video Asset Pipeline on real files (probe → normalise → proxy → segment, cached).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectMediaKind, resolveClip, videoTimeAt, mergeClips, clipSceneLength } from '../../src/media/video';
import { VideoSchema, AssetSchema } from '../../src/schema/video';
import { BriefSchema } from '../../src/schema/brief';
import { seek, sceneVideos } from '../../src/engine/seek';
import { selectSegment, probeVideo, normalizeReasons, needsProxy, prepareVideoAsset, withVideoProxies, sampleMotion, type MotionSample } from '../../src/node/video-assets';
import { ffmpegRun } from '../../src/node/audio';
import { fileHash } from '../../src/cache/store';
import { selectModules } from '../../src/director/modules';
import { classifyBrief } from '../../src/director/classify';
import { RECIPES } from '../../src/director/recipes';
import { SceneRegistry } from '../../src/scenes';
import { buildPlan, recipeCtx } from '../../src/director/plan';
import { buildStoryboard } from '../../src/director/storyboard';
import { estimateEffectCost } from '../../src/perf/effect-budget';

const FX = join(__dirname, '..', 'fixtures', 'media');

describe('media kind detection', () => {
  it('detects by asset kind first, then by extension; unknown stays image (old behaviour)', () => {
    expect(detectMediaKind('assets/a.png')).toBe('image');
    expect(detectMediaKind('lib:demo/product.png')).toBe('image');
    expect(detectMediaKind('assets/a.MP4')).toBe('video');
    expect(detectMediaKind('assets/a.mov')).toBe('video');
    expect(detectMediaKind('assets/a.webm?x=1')).toBe('video');
    expect(detectMediaKind('data:video/mp4;base64,AAAA')).toBe('video');
    expect(detectMediaKind('assets/a.svg')).toBe('svg');
    expect(detectMediaKind('assets/anim.json')).toBe('lottie');
    expect(detectMediaKind('product', { kind: 'product' })).toBe('image');
    expect(detectMediaKind('clip-id', { kind: 'video' })).toBe('video');
    expect(detectMediaKind(undefined)).toBe('image');
  });
});

describe('clip model (pure, deterministic)', () => {
  it('resolves defaults and clamps to the source', () => {
    const r = resolveClip(undefined, 8);
    expect(r).toMatchObject({ start: 0, end: 8, length: 8, rate: 1, loop: false, delay: 0, muted: true, volume: 1 });
    const c = resolveClip({ startFrom: 2, endAt: 20, playbackRate: 9, volume: 3, muted: false }, 8);
    expect(c).toMatchObject({ start: 2, end: 8, rate: 4, volume: 1, muted: false });
    expect(resolveClip({ startFrom: 5, endAt: 3 }, 8).end).toBe(8); // inverted trim → to the end
    expect(resolveClip({ playbackRate: 0.01 }, 8).rate).toBe(0.25);
  });
  it('trim + playback rate map scene time to source time', () => {
    const r = resolveClip({ startFrom: 2, endAt: 6, playbackRate: 2 }, 8);
    expect(videoTimeAt(0, r, 30)).toEqual({ time: 2, phase: 'playing', loopIndex: 0 });
    expect(videoTimeAt(0.5, r, 30).time).toBe(3);
    expect(videoTimeAt(1.5, r, 30).time).toBe(5);
    expect(clipSceneLength(r)).toBe(2);
  });
  it('without loop the last source frame holds; with loop the segment wraps', () => {
    const hold = resolveClip({ startFrom: 1, endAt: 3 }, 8);
    const h = videoTimeAt(10, hold, 30);
    expect(h.phase).toBe('held');
    expect(h.time).toBeCloseTo(3 - 1 / 30, 6);
    const loop = resolveClip({ startFrom: 1, endAt: 3, loop: true }, 8);
    expect(videoTimeAt(2.5, loop, 30)).toEqual({ time: 1.5, phase: 'playing', loopIndex: 1 });
    expect(videoTimeAt(4.25, loop, 30)).toEqual({ time: 1.25, phase: 'playing', loopIndex: 2 });
  });
  it('a delay shows the first frame until the clip starts', () => {
    const r = resolveClip({ startFrom: 2, delay: 1 }, 8);
    expect(videoTimeAt(0.4, r, 30)).toEqual({ time: 2, phase: 'before', loopIndex: 0 });
    expect(videoTimeAt(1.5, r, 30).time).toBe(2.5);
  });
  it('is a pure function of time: any call order gives the same frame', () => {
    const r = resolveClip({ startFrom: 0.7, endAt: 4.2, loop: true, playbackRate: 1.37 }, 8);
    const frames = Array.from({ length: 300 }, (_, i) => videoTimeAt(i / 30, r, 30).time);
    const shuffled = [...frames.keys()].reverse().map((i) => videoTimeAt(i / 30, r, 30).time).reverse();
    expect(shuffled).toEqual(frames);
    for (const t of frames) {
      expect(t).toBeGreaterThanOrEqual(0.7);
      expect(t).toBeLessThan(4.2);
    }
  });
  it('merges asset defaults < scene overrides', () => {
    expect(mergeClips({ startFrom: 1, endAt: 4, loop: true }, { endAt: 3 }, undefined)).toEqual({ startFrom: 1, endAt: 3, loop: true });
  });
});

describe('segment selection', () => {
  const synth = (n: number, f: (i: number) => Partial<MotionSample>): MotionSample[] => Array.from({ length: n }, (_, i) => ({ t: i * 0.25, mean: 0.4, std: 0.2, diff: 0.02, ...f(i) }));
  it('skips a black opening instead of assuming the best part starts at 0', () => {
    const s = synth(40, (i) => (i < 12 ? { mean: 0.01, std: 0.005, diff: 0 } : { diff: 0.05 }));
    const seg = selectSegment(s, 10, 3);
    expect(seg.start).toBeGreaterThanOrEqual(3);
    expect(seg.end - seg.start).toBeCloseTo(3, 5);
  });
  it('prefers a window without a hard cut and with more motion', () => {
    const s = synth(40, (i) => (i === 10 ? { diff: 0.6 } : i > 24 ? { diff: 0.09 } : { diff: 0.02 }));
    const seg = selectSegment(s, 10, 2);
    expect(seg.start).toBeGreaterThanOrEqual(6);
    expect(seg.reason).toMatch(/no cut inside/);
  });
  it('a short source plays whole', () => {
    expect(selectSegment(synth(8, () => ({})), 2, 4)).toMatchObject({ start: 0, end: 2 });
  });
});

describe('schema: video fields are optional (backward compatible)', () => {
  it('old specs parse unchanged — no video field is added to image assets', () => {
    const old = JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'remotion', 'demo-spec.json'), 'utf8'));
    const parsed = VideoSchema.parse(old);
    for (const [k, a] of Object.entries(parsed.assets)) {
      const before = (old.assets ?? {})[k] ?? {};
      for (const key of Object.keys(a)) expect(key in before || ['userSupplied', 'preserve'].includes(key)).toBe(true);
    }
    expect(AssetSchema.parse({ kind: 'image', src: 'a.png' })).toEqual({ kind: 'image', src: 'a.png', userSupplied: true, preserve: true });
  });
  it('accepts a video asset with clip, proxy and original', () => {
    const a = AssetSchema.parse({ kind: 'video', src: 'assets/x.norm.mp4', original: 'assets/x.mov', proxy: 'assets/x.proxy.mp4', fps: 25, duration: 6, hasAudio: false, clip: { startFrom: 1, endAt: 4, loop: true, playbackRate: 1.5 } });
    expect(a.clip?.playbackRate).toBe(1.5);
    expect(() => AssetSchema.parse({ kind: 'video', src: 'x.mp4', clip: { playbackRate: 10 } })).toThrow();
  });
  it('brief video assets may carry a clip', () => {
    const b = BriefSchema.parse({ request: 'فيديو', assets: [{ path: 'a.mp4', kind: 'video', clip: { startFrom: 2, endAt: 5, loop: true } }], content: { hook: 'شوف', cta: { text: 'جرّب' } } });
    expect(b.assets[0].clip).toEqual({ startFrom: 2, endAt: 5, loop: true });
  });
});

const videoSpec = (aspect: '9:16' | '16:9' = '9:16') =>
  VideoSchema.parse({
    project: { id: 'v', title: 'v', language: 'ar' },
    canvas: aspect === '9:16' ? { aspect, width: 1080, height: 1920, fps: 30 } : { aspect, width: 1920, height: 1080, fps: 30 },
    platform: 'generic',
    style: { preset: 'saudi-modern' },
    audio: { mode: 'none', sfx: { enabled: false } },
    assets: {
      'video-1': { kind: 'video', src: 'assets/bars.mp4', width: 640, height: 360, duration: 8, fps: 30, clip: { startFrom: 2, endAt: 4, loop: true } },
      'video-2': { kind: 'video', src: 'assets/b.mp4', width: 640, height: 360, duration: 8, fps: 30, proxy: 'assets/b.proxy.mp4' },
      product: { kind: 'product', src: 'assets/p.png', width: 800, height: 1000 },
    },
    scenes: [
      { id: 'a', type: 'image-reveal', variant: 'mask', duration: 3, content: { image: 'product', role: 'product' }, transition: { type: 'crossfade', duration: 0.5 } },
      { id: 'b', type: 'video-showcase', variant: 'split', duration: 4, content: { video: 'video-1', videos: ['video-2'], clips: [{ playbackRate: 2 }], role: 'video' } },
    ],
  });

describe('deterministic seek reports video time', () => {
  it('per clip, with scene overrides', () => {
    const st = seek(videoSpec(), 4);
    const b = st.scenes.find((s) => s.id === 'b')!;
    // scene b starts at 2.5 s (3 s − 0.5 s transition): local 1.5 s
    expect(b.videos).toEqual([
      { asset: 'video-1', time: 3.5, phase: 'playing', loopIndex: 0 },
      { asset: 'video-2', time: 3, phase: 'playing', loopIndex: 0 },
    ]);
    expect(JSON.stringify(seek(videoSpec(), 4))).toBe(JSON.stringify(st));
    expect(st.scenes.find((s) => s.id === 'a')?.videos).toBeUndefined();
  });
  it('sceneVideos ignores images', () => {
    expect(sceneVideos(videoSpec(), { image: 'product' }, 1)).toEqual([]);
  });
  it('the effect budget counts simultaneous video decodes', () => {
    const c = estimateEffectCost(videoSpec());
    expect(c.contributors.find((x) => x.source.startsWith('video clips'))?.add).toBeGreaterThan(0);
  });
  it('preview renders swap videos for their proxies only', () => {
    const s = withVideoProxies(videoSpec());
    expect(s.assets['video-2'].src).toBe('assets/b.proxy.mp4');
    expect(s.assets['video-1'].src).toBe('assets/bars.mp4');
    expect(s.assets.product.src).toBe('assets/p.png');
    const noVideo = { assets: { p: { kind: 'image', src: 'a.png' } } } as never;
    expect(withVideoProxies(noVideo)).toBe(noVideo);
  });
});

describe('director: video module and scene family', () => {
  const brief = (assets: unknown[]) => BriefSchema.parse({ request: 'إعلان', assets, content: { hook: 'شوف الفرق', solution: 'كل شي أسرع', cta: { text: 'جرّب الآن' } } });
  const ctx = (b: ReturnType<typeof brief>) => ({ brief: b, genre: 'social-ad' as const, cls: classifyBrief(b), hasLogo: false, hasMusic: false });
  it('video-media is selected only when the brief has videos', () => {
    expect(selectModules(ctx(brief([]))).some((m) => m.id === 'video-media')).toBe(false);
    expect(selectModules(ctx(brief([{ path: 'a.mp4', kind: 'video' }]))).some((m) => m.id === 'video-media')).toBe(true);
  });
  it('video-showcase is registered and has a recipe gated by the module', () => {
    const m = SceneRegistry.get('video-showcase')!.manifest;
    expect(m.variants).toEqual(['card', 'split', 'mask', 'full']);
    const r = RECIPES.find((x) => x.family === 'video-showcase')!;
    const b = brief([{ path: 'a.mp4', kind: 'video' }]);
    const base = { brief: b, orientation: 'portrait' as const, lang: 'ar' as const, assets: { images: [], videos: ['video-1', 'video-2'] } };
    expect(r.when({ ...base, modules: [] })).toBe(false);
    expect(r.when({ ...base, modules: ['video-media'] })).toBe(true);
    expect(r.build({ ...base, modules: ['video-media'] })).toMatchObject({ video: 'video-1', videos: ['video-2'] });
    expect(r.variants!({ ...base, modules: ['video-media'] })).toEqual(['split']);
    expect(r.when({ ...base, assets: { images: [] }, modules: ['video-media'] })).toBe(false);
  });
});

describe('director: the user video is used, other films unchanged', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'brief-b-ecommerce.json'), 'utf8'));
  const board = (videos?: string[]) => {
    const brief = BriefSchema.parse(raw);
    const modules = ['shared-elements', 'brand-motion', 'product-commercial', ...(videos ? ['video-media'] : [])];
    const assets = { images: [] as string[], product: 'product', ...(videos ? { videos } : {}) };
    const plan = buildPlan({ brief, brand: null, assets, genre: 'product', modules } as never);
    return buildStoryboard(plan, recipeCtx({ brief, brand: null, assets, genre: 'product', modules } as never, plan.aspect as '9:16'), { seed: 1 }).scenes.map((x) => x.family);
  };
  it('a product ad with a user clip shows the clip once', () => {
    expect(board(['video-1']).filter((f) => f === 'video-showcase')).toHaveLength(1);
  });
  it('without videos the storyboard has no video scene', () => {
    expect(board()).not.toContain('video-showcase');
  });
});

describe('Video Asset Pipeline (real files, ffmpeg)', () => {
  let tmp: string;
  let cacheBefore: string | undefined;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'nitaaq-video-'));
    cacheBefore = process.env.NITAAQ_CACHE;
    process.env.NITAAQ_CACHE = join(tmp, 'cache');
  });
  afterAll(() => {
    if (cacheBefore === undefined) delete process.env.NITAAQ_CACHE;
    else process.env.NITAAQ_CACHE = cacheBefore;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('probes MP4 / MOV / WebM / VFR', () => {
    const mp4 = probeVideo(join(FX, 'bars-30.mp4'));
    expect(mp4).toMatchObject({ codec: 'h264', width: 640, height: 360, fps: 30, vfr: false, hasAudio: false });
    expect(mp4.duration).toBeCloseTo(8, 1);
    expect(normalizeReasons(mp4, '.mp4')).toEqual([]);
    const mov = probeVideo(join(FX, 'clip.mov'));
    expect(mov.codec).toBe('mpeg4');
    expect(normalizeReasons(mov, '.mov').join(' ')).toMatch(/codec mpeg4.*QuickTime/);
    const webm = probeVideo(join(FX, 'portrait.webm'));
    expect(webm).toMatchObject({ codec: 'vp9', width: 360, height: 640, fps: 24 });
    expect(normalizeReasons(webm, '.webm')).toEqual([]);
    const vfr = probeVideo(join(FX, 'vfr.mp4'));
    expect(vfr.vfr).toBe(true);
    expect(normalizeReasons(vfr, '.mp4').join(' ')).toMatch(/variable frame rate/);
  });

  it('MOV: original kept byte-identical, normalised H.264 copy rendered, black opening skipped', () => {
    const proj = join(tmp, 'p1');
    const r = prepareVideoAsset(proj, join(FX, 'clip.mov'), { id: 'video-1', segment: 2 });
    expect(r.asset.src).toMatch(/\.norm\.mp4$/);
    expect(r.asset.original).toMatch(/\.mov$/);
    expect(fileHash(join(proj, r.asset.original!))).toBe(fileHash(join(FX, 'clip.mov')));
    const n = probeVideo(join(proj, r.asset.src));
    expect(n).toMatchObject({ codec: 'h264', pixFmt: 'yuv420p', fps: 25, vfr: false, width: 480, height: 270 });
    expect(r.asset.clip!.startFrom!).toBeGreaterThanOrEqual(1.5);
    expect(r.asset.clip!.endAt! - r.asset.clip!.startFrom!).toBeCloseTo(2, 2);
    expect(r.asset.segmentReason).toMatch(/window/);
    expect(r.asset.proxy).toBeUndefined();
  });

  it('VFR becomes constant frame rate; WebM is used as is', () => {
    const proj = join(tmp, 'p2');
    const v = prepareVideoAsset(proj, join(FX, 'vfr.mp4'), { id: 'v' });
    expect(probeVideo(join(proj, v.asset.src)).vfr).toBe(false);
    const w = prepareVideoAsset(proj, join(FX, 'portrait.webm'), { id: 'w' });
    expect(w.asset.src).toMatch(/portrait\.webm$/);
    expect(w.asset.original).toBeUndefined();
    expect(w.normalized).toEqual([]);
  });

  it('4K source gets a 960 px preview proxy automatically; production keeps the source', () => {
    const big = join(tmp, 'big-4k.mp4');
    ffmpegRun(['-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=30:d=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', big], '4k fixture');
    expect(needsProxy(probeVideo(big))).toBe(true);
    const proj = join(tmp, 'p3');
    const r = prepareVideoAsset(proj, big, { id: 'big' });
    expect(r.asset.proxy).toMatch(/\.proxy\.mp4$/);
    const p = probeVideo(join(proj, r.asset.proxy!));
    expect(Math.max(p.width, p.height)).toBe(960);
    expect(p.duration).toBeCloseTo(1, 1);
    expect(r.asset.src).toMatch(/big-4k\.mp4$/);
  });

  it('explicit segment, loop and rate end up in the asset clip', () => {
    const r = prepareVideoAsset(join(tmp, 'p4'), join(FX, 'bars-30.mp4'), { id: 'b', segment: { start: 1, end: 3 }, loop: true, playbackRate: 1.5, proxy: 'always' });
    expect(r.asset.clip).toEqual({ startFrom: 1, endAt: 3, loop: true, playbackRate: 1.5 });
    expect(r.asset.proxy).toBeDefined();
    expect(probeVideo(join(tmp, 'p4', r.asset.proxy!)).width).toBe(640); // never upscaled
  });

  it('second run on the same file is served from the cache', () => {
    const a = prepareVideoAsset(join(tmp, 'p5'), join(FX, 'clip.mov'), { id: 'video-1', segment: 2 });
    const b = prepareVideoAsset(join(tmp, 'p6'), join(FX, 'clip.mov'), { id: 'video-1', segment: 2 });
    expect(b.cached).toBe(true);
    expect(b.asset).toEqual(a.asset);
    expect(existsSync(join(tmp, 'p6', b.asset.src))).toBe(true);
  });

  it('motion sampling is deterministic and sees the black opening', () => {
    const s1 = sampleMotion(join(FX, 'clip.mov'));
    const s2 = sampleMotion(join(FX, 'clip.mov'));
    expect(s1).toEqual(s2);
    expect(s1[0].mean).toBeLessThan(0.05);
    expect(s1[10].mean).toBeGreaterThan(0.1);
  });

  it('rejects non-video files with a clear error', () => {
    expect(() => prepareVideoAsset(join(tmp, 'p7'), join(__dirname, '..', 'fixtures', 'product.png'))).toThrow(/video must be/);
  });
});
