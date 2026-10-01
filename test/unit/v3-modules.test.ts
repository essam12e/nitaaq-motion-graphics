/**
 * v3 regression suite: the 20 required capability checks plus SFX-selection intelligence.
 * Pure engines only (no rendering) — real MP4 renders are covered by cli/test-videos.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BriefSchema, type Brief } from '../../src/schema/brief';
import { classifyBrief } from '../../src/director/classify';
import { classifyGenre, selectModules, wantsSoundtrack } from '../../src/director/modules';
import { planVariants } from '../../src/director/variants';
import { pickStyle } from '../../src/director/direction';
import { buildPlan } from '../../src/director/plan';
import { TEXT_MOTION_FAMILIES, effectiveUnit, TextMotionRegistry } from '../../src/text-motion/families';
import { planTextMotion } from '../../src/text-motion/planner';
import { chooseTransitions, transitionStats } from '../../src/transitions/engine';
import { chooseLogoReveal, type LogoStructure } from '../../src/brand/logo-reveal';
import { brandKey, deriveBrandMotion, recordFilm } from '../../src/brand/brand-motion';
import { checkDataStory, chooseVisualization } from '../../src/data/visualize';
import { findRegion, findPlace, precomputeMap } from '../../src/maps/geo';
import { matchIllustrations } from '../../src/illustration/registry';
import { composeSoundtrack } from '../../src/audio/soundtrack/compose';
import { detectEvents, type MotionEventDecl, type SceneEventSource } from '../../src/audio/events';
import { directSound } from '../../src/audio/sound-director';
import { ensureSfxBank } from '../../src/audio/synth/sfx-gen';
import type { SfxBankIndex } from '../../src/audio/sfx-families';
import { detectPatterns } from '../../src/qc/pattern-detect';
import { createRng, hashString } from '../../src/core/rng';
import { SceneRegistry } from '../../src/scenes';

const brief = (over: Record<string, unknown> = {}, content: Record<string, unknown> = {}): Brief =>
  BriefSchema.parse({ request: 'فيديو موشن', language: 'ar', dialect: 'saudi', objective: 'promote', platform: 'tiktok', duration: 20, audio: { mode: 'none', sfx: true }, ...over, content: { hook: 'جاهز تبدأ؟', cta: { text: 'ابدأ اليوم' }, ...content } });

const ctx = (b: Brief, hasMusic = false, hasLogo = false) => {
  const g = classifyGenre(b).genre;
  return { brief: b, genre: g, cls: classifyBrief(b), hasLogo, hasMusic };
};

// ── 1–3 typography
describe('Arabic / English / mixed kinetic typography', () => {
  it('1. never animates Arabic per glyph: every family has a word/line/block unit for Arabic', () => {
    for (const f of TEXT_MOTION_FAMILIES) expect(effectiveUnit(TextMotionRegistry.get(f.id)!, true)).not.toBe('char');
  });
  it('2. English may use per-character families', () => {
    const cs = TextMotionRegistry.get('char-stagger')!;
    expect(effectiveUnit(cs, false)).toBe('char');
  });
  it('3. a mixed film varies headline motion and never repeats it back-to-back', () => {
    const scenes = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, beat: ['hook', 'problem', 'solution', 'feature', 'proof', 'cta'][i], arabic: i % 2 === 0, hasHighlight: i === 0 }));
    const plan = planTextMotion(scenes, 'tech', 7);
    const heads = plan.scenes.map((s) => s.text.headline);
    for (let i = 1; i < heads.length; i++) expect(heads[i]).not.toBe(heads[i - 1]);
    expect(new Set(heads).size).toBeGreaterThanOrEqual(3);
  });
  it('ships at least 26 text-motion families', () => {
    expect(TEXT_MOTION_FAMILIES.length).toBeGreaterThanOrEqual(26);
  });
});

// ── 4 logo, 19 brand motion
const icon: LogoStructure = { width: 600, height: 600, aspect: 1, contentBox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, hasAlpha: true, vector: false, layout: 'icon', parts: [], symmetry: { horizontal: 1, vertical: 1 }, dominantDirection: 'radial', colorCount: 3, negativeSpace: 0.2 };
const combo: LogoStructure = { ...icon, width: 1200, height: 400, aspect: 3, layout: 'icon+wordmark-horizontal', parts: [{ role: 'symbol', rect: { x: 0.05, y: 0.1, w: 0.25, h: 0.8 } }, { role: 'wordmark', rect: { x: 0.35, y: 0.25, w: 0.6, h: 0.5 } }], symmetry: { horizontal: 0.3, vertical: 0.8 }, dominantDirection: 'horizontal' };

describe('logo animation + brand motion', () => {
  it('4. picks the reveal from the logo structure (icon+wordmark → sequence/typography family)', () => {
    const a = chooseLogoReveal({ structure: combo, personality: 'corporate', durationSec: 4, seed: 1 });
    expect(['icon-wordmark', 'typography-reveal', 'mask', 'minimal-premium']).toContain(a.reveal);
    const b = chooseLogoReveal({ structure: icon, personality: 'premium', durationSec: 4, seed: 1 });
    expect(b.reveal).not.toBe('icon-wordmark'); // needs two parts
    expect(b.reveal).not.toBe('typography-reveal'); // needs a wordmark
  });
  it('4b. history penalty: the same brand does not get the same reveal twice in a row', () => {
    const first = chooseLogoReveal({ structure: icon, personality: 'premium', durationSec: 4, seed: 1 });
    const second = chooseLogoReveal({ structure: icon, personality: 'premium', durationSec: 4, seed: 1, history: [first.reveal] });
    expect(second.reveal).not.toBe(first.reveal);
  });
  it('19. brand motion is stable per brand and records film history without changing identity', () => {
    const k = brandKey('بُن', 'abc');
    expect(brandKey('بُن', 'abc')).toBe(k);
    const bm = deriveBrandMotion({ key: k, name: 'بُن', personality: 'premium', now: '2026-10-01T00:00:00Z' });
    const bm2 = deriveBrandMotion({ key: k, name: 'بُن', personality: 'premium', now: '2026-10-01T00:00:00Z' });
    expect(bm2).toEqual(bm);
    const after = recordFilm(bm, { logoReveal: 'spotlight', headlineFamilies: ['mask-reveal'], transitions: ['push'], now: '2026-10-02T00:00:00Z' });
    expect(after.logo.history).toContain('spotlight');
    expect(after.personality).toBe(bm.personality);
  });
});

// ── 5 product, 6 launch, 11 whiteboard, 12 gsap, 14–15 soundtrack/music
describe('director: genres and lazy modules', () => {
  it('6. launch wording → launch genre with tease/reveal arc and soundtrack (no music supplied)', () => {
    const b = brief({ request: 'فيلم إطلاق تشويقي لتطبيقنا الجديد', objective: 'announce' }, { solution: 'تطبيق نبض', launchDate: '15 أكتوبر' });
    const c = ctx(b);
    expect(c.genre).toBe('launch');
    const ids = selectModules(c).map((m) => m.id);
    expect(ids).toContain('launch-film');
    expect(ids).toContain('soundtrack');
    expect(ids).not.toContain('map');
    expect(ids).not.toContain('whiteboard');
  });
  it('15. user music always wins: the soundtrack synthesiser never runs', () => {
    const b = brief({ request: 'فيلم إطلاق', objective: 'announce', audio: { mode: 'none', sfx: true, music: 'x.mp3', soundtrack: 'tech' } });
    expect(wantsSoundtrack({ brief: b, genre: 'launch', hasMusic: true })).toBeNull();
  });
  it('12. a simple logo sting loads no GSAP, map, data, whiteboard or soundtrack', () => {
    const b = brief({ request: 'أنيميشن للشعار ٥ ثواني', objective: 'brand', duration: 5 });
    const ids = selectModules(ctx(b, false, true)).map((m) => m.id);
    for (const heavy of ['gsap', 'map', 'data', 'whiteboard', 'illustration']) expect(ids).not.toContain(heavy);
  });
  it('11. whiteboard request → whiteboard genre and whiteboard style', () => {
    const b = brief({ request: 'فيديو وايت بورد يشرح الخدمة', objective: 'explain' }, { problem: 'الطلبات تتأخر', solution: 'نظام تتبع', steps: ['اطلب', 'تابع', 'استلم'] });
    const g = classifyGenre(b).genre;
    expect(g).toBe('whiteboard');
    expect(pickStyle(b, g).id).toBe('whiteboard');
  });
  it('5. product commercial: a product brief keeps the product beat (never dropped)', () => {
    const b = brief({ request: 'إعلان منتج لمتجرنا', industry: 'ecommerce' }, { products: [{ name: 'ساعة', price: '299', image: 'p.png' }] });
    const plan = buildPlan({ brief: b, brand: null, assets: { images: [], product: 'p1' } });
    expect(JSON.stringify(plan)).toContain('product');
  });
});

// ── 13 variants, 18 multi-aspect
describe('ad creative variants', () => {
  it('13/18. plans strategy × aspect jobs, skips unsupported strategies honestly', () => {
    const b = brief({ variants: { strategies: ['problem-first', 'product-first', 'offer-first', 'result-first'], aspects: ['9:16', '4:5', '1:1', '16:9'] } }, { problem: 'التمارين العشوائية ما تنفع', offer: 'خصم 30%', products: [{ name: 'نبض', image: 'p.png' }] });
    const p = planVariants(b, 'base');
    expect(p.unsupported.map((u) => u.strategy)).toContain('result-first'); // no sourced result
    const strategies = new Set(p.jobs.map((j) => j.strategy));
    expect(strategies.has('problem-first')).toBe(true);
    expect(p.jobs.filter((j) => j.strategy === 'problem-first').map((j) => j.aspect).sort()).toEqual(['16:9', '1:1', '4:5', '9:16']);
    for (const j of p.jobs) {
      expect(j.brief.brand).toEqual(b.brand); // brand never changes
      expect(j.brief.preferences.arc?.length).toBeGreaterThan(1);
    }
  });
});

// ── 7 data
describe('data animation never fabricates', () => {
  it('7. chooses visualization by meaning', () => {
    expect(chooseVisualization({ labels: ['2022', '2023', '2024', '2025'], values: [1, 2, 3, 4] }).kind).toBe('line');
    expect(chooseVisualization({ labels: ['الرياض', 'جدة', 'الدمام'], values: [5, 3, 2] }).kind).toBe('bar');
    expect(chooseVisualization({ labels: ['x'], values: [340] }).kind).toBe('big-number');
  });
  it('7b. flags a missing source, a share that does not sum to 100 and an unsupported claim', () => {
    const msgs = checkDataStory({ labels: ['أ', 'ب'], values: [40, 30], insight: 'نمو 80%' }, 'share').map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/source/i);
    expect(msgs).toMatch(/100/);
    expect(msgs).toMatch(/80/);
    const ok = checkDataStory({ labels: ['2023', '2024'], values: [120, 340], insight: 'نمو 183%', source: 'تقرير داخلي' }, 'bar');
    expect(ok.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

// ── 8 map
describe('map animation uses real geo data only', () => {
  it('8. finds Saudi regions by Arabic/English names and real cities', () => {
    expect(findRegion('مكة')?.id).toBe('SA-02');
    expect(findRegion('Riyadh')?.id).toBe('SA-01');
    expect(findPlace('جدة')).toBeTruthy();
  });
  it('8b. unknown places are warned, never guessed', () => {
    const m = precomputeMap({ focus: 'SAU', locations: [{ name: 'الرياض' }, { name: 'مدينة غير موجودة' }], routes: [{ from: 'الرياض', to: 'جدة' }] }, 1000, 1000);
    expect(m.pins.map((p: { id: string }) => p.id)).not.toContain('مدينة غير موجودة'); // route end جدة is a real pin
    expect(m.warnings.join(' ')).toContain('مدينة غير موجودة');
    expect(m.routes.length).toBe(1);
    expect(m.source).toMatch(/Natural Earth/);
  });
});

// ── 9 illustration, 10 zero-asset determinism
describe('illustration + zero-asset', () => {
  it('9. matches subjects from Arabic and English text', () => {
    expect(matchIllustrations('نمو المبيعات بسرعة')).toEqual(expect.arrayContaining(['growth']));
    expect(matchIllustrations('secure payments')).toEqual(expect.arrayContaining(['security']));
  });
  it('10. seeded generation is reproducible and seed-sensitive', () => {
    const a = Array.from({ length: 8 }, createRng('film-1:zero').next);
    const b = Array.from({ length: 8 }, createRng('film-1:zero').next);
    const c = Array.from({ length: 8 }, createRng('film-2:zero').next);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(SceneRegistry.get('zero-asset-sequence')).toBeTruthy();
  });
});

// ── 14 soundtrack
describe('code-generated soundtrack', () => {
  it('14. deterministic, downbeat on the hero, not a flat loop', () => {
    const inp = { style: 'tech' as const, durationSec: 12, seed: 's1', heroSec: 6.2, cuts: [3, 6.2, 9] };
    const a = composeSoundtrack(inp);
    const b = composeSoundtrack(inp);
    expect(hashString(Array.from(a.samples.subarray(0, 44100)).join(','))).toBe(hashString(Array.from(b.samples.subarray(0, 44100)).join(',')));
    expect(a.downbeats.some((d) => Math.abs(d - 6.2) < 0.03)).toBe(true);
    expect(new Set(a.sections.map((s) => s.name)).size).toBeGreaterThanOrEqual(3);
    const peak = a.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeLessThanOrEqual(1);
    const c = composeSoundtrack({ ...inp, seed: 's2' });
    expect(hashString(Array.from(c.samples.subarray(0, 44100)).join(','))).not.toBe(hashString(Array.from(a.samples.subarray(0, 44100)).join(',')));
  });
});

// ── 16, 17, 20 + SFX regression
describe('Sound Director (SFX selection intelligence)', () => {
  let bank: SfxBankIndex;
  beforeAll(async () => {
    bank = await ensureSfxBank();
  }, 60000);
  const scenes = (n: number): SceneEventSource[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      index: i,
      startSec: i * 3,
      durationSec: 3,
      speed: 1,
      energy: 0.7,
      category: 'product',
      decls: [
        { type: 'product_entry', at: 0.1, area: 0.3, direction: 'left', distance: 0.6 },
        { type: 'product_land', at: 0.1, area: 0.3, importance: 0.9 },
        { type: 'headline_reveal', at: 0.8, importance: 0.5 },
        { type: 'ui_appear', at: 1.6, importance: 0.25 },
      ] as MotionEventDecl[],
    }));
  const run = (personality: 'tech' | 'luxury' | 'sport', extra: Partial<Parameters<typeof directSound>[0]> = {}) => {
    const events = detectEvents(scenes(8), personality === 'luxury' ? 'premium' : personality === 'sport' ? 'sport' : 'tech');
    return directSound({ events, personality, intensity: 0.6, volume: 0.8, durationSec: 24, bank, seed: 'film', ...extra });
  };

  it('20. no file plays back-to-back and no variant dominates', () => {
    const { cues, report } = run('tech');
    expect(report.consecutiveSameVariant).toBe(0);
    for (let i = 1; i < cues.length; i++) if (cues[i].atSec - cues[i - 1].atSec < 4) expect(cues[i].file).not.toBe(cues[i - 1].file);
    expect(report.maxSameVariant).toBeLessThanOrEqual(Math.max(2, Math.ceil(cues.length / 5)));
    expect(report.uniqueVariants).toBeGreaterThanOrEqual(Math.min(cues.length, 6));
  });
  it('sync: every cue peaks on its motion anchor (≤40 ms)', () => {
    expect(run('tech').report.syncErrorMaxMs).toBeLessThanOrEqual(40);
  });
  it('density: silence is chosen — not every event gets a sound, and lower intensity means fewer', () => {
    const hi = run('tech', { intensity: 0.9 });
    const lo = run('tech', { intensity: 0.25 });
    expect(hi.report.events).toBeGreaterThan(hi.report.cues / 1.5);
    expect(lo.cues.length).toBeLessThan(hi.cues.length);
    expect(lo.report.dropped.length).toBeGreaterThan(0);
  });
  it('personality changes the treatment of the same motion', () => {
    const fam = (p: 'tech' | 'luxury' | 'sport') => new Set(run(p).cues.map((c) => c.family));
    const t = fam('tech');
    const l = fam('luxury');
    expect([...t].some((f) => !l.has(f)) || [...l].some((f) => !t.has(f))).toBe(true);
  });
  it('cross-film memory: a second film avoids the first film’s variants', () => {
    const first = run('tech');
    const reuse = (r: ReturnType<typeof run>) => r.cues.filter((c) => first.cues.some((f) => f.sound === c.sound)).length / Math.max(1, r.cues.length);
    const without = run('tech', { seed: 'film-2' });
    const withHistory = run('tech', { seed: 'film-2', history: first.cues.map((c) => c.sound) });
    expect(reuse(withHistory)).toBeLessThan(reuse(without));
  });
  it('16/17. under a voice detail sounds are lowered or dropped; with no voice they play', () => {
    const noVoice = run('tech');
    const voice = run('tech', { voice: [{ start: 0, end: 24 }] });
    const lvl = (r: typeof noVoice) => r.cues.filter((c) => c.layer !== 'impact').reduce((a, c) => a + c.volume, 0);
    expect(lvl(voice)).toBeLessThan(lvl(noVoice));
  });
  it('music coordination: impacts on a music hit are reduced', () => {
    const base = run('sport', { hasMusic: true });
    const hits = base.cues.filter((c) => c.layer === 'impact').map((c) => c.anchorSec ?? c.atSec);
    const withHits = run('sport', { hasMusic: true, musicHits: hits });
    const vol = (r: typeof base) => r.cues.filter((c) => c.layer === 'impact').reduce((a, c) => a + c.volume, 0);
    expect(vol(withHits)).toBeLessThan(vol(base));
  });
});

// ── transitions
describe('transition engine', () => {
  it('cuts are allowed and no flashy transition repeats back-to-back', () => {
    const cs = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, beat: ['hook', 'problem', 'solution', 'feature', 'feature', 'proof', 'offer', 'cta'][i], family: `f${i}`, category: 'typography', identity: [], hasWord: i % 2 === 0 }));
    const ch = chooseTransitions({ scenes: cs, personality: 'tech', pace: 'medium', heroIndex: 2, seed: 3, sharedElements: false, hasProduct: false });
    const st = transitionStats(ch.map((c) => c.type));
    expect(st.consecutiveRepeats).toBe(0);
    expect(st.maxShare).toBeLessThanOrEqual(0.5);
  });
});

// ── pixel detector
describe('pattern detector', () => {
  const frame = (w: number, h: number, pts: [number, number][]) => {
    const g = new Uint8Array(w * h).fill(20);
    for (const [x, y] of pts) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) g[(y + dy) * w + x + dx] = 230;
    return g;
  };
  it('flags a frame-wide particle field', () => {
    const rng = createRng(5).next;
    const pts = Array.from({ length: 150 }, () => [Math.floor(rng() * 390) + 5, Math.floor(rng() * 690) + 5] as [number, number]);
    expect(detectPatterns(frame(400, 700, pts), 400, 700).findings.map((f) => f.kind)).toContain('particle-field');
  });
  it('does not flag edge artefacts clustered around a few shapes', () => {
    const rng = createRng(6).next;
    const pts = Array.from({ length: 120 }, () => [Math.floor(rng() * 60) + 300, Math.floor(rng() * 300) + 150] as [number, number]);
    expect(detectPatterns(frame(400, 700, pts), 400, 700).findings.map((f) => f.kind)).not.toContain('particle-field');
  });
});
