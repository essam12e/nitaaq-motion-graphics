/**
 * Element lifecycle (P0 — principled motion model).
 *
 * The legacy model is ENTRANCE → HOLD → CUT: elements arrive with fixed delays, then
 * nothing happens until the scene is cut away. The principled model gives every shared
 * component a lifecycle driven by the existing Principles Engine (principles.ts):
 *
 *   anticipation → entrance → settle → sustain (living hold) → exit / energy handoff
 *
 *  - anticipation / overshoot / settle: principledProgress() with the element's motion
 *    profile (mass, personality). Restrained personalities never wind up.
 *  - sustain: only where it suits the element. Text that must be read stays still; cards,
 *    media and products drift a little; logos and icons breathe. The amplitude fades in
 *    after the settle and is never large (no "everything floats" look).
 *  - exit: elements leave before the cut along the shot's handoff vector, accelerating
 *    (ease-in), with a small anticipation when the personality allows it. The vector and a
 *    `handoffTarget` are recorded now so P1's Stage can pass the energy to the next shot's
 *    element; P0 does not fake that handoff.
 *
 * Every function is pure (frame in → value out): deterministic seek, identical re-renders.
 */
import type { CSSProperties } from 'react';
import type { ElementKind } from './physics';
import { clamp01, motionProfile, principledProgress, profileAnchors, type MotionProfile } from './principles';
import type { MotionPersonalityId } from './personality';
import type { EntranceFamily } from '../styles/tokens';

export type SustainMode = 'auto' | 'still' | 'drift' | 'breathe' | 'parallax';
export type ExitStyle = 'auto' | 'none' | 'handoff' | 'lift' | 'fade' | 'scale-down';

export interface ExitPlan {
  style: ExitStyle;
  /** Unit vector the energy leaves along (screen space, y down). */
  vector: { dx: number; dy: number; depth?: number };
  /** 0..1 travel / acceleration. */
  velocity: number;
  /** Seconds of exit before the outgoing transition starts. */
  lead: number;
  handoffTarget?: string;
}

export interface EmphasisEvent {
  word: string;
  /** Scene-local seconds. */
  at: number;
  end?: number;
  source: 'voice' | 'estimated' | 'script';
  accent: 'highlight' | 'pulse' | 'camera';
}

/** Everything a component needs to know about where its scene is in time. */
export interface LifeCtx {
  /** Frames the scene is fully on screen (before the outgoing transition). */
  holdFrames: number;
  /** Total scene frames (hold + outgoing transition overlap). */
  totalFrames: number;
  /** Frames of the outgoing transition (0 = hard cut or last scene). */
  outFrames: number;
  /** Last scene of the film: nothing to hand off to. */
  last: boolean;
  exit: ExitPlan;
  sustain: SustainMode;
  intentionalHold: boolean;
  emphasis: EmphasisEvent[];
}

const DIRS: Record<string, { dx: number; dy: number; depth?: number }> = {
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  in: { dx: 0, dy: 0, depth: 1 },
  out: { dx: 0, dy: 0, depth: -1 },
};

/**
 * Resolve the exit plan of a scene: the shot's explicit exit, else the outgoing transition's
 * direction / continuity vector, else the reading direction (RTL films flow right → left).
 */
