/**
 * Motion Intent System — WHAT the element is and WHY it moves decide HOW it moves.
 *
 *   role    hero-product · headline · supporting-text · cta · logo · ui ·
 *           illustration · icon · background · decorative · data-viz
 *   intent  reveal · emphasis · transition · navigation · transformation ·
 *           continuity · attention · storytelling
 *
 * The pair (role, intent) under the film's personality resolves to one motion
 * choice: entrance, spring, anticipation, stagger, the camera's relation to the
 * element, and the sound tier. A preset is never picked at random: every choice
 * carries the reason it was made (written to motion_spec.json).
 * Pure and deterministic.
 */
import type { Beat } from '../schema/plan';
import type { EntranceFamily } from '../styles/tokens';
import type { ElementKind } from './physics';
import { PERSONALITIES, physicsFor, type MotionPersonalityId } from './personality';
import type { SpringOptions } from './spring';

export const ELEMENT_ROLES = ['hero-product', 'headline', 'supporting-text', 'cta', 'logo', 'ui', 'illustration', 'icon', 'background', 'decorative', 'data-viz'] as const;
export type ElementRole = (typeof ELEMENT_ROLES)[number];

export const MOTION_INTENTS = ['reveal', 'emphasis', 'transition', 'navigation', 'transformation', 'continuity', 'attention', 'storytelling'] as const;
export type MotionIntent = (typeof MOTION_INTENTS)[number];

export type SoundTier = 'hero' | 'major' | 'minor' | 'silent';

export interface MotionChoice {
  role: ElementRole;
  intent: MotionIntent;
  element: ElementKind;
  entrance: EntranceFamily | 'none' | 'morph' | 'draw';
  spring: SpringOptions;
  anticipation: number;
  stagger: number;
  /** How the camera treats this element: it may lead (camera reveals it), follow it, or ignore it. */
  camera: 'lead' | 'follow' | 'frame' | 'ignore';
  /** 0..1 visual importance (drives safe-framing priority and sound). */
  importance: number;
  sound: SoundTier;
  /** Ambient motion after settling (0 = rests). */
  idle: number;
  reason: string;
}

const ROLE_ELEMENT: Record<ElementRole, ElementKind> = {
  'hero-product': 'product',
  headline: 'hero-title',
  'supporting-text': 'body',
  cta: 'button',
  logo: 'logo',
  ui: 'panel',
  illustration: 'card',
  icon: 'icon',
  background: 'background',
  decorative: 'icon',
  'data-viz': 'chart',
};

const ROLE_IMPORTANCE: Record<ElementRole, number> = { 'hero-product': 1, logo: 0.9, cta: 0.9, headline: 0.85, 'data-viz': 0.75, ui: 0.7, illustration: 0.6, 'supporting-text': 0.5, icon: 0.4, decorative: 0.15, background: 0.05 };

/** The intent an element carries in a beat (what this moment is FOR). */
export function intentFor(role: ElementRole, beat: Beat | string, opts: { hero?: boolean; shared?: boolean; first?: boolean } = {}): MotionIntent {
  if (opts.shared) return 'continuity';
  if (role === 'background' || role === 'decorative') return 'storytelling';
  if (role === 'cta') return 'attention';
  if (role === 'logo') return beat === 'brand' || beat === 'cta' ? 'reveal' : 'continuity';
  if (role === 'hero-product') return opts.hero || beat === 'product' || beat === 'reveal' ? 'reveal' : beat === 'detail' ? 'emphasis' : 'continuity';
  if (role === 'ui') return beat === 'demo' || beat === 'process' ? 'navigation' : 'reveal';
  if (role === 'data-viz') return beat === 'comparison' ? 'transformation' : 'emphasis';
  if (role === 'illustration') return beat === 'process' || beat === 'solution' ? 'transformation' : 'storytelling';
  if (role === 'headline') return opts.first || beat === 'hook' ? 'attention' : beat === 'problem' || beat === 'solution' ? 'emphasis' : 'reveal';
  return 'reveal';
}

const toSpring = (el: ElementKind, p: MotionPersonalityId): SpringOptions => {
  const ph = physicsFor(p, el);
  return { stiffness: ph.stiffness, damping: ph.damping, mass: ph.mass };
};

