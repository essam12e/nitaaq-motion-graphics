/**
 * The 12 measured eases of MotionMaxxing (runtime/motion.js, Apache-2.0, © Tejas Makwana — see
 * public/mm/NOTICE). The math is copied verbatim so a curve named here is the exact same function
 * inside an MM shot (iframe runtime) and anywhere else in NITAAQ (Stage choreography, camera moves):
 * every f(0)=0, f(1)=1. They are registered in motion/easing CURVES as `mm:<name>`.
 */
export type Ease = (t: number) => number;
const powerOut = (p: number): Ease => (t) => 1 - Math.pow(1 - t, p);
const powerIn = (p: number): Ease => (t) => Math.pow(t, p);
const expoOut = (k: number): Ease => {
  const d = 1 - Math.exp(-k);
  return (t) => (1 - Math.exp(-k * t)) / d;
};
const snapRamp = (w: number, tau: number): Ease => {
  const n = w * (1 - Math.exp(-1 / tau)) + (1 - w);
  return (t) => (w * (1 - Math.exp(-t / tau)) + (1 - w) * t) / n;
};
const snapOver = (A: number, ta: number, td: number): Ease => {
  const f = (t: number) => (1 + A * Math.exp(-t / td)) * (1 - Math.exp(-t / ta));
  const n = f(1);
  return (t) => f(t) / n;
};
const spring = (c: number, om: number): Ease => {
  const f = (t: number) => 1 - Math.exp(-c * t) * (Math.cos(om * t) + (c / om) * Math.sin(om * t));
  const n = f(1);
  return (t) => f(t) / n;
};
const smoothP = (p: number): Ease => (t) => {
  const a = Math.pow(t, p);
  const b = Math.pow(1 - t, p);
  return a / (a + b);
};
const guard = (f: Ease): Ease => (t) => (t <= 0 ? 0 : t >= 1 ? 1 : f(t));

export const MM_EASES = {
  /** hits and slightly passes its mark at once (peak 1.18 at t≈.27) */
  crashIn: guard(snapOver(2.0, 0.19, 0.218)),
  /** slow late overshoot, 1.08 at t≈.72 */
  popOver: guard(spring(2.67, 4.36)),
  /** big overshoot 1.48, use sparingly */
  bounceHard: guard(spring(1.34, 5.07)),
  /** default hero entry: 54% of travel in the first 10% of the time */
  snapSettle: guard(snapRamp(0.942, 0.118)),
  /** firm decelerate, the workhorse for text and panels */
  softLand: guard(expoOut(3.41)),
  /** hard decelerating big move */
  whip: guard(powerOut(2.52)),
  /** gentle ease-out for medium moves */
  glide: guard(powerOut(1.7)),
  /** linear: fades, drifts, counters */
  cruise: guard((t) => t),
  /** symmetric S for opacity / blur */
  softInOut: guard(smoothP(1.42)),
  /** mild acceleration */
  gentleIn: guard(powerIn(2.07)),
  /** the leaving curve */
  accelExit: guard(powerIn(2.6)),
  /** hard acceleration into a cut */
  crashOut: guard(powerIn(3.97)),
} satisfies Record<string, Ease>;

export type MMEaseName = keyof typeof MM_EASES;
export const MM_EASE_NAMES = Object.keys(MM_EASES) as MMEaseName[];

/** Typical durations in frames @30 fps measured with each curve (motion.js EASE_FRAMES). */
export const MM_EASE_FRAMES: Record<MMEaseName, number> = { crashIn: 10, popOver: 15, bounceHard: 22, snapSettle: 11, softLand: 12, whip: 7, glide: 10, cruise: 9, softInOut: 9, gentleIn: 9, accelExit: 13, crashOut: 17 };