export function resolveExit(input: {
  exit?: { style?: ExitStyle; direction?: string; velocity?: number; handoffVector?: { dx: number; dy: number; depth?: number }; handoffTarget?: string; lead?: number };
  transition?: { type?: string; direction?: string; vector?: { dx: number; dy: number; depth?: number; speed?: number } };
  rtl: boolean;
  energy?: number;
}): ExitPlan {
  const e = input.exit ?? {};
  const t = input.transition;
  let vector = e.handoffVector ?? (e.direction ? DIRS[e.direction] : undefined);
  if (!vector && t?.vector && (t.vector.dx || t.vector.dy)) vector = { dx: t.vector.dx, dy: t.vector.dy, depth: t.vector.depth };
  if (!vector && t?.direction) vector = DIRS[t.direction];
  if (!vector) vector = { dx: input.rtl ? -1 : 1, dy: 0 };
  const len = Math.hypot(vector.dx, vector.dy);
  const v = len > 1e-6 ? { dx: vector.dx / len, dy: vector.dy / len, depth: vector.depth } : { dx: 0, dy: 0, depth: vector.depth ?? 0 };
  let style: ExitStyle = e.style ?? 'auto';
  // auto = a handoff: the element carries its energy out along the vector and keeps the picture until late
  // (a full fade would fight transitions that need the outgoing picture: shared, match, scale, morph, zoom)
  if (style === 'auto') style = 'handoff';
  const velocity = clamp01(e.velocity ?? 0.35 + 0.4 * clamp01(input.energy ?? 0.5));
  return { style, vector: v, velocity, lead: e.lead ?? 0.3 + 0.25 * (1 - velocity), handoffTarget: e.handoffTarget };
}

/** Sustain mode for an element kind when the scene says `auto`: readable text stays still. */
export function sustainFor(mode: SustainMode, kind: ElementKind): Exclude<SustainMode, 'auto'> {
  if (mode !== 'auto') return mode;
  switch (kind) {
    case 'hero-title':
    case 'text':
    case 'body':
    case 'number':
    case 'button':
    case 'cursor':
      return 'still';
    case 'logo':
    case 'icon':
      return 'breathe';
    case 'background':
      return 'parallax';
    default:
      return 'drift';
  }
}

/** Seconds from `delay` until the profile has settled (its last visible oscillation). */
export function settleSec(prof: MotionProfile, fps: number, delay: number, speed = 1): number {
  const a = profileAnchors(prof, fps, delay, speed);
  return a.settleFrame / fps;
}

/** Entrance progress (may dip below 0 — anticipation — and overshoot above 1). */
export function entranceP(prof: MotionProfile, frame: number, fps: number, delay: number, speed = 1): number {
  return principledProgress(prof, frame, fps, delay, speed);
}

/**
 * Living hold: a small, slow offset after the element has settled. Amplitudes are in canvas
 * units (u = 1% of the short edge). The envelope fades in over 0.8 s after the settle and out
 * again as the exit begins, so the sustain never fights the entrance or the exit.
 */
export function sustainOffset(mode: Exclude<SustainMode, 'auto'>, t: number, settledAt: number, exitAt: number, u: number, phase = 0): { x: number; y: number; scale: number } {
  if (mode === 'still' || t <= settledAt) return { x: 0, y: 0, scale: 1 };
  const env = clamp01((t - settledAt) / 0.8) * clamp01((exitAt - t) / 0.25 + 0.0001);
  const s = t - settledAt;
  switch (mode) {
    case 'drift': {
      // a slow ellipse (7 s period), half a canvas unit: perceptible, never busy
      const w = (Math.PI * 2) / 7;
      return { x: Math.sin(s * w + phase) * 0.5 * u * env, y: (Math.cos(s * w * 0.8 + phase) - 1) * 0.35 * u * env, scale: 1 };
    }
    case 'breathe': {
      const w = (Math.PI * 2) / 4.2;
      return { x: 0, y: 0, scale: 1 + (1 - Math.cos(s * w + phase)) * 0.006 * env };
    }
    case 'parallax':
      // continuous slow travel (a background that keeps the world alive)
      return { x: -s * 0.12 * u * env, y: 0, scale: 1 + s * 0.002 * env };
    default:
      return { x: 0, y: 0, scale: 1 };
  }
}

/** Exit window of an element (scene-local frames). `order` staggers elements (0 = leaves first). */
export function exitWindow(life: LifeCtx, fps: number, order = 0): { start: number; end: number } | null {
  if (life.last || life.exit.style === 'none') return null;
  const lead = life.exit.lead * fps;
  const stagger = Math.min(0.06 * fps, (lead * 0.4) / 4) * Math.min(4, Math.max(0, order));
  const start = life.holdFrames - lead + stagger;
  // the exit carries on through the outgoing transition (handoff into it); a hard cut ends it at the cut
  const end = life.outFrames > 0 ? life.holdFrames + life.outFrames * 0.75 : life.holdFrames;
  return { start, end: Math.max(start + 2, end) };
}

