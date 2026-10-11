import { describe, expect, it } from 'vitest';
import { VideoSchema } from '../../src/schema/video';
import { seek } from '../../src/engine/seek';
import { project, unproject, unprojectRect, projectRect, perspectiveOf } from '../../src/camera/rig';
import { cameraAt } from '../../src/camera/moves';
import { categoryScores, categoryOf, gateOk, CATEGORIES } from '../../src/qc/vqa';
import { rhythmPlan, motionLanguage } from '../../src/director/rhythm';
import { diversify, fingerprint, similarity } from '../../src/director/anti-template';
import { iconPath } from '../../src/morph/shapes';
import { parsePath, bounds, resample } from '../../src/morph/path';
import { SceneRegistry } from '../../src/scenes';

const spec = (scenes: unknown[]) =>
  VideoSchema.parse({ project: { id: 't', title: 't', language: 'ar' }, canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 }, platform: 'generic', style: { preset: 'saudi-modern' }, audio: { mode: 'none', sfx: { enabled: false } }, scenes });
const film = () =>
  spec([
    { id: 'a', type: 'kinetic-arabic', variant: 'stack', duration: 3, content: { lines: ['الحركة لغة'] }, transition: { type: 'push', duration: 0.5 }, motion: { cameraPlan: { move: 'push-in', amplitude: 0.8, ease: 'smooth' } } },
    { id: 'b', type: 'product-depth', variant: 'center', duration: 4, content: { image: 'lib:demo/product.png', title: 'ترطيب يدوم' }, transition: { type: 'crossfade', duration: 0.5 }, motion: { cameraPlan: { move: 'orbit-left', amplitude: 1, ease: 'smooth' } } },
    { id: 'c', type: 'morph-story', variant: 'icons', duration: 3, content: { stages: [{ icon: 'rocket', label: 'إطلاق' }, { icon: 'lightbulb', label: 'فكرة' }] }, transition: { type: 'mask-wipe', duration: 0.5 } },
    { id: 'd', type: 'kinetic-arabic', variant: 'hero-word', duration: 2.5, content: { lines: ['ابدأ الآن'] } },
  ]);

describe('deterministic seek(t)', () => {
  it('same t → same state, any order of calls', () => {
    const s = film();
    const a = JSON.stringify(seek(s, 3.2));
    seek(s, 9);
    seek(s, 0.1);
    expect(JSON.stringify(seek(s, 3.2))).toBe(a);
  });
  it('reports both scenes inside a transition, with progress', () => {
    const st = seek(film(), 2.75);
    expect(st.scenes.map((x) => x.id)).toEqual(['a', 'b']);
    expect(st.scenes[1].transitionIn?.type).toBe('push');
    expect(st.scenes[1].transitionIn!.progress).toBeGreaterThan(0);
    expect(st.scenes[1].camera?.move).toBe('orbit-left');
  });
});

describe('camera unproject (Visual QA 2.0 rest positions)', () => {
  it('inverts project on several planes and moves', () => {
    const W = 1080, H = 1920, D = perspectiveOf(W, H);
    for (const move of ['orbit-left', 'push-in', 'truck-right', 'crane-up'] as const) {
      const c = cameraAt({ move, amplitude: 1, ease: 'smooth' } as never, 2, { W, H, durationSec: 4 });
      for (const d of [0, 0.7, -0.12]) {
        const p = project({ x: 300, y: 900 }, d, c, W, H, D)!;
        const back = unproject(p, d, c, W, H, D)!;
        expect(back.x).toBeCloseTo(300, 0);
        expect(back.y).toBeCloseTo(900, 0);
      }
      const r = { x: 200, y: 400, width: 500, height: 300 };
      const back = unprojectRect(projectRect(r, 0, c, W, H, D)!, 0, c, W, H, D)!;
      expect(Math.abs(back.width - r.width)).toBeLessThan(8);
    }
  });
});

