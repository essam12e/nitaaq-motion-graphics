/**
 * Style Similarity Check: two styles count as different only when they differ on several
 * STRUCTURAL axes (composition, shape, material, depth, type, motion, transitions, camera,
 * rhythm, geometry, signature, decor). Colour, easing and corner radius alone never count.
 * Pure.
 */
import type { MotionStyle } from './schema';

export const PRIMARY_AXES = ['composition', 'shape', 'material', 'depth', 'typography', 'motion', 'transitions', 'camera', 'rhythm', 'geometry', 'signature', 'decor'] as const;
export type PrimaryAxis = (typeof PRIMARY_AXES)[number];
/** Minimum number of primary axes two styles must differ on. */
export const MIN_DIFFERENT_AXES = 6;

const band = (v: number, cuts: number[], names: string[]) => names[cuts.findIndex((c) => v < c) === -1 ? names.length - 1 : cuts.findIndex((c) => v < c)];

export function styleFeatures(s: MotionStyle): Record<PrimaryAxis, string> {
  const native = s.signatureMoves.filter((m) => m.native).map((m) => m.builder).sort();
  return {
    composition: `${s.compositionGrammar.grid}/${s.compositionGrammar.strategies.default ?? 'centered'}/${s.compositionGrammar.alignment}`,
    shape: `${s.shapeLanguage.primary}/${s.shapeLanguage.corner}`,
    material: s.materialLanguage.kind,
    depth: `${s.visualLanguage.depth}/${s.depthLanguage.planes}`,
    typography: `${s.typographyLanguage.align}/${s.typographyLanguage.reveal}/${band(s.typographyLanguage.displayWeight, [450, 750], ['light', 'mid', 'heavy'])}/${s.typographyLanguage.kinetic}`,
    motion: `${s.motionLanguage.curve}/${band(s.motionLanguage.tempo, [0.8, 1.2], ['slow', 'mid', 'fast'])}${s.motionLanguage.stepped ? '/stepped' : ''}`,
    transitions: s.transitionLanguage.prefer[0],
    camera: s.cameraGrammar.need,
    rhythm: `${s.rhythmLanguage.pace}/${s.rhythmLanguage.pattern}`,
    geometry: `${s.visualLanguage.geometry}/${s.visualLanguage.structure}`,
    signature: native.join('+'),
    decor: s.decor.kind,
  };
}

export interface SimilarityResult {
  a: string;
  b: string;
  differentAxes: PrimaryAxis[];
  sameAxes: PrimaryAxis[];
  /** 0 identical … 1 every axis differs. */
  distance: number;
  distinct: boolean;
  /** True when the only differences are cosmetic (colour / easing / radius). */
  cosmeticOnly: boolean;
}

export function compareStyles(a: MotionStyle, b: MotionStyle): SimilarityResult {
  const fa = styleFeatures(a);
  const fb = styleFeatures(b);
  const differentAxes = PRIMARY_AXES.filter((k) => fa[k] !== fb[k]);
  const sameAxes = PRIMARY_AXES.filter((k) => fa[k] === fb[k]);
  // continuous character difference adds a little resolution
  const ch = Object.keys(a.character) as (keyof MotionStyle['character'])[];
  const cdiff = ch.reduce((s, k) => s + Math.abs(a.character[k] - b.character[k]), 0) / ch.length;
  const distance = Math.round((0.8 * (differentAxes.length / PRIMARY_AXES.length) + 0.2 * Math.min(1, cdiff * 2)) * 1000) / 1000;
  return { a: a.id, b: b.id, differentAxes, sameAxes, distance, distinct: differentAxes.length >= MIN_DIFFERENT_AXES, cosmeticOnly: differentAxes.length === 0 };
}

export function similarityMatrix(styles: MotionStyle[]): { pairs: SimilarityResult[]; failures: SimilarityResult[]; closest: SimilarityResult[] } {
  const pairs: SimilarityResult[] = [];
  for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) pairs.push(compareStyles(styles[i], styles[j]));
  const failures = pairs.filter((p) => !p.distinct);
  const closest = [...pairs].sort((x, y) => x.distance - y.distance || x.a.localeCompare(y.a)).slice(0, 8);
  return { pairs, failures, closest };
}
