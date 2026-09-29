import { describe, expect, it } from 'vitest';
import { SceneRegistry } from '../../src/scenes';
import { STYLE_PRESETS, STYLE_IDS } from '../../src/styles/presets';
import { isKnownSfx } from '../../src/audio/sfx-library';
import { isKnownTransition } from '../../src/transitions/presentations';
import { BeatSchema } from '../../src/schema/plan';
import { contrastRatio } from '../../src/brand/color';

describe('scene registry', () => {
  const mods = SceneRegistry.list();
  it('has at least 40 families and 100+ variants', () => {
    expect(mods.length).toBeGreaterThanOrEqual(40);
    expect(mods.reduce((s, m) => s + m.manifest.variants.length, 0)).toBeGreaterThanOrEqual(100);
  });
  it.each(mods.map((m) => [m.manifest.id, m] as const))('%s manifest is complete and its example is valid', (_id, m) => {
    const x = m.manifest;
    expect(x.variants).toContain(x.defaultVariant);
    expect(new Set(x.variants).size).toBe(x.variants.length);
    expect(x.minDuration).toBeLessThanOrEqual(x.defaultDuration);
    expect(x.defaultDuration).toBeLessThanOrEqual(x.maxDuration);
    expect(x.aspectRatios.length).toBeGreaterThan(0);
    expect(x.content.safeParse(x.example).success).toBe(true);
    for (const b of x.beats) expect(BeatSchema.safeParse(b).success).toBe(true);
    for (const s of x.sfx) expect(isKnownSfx(s.category)).toBe(true);
    for (const t of x.preferredTransitions) expect(isKnownTransition(t)).toBe(true);
    for (const v of Object.values(x.aspectVariants ?? {})) for (const vv of v ?? []) expect(x.variants).toContain(vv);
    for (const k of Object.keys(x.textCapacity ?? {})) expect(x.variants).toContain(k);
  });
  it('aliases resolve to registered families', () => {
    for (const [a, id] of SceneRegistry.aliasList()) expect(SceneRegistry.resolveId(a)).toBe(id);
  });
});

describe('style presets', () => {
  it('has at least 18 presets', () => expect(STYLE_IDS().length).toBeGreaterThanOrEqual(18));
  it.each(Object.values(STYLE_PRESETS).map((t) => [t.id, t] as const))('%s has readable text colours', (_id, t) => {
    expect(contrastRatio(t.palette.textPrimary, t.palette.background)).toBeGreaterThanOrEqual(4.5);
    for (const tr of t.transitions) expect(isKnownTransition(tr)).toBe(true);
  });
});
