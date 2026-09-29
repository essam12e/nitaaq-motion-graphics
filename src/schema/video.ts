/**
 * video.json — the structured intermediate format between the Director and the
 * renderer. Runtime-validated with Zod (never trust TypeScript types alone for
 * external JSON). Registry-backed fields (scene type, style preset, transition
 * type, sfx id) are strings here and are checked against their registries in
 * the validation layer, so new scenes/styles never require a schema change.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = '1.0';

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
});

export const DirectionSchema = z.object({
  intensity: Unit.default(0.6),
  pace: z.enum(['slow', 'medium', 'fast']).default('medium'),
  energy: Unit.default(0.6),
  cameraActivity: Unit.default(0.5),
  textActivity: Unit.default(0.6),
  transitionDensity: Unit.default(0.6),
});

export const AssetKindSchema = z.enum(['logo', 'product', 'screenshot', 'image', 'background', 'icon', 'svg', 'audio', 'video', 'font', 'avatar']);

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

export const AudioSchema = z.object({
  mode: z.enum(['none', 'user-voice', 'tts']).default('none'),
  voice: VoiceSchema.optional(),
  music: MusicSchema.optional(),
  sfx: z
    .object({
      enabled: z.boolean().default(true),
      intensity: Unit.default(0.5),
      volume: Unit.default(0.6),
      /** Map a library sound id to a user-provided file. */
      overrides: z.record(z.string()).default({}),
    })
    .default({}),
});

export const TransitionSchema = z.object({
  type: z.string().min(1),
  duration: z.number().min(0).max(3).default(0.5),
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
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

export const SceneMotionSchema = z.object({
  intensity: Unit.optional(),
  entrance: z.string().optional(),
  camera: z.enum(['none', 'push', 'pull', 'pan-left', 'pan-right', 'rise', 'fall', 'tilt', 'drift', 'orbit']).optional(),
  speed: z.number().min(0.4).max(2.5).default(1),
});

export const SceneBackgroundSchema = z.object({
  kind: z.string().optional(),
  color: HexColor.optional(),
  image: z.string().optional(),
  accent: HexColor.optional(),
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
});

export const VideoSchema = z.object({
  version: z.string().default(SCHEMA_VERSION),
  project: ProjectSchema,
  canvas: CanvasSchema,
  platform: PlatformSchema.default('generic'),
  safeArea: SafeAreaSchema.default({}),
  brand: BrandSchema.nullable().default(null),
  style: StyleRefSchema,
  direction: DirectionSchema.default({}),
  assets: z.record(AssetSchema).default({}),
  audio: AudioSchema.default({}),
  scenes: z.array(SceneSchema).min(1),
  captions: CaptionsSchema.default({}),
  metadata: MetadataSchema.default({}),
});

export type VideoSpec = z.infer<typeof VideoSchema>;
export type VideoInput = z.input<typeof VideoSchema>;
export type SceneSpec = z.infer<typeof SceneSchema>;
export type BrandProfile = z.infer<typeof BrandSchema>;
export type AssetSpec = z.infer<typeof AssetSchema>;
export type AudioSpec = z.infer<typeof AudioSchema>;
export type TransitionSpec = z.infer<typeof TransitionSchema>;
export type SfxEvent = z.infer<typeof SfxEventSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type RepairLogEntry = z.infer<typeof RepairLogEntrySchema>;
export type Quality = z.infer<typeof QualitySchema>;
