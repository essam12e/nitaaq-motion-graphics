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
  /** Phase 6 (optional, set only for scenes that carry them): the scene's exit motion vector, */
  vector?: MotionVector;
  /** its subject plays a video, */
  video?: boolean;
  /** it is built on glass, */
  glass?: boolean;
  /** it ends / begins in depth of field, */
  dof?: boolean;
  /** and the rect of the element it ends on (fractions) / the rect where that element sits when the next scene begins. */
  rect?: { x: number; y: number; w: number; h: number };
  enterRect?: { x: number; y: number; w: number; h: number };
}

/**
 * Motion Continuity vector — how a scene's motion LEAVES (or ENTERS) the frame:
 * direction (unit), speed 0..1 (fraction of the frame per second, capped), depth motion −1..1 (+ = toward
 * the lens), scale rate, visual weight and energy. Two cuts are continuous when the incoming motion picks
 * up the outgoing one: same direction, similar speed and depth, no jump in energy.
 */
export interface MotionVector {
  dx: number;
  dy: number;
  speed: number;
  depth?: number;
  scale?: number;
  weight?: number;
  energy?: number;
}

/** Normalises a raw motion (screen px/s, depth/s) into a MotionVector. */
export function motionVector(vx: number, vy: number, W: number, H: number, depthRate = 0, energy = 0.5): MotionVector {
  const nx = vx / W;
  const ny = vy / H;
  const n = Math.hypot(nx, ny);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return { dx: n > 1e-6 ? r3(nx / n) : 0, dy: n > 1e-6 ? r3(ny / n) : 0, speed: r3(Math.min(1, n)), depth: r3(Math.max(-1, Math.min(1, depthRate * 4))), energy: r3(energy) };
}

/**
 * Motion Continuity Score of one cut (0..1): direction agreement (only when both move), speed match, depth
 * match and energy step. A still → still cut is neutral (0.75): nothing to continue, nothing broken.
 */
export function continuityScore(out: MotionVector | undefined, into: MotionVector | undefined, transition?: string): number {
  const still = (v?: MotionVector) => !v || (v.speed < 0.04 && Math.abs(v.depth ?? 0) < 0.05);
  if (still(out) && still(into)) return 0.75;
  // a continuity transition that carries the motion itself bridges a mismatch
  const bridge = transition && /match|push-through|z-depth|directional|camera|motion|focus-handoff|zoom-through/.test(transition) ? 0.15 : 0;
  if (still(out) || still(into)) return Math.min(1, 0.6 + bridge);
  const a = out!;
  const b = into!;
  const cos = a.dx * b.dx + a.dy * b.dy;
  const dir = a.speed > 0.04 && b.speed > 0.04 ? (cos + 1) / 2 : 0.75;
  const speed = 1 - Math.min(1, Math.abs(a.speed - b.speed) / Math.max(0.05, Math.max(a.speed, b.speed)));
  const depth = 1 - Math.min(1, Math.abs((a.depth ?? 0) - (b.depth ?? 0)) / 2);
  const energy = 1 - Math.min(1, Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5)));
  return Math.round(Math.min(1, 0.4 * dir + 0.25 * speed + 0.2 * depth + 0.15 * energy + bridge) * 1000) / 1000;
}

export interface ContinuityHint {
  focus?: { x: number; y: number };
  shape?: string;
  color?: string;
  direction?: 'left' | 'right' | 'up' | 'down';
  rect?: { x: number; y: number; w: number; h: number };
  toRect?: { x: number; y: number; w: number; h: number };
  vector?: MotionVector;
}

const axisOf = (v: MotionVector): 'left' | 'right' | 'up' | 'down' => (Math.abs(v.dx) >= Math.abs(v.dy) ? (v.dx < 0 ? 'left' : 'right') : v.dy < 0 ? 'up' : 'down');

/** Phase 6 spatial upgrade of one cut, from the optional edge fields (undefined when none applies). */
function spatialUpgrade(a: SceneEdge, b: SceneEdge, used: Set<string>): ContinuityChoice | null {
  const v = a.vector;
  const vec = v ? { vector: v } : {};
  if (a.video && b.video && !used.has('video-match-cut')) return { type: 'video-match-cut', duration: 0.5, reason: 'video match cut: the outgoing video fills the frame and the cut lands on the next video', hint: { rect: a.rect, ...vec } };
  if (a.rect && b.enterRect && !used.has('scale-match')) return { type: 'scale-match', duration: 0.6, reason: 'scale match: the element keeps its place and size across the cut', hint: { rect: a.rect, toRect: b.enterRect, ...vec } };
  if (v && (v.depth ?? 0) > 0.35) {
    if (a.rect && !used.has('card-push-through')) return { type: 'card-push-through', duration: 0.7, reason: 'push-through: the camera keeps travelling forward, through the card into the next scene', hint: { rect: a.rect, ...vec } };
    if (!used.has('z-depth-pass')) return { type: 'z-depth-pass', duration: 0.65, reason: 'z-depth pass: the forward camera motion continues across the cut', hint: { focus: a.focus, ...vec } };
  }
  if (v && v.speed > 0.45 && !used.has('directional-blur')) return { type: 'directional-blur', duration: 0.4, reason: `directional blur: the ${axisOf(v)} motion carries across the cut at the same speed`, hint: { direction: axisOf(v), vector: v } };
  if ((a.dof || b.dof) && !used.has('focus-handoff')) return { type: 'focus-handoff', duration: 0.8, reason: 'focus handoff: the focus racks from one scene to the next', hint: { ...vec } };
  if (a.glass && !used.has('glass-wipe')) return { type: 'glass-wipe', duration: 0.7, reason: 'glass wipe: a pane of the scene\'s glass carries the eye to the next scene', hint: { direction: v ? axisOf(v) : undefined, ...vec } };
  if (a.video && !used.has('foreground-card-wipe')) return { type: 'foreground-card-wipe', duration: 0.65, reason: 'foreground card wipe: a card crosses the lens and the scene changes behind it', hint: { direction: v ? axisOf(v) : undefined, ...vec } };
  return null;
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
    let next: ContinuityChoice | null = spatialUpgrade(a, b, usedTypes);
    if (next) {
      // spatial edges only exist on scenes that set them (spatial / video families); everything else is unchanged
    } else if (b.hero && a.shape && !usedTypes.has('morph')) {
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

/**
 * Spatial edge facts of a scene family (Phase 6). Only the spatial / video families declare them, so the
 * Director's choices for every other family are exactly what they were.
 */
export function spatialEdge(family: string, variant?: string): Pick<SceneEdge, 'vector' | 'video' | 'glass' | 'dof' | 'rect'> {
  if (family === 'spatial-gallery') return { video: true, glass: true, vector: { dx: 0, dy: 0, speed: 0.05, depth: variant === 'wall' ? -0.3 : 0.6, energy: 0.55 }, rect: { x: 0.2, y: 0.28, w: 0.6, h: 0.4 } };
  if (family === 'glass-folder') return { glass: true, video: variant !== 'explode', vector: { dx: 0, dy: 0, speed: 0.03, depth: variant === 'explode' ? -0.2 : 0.3, energy: 0.5 }, rect: { x: 0.25, y: 0.3, w: 0.5, h: 0.3 } };
  if (family === 'video-showcase') return { video: true };
  return {};
}