/** Exit progress 0..1 (ease-in: the element accelerates out, energy rising into the cut). */
export function exitP(life: LifeCtx, frame: number, fps: number, order = 0): number {
  const w = exitWindow(life, fps, order);
  if (!w || frame <= w.start) return 0;
  const x = clamp01((frame - w.start) / (w.end - w.start));
  return x * x * (0.6 + 0.4 * x);
}

/**
 * Exit transform. `anticipation` (0..1) adds a short counter-move before the element leaves
 * (only for personalities whose profile winds up). Travel is in canvas units.
 */
export function exitStyle(plan: ExitPlan, p: number, u: number, anticipation = 0): CSSProperties {
  if (p <= 0 && !anticipation) return {};
  const travel = (4 + 10 * plan.velocity) * u;
  const wind = anticipation > 0 ? -Math.sin(clamp01(p / 0.18) * Math.PI) * anticipation * 0.25 * (1 - clamp01((p - 0.18) / 0.2)) : 0;
  const k = p + wind;
  const dx = plan.vector.dx * travel * k;
  const dy = plan.vector.dy * travel * k;
  const depth = plan.vector.depth ?? 0;
  const sc = depth ? 1 + depth * 0.12 * k : 1;
  switch (plan.style) {
    case 'lift':
      return { transform: `translate(${dx.toFixed(2)}px, ${(dy - travel * 0.5 * p).toFixed(2)}px) scale(${sc.toFixed(4)})`, opacity: 1 - clamp01(p * 1.2) };
    case 'fade':
      return { opacity: 1 - clamp01(p) };
    case 'scale-down':
      return { transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${(sc * (1 - 0.08 * p)).toFixed(4)})`, opacity: 1 - clamp01(p * 1.1) };
    case 'none':
      return {};
    case 'handoff':
    case 'auto':
    default:
      return { transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${sc.toFixed(4)})`, opacity: 1 - clamp01((p - 0.55) / 0.45) * 0.85 };
  }
}

/** Emphasis pulse 0..1 for a word spoken at `at` (scene-local seconds): rises fast, decays over 0.5 s. */
export function emphasisPulse(t: number, at: number): number {
  const d = t - at;
  if (d < -0.06 || d > 0.6) return 0;
  if (d < 0.06) return clamp01((d + 0.06) / 0.12);
  return Math.max(0, 1 - (d - 0.06) / 0.54) ** 2;
}

/**
 * Principled entrance style for a legacy entrance family: transforms use the unclamped
 * progress (wind-up and overshoot are visible), opacity / blur / clip use the clamped one.
 */
export function principledEntranceStyle(family: EntranceFamily, p: number, intensity: number, u: number, dir: 'rtl' | 'ltr' = 'rtl'): CSSProperties {
  const k = 0.5 + intensity;
  const c = clamp01(p);
  const inv = 1 - p;
  const ic = 1 - c;
  const side = dir === 'rtl' ? 1 : -1;
  switch (family) {
    case 'fade':
      return { opacity: c, transform: `scale(${(1 + inv * 0.03).toFixed(4)})` };
    case 'blur':
      return { opacity: c, filter: ic > 0.002 ? `blur(${(ic * 18 * k).toFixed(2)}px)` : undefined, transform: `scale(${(1 + inv * 0.06 * k).toFixed(4)})` };
    case 'scale':
      return { opacity: c, transform: `scale(${(0.82 + 0.18 * p).toFixed(4)})` };
    case 'pop':
      return { opacity: clamp01(c * 3), transform: `scale(${(0.4 + 0.6 * p).toFixed(4)})` };
    case 'drop':
      return { opacity: clamp01(c * 2), transform: `translateY(${(-inv * 9 * u * k).toFixed(2)}px)` };
    case 'slide':
      return { opacity: clamp01(c * 2), transform: `translateX(${(side * inv * 12 * u * k).toFixed(2)}px)` };
    case 'tilt':
      return { opacity: c, transform: `perspective(1200px) rotateX(${(inv * 55).toFixed(2)}deg) translateY(${(inv * 4 * u).toFixed(2)}px)` };
    case 'mask':
    case 'wipe':
      return dir === 'rtl' ? { clipPath: `inset(-20% 0 -20% ${(ic * 100).toFixed(2)}%)` } : { clipPath: `inset(-20% ${(ic * 100).toFixed(2)}% -20% 0)` };
    case 'rise':
    default:
      return { opacity: clamp01(c * 1.6), transform: `translateY(${(inv * 5 * u * k).toFixed(2)}px)` };
  }
}

