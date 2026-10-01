/**
 * Motion personality: ONE coherent way of moving for the whole film. The
 * Director picks it (from brand, tone, style, reference); every scene reads it
 * through the motion context so the film never mixes, say, premium restraint
 * with playful bounce.
 */
import type { EntranceFamily, EasingFamily } from '../styles/tokens';
import { ELEMENT_DEFAULT, PHYSICS, type ElementKind, type PhysicsId, type PhysicsPreset } from './physics';

export type MotionPersonalityId = 'premium' | 'energetic' | 'playful' | 'corporate' | 'cinematic' | 'tech' | 'sport';

export interface MotionPersonality {
  id: MotionPersonalityId;
  label: string;
  description: string;
  /** Physics per element kind (falls back to ELEMENT_DEFAULT then `base`). */
  physics: Partial<Record<ElementKind, PhysicsId>>;
  base: PhysicsId;
  /** Entrances this personality uses (first = primary). */
  entrances: EntranceFamily[];
  /** Easing family the legacy `progress()` helpers map to. */
  easing: EasingFamily;
  /** Transition family, in order of preference. */
  transitions: string[];
  /** 0..1 camera activity and the moves it allows. */
  camera: { activity: number; moves: ('none' | 'push' | 'pull' | 'drift' | 'rise' | 'pan-left' | 'pan-right')[] };
  /** Multiplier on ambient float (0 = elements rest when settled). */
  float: number;
  /** Seconds between staggered items. */
  stagger: number;
  /** 0..1 overall amplitude. */
  intensity: number;
  /** Max overshoot allowed for any element. */
  overshootMax: number;
  /** Default SFX intensity (0..1). */
  sfx: number;
  /** Personalities this one can blend with across a film (e.g. a tech film may use a cinematic opener). */
  compatible: MotionPersonalityId[];
}

export const PERSONALITIES: Record<MotionPersonalityId, MotionPersonality> = {
  premium: {
    id: 'premium',
    label: 'Premium',
    description: 'Controlled, heavy, minimal overshoot, deliberate movement.',
    physics: { button: 'soft', icon: 'soft', card: 'premium', 'hero-title': 'premium', logo: 'premium', product: 'premium', text: 'soft', number: 'soft' },
    base: 'premium',
    entrances: ['mask', 'blur', 'fade'],
    easing: 'cinematic',
    transitions: ['crossfade', 'light-sweep', 'blur', 'wipe'],
    camera: { activity: 0.45, moves: ['push', 'drift', 'none'] },
    float: 0.15,
    stagger: 0.12,
    intensity: 0.4,
    overshootMax: 0.01,
    sfx: 0.35,
    compatible: ['cinematic', 'corporate'],
  },
  energetic: {
    id: 'energetic',
    label: 'Energetic',
    description: 'Fast, punchy, strong impacts, controlled stagger.',
    physics: { 'hero-title': 'sport', card: 'snappy', icon: 'snappy', button: 'responsive', product: 'snappy', text: 'snappy' },
    base: 'snappy',
    entrances: ['pop', 'slide', 'rise'],
    easing: 'snappy',
    transitions: ['push', 'zoom-in', 'speed-ramp', 'slide'],
    camera: { activity: 0.55, moves: ['push', 'pan-left', 'pan-right', 'none'] },
    float: 0.35,
    stagger: 0.05,
    intensity: 0.8,
    overshootMax: 0.12,
    sfx: 0.65,
    compatible: ['sport', 'playful', 'tech'],
  },
  playful: {
    id: 'playful',
    label: 'Playful',
    description: 'Springs and bounce, more overshoot, expressive timing.',
    physics: { icon: 'playful', card: 'playful', button: 'playful', 'hero-title': 'playful', product: 'playful', logo: 'playful', text: 'snappy' },
    base: 'playful',
    entrances: ['pop', 'drop', 'scale'],
    easing: 'elastic',
    transitions: ['zoom-in', 'push', 'iris', 'color-sweep'],
    camera: { activity: 0.4, moves: ['drift', 'push', 'none'] },
    float: 0.7,
    stagger: 0.06,
    intensity: 0.75,
    overshootMax: 0.35,
    sfx: 0.6,
    compatible: ['energetic'],
  },
  corporate: {
    id: 'corporate',
    label: 'Corporate',
    description: 'Restrained, precise, clean, minimal camera movement.',
    physics: { card: 'soft', panel: 'heavy', 'hero-title': 'soft', button: 'responsive', chart: 'mechanical', text: 'soft' },
    base: 'soft',
    entrances: ['rise', 'wipe', 'fade'],
    easing: 'smooth',
    transitions: ['push', 'crossfade', 'wipe'],
    camera: { activity: 0.2, moves: ['none', 'drift'] },
    float: 0,
    stagger: 0.08,
    intensity: 0.45,
    overshootMax: 0.02,
    sfx: 0.35,
    compatible: ['tech', 'premium'],
  },
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'Depth, camera movement, reveals, atmospheric transitions.',
    physics: { 'hero-title': 'cinematic', logo: 'cinematic', product: 'heavy', card: 'heavy', text: 'soft', camera: 'cinematic' },
    base: 'cinematic',
    entrances: ['blur', 'mask', 'fade'],
    easing: 'cinematic',
    transitions: ['crossfade', 'light-sweep', 'blur', 'zoom-out'],
    camera: { activity: 0.75, moves: ['push', 'pull', 'drift', 'rise'] },
    float: 0.25,
    stagger: 0.12,
    intensity: 0.5,
    overshootMax: 0.02,
    sfx: 0.45,
    compatible: ['premium'],
  },
  tech: {
    id: 'tech',
    label: 'Tech',
    description: 'Precise, responsive, UI-aware, fast micro-interactions.',
    physics: { button: 'responsive', cursor: 'responsive', card: 'snappy', panel: 'heavy', dashboard: 'heavy', chart: 'mechanical', number: 'mechanical', 'hero-title': 'snappy', text: 'soft', icon: 'snappy' },
    base: 'snappy',
    entrances: ['wipe', 'rise', 'mask'],
    easing: 'snappy',
    transitions: ['mask-wipe', 'push', 'zoom-in', 'crossfade'],
    camera: { activity: 0.4, moves: ['push', 'none', 'drift'] },
    float: 0.15,
    stagger: 0.05,
    intensity: 0.6,
    overshootMax: 0.06,
    sfx: 0.5,
    compatible: ['corporate', 'energetic', 'cinematic'],
  },
  sport: {
    id: 'sport',
    label: 'Sport',
    description: 'Aggressive, fast, impact-based, high contrast.',
    physics: { 'hero-title': 'sport', card: 'sport', product: 'sport', icon: 'sport', button: 'responsive', text: 'snappy', number: 'sport' },
    base: 'sport',
    entrances: ['slide', 'pop', 'wipe'],
    easing: 'snappy',
    transitions: ['speed-ramp', 'push', 'wipe', 'cut'],
    camera: { activity: 0.7, moves: ['push', 'pan-left', 'pan-right'] },
    float: 0.2,
    stagger: 0.04,
    intensity: 0.9,
    overshootMax: 0.14,
    sfx: 0.7,
    compatible: ['energetic'],
  },
};

