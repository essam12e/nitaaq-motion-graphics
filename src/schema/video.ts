/**
 * video.json — the structured intermediate format between the Director and the
 * renderer. Runtime-validated with Zod (never trust TypeScript types alone for
 * external JSON). Registry-backed fields (scene type, style preset, transition
 * type, sfx id) are strings here and are checked against their registries in
 * the validation layer, so new scenes/styles never require a schema change.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = '3.0';

export const AspectSchema = z.enum(['9:16', '16:9', '1:1', '4:5']);
export const PlatformSchema = z.enum(['tiktok', 'instagram-reels', 'instagram-feed', 'youtube-shorts', 'youtube', 'generic']);
export const LanguageSchema = z.enum(['ar', 'en', 'mixed']);
export const DialectSchema = z.enum(['msa', 'saudi', 'gulf', 'egyptian', 'levantine', 'none']);
export const QualitySchema = z.enum(['preview', 'draft', 'production']);

const Unit = z.number().min(0).max(1);
const HexColor = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'expected #RRGGBB');

export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-_]{0,63}$/i, 'id must be a slug'),
  title: z.string().min(1).max(200),
  language: LanguageSchema.default('ar'),
  dialect: DialectSchema.default('msa'),
  numerals: z.enum(['latin', 'arabic-indic']).default('latin'),
});

export const CanvasSchema = z.object({
  aspect: AspectSchema,
  width: z.number().int().min(240).max(4096),
  height: z.number().int().min(240).max(4096),
  fps: z.number().int().min(12).max(60).default(30),
});

export const SafeAreaSchema = z.object({
  preset: PlatformSchema.default('generic'),
  /** Extra inner margin (fraction of canvas) added to the platform preset. */
  margin: z.number().min(0).max(0.2).default(0),
  /** Debug overlay is preview-only; the renderer forces it off for draft/production. */
  debug: z.boolean().default(false),
});

export const ContrastRulesSchema = z.object({
  minTextContrast: z.number().min(1).max(21).default(4.5),
  minLargeTextContrast: z.number().min(1).max(21).default(3),
  textOnPrimary: HexColor.optional(),
  textOnBackground: HexColor.optional(),
  textOnSurface: HexColor.optional(),
});

export const BrandSchema = z.object({
  name: z.string().max(120).optional(),
  primary: HexColor,
  secondary: HexColor,
  accent: HexColor,
  background: HexColor,
  surface: HexColor,
  textPrimary: HexColor,
  textSecondary: HexColor,
  /** Project-relative path of the user's logo (only if the user supplied one). */
  logo: z.string().optional(),
  logoOnDark: z.string().optional(),
  font: z.string().optional(),
  latinFont: z.string().optional(),
  style: z.string().optional(),
  mode: z.enum(['dark', 'light']).default('dark'),
  personality: z.array(z.string()).default([]),
  dominantColors: z.array(HexColor).default([]),
  contrastRules: ContrastRulesSchema.default({}),
  source: z.enum(['logo', 'user', 'generated']).default('generated'),
});

export const StyleRefSchema = z.object({
  preset: z.string().min(1),
  /** Partial token overrides (validated against the token shape during resolution). */
  overrides: z.record(z.unknown()).default({}),
  /** Style Library v2: the visual style (style_recipe.json) — its brand-adapted palette is applied after the brand. */
  look: z.object({ style: z.string(), recipe: z.string().optional(), palette: z.record(z.string()).optional() }).optional(),
});

export const DirectionSchema = z.object({
  intensity: Unit.default(0.6),
  pace: z.enum(['slow', 'medium', 'fast']).default('medium'),
  energy: Unit.default(0.6),
  cameraActivity: Unit.default(0.5),
  textActivity: Unit.default(0.6),
  transitionDensity: Unit.default(0.6),
});

export const AssetKindSchema = z.enum(['logo', 'product', 'screenshot', 'image', 'background', 'icon', 'svg', 'audio', 'video', 'font', 'avatar', 'lottie']);