/** Compose CSS transforms / opacities of the lifecycle phases onto a base style. */
export function composeStyles(...styles: (CSSProperties | undefined)[]): CSSProperties {
  const out: CSSProperties = {};
  const tf: string[] = [];
  let op = 1;
  let hasOp = false;
  for (const s of styles) {
    if (!s) continue;
    for (const [k, v] of Object.entries(s)) {
      if (v === undefined) continue;
      if (k === 'transform') tf.push(String(v));
      else if (k === 'opacity') {
        op *= Number(v);
        hasOp = true;
      } else (out as Record<string, unknown>)[k] = v;
    }
  }
  if (tf.length) out.transform = tf.join(' ');
  if (hasOp) out.opacity = Math.round(op * 10000) / 10000;
  return out;
}

/** The profile a shared component animates with (personality + element kind + rough size). */
export function profileFor(personality: MotionPersonalityId | undefined, kind: ElementKind, area?: number): MotionProfile {
  return motionProfile(personality, kind, area);
}

/**
 * Full lifecycle style of one element at a frame: entrance (principled), sustain, exit.
 * `order` = the element's place in the scene's sequence (exit stagger).
 */
export function lifecycleStyle(input: {
  frame: number;
  fps: number;
  speed: number;
  delay: number;
  kind: ElementKind;
  personality?: MotionPersonalityId;
  family: EntranceFamily;
  intensity: number;
  u: number;
  dir: 'rtl' | 'ltr';
  life: LifeCtx;
  order?: number;
  phase?: number;
  /** Skip the entrance part (the caller animates its own entrance). */
  noEntrance?: boolean;
  /** Sustain for this element regardless of the scene's (e.g. still for an unknown wrapper that may hold copy). */
  sustain?: Exclude<SustainMode, 'auto'>;
  /** Inside a wrapper that already sustains and exits (entrance only, so nothing moves twice). */
  owned?: boolean;
}): CSSProperties {
  const prof = profileFor(input.personality, input.kind);
  const p = entranceP(prof, input.frame, input.fps, input.delay, input.speed);
  const ent = input.noEntrance ? undefined : principledEntranceStyle(input.family, p, input.intensity, input.u, input.dir);
  const t = input.frame / input.fps;
  const settled = settleSec(prof, input.fps, input.delay, input.speed);
  const w = exitWindow(input.life, input.fps, input.order ?? 0);
  const exitAt = w ? w.start / input.fps : input.life.totalFrames / input.fps;
  if (input.owned) return ent ?? {};
  const mode = input.life.intentionalHold ? 'still' : input.sustain ?? sustainFor(input.life.sustain, input.kind);
  const sus = sustainOffset(mode, t, settled, exitAt, input.u, input.phase ?? 0);
  const susStyle: CSSProperties | undefined = sus.x || sus.y || sus.scale !== 1 ? { transform: `translate(${sus.x.toFixed(2)}px, ${sus.y.toFixed(2)}px) scale(${sus.scale.toFixed(4)})` } : undefined;
  const xp = exitP(input.life, input.frame, input.fps, input.order ?? 0);
  const ex = xp > 0 ? exitStyle(input.life.exit, xp, input.u, prof.anticipation > 0 ? 1 : 0) : undefined;
  return composeStyles(ent, susStyle, ex);
}
