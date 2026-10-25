/**
 * Style compatibility for mixing (compatible / partially-compatible / conflicting).
 * A mix takes whole axes from different styles; these rules catch the combinations that
 * break each other (a luxury glide on a sticker-slap rhythm, a camera that needs depth over a
 * flat poster, a transition the composition style forbids). Pure.
 */
import type { MotionStyle, RecipeAxis } from './schema';

export type Verdict = 'compatible' | 'partially-compatible' | 'conflicting';
export interface CompatResult { verdict: Verdict; notes: string[] }

const SOFT_CURVES = new Set(['glide', 'linear']);
const LIVELY_CURVES = new Set(['spring', 'elastic', 'stepped']);

/** Verdict for a recipe whose axes come from `src` (axis → style). */
export function checkMix(src: Partial<Record<RecipeAxis, MotionStyle>>, base: MotionStyle): CompatResult {
  const at = (k: RecipeAxis) => src[k] ?? base;
  const hard: string[] = [];
  const soft: string[] = [];
  const motion = at('motion');
  const rhythm = at('rhythm');
  const comp = at('composition');
  const material = at('material');
  const camera = at('camera');
  const trans = at('transitions');
  const depth = at('depth');
  const typo = at('typography');

  const lux = (s: MotionStyle) => s.character.luxury;
  const play = (s: MotionStyle) => s.character.playfulness;
  const pairs: [string, MotionStyle, MotionStyle][] = [
    ['material/motion', material, motion],
    ['composition/motion', comp, motion],
    ['typography/motion', typo, motion],
    ['material/composition', material, comp],
  ];
  for (const [label, x, y] of pairs) {
    if (x.id === y.id) continue;
    if (Math.abs(lux(x) - lux(y)) > 0.6 && Math.abs(play(x) - play(y)) > 0.6) hard.push(`${label}: ${x.id} (luxury ${lux(x)}) and ${y.id} (playful ${play(y)}) pull in opposite directions`);
    else if (Math.abs(x.character.energy - y.character.energy) > 0.55) soft.push(`${label}: energy ${x.character.energy} vs ${y.character.energy} (${x.id} / ${y.id})`);
  }
  if (motion.id !== rhythm.id) {
    const e = Math.abs(motion.character.energy - rhythm.character.energy);
    if (SOFT_CURVES.has(motion.motionLanguage.curve) && rhythm.rhythmLanguage.pace === 'fast') hard.push(`motion ${motion.id} glides slowly but rhythm ${rhythm.id} cuts fast: moves would be cut before they land`);
    else if (e > 0.5) soft.push(`motion/rhythm energy differ (${motion.id} / ${rhythm.id})`);
  }
  if (camera.id !== depth.id && camera.cameraGrammar.need === 'often' && depth.depthLanguage.planes <= 1) soft.push(`camera ${camera.id} moves a lot but ${depth.id} has one flat plane: the moves reveal nothing`);
  if (camera.id !== comp.id && comp.cameraGrammar.need === 'none' && camera.cameraGrammar.need === 'often') soft.push(`${comp.id} composes a still poster; a moving camera (${camera.id}) breaks it`);
  if (trans.id !== comp.id) {
    const forbidden = trans.transitionLanguage.prefer.slice(0, 2).filter((t) => comp.transitionLanguage.forbid.includes(t));
    if (forbidden.length === 2) hard.push(`${trans.id} transitions (${forbidden.join(', ')}) are forbidden by ${comp.id}`);
    else if (forbidden.length) soft.push(`${trans.id} prefers ${forbidden[0]}, which ${comp.id} forbids (the next preference is used)`);
  }
  if (material.id !== motion.id && material.materialLanguage.kind === 'metallic' && LIVELY_CURVES.has(motion.motionLanguage.curve) && motion.motionLanguage.bounce > 0.3) hard.push(`bouncy ${motion.id} motion on ${material.id} hairline metal looks cheap`);
  if (material.id !== comp.id && comp.compositionGrammar.snapToGrid && material.materialLanguage.kind === 'gloss') soft.push(`glossy blobs (${material.id}) on a strict grid (${comp.id})`);
  if (typo.id !== motion.id && typo.typographyLanguage.kinetic === 'slam' && SOFT_CURVES.has(motion.motionLanguage.curve)) soft.push(`slam type (${typo.id}) with a soft glide (${motion.id}) loses its hit`);
  const verdict: Verdict = hard.length ? 'conflicting' : soft.length ? 'partially-compatible' : 'compatible';
  return { verdict, notes: [...hard, ...soft] };
}

/** Pairwise verdict: A's look (composition/shape/material/type/colour/depth/decor) with B's motion, transitions, camera and rhythm. */
export function pairCompatibility(a: MotionStyle, b: MotionStyle): CompatResult {
  if (a.id === b.id) return { verdict: 'compatible', notes: [] };
  return checkMix({ motion: b, transitions: b, camera: b, rhythm: b }, a);
}

export function compatibilityMatrix(styles: MotionStyle[]): Record<string, Record<string, Verdict>> {
  const out: Record<string, Record<string, Verdict>> = {};
  for (const a of styles) {
    out[a.id] = {};
    for (const b of styles) out[a.id][b.id] = pairCompatibility(a, b).verdict;
  }
  return out;
}