/** Which part of a video plays and how (src/media/video.ts). All optional. */
export const VideoClipSchema = z.object({
  startFrom: z.number().min(0).optional(),
  endAt: z.number().positive().optional(),
  loop: z.boolean().optional(),
  playbackRate: z.number().min(0.25).max(4).optional(),
  delay: z.number().min(0).optional(),
  muted: z.boolean().optional(),
  volume: Unit.optional(),
  /** Lottie only: play one named marker of the animation instead of startFrom / endAt. */
  marker: z.string().max(80).optional(),
});

/** What a Lottie file is and uses (measured at ingest by inspectLottie; src/media/lottie.ts). */
export const LottieMetaSchema = z.object({
  ip: z.number(),
  op: z.number(),
  markers: z.array(z.object({ name: z.string(), start: z.number(), duration: z.number() })).default([]),
  layers: z.number().int().min(0),
  complexity: z.number().min(0),
  colors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

/** What an SVG is made of (measured at ingest by src/node/vector-assets.ts; Vector Engine 2.0). */
export const VectorMetaSchema = z.object({
  shapes: z.number().int().min(0),
  groups: z.number().int().min(0),
  segments: z.number().int().min(0),
  clips: z.number().int().min(0).default(0),
  masks: z.number().int().min(0).default(0),
  gradients: z.number().int().min(0).default(0),
  /** Text / embedded images (drawn as they are, faded in rather than traced). */
  raw: z.number().int().min(0).default(0),
  complexity: z.number().min(0),
  colors: z.array(z.string()).default([]),
  /** Parsed, sanitised VectorDoc (JSON) the render reads instead of parsing the SVG again. */
  doc: z.string().optional(),
  warnings: z.array(z.string()).default([]),
});

export const AssetSchema = z.object({
  kind: AssetKindSchema,
  src: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  hash: z.string().optional(),
  /** User assets are never replaced, re-generated, recoloured or distorted. */
  userSupplied: z.boolean().default(true),
  preserve: z.boolean().default(true),
  alt: z.string().optional(),
  /** True when the image has meaningful transparency (cutout). */
  hasAlpha: z.boolean().optional(),
  duration: z.number().optional(),
  // ── video assets (Video Asset Pipeline; all optional, images never carry them)
  /** Source frame rate (constant after normalisation). */
  fps: z.number().positive().optional(),
  hasAudio: z.boolean().optional(),
  codec: z.string().optional(),
  /** The user's original file (byte-identical copy) when `src` is a normalised render copy. */
  original: z.string().optional(),
  /** Light proxy used by preview / animatic renders; production always uses `src`. */
  proxy: z.string().optional(),
  /** Default clip (trim / loop / rate) — the chosen segment of the source. */
  clip: VideoClipSchema.optional(),
  /** Why this segment was chosen (segment selection), not rendered. */
  segmentReason: z.string().optional(),
  // ── Lottie assets (any kind — a logo or an icon can be a Lottie animation); `fps` / `duration` / `clip` apply too
  lottie: LottieMetaSchema.optional(),
  // ── SVG assets measured by the Vector Engine (any kind; the file itself is unchanged and still usable as an image)
  vector: VectorMetaSchema.optional(),
});

export const VoiceSegmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().optional(),
});

export const DuckingSchema = z.object({
  enabled: z.boolean().default(true),
  /** Music level while voice is active, relative to music volume. */
  level: Unit.default(0.3),
  attack: z.number().min(0.02).max(2).default(0.25),
  release: z.number().min(0.02).max(3).default(0.6),
});

export const MusicSchema = z.object({
  src: z.string().min(1),
  volume: Unit.default(0.5),
  fadeIn: z.number().min(0).max(10).default(1),
  fadeOut: z.number().min(0).max(10).default(1.5),
  loop: z.boolean().default(true),
  trimStart: z.number().min(0).default(0),
  trimEnd: z.number().min(0).optional(),
  duration: z.number().positive().optional(),
  ducking: DuckingSchema.default({}),
  license: z.string().optional(),
});

