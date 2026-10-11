/**
 * Camera direction (Camera Engine 2.0): turns the Creative Director's decision
 * "this scene gets a camera move" into a concrete, editable CameraPlan.
 *
 * The move is chosen from what the scene's primary subject needs (intent),
 * the film's motion personality and the legacy move the storyboard proposed
 * (kept as the default so earlier films keep their character):
 *
 *   hero product  → orbit / arc / push-in with depth of field (premium/cinematic)
 *   headline      → push-in (emphasis) or a slow drift
 *   ui / mobile   → truck along the reading direction (RTL: right → left)
 *   data          → pedestal rise (numbers "grow")
 *   cta           → pull-out (resolve, give the action room)
 *   logo/brand    → crane-up into the reveal
 *
 * Amplitudes stay small; the framing solver in QC lowers them further when a
 * measured element would leave the safe area, collide or read too fast.
 */
import type { MotionPersonalityId } from '../motion/personality';
import type { ElementRole, MotionIntent } from '../motion/intent';
import { LEGACY_MOVE, type CameraMoveId, type CameraPlan } from './moves';

export type LegacyCamera = 'none' | 'push' | 'pull' | 'drift' | 'rise' | 'pan-left' | 'pan-right' | 'fall' | 'tilt' | 'orbit';

const AMPLITUDE: Record<MotionPersonalityId, number> = { premium: 0.8, cinematic: 1, corporate: 0.6, tech: 0.85, playful: 0.9, energetic: 1.05, sport: 1.1 };
const EASE: Record<MotionPersonalityId, string> = { premium: 'luxury-glide', cinematic: 'camera-dolly', corporate: 'ease-in-out-cubic', tech: 'ease-out-quint', playful: 'ease-out-expo', energetic: 'ease-out-expo', sport: 'ease-out-expo' };

export function planCamera(input: {
  legacy: LegacyCamera;
  role: ElementRole;
  intent: MotionIntent;
  personality: MotionPersonalityId;
  beat: string;
  hero: boolean;
  first: boolean;
  rtl: boolean;
  /** Pseudo-random 0..1 (seeded by the caller). */
  r: number;
}): CameraPlan | undefined {
  if (input.legacy === 'none') return undefined;
  const P = input.personality;
  const restrained = P === 'premium' || P === 'corporate';
  let move: CameraMoveId = LEGACY_MOVE[input.legacy] ?? 'drift';
  let dof = false;
  const why: string[] = [];
  if (input.role === 'hero-product') {
    if (input.hero) {
      move = restrained ? 'push-in' : P === 'cinematic' ? (input.r < 0.5 ? 'arc' : 'orbit-left') : input.r < 0.5 ? 'orbit-left' : 'push-in';
      dof = P === 'premium' || P === 'cinematic';
      why.push('hero product: the camera moves around/toward it so depth (not a pop) presents it');
    } else {
      move = 'push-in';
      why.push('product: a slow push keeps it the subject');
    }
  } else if (input.role === 'logo' || input.beat === 'brand') {
    move = restrained ? 'push-in' : 'crane-up';
    why.push('brand moment: the camera rises into the mark');
  } else if (input.role === 'cta' || input.beat === 'cta') {
    move = 'pull-out';
    why.push('resolve: pulling out gives the action room');
  } else if (input.role === 'ui') {
    move = input.rtl ? 'truck-left' : 'truck-right';
    why.push(`interface: the camera travels in the reading direction (${input.rtl ? 'RTL' : 'LTR'})`);
  } else if (input.role === 'data-viz') {
    move = 'pedestal-up';
    why.push('data: a rising camera makes the number grow');
  } else if (input.role === 'headline') {
    move = input.first || input.intent === 'emphasis' ? 'push-in' : input.legacy === 'drift' ? 'drift' : 'push-in';
    why.push(input.first ? 'hook: push toward the headline to stop the scroll' : 'headline: the camera leans in on the message');
  } else {
    why.push(`kept the storyboard move (${input.legacy})`);
  }
  // corporate never orbits; premium keeps lateral moves short
  if (P === 'corporate' && /orbit|arc|crane/.test(move)) move = 'push-in';
  const amplitude = Math.round(AMPLITUDE[P] * (input.hero ? 1 : 0.85) * 100) / 100;
  return { move, amplitude, ease: EASE[P], focus: { x: 0.5, y: 0.45 }, ...(dof ? { dof } : {}), reason: why.join('; ') };
}

/** Downbeats inside a scene (scene-local seconds), for camera/motion accents: max 3, never in the first/last 0.3 s. */
export function sceneAccents(start: number, duration: number, downbeats: number[], max = 3): number[] {
  return downbeats
    .map((b) => Math.round((b - start) * 1000) / 1000)
    .filter((t) => t > 0.3 && t < duration - 0.3)
    .slice(0, max);
}
