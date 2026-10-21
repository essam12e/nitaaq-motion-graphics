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

export const ShotTransitionSchema = z.union([
  z.string().min(1),
  z.object({
    type: z.string().min(1),
    duration: z.number().min(0).max(2).optional(),
    /** Stage mode (P1): the element that carries an object-driven transition (shared, morph, expand-to-background, text-mask, follow-path, push-inside, depth-pass, shape-transform). */
    element: z.string().optional(),
    /** Morph / shape-transform: the element in the next shot it becomes. */
    into: z.string().optional(),
    /** text-mask / depth-pass: seconds the carrying element keeps its ink while the transition opens (the frame never empties). */
    hold: z.number().min(0).max(0.8).optional(),
    /** P3 cut (type "cut"): a deliberate hard cut — everything leaving holds to the cut frame, everything arriving is on it. A plain "cut" keeps the P1/P2 timing. */
    hard: z.boolean().optional(),
  }),
]);

/** Object-driven transitions (P1, Stage mode): the element itself performs the transition. */
export const OBJECT_TRANSITIONS = ['shared', 'morph', 'expand-to-background', 'text-mask', 'follow-path', 'push-inside', 'depth-pass', 'shape-transform'] as const;
export type ObjectTransition = (typeof OBJECT_TRANSITIONS)[number];
export const isObjectTransition = (t: string | undefined): t is ObjectTransition => Boolean(t && (OBJECT_TRANSITIONS as readonly string[]).includes(t));

/** Stage element ids: lowercase words joined by dots ("dashboard.main", "text.promise", "card.feature01"). */
export const STAGE_ID = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/;
const StageId = z.string().regex(STAGE_ID, 'stage ids are lowercase words joined by dots, e.g. "dashboard.main"');
const FracBox = z.object({ x: z.number().min(-1).max(2), y: z.number().min(-1).max(2), w: z.number().min(0).max(3), h: z.number().min(0).max(3) });

export const STAGE_KINDS = ['text', 'image', 'ui', 'card', 'chip', 'shape', 'line', 'number', 'button', 'cursor', 'icon'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/** A global element of the Stage (P1): declared once, lives across shots by its id. */
export const StageElementDeclSchema = z
  .object({
    id: StageId,
    kind: z.enum(STAGE_KINDS),
    /** Depth plane: fg (near), mg, hero (default for subjects), bg (far). */
    layer: z.enum(['fg', 'mg', 'hero', 'bg']).optional(),
    /** text / chip / button / number label. */
    text: z.string().optional(),
    highlight: z.array(z.string()).optional(),
    /** Text role (headline, title, subtitle, body, cta, label, eyebrow). */
    role: z.enum(['headline', 'title', 'subtitle', 'body', 'caption', 'eyebrow', 'cta', 'label', 'number']).optional(),
    /** Project asset id (logo, screenshot, product …) for image / ui. */
    asset: z.string().optional(),
    icon: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    /** shape: circle, rounded, card, pill, squircle, hexagon, … (morph shapes) */
    shape: z.string().optional(),
    /** primary | accent | surface | text | a hex colour */
    color: z.string().optional(),
    url: z.string().optional(),
    /** number: the value it counts to (a real number from the brief), with optional prefix / suffix. */
    value: z.number().optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    /** line: polyline points in the element box (fractions); `illustrative` = a visual metaphor, never data. */
    points: z.array(z.tuple([z.number(), z.number()])).optional(),
    illustrative: z.boolean().optional(),
    /** Box size: w as a fraction of the canvas width; aspect = w/h in px (defaults by kind / asset). */
    size: z.object({ w: z.number().min(0.01).max(3).optional(), aspect: z.number().min(0.05).max(20).optional() }).optional(),
    /** Child of another element: placed in its box (fractions) and carried by it. */
    parent: StageId.optional(),
    /** Named regions of this element that the camera / transitions can target ("dashboard.chart"). */
    anchors: z.record(StageId, FracBox).optional(),
  })
  .strict();
export type StageElementDecl = z.infer<typeof StageElementDeclSchema>;

/** One element's part in one shot (composition role + optional explicit placement and motion). */
export const CastSchema = z
  .object({
    id: StageId,
    role: z.enum(['hero', 'secondary', 'support', 'background']).default('support'),
    /** Explicit centre (canvas fractions, or parent-box fractions for children) — otherwise the Composition Engine places it. */
    at: z.object({ x: z.number(), y: z.number() }).optional(),
    /** Explicit width (fraction of the canvas width / parent box). */
    w: z.number().min(0.005).max(3).optional(),
    rotation: z.number().min(-180).max(180).optional(),
    opacity: z.number().min(0).max(1).optional(),
    /** How it arrives when it was not on stage in the previous shot. */
    enter: z.enum(['rise', 'slide', 'scale', 'fade', 'draw', 'mask', 'drop', 'none']).optional(),
    /** How it leaves when it is not in the next shot. */
    exit: z.enum(['handoff', 'lift', 'fade', 'scale-down', 'fall', 'none']).optional(),
    sustain: z.enum(['still', 'drift', 'breathe', 'float']).optional(),
    /** P3 motif: sits centred BEHIND another element of the shot (a halo / ground), `scale` × its width — placed after the composition, never moving it. */
    behind: StageId.optional(),
    scale: z.number().min(0.3).max(4).optional(),
    /** P4 progressive hero: the entrance arrives here first (canvas fractions, × its own size); a later "settle" event takes it to its composed place. */
    arriveAt: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().min(0.3).max(4).default(1) }).optional(),
    /** P4.5 motion-aware composition: the entrance starts from this point (canvas fractions) — an entry lane / drop corridor the layout keeps free. */
    enterFrom: z.object({ x: z.number().min(-0.2).max(1.2), y: z.number().min(-0.2).max(1.2) }).optional(),
  })
  .strict();