describe('quality categories and gate', () => {
  it('maps codes to categories and fails the gate on a critical product issue', () => {
    expect(categoryOf('PRODUCT_ALTERED')).toBe('brand');
    expect(categoryOf('CAMERA_FRAMING')).toBe('camera');
    const ran = [...CATEGORIES];
    const clean = categoryScores([], ran);
    expect(clean.overall).toBe(100);
    expect(gateOk(clean, ran)).toBe(true);
    const bad = categoryScores([{ code: 'PRODUCT_ALTERED', severity: 'critical' }, { code: 'PRODUCT_DISTORTED', severity: 'critical' }], ran);
    expect(bad.brand).toBeLessThan(50);
    expect(gateOk(bad, ran)).toBe(false);
  });
});

describe('Motion Director 2.0 — rhythm plan + motion language', () => {
  it('times scenes with transition overlap and flags monotony', () => {
    const r = rhythmPlan(film(), { heroScene: 'b' });
    expect(r.scenes[1].start).toBeCloseTo(2.5, 2);
    expect(r.scenes[1].cutIn).toBe('push');
    expect(r.heroAt).toBeCloseTo(2.5, 2);
    expect(r.checks.find((c) => c.code === 'RHYTHM_HERO_PLACEMENT')).toBeTruthy();
    const flat = spec(Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, type: 'kinetic-arabic', duration: 3, content: { lines: ['نص'] }, transition: { type: 'push', duration: 0.4 } })));
    const rf = rhythmPlan(flat);
    expect(rf.checks.find((c) => c.code === 'RHYTHM_MONOTONY')!.ok).toBe(false);
    expect(rf.checks.find((c) => c.code === 'RHYTHM_REPEATED_CUT')!.ok).toBe(false);
  });
  it('writes the film vocabulary', () => {
    const l = motionLanguage(film(), { personality: 'premium', heroScene: 'b' });
    expect(l.camera).toContain('orbit-left');
    expect(l.signature).toContain('product-depth');
    expect(l.rules.join(' ')).toMatch(/right to left/);
  });
});

describe('Anti-Template System', () => {
  const info = {
    variants: (type: string) => {
      const m = SceneRegistry.get(type)?.manifest;
      return m ? { list: m.variants, capacity: m.textCapacity as Record<string, number> | undefined } : null;
    },
    preferredTransitions: (type: string) => SceneRegistry.get(type)?.manifest.preferredTransitions ?? [],
  };
  it('identical films are 100% similar; a varied film drops below the threshold', () => {
    const a = film();
    const fa = fingerprint(a);
    expect(similarity(fa, fingerprint(film()))).toBe(1);
    const b = film();
    const rep = diversify(b, [{ id: 'old', at: '', features: fa }], info, { threshold: 0.6, seed: 1 });
    expect(rep.before.similarity).toBe(1);
    expect(rep.changes.length).toBeGreaterThan(0);
    expect(rep.after.similarity).toBeLessThan(rep.before.similarity);
    // content, order and durations never change
    expect(b.scenes.map((s) => [s.id, s.type, s.duration, JSON.stringify(s.content)])).toEqual(a.scenes.map((s) => [s.id, s.type, s.duration, JSON.stringify(s.content)]));
  });
  it('is deterministic and does nothing without history', () => {
    const x = film();
    expect(diversify(x, [], info).changes).toEqual([]);
    const h = [{ id: 'old', at: '', features: fingerprint(film()) }];
    const p = film(), q = film();
    expect(diversify(p, h, info, { seed: 7 }).changes).toEqual(diversify(q, h, info, { seed: 7 }).changes);
  });
});

describe('icon paths (Lucide) for morphing', () => {
  it('single-word and kebab names resolve; joined elements stay inside the 24px box', () => {
    for (const n of ['rocket', 'lightbulb', 'pencil-ruler', 'shopping-cart']) {
      const d = iconPath(n);
      expect(d, n).toBeTruthy();
      const b = bounds(parsePath(d!).flatMap((sp) => resample(sp, 64)));
      expect(b.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.y).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(24.5);
      expect(b.y + b.height).toBeLessThanOrEqual(24.5);
    }
  });
});
