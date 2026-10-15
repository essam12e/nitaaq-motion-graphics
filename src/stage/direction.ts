/**
 * Creative Direction (P1-N): direction.json — written by Claude BEFORE the shot script, in Stage
 * mode. It fixes the film's languages (visual, motion, camera, typography, transitions), its
 * composition / depth / colour rules, pacing, the visual metaphors ("how do I SHOW this?" before
 * "what text do I display?"), the style frames (key visual moments) and a do / don't list.
 *
 * The shot script must obey it: the Stage Compiler checks the checkable parts (camera moves and
 * budget, transition kinds, metaphors used, style-frame shots exist) and reports every deviation.
 */
import { z } from 'zod';

const Line = z.string().min(3);

export const DirectionSchema = z
  .object({
    version: z.literal(1).default(1),
    title: z.string().optional(),
    visualLanguage: Line,
    motionLanguage: Line,
    camera: z.object({
      language: Line,
      /** Moves this film may use (static, push, pull, follow, truck, orbit, rack, hold). */
      allowed: z.array(z.string()).min(1),
      /** Largest share of shots the camera may move in, and why that much. */
      budget: z.object({ maxMovingShare: z.number().min(0).max(1), reason: Line }),
    }),
    typography: z.object({ language: Line, rules: z.array(Line).default([]) }),
    transitions: z.object({ language: Line, prefer: z.array(z.string()).default([]), avoid: z.array(z.string()).default([]) }),
    composition: z.array(Line).min(1),
    depth: Line,
    color: Line,
    lighting: z.string().optional(),
    pacing: Line,
    rhythm: z.string().optional(),
    metaphors: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), line: z.string().min(2), show: Line })).default([]),
    /** Key visual moments to freeze and check before animating (shot id + where in it). */
    styleFrames: z.array(z.object({ shot: z.string(), at: z.union([z.number().min(0), z.literal('settle')]).default('settle'), note: Line })).default([]),
    do: z.array(Line).default([]),
    dont: z.array(Line).default([]),
  })
  .strict();
export type Direction = z.infer<typeof DirectionSchema>;

export function validateDirection(input: unknown): { ok: true; direction: Direction } | { ok: false; errors: string[] } {
  const r = DirectionSchema.safeParse(input);
  if (r.success) return { ok: true, direction: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** Canonical camera move family of a shot-script move name (push-in → push, truck-left → truck …). */
export function moveFamily(move: string): string {
  const m = move.toLowerCase();
  if (m === 'static' || m === 'none' || m === 'locked') return 'static';
  if (/push|dolly-in|zoom-in|close/.test(m)) return 'push';
  if (/pull|dolly-out|zoom-out|resolve/.test(m)) return 'pull';
  if (/follow|track-target/.test(m)) return 'follow';
  if (/truck|pan|track/.test(m)) return 'truck';
  if (/orbit|arc/.test(m)) return 'orbit';
  if (/rack/.test(m)) return 'rack';
  if (/hold|drift/.test(m)) return 'hold';
  if (/crane|pedestal|tilt|rise/.test(m)) return 'crane';
  return m;
}
