/**
 * Style Mixing: a recipe takes whole axes from different styles (Swiss composition + subtle glass
 * material + Premium SaaS motion …). The result is one MotionStyle the rest of the system reads
 * exactly like a library style. Pure.
 */
import type { MotionStyle, RecipeAxis } from './schema';
import { RECIPE_AXES } from './schema';

/** Which MotionStyle fields each recipe axis owns. */
export const AXIS_FIELDS: Record<RecipeAxis, (keyof MotionStyle)[]> = {
  composition: ['compositionGrammar'],
  shape: ['shapeLanguage'],
  material: ['materialLanguage', 'renderingTechnique'],
  typography: ['typographyLanguage'],
  color: ['colorBehavior'],
  depth: ['depthLanguage'],
  motion: ['motionLanguage'],
  transitions: ['transitionLanguage'],
  camera: ['cameraGrammar'],
  rhythm: ['rhythmLanguage'],
  sound: ['soundLanguage'],
  decor: ['decor'],
};

export function composeStyle(base: MotionStyle, from: Partial<Record<RecipeAxis, MotionStyle>>): MotionStyle {
  const used = RECIPE_AXES.filter((k) => from[k] && from[k]!.id !== base.id);
  if (!used.length) return base;
  const out: MotionStyle = JSON.parse(JSON.stringify(base));
  const o = out as unknown as Record<string, unknown>;
  for (const axis of used) {
    const s = from[axis]!;
    for (const f of AXIS_FIELDS[axis]) o[f] = JSON.parse(JSON.stringify((s as unknown as Record<string, unknown>)[f] ?? null)) ?? undefined;
  }
  const vl = { ...out.visualLanguage };
  if (from.composition) Object.assign(vl, { structure: from.composition.visualLanguage.structure, symmetry: from.composition.visualLanguage.symmetry, compositionMotion: from.composition.visualLanguage.compositionMotion, density: from.composition.visualLanguage.density });
  if (from.shape) Object.assign(vl, { geometry: from.shape.visualLanguage.geometry, edges: from.shape.visualLanguage.edges });
  if (from.depth) vl.depth = from.depth.visualLanguage.depth;
  out.visualLanguage = vl;
  // character: average of every style that contributes an axis (weighted by axes)
  const contributors = RECIPE_AXES.map((k) => from[k] ?? base);
  const keys = Object.keys(base.character) as (keyof MotionStyle['character'])[];
  out.character = Object.fromEntries(keys.map((k) => [k, Math.round((contributors.reduce((s, c) => s + c.character[k], 0) / contributors.length) * 100) / 100])) as MotionStyle['character'];
  // transitions must respect the composition's forbids
  const forbid = new Set([...out.transitionLanguage.forbid, ...(from.composition ? from.composition.transitionLanguage.forbid : [])]);
  const prefer = out.transitionLanguage.prefer.filter((t) => !forbid.has(t));
  out.transitionLanguage = { ...out.transitionLanguage, forbid: [...forbid], prefer: prefer.length ? prefer : ['cut'] };
  out.id = `mix-${base.id}-${used.map((k) => `${k}-${from[k]!.id}`).join('-')}`.slice(0, 120);
  out.name = `${base.name} + ${used.map((k) => `${from[k]!.name} ${k}`).join(', ')}`;
  out.nameAr = `${base.nameAr} مع ${used.map((k) => from[k]!.nameAr).join('، ')}`;
  return out;
}
