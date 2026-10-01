/**
 * Brand Motion Guidelines — the brand's motion language, persisted so every
 * film for the same brand moves the same way (workspace/brands/<key>/brand-motion.json).
 *
 * First film: derived from the chosen personality/style. Later films: the
 * stored guidelines win over fresh guesses (unless the user asks otherwise),
 * and the history (logo reveals, headline families, transitions) is used to
 * stay consistent without repeating the exact same film.
 * Pure: the node store lives in src/node/brand-motion-store.ts.
 */
import { hashString } from '../core/rng';
import type { MotionPersonalityId } from '../motion/personality';
import { HEADLINE_FAMILIES } from '../text-motion/planner';

export interface BrandMotion {
  version: 1;
  key: string;
  name: string | null;
  personality: MotionPersonalityId;
  /** Physics preset names the brand moves with (headline / UI / product). */
  easing: { headline: string; ui: string; product: string };
  timing: { pace: 'slow' | 'medium' | 'fast'; holdSec: number };
  textMotion: { preferred: string[]; avoid: string[] };
  transitions: { preferred: string[]; avoid: string[]; hardCutShare: number };
  soundPersonality: string;
  logo: { reveal: string | null; history: string[]; rules: string[] };
  cta: { style: 'calm' | 'punch' | 'clean' };
  /** Recent films' headline families (for variety). */
  history: { films: number; headlineFamilies: string[]; transitions: string[] };
  updatedAt: string;
}

/** Stable brand key from the brand name or the logo bytes' hash (never the user's file path). */
export function brandKey(name: string | null | undefined, logoHash?: string | null): string {
  const base = (name ?? '').trim().toLowerCase();
  const slug = base.replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-|-$/g, '');
  const h = (hashString(`${base}|${logoHash ?? ''}`) >>> 0).toString(16).padStart(8, '0').slice(0, 8);
  const ascii = slug.replace(/[^a-z0-9-]/g, '');
  return `${ascii ? ascii.slice(0, 24) + '-' : 'brand-'}${h}`;
}

const SOUND: Record<MotionPersonalityId, string> = {
  premium: 'luxury',
  cinematic: 'cinematic',
  corporate: 'corporate',
  tech: 'tech',
  energetic: 'sport',
  sport: 'sport',
  playful: 'playful',
};
const EASING: Record<MotionPersonalityId, BrandMotion['easing']> = {
  premium: { headline: 'premium', ui: 'soft', product: 'heavy' },
  cinematic: { headline: 'cinematic', ui: 'soft', product: 'heavy' },
  corporate: { headline: 'corporate', ui: 'responsive', product: 'soft' },
  tech: { headline: 'tech', ui: 'snappy', product: 'responsive' },
  energetic: { headline: 'snappy', ui: 'snappy', product: 'elastic' },
  sport: { headline: 'sport', ui: 'snappy', product: 'heavy' },
  playful: { headline: 'playful', ui: 'elastic', product: 'playful' },
};
const TRANS: Record<MotionPersonalityId, { preferred: string[]; avoid: string[]; cut: number }> = {
  premium: { preferred: ['crossfade', 'light-sweep', 'camera-push', 'blur'], avoid: ['whip', 'glitch', 'color-dip'], cut: 0.25 },
  cinematic: { preferred: ['camera-push', 'depth', 'blur', 'crossfade'], avoid: ['glitch', 'shape'], cut: 0.3 },
  corporate: { preferred: ['wipe', 'push', 'split', 'crossfade'], avoid: ['whip', 'glitch', 'speed-ramp'], cut: 0.3 },
  tech: { preferred: ['mask-wipe', 'push', 'page', 'morph'], avoid: ['shape', 'iris'], cut: 0.35 },
  energetic: { preferred: ['zoom-in', 'whip', 'color-dip', 'text-sweep'], avoid: ['crossfade'], cut: 0.4 },
  sport: { preferred: ['whip', 'speed-ramp', 'zoom-in'], avoid: ['crossfade', 'blur'], cut: 0.45 },
  playful: { preferred: ['shape', 'iris', 'push', 'zoom-out'], avoid: ['glitch'], cut: 0.3 },
};

export const LOGO_RULES = [
  'never stretch, skew, recolour, redraw or crop the logo',
  'end every reveal on the untouched logo at its true aspect ratio',
  'keep clear space of at least 25% of the logo height around it',
  'no effects on top of the logo after it has settled',
];

export function deriveBrandMotion(input: { key: string; name: string | null; personality: MotionPersonalityId; pace?: 'slow' | 'medium' | 'fast'; soundPersonality?: string; now?: string }): BrandMotion {
  const p = input.personality;
  const t = TRANS[p];
  return {
    version: 1,
    key: input.key,
    name: input.name,
    personality: p,
    easing: EASING[p],
    timing: { pace: input.pace ?? (p === 'premium' || p === 'cinematic' ? 'slow' : p === 'sport' || p === 'energetic' ? 'fast' : 'medium'), holdSec: p === 'premium' || p === 'cinematic' ? 1.1 : 0.7 },
    textMotion: { preferred: HEADLINE_FAMILIES[p].slice(0, 4), avoid: p === 'premium' || p === 'corporate' ? ['controlled-bounce', 'typography-punch'] : [] },
    transitions: { preferred: t.preferred, avoid: t.avoid, hardCutShare: t.cut },
    soundPersonality: input.soundPersonality ?? SOUND[p],
    logo: { reveal: null, history: [], rules: LOGO_RULES },
    cta: { style: p === 'energetic' || p === 'sport' || p === 'playful' ? 'punch' : p === 'tech' || p === 'corporate' ? 'clean' : 'calm' },
    history: { films: 0, headlineFamilies: [], transitions: [] },
    updatedAt: input.now ?? '',
  };
}

/** Record what this film used (bounded history). */
export function recordFilm(bm: BrandMotion, used: { logoReveal?: string; headlineFamilies?: string[]; transitions?: string[]; now?: string }): BrandMotion {
  const cap = <T,>(a: T[], n: number) => a.slice(Math.max(0, a.length - n));
  return {
    ...bm,
    logo: { ...bm.logo, reveal: used.logoReveal ?? bm.logo.reveal, history: used.logoReveal ? cap([...bm.logo.history, used.logoReveal], 8) : bm.logo.history },
    history: {
      films: bm.history.films + 1,
      headlineFamilies: cap([...bm.history.headlineFamilies, ...(used.headlineFamilies ?? [])], 24),
      transitions: cap([...bm.history.transitions, ...(used.transitions ?? [])], 24),
    },
    updatedAt: used.now ?? bm.updatedAt,
  };
}
