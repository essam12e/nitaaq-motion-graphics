/**
 * Phase 2 — Lottie: frame mapping through the animation's own frame rate (trim,
 * marker, loop, hold, rate, delay), inspection (what is used, what is refused),
 * the Lottie asset pipeline on real files (byte-identical original, dotLottie,
 * embedded images, cache), schema backward compatibility, seek, budget and the
 * director (lazy module, recipes, Lottie logo).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectMediaKind } from '../../src/media/video';
import { inspectLottie, lottieFrameAt, resolveLottieClip, mergeLottieClips, type LottieTiming } from '../../src/media/lottie';
import { AssetSchema, VideoSchema } from '../../src/schema/video';
import { BriefSchema } from '../../src/schema/brief';
import { seek, sceneLotties } from '../../src/engine/seek';
import { estimateEffectCost } from '../../src/perf/effect-budget';
import { prepareLottieAsset, inspectLottieFile, readZip, isLottieFile } from '../../src/node/lottie-assets';
import { fileHash } from '../../src/cache/store';
import { detectPatterns } from '../../src/qc/pattern-detect';
import sharp from 'sharp';
import { selectModules } from '../../src/director/modules';
import { classifyBrief } from '../../src/director/classify';
import { RECIPES } from '../../src/director/recipes';
import { SceneRegistry } from '../../src/scenes';
import { buildPlan, recipeCtx } from '../../src/director/plan';
import { buildStoryboard } from '../../src/director/storyboard';

const FX = join(__dirname, '..', 'fixtures', 'media');
const json = (f: string) => JSON.parse(readFileSync(join(FX, f), 'utf8'));

describe('media kind detection: Lottie', () => {
  it('by extension and by measured meta; everything else unchanged', () => {
    expect(detectMediaKind('assets/a.json')).toBe('lottie');
    expect(detectMediaKind('assets/a.lottie')).toBe('lottie');
    expect(detectMediaKind('logo', { kind: 'logo', lottie: { ip: 0, op: 60 } } as never)).toBe('lottie');
    expect(detectMediaKind('logo', { kind: 'logo' })).toBe('image');
    expect(detectMediaKind('assets/a.png')).toBe('image');
    expect(isLottieFile('x/y.LOTTIE')).toBe(true);
    expect(isLottieFile('x/y.png')).toBe(false);
  });
});

describe('Lottie frame mapping (pure)', () => {
  const t60: LottieTiming = { fr: 60, ip: 0, op: 90, markers: [{ name: 'intro', start: 0, duration: 1 }] };
  it('converts through the animation frame rate (60 fps Lottie in a 30 fps film)', () => {
    const c = resolveLottieClip(undefined, t60);
    expect(c.end).toBe(1.5);
    // film frame 15 at 30 fps = 0.5 s = Lottie frame 30
    expect(lottieFrameAt(15 / 30, c, t60).frame).toBe(30);
    expect(lottieFrameAt(1 / 30, c, t60).frame).toBe(2);
  });
  it('holds the last frame (op − 1) when it ends, or wraps with loop', () => {
    const hold = resolveLottieClip(undefined, t60);
    expect(lottieFrameAt(5, hold, t60)).toMatchObject({ phase: 'held', frame: 89 });
    const loop = resolveLottieClip({ loop: true }, t60);
    expect(lottieFrameAt(1.5 + 0.25, loop, t60)).toMatchObject({ frame: 15, loopIndex: 1 });
  });
  it('a marker sets the trim; playback rate and delay apply', () => {
    const m = resolveLottieClip({ marker: 'intro' }, t60);
    expect([m.start, m.end]).toEqual([0, 1]);
    expect(lottieFrameAt(2, m, t60).frame).toBe(59); // held on the marker's last frame
    const r = resolveLottieClip({ playbackRate: 2, delay: 0.5 }, t60);
    expect(lottieFrameAt(0.25, r, t60)).toMatchObject({ phase: 'before', frame: 0 });
    expect(lottieFrameAt(0.75, r, t60).frame).toBe(30);
    expect(resolveLottieClip({ marker: 'nope' }, t60).end).toBe(1.5); // unknown marker → whole animation
  });
  it('honours a non-zero first frame (ip)', () => {
    const t: LottieTiming = { fr: 25, ip: 10, op: 60 };
    expect(lottieFrameAt(0, resolveLottieClip(undefined, t), t).frame).toBe(10);
    expect(lottieFrameAt(1, resolveLottieClip(undefined, t), t).frame).toBe(35);
  });
  it('is a pure function of time, sub-frame accurate', () => {
    const c = resolveLottieClip({ playbackRate: 0.5 }, t60);
    const a = [0.7, 0.1, 0.4].map((s) => lottieFrameAt(s, c, t60).frame);
    expect(a).toEqual([21, 3, 12]);
    expect(lottieFrameAt(1 / 90, resolveLottieClip(undefined, t60), t60).frame).toBe(0.6667);
  });
  it('merges asset clip < scene clip', () => {
    expect(mergeLottieClips({ marker: 'intro', loop: true }, { loop: false })).toMatchObject({ marker: 'intro', loop: false });
  });
});

describe('inspectLottie', () => {
  it('measures size, timing, markers, complexity and colours', () => {
    const r = inspectLottie(json('logo-mark.json'));
    expect(r).toMatchObject({ width: 400, height: 400, fr: 60, ip: 0, op: 90, duration: 1.5, layers: 3, expressions: 0, errors: [] });
    expect(r.markers).toEqual([{ name: 'intro', start: 0, duration: 1 }]);
    expect(r.colors.slice(0, 3).sort()).toEqual(['#0e2a47', '#1f6feb', '#f2b134']);
    expect(r.complexity).toBeGreaterThan(0);
    const icon = inspectLottie(json('icon-check.json'));
    expect(icon.markers.map((m) => m.name)).toEqual(['draw', 'idle']);
    expect(icon.colors[0]).toBe('#21c48c');
  });
  it('refuses expressions and broken files; warns about what renders differently', () => {
    expect(inspectLottie(json('with-expression.json')).errors.join()).toMatch(/expression/);
    expect(inspectLottie({ fr: 0, ip: 0, op: 0, w: 0, h: 0 }).errors.length).toBeGreaterThanOrEqual(3);
    expect(inspectLottie('nope').errors).toContain('not a JSON object');
    const img = inspectLottie(json('with-image.json'));
    expect(img.images).toEqual([{ id: 'img_0', embedded: false, path: 'with-image.png' }]);
    expect(img.warnings.join()).toMatch(/embedded at ingest/);
    const fx = inspectLottie({ ...json('icon-check.json'), ddd: 1, layers: [{ ty: 5, ef: [{}], ks: {} }] });
    expect(fx.threeD).toBe(true);
    expect(fx.warnings.join()).toMatch(/3D.*|effect|fallback font/);
  });
});

describe('schema: Lottie fields are optional (backward compatible)', () => {
  it('an old image asset parses unchanged; a Lottie asset keeps its meta', () => {
    expect(AssetSchema.parse({ kind: 'image', src: 'a.png' })).toEqual({ kind: 'image', src: 'a.png', userSupplied: true, preserve: true });
    const a = AssetSchema.parse({ kind: 'lottie', src: 'assets/x.json', fps: 60, duration: 1.5, clip: { marker: 'intro' }, lottie: { ip: 0, op: 90, layers: 3, complexity: 20 } });
    expect(a.lottie).toEqual({ ip: 0, op: 90, layers: 3, complexity: 20, markers: [], colors: [], warnings: [] });
    expect(a.clip?.marker).toBe('intro');
  });
  it('brief accepts kind lottie with a marker', () => {
    const b = BriefSchema.parse({ request: 'إعلان', assets: [{ path: 'a.json', kind: 'lottie', clip: { marker: 'draw', loop: true } }], content: { hook: 'شوف', cta: { text: 'جرّب' } } });
    expect(b.assets[0].clip).toEqual({ marker: 'draw', loop: true });
  });
});

const meta = (fr: number, op: number, complexity = 20, markers: { name: string; start: number; duration: number }[] = []) => ({ ip: 0, op, layers: 3, complexity, markers });
const lottieSpec = () =>
  VideoSchema.parse({
    project: { id: 'l', title: 'l', language: 'ar' },
    canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 },
    platform: 'generic',
    style: { preset: 'saudi-modern' },
    audio: { mode: 'none', sfx: { enabled: false } },
    assets: {
      logo: { kind: 'logo', src: 'assets/logo.json', width: 400, height: 400, fps: 60, duration: 1.5, lottie: meta(60, 90, 30, [{ name: 'intro', start: 0, duration: 1 }]) },
      'lottie-1': { kind: 'icon', src: 'assets/icon.json', width: 200, height: 200, fps: 30, duration: 2, lottie: meta(30, 60, 12) },
      product: { kind: 'product', src: 'assets/p.png', width: 800, height: 1000 },
    },
    scenes: [
      { id: 'a', type: 'lottie-moment', variant: 'logo', duration: 3, content: { lottie: 'logo', title: 'نطاق' }, transition: { type: 'crossfade', duration: 0.5 } },
      { id: 'b', type: 'lottie-moment', variant: 'icon', duration: 3, content: { lottie: 'lottie-1', clip: { marker: undefined, loop: true }, title: 'سريع' } },
      { id: 'c', type: 'image-reveal', variant: 'mask', duration: 3, content: { image: 'logo', role: 'logo' } },
    ],
  });

describe('seek and budget see Lottie', () => {
  it('reports the exact Lottie frame per scene; a logo used as a still shows its end pose', () => {
    const st = seek(lottieSpec(), 1);
    expect(st.scenes.find((s) => s.id === 'a')!.lotties).toEqual([{ asset: 'logo', frame: 60, phase: 'playing', loopIndex: 0 }]);
    // scene b starts at 2.5 s; at 5 s local 2.5 s → loop of a 2 s icon → 0.5 s → frame 15
    const b = seek(lottieSpec(), 5).scenes.find((s) => s.id === 'b')!;
    expect(b.lotties).toEqual([{ asset: 'lottie-1', frame: 15, phase: 'playing', loopIndex: 1 }]);
    expect(sceneLotties(lottieSpec(), { image: 'logo', role: 'logo' }, 0)).toEqual([{ asset: 'logo', frame: 89, phase: 'held', loopIndex: 0 }]);
    expect(sceneLotties(lottieSpec(), { image: 'product' }, 0)).toEqual([]);
    // in the logo-moment families (logo end card, logo reveal, brand lockup) the Lottie logo plays instead
    expect(sceneLotties(lottieSpec(), { logo: 'logo', title: 'x' }, 0.5, 'cta-logo')).toEqual([{ asset: 'logo', frame: 30, phase: 'playing', loopIndex: 0 }]);
    expect(sceneLotties(lottieSpec(), { logo: 'logo', title: 'x' }, 0.5, 'cta-button')[0].phase).toBe('held');
    expect(JSON.stringify(seek(lottieSpec(), 1))).toBe(JSON.stringify(seek(lottieSpec(), 1)));
  });
  it('the effect budget counts Lottie redraw by complexity', () => {
    const c = estimateEffectCost(lottieSpec());
    expect(c.contributors.find((x) => x.source.startsWith('Lottie'))?.add).toBeGreaterThan(0);
  });
});

describe('director: lazy Lottie module and lottie-moment', () => {
  const brief = (assets: unknown[], logo?: string) => BriefSchema.parse({ request: 'إعلان', assets, brand: logo ? { name: 'نطاق', logo } : undefined, content: { hook: 'شوف الفرق', solution: 'كل شي أسرع', cta: { text: 'جرّب الآن' } } });
  const ctx = (b: ReturnType<typeof brief>, hasLogo = false) => ({ brief: b, genre: 'social-ad' as const, cls: classifyBrief(b), hasLogo, hasMusic: false });
  const ids = (b: ReturnType<typeof brief>, hasLogo = false) => selectModules(ctx(b, hasLogo)).map((m) => m.id);
  it('the module is selected only when a Lottie is supplied (as lottie, icon or logo)', () => {
    expect(ids(brief([]))).not.toContain('lottie');
    expect(ids(brief([{ path: 'a.png', kind: 'logo' }]), true)).not.toContain('lottie');
    expect(ids(brief([{ path: 'a.json', kind: 'lottie' }]))).toContain('lottie');
    expect(ids(brief([{ path: 'a.lottie', kind: 'icon' }]))).toContain('lottie');
    expect(ids(brief([], 'logo.json'), true)).toContain('lottie');
  });
  it('a Lottie logo does not switch on the raster logo engine', () => {
    expect(ids(brief([{ path: 'logo.png', kind: 'logo' }]), true)).toContain('logo-animation');
    expect(ids(brief([], 'logo.json'), true)).not.toContain('logo-animation');
  });
  it('recipes: gated by the module; logo variant for a Lottie logo, icon for an icon', () => {
    expect(SceneRegistry.get('lottie-moment')!.manifest.variants).toEqual(['logo', 'icon', 'hero']);
    const rs = RECIPES.filter((r) => r.family === 'lottie-moment');
    expect(rs).toHaveLength(2);
    const b = brief([{ path: 'a.json', kind: 'icon' }]);
    const base = { brief: b, orientation: 'portrait' as const, lang: 'ar' as const, brandName: 'نطاق', assets: { images: [], logo: 'logo', lotties: ['lottie-1'], lottieIcons: ['lottie-1'], lottieLogo: true } };
    expect(rs.every((r) => !r.when({ ...base, modules: [] }))).toBe(true);
    const [logoR, iconR] = rs;
    expect(logoR.when({ ...base, modules: ['lottie'] })).toBe(true);
    expect(logoR.build({ ...base, modules: ['lottie'] })).toMatchObject({ lottie: 'logo', title: 'نطاق' });
    expect(iconR.variants!({ ...base, modules: ['lottie'] })).toEqual(['icon']);
    expect(logoR.when({ ...base, assets: { images: [], logo: 'logo' }, modules: ['lottie'] })).toBe(false);
    const la = RECIPES.find((r) => r.family === 'logo-animation')!;
    expect(la.when({ ...base, modules: ['logo-animation'], logo: { reveal: 'x', reason: 'y' } })).toBe(false);
  });
  it('the storyboard shows the user Lottie once; films without one are unchanged', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'brief-b-ecommerce.json'), 'utf8'));
    const board = (lotties?: string[]) => {
      const b = BriefSchema.parse(raw);
      const modules = ['shared-elements', 'brand-motion', 'product-commercial', ...(lotties ? ['lottie'] : [])];
      const assets = { images: [] as string[], product: 'product', ...(lotties ? { lotties } : {}) };
      const plan = buildPlan({ brief: b, brand: null, assets, genre: 'product', modules } as never);
      return buildStoryboard(plan, recipeCtx({ brief: b, brand: null, assets, genre: 'product', modules } as never, plan.aspect as '9:16'), { seed: 1 }).scenes.map((x) => x.family);
    };
    expect(board(['lottie-1']).filter((f) => f === 'lottie-moment')).toHaveLength(1);
    expect(board()).not.toContain('lottie-moment');
  });
});

describe('Lottie asset pipeline (real files)', () => {
  let tmp: string;
  let cacheBefore: string | undefined;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'nitaaq-lottie-'));
    cacheBefore = process.env.NITAAQ_CACHE;
    process.env.NITAAQ_CACHE = join(tmp, 'cache');
  });
  afterAll(() => {
    if (cacheBefore === undefined) delete process.env.NITAAQ_CACHE;
    else process.env.NITAAQ_CACHE = cacheBefore;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('plain JSON: original copied byte-identical and rendered as is', () => {
    const r = prepareLottieAsset(join(tmp, 'p1'), join(FX, 'logo-mark.json'), { id: 'logo', kind: 'logo', clip: { marker: 'intro' } });
    expect(r.rewritten).toBe(false);
    expect(r.asset).toMatchObject({ kind: 'logo', width: 400, height: 400, fps: 60, duration: 1.5, clip: { marker: 'intro' } });
    expect(r.asset.original).toBeUndefined();
    expect(fileHash(join(tmp, 'p1', r.asset.src))).toBe(fileHash(join(FX, 'logo-mark.json')));
    expect(r.asset.lottie?.colors).toContain('#1f6feb');
    expect(AssetSchema.parse(r.asset).lottie?.op).toBe(90);
  });
  it('external image is embedded into a self-contained copy; the original stays unchanged', () => {
    const r = prepareLottieAsset(join(tmp, 'p2'), join(FX, 'with-image.json'), { id: 'lottie-1' });
    expect(r.rewritten).toBe(true);
    expect(fileHash(join(tmp, 'p2', r.asset.original!))).toBe(fileHash(join(FX, 'with-image.json')));
    const doc = JSON.parse(readFileSync(join(tmp, 'p2', r.asset.src), 'utf8'));
    expect(doc.assets[0].p).toMatch(/^data:image\/png;base64,/);
    expect(doc.assets[0].e).toBe(1);
  });
  it('dotLottie is unpacked (deflate) with its image', () => {
    const zip = readZip(readFileSync(join(FX, 'packed.lottie')));
    expect([...zip.keys()].sort()).toEqual(['animations/spin.json', 'images/img_0.png', 'manifest.json']);
    const r = prepareLottieAsset(join(tmp, 'p3'), join(FX, 'packed.lottie'), { id: 'lottie-1' });
    expect(r.rewritten).toBe(true);
    expect(r.asset.src).toMatch(/\.lottie\.json$/);
    expect(JSON.parse(readFileSync(join(tmp, 'p3', r.asset.src), 'utf8')).assets[0].p).toMatch(/^data:image\/png/);
    expect(inspectLottieFile(join(FX, 'packed.lottie')).packed).toBe(true);
  });
  it('refuses expressions, missing images and non-Lottie files with a clear error', () => {
    expect(() => prepareLottieAsset(join(tmp, 'p4'), join(FX, 'with-expression.json'))).toThrow(/cannot be rendered faithfully/);
    const lone = join(tmp, 'lone.json');
    copyFileSync(join(FX, 'with-image.json'), lone);
    expect(() => prepareLottieAsset(join(tmp, 'p4'), lone)).toThrow(/image that is not there/);
    expect(inspectLottieFile(lone).errors.join()).toMatch(/not there/);
    expect(() => prepareLottieAsset(join(tmp, 'p4'), join(FX, 'with-image.png'))).toThrow(/\.json or \.lottie/);
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(() => prepareLottieAsset(join(tmp, 'p4'), bad)).toThrow();
  });
  it('second run is served from the cache; a changed side image invalidates it', () => {
    const dir = join(tmp, 'side');
    const proj = join(tmp, 'p5');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(FX, 'with-image.json'), join(dir, 'with-image.json'));
    copyFileSync(join(FX, 'with-image.png'), join(dir, 'with-image.png'));
    const a = prepareLottieAsset(proj, join(dir, 'with-image.json'));
    const b = prepareLottieAsset(proj, join(dir, 'with-image.json'));
    // the same bytes were already ingested above (the cache is content-addressed): both runs may hit it
    expect(b.cached).toBe(true);
    expect(b.asset).toEqual(a.asset);
    const before = readFileSync(join(proj, a.asset.src), 'utf8');
    copyFileSync(join(FX, 'packed.lottie'), join(dir, 'with-image.png')); // different bytes
    const c = prepareLottieAsset(proj, join(dir, 'with-image.json'));
    expect(c.cached).toBe(false);
    expect(readFileSync(join(proj, c.asset.src), 'utf8')).not.toBe(before);
    expect(existsSync(join(proj, c.asset.src))).toBe(true);
  });
});

describe('QC pattern detector: one soft border is not a grid', () => {
  const W = 540;
  const H = 960;
  const img = () => new Uint8Array(W * H).fill(20);
  const vline = (g: Uint8Array, x: number, y0: number, y1: number, v = 200) => { for (let y = y0; y < y1; y++) g[y * W + x] = v; };
  const hline = (g: Uint8Array, y: number, x0: number, x1: number, v = 200) => { for (let x = x0; x < x1; x++) g[y * W + x] = v; };
  it('a real line grid is still found', () => {
    const g = img();
    for (let x = 15; x < W; x += 30) vline(g, x, 0, H);
    for (let y = 15; y < H; y += 30) hline(g, y, 0, W);
    expect(detectPatterns(g, W, H).findings.map((f) => f.kind)).toContain('line-grid');
  });
  it('an anti-aliased card border around masked media is one line, not a 4×4 grid', async () => {
    // a real probe still (half size): image-reveal's frame card around a dotLottie, title above
    const { data, info } = await sharp(join(FX, 'qc-frame-border.png')).greyscale().raw().toBuffer({ resolveWithObject: true });
    const masks = [{ x: 39.49, y: 383.79, width: 461.03, height: 461.03 }, { x: 114.25, y: 122.62, width: 311.5, height: 116.78 }];
    expect(detectPatterns(data, info.width, info.height, masks).findings).toEqual([]);
  });
});