export const VoiceSchema = z.object({
  src: z.string().min(1),
  /** Seconds into the video where the voice starts. */
  offset: z.number().min(0).default(0),
  volume: z.number().min(0).max(2).default(1),
  duration: z.number().positive().optional(),
  segments: z.array(VoiceSegmentSchema).default([]),
  provider: z.enum(['user', 'tts']).default('user'),
  processed: z.boolean().default(false),
});

/** One planned sound (Sound Director output): exact file, time, gain and why. */
export const SfxCueSchema = z.object({
  sceneId: z.string(),
  sound: z.string(),
  family: z.string(),
  file: z.string(),
  /** Absolute seconds where the file starts (already shifted so its peak lands on the anchor). */
  atSec: z.number().min(0),
  volume: z.number().min(0).max(1.5),
  duration: z.number().positive(),
  /** Semantic event that caused it (product_land, logo_reveal, …) and the anchor used. */
  event: z.string().optional(),
  anchor: z.string().optional(),
  /** Absolute seconds of the visual moment the sound is synced to. */
  anchorSec: z.number().optional(),
  layer: z.enum(['movement', 'impact', 'detail', 'single']).default('single'),
  pan: z.number().min(-1).max(1).default(0),
});

/** Procedurally generated soundtrack (only when no user/licensed music exists). */
export const SoundtrackSchema = z.object({
  style: z.enum(['tech', 'premium', 'cinematic', 'sport', 'playful', 'corporate', 'minimal', 'futuristic']),
  bpm: z.number().positive(),
  seed: z.union([z.string(), z.number()]),
  /** Absolute seconds of the soundtrack's own strong hits (drops, accents) — the Sound Director avoids doubling them. */
  hits: z.array(z.number()).default([]),
  sections: z.array(z.object({ name: z.string(), start: z.number(), end: z.number(), energy: Unit })).default([]),
});

export const AudioAutomationSchema = z.object({
  /** Written by the Sound Director (re-planned on the final timeline at produce); `{ auto: true }` alone asks for it. */
  auto: z.boolean().optional(),
  /** Gain automation of the music: points (absolute seconds, gain multiplier 0..1.5) joined by the curve. */
  music: z.array(z.object({ t: z.number().min(0), gain: z.number().min(0).max(1.5) })).optional(),
  curve: z.enum(['smooth', 'linear', 'exponential']).default('smooth'),
  /** Shape of the ducking under the voice: smooth (S-curve), exponential (even in dB), linear, or hold (fast in, late out). */
  duckCurve: z.enum(['smooth', 'exponential', 'linear', 'hold']).default('smooth'),
  /** Music pre-entry: the music starts `lead` s before `at` and swells into it (replaces the fade-in). */
  preEntry: z.object({ at: z.number().min(0), lead: z.number().min(0.1).max(6).default(1.2), from: Unit.default(0) }).optional(),
  /** VO → music handoff: when the voice ends the music rises from the duck to `lift` over `overlap` s. */
  handoff: z.object({ at: z.number().min(0).optional(), overlap: z.number().min(0.1).max(4).default(0.8), lift: z.number().min(1).max(1.5).default(1.15) }).optional(),
  /** Ending: fade (default), ring-out (long exponential tail), button (holds then a short cut-off), swell (lifts, then fades). */
  ending: z.object({ kind: z.enum(['fade', 'ring-out', 'button', 'swell']).default('fade'), length: z.number().min(0.1).max(8).optional() }).optional(),
});