/** Resolve the motion of one element from its role and intent under the film personality. */
export function chooseMotion(role: ElementRole, intent: MotionIntent, personality: MotionPersonalityId, opts: { area?: number; hero?: boolean } = {}): MotionChoice {
  const P = PERSONALITIES[personality] ?? PERSONALITIES.tech;
  const element = ROLE_ELEMENT[role];
  const restrained = personality === 'premium' || personality === 'corporate' || personality === 'cinematic';
  const bouncy = personality === 'playful' || personality === 'energetic' || personality === 'sport';
  let importance = ROLE_IMPORTANCE[role];
  if (opts.hero) importance = Math.min(1, importance + 0.1);
  const spring = toSpring(element, personality);
  let entrance: MotionChoice['entrance'] = P.entrances[0];
  let anticipation = 0;
  let camera: MotionChoice['camera'] = 'ignore';
  let idle = P.float;
  const why: string[] = [];

  switch (intent) {
    case 'reveal':
      if (role === 'hero-product') {
        entrance = restrained ? 'mask' : 'rise';
        camera = 'lead';
        why.push('the product is revealed by the camera and light, not by a generic pop');
      } else if (role === 'logo') {
        entrance = 'morph';
        camera = 'frame';
        why.push('the logo arrives through a shape that becomes it (the logo itself is never distorted)');
      } else if (role === 'ui') {
        entrance = 'rise';
        camera = 'frame';
        why.push('UI rises into place like an interface, heavy and exact');
      } else {
        entrance = role === 'headline' ? (restrained ? 'mask' : P.entrances[0]) : 'fade';
        why.push(`${role} revealed with the film's primary entrance`);
      }
      break;
    case 'emphasis':
      entrance = role === 'data-viz' ? 'draw' : restrained ? 'mask' : 'scale';
      anticipation = restrained ? 0 : bouncy ? 0.08 : 0.04;
      why.push('emphasis: one clear accent (scale/weight), anticipation only where the personality allows');
      break;
    case 'attention':
      entrance = role === 'cta' ? (restrained ? 'rise' : 'pop') : bouncy ? 'pop' : P.entrances[0];
      anticipation = restrained ? 0 : 0.06;
      camera = role === 'cta' ? 'frame' : 'ignore';
      idle = role === 'cta' ? Math.max(0.15, P.float) : idle;
      why.push(role === 'cta' ? 'the CTA must win attention and keep a gentle life after it lands' : 'attention: stop the scroll in the first second');
      break;
    case 'transformation':
      entrance = 'morph';
      camera = 'follow';
      why.push('state change shown as one object transforming (continuity, not a cut)');
      break;
    case 'continuity':
      entrance = 'none';
      camera = 'follow';
      idle = 0;
      why.push('the element already exists on screen — it moves to its next place instead of re-entering');
      break;
    case 'navigation':
      entrance = 'slide';
      camera = 'follow';
      why.push('navigation moves along the reading direction (RTL for Arabic)');
      break;
    case 'transition':
      entrance = 'none';
      why.push('carried by the scene transition');
      break;
    case 'storytelling':
      entrance = role === 'background' ? 'none' : 'fade';
      idle = role === 'background' ? 0.3 : P.float;
      why.push(role === 'decorative' ? 'decoration stays secondary: soft fade, no sound' : 'environment supports the story without competing');
      break;
  }
  const sound: SoundTier = role === 'background' || role === 'decorative' ? 'silent' : importance >= 0.88 || opts.hero ? 'hero' : importance >= 0.65 ? 'major' : importance >= 0.4 ? 'minor' : 'silent';
  const stagger = role === 'supporting-text' || role === 'icon' || role === 'data-viz' ? P.stagger : role === 'headline' ? P.stagger * 0.8 : 0;
  return { role, intent, element, entrance, spring, anticipation, stagger, camera, importance: Math.round(importance * 100) / 100, sound, idle, reason: why.join('; ') };
}

/** Roles a scene contains, read from its content keys and category (no guessing beyond the data). */
export function rolesOf(content: Record<string, unknown>, category: string): ElementRole[] {
  const roles = new Set<ElementRole>();
  const has = (k: string) => content[k] !== undefined && content[k] !== null && content[k] !== '';
  const str = JSON.stringify(content);
  if (/"(product(-\d+)?)"/.test(str) || has('product') || has('products')) roles.add('hero-product');
  if (has('title') || has('headline') || has('word') || has('lines') || has('text')) roles.add('headline');
  if (has('subtitle') || has('body') || has('items') || has('points') || has('features')) roles.add('supporting-text');
  if (has('cta') || has('button') || category === 'cta') roles.add('cta');
  if (/"logo"/.test(str) || category === 'brand') roles.add('logo');
  if (category === 'ui' || category === 'mobile' || has('ui') || has('screen')) roles.add('ui');
  if (category === 'illustration' || has('illustration') || has('shapes')) roles.add('illustration');
  if (has('icon') || has('icons')) roles.add('icon');
  if (category === 'data' || has('series') || has('stats') || has('value')) roles.add('data-viz');
  roles.add('background');
  return [...roles];
}

export interface SceneIntentPlan {
  primary: { role: ElementRole; intent: MotionIntent };
  elements: MotionChoice[];
}

/** Intent plan for a scene: every element's motion + the primary subject the camera serves. */
export function planSceneIntent(input: { content: Record<string, unknown>; category: string; beat: Beat | string; personality: MotionPersonalityId; hero: boolean; first: boolean; sharedAssets?: string[] }): SceneIntentPlan {
  const roles = rolesOf(input.content, input.category);
  const elements = roles.map((r) => {
    const shared = Boolean(input.sharedAssets?.length && ((r === 'hero-product' && input.sharedAssets.some((a) => a.startsWith('product'))) || (r === 'logo' && input.sharedAssets.includes('logo'))));
    return chooseMotion(r, intentFor(r, input.beat, { hero: input.hero, shared, first: input.first }), input.personality, { hero: input.hero });
  });
  const primary = [...elements].filter((e) => e.role !== 'background').sort((a, b) => b.importance - a.importance)[0] ?? elements[0];
  return { primary: { role: primary.role, intent: primary.intent }, elements };
}
