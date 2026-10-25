/**
 * Style Library v2: what a visual style IS (not a palette).
 *
 * A MotionStyle is data + rules over NITAAQ's existing primitives. Every axis below changes something the
 * compiler or the renderer actually does: the composition strategy a shot is organised with, the material a
 * card is drawn in, the curve an entrance lands on, the camera moves allowed, the transitions an element may
 * carry, the signature move the film is built around. Colour is only one axis among sixteen.
 *
 * The section layout follows the idea of a style "grammar" (essence and what it is not, materials, colour
 * logic, type, motion, camera grammar, native moves, pitfalls, rendering) — a concept studied in
 * Lemo-Opuscar (MIT) and re-written here as NITAAQ data. No code was copied.
 * Pure (no node APIs).
 */
import { z } from 'zod';

export const STYLE_CATEGORIES = ['tech', 'brand', 'commerce', 'editorial', 'playful', 'luxury', 'energy', 'cinematic', 'graphic'] as const;

/** Composition strategies the Stage composer performs (src/stage/composition.ts), style-native ones included. */
export const STYLE_STRATEGY_NAMES = [
  'centered', 'hero-focus', 'asymmetric-split', 'split', 'stack', 'card-cascade', 'spatial-cluster', 'focus-sequence', 'center-stage',
  'full-frame-typography', 'ui-zoom', 'timeline-flow', 'radial', 'cta-lockup',
  // style-native (Style Library v2)
  'grid-flush', 'iso-diorama', 'scatter', 'axis-center', 'diagonal',
] as const;