export const PERSONALITY_IDS = Object.keys(PERSONALITIES) as MotionPersonalityId[];

export function isPersonality(x: unknown): x is MotionPersonalityId {
  return typeof x === 'string' && x in PERSONALITIES;
}

/** Physics preset for an element under a personality. */
export function physicsFor(personality: MotionPersonalityId | undefined, element: ElementKind): PhysicsPreset {
  const p = PERSONALITIES[personality ?? 'tech'] ?? PERSONALITIES.tech;
  const id = p.physics[element] ?? (PHYSICS[ELEMENT_DEFAULT[element]].overshoot <= p.overshootMax ? ELEMENT_DEFAULT[element] : p.base);
  return PHYSICS[id];
}

/** Two personalities can share a film only when declared compatible. */
export function compatiblePersonalities(a: MotionPersonalityId, b: MotionPersonalityId): boolean {
  return a === b || PERSONALITIES[a].compatible.includes(b) || PERSONALITIES[b].compatible.includes(a);
}

/** Personality implied by a style preset (when the Director has no stronger signal). */
export const STYLE_PERSONALITY: Record<string, MotionPersonalityId> = {
  'saudi-modern': 'tech',
  'gulf-premium': 'premium',
  saas: 'tech',
  tech: 'tech',
  'ai-futuristic': 'cinematic',
  minimal: 'corporate',
  editorial: 'premium',
  'clean-corporate': 'corporate',
  luxury: 'premium',
  sports: 'sport',
  ecommerce: 'energetic',
  cinematic: 'cinematic',
  comic: 'playful',
  glass: 'tech',
  neon: 'energetic',
  'bold-social': 'energetic',
  'dark-premium': 'premium',
  'light-premium': 'premium',
  'product-commercial': 'premium',
  'app-launch': 'tech',
  'data-storytelling': 'corporate',
};

const TONE_PERSONALITY: [RegExp, MotionPersonalityId][] = [
  [/فخم|فاخر|راق|luxur|premium|elegant|أنيق|هادئ|calm/i, 'premium'],
  [/سينما|cinema|dramatic|درام|ملحم|epic/i, 'cinematic'],
  [/رياض|sport|athlet|gym|قوي|aggress/i, 'sport'],
  [/مرح|fun|playful|كوميد|comic|أطفال|kids|لطيف|cute/i, 'playful'],
  [/حماس|energ|سريع|fast|punchy|viral|ترند|جريء|bold/i, 'energetic'],
  [/رسمي|corporate|professional|مؤسس|بنك|bank|حكوم|gov/i, 'corporate'],
  [/تقني|tech|app|تطبيق|saas|منصة|برمج|software|ذكاء|ai\b/i, 'tech'],
];

/** Picks the film's personality: explicit > tone words > style default. */
export function pickPersonality(opts: { explicit?: string; tone?: string[]; request?: string; styleId?: string; referenceEnergy?: number }): { id: MotionPersonalityId; reason: string } {
  if (isPersonality(opts.explicit)) return { id: opts.explicit, reason: 'requested' };
  const tone = (opts.tone ?? []).join(' ');
  for (const [re, id] of TONE_PERSONALITY) if (re.test(tone)) return { id, reason: `tone (${tone})` };
  const styled = opts.styleId ? STYLE_PERSONALITY[opts.styleId] : undefined;
  if (opts.referenceEnergy !== undefined) {
    if (opts.referenceEnergy > 0.72) return { id: styled === 'sport' ? 'sport' : 'energetic', reason: `reference motion energy ${opts.referenceEnergy.toFixed(2)}` };
    if (opts.referenceEnergy < 0.3) return { id: styled === 'cinematic' ? 'cinematic' : 'premium', reason: `reference motion energy ${opts.referenceEnergy.toFixed(2)}` };
  }
  if (styled) return { id: styled, reason: `style ${opts.styleId}` };
  for (const [re, id] of TONE_PERSONALITY) if (re.test(opts.request ?? '')) return { id, reason: 'wording of the request' };
  return { id: 'tech', reason: 'default' };
}
