/**
 * Motion language. Pure functions of (frame, fps, …) so every animation is
 * deterministic and frame-accurate. Intensity scales amplitudes so the
 * Director can dial motion up/down without changing scenes.
 */
import { Easing, interpolate, spring } from 'remotion';
import type { EasingFamily, EntranceFamily } from '../styles/tokens';
import type { CSSProperties } from 'react';

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const EASE = {
  smooth: Easing.bezier(0.22, 1, 0.36, 1),
  snappy: Easing.bezier(0.2, 0.9, 0.1, 1),
  cinematic: Easing.bezier(0.65, 0, 0.35, 1),
  inOut: Easing.bezier(0.45, 0, 0.55, 1),
  in: Easing.bezier(0.55, 0, 1, 0.45),
  out: Easing.bezier(0, 0.55, 0.45, 1),
};

export interface MotionCtx {
  frame: number;
  fps: number;
  /** 0..1 overall motion intensity. */
  intensity: number;
  easing: EasingFamily;
  speed: number;
}

/** 0→1 progress starting at `delay` sec, lasting `dur` sec, using the family's easing. */
export function progress(m: MotionCtx, delay: number, dur = 0.7, family: EasingFamily = m.easing): number {
  const f = m.frame - delay * m.fps / m.speed;
  const d = Math.max(1, (dur * m.fps) / m.speed);
  if (family === 'elastic' || family === 'snappy') {
    return spring({
      frame: f,
      fps: m.fps,
      durationInFrames: family === 'elastic' ? undefined : d,
      config: family === 'elastic' ? { damping: 11, stiffness: 140, mass: 0.8 } : { damping: 200, stiffness: 180 },
    });
  }
  const e = family === 'cinematic' ? EASE.cinematic : EASE.smooth;
  return interpolate(f, [0, d], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e });
}

/** Spring that overshoots (for impacts). */
export function overshoot(m: MotionCtx, delay: number, stiffness = 170): number {
  return spring({ frame: m.frame - delay * m.fps / m.speed, fps: m.fps, config: { damping: 9 + (1 - m.intensity) * 10, stiffness, mass: 0.7 } });
}

/** Exit progress near the end of a scene (0 = visible, 1 = gone). */
export function exitProgress(m: MotionCtx, sceneFrames: number, dur = 0.4): number {
  const d = dur * m.fps;
  return interpolate(m.frame, [sceneFrames - d, sceneFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE.in });
}

export function stagger(i: number, gap: number, base = 0): number {
  return base + i * gap;
}

/** Entrance transform for a family at progress p (0 hidden → 1 settled). */
export function entranceStyle(family: EntranceFamily, p: number, intensity: number, u: number, dir: 'rtl' | 'ltr' = 'rtl'): CSSProperties {
  const k = 0.5 + intensity;
  const inv = 1 - p;
  const side = dir === 'rtl' ? 1 : -1;
  switch (family) {
    case 'fade':
      return { opacity: p };
    case 'blur':
      return { opacity: p, filter: `blur(${inv * 18 * k}px)`, transform: `scale(${1 + inv * 0.06 * k})` };
    case 'scale':
      return { opacity: p, transform: `scale(${0.82 + 0.18 * p})` };
    case 'pop':
      return { opacity: clamp(p * 3), transform: `scale(${0.4 + 0.6 * p})` };
    case 'drop':
      return { opacity: clamp(p * 2), transform: `translateY(${-inv * 9 * u * k}px)` };
    case 'slide':
      return { opacity: clamp(p * 2), transform: `translateX(${side * inv * 12 * u * k}px)` };
    case 'tilt':
      return { opacity: p, transform: `perspective(1200px) rotateX(${inv * 55}deg) translateY(${inv * 4 * u}px)` };
    case 'mask':
    case 'wipe':
      // Clip from the reading-start edge (right for RTL).
      return dir === 'rtl' ? { clipPath: `inset(-20% 0 -20% ${inv * 100}%)` } : { clipPath: `inset(-20% ${inv * 100}% -20% 0)` };
    case 'rise':
    default:
      return { opacity: clamp(p * 1.6), transform: `translateY(${inv * 5 * u * k}px)` };
  }
}

