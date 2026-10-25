/**
 * style_recipe.json: the film's visual direction, built from the inputs (named style, mix, legacy
 * preset or automatic selection from the brief) — never from a hard-coded example. Deterministic:
 * the same inputs give the same recipe and the same hash. Pure.
 */
import { RECIPE_AXES, StyleRecipeSchema, type MotionStyle, type RecipeAxis, type StyleRecipe, type StyleRequest } from './schema';
import { STYLE_BY_ID, OPTIONAL_FALLBACK, LEGACY_PRESET_STYLE, findStyle } from './library';
import { composeStyle } from './mix';
import { checkMix } from './compatibility';
import { rankStyles, type BriefSignals } from './select';
import { adaptBrand, type BrandAdaptation, type BrandColors } from './brand';
import { PRESERVATION_RULES } from './preservation';

export interface RecipeInput {
  request?: StyleRequest;
  /** Legacy preset id (brief.style that names an old preset). */
  legacyPreset?: string;
  signals?: BriefSignals;
  brand?: BrandColors | null;
  /** Identity asset ids/paths (product, logo, screenshots) that the style must not touch. */
  identity?: string[];
}

export interface RecipeResult { recipe: StyleRecipe; style: MotionStyle; brand: BrandAdaptation; warnings: string[] }

export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function words(t: string): Set<string> {
  return new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
}

/** The style's signature move that best fits the content (native moves first). */
export function pickSignature(style: MotionStyle, text: string, wanted?: string): { id: string; reason: string } {
  if (wanted) {
    const m = style.signatureMoves.find((x) => x.id === wanted || x.builder === wanted);
    if (m) return { id: m.id, reason: `requested signature move "${wanted}"` };
  }
  const tw = words(text);
  const scored = style.signatureMoves.map((m, i) => {
    const fit = m.fitsContent.reduce((s, f) => s + [...words(f)].filter((w) => tw.has(w)).length, 0);
    return { m, s: (m.native ? 2 : 0) + fit - i * 0.01 };
  });
  scored.sort((a, b) => b.s - a.s);
  return { id: scored[0].m.id, reason: scored[0].m.native ? 'the native move of the style' : 'best fit for the content' };
}

const LABEL: Record<RecipeAxis, (s: MotionStyle) => string> = {
  composition: (s) => `${s.compositionGrammar.grid}-grid/${s.compositionGrammar.strategies.default}`,
  shape: (s) => `${s.shapeLanguage.primary} (${s.shapeLanguage.corner})`,
  material: (s) => `${s.materialLanguage.kind} (${s.materialLanguage.lighting} light, ${s.materialLanguage.shadow} shadow)`,
  typography: (s) => `${s.typographyLanguage.display} ${s.typographyLanguage.displayWeight}, ${s.typographyLanguage.align}, by ${s.typographyLanguage.reveal}`,
  color: (s) => `${s.colorBehavior.ground} ground, ${s.colorBehavior.accentRule}`,
  depth: (s) => `${s.depthLanguage.planes} planes, parallax ${s.depthLanguage.parallax}`,
  motion: (s) => `${s.motionLanguage.curve} ×${s.motionLanguage.tempo}${s.motionLanguage.stepped ? ', on twos' : ''}`,
  transitions: (s) => s.transitionLanguage.prefer.join(' > '),
  camera: (s) => `${s.cameraGrammar.need}: ${s.cameraGrammar.allowed.join('/')}`,
  rhythm: (s) => `${s.rhythmLanguage.pace}, ${s.rhythmLanguage.pattern}`,
  sound: (s) => s.soundLanguage?.soundtrack ?? 'film default',
  decor: (s) => s.decor.kind,
};

