/**
 * When a vector scene runs its programs (pure: variant, content and scene length in, programs out).
 * The scene, `nitaaq seek`, QC and the effect budget all read the same numbers.
 *
 *   draw      the art is traced and filled
 *   build     its groups assemble
 *   morph     it becomes the second SVG (`morphTo`)
 *   sequence  traced, filled, held, then morphed into `morphTo` (draw alone without one)
 *   graph     a Non-Destructive Vector Graph (src/vector/graph.ts) evaluated over time from `start`
 */
import { programAt, type ProgramState, type VectorOrder, type VectorProgram } from './animate';

export const VECTOR_VARIANTS = ['draw', 'build', 'morph', 'sequence', 'graph'] as const;
export type VectorVariant = (typeof VECTOR_VARIANTS)[number];

export interface VectorTiming {
  morphTo?: string;
  order?: VectorOrder;
  /** Seconds the draw / build / morph takes (else from the scene's length). */
  drawSeconds?: number;
  morphSeconds?: number;
}

/** A graph's clock starts this many seconds into the scene. */
export const GRAPH_START = 0.15;

const clampR = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function vectorPrograms(variant: string | undefined, c: VectorTiming, sceneSec: number): VectorProgram[] {
  const v = (VECTOR_VARIANTS as readonly string[]).includes(variant ?? '') ? (variant as VectorVariant) : 'draw';
  const order = c.order ?? 'rtl';
  const lead = 0.15;
  if (v === 'graph') return [{ mode: 'static', start: GRAPH_START }];
  if (v === 'build') return [{ mode: 'build', start: lead, duration: c.drawSeconds ?? clampR(sceneSec * 0.45, 0.9, 2.4), order }];
  if (v === 'morph') {
    if (!c.morphTo) return [{ mode: 'static' }];
    return [{ mode: 'morph', start: clampR(sceneSec * 0.3, 0.5, 1.4), duration: c.morphSeconds ?? clampR(sceneSec * 0.35, 0.8, 1.8) }];
  }
  if (v === 'sequence' && c.morphTo) {
    const draw = c.drawSeconds ?? clampR(sceneSec * 0.42, 1.2, 3);
    const hold = clampR(sceneSec * 0.08, 0.3, 0.8);
    return [
      { mode: 'draw', start: lead, duration: draw, order },
      { mode: 'morph', start: lead + draw + hold, duration: c.morphSeconds ?? clampR(sceneSec * 0.25, 0.8, 1.6) },
    ];
  }
  return [{ mode: 'draw', start: lead, duration: c.drawSeconds ?? clampR(sceneSec * 0.55, 1.2, 3.2), order }];
}

/** The program on screen at scene second `sec`: the last one that has started (else the first). */
export function activeProgram(programs: VectorProgram[], sec: number): VectorProgram {
  let p = programs[0] ?? { mode: 'static' as const };
  for (const x of programs) if ((x.start ?? 0) <= sec) p = x;
  return p;
}

export interface VectorSceneState extends ProgramState {
  /** Index of the program on screen (0 = first). */
  step: number;
  steps: number;
}

export function vectorStateAt(programs: VectorProgram[], sec: number): VectorSceneState {
  const p = activeProgram(programs, sec);
  return { ...programAt(p, sec), step: Math.max(0, programs.indexOf(p)), steps: programs.length };
}
