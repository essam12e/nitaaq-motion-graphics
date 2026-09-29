import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BriefSchema, type Brief } from '../../src/schema/brief';
import { intake } from '../../src/director/intake';
import { buildPlan, recipeCtx } from '../../src/director/plan';
import { buildStoryboard, groupSegments, transcriptGroups } from '../../src/director/storyboard';
import { compileSpec } from '../../src/director/compile';
import { generatedBrand, pickStyle } from '../../src/director/direction';
import { SceneRegistry } from '../../src/scenes';
import { validateSpec } from '../../src/validation/validate';

const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures', f), 'utf8'));
const direct = (raw: unknown, seed: string | number = 1) => {
  const brief = BriefSchema.parse(raw);
  const assets = { images: [] as string[] };
  const plan = buildPlan({ brief, brand: null, assets });
  const sb = buildStoryboard(plan, recipeCtx({ brief, brand: null, assets }, plan.aspect as '9:16'), { seed });
  return { brief, plan, sb };
};

describe('intake', () => {
  it('asks about the logo when the brief does not say', () => {
    const b = fx('brief-a-gcc-tech.json');
    delete b.brand;
    const r = intake(b);
    expect(r.questions.map((q) => q.id)).toContain('brand');
    expect(r.questions[0].ar).toContain('شعار');
  });
  it('does not ask when the user said they have no logo', () => {
    expect(intake(fx('brief-e-long-arabic.json')).questions).toEqual([]);
  });
  it('asks for the voice file / provider instead of using a robotic voice', () => {
    const b = fx('brief-a-gcc-tech.json');
    b.audio = { mode: 'tts' };
    expect(intake(b, { ttsAvailable: false }).questions.map((q) => q.id)).toContain('tts-provider');
  });
  it('explains missing required fields', () => {
    expect(() => intake({ request: 'x', content: {} })).toThrow(/hook/);
  });
});

describe('director', () => {
  it('is deterministic for a seed', () => {
    const a = direct(fx('brief-rich.json'), 7).sb.scenes.map((s) => `${s.family}/${s.variant}/${s.duration}`);
    const b = direct(fx('brief-rich.json'), 7).sb.scenes.map((s) => `${s.family}/${s.variant}/${s.duration}`);
    expect(a).toEqual(b);
  });
  it.each(['brief-rich.json', 'brief-b-ecommerce.json', 'brief-c-saas.json', 'brief-e-long-arabic.json'])('%s: diverse, valid storyboard that starts with a hook and ends with a CTA', (f) => {
    const { sb } = direct(fx(f));
    expect(sb.scenes[0].beat).toBe('hook');
    expect(sb.scenes[sb.scenes.length - 1].beat).toBe('cta');
    for (let i = 1; i < sb.scenes.length; i++) expect(sb.scenes[i].family).not.toBe(sb.scenes[i - 1].family);
    for (const s of sb.scenes) {
      const m = SceneRegistry.get(s.family)!.manifest;
      expect(m.content.safeParse(s.content).success).toBe(true);
      expect(m.variants).toContain(s.variant);
    }
  });
  it('never uses data or testimonial scenes the user did not supply data for', () => {
    const b = fx('brief-a-gcc-tech.json');
    const { sb } = direct(b);
    const fams = sb.scenes.map((s) => s.family);
    for (const f of ['kpi-counter', 'stat-highlight', 'bar-chart', 'line-chart', 'testimonial', 'comment', 'social-proof']) expect(fams).not.toContain(f);
  });
  it('lands near the requested duration', () => {
    const { sb, plan } = direct(fx('brief-c-saas.json'));
    expect(Math.abs(sb.totalDuration - plan.duration)).toBeLessThan(plan.duration * 0.15);
  });
  it('compiles to a valid video.json with no logo invented', () => {
    const { brief, plan, sb } = direct(fx('brief-e-long-arabic.json'));
    const spec = compileSpec({ brief, plan, storyboard: sb, brand: null, assets: {}, audio: { mode: 'none', sfx: false }, projectId: 'e', seed: 1 });
    expect(spec.brand).toBeNull();
    expect(validateSpec(spec).filter((i) => i.severity === 'critical')).toEqual([]);
    expect(spec.canvas).toMatchObject({ aspect: '4:5', width: 1080, height: 1350 });
  });
  it('generated brand never carries a logo', () => {
    const b = BriefSchema.parse({ ...fx('brief-b-ecommerce.json') }) as Brief;
    const brand = generatedBrand(b, pickStyle(b).id)!;
    expect(brand.logo).toBeUndefined();
    expect(generatedBrand({ ...b, brand: null }, 'minimal')).toBeNull();
  });
});

describe('voice sync', () => {
  const segs = [{ start: 0.3, end: 2.7 }, { start: 3.3, end: 6.4 }, { start: 7, end: 9.7 }, { start: 10.4, end: 13.7 }, { start: 14.3, end: 16.5 }];
  it('groups phrases into the requested number of scenes without splitting inside words', () => {
    const g = groupSegments(segs, 3);
    expect(g).toHaveLength(3);
    expect(g[0].start).toBe(0.3);
    expect(g[2].end).toBe(16.5);
    for (const x of g) expect(segs.some((s) => Math.abs(s.start - x.start) < 1e-9)).toBe(true);
  });
  it('maps transcript lines to the scenes that show those words', () => {
    const scenes = [{ content: { title: 'هل تريد تعلم التصميم؟' } }, { content: { problem: 'الدورات الطويلة مملة ومكلفة', solution: 'تعلّم بخطوات قصيرة وواضحة' } }, { content: { features: [{ title: 'مشاريع حقيقية' }, { title: 'متابعة أسبوعية' }] } }, { content: { title: 'سجّل الآن' } }];
    const t = ['هل تريد تعلم التصميم؟', 'الدورات الطويلة مملة ومكلفة', 'تعلّم بخطوات قصيرة وواضحة', 'مشاريع حقيقية ومتابعة أسبوعية', 'سجّل الآن'];
    const g = transcriptGroups(scenes, segs, t)!;
    expect(g.map((x) => [x.start, x.end])).toEqual([[0.3, 2.7], [3.3, 9.7], [10.4, 13.7], [14.3, 16.5]]);
  });
});