export const AudioSchema = z.object({
  mode: z.enum(['none', 'user-voice', 'tts']).default('none'),
  voice: VoiceSchema.optional(),
  music: MusicSchema.optional(),
  soundtrack: SoundtrackSchema.optional(),
  sfx: z
    .object({
      enabled: z.boolean().default(true),
      intensity: Unit.default(0.5),
      volume: Unit.default(0.6),
      /** Map a library sound id to a user-provided file. */
      overrides: z.record(z.string()).default({}),
      /** Sound personality (luxury, tech, sport, playful, cinematic, corporate…) — from brand motion / film personality. */
      personality: z.string().optional(),
      /** Planned cues from the Sound Director. When present the engine plays exactly these. */
      cues: z.array(SfxCueSchema).optional(),
    })
    .default({}),
  /** Master bus (Audio Engine 2.0): delivery loudness and true-peak ceiling (applied after render). */
  master: z.object({ targetLufs: z.number().min(-30).max(-8).default(-14), truePeak: z.number().min(-6).max(0).default(-1) }).optional(),
  /** Music sidechain: the music dips under hero impacts (dB, 0 = off). */
  sidechainDb: z.number().min(0).max(12).optional(),
  /** Audio automation (Sound Director, all optional — without it the music envelope is exactly the old one). */
  automation: AudioAutomationSchema.optional(),
  /** A second music cue the first one crossfades into (equal-power) at `at`. */
  musicNext: z
    .object({ src: z.string().min(1), at: z.number().min(0), crossfade: z.number().min(0.1).max(8).default(1.5), volume: Unit.optional(), trimStart: z.number().min(0).default(0), loop: z.boolean().default(true) })
    .optional(),
});

export const TransitionSchema = z.object({
  type: z.string().min(1),
  duration: z.number().min(0).max(3).default(0.5),
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
  /** Why the Transition Engine chose it (continuity, contrast, beat, …). Not rendered. */
  reason: z.string().optional(),
  /** Continuity hints (Transition Intelligence 2.0): subject focus, matched rect, shape, shared colour. */
  focus: z.object({ x: z.number(), y: z.number() }).optional(),
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  shape: z.string().optional(),
  color: HexColor.optional(),
  /** Scale match: the matched element's rect in the incoming scene (fractions). */
  toRect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  /** Motion Continuity: the outgoing scene's exit vector (direction unit vector, speed 0..1, depth motion −1..1). */
  vector: z.object({ dx: z.number(), dy: z.number(), speed: z.number(), depth: z.number().optional(), scale: z.number().optional(), energy: z.number().optional() }).optional(),
});

export const SfxEventSchema = z.object({
  sound: z.string().min(1),
  at: z.number().min(0).default(0),
  volume: Unit.default(0.8),
});

export const SceneLayoutSchema = z.object({
  align: z.enum(['start', 'center', 'end']).optional(),
  scale: z.number().min(0.4).max(1.6).default(1),
  offsetX: z.number().min(-0.5).max(0.5).default(0),
  offsetY: z.number().min(-0.5).max(0.5).default(0),
  /** Fraction of safe width text may use. */
  maxWidth: z.number().min(0.3).max(1).optional(),
  textScale: z.number().min(0.5).max(1.5).default(1),
  /** Adds a contrast scrim behind text. */
  scrim: z.boolean().default(false),
  textColor: HexColor.optional(),
  /** Max lines for the main text before the layout engine downsizes. */
  maxLines: z.number().int().min(1).max(8).optional(),
});

const FracRectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0) });

export const CameraPlanSchema = z.object({
  /** A move name (moves.ts); 'static' with a `preset` takes the preset's move. */
  move: z.string().default('static'),
  amplitude: z.number().min(0).max(1.5).default(1),
  start: z.number().min(0).max(1).optional(),
  end: z.number().min(0).max(1).optional(),
  focus: z.object({ x: z.number(), y: z.number() }).optional(),
  ease: z.string().optional(),
  accents: z.array(z.number()).optional(),
  waypoints: z.array(z.object({ t: z.number(), focus: z.object({ x: z.number(), y: z.number() }), close: z.number().optional() })).optional(),
  dof: z.boolean().optional(),
  reason: z.string().optional(),
  /** Camera solver (all optional): a named preset, auto framing of an element / group, timed look-at targets, bounds, pass-through, motion blur. */
  preset: z.string().optional(),
  target: z.object({ rect: z.union([FracRectSchema, z.array(FracRectSchema).min(1)]), depth: z.number().optional(), fill: z.number().min(0.05).max(1).optional() }).optional(),
  targets: z.array(z.object({ t: z.number().min(0), rect: z.union([FracRectSchema, z.array(FracRectSchema).min(1)]), depth: z.number().optional(), fill: z.number().min(0.05).max(1).optional() })).optional(),
  lag: z.number().min(0.1).max(4).optional(),
  bounds: z.object({ world: FracRectSchema.optional(), depth: z.number().optional(), minDolly: z.number().optional(), maxDolly: z.number().optional(), maxZoom: z.number().optional() }).optional(),
  passThrough: z.boolean().optional(),
  motionBlur: z.boolean().optional(),
});

