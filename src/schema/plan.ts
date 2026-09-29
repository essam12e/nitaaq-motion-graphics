/** Creative plan (Director output) and storyboard schemas. */
import { z } from 'zod';

export const BeatSchema = z.enum([
  'hook',
  'problem',
  'solution',
  'demo',
  'feature',
  'product',
  'offer',
  'proof',
  'data',
  'social',
  'process',
  'comparison',
  'brand',
  'bridge',
  'cta',
]);
export type Beat = z.infer<typeof BeatSchema>;

export const CreativePlanSchema = z.object({
  objective: z.string(),
  audience: z.string(),
  platform: z.string(),
  aspect: z.string(),
  duration: z.number(),
  pace: z.enum(['slow', 'medium', 'fast']),
  tone: z.array(z.string()),
  visualStyle: z.string(),
  styleReason: z.string(),
  energyCurve: z.array(z.number()),
  narrativeArc: z.array(z.object({ beat: BeatSchema, message: z.string(), weight: z.number() })),
  sceneStrategy: z.array(z.string()),
  audioStrategy: z.object({
    mode: z.string(),
    music: z.string(),
    sfx: z.string(),
    voice: z.string(),
  }),
  brandStrategy: z.object({
    source: z.string(),
    logoUsage: z.string(),
    palette: z.string(),
    font: z.string(),
  }),
  constraints: z.array(z.string()),
});
export type CreativePlan = z.infer<typeof CreativePlanSchema>;

export const StoryboardSceneSchema = z.object({
  id: z.string(),
  beat: BeatSchema,
  purpose: z.string(),
  start: z.number(),
  duration: z.number(),
  visibleMessage: z.string(),
  supportingVisual: z.string(),
  family: z.string(),
  variant: z.string(),
  composition: z.string(),
  movement: z.string(),
  transition: z.string(),
  soundEvents: z.array(z.string()),
  narration: z.object({ start: z.number(), end: z.number(), text: z.string().optional() }).optional(),
  emphasis: z.string(),
  ctaRelation: z.string(),
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardSchema = z.object({
  totalDuration: z.number(),
  scenes: z.array(StoryboardSceneSchema),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;