export type CastEntry = z.infer<typeof CastSchema>;

export const MOTION_ACTIONS = ['enter', 'emphasis', 'sustain', 'exit', 'move', 'transform', 'impact', 'draw', 'count', 'morph', 'press', 'reveal', 'attract', 'push', 'focus', 'settle', 'become', 'respond'] as const;

/**
 * P4 Motion Phrase v2: the motion parameters of one shot (they change the compiled motion, not a label).
 * tempo × every entrance / event duration · bounce = spring bounce of entrances · stagger = seconds between
 * siblings entering together · accel = how that stagger evolves · amplitude × travel / impact sizes.
 */
export const MotionPhraseSchema = z
  .object({
    name: z.string().optional(),
    tempo: z.number().min(0.4).max(2.5).default(1),
    bounce: z.number().min(0).max(0.7).optional(),
    stagger: z.number().min(0).max(0.8).optional(),
    accel: z.enum(['even', 'accelerate', 'decelerate']).default('even'),
    amplitude: z.number().min(0.3).max(2.5).default(1),
  })
  .strict();
export type MotionPhrase = z.infer<typeof MotionPhraseSchema>;

/** P4 motion language (brand motion): defaults for the whole film, overridden by a shot's phrase. */
export const MotionLanguageSchema = z
  .object({
    id: z.string().min(2),
    tempo: z.number().min(0.4).max(2.5).default(1),
    bounce: z.number().min(0).max(0.7).default(0.15),
    amplitude: z.number().min(0.3).max(2.5).default(1),
    /** Default entrance per element kind (text keeps an RTL-safe entrance). */
    enter: z.record(z.enum(['rise', 'slide', 'scale', 'fade', 'draw', 'mask', 'drop', 'none'])).default({}),
    /** Degrees of playful tilt allowed on small objects (0 = none). */
    tilt: z.number().min(0).max(12).default(0),
  })
  .strict();