/** Slow ambient float (for cards, orbs, products). */
export function float(frame: number, fps: number, amp: number, periodSec = 4, phase = 0): number {
  return Math.sin(((frame / fps) * Math.PI * 2) / periodSec + phase) * amp;
}

/** Camera transforms over the scene (0..1 t). */
export type CameraMove = 'none' | 'push' | 'pull' | 'pan-left' | 'pan-right' | 'rise' | 'fall' | 'tilt' | 'drift' | 'orbit';

export function cameraStyle(move: CameraMove, t: number, activity: number, u: number): CSSProperties {
  const a = activity;
  const e = EASE.inOut(clamp(t));
  switch (move) {
    case 'push':
      return { transform: `scale(${1 + 0.07 * a * e})` };
    case 'pull':
      return { transform: `scale(${1 + 0.07 * a * (1 - e)})` };
    case 'pan-left':
      return { transform: `scale(${1 + 0.05 * a}) translateX(${(0.5 - e) * 4 * u * a}px)` };
    case 'pan-right':
      return { transform: `scale(${1 + 0.05 * a}) translateX(${(e - 0.5) * 4 * u * a}px)` };
    case 'rise':
      return { transform: `scale(${1 + 0.04 * a}) translateY(${(0.5 - e) * 4 * u * a}px)` };
    case 'fall':
      return { transform: `scale(${1 + 0.04 * a}) translateY(${(e - 0.5) * 4 * u * a}px)` };
    case 'tilt':
      return { transform: `perspective(2400px) rotateX(${(0.5 - e) * 6 * a}deg) scale(${1 + 0.03 * a})` };
    case 'orbit':
      return { transform: `perspective(2400px) rotateY(${(e - 0.5) * 10 * a}deg) scale(${1 + 0.03 * a})` };
    case 'drift':
      return { transform: `translate(${Math.sin(t * Math.PI) * 1.2 * u * a}px, ${(0.5 - e) * 1.5 * u * a}px) scale(${1 + 0.02 * a * e})` };
    default:
      return {};
  }
}

/** Parallax offset for a layer at depth d (0 = background, 1 = foreground). */
export function parallax(t: number, depth: number, u: number, amount = 1): number {
  return (t - 0.5) * depth * 6 * u * amount;
}

/** Speed ramp: fast-slow-fast mapping of t (for speed transitions). */
export function speedRamp(t: number): number {
  const x = clamp(t);
  return x < 0.5 ? 0.5 * Math.pow(2 * x, 0.45) : 1 - 0.5 * Math.pow(2 * (1 - x), 0.45);
}

/** Magnetic pull toward a target once within range, for cursor/icon motion. */
export function magnetic(p: number): number {
  const x = clamp(p);
  return 1 - Math.pow(1 - x, 3) + Math.sin(x * Math.PI) * 0.04;
}

/** Elastic settle 0→1 without spring config. */
export function elastic(t: number): number {
  const x = clamp(t);
  if (x === 0 || x === 1) return x;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

/** Directional motion blur approximation for fast moves (CSS blur scaled by velocity). */
export function motionBlur(velocityPxPerFrame: number, max = 14): string | undefined {
  const b = Math.min(max, Math.abs(velocityPxPerFrame) * 0.12);
  return b > 0.4 ? `blur(${b.toFixed(2)}px)` : undefined;
}

/** Counter value with easing (for numbers). */
export function countUp(m: MotionCtx, from: number, to: number, delay: number, dur: number): number {
  const p = interpolate(m.frame - delay * m.fps, [0, dur * m.fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE.out });
  return from + (to - from) * p;
}
