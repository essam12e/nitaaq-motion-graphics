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

export const GENRES = ['auto', 'social-ad', 'product', 'saas', 'launch', 'kinetic', 'logo', 'data', 'map', 'explainer', 'whiteboard', 'illustrated', 'procedural', 'web-ui', 'music'] as const;
export const GenreSchema = z.enum(GENRES);

export const MapLocationSchema = z.object({
  name: z.string().min(1),
  /** Coordinates. Optional only for places in the bundled gazetteer (data/maps); otherwise required — never guessed. */
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  label: z.string().optional(),
  value: z.string().optional(),
});

export const VARIANT_STRATEGIES = ['problem-first', 'product-first', 'benefit-first', 'offer-first', 'result-first'] as const;

export const BriefSchema = z.object({
  request: z.string().min(1),
  /** Production genre. Omitted/auto = recognised by the Master Director from the request and content. */
  genre: GenreSchema.optional(),
  /** Visual construction: real media, procedural illustration, zero-asset geometry or whiteboard drawing. */
  visualMode: z.enum(['auto', 'media', 'illustration', 'zero-asset', 'whiteboard']).optional(),
  /** Ad creative variants from the same brief (strategies change hook/order/pacing/CTA timing, never the brand). */
  variants: z.object({ strategies: z.array(z.enum(VARIANT_STRATEGIES)).min(1), aspects: z.array(AspectSchema).optional() }).optional(),
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
  quality: z.enum(['preview', 'animatic', 'draft', 'production']).default('production'),
  /** Motion personality for the whole film (otherwise picked from tone/style/reference). */
  motion: z.enum(['premium', 'energetic', 'playful', 'corporate', 'cinematic', 'tech', 'sport']).optional(),
  /** Seamless loop: the last frame flows back into the first. */
  loop: z.boolean().default(false),
  /** Extra output formats recomposed from the same film (not cropped), e.g. ["16:9","1:1"]. */
  formats: z.array(AspectSchema).optional(),
  /** Style reference: principles are extracted (palette, rhythm, density…), never copied. */
  reference: z
    .object({
      path: z.string().optional(),
      url: z.string().optional(),
      kind: z.enum(['image', 'video', 'website', 'ui']).optional(),
      note: z.string().optional(),
    })
    .optional(),
  /** Capture the website in content.ui.url as a real screenshot (no fabricated UI). */
  capture: z.boolean().default(false),
  /** Long-form: chapters, each a short film sharing one ANIMATION_GUIDE.md. */
  chapters: z.array(z.object({ title: z.string(), points: z.array(z.string()).default([]) })).optional(),
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
      sfxIntensity: z.number().min(0).max(1).optional(),
      sfxVolume: z.number().min(0).max(1).optional(),
      musicVolume: z.number().min(0).max(1).optional(),
      /** Align cuts to the music's beats (default on when music is supplied and there is no voice). */
      beatSync: z.boolean().optional(),
      /** Optional transcript lines of the user's voiceover, in order. */
      transcript: z.array(z.string()).optional(),
      /**
       * Procedural soundtrack when there is no user/licensed music: 'auto' (launch/hype/music films only),
       * 'off', or an explicit style. Never replaces supplied music; nothing is downloaded.
       */
      soundtrack: z.enum(['auto', 'off', 'tech', 'premium', 'cinematic', 'sport', 'playful', 'corporate', 'minimal', 'futuristic']).optional(),
      /** Sound personality override (otherwise from brand motion / film personality). */
      soundPersonality: z.enum(['luxury', 'tech', 'sport', 'playful', 'cinematic', 'corporate']).optional(),
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
    /** Kinetic typography script: short lines shown word-group by word-group, in order. */
    lines: z.array(z.string().min(1)).optional(),
    /** Launch/hype: a teaser line before the reveal and the reveal line itself. */
    tease: z.string().optional(),
    reveal: z.string().optional(),
    /** Launch date / availability line shown with the reveal (user text only). */
    launchDate: z.string().optional(),
    /** Word replacement: a fixed phrase with rotating words («منصة لـ» + [المتاجر، المطاعم، العيادات]). */
    rotate: z.object({ prefix: z.string().min(1), words: z.array(z.string().min(1)).min(2).max(6), suffix: z.string().optional() }).optional(),
    /** A short English line that belongs in a mixed Arabic/English title (brand slogans, product names). */
    english: z.string().optional(),
    /** Map story. Country/region names resolve through the bundled Natural Earth data; places need real coordinates. */
    map: z
      .object({
        title: z.string().optional(),
        focus: z.string().optional(),
        regions: z.array(z.string()).optional(),
        locations: z.array(MapLocationSchema).optional(),
        routes: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })).optional(),
        source: z.string().optional(),
      })
      .optional(),
    /** Illustration subject hints (growth, network, security, speed, delivery, team, idea, data, cloud, payment …). */
    illustration: z.array(z.string()).optional(),
    /** Product journey as states for a shared-element flow (search → result → product → cart → checkout → success). */
    flow: z
      .array(z.object({ kind: z.enum(['logo', 'search', 'result', 'product', 'cart', 'checkout', 'success']), label: z.string(), value: z.string().optional(), items: z.array(z.string()).optional() }))
      .optional(),
    /** Tools/apps the product connects with (names only — no third-party logos are drawn). */
    integrations: z.array(z.string()).optional(),
    /** A small table of the user's own data. */
    table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())), highlightRow: z.number().int().optional(), source: z.string().optional() }).optional(),
    /** A form the video fills in (sign-up, booking, request). */
    form: z.object({ fields: z.array(z.object({ label: z.string(), value: z.string() })), button: z.string(), done: z.string().optional() }).optional(),
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
      /** Allow the optional GSAP module for complex staggered/UI timelines (lazy-loaded). */
      gsap: z.boolean().optional(),
      /** Logo reveal the user asked for (otherwise chosen from the logo's structure). */
      logoReveal: z.string().optional(),
      /** Explicit beat order (used by Ad Creative Variants); beats the brief can't support are dropped, never faked. */
      arc: z.array(z.string()).optional(),
      /** Variant bookkeeping (set by the variants command). */
      variantOf: z.object({ strategy: z.string(), base: z.string() }).optional(),
    })
    .default({}),
});

export type Brief = z.infer<typeof BriefSchema>;
export type BriefInput = z.input<typeof BriefSchema>;