export type MotionLanguage = z.infer<typeof MotionLanguageSchema>;
export const MotionEventSchema = z.object({
  /** Stage mode: a name other events can follow ("after": "hub-impact"). */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'event ids: lowercase letters, digits, dashes').optional(),
  /** What moves: an element role (headline, card, logo, screenshot …), a stage element id, "camera", or "word:<spoken word>". */
  element: z.string().min(1),
  /** P0: enter, emphasis, sustain, exit. Stage mode adds move, transform, impact, draw, count, morph, press, reveal, attract, push. */
  action: z.enum(MOTION_ACTIONS),
  at: ShotTimeSchema.optional(),
  /** Causality (Stage mode): start when another event reaches a point — "<id>" (its end), "<id>.peak", "<id>.contact", "<id>.start". */
  after: z.string().regex(/^[a-z0-9][a-z0-9-]*(\.(start|end|peak|contact|settle))?$/).optional(),
  /** move / attract / push: the element (or camera target) it moves toward. */
  to: z.string().optional(),
  /** morph: target shape name · transform: scale factor via amount. */
  shape: z.string().optional(),
  amount: z.number().min(-10).max(10).optional(),
  dur: z.number().min(0.05).max(10).optional(),
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
    shotSize: z.enum(['wide', 'medium', 'close', 'extreme-close', 'insert', 'hero', 'detail']).default('wide'),
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
    /** Stage mode (P1): the global elements on stage in this shot and their composition roles. */
    cast: z.array(CastSchema).optional(),
    /** Stage mode: where the shot happens — "frame" (default) or an element whose box becomes the environment (push-inside). */
    region: z.string().optional(),
    /** Stage mode: what the camera move should visibly do to its target ("the metric grows to fill half the frame"). */
    cameraEffect: z.string().optional(),
    /** Stage mode: framing at the start / end of the camera move (shot sizes); default start = the previous framing. */
    framing: z.object({ start: z.enum(['wide', 'medium', 'close', 'extreme-close', 'insert', 'hero', 'detail']).optional(), end: z.enum(['wide', 'medium', 'close', 'extreme-close', 'insert', 'hero', 'detail']).optional() }).optional(),
    /** The visual metaphor this shot shows (direction.json metaphors), if any. */
    metaphor: z.string().optional(),
    /** A deliberate CTA without CTA copy (Stage mode enforces CTA content otherwise) — the reason is required. */
    ctaOverride: z.object({ reason: Reason }).optional(),
    /** P4: the shot's motion phrase (parameters the compiler applies). */
    phrase: MotionPhraseSchema.optional(),
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
    /** P4: the brand's motion language (motion_language.json) — film-wide motion parameters. */
    motionLanguage: MotionLanguageSchema.optional(),
    /** Stage mode (P1): the film's global elements. Present → the Stage Compiler renders the film as one continuous stage. */
    stage: z
      .object({
        elements: z.array(StageElementDeclSchema).min(1),
        /** World background colour at the start (primary | accent | surface | background | hex). */
        world: z.object({ color: z.string().optional() }).optional(),
      })
      .optional(),
  })
  .superRefine((sc, ctx) => {
    const ids = new Set<string>();
    const stageIds = new Set<string>();
    if (sc.stage) {
      for (const [i, e] of sc.stage.elements.entries()) {
        if (stageIds.has(e.id)) ctx.addIssue({ code: 'custom', path: ['stage', 'elements', i, 'id'], message: `duplicate element id "${e.id}"` });
        stageIds.add(e.id);
        for (const a of Object.keys(e.anchors ?? {})) {
          if (stageIds.has(a)) ctx.addIssue({ code: 'custom', path: ['stage', 'elements', i, 'anchors'], message: `anchor id "${a}" clashes with an element id` });
          stageIds.add(a);
        }
      }
      for (const [i, e] of sc.stage.elements.entries()) if (e.parent && !stageIds.has(e.parent)) ctx.addIssue({ code: 'custom', path: ['stage', 'elements', i, 'parent'], message: `parent "${e.parent}" is not a stage element` });
    }
    sc.shots.forEach((s, i) => {
      if (!s.cast) return;
      if (!sc.stage) ctx.addIssue({ code: 'custom', path: ['shots', i, 'cast'], message: 'a cast needs the script-level "stage" with its element declarations' });
      else
        s.cast.forEach((c, k) => {
          if (!stageIds.has(c.id) || sc.stage!.elements.every((e) => e.id !== c.id)) ctx.addIssue({ code: 'custom', path: ['shots', i, 'cast', k, 'id'], message: `"${c.id}" is not a declared stage element` });
        });
    });
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
