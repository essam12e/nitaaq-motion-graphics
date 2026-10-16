/**
 * P4-S/AH — reference_reviews/ and studio_reference_schema: how a studio reference (a film the user admires)
 * is reviewed, so motion decisions can cite it. Schemas only — no reference is invented, fetched or copied;
 * a review is written by a person (or Claude, labelled as judgment) about a reference the user provides.
 * Also the documentation of the P4 motion primitives (why / where / how / cost), written next to the films.
 */
import { z } from 'zod';

const Moment = z.object({
  t: z.number().min(0),
  what: z.string().min(4),
  /** the motion idea, in the vocabulary of the choreography graph (pull, push, transform, reveal …). */
  edge: z.string().optional(),
  why: z.string().min(4),
});

/** studio_reference_schema: the facts about a reference film (what it is, where it came from, rights). */
export const StudioReferenceSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(2),
    studio: z.string().optional(),
    source: z.object({ kind: z.enum(['user-file', 'url', 'description']), ref: z.string().min(2) }),
    /** the user owns or may study it; nothing is copied into a film. */
    rights: z.enum(['user-owned', 'study-only']),
    durationSec: z.number().positive().optional(),
    category: z.enum(['saas', 'app', 'brand', 'explainer', 'product', 'other']).default('other'),
  })
  .strict();
export type StudioReference = z.infer<typeof StudioReferenceSchema>;

/** reference_reviews/<id>.json: what a reference does with motion, and what a film may take from it (ideas, never assets). */
export const ReferenceReviewSchema = z
  .object({
    version: z.literal(1),
    reference: z.string(),
    reviewer: z.enum(['user', 'claude-judgment']),
    mainActions: z.array(z.object({ shot: z.string(), action: z.string().min(4) })).default([]),
    keyVisuals: z.array(Moment).max(3).default([]),
    heroMoments: z.array(Moment).default([]),
    choreography: z.array(Moment).default([]),
    language: z.object({ tempo: z.enum(['slow', 'measured', 'quick', 'fast']), bounce: z.enum(['none', 'soft', 'springy', 'playful']), camera: z.enum(['still', 'sparing', 'constant']) }),
    rhythm: z.string().optional(),
    take: z.array(z.string().min(4)).default([]),
    avoid: z.array(z.string().min(4)).default([]),
  })
  .strict();
export type ReferenceReview = z.infer<typeof ReferenceReviewSchema>;

export function validateReferenceReview(x: unknown): { ok: true; review: ReferenceReview } | { ok: false; errors: string[] } {
  const r = ReferenceReviewSchema.safeParse(x);
  return r.success ? { ok: true, review: r.data } : { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** The P4 motion primitives: why, where, how, cost (written as art_builders.json beside each film). */
export function buildBuildersDoc() {
  return {
    version: 1,
    primitives: [
      { name: 'become (cross-element transform)', why: 'the strongest moments of a commercial film are "this becomes that"; P3 could only do it at a cut (morph)', where: 'the CTA (the motif circle becomes the button), any shot resolving into an element', how: 'A travels to B (x, y, sx, sy), takes its outline (morph) and hands over: B appears at A\'s arrival with a small settle; assets are never reshaped (crossfade fallback)', cost: 'compile-time only (3 tracks); renderer: a card rounds off / mixes toward the primary colour (border-radius + colour, no new layer)' },
      { name: 'focus', why: 'three ideas at once is information overload; progressive disclosure without removing anything', where: 'rows of cards / chips (features, steps)', how: 'the element steps forward (scale), same-kind siblings step back (40% opacity, 94% scale); "release" returns all; a sibling not yet on screen is never dimmed', cost: '1 + n tracks per focus event' },
      { name: 'settle + cast.arriveAt (progressive hero)', why: 'a row of small subjects never gives the eye a subject', where: 'steps, any row', how: 'the entrance arrives at a hero pose (centre, larger) and "settle" takes it to its composed place', cost: '1 track per element' },
      { name: 'respond (secondary motion)', why: 'motion caused by motion: the others answer an impact', where: 'hooks, climaxes, landings', how: 'recoil (a kick away from the cause), echo (a smaller scale kick), counter (a tilt kick)', cost: '1 additive kick track' },
      { name: 'phrase / motionLanguage', why: 'phrases and brand language must change the motion, not a label', where: 'every shot (phrase), the whole film (language)', how: 'tempo × durations, spring bounce, stagger with acceleration, amplitude × travels and kicks, a playful tilt', cost: 'none (parameters)' },
    ],
  };
}
