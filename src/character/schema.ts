/**
 * NITAAQ Character Motion Engine — schemas.
 *
 * "AI / the user provides the character art; code animates the character."
 * A character is prepared ONCE into a portable Character Package and reused:
 *
 *   character-package/
 *     character.json      CharacterManifest  (identity, poses, capabilities, constraints)
 *     bible.json          CharacterBible     (+ CHARACTER_BIBLE.md, human readable)
 *     pose-library.json   PoseLibrary        (semantic index of the poses)
 *     rig.json            Rig                (layered SVG only)
 *     anchors.json        per-pose anchors   (auto-detected; anchors.override.json wins)
 *     poses/*.png         transparent pose crops (never edited beyond background removal + crop)
 *     thumbnails/*.png    small previews + contact.png
 *
 * Coordinates of anchors are fractions (0..1) of the pose image. Everything is
 * runtime-validated (Zod) when a package is loaded from disk.
 */
import { z } from 'zod';

export const CHARACTER_SCHEMA = 'nitaaq.character/1';
/** Bump when preparation changes in a way that must invalidate cached packages. */
export const CHARACTER_ENGINE_VERSION = 'ce-1.0.0';

export const POSE_STATES = [
  'neutral',
  'idle',
  'thinking',
  'confused',
  'surprised',
  'happy',
  'excited',
  'talking',
  'listening',
  'pointing',
  'presenting',
  'holding_phone',
  'looking_phone',
  'typing',
  'celebrating',
  'explaining',
  'warning',
  'questioning',
] as const;
export type PoseState = (typeof POSE_STATES)[number];

