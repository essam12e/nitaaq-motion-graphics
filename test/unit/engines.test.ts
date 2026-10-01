import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BriefSchema } from '../../src/schema/brief';
import { buildPlan, recipeCtx } from '../../src/director/plan';
import { buildStoryboard } from '../../src/director/storyboard';
import { compileSpec } from '../../src/director/compile';
import { directFilm } from '../../src/director/creative';
import { classifyBrief } from '../../src/director/classify';
import { PHYSICS, PHYSICS_IDS, ELEMENT_KINDS, measuredOvershoot, presetProgress } from '../../src/motion/physics';
import { PERSONALITIES, PERSONALITY_IDS, pickPersonality, physicsFor } from '../../src/motion/personality';
import { requestedPatterns, resolveBackgroundKind } from '../../src/design/patterns';
import { checkBannedPatterns } from '../../src/design/banned';
import { detectPatterns } from '../../src/qc/pattern-detect';
import { analyzeBeats } from '../../src/audio/beats';
import { recomposeSpec } from '../../src/node/recompose';
import { estimateEffectCost } from '../../src/perf/effect-budget';
import { brandFile } from '../../src/brand/brand-file';
import { contrastRatio } from '../../src/brand/color';
import { STYLE_PRESETS } from '../../src/styles/presets';
import { validateSpec } from '../../src/validation/validate';

const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures', f), 'utf8'));
const film = (raw: unknown, seed: string | number = 1, beats: { bpm: number; beats: number[]; downbeats: number[] } | null = null) => {
  const brief = BriefSchema.parse(raw);
  const assets = { images: [] as string[] };
  const plan = buildPlan({ brief, brand: null, assets });
  const sb = buildStoryboard(plan, recipeCtx({ brief, brand: null, assets }, plan.aspect as '9:16'), { seed });
  const f = directFilm({ brief, plan, storyboard: sb, seed, beats, voiceLed: false });
  const cls = classifyBrief(brief);
  const spec = compileSpec({ brief, plan, storyboard: f.storyboard, brand: null, assets: {}, audio: { mode: 'none', sfx: false }, projectId: 'p', seed, motion: f.motion, effects: cls.budget.effects, loop: brief.loop } as never);
  return { brief, plan, film: f, spec, cls };
};

describe('motion physics', () => {
  it('every element kind maps to a preset and clamped presets never overshoot', () => {
    for (const p of PHYSICS_IDS) {
      if (PHYSICS[p].overshootClamping) expect(measuredOvershoot(PHYSICS[p])).toBeLessThanOrEqual(0.001);
      expect(presetProgress(PHYSICS[p], 0, 30)).toBeLessThan(0.05);
      expect(presetProgress(PHYSICS[p], 150, 30)).toBeGreaterThan(0.98);
    }
    for (const id of PERSONALITY_IDS) for (const el of ELEMENT_KINDS) expect(PHYSICS[physicsFor(id, el).id]).toBeDefined();
  });
  it('premium motion is calmer than sport motion', () => {
    expect(measuredOvershoot(physicsFor('premium', 'card'))).toBeLessThan(measuredOvershoot(physicsFor('sport', 'card')) + 1e-6);
    expect(PERSONALITIES.premium.camera.activity).toBeLessThan(PERSONALITIES.sport.camera.activity);
  });
  it('picks a personality from explicit request, then tone', () => {
    expect(pickPersonality({ explicit: 'cinematic' }).id).toBe('cinematic');
    expect(pickPersonality({ tone: ['luxury'] }).id).toBe('premium');
  });
});

