/**
 * P4-O / P4-H — motion language (the brand's way of moving) and Motion Phrase v2 (a shot's motion parameters).
 *
 * A motion language is a handful of numbers the compiler applies to every entrance and event (tempo,
 * spring bounce, amplitude, a playful tilt, the default entrance per element kind) — so a Premium SaaS film
 * and a Playful film built from the same script move visibly differently (motion_language.json).
 *
 * A phrase is a shot's own motion parameters (tempo, bounce, stagger and its acceleration, amplitude): a
 * "punch" shot is fast with overshoot, a "glide" shot slow and damped, a "build" shot staggers and
 * accelerates. Phrases are chosen from the shot's job and the energy the film wants there (energy.ts).
 * Pure.
 */
import type { MotionLanguage, MotionPhrase } from '../director/shot-script';

export const LANGUAGES: Record<string, MotionLanguage & { description: string }> = {
  'premium-saas': {
    id: 'premium-saas',
    description: 'calm and precise: damped springs, small travels, text revealed by a mask in the reading direction, no tilt',
    tempo: 1.1,
    bounce: 0.06,
    amplitude: 0.85,
    enter: { text: 'mask', card: 'rise', chip: 'fade', icon: 'fade' },
    tilt: 0,
  },
  playful: {
    id: 'playful',
    description: 'bouncy and quick: overshooting springs, bigger travels, small objects drop in with a tilt that settles',
    tempo: 0.85,
    bounce: 0.38,
    amplitude: 1.3,
    enter: { card: 'drop', chip: 'drop', icon: 'scale', shape: 'scale', button: 'scale' },
    tilt: 7,
  },
  editorial: {
    id: 'editorial',
    description: 'measured and typographic: text rises slowly, objects fade, almost no overshoot',
    tempo: 1.25,
    bounce: 0.02,
    amplitude: 0.7,
    enter: { text: 'rise', card: 'fade', chip: 'fade', icon: 'fade', shape: 'fade' },
    tilt: 0,
  },
  'energetic-tech': {
    id: 'energetic-tech',
    description: 'fast and decisive: short springs, slides in the film direction, moderate overshoot',
    tempo: 0.8,
    bounce: 0.22,
    amplitude: 1.15,
    enter: { card: 'slide', chip: 'slide', icon: 'scale', shape: 'scale' },
    tilt: 0,
  },
};

/** The language a brand / direction asks for (keywords in the direction's motion language and personality). */
export function languageFor(input: { personality?: string; motionLanguage?: string; requested?: string }): { language: MotionLanguage & { description: string }; why: string } {
  if (input.requested && LANGUAGES[input.requested]) return { language: LANGUAGES[input.requested], why: `requested: ${input.requested}` };
  const txt = `${input.personality ?? ''} ${input.motionLanguage ?? ''}`.toLowerCase();
  if (/playful|fun|kids|مرح|لعوب|أطفال/.test(txt)) return { language: LANGUAGES.playful, why: 'the direction asks for a playful character' };
  if (/editorial|magazine|تحرير|صحف/.test(txt)) return { language: LANGUAGES.editorial, why: 'the direction is editorial' };
  if (/energetic|sport|fast|حماس|سريع/.test(txt)) return { language: LANGUAGES['energetic-tech'], why: 'the direction asks for speed and energy' };
  return { language: LANGUAGES['premium-saas'], why: 'default for a product / SaaS film: calm, precise, premium' };
}

export const PHRASES: Record<string, MotionPhrase & { use: string }> = {
  punch: { name: 'punch', tempo: 0.72, bounce: 0.4, stagger: 0.09, accel: 'accelerate', amplitude: 1.4, use: 'the hook and the climax: arrive fast, overshoot, land' },
  snap: { name: 'snap', tempo: 0.8, bounce: 0.28, stagger: 0.11, accel: 'even', amplitude: 1.2, use: 'a problem shown quickly' },
  build: { name: 'build', tempo: 0.92, bounce: 0.18, stagger: 0.2, accel: 'accelerate', amplitude: 1.05, use: 'steps and features: each item sooner than the last' },
  glide: { name: 'glide', tempo: 1.2, bounce: 0.06, stagger: 0.16, accel: 'even', amplitude: 0.85, use: 'a promise, a product: calm, continuous' },
  settle: { name: 'settle', tempo: 1.25, bounce: 0.1, stagger: 0.22, accel: 'decelerate', amplitude: 0.85, use: 'the decision: everything comes to rest' },
};

const BY_PURPOSE: Record<string, string> = { hook: 'punch', problem: 'snap', pain: 'snap', solution: 'glide', demo: 'glide', reveal: 'glide', process: 'build', feature: 'build', proof: 'build', benefit: 'build', cta: 'settle', logo: 'settle' };

/** Motion Phrase v2: the phrase of a shot from its job, shaped by the energy the film wants there. */
export function phraseFor(purpose: string, wantEnergy?: number, measuredEnergy?: number): MotionPhrase & { why: string } {
  let name = BY_PURPOSE[purpose] ?? 'glide';
  let why = `${purpose}: ${PHRASES[name].use}`;
  if (wantEnergy !== undefined && measuredEnergy !== undefined) {
    const gap = wantEnergy - measuredEnergy;
    if (gap > 0.25 && name !== 'punch') {
      name = name === 'glide' || name === 'settle' ? 'snap' : 'punch';
      why += ` — under its energy (${measuredEnergy.toFixed(2)} vs ${wantEnergy.toFixed(2)}): ${name}`;
    } else if (gap < -0.3 && name !== 'settle') {
      name = 'glide';
      why += ` — over its energy (${measuredEnergy.toFixed(2)} vs ${wantEnergy.toFixed(2)}): glide`;
    }
  }
  const { use: _u, ...p } = PHRASES[name];
  return { ...p, why };
}
