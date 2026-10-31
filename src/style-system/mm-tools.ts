/**
 * Which MotionMaxxing tools fit which Style Library v2 style — by what the tool really does, never forced.
 * Used by the shot compiler (a warning when a shot uses a tool its style does not suit) and by the
 * fast-mode recipes (mm families are only offered where the style allows them).
 *
 * Tools: words (M.words), count (M.count), camera (M.snap / M.whip / M.dive / M.camera / M.drift),
 *        smear (per-element directional blur), press (M.cursor + M.press), hero3d (one physical hero object),
 *        native-ui (NativeUI phone / notification + macro).
 */
export type MMTool = 'words' | 'count' | 'camera' | 'smear' | 'press' | 'hero3d' | 'native-ui';

export interface MMStyleFit {
  tools: MMTool[];
  /** Hero3D objects that suit the style (empty = no Hero3D). */
  hero3d: ('coin' | 'logo' | 'glass-slab' | 'phone')[];
  why: string;
}

export const MM_STYLE_TOOLS: Record<string, MMStyleFit> = {
  'kinetic-type': { tools: ['words', 'count', 'camera', 'smear'], hero3d: [], why: 'type is the picture: whole-word rhythm, counters, snap/dive camera on the words' },
  cinematic: { tools: ['words', 'camera', 'smear', 'hero3d', 'count'], hero3d: ['coin', 'logo', 'glass-slab', 'phone'], why: 'a lit world with depth: real 3D light and a motivated camera' },
  'product-commercial': { tools: ['hero3d', 'camera', 'words', 'count', 'smear'], hero3d: ['coin', 'logo', 'glass-slab'], why: 'Hero3D only for brand objects (mark, coin, slab); a product PHOTO is never rebuilt in 3D' },
  'premium-saas': { tools: ['native-ui', 'press', 'camera', 'words', 'count'], hero3d: [], why: 'the interface proves the claim: native UI, physical press, camera macro' },
  isometric: { tools: ['camera', 'words', 'count'], hero3d: [], why: 'depth through camera moves only; Hero3D does not build isometric worlds' },
  'glass-product-3d': { tools: ['hero3d', 'camera', 'words'], hero3d: ['glass-slab', 'logo', 'phone'], why: 'the WebGL glass this style needs: hero3d glassSlab / logo' },
  'aurora-glass': { tools: ['camera', 'words', 'native-ui'], hero3d: ['glass-slab'], why: 'soft glass world; a glass slab at most' },
  'swiss-motion': { tools: ['words', 'count', 'camera'], hero3d: [], why: 'grid typography; crisp steps, no 3D' },
  editorial: { tools: ['words', 'camera'], hero3d: [], why: 'reading pace, calm camera' },
  'minimal-luxury': { tools: ['words', 'camera', 'hero3d'], hero3d: ['logo', 'coin'], why: 'one precious object, slow light' },
  'soft-3d': { tools: ['hero3d', 'words', 'camera'], hero3d: ['logo', 'coin', 'glass-slab'], why: 'soft physical material' },
  'fui-tech': { tools: ['words', 'count', 'camera', 'smear', 'native-ui'], hero3d: [], why: 'interface energy, counters' },
  'sport-energy': { tools: ['words', 'count', 'camera', 'smear'], hero3d: [], why: 'hits, whips and counters' },
  'retail-pop': { tools: ['words', 'count', 'camera', 'smear'], hero3d: [], why: 'loud type and prices' },
  'sticker-collage': { tools: ['words', 'camera'], hero3d: [], why: 'paper world; no glossy 3D' },
  'flat-vector': { tools: ['words', 'camera'], hero3d: [], why: 'flat drawing; 3D would break the world' },
  'shape-morph': { tools: ['words', 'camera'], hero3d: [], why: 'shapes carry the story; words only' },
  liquid: { tools: ['words', 'camera'], hero3d: [], why: 'fluid shapes; words only' },
  'line-art': { tools: ['words'], hero3d: [], why: 'drawn lines; words only' },
  bauhaus: { tools: ['words', 'count'], hero3d: [], why: 'geometric type' },
  blueprint: { tools: ['words', 'count', 'camera'], hero3d: [], why: 'technical drawing; camera across the plan' },
};

/** Tools a scene family + variant uses (for the style check). */
export function mmToolsOf(family: string, variant: string): MMTool[] {
  if (family === 'mm-kinetic') return variant === 'count' ? ['count', 'words', 'camera'] : ['words', 'camera', 'smear'];
  if (family === 'mm-hero3d') return ['hero3d'];
  if (family === 'mm-phone') return ['native-ui', 'press', 'camera'];
  return [];
}

/** Problems of using `family/variant` under `styleId` (empty = fits; unknown style = no opinion). */
export function mmStyleCheck(styleId: string | undefined, family: string, variant: string): string[] {
  if (!styleId) return [];
  const fit = MM_STYLE_TOOLS[styleId];
  if (!fit) return [];
  const out: string[] = [];
  for (const t of mmToolsOf(family, variant)) if (!fit.tools.includes(t)) out.push(`${family}/${variant} uses MotionMaxxing "${t}", which style ${styleId} does not use (${fit.why})`);
  if (family === 'mm-hero3d' && fit.tools.includes('hero3d') && !fit.hero3d.includes(variant as never)) out.push(`Hero3D "${variant}" does not suit style ${styleId} (allowed: ${fit.hero3d.join(', ') || 'none'})`);
  return out;
}