export function buildRecipe(input: RecipeInput): RecipeResult {
  const warnings: string[] = [];
  const req = input.request ?? {};
  let base: MotionStyle | undefined;
  let source: StyleRecipe['selection']['source'] = 'auto';
  const why: string[] = [];
  let ranked: StyleRecipe['selection']['ranked'] = [];

  if (req.base) {
    base = findStyle(req.base);
    if (base) { source = req.mix ? 'mix' : 'explicit'; why.push(`requested style "${req.base}"`); }
    else warnings.push(`unknown style "${req.base}": chosen automatically instead`);
  }
  if (!base && input.legacyPreset && LEGACY_PRESET_STYLE[input.legacyPreset]) {
    base = STYLE_BY_ID[LEGACY_PRESET_STYLE[input.legacyPreset]];
    source = 'legacy-preset';
    why.push(`the preset "${input.legacyPreset}" maps to ${base.id}`);
  }
  if (!base && input.signals) {
    const r = rankStyles(input.signals);
    ranked = r.slice(0, 5).map((x) => ({ id: x.id, score: x.score, reasons: x.reasons }));
    if (r[0] && r[0].score > 0) {
      base = STYLE_BY_ID[r[0].id];
      source = 'auto';
      why.push(...(r[0].reasons.length ? r[0].reasons : ['highest score']));
      if (r[1] && r[0].score - r[1].score < 0.5) why.push(`close call with ${r[1].id} (${r[1].score}); a style frame of both would settle it`);
    }
  }
  if (!base) {
    base = STYLE_BY_ID['premium-saas'];
    source = 'fallback';
    why.push('no strong signal in the brief: the safest general style');
  }
  let optionalRenderer: string | undefined;
  if (base.renderingTechnique.renderer === 'webgl' && OPTIONAL_FALLBACK[base.id]) {
    optionalRenderer = `${base.id}: REQUIRES_OPTIONAL_RENDERER (${base.renderingTechnique.optional?.needs}); rendered as ${OPTIONAL_FALLBACK[base.id]}`;
    warnings.push(optionalRenderer);
    base = STYLE_BY_ID[OPTIONAL_FALLBACK[base.id]];
  }

  const from: Partial<Record<RecipeAxis, MotionStyle>> = {};
  for (const [axis, id] of Object.entries(req.mix ?? {}) as [RecipeAxis, string][]) {
    const s = findStyle(id);
    if (!s) { warnings.push(`mix: unknown style "${id}" for ${axis}`); continue; }
    if (s.renderingTechnique.renderer === 'webgl') { warnings.push(`mix: ${s.id} needs an optional renderer; ${axis} kept from ${base.id}`); continue; }
    from[axis] = s;
  }
  const compat = checkMix(from, base);
  if (compat.verdict === 'conflicting') warnings.push(`mix conflicts: ${compat.notes[0]}`);
  const style = composeStyle(base, from);
  const axes = Object.fromEntries(RECIPE_AXES.map((k) => [k, (from[k] ?? base!).id])) as Record<RecipeAxis, string>;
  const labels = Object.fromEntries(RECIPE_AXES.map((k) => [k, LABEL[k](style)]));
  const sig = pickSignature(style, input.signals?.text ?? '', req.signatureMove);
  why.push(`signature move: ${sig.id} (${sig.reason})`);
  const brand = adaptBrand(style, input.brand);
  const body = {
    version: 1 as const,
    id: style.id,
    baseStyle: base.id,
    axes,
    labels,
    signatureMove: sig.id,
    secondaryMoves: style.signatureMoves.filter((m) => m.id !== sig.id).map((m) => m.id),
    compatibility: compat,
    selection: { source, whyThisStyle: why, ranked },
    brandAdaptation: { source: input.brand ? (input.brand.source ?? 'brand') : 'neutral', roles: brand.roles, notes: brand.notes },
    productPreservation: { protected: [...(input.identity ?? [])].sort(), rules: PRESERVATION_RULES },
    ...(optionalRenderer ? { optionalRenderer } : {}),
  };
  const recipe = StyleRecipeSchema.parse({ ...body, hash: fnv(JSON.stringify(body)) });
  return { recipe, style, brand, warnings };
}
