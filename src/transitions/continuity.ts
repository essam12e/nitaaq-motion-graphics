/**
 * Transition Intelligence 2.0 — reads how Scene A ENDS and how Scene B BEGINS,
 * then upgrades the cut to a continuity device when one exists:
 *
 *   A's subject shape can become B's frame         → morph / shape-match
 *   both scenes live in the same colour            → color-match
 *   A ends on a lateral camera move                → camera-match (same direction/speed)
 *   A's subject travels toward the next idea       → motion-match
 *   B is the hero reveal and A has a clear subject → zoom-through / liquid
 *
 * It never overrides a shared-element transition, a beat cut, or the rhythm
 * floor of energetic films, and it rations itself (≤ 40% of cuts) so a film
 * never becomes a showreel of tricks. Every upgrade states its reason.
 * Pure and deterministic (seeded).
 */
import { createRng } from '../core/rng';
import type { MotionPersonalityId } from '../motion/personality';
import type { TransitionChoice } from './engine';

export interface SceneEdge {
  id: string;
  beat: string;
  category: string;
  /** Shape that dominates the frame at the scene's end/start (phone, card, circle, product…). */
  shape?: string;
  /** Subject focus (fraction of the canvas). */
  focus?: { x: number; y: number };
  /** Dominant colour of the scene (background / accent). */
  color?: string;
  /** Camera move the scene ends on. */
  camera?: string;
  hero?: boolean;
}

export interface ContinuityHint {
  focus?: { x: number; y: number };
  shape?: string;
  color?: string;
  direction?: 'left' | 'right' | 'up' | 'down';
}

export interface ContinuityChoice extends TransitionChoice {
  hint?: ContinuityHint;
}

/** Shape a scene category leaves on screen (what a morph can grow from). */
export function edgeShape(category: string, family: string): string | undefined {
  if (category === 'mobile' || /phone|app|mobile/.test(family)) return 'phone';
  if (category === 'ui' || /dashboard|browser|card|ui/.test(family)) return 'card';
  if (category === 'commerce' || /product/.test(family)) return 'circle';
  if (category === 'brand' || /logo/.test(family)) return 'squircle';
  if (category === 'social' || /chat|message|comment/.test(family)) return 'bubble';
  if (category === 'data') return 'rounded';
  if (category === 'illustration') return 'blob';
  return undefined;
}

const LATERAL: Record<string, 'left' | 'right' | 'up' | 'down'> = { 'truck-left': 'left', 'truck-right': 'right', 'pan-left': 'left', 'pan-right': 'right', 'pedestal-up': 'up', 'pedestal-down': 'down', 'crane-up': 'up' };

export function refineContinuity(input: { scenes: SceneEdge[]; choices: TransitionChoice[]; personality: MotionPersonalityId; seed: string | number; rhythmic: boolean }): ContinuityChoice[] {
  const { scenes, choices } = input;
  const rng = createRng(`${input.seed}:continuity`).next;
  const cap = Math.max(1, Math.floor(choices.length * 0.4));
  const restrained = input.personality === 'premium' || input.personality === 'corporate' || input.personality === 'cinematic';
  const playful = input.personality === 'playful' || input.personality === 'energetic';
  let used = 0;
  const usedTypes = new Set<string>();
  return choices.map((c, i) => {
    const a = scenes[i];
    const b = scenes[i + 1];
    if (!a || !b || used >= cap) return c;
    // protected decisions: identity continuity, beat cuts, rhythm cuts
    if (c.type === 'shared' || /musical beat|rhythm/.test(c.reason)) return c;
    if (c.type === 'cut' && input.rhythmic) return c;
    const sameColor = a.color && b.color && a.color.toLowerCase() === b.color.toLowerCase();
    const lateral = a.camera ? LATERAL[a.camera] : undefined;
    let next: ContinuityChoice | null = null;
    if (b.hero && a.shape && !usedTypes.has('morph')) {
      next = { type: 'morph', duration: 0.7, reason: `continuity: the ${a.shape} of "${a.beat}" becomes the window into the hero moment`, hint: { shape: a.shape, focus: a.focus } };
    } else if (lateral && (b.beat === a.beat || b.category === a.category || !restrained) && !usedTypes.has('camera-match')) {
      next = { type: 'camera-match', duration: 0.45, reason: `camera match: the next scene continues the ${a.camera} move (same direction, no velocity jump)`, hint: { direction: lateral } };
    } else if (a.shape && b.shape && a.shape === b.shape && !usedTypes.has('shape-match')) {
      next = { type: 'shape-match', duration: 0.6, reason: `shape match: both scenes are built on a ${a.shape}`, hint: { shape: a.shape, focus: a.focus } };
    } else if (sameColor && /contrast|colour|color-dip|color-sweep/.test(`${c.reason} ${c.type}`) && !usedTypes.has('color-match')) {
      next = { type: 'color-match', duration: 0.6, reason: `colour match: ${a.color} carries the eye from "${a.beat}" to "${b.beat}"`, hint: { color: a.color, focus: a.focus } };
    } else if (b.hero && a.focus && !restrained && !usedTypes.has('zoom-through')) {
      next = { type: 'zoom-through', duration: 0.6, reason: 'into the hero: the camera flies through the subject', hint: { focus: a.focus } };
    } else if (playful && b.beat === 'brand' && !usedTypes.has('liquid')) {
      next = { type: 'liquid', duration: 0.75, reason: 'brand moment: an organic flood in the brand colour', hint: { focus: a.focus ?? { x: 0.5, y: 0.5 }, color: a.color } };
    } else if (c.type === 'push' && a.category === b.category && rng() < 0.5 && !usedTypes.has('motion-match')) {
      next = { type: 'motion-match', duration: 0.5, reason: 'motion match: the movement of one card carries into the next', hint: { direction: 'left' } };
    }
    if (!next) return c;
    used++;
    usedTypes.add(next.type);
    return next;
  });
}