export const MATERIAL_KINDS = ['flat', 'soft-ui', 'glass', 'frosted', 'paper', 'clay', 'outline', 'iso', 'neon', 'metallic', 'sticker', 'blueprint', 'print', 'studio', 'gloss', 'film'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const DECOR_KINDS = ['none', 'swiss-rules', 'editorial-rules', 'blueprint-grid', 'iso-floor', 'aurora', 'liquid-blobs', 'letterbox', 'hud-brackets', 'bauhaus-field', 'spotlight-floor', 'speed-slash', 'paper-scraps', 'luxury-frame', 'soft-room', 'color-field', 'sunburst'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export const SIGNATURE_BUILDERS = [
  'card-becomes-cta', 'grid-flood', 'knife-cut', 'rule-divides', 'iso-assemble', 'shape-relay', 'blob-merge', 'line-thread',
  'scan-lock', 'sticker-slap', 'bauhaus-build', 'drafting', 'slash-wipe', 'spotlight-stage', 'foreground-pass', 'squash-stack',
  'stamp-burst', 'color-block-wipe', 'word-slam', 'frost-clear', 'hairline-frame',
] as const;
export type SignatureBuilder = (typeof SIGNATURE_BUILDERS)[number];

export const ENTER = z.enum(['rise', 'slide', 'scale', 'fade', 'draw', 'mask', 'drop', 'none']);
const Usage = z.enum(['core', 'allowed', 'rare', 'never']);
const Unit = z.number().min(0).max(1);
const Line = z.string().min(3);

export const MotionStyleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(2),
    nameAr: z.string().min(2),
    category: z.enum(STYLE_CATEGORIES),
    summary: Line,
    summaryAr: Line,
    /** What it is NOT: the line between this style and the ones it is easily confused with. */
    notThis: z.array(z.object({ style: z.string(), line: Line })).min(1),
    /** Where it fits (selection signals, matched against the brief). */
    fits: z.object({
      industries: z.array(z.string()).default([]),
      tones: z.array(z.string()).default([]),
      products: z.array(z.string()).default([]),
      jobs: z.array(z.string()).default([]),
      avoidFor: z.array(z.string()).default([]),
      /** 0..1: how much information the style carries well (a dense SaaS demo vs a single perfume bottle). */
      infoCapacity: Unit,
      /** Best duration range (s). */
      duration: z.tuple([z.number(), z.number()]),
      aspects: z.array(z.enum(['9:16', '16:9', '1:1', '4:5'])).default(['9:16', '16:9', '1:1', '4:5']),
    }),
    /** Scalar character (compatibility / similarity / selection). */
    character: z.object({ energy: Unit, precision: Unit, warmth: Unit, density: Unit, luxury: Unit, playfulness: Unit }),
    visualLanguage: z.object({
      geometry: z.enum(['geometric', 'organic', 'mixed']),
      density: z.enum(['clean', 'balanced', 'dense']),
      depth: z.enum(['flat', 'layered', '2.5d', 'deep']),
      edges: z.enum(['sharp', 'soft', 'round']),
      expression: z.enum(['minimal', 'balanced', 'expressive']),
      structure: z.enum(['structured', 'freeform']),
      symmetry: z.enum(['symmetric', 'asymmetric']),
      compositionMotion: z.enum(['static', 'evolving']),
    }),
    compositionGrammar: z.object({
      grid: z.enum(['none', 'loose', 'columns', 'strict', 'isometric', 'axis']),
      alignment: z.enum(['center', 'start', 'axis', 'free']),
      overlap: z.enum(['none', 'controlled', 'layered']),
      negativeSpace: Unit,
      /** Multiplier on the hero's share of the frame (0.7 = smaller, isolated; 1.3 = dominant). */
      heroScale: z.number().min(0.5).max(1.6),
      /** 1 = even sizes, 4 = a giant element next to tiny notes. */
      scaleContrast: z.number().min(1).max(4),
      /** Strategy per shot purpose (+ default). */
      strategies: z.record(z.enum(STYLE_STRATEGY_NAMES)),
      /** −1 wider … +1 tighter shot sizes. */
      shotSizeBias: z.number().min(-1).max(1),
      /** Explicit placements snap to a grid (Swiss, blueprint, Bauhaus). */
      snapToGrid: z.boolean().default(false),
      rules: z.array(Line).min(1),
    }),
    shapeLanguage: z.object({
      primary: z.string(),
      secondary: z.array(z.string()).default([]),
      corner: z.enum(['sharp', 'soft', 'round', 'pill']),
      /** Card radius in canvas units (u). */
      radius: z.number().min(0).max(12),
      stroke: z.enum(['none', 'hairline', 'medium', 'bold']),
      forms: z.object({ circles: Usage, rectangles: Usage, pills: Usage, blobs: Usage, lines: Usage, strokes: Usage, geometric: Usage, organic: Usage, cutouts: Usage, frames: Usage, masks: Usage }),
      behavior: z.object({ appear: Line, group: Line, split: Line, transform: Line, interact: Line }),
    }),
    materialLanguage: z.object({
      kind: z.enum(MATERIAL_KINDS),
      lighting: z.enum(['none', 'soft', 'key', 'rim', 'studio', 'emissive']),
      /** Surface opacity (glass < 1). */
      opacity: Unit,
      edge: z.enum(['crisp', 'soft', 'ink', 'glow', 'cut', 'keyline']),
      shadow: z.enum(['none', 'soft', 'long-soft', 'hard-offset', 'floor', 'glow', 'contact']),
      highlight: z.enum(['none', 'top-edge', 'specular', 'rim', 'sheen']),
      texture: z.enum(['none', 'grain', 'paper', 'print', 'scan']),
      /** 0..1 extrusion / thickness of solids (iso, clay). */
      thickness: Unit,
      rules: z.array(Line).min(1),
    }),
    typographyLanguage: z.object({
      display: z.string(),
      body: z.string(),
      displayWeight: z.number().min(100).max(900),
      bodyWeight: z.number().min(100).max(900),
      /** Multiplier on the headline size (scale contrast of type). */
      sizeContrast: z.number().min(0.6).max(1.8),
      lineHeight: z.number().min(1).max(1.8),
      align: z.enum(['start', 'center']),
      /** Arabic-safe reveal units only (never letters). */
      reveal: z.enum(['word', 'line', 'block', 'mask']),
      emphasis: z.enum(['color', 'marker', 'underline', 'box', 'outline', 'glow']),
      numbers: z.enum(['display', 'tabular', 'outlined', 'stamped']),
      kinetic: z.enum(['none', 'calm', 'slam', 'flow']),
      rules: z.array(Line).min(1),
    }),
    colorBehavior: z.object({
      ground: z.enum(['dark', 'light', 'paper', 'brand', 'deep-brand', 'black', 'blueprint']),
      hues: z.enum(['mono', 'duo', 'tri', 'multi']),
      accentRule: z.enum(['single-signal', 'reserved-hero', 'per-chapter', 'free', 'metallic']),
      gradients: z.enum(['none', 'subtle', 'aurora', 'light-only']),
      contrast: z.enum(['soft', 'high', 'extreme']),
      rules: z.array(Line).min(1),
    }),
    depthLanguage: z.object({ planes: z.number().int().min(1).max(4), parallax: Unit, separation: Unit, blurFar: z.boolean(), foreground: z.boolean() }),
    motionLanguage: z.object({
      personality: z.enum(['premium', 'energetic', 'playful', 'corporate', 'cinematic', 'tech', 'sport']),
      /** The family of curves everything lands on. */
      curve: z.enum(['precise', 'spring', 'elastic', 'glide', 'linear', 'stepped']),
      tempo: z.number().min(0.5).max(2),
      bounce: z.number().min(0).max(0.7),
      amplitude: z.number().min(0.4).max(2),
      tilt: z.number().min(0).max(12),
      enter: z.record(ENTER),
      fade: z.enum(['none', 'soft', 'long']),
      exit: z.enum(['handoff', 'lift', 'fade', 'scale-down', 'fall', 'none']),
      sustain: z.enum(['still', 'drift', 'breathe', 'float']),
      /** Animate on twos (12 fps poses; the camera stays smooth). */
      stepped: z.boolean(),
      /** Entrances start blurred (frosted) and clear. */
      enterBlur: z.number().min(0).max(20).default(0),
      stagger: z.number().min(0).max(0.6),
      accel: z.enum(['even', 'accelerate', 'decelerate']),
      rules: z.array(Line).min(1),
    }),
    transitionLanguage: z.object({
      /** In order of preference (Stage object transitions + cut / hard-cut). */
      prefer: z.array(z.string()).min(1),
      forbid: z.array(z.string()).default([]),
      /** What carries a transition in this style. */
      carriers: z.array(z.string()).min(1),
      rules: z.array(Line).min(1),
    }),
    cameraGrammar: z.object({
      need: z.enum(['none', 'rare', 'some', 'often']),
      /** Move families allowed (static, push, pull, follow, truck, orbit, crane, rack). */
      allowed: z.array(z.string()).min(1),
      amplitude: z.number().min(0).max(1.5),
      maxMovingShare: Unit,
      ease: z.string(),
      /** The vocabulary (move → what it expresses → what it can serve). */
      moves: z.array(z.object({ move: z.string(), expresses: Line, serves: Line })).min(1),
      rules: z.array(Line).min(1),
    }),
    rhythmLanguage: z.object({ pace: z.enum(['slow', 'medium', 'fast']), cutOn: z.enum(['phrase', 'beat', 'bar']), pattern: z.enum(['even', 'short-short-long', 'accelerating', 'breath']), holdBias: z.number().min(0.6).max(1.6) }),
    signatureMoves: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]+$/),
          name: z.string(),
          nameAr: z.string(),
          /** The idea as a chain ("shape → object → scene"). */
          idea: Line,
          builder: z.enum(SIGNATURE_BUILDERS),
          /** Shot purposes it serves best. */
          when: z.array(z.string()).min(1),
          fitsContent: z.array(z.string()).min(2),
          /** True when the moment cannot be separated from the style (a Native Style Moment). */
          native: z.boolean(),
        }),
      )
      .min(2)
      .max(5),
    soundLanguage: z
      .object({ density: z.enum(['sparse', 'normal', 'dense']), materials: z.array(z.string()).min(1), silence: z.boolean(), soundtrack: z.string(), rules: z.array(Line).default([]) })
      .optional(),
    renderingTechnique: z.object({
      renderer: z.enum(['dom', 'svg', 'dom+svg', 'canvas', 'webgl']),
      techniques: z.array(z.string()).min(1),
      cost: z.enum(['low', 'medium', 'high']),
      /** A look this style would need a renderer NITAAQ does not ship (never installed automatically). */
      optional: z.object({ status: z.literal('REQUIRES_OPTIONAL_RENDERER'), needs: z.string(), why: Line }).optional(),
    }),
    decor: z.object({ kind: z.enum(DECOR_KINDS), intensity: Unit, needsPatternAllowance: z.boolean().default(false) }),
    constraints: z.object({ avoid: z.array(z.string()).default([]), pitfalls: z.array(Line).min(1), maxGlow: Unit }),
    /** Mapping to the legacy token presets (fonts / surfaces / backgrounds the scene families read). */
    tokens: z.object({ preset: z.string(), background: z.string(), surface: z.string() }),
  })
  .strict();