/**
 * Element lifecycle (P0, principled motion model only): anticipation → entrance → settle →
 * sustain (living hold) → exit / energy handoff. Ignored by the legacy motion model, so old
 * video.json files render exactly as before.
 */
export const ExitStyleSchema = z.enum(['auto', 'none', 'handoff', 'lift', 'fade', 'scale-down']);
export const LifecycleSchema = z.object({
  /** How settled elements live during the hold. auto = by element kind (text stays still for reading). */
  sustain: z.enum(['auto', 'still', 'drift', 'breathe', 'parallax']).optional(),
  /** A deliberate hold (logo hero, a number that must be read). Motion metrics treat it as intentional up to maxSec. */
  hold: z.object({ intentional: z.boolean(), reason: z.string().max(240).optional(), maxSec: z.number().min(0.3).max(10).optional() }).optional(),
  /** How elements leave the shot. P1 (Stage) will hand the energy to `handoffTarget`; P0 only moves along the vector. */
  exit: z
    .object({
      style: ExitStyleSchema.default('auto'),
      direction: z.enum(['left', 'right', 'up', 'down', 'in', 'out']).optional(),
      /** 0..1 how fast the elements leave (travel and acceleration). */
      velocity: Unit.optional(),
      /** Unit vector the energy leaves along (overrides direction). */
      handoffVector: z.object({ dx: z.number().min(-1).max(1), dy: z.number().min(-1).max(1), depth: z.number().min(-1).max(1).optional() }).optional(),
      /** Element id in the next shot that receives the energy (P1 Stage; recorded, not drawn in P0). */
      handoffTarget: z.string().max(80).optional(),
      /** Seconds of the exit before the cut / transition starts. */
      lead: z.number().min(0.1).max(1.5).optional(),
    })
    .optional(),
  /** Word-timed emphasis (scene-local seconds): the highlight draws and pulses when the word is spoken. */
  emphasis: z
    .array(
      z.object({
        word: z.string().min(1).max(60),
        at: z.number().min(0),
        end: z.number().min(0).optional(),
        /** voice = measured word timing (Whisper), estimated = distributed over a phrase, script = authored time. */
        source: z.enum(['voice', 'estimated', 'script']).default('script'),
        accent: z.enum(['highlight', 'pulse', 'camera']).default('pulse'),
      }),
    )
    .optional(),
});

export const SceneMotionSchema = z.object({
  intensity: Unit.optional(),
  entrance: z.string().optional(),
  camera: z.enum(['none', 'push', 'pull', 'pan-left', 'pan-right', 'rise', 'fall', 'tilt', 'drift', 'orbit']).optional(),
  speed: z.number().min(0.4).max(2.5).default(1),
  /** What the motion in this scene is for (direct attention, reveal, connect states, …). */
  jobs: z.array(z.string()).optional(),
  /** Text Motion Engine families per text role group (headline, support, cta, number, label). */
  text: z.record(z.string()).optional(),
  /** Camera Engine 2.0 plan (preferred over the legacy `camera` name when present). */
  cameraPlan: CameraPlanSchema.optional(),
  /** Motion Intent System: the scene's elements, why they move and how (written by the Director). */
  intents: z.array(z.object({ role: z.string(), intent: z.string(), entrance: z.string().optional(), sound: z.string().optional(), importance: z.number().optional() })).optional(),
  /** Beat accents (scene-local seconds) the scene's motion may punctuate (music-led films only; secondary rhythm under a voice in Full Director Mode). */
  accents: z.array(z.number()).optional(),
  /** Element lifecycle (principled motion model). */
  lifecycle: LifecycleSchema.optional(),
});

