/**
 * Shot Script (P0-C): a Claude-authored, shot-by-shot directing document (shots.json).
 *
 *   shots.json → validation (this file) → shot compiler → the existing VideoSpec → the existing renderer
 *
 * The script is the director's decision record. In Full Director Mode nothing random overrides what
 * it specifies (camera, transition, typography, variant, timing). Every camera move, transition and
 * major motion event must say WHY — a decision without a reason is a validation error.
 * Pure (no node APIs).
 */
import { z } from 'zod';

/** A time inside a shot: scene-local seconds, or a spoken word ("word:منصة", resolved with the voice map). */
export const ShotTimeSchema = z.union([z.number().min(0), z.string().regex(/^word:.+/, 'use seconds or "word:<spoken word>"')]);
export type ShotTime = z.infer<typeof ShotTimeSchema>;

const Reason = z.string().trim().min(4, 'a reason must say why (at least a few words)');

interface ShotCameraMove {
  move: string;
  amplitude?: number;
  startAt?: ShotTime;
  endAt?: ShotTime;
  ease?: string;
  accents?: ShotTime[];
}

export const ShotCameraSchema = z.union([
  /** "static", or a move / preset name as shorthand for { move }. */
  z.string().min(1).transform((m): 'static' | ShotCameraMove => (m === 'static' ? 'static' : { move: m })),
  z.object({
    /** A camera move (src/camera/moves.ts CAMERA_MOVES) or a preset name; unknown names map to the nearest move (reported). */
    move: z.string().min(1),
    amplitude: z.number().min(0).max(1.5).optional(),
    /** Start / end of the move as a time inside the shot (seconds or "word:…"). */
    startAt: ShotTimeSchema.optional(),
    endAt: ShotTimeSchema.optional(),
    ease: z.string().optional(),
    /** Short camera punctuations (seconds or spoken words). Voice first; music beats only sweeten. */
    accents: z.array(ShotTimeSchema).optional(),
  }),
]);

export const ShotTransitionSchema = z.union([z.string().min(1), z.object({ type: z.string().min(1), duration: z.number().min(0).max(2).optional() })]);

export const MotionEventSchema = z.object({
  /** What moves: an element role (headline, card, logo, screenshot …) or "word:<spoken word>". */
  element: z.string().min(1),
  action: z.enum(['enter', 'emphasis', 'sustain', 'exit']),
  at: ShotTimeSchema.optional(),
  /** sustain: still | drift | breathe | parallax · exit: handoff | lift | fade | scale-down | none. */
  style: z.string().optional(),
  direction: z.enum(['left', 'right', 'up', 'down', 'in', 'out']).optional(),
  velocity: z.number().min(0).max(1).optional(),
  reason: Reason,
});

