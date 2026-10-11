/**
 * Easing library for Motion Engine 2.0 — custom cubic Bézier, back/anticipate,
 * elastic, bounce, steps, and combinators (mirror, reverse, blend). Every easing
 * is a pure (t: 0..1) → number; Bézier solving is exact (Newton + bisection),
 * so the same t always yields the same value on every machine.
 */

export type EasingFn = (t: number) => number;
const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

/** Exact cubic Bézier easing (CSS cubic-bezier semantics). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  if (x1 === y1 && x2 === y2) return clamp01;
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  const solve = (x: number) => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(s) - x;
      if (Math.abs(e) < 1e-7) return s;
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(s);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return s;
  };
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sy(solve(t)));
}

export const mirror = (e: EasingFn): EasingFn => (t) => (t <= 0.5 ? e(2 * t) / 2 : (2 - e(2 * (1 - t))) / 2);
export const reverse = (e: EasingFn): EasingFn => (t) => 1 - e(1 - t);
export const blend = (a: EasingFn, b: EasingFn, k: number): EasingFn => (t) => a(t) * (1 - k) + b(t) * k;

/** Back-in: pulls back before leaving (anticipation inside an easing). */
export const backIn = (s = 1.70158): EasingFn => (t) => t * t * ((s + 1) * t - s);
export const backOut = (s = 1.70158): EasingFn => reverse(backIn(s));
export const backInOut = (s = 1.70158): EasingFn => mirror(backIn(s * 1.525));
/** Anticipate: back-in for the first half, then an exponential release (Motion's "anticipate"). */
export const anticipate = (s = 1.6): EasingFn => {
  const b = backIn(s);
  return (t) => ((t *= 2) < 1 ? 0.5 * b(t) : 0.5 * (2 - Math.pow(2, -10 * (t - 1))));
};

export const elasticOut = (amplitude = 1, period = 0.3): EasingFn => {
  const a = Math.max(1, amplitude);
  const s = (period / (2 * Math.PI)) * Math.asin(1 / a);
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : a * Math.pow(2, -10 * t) * Math.sin(((t - s) * 2 * Math.PI) / period) + 1);
};
export const bounceOut: EasingFn = (t) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
export const steps = (n: number, at: 'start' | 'end' = 'end'): EasingFn => (t) => {
  const k = clamp01(t) * n;
  return Math.min(1, (at === 'end' ? Math.floor(k) : Math.ceil(k)) / n);
};
export const expoOut: EasingFn = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const circOut: EasingFn = (t) => Math.sqrt(1 - Math.pow(clamp01(t) - 1, 2));
export const sineInOut: EasingFn = (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

/** Rate functions in the Manim tradition (pure, normalised). */
export const RATE = {
  linear: clamp01,
  smooth: (t: number) => {
    // Manim's `smooth`: sigmoid normalised to [0,1] (inflection 10)
    const x = clamp01(t);
    const s = (v: number) => 1 / (1 + Math.exp(-v));
    const err = s(-5);
    return Math.min(1, Math.max(0, (s(10 * (x - 0.5)) - err) / (1 - 2 * err)));
  },
  thereAndBack: (t: number) => {
    const x = clamp01(t);
    return RATE.smooth(x < 0.5 ? 2 * x : 2 - 2 * x);
  },
  rushInto: (t: number) => 2 * RATE.smooth(clamp01(t) / 2),
  rushFrom: (t: number) => 2 * RATE.smooth(clamp01(t) / 2 + 0.5) - 1,
  wiggle: (t: number, wiggles = 2) => RATE.thereAndBack(t) * Math.sin(wiggles * Math.PI * clamp01(t)),
  doubleSmooth: (t: number) => (t < 0.5 ? 0.5 * RATE.smooth(2 * t) : 0.5 * (1 + RATE.smooth(2 * t - 1))),
};

/** Named curves the director and scenes refer to (no scattered magic numbers). */
export const CURVES: Record<string, EasingFn> = {
  'ease-out-quint': cubicBezier(0.22, 1, 0.36, 1),
  'ease-out-expo': cubicBezier(0.16, 1, 0.3, 1),
  'ease-in-out-cubic': cubicBezier(0.65, 0, 0.35, 1),
  'ease-in-quart': cubicBezier(0.5, 0, 0.75, 0),
  'emphasized-decelerate': cubicBezier(0.05, 0.7, 0.1, 1),
  'emphasized-accelerate': cubicBezier(0.3, 0, 0.8, 0.15),
  'luxury-glide': cubicBezier(0.19, 1, 0.22, 1),
  'camera-dolly': cubicBezier(0.45, 0.05, 0.25, 1),
  'camera-whip': cubicBezier(0.7, 0, 0.2, 1),
  anticipate: anticipate(),
  'back-out': backOut(1.4),
  'elastic-out': elasticOut(1, 0.45),
  'bounce-out': bounceOut,
  smooth: RATE.smooth,
};

export function curve(name: string): EasingFn {
  return CURVES[name] ?? CURVES['ease-out-quint'];
}
