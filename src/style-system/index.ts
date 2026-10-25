/**
 * Style Library v2 (src/style-system): visual styles as data + rules over NITAAQ's existing primitives.
 *
 *   brief (style | styleMix | nothing) ─► recipe.ts (explicit / mix / legacy preset / auto selection)
 *     ─► style_recipe.json ─► apply-script.ts (Stage script: composition, behaviour, camera, transitions,
 *        moments) + tokens.ts (legacy token path) + brand.ts (brand colours into the style's colour rules)
 *     ─► Stage Compiler (constraints on every compile) ─► StageLayer (look: material, decor, type, moments)
 *
 * NITAAQ_NO_STYLE_V2=1 turns it off: the film is produced exactly as in P4.5. Pure.
 */
import { findStyle, STYLE_BY_ID, STYLE_NAME_ALIASES, LEGACY_PRESET_STYLE, STYLE_LIBRARY, RENDERABLE_STYLES } from './library';
import { buildRecipe, type RecipeResult } from './recipe';
import { signalsFromBrief } from './select';
import type { BrandColors } from './brand';
import type { StyleRequest, RecipeAxis } from './schema';

export const styleV2On = () => process.env.NITAAQ_NO_STYLE_V2 !== '1';

/** The style request a brief makes (brief.style may name a v2 style, an alias, or a legacy preset). */
export function requestFromBrief(brief: { style?: string; styleMix?: Record<string, string>; signatureMove?: string }, genre?: string): { request: StyleRequest; legacyPreset?: string } {
  const name = brief.style?.trim().toLowerCase();
  const isV2 = Boolean(name && (STYLE_BY_ID[name] || STYLE_NAME_ALIASES[name]));
  const request: StyleRequest = {};
  if (isV2) request.base = name;
  else if (!name && genre === 'whiteboard') request.base = 'line-art';
  else if (!name && genre === 'illustrated') request.base = 'flat-vector';
  if (brief.styleMix && Object.keys(brief.styleMix).length) request.mix = brief.styleMix as Partial<Record<RecipeAxis, string>> as Record<RecipeAxis, string>;
  if (brief.signatureMove) request.signatureMove = brief.signatureMove;
  if (request.mix && !request.base) request.base = name && LEGACY_PRESET_STYLE[name] ? LEGACY_PRESET_STYLE[name] : undefined;
  return { request, legacyPreset: !isV2 && name && LEGACY_PRESET_STYLE[name] ? name : undefined };
}

/** The film's style recipe from a brief (and its brand colours once known). */
export function recipeForBrief(brief: Record<string, any>, opts: { genre?: string; brand?: BrandColors | null; identity?: string[] } = {}): RecipeResult {
  const { request, legacyPreset } = requestFromBrief(brief, opts.genre);
  return buildRecipe({ request, legacyPreset, signals: signalsFromBrief(brief), brand: opts.brand, identity: opts.identity });
}

export { findStyle, STYLE_LIBRARY, RENDERABLE_STYLES, STYLE_BY_ID, buildRecipe };
export { styleScript, constrainScript } from './apply-script';
export { styleTokenOverrides } from './tokens';
export { compareStyles, similarityMatrix } from './similarity';
export { checkMix, pairCompatibility, compatibilityMatrix } from './compatibility';
export { rankStyles, signalsFromBrief } from './select';
export { validateStyle, validateLibrary } from './validate';