export const SceneBackgroundSchema = z.object({
  kind: z.string().optional(),
  color: HexColor.optional(),
  image: z.string().optional(),
  accent: HexColor.optional(),
});

export const MicroFxSchema = z.object({
  kind: z.enum(['burst', 'ripple', 'ring', 'sparks', 'trails', 'impact-lines', 'energy-pulse', 'glow-pulse', 'directional-streaks']),
  at: z.number().min(0),
  x: z.number(),
  y: z.number(),
  size: z.number().min(0.01).max(1).optional(),
  color: z.string().optional(),
  intensity: z.number().min(0).max(1).optional(),
  direction: z.number().optional(),
  duration: z.number().min(0.1).max(4).optional(),
  seed: z.union([z.string(), z.number()]).optional(),
  importance: z.number().min(0).max(1).optional(),
  auto: z.boolean().optional(),
  reason: z.string().optional(),
});

export const SceneSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  variant: z.string().optional(),
  /** Seconds. */
  duration: z.number().min(0.4).max(120),
  content: z.record(z.unknown()).default({}),
  layout: SceneLayoutSchema.default({}),
  motion: SceneMotionSchema.default({}),
  transition: TransitionSchema.optional(),
  sfx: z.union([z.literal('auto'), z.literal('none'), z.array(SfxEventSchema)]).default('auto'),
  background: SceneBackgroundSchema.optional(),
  voice: z.object({ segment: z.number().int().min(0).optional(), start: z.number().optional(), end: z.number().optional() }).optional(),
  /** Director notes (purpose, beat). Not rendered. */
  purpose: z.string().optional(),
  beat: z.string().optional(),
  /** Micro FX accents (scene-local seconds, positions as canvas fractions). Optional; the auto planner adds `auto` ones. */
  fx: z.array(MicroFxSchema).optional(),
  /** Full Director Mode: the Shot Script shot this scene was compiled from (intent and reasons; not rendered). */
  shot: z
    .object({
      id: z.string(),
      purpose: z.string().optional(),
      message: z.string().optional(),
      shotSize: z.string().optional(),
      subject: z.string().optional(),
      cameraTarget: z.string().optional(),
      cameraReason: z.string().optional(),
      transitionReason: z.string().optional(),
      expectedEnergy: z.number().min(0).max(1).optional(),
      voiceAnchor: z.object({ text: z.string().optional(), start: z.number(), end: z.number(), source: z.string() }).optional(),
    })
    .passthrough()
    .optional(),
});

export const CaptionsSchema = z.object({
  enabled: z.boolean().default(false),
  position: z.enum(['bottom', 'top', 'center']).default('bottom'),
  cues: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).default([]),
});

export const RepairLogEntrySchema = z.object({
  path: z.string(),
  issue: z.string(),
  fix: z.string(),
  stage: z.enum(['validation', 'quality']).default('validation'),
  pass: z.number().int().optional(),
});

export const MetadataSchema = z.object({
  generator: z.enum(['director', 'manual', 'studio']).default('manual'),
  seed: z.union([z.number(), z.string()]).optional(),
  createdAt: z.string().optional(),
  briefHash: z.string().optional(),
  repairLog: z.array(RepairLogEntrySchema).default([]),
  notes: z.string().optional(),
  /** Director mode: fast (brief → recipes, the original path) or full (Claude's Shot Script → compiler). */
  director: z.object({ mode: z.enum(['fast', 'full']), shotScript: z.string().optional(), voiceMap: z.string().optional() }).optional(),
});