export const EXPRESSIONS = ['neutral', 'happy', 'excited', 'surprised', 'confused', 'skeptical', 'thinking', 'worried', 'focused'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const GESTURES = ['none', 'point', 'present', 'wave', 'thumbs_up', 'hand_on_chin', 'shrug', 'hold_phone', 'type', 'celebrate', 'explain', 'stop', 'hands_together'] as const;
export type Gesture = (typeof GESTURES)[number];

export const ANGLES = ['front', 'three_quarter_left', 'three_quarter_right', 'side_left', 'side_right', 'back'] as const;
export type Angle = (typeof ANGLES)[number];

export const PROPS = ['none', 'phone', 'laptop', 'tablet', 'box', 'product', 'card', 'chart', 'sign'] as const;
export type PropKind = (typeof PROPS)[number];

export const COMPLEXITY = ['STATIC', 'POSE_BASED', 'PARTIAL_RIG', 'FULL_VECTOR_RIG'] as const;
export type Complexity = (typeof COMPLEXITY)[number];

export const SOURCE_TYPES = ['sheet', 'poses', 'svg', 'single', 'package'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const Pt = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Pt>;

export const AnchorsSchema = z.object({
  headTop: Pt,
  headCenter: Pt,
  neck: Pt,
  shoulderL: Pt,
  shoulderR: Pt,
  elbowL: Pt.optional(),
  elbowR: Pt.optional(),
  wristL: Pt.optional(),
  wristR: Pt.optional(),
  handL: Pt,
  handR: Pt,
  torsoCenter: Pt,
  hips: Pt,
  feet: Pt,
  /** Fraction of the image height the head occupies (scale reference between poses). */
  headHeight: z.number(),
  /** 0..1 — how much the detector trusts these anchors. */
  confidence: z.number().min(0).max(1),
  source: z.enum(['auto', 'rig', 'manual']),
  /** Head can be split from the body at the neck without damaging the art (flat PNG puppet). */
  headSeparable: z.boolean().default(false),
});
export type Anchors = z.infer<typeof AnchorsSchema>;

export const FingerprintSchema = z.object({
  /** 12-bin hue × 3-bin lightness histogram of opaque pixels (sum = 1). */
  hist: z.array(z.number()),
  /** Dominant colours (hex), most frequent first. */
  palette: z.array(z.string()),
  /** Mean luminance 0..1 and its left−right difference (light direction). */
  luma: z.number(),
  lightBias: z.number(),
  /** Opaque-pixel coverage of the bounding box (silhouette density). */
  fill: z.number(),
});
export type Fingerprint = z.infer<typeof FingerprintSchema>;

export const PoseSemanticsSchema = z.object({
  state: z.enum(POSE_STATES),
  confidence: z.number().min(0).max(1),
  /** Why: label words, visual features measured on the silhouette. */
  evidence: z.array(z.string()).default([]),
});

export const PoseSchema = z.object({
  poseId: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  /** Package-relative transparent PNG (empty for rig poses rendered from rig.json). */
  file: z.string(),
  source: z.object({ asset: z.string(), rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(), label: z.string().optional() }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  angle: z.enum(ANGLES).default('front'),
  expression: z.enum(EXPRESSIONS).default('neutral'),
  gesture: z.enum(GESTURES).default('none'),
  handState: z.enum(['relaxed', 'raised', 'extended', 'holding', 'together', 'hidden']).default('relaxed'),
  prop: z.enum(PROPS).default('none'),
  /** Which way the body / head turn (for gaze toward text, matching cuts). */
  bodyDirection: z.enum(['left', 'right', 'front']).default('front'),
  headDirection: z.enum(['left', 'right', 'front', 'up', 'down']).default('front'),
  energy: z.number().min(0).max(1).default(0.4),
  recommendedUses: z.array(z.string()).default([]),
  semantics: PoseSemanticsSchema,
  /** For rig characters: joint angles + expression that produce this pose. */
  rigPose: z.record(z.number()).optional(),
  anchors: AnchorsSchema,
  fingerprint: FingerprintSchema,
  /** Which side the pose was cropped as: full body, half body (waist up) or bust. */
  framing: z.enum(['full-body', 'half-body', 'bust', 'head']).default('full-body'),
});
export type Pose = z.infer<typeof PoseSchema>;

export const RigPartSchema = z.object({
  id: z.string(),
  /** Logical part (head, torso, upperArmL …) or 'other'. */
  kind: z.string(),
  parent: z.string().optional(),
  /** Joint pivot in rig (viewBox) coordinates. */
  pivot: Pt,
  /** Paint order (lower first). */
  z: z.number(),
  /** SVG markup of the part itself (children parts excluded). */
  markup: z.string(),
  /** Alternative markup per state (eyes--closed, mouth--smile …). */
  states: z.record(z.string()).default({}),
  defaultState: z.string().optional(),
  limits: z.tuple([z.number(), z.number()]).optional(),
  bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});
export type RigPart = z.infer<typeof RigPartSchema>;

export const RigSchema = z.object({
  schema: z.literal('nitaaq.rig/1'),
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** full: arms with elbows + head; partial: head and/or whole arms; grouped: one transform for the whole art. */
  mode: z.enum(['full', 'partial', 'grouped']),
  parts: z.array(RigPartSchema),
  /** <defs> (gradients, patterns, clip paths) shared by every part. */
  defs: z.string().default(''),
  warnings: z.array(z.string()).default([]),
  /** Stage box (rig units) that holds every prepared pose (raised / extended arms included). */
  canvas: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
});
export type Rig = z.infer<typeof RigSchema>;

export const CharacterManifestSchema = z.object({
  schema: z.literal(CHARACTER_SCHEMA),
  engine: z.string(),
  characterId: z.string(),
  name: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceAssets: z.array(z.object({ path: z.string(), hash: z.string(), role: z.string() })),
  style: z.object({ kind: z.enum(['flat', 'semi-flat', 'cel-shaded', 'editorial', 'painterly', 'unknown']), outline: z.boolean(), note: z.string().optional() }),
  bodyType: z.enum(['full-body', 'half-body', 'bust', 'head']),
  visualIdentity: z.object({ palette: z.array(z.string()), skinTone: z.string().optional(), outfit: z.array(z.string()).default([]), culturalGarments: z.array(z.string()).default([]) }),
  poses: z.array(PoseSchema).min(1),
  expressions: z.array(z.string()),
  angles: z.array(z.string()),
  parts: z.array(z.string()).default([]),
  hasRig: z.boolean(),
  props: z.array(z.string()).default([]),
  palette: z.array(z.string()),
  lighting: z.object({ direction: z.enum(['left', 'right', 'top', 'flat']), luma: z.number() }),
  allowedActions: z.array(z.string()),
  restrictedActions: z.array(z.string()),
  preferredCameraAngles: z.array(z.string()),
  animationCapabilities: z.object({
    complexity: z.enum(COMPLEXITY),
    headSeparable: z.boolean(),
    blink: z.boolean(),
    mouthStates: z.array(z.string()),
    expressionLayers: z.boolean(),
    armRig: z.boolean(),
  }),
  identityConstraints: z.array(z.string()),
  warnings: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
});
export type CharacterManifest = z.infer<typeof CharacterManifestSchema>;

export const PoseLibrarySchema = z.object({
  schema: z.literal('nitaaq.pose-library/1'),
  characterId: z.string(),
  /** state → poseIds that can play it, best first. */
  byState: z.record(z.array(z.string())),
  byExpression: z.record(z.array(z.string())),
  byGesture: z.record(z.array(z.string())),
  byProp: z.record(z.array(z.string())),
  /** States the art cannot show (missing-pose strategy uses this). */
  missing: z.array(z.string()),
});
export type PoseLibrary = z.infer<typeof PoseLibrarySchema>;

export const CharacterBibleSchema = z.object({
  schema: z.literal('nitaaq.character-bible/1'),
  characterId: z.string(),
  name: z.string(),
  summary: z.string(),
  visualIdentity: z.array(z.string()),
  style: z.string(),
  proportions: z.string(),
  facialFeatures: z.array(z.string()),
  outfit: z.array(z.string()),
  accessories: z.array(z.string()),
  palette: z.array(z.string()),
  lightingLanguage: z.string(),
  allowedExpressions: z.array(z.string()),
  availablePoses: z.array(z.object({ poseId: z.string(), state: z.string(), uses: z.array(z.string()) })),
  motionPersonality: z.string(),
  behavior: z.array(z.string()),
  identityLock: z.array(z.string()),
});
export type CharacterBible = z.infer<typeof CharacterBibleSchema>;

/** What the brief may say about a character (all optional; the engine decides the rest). */
export const BriefCharacterSchema = z.object({
  /** A character package folder, or the name of one in the character library (characters/<name>). */
  use: z.string().optional(),
  name: z.string().optional(),
  /** Level A: one image with several poses/expressions. */
  sheet: z.string().optional(),
  /** Optional labels for the sheet poses in reading order (left→right, top→bottom). */
  sheetLabels: z.array(z.string()).optional(),
  /** Manual crop manifest when automatic sheet detection fails ({x,y,width,height} in sheet pixels). */
  crops: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), label: z.string().optional() })).optional(),
  /** Level B: several PNG poses (label = what the pose shows; otherwise read from the file name + silhouette). */
  poses: z.array(z.object({ path: z.string(), label: z.string().optional() })).optional(),
  /** Level C: layered SVG. */
  svg: z.string().optional(),
  /** Level D: one flat PNG. */
  image: z.string().optional(),
  /** Save the prepared package in the character library under this name for later films. */
  saveAs: z.string().optional(),
  /** Manual anchor corrections: poseId → partial anchors (fractions of the pose image). */
  anchors: z.record(z.record(Pt)).optional(),
  /** User motion amount: «خلي الحركة بسيطة» → subtle, «مبالغ فيها» → exaggerated. */
  motion: z.enum(['subtle', 'normal', 'exaggerated']).optional(),
  /** «لا تحرك الوجه»: no expression swaps / mouth / blink. */
  lockFace: z.boolean().optional(),
  /** Talking animation level (0 none, 1 talk state, 2 audio-energy mouth). */
  talk: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  /** Which side of the frame the character prefers (otherwise the Director decides from RTL text flow). */
  side: z.enum(['left', 'right', 'center']).optional(),
  /** Cultural garments to protect (auto-detected names are added). */
  garments: z.array(z.string()).optional(),
});
export type BriefCharacter = z.infer<typeof BriefCharacterSchema>;

/** One beat of the character's story — written by the agent from the user's words. */
export const CharacterBeatSchema = z.object({
  /** On-screen line (Arabic/English). */
  line: z.string().min(1),
  /** Optional explicit intent (otherwise the Character Director reads the line). */
  action: z.string().optional(),
  emotion: z.string().optional(),
  pose: z.string().optional(),
  prop: z.enum(PROPS).optional(),
  camera: z.enum(['wide', 'medium', 'medium-close', 'close']).optional(),
  /** Scene kind hint: phone, chat, product, chart, title, cta. */
  scene: z.enum(['stage', 'phone', 'chat', 'product', 'chart', 'title', 'cta']).optional(),
  /** Chat messages for phone/chat beats (user text only). */
  messages: z.array(z.string()).optional(),
  seconds: z.number().min(1).max(20).optional(),
});
export type CharacterBeat = z.infer<typeof CharacterBeatSchema>;
