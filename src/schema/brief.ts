/**
 * brief.json — the Director's input. Written by the AI agent from the user's
 * natural-language request. Copy (the words on screen) lives here and is
 * authored in the user's own language/dialect. The Director never invents
 * facts, statistics or testimonials: data scenes only use `facts`, `stats`
 * and `testimonials` supplied here.
 */
import { z } from 'zod';
import { AspectSchema, DialectSchema, LanguageSchema, PlatformSchema } from './video';

export const FeatureSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
});

export const StatSchema = z.object({
  value: z.number(),
  label: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  /** Where the number comes from. Required: the system never invents statistics. */
  source: z.string().min(1),
});

export const SeriesSchema = z.object({
  title: z.string().optional(),
  labels: z.array(z.string()).min(2),
  values: z.array(z.number()).min(2),
  suffix: z.string().optional(),
  prefix: z.string().optional(),
  source: z.string().min(1),
});

export const TestimonialSchema = z.object({
  quote: z.string().min(1),
  author: z.string().min(1),
  role: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  /** Must reference a real source provided by the user. */
  source: z.string().min(1),
});

export const BriefAssetSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['logo', 'product', 'screenshot', 'image', 'background', 'icon', 'svg', 'audio', 'video', 'font', 'avatar', 'music', 'voice']),
  label: z.string().optional(),
});

export const BriefSchema = z.object({
  request: z.string().min(1),
  title: z.string().optional(),
  language: LanguageSchema.default('ar'),
  dialect: DialectSchema.default('msa'),
  objective: z.enum(['promote', 'sell', 'explain', 'announce', 'educate', 'brand', 'recruit', 'event']).default('promote'),
  industry: z.string().default('general'),
  audience: z.string().optional(),
  platform: PlatformSchema.default('tiktok'),
  aspect: AspectSchema.optional(),
  /** Target seconds. */
  duration: z.number().min(5).max(600).optional(),
  tone: z.array(z.string()).default([]),
  pace: z.enum(['slow', 'medium', 'fast']).optional(),
  style: z.string().optional(),
  quality: z.enum(['preview', 'draft', 'production']).default('production'),
  /** Brand: `null` means the user said they have no logo/identity; undefined means not asked yet. */
  brand: z
    .object({
      name: z.string().optional(),
      logo: z.string().optional(),
      colors: z.array(z.string()).optional(),
      font: z.string().optional(),
    })
    .nullable()
    .optional(),
  assets: z.array(BriefAssetSchema).default([]),
  audio: z
    .object({
      mode: z.enum(['none', 'user-voice', 'tts']).default('none'),
      voice: z.string().optional(),
      music: z.string().optional(),
      musicLicense: z.string().optional(),
      sfx: z.boolean().default(true),
      /** Optional transcript lines of the user's voiceover, in order. */
      transcript: z.array(z.string()).optional(),
    })
    .default({}),
  content: z.object({
    hook: z.string().min(1),
    subhook: z.string().optional(),
    /** Words to emphasise (must appear in the copy). The Director highlights them. */
    emphasis: z.array(z.string()).default([]),
    /** Optional short bridge line between problem and solution (e.g. «الحل؟»). */
    bridge: z.string().max(40).optional(),
    problem: z.string().optional(),
    problemPoints: z.array(z.string()).optional(),
    solution: z.string().optional(),
    features: z.array(FeatureSchema).optional(),
    steps: z.array(z.string()).optional(),
    stats: z.array(StatSchema).optional(),
    series: SeriesSchema.optional(),
    comparison: z
      .object({ leftTitle: z.string(), rightTitle: z.string(), left: z.array(z.string()), right: z.array(z.string()) })
      .optional(),
    testimonials: z.array(TestimonialSchema).optional(),
    product: z
      .object({ name: z.string(), tagline: z.string().optional(), price: z.string().optional(), oldPrice: z.string().optional(), image: z.string().optional() })
      .optional(),
    products: z.array(z.object({ name: z.string(), price: z.string().optional(), image: z.string() })).optional(),
    categories: z.array(z.object({ label: z.string(), icon: z.string().optional(), image: z.string().optional() })).optional(),
    offer: z.string().optional(),
    offerBadge: z.string().optional(),
    ui: z
      .object({
        url: z.string().optional(),
        screenshot: z.string().optional(),
        appName: z.string().optional(),
        menu: z.array(z.string()).optional(),
        headline: z.string().optional(),
        subline: z.string().optional(),
        items: z.array(z.string()).optional(),
        screens: z.array(z.object({ screenshot: z.string().optional(), headline: z.string().optional(), items: z.array(z.string()).optional(), button: z.string().optional(), caption: z.string().optional() })).optional(),
      })
      .optional(),
    messages: z.array(z.string()).optional(),
    cta: z.object({
      text: z.string().min(1),
      button: z.string().optional(),
      contact: z.string().optional(),
      contacts: z.array(z.object({ kind: z.enum(['phone', 'whatsapp', 'website', 'email', 'handle', 'location', 'store']), value: z.string() })).optional(),
      url: z.string().optional(),
      qr: z.string().optional(),
    }),
  }),
  preferences: z
    .object({
      avoid: z.array(z.string()).default([]),
      prefer: z.array(z.string()).default([]),
      seed: z.union([z.string(), z.number()]).optional(),
    })
    .default({}),
});

export type Brief = z.infer<typeof BriefSchema>;
export type BriefInput = z.input<typeof BriefSchema>;
