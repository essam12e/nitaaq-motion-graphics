import { describe, expect, it } from 'vitest';
import { budgetFx, FX_BY_PERSONALITY, FX_DEFS, fxForMoment, fxShapes, MICRO_FX, type MicroFxSpec } from '../../src/fx/micro';
import { planMicroFx, microFxCost } from '../../src/fx/plan';
import { VideoSchema } from '../../src/schema/video';
import { estimateEffectCost } from '../../src/perf/effect-budget';
import type { MotionEvent } from '../../src/audio/events';

const BASE = { project: { id: 'fx', title: 't', language: 'ar' }, canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 }, style: { preset: 'saudi-modern' } };
const W = 1080;
const H = 1920;

describe('Micro FX', () => {
  it('nine light effects, each a handful of primitives, nothing outside its life', () => {
    expect(MICRO_FX.length).toBe(9);
    for (const kind of MICRO_FX) {
      const fx: MicroFxSpec = { kind, at: 1, x: 0.5, y: 0.5, seed: 's' };
      const d = FX_DEFS[kind].duration;
      expect(fxShapes(fx, 0.99, W, H, '#fff'), kind).toEqual([]);
      expect(fxShapes(fx, 1 + d + 0.01, W, H, '#fff'), kind).toEqual([]);
      const mid = fxShapes(fx, 1 + d * 0.4, W, H, '#fff');
      expect(mid.length, kind).toBeGreaterThan(0);
      expect(mid.length, kind).toBeLessThanOrEqual(20);
    }
  });
  it('is deterministic: same seed and time → same shapes; another seed → different particles', () => {
    const a = fxShapes({ kind: 'burst', at: 0, x: 0.5, y: 0.5, seed: 1 }, 0.2, W, H, '#fff');
    const b = fxShapes({ kind: 'burst', at: 0, x: 0.5, y: 0.5, seed: 1 }, 0.2, W, H, '#fff');
    const c = fxShapes({ kind: 'burst', at: 0, x: 0.5, y: 0.5, seed: 2 }, 0.2, W, H, '#fff');
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it('picks accents by moment, intent and personality', () => {
    expect(fxForMoment('button_press', 'premium')).toBe('ring');
    expect(fxForMoment('button_press', 'energetic')).toBe('burst');
    expect(fxForMoment('hero_reveal', 'premium')).toBe('glow-pulse');
    expect(fxForMoment('hero_reveal', 'tech')).toBe('energy-pulse');
    expect(fxForMoment('product_land', 'sport')).toBe('impact-lines');
    expect(fxForMoment('button_press', 'premium', 'continuity')).toBeUndefined();
    expect(fxForMoment('typing', 'playful')).toBeUndefined();
    for (const p of Object.keys(FX_BY_PERSONALITY)) expect(FX_BY_PERSONALITY[p as keyof typeof FX_BY_PERSONALITY].length).toBeLessThanOrEqual(6);
  });
  it('budget: density per film and concurrent cost keep the most important accents', () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ kind: 'sparks' as const, start: i * 0.5, importance: i / 12 }));
    const low = budgetFx(list, 10, 'LOW');
    expect(low.kept.length).toBeLessThanOrEqual(3);
    expect(low.kept.every((k) => k.importance! >= 0.5)).toBe(true);
    const crowd = budgetFx([{ kind: 'sparks', start: 1 }, { kind: 'burst', start: 1.1 }, { kind: 'ring', start: 1.2 }], 10, 'MEDIUM');
    expect(crowd.kept.length).toBe(2);
    expect(crowd.dropped[0].why).toMatch(/concurrent/);
    expect(low.cost).toBeGreaterThan(0);
  });
  it('auto planner: accents on positioned or centred moments only, replaced on re-planning; off by default', () => {
    const spec = VideoSchema.parse({ ...BASE, motion: { personality: 'premium' }, design: { microFx: 'auto' }, scenes: [{ id: 'a', type: 'kinetic-arabic', duration: 10, content: { lines: ['x'] }, fx: [{ kind: 'ring', at: 0.5, x: 0.2, y: 0.2 }] }] });
    const ev = (type: string, syncSec: number, pos?: { x: number; y: number }) => ({ type, syncSec, sceneIndex: 0, importance: 0.8, direction: 'none', ...(pos ? { pos } : {}) }) as unknown as MotionEvent;
    const r = planMicroFx(spec, [ev('button_press', 1, { x: 0.4, y: 0.6 }), ev('hero_reveal', 2.5), ev('card_entry', 3)]);
    const fx = r.spec.scenes[0].fx!;
    expect(fx.filter((f) => !f.auto)).toHaveLength(1);
    expect(fx.filter((f) => f.auto).map((f) => f.kind)).toEqual(['ring', 'glow-pulse']);
    const again = planMicroFx(r.spec, [ev('button_press', 1, { x: 0.4, y: 0.6 })]);
    expect(again.spec.scenes[0].fx!.filter((f) => f.auto)).toHaveLength(1);
    const off = VideoSchema.parse({ ...BASE, scenes: [{ id: 'a', type: 'kinetic-arabic', duration: 4, content: { lines: ['x'] } }] });
    expect(off.design.microFx).toBe('off');
    expect(planMicroFx(off, [ev('button_press', 1, { x: 0.4, y: 0.6 })]).spec.scenes[0].fx).toBeUndefined();
  });
  it('joins the performance budget', () => {
    const spec = VideoSchema.parse({ ...BASE, scenes: [{ id: 'a', type: 'kinetic-arabic', duration: 4, content: { lines: ['x'] }, fx: [{ kind: 'sparks', at: 0.5, x: 0.2, y: 0.2 }] }] });
    expect(microFxCost(spec)).toBeGreaterThan(0);
    expect(estimateEffectCost(spec).contributors.some((c) => c.source === 'micro FX accents')).toBe(true);
  });
});