export const ShotSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase id (letters, digits, dashes)'),
    /** The narrative job (hook, problem, solution, demo, feature, proof, offer, brand, cta, …). */
    purpose: z.string().min(2),
    /** The one thing the viewer must take from this shot. */
    message: z.string().min(2),
    /** The words spoken during this shot (matched in the voice map) or explicit film times. */
    voiceAnchor: z.object({ text: z.string().optional(), start: z.number().min(0).optional(), end: z.number().min(0).optional() }).optional(),
    timing: z.object({ duration: z.number().min(0.3).max(60).optional(), minHold: z.number().min(0).optional() }).default({}),
    /** What the shot is about (the element the eye should land on). */
    subject: z.string().min(1),
    shotSize: z.enum(['wide', 'medium', 'close', 'extreme-close', 'insert']).default('wide'),
    composition: z.string().default('centered'),
    /** Existing scene family (nitaaq scenes) and variant. */
    sceneFamily: z.string().min(1),
    variant: z.string().optional(),
    /** Content of the scene family (its own schema). Omitted → built from the brief by the family's recipe. */
    elements: z.record(z.unknown()).optional(),
    /** Why things move in this shot (one sentence). */
    motionIntent: z.string().min(4),
    motionChain: z.array(MotionEventSchema).default([]),
    camera: ShotCameraSchema.default('static'),
    cameraTarget: z.string().optional(),
    cameraReason: z.string().optional(),
    /** Text motion families by role (headline, support, cta, label). */
    typography: z.object({ headline: z.string().optional(), support: z.string().optional(), cta: z.string().optional(), label: z.string().optional() }).optional(),
    emphasisWords: z.array(z.string().min(1)).default([]),
    transitionOut: ShotTransitionSchema.optional(),
    transitionTarget: z.string().optional(),
    transitionReason: z.string().optional(),
    audioCues: z.array(z.object({ at: ShotTimeSchema, sound: z.string().min(1), reason: z.string().optional() })).default([]),
    continuity: z.object({ from: z.string().optional(), element: z.string().optional(), note: z.string().optional() }).optional(),
    /** 0..1 how much energy the shot should carry (drives scene intensity). */
    expectedEnergy: z.number().min(0).max(1).default(0.6),
    /** A deliberate still hold (counted as intentional by Motion Metrics, up to maxSec). */
    hold: z.object({ intentional: z.boolean().default(true), reason: Reason, maxSec: z.number().min(0.3).max(10).optional() }).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.camera !== 'static' && !(s.cameraReason && s.cameraReason.trim().length >= 4)) ctx.addIssue({ code: 'custom', path: ['cameraReason'], message: `camera "${s.camera.move}" needs a cameraReason (why the camera moves)` });
    if (!s.timing.duration && !s.voiceAnchor) ctx.addIssue({ code: 'custom', path: ['timing', 'duration'], message: 'give timing.duration or a voiceAnchor (voice-timed shots)' });
  });
export type Shot = z.infer<typeof ShotSchema>;

export const ShotScriptSchema = z
  .object({
    version: z.literal(1).default(1),
    /** Full Director Mode is the only mode a shot script runs in. */
    mode: z.literal('full').default('full'),
    title: z.string().optional(),
    /** Text motion personality for the whole film (premium, tech, corporate, …); omitted → the brief's. */
    personality: z.string().optional(),
    shots: z.array(ShotSchema).min(1),
  })
  .superRefine((sc, ctx) => {
    const ids = new Set<string>();
    sc.shots.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['shots', i, 'id'], message: `duplicate shot id "${s.id}"` });
      ids.add(s.id);
      const last = i === sc.shots.length - 1;
      const type = typeof s.transitionOut === 'string' ? s.transitionOut : s.transitionOut?.type;
      if (!last && !type) ctx.addIssue({ code: 'custom', path: ['shots', i, 'transitionOut'], message: `shot "${s.id}" needs a transitionOut to "${sc.shots[i + 1].id}" (a hard cut is a decision too: "cut")` });
      if (!last && type && !(s.transitionReason && s.transitionReason.trim().length >= 4)) ctx.addIssue({ code: 'custom', path: ['shots', i, 'transitionReason'], message: `transition "${type}" out of "${s.id}" needs a transitionReason` });
      if (last && type && type !== 'none') ctx.addIssue({ code: 'custom', path: ['shots', i, 'transitionOut'], message: 'the last shot has no outgoing transition' });
      if (!last && s.transitionTarget && s.transitionTarget !== sc.shots[i + 1].id) ctx.addIssue({ code: 'custom', path: ['shots', i, 'transitionTarget'], message: `transitionTarget "${s.transitionTarget}" is not the next shot ("${sc.shots[i + 1].id}")` });
    });
  });
export type ShotScript = z.infer<typeof ShotScriptSchema>;

/** Readable validation: every problem as "shots[2].cameraReason: …". */
export function validateShotScript(input: unknown): { ok: true; script: ShotScript } | { ok: false; errors: string[] } {
  const r = ShotScriptSchema.safeParse(input);
  if (r.success) return { ok: true, script: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('').replace(/^\./, '')}: ${i.message}`) };
}