describe('background engine', () => {
  it('pattern kinds resolve to clean forms unless explicitly requested', () => {
    expect(resolveBackgroundKind('dots')).not.toBe('dots');
    expect(resolveBackgroundKind('grid')).not.toBe('grid');
    expect(resolveBackgroundKind('dots', ['dots'])).toBe('dots');
    expect(requestedPatterns('خلفية منقطة dots please')).toContain('dots');
    expect(requestedPatterns('اعلان تقني نظيف')).toEqual([]);
  });
  it('no style preset ships a pattern background', () => {
    for (const t of Object.values(STYLE_PRESETS)) {
      expect(['dots', 'grid', 'halftone', 'bokeh', 'particles']).not.toContain(t.background.kind);
      expect(t.texture.grain).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('pattern detector', () => {
  const W = 320, H = 240;
  const flat = () => new Uint8Array(W * H).fill(30);
  it('finds a dot lattice', () => {
    const g = flat();
    for (let y = 8; y < H; y += 16) for (let x = 8; x < W; x += 16) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) g[(y + dy) * W + x + dx] = 200;
    expect(detectPatterns(g, W, H).findings.length).toBeGreaterThan(0);
  });
  it('finds a grid', () => {
    const g = flat();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x % 24 === 0 || y % 24 === 0) g[y * W + x] = 120;
    expect(detectPatterns(g, W, H).findings.length).toBeGreaterThan(0);
  });
  it('ignores a clean gradient with one large form', () => {
    const g = flat();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = 20 + Math.round((x / W) * 40) + ((x - 200) ** 2 + (y - 100) ** 2 < 70 ** 2 ? 30 : 0);
    expect(detectPatterns(g, W, H).findings).toEqual([]);
  });
  it('masks text areas', () => {
    const g = flat();
    for (let y = 8; y < H; y += 16) for (let x = 8; x < W; x += 16) g[y * W + x] = 220;
    expect(detectPatterns(g, W, H, [{ x: 0, y: 0, width: W, height: H }]).findings).toEqual([]);
  });
});

describe('beat engine', () => {
  const clicks = (bpm: number, sec = 12, sr = 22050) => {
    const x = new Float32Array(sec * sr);
    const step = (60 / bpm) * sr;
    for (let k = 0; k * step < x.length; k++) {
      const s = Math.round(k * step);
      for (let i = 0; i < 600 && s + i < x.length; i++) x[s + i] += Math.sin(i * 0.3) * Math.exp(-i / 120) * (k % 4 === 0 ? 1 : 0.6);
    }
    return x;
  };
  for (const bpm of [90, 120, 128]) {
    it(`tracks ${bpm} BPM within 3%`, () => {
      const r = analyzeBeats(clicks(bpm), 22050);
      expect(Math.abs(r.bpm - bpm) / bpm).toBeLessThan(0.03);
      expect(r.beats.length).toBeGreaterThan(10);
      expect(r.downbeats.length).toBeGreaterThan(2);
    });
  }
});

describe('task classifier', () => {
  it('classifies short / standard / long briefs', () => {
    const a = fx('brief-a-gcc-tech.json');
    expect(classifyBrief(BriefSchema.parse({ ...a, duration: 12, content: { hook: a.content.hook, cta: a.content.cta }, assets: [] })).class).toBe('SIMPLE');
    expect(classifyBrief(BriefSchema.parse({ ...a, duration: 120 })).class).toBe('LONG_FORM');
    expect(['STANDARD', 'ADVANCED']).toContain(classifyBrief(BriefSchema.parse(fx('brief-c-saas.json'))).class);
  });
});

describe('creative director', () => {
  it('is deterministic for a seed and gives every scene a motion job', () => {
    const a = film(fx('brief-b-ecommerce.json'), 7);
    const b = film(fx('brief-b-ecommerce.json'), 7);
    expect(JSON.stringify(a.film.motion)).toBe(JSON.stringify(b.film.motion));
    for (const s of a.film.motion.scenes) expect(s.jobs.length).toBeGreaterThan(0);
  });
  it('keeps one hero, respects the camera budget and never uses the same transition 3x running', () => {
    const { film: f } = film(fx('brief-b-ecommerce.json'), 3);
    expect(f.motion.scenes.filter((s) => s.hero).length).toBeLessThanOrEqual(1);
    expect(f.motion.cameraBudget.used).toBeLessThanOrEqual(f.motion.cameraBudget.allowed);
    const tr = f.motion.scenes.map((s) => s.transitionOut);
    for (let i = 2; i < tr.length - 1; i++) expect(tr[i] === tr[i - 1] && tr[i] === tr[i - 2]).toBe(false);
  });
  it('snaps cuts to the beat grid when music leads', () => {
    const beats = Array.from({ length: 80 }, (_, i) => Math.round(i * 0.5 * 1000) / 1000);
    const { film: f } = film(fx('brief-b-ecommerce.json'), 1, { bpm: 120, beats, downbeats: beats.filter((_, i) => i % 4 === 0) });
    expect(f.motion.beatSync?.bpm).toBe(120);
    expect(f.motion.beatSync!.aligned).toBeGreaterThan(0);
  });
});

describe('banned patterns & effect budget', () => {
  it('a director-built film has no banned findings at error level', () => {
    const { spec } = film(fx('brief-a-gcc-tech.json'));
    expect(checkBannedPatterns(spec).filter((f) => f.severity === 'error' || f.severity === 'critical')).toEqual([]);
  });
  it('flags a dot background that nobody asked for', () => {
    const { spec } = film(fx('brief-a-gcc-tech.json'));
    spec.scenes[0].background = { ...(spec.scenes[0].background ?? {}), kind: 'dots' } as never;
    expect(checkBannedPatterns(spec).length).toBeGreaterThan(0);
  });
  it('estimates cost and warns when over budget', () => {
    const { spec } = film(fx('brief-c-saas.json'));
    const fx1 = estimateEffectCost(spec);
    expect(fx1.score).toBeGreaterThan(0);
    spec.design.effectBudget = 'LOW';
    spec.style.preset = 'glassmorphism';
    const over = estimateEffectCost(spec);
    if (over.overBudget) expect(validateSpec(spec).map((i) => i.code)).toContain('EFFECT_BUDGET');
    expect(over.score).toBeGreaterThanOrEqual(fx1.score);
  });
});

describe('brand file', () => {
  it('lists only contrast-safe text colours', () => {
    const { spec } = film(fx('brief-a-gcc-tech.json'));
    const b = brandFile(spec);
    for (const c of b.contrastSafeColors.onBackground.text) expect(contrastRatio(c.split(' ').pop()!, b.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('multi-aspect recompose', () => {
  it('re-lays-out to every aspect without losing words or timing', () => {
    const { spec } = film(fx('brief-a-gcc-tech.json'));
    for (const aspect of ['16:9', '1:1', '4:5'] as const) {
      const r = recomposeSpec(spec, aspect);
      expect(r.spec.canvas.aspect).toBe(aspect);
      expect(r.spec.scenes.map((s) => s.id)).toEqual(spec.scenes.map((s) => s.id));
      expect(r.spec.scenes.map((s) => s.duration)).toEqual(spec.scenes.map((s) => s.duration));
      expect(JSON.stringify(r.spec.scenes.map((s) => s.content))).toBe(JSON.stringify(spec.scenes.map((s) => s.content)));
      expect(validateSpec(r.spec).filter((i) => i.severity === 'critical')).toEqual([]);
    }
  });
});

describe('seamless loop', () => {
  it('marks the timeline as a loop when the brief asks', () => {
    const { spec } = film({ ...fx('brief-a-gcc-tech.json'), loop: true });
    expect(spec.timeline.seamlessLoop).toBe(true);
  });
});