/** Design policy: what the film is allowed to use beyond the clean defaults. */
export const DesignSchema = z.object({
  /** Pattern backgrounds the user explicitly asked for (or a reference needs). Empty = none, ever. */
  allowPatterns: z.array(z.enum(['dots', 'grid', 'halftone', 'bokeh', 'stripes', 'lines', 'particles'])).default([]),
  /** Small scattered decorations (rings, plus marks, bursts). Off by default. */
  decorations: z.boolean().default(false),
  /** Why a normally-banned look is used (shown in QC instead of an error). */
  justification: z.string().max(300).optional(),
  /** Render-cost budget set by the Director from the task class (LOW/MEDIUM/HIGH). */
  effectBudget: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  /** Micro FX: 'auto' adds small accents on the film's motion moments (by intent and personality); 'off' (default) only draws scenes' own `fx`. */
  microFx: z.enum(['off', 'auto']).default('off'),
  /** Micro FX budget (density and concurrent cost). Default: the effect budget, else MEDIUM. */
  fxBudget: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
});

export const MotionPersonalitySchema = z.enum(['premium', 'energetic', 'playful', 'corporate', 'cinematic', 'tech', 'sport']);

/** Film-level motion contract: one personality, seeded procedural variation. */
export const FilmMotionSchema = z.object({
  personality: MotionPersonalitySchema.optional(),
  /** Seed for any procedural variation (geometry placement, stagger jitter). */
  seed: z.union([z.string(), z.number()]).optional(),
  /** The director's hero scene id: the soundtrack drop and the biggest hit land here. */
  heroScene: z.string().optional(),
  /**
   * Motion model of the shared components: legacy (entrance → hold, the default and every old film) or
   * principled (Principles Engine lifecycle: anticipation → entrance → settle → sustain → exit). Full Director
   * Mode compiles principled films; Fast Mode keeps legacy. stage (P1): a Full Director film whose picture is
   * drawn by the Stage (`spec.stage`, stage.json): global elements + one global camera across shots; the
   * shared components keep the principled lifecycle.
   */
  model: z.enum(['legacy', 'principled', 'stage']).optional(),
});

const RectFraction = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
export const SharedElementSchema = z.object({
  id: z.string(),
  /** Asset id (logo, product, screenshot …) that is the same object in both scenes. */
  asset: z.string(),
  kind: z.enum(['logo', 'product', 'phone', 'browser', 'card', 'text', 'shape', 'icon', 'chart', 'screenshot']).default('product'),
  fromScene: z.string(),
  toScene: z.string(),
  /** Measured rects (fractions of the canvas) at the start / end of the transition window. Filled by the probe pass. */
  fromRect: RectFraction.optional(),
  toRect: RectFraction.optional(),
});

export const TimelineOptionsSchema = z.object({
  /** Ending returns to the opening frame state (social/logo/ambient loops). */
  seamlessLoop: z.boolean().default(false),
  /** Long-form: chapter boundaries (scene ids that start a chapter). */
  chapters: z.array(z.object({ id: z.string(), title: z.string().optional(), startScene: z.string() })).default([]),
  /** Beat grid used by the Director (filled from beats.json when music exists). */
  beatSync: z.object({ bpm: z.number().positive(), offset: z.number(), aligned: z.number().int().min(0) }).optional(),
  /** Shared-element continuity across cuts: the same asset glides from its place in one scene to its place in the next. */
  shared: z.array(SharedElementSchema).default([]),
});

/** Design language inferred from a user reference (summary of reference_style.json). */
export const ReferenceSummarySchema = z.object({
  source: z.string(),
  kind: z.enum(['image', 'video', 'website']),
  motionEnergy: Unit.optional(),
  cameraActivity: Unit.optional(),
  visualDensity: z.enum(['sparse', 'balanced', 'dense']).optional(),
  appliedTo: z.array(z.string()).default([]),
});

/** Summary of the persistent brand-motion.json the film was directed with. */
export const BrandMotionRefSchema = z.object({
  key: z.string(),
  personality: z.string(),
  soundPersonality: z.string().optional(),
  logoReveal: z.string().optional(),
  ctaStyle: z.string().optional(),
});