export type MotionStyle = z.infer<typeof MotionStyleSchema>;

/** The axes a recipe can take from different styles. */
export const RECIPE_AXES = ['composition', 'shape', 'material', 'typography', 'color', 'depth', 'motion', 'transitions', 'camera', 'rhythm', 'sound', 'decor'] as const;
export type RecipeAxis = (typeof RECIPE_AXES)[number];

export const StyleRecipeSchema = z
  .object({
    version: z.literal(1),
    id: z.string(),
    baseStyle: z.string(),
    /** Which style each axis comes from (the base unless mixed). */
    axes: z.record(z.enum(RECIPE_AXES), z.string()),
    /** Readable labels (composition "swiss-grid", material "subtle-glass" …). */
    labels: z.record(z.string()),
    signatureMove: z.string(),
    secondaryMoves: z.array(z.string()).default([]),
    compatibility: z.object({ verdict: z.enum(['compatible', 'partially-compatible', 'conflicting']), notes: z.array(z.string()) }),
    selection: z.object({ source: z.enum(['explicit', 'mix', 'auto', 'legacy-preset', 'fallback']), whyThisStyle: z.array(z.string()), ranked: z.array(z.object({ id: z.string(), score: z.number(), reasons: z.array(z.string()) })) }),
    brandAdaptation: z.object({ source: z.string(), roles: z.record(z.string()), notes: z.array(z.string()) }),
    productPreservation: z.object({ protected: z.array(z.string()), rules: z.array(z.string()) }),
    optionalRenderer: z.string().optional(),
    hash: z.string(),
  })
  .strict();
export type StyleRecipe = z.infer<typeof StyleRecipeSchema>;

/** Request for a style (brief.style / brief.styleMix / CLI). */
export const StyleRequestSchema = z
  .object({
    base: z.string().optional(),
    mix: z.record(z.enum(RECIPE_AXES), z.string()).optional(),
    signatureMove: z.string().optional(),
  })
  .strict();
export type StyleRequest = z.infer<typeof StyleRequestSchema>;
