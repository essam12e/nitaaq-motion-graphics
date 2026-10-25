/**
 * Style Library v2: the library loads and validates, styles are structurally distinct, Arabic type is
 * never revealed letter by letter, mixing reports compatibility, identity assets are protected, the
 * recipe is deterministic, optional renderers fall back, and NITAAQ_NO_STYLE_V2 turns it all off.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { validateShotScript, type ShotScript } from '../../src/director/shot-script';
import { compileStage, type StageCompileInput } from '../../src/stage/compiler';
import { composeShot, STYLE_STRATEGIES } from '../../src/stage/composition';
import {
  STYLE_LIBRARY,
  RENDERABLE_STYLES,
  STYLE_BY_ID,
  validateLibrary,
  validateStyle,
  similarityMatrix,
  compareStyles,
  checkMix,
  buildRecipe,
  recipeForBrief,
  styleScript,
  styleV2On,
  rankStyles,
  signalsFromBrief,
} from '../../src/style-system';

const ELS = [
  { id: 'text.hook', kind: 'text', role: 'headline', text: 'منصة ذكية تجمع فريقك' },
  { id: 'shape.hub', kind: 'shape', shape: 'circle', color: 'primary', size: { w: 0.14, aspect: 1 } },
  { id: 'shape.dot', kind: 'shape', shape: 'circle', color: 'accent', size: { w: 0.05, aspect: 1 } },
  { id: 'card.result', kind: 'card', title: 'ساعة توفّرها أسبوعيًا' },
  { id: 'number.hours', kind: 'number', value: 20, parent: 'card.result' },
  { id: 'image.product', kind: 'image', asset: 'product' },
  { id: 'logo.brand', kind: 'image', asset: 'logo' },
  { id: 'text.cta', kind: 'text', role: 'cta', text: 'ابدأ مجانًا اليوم' },
  { id: 'button.cta', kind: 'button', text: 'ابدأ الآن' },
];
type S = Record<string, unknown>;
const shot = (id: string, over: S = {}): S => ({ id, purpose: 'feature', message: 'msg', subject: 's', sceneFamily: 'stage-shot', motionIntent: 'why it moves', timing: { duration: 3 }, shotSize: 'medium', transitionOut: 'cut', transitionReason: 'a clean cut', ...over });
const SHOTS = [
  shot('hook', { purpose: 'hook', subject: 'text.hook', cast: [{ id: 'text.hook', role: 'hero' }, { id: 'shape.hub', role: 'secondary' }, { id: 'shape.dot', role: 'support' }] }),
  shot('product', { purpose: 'solution', subject: 'image.product', cast: [{ id: 'image.product', role: 'hero' }, { id: 'card.result', role: 'secondary' }, { id: 'number.hours', role: 'secondary' }] }),
  shot('cta', { purpose: 'cta', subject: 'text.cta', cast: [{ id: 'text.cta', role: 'hero' }, { id: 'button.cta', role: 'secondary' }, { id: 'logo.brand', role: 'support' }], transitionOut: undefined, transitionReason: undefined }),
];
function script(): ShotScript {
  const v = validateShotScript({ version: 1, stage: { elements: ELS }, shots: SHOTS });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.script;
}
const ASSET_KINDS = { product: 'product', logo: 'logo' };
const input = (sc: ShotScript): StageCompileInput => {
  let t = 0;
  const timing = sc.shots.map((s) => {
    const d = s.timing.duration ?? 3;
    const r = { id: s.id, start: t, duration: d, transition: null, beat: s.purpose };
    t += d;
    return r;
  });
  return { script: sc, timing, voice: null, W: 1920, H: 1080, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, assets: { logo: { kind: 'logo', aspect: 1 }, product: { kind: 'product', aspect: 1 } }, cta: { text: 'ابدأ مجانًا اليوم', button: 'ابدأ الآن' }, direction: null as never };
};
const styled = (id: string) => {
  const r = buildRecipe({ request: { base: id }, identity: ['image.product', 'logo.brand'] });
  return styleScript(script(), r.style, { recipe: r.recipe, brand: r.brand, assetKinds: ASSET_KINDS });
};

afterEach(() => {
  delete process.env.NITAAQ_NO_STYLE_V2;
});

describe('Style Library v2: library', () => {
  it('loads 15–25 styles that all validate (fonts, native moves, no letter reveal) and are pairwise distinct', () => {
    expect(STYLE_LIBRARY.length).toBeGreaterThanOrEqual(15);
    expect(STYLE_LIBRARY.length).toBeLessThanOrEqual(25);
    expect(validateLibrary(STYLE_LIBRARY).problems).toEqual([]);
    const m = similarityMatrix(RENDERABLE_STYLES);
    expect(m.failures).toEqual([]);
    for (const s of STYLE_LIBRARY) {
      expect(s.signatureMoves.length).toBeGreaterThanOrEqual(2);
      expect(s.signatureMoves.length).toBeLessThanOrEqual(5);
      expect(s.signatureMoves.some((x) => x.native)).toBe(true);
    }
  });

  it('rejects a cosmetic copy and a letter-by-letter reveal', () => {
    const copy = { ...STYLE_BY_ID['swiss-motion'], id: 'swiss-copy', motionLanguage: { ...STYLE_BY_ID['swiss-motion'].motionLanguage, tempo: 1.1 } };
    expect(compareStyles(copy as never, STYLE_BY_ID['swiss-motion']).distinct).toBe(false);
    const letters = { ...STYLE_BY_ID['editorial'], id: 'letters', typographyLanguage: { ...STYLE_BY_ID['editorial'].typographyLanguage, reveal: 'letter' } };
    expect(validateStyle(letters, STYLE_LIBRARY).ok).toBe(false);
  });

  it('Arabic type: every style reveals by word, line, block or mask, and aligns to the reading start or the centre', () => {
    for (const s of STYLE_LIBRARY) {
      expect(['word', 'line', 'block', 'mask']).toContain(s.typographyLanguage.reveal);
      expect(['start', 'center']).toContain(s.typographyLanguage.align);
    }
  });
});

describe('Style Library v2: recipe, mixing, selection', () => {
  it('the recipe is deterministic (same inputs → same hash) and changes with the style', () => {
    const a = buildRecipe({ request: { base: 'isometric' } }).recipe;
    const b = buildRecipe({ request: { base: 'isometric' } }).recipe;
    expect(a.hash).toBe(b.hash);
    expect(buildRecipe({ request: { base: 'editorial' } }).recipe.hash).not.toBe(a.hash);
  });

  it('mixing: the axes come from the named styles and the verdict says whether they fit', () => {
    const r = buildRecipe({ request: { base: 'swiss-motion', mix: { motion: 'liquid' } as never } }).recipe;
    expect(r.axes.motion).toBe('liquid');
    expect(r.axes.composition).toBe('swiss-motion');
    expect(['compatible', 'partially-compatible', 'conflicting']).toContain(r.compatibility.verdict);
    expect(checkMix({ motion: STYLE_BY_ID['sticker-collage'] }, STYLE_BY_ID['minimal-luxury']).verdict).toBe('conflicting');
  });

  it('optional renderer: a WebGL style falls back to a renderable one with REQUIRES_OPTIONAL_RENDERER', () => {
    const r = buildRecipe({ request: { base: 'glass-product-3d' } });
    expect(r.style.renderingTechnique.renderer).not.toBe('webgl');
    expect(r.recipe.optionalRenderer).toMatch(/REQUIRES_OPTIONAL_RENDERER/);
    expect(buildRecipe({ request: { base: 'no-such-style' } }).warnings.join(' ')).toMatch(/unknown style/);
  });

  it('auto selection explains itself and follows the brief', () => {
    const r = recipeForBrief({ request: 'إعلان عطر فاخر للنساء', industry: 'perfume', tone: 'luxury' });
    expect(r.recipe.selection.source).toBe('auto');
    expect(r.recipe.selection.whyThisStyle.length).toBeGreaterThan(0);
    expect(['minimal-luxury', 'product-commercial', 'cinematic']).toContain(r.style.id);
    const toy = rankStyles(signalsFromBrief({ request: 'فيديو مرح لألعاب الأطفال', industry: 'toys', tone: 'playful' }))[0].id;
    expect(STYLE_BY_ID[toy].character.playfulness).toBeGreaterThan(0.5);
  });
});

describe('Style Library v2: the film changes, the product does not', () => {
  it('two styles give different compositions, motion and moments on the same script', () => {
    const a = styled('swiss-motion').script;
    const b = styled('isometric').script;
    expect(a.shots.map((s) => s.composition)).not.toEqual(b.shots.map((s) => s.composition));
    expect(a.motionLanguage?.curve).not.toBe(b.motionLanguage?.curve);
    expect(a.style?.moments.map((m) => m.builder)).not.toEqual(b.style?.moments.map((m) => m.builder));
  });

  it('product preservation: identity assets keep shape, rotation and a safe entrance in every style, and survive the compile', () => {
    for (const s of RENDERABLE_STYLES) {
      const { script: sc, report } = styled(s.id);
      expect(report.protected).toEqual(expect.arrayContaining(['image.product', 'logo.brand']));
      for (const sh of sc.shots)
        for (const c of sh.cast ?? []) {
          if (c.id !== 'image.product' && c.id !== 'logo.brand') continue;
          expect(c.rotation ?? 0).toBe(0);
          if (c.enter) expect(['fade', 'rise', 'scale', 'none']).toContain(c.enter);
        }
      for (const sh of sc.shots) for (const ev of sh.motionChain ?? []) if (ev.element === 'image.product') expect(['morph', 'transform', 'become']).not.toContain(ev.action);
      expect(sc.style?.moments.every((m) => m.element !== 'image.product')).toBe(true);
    }
    const plan = compileStage(input(styled('sticker-collage').script)).plan;
    const prod = plan.elements.find((e) => e.id === 'image.product')!;
    expect(prod.morphShapes ?? []).toEqual([]);
  });

  it('every style strategy lays the shot out inside the frame (no negative or empty boxes)', () => {
    const els = [
      { id: 'h', kind: 'text', role: 'hero', aspect: 3 },
      { id: 'a', kind: 'button', role: 'secondary', aspect: 3 },
      { id: 'b', kind: 'image', role: 'support', aspect: 1 },
    ];
    for (const strat of STYLE_STRATEGIES)
      for (const [W, H] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
        const r = composeShot({ elements: els as never, W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, shotSize: 'medium', purpose: 'feature', strategy: strat } as never);
        for (const b of Object.values(r.boxes)) {
          expect(b.w).toBeGreaterThan(0.01);
          expect(b.h).toBeGreaterThan(0.01);
        }
      }
  });

  it('NITAAQ_NO_STYLE_V2=1 switches the system off', () => {
    expect(styleV2On()).toBe(true);
    process.env.NITAAQ_NO_STYLE_V2 = '1';
    expect(styleV2On()).toBe(false);
  });
});