const PtSchema = z.object({ x: z.number(), y: z.number() });
/**
 * The film's character (Character Motion Engine). Poses are project assets (transparent PNG crops of the
 * user's art, never redrawn); a layered SVG character also carries its rig (rendered live as vector).
 */
export const CharacterSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  complexity: z.enum(['STATIC', 'POSE_BASED', 'PARTIAL_RIG', 'FULL_VECTOR_RIG']),
  /** rig = live vector rig; poses = pose-to-pose switching of prepared PNG poses. */
  mode: z.enum(['rig', 'poses']),
  poses: z.record(
    z.object({
      asset: z.string(),
      width: z.number().positive(),
      height: z.number().positive(),
      state: z.string(),
      bodyDirection: z.enum(['left', 'right', 'front']).default('front'),
      framing: z.enum(['full-body', 'half-body', 'bust', 'head']).default('full-body'),
      prop: z.string().default('none'),
      /** Anchors as fractions of the pose image (headTop, headCenter, neck, handL, handR, torsoCenter, hips, feet). */
      anchors: z.record(PtSchema),
      headHeight: z.number().positive(),
    }),
  ),
  /** Rig (nitaaq.rig/1) when mode = rig. */
  rig: z.unknown().optional(),
  identity: z.object({ palette: z.array(z.string()).default([]), garments: z.array(z.string()).default([]), lock: z.array(z.string()).default([]) }).default({}),
  /** Project-relative folder of the copied character package (manifest, bible, pose library). */
  package: z.string().optional(),
});

export const VideoSchema = z.object({
  version: z.string().default(SCHEMA_VERSION),
  project: ProjectSchema,
  /** Production genre the Master Director recognised (product, launch, kinetic, data, map, whiteboard, …). */
  genre: z.string().optional(),
  /** Specialised modules this film needs (lazy-loaded; nothing else is initialised). */
  modules: z.array(z.string()).default([]),
  brandMotion: BrandMotionRefSchema.optional(),
  canvas: CanvasSchema,
  platform: PlatformSchema.default('generic'),
  safeArea: SafeAreaSchema.default({}),
  brand: BrandSchema.nullable().default(null),
  style: StyleRefSchema,
  direction: DirectionSchema.default({}),
  assets: z.record(AssetSchema).default({}),
  audio: AudioSchema.default({}),
  design: DesignSchema.default({}),
  motion: FilmMotionSchema.default({}),
  timeline: TimelineOptionsSchema.default({}),
  reference: ReferenceSummarySchema.optional(),
  character: CharacterSpecSchema.optional(),
  /** P1 Stage plan (stage.json, compiled by the Stage Compiler). When present it draws the film. */
  stage: z.object({ version: z.literal(1) }).passthrough().optional(),
  scenes: z.array(SceneSchema).min(1),
  captions: CaptionsSchema.default({}),
  metadata: MetadataSchema.default({}),
});

export type VideoSpec = z.infer<typeof VideoSchema>;
export type VideoInput = z.input<typeof VideoSchema>;
export type SceneSpec = z.infer<typeof SceneSchema>;
export type BrandProfile = z.infer<typeof BrandSchema>;
export type AssetSpec = z.infer<typeof AssetSchema>;
export type VideoClipSpec = z.infer<typeof VideoClipSchema>;
export type AudioSpec = z.infer<typeof AudioSchema>;
export type TransitionSpec = z.infer<typeof TransitionSchema>;
export type SfxEvent = z.infer<typeof SfxEventSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type RepairLogEntry = z.infer<typeof RepairLogEntrySchema>;
export type Quality = z.infer<typeof QualitySchema>;
export type SfxCue = z.infer<typeof SfxCueSchema>;
export type SharedElement = z.infer<typeof SharedElementSchema>;
export type SoundtrackSpec = z.infer<typeof SoundtrackSchema>;
export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;
export type LifecycleSpec = z.infer<typeof LifecycleSchema>;
