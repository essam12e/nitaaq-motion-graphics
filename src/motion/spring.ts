/**
 * NITAAQ Motion Engine 2.0 — physical springs, inertia and momentum.
 *
 * Remotion's `spring()` covers the classic case (rest → target, zero initial
 * velocity). Motion design needs more than that:
 *
 *   - initial VELOCITY (a thrown element keeps moving, a retarget keeps its speed)
 *   - MASS / STIFFNESS / DAMPING, or the designer-friendly BOUNCE + VISUAL DURATION
 *     (same parameterisation as Motion/SwiftUI: bounce 0 = critically damped)
 *   - INERTIA (a decay from a velocity, optionally caught by boundary springs)
 *   - MOMENTUM chains: a move retargeted mid-flight continues with the velocity it had
 *
 * Everything here is a closed-form solution of the damped harmonic oscillator,
 * so a value at time t is a pure function of t (deterministic seek, no
 * integration drift, no accumulated state). Units: seconds and "value units".
 */

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface SpringOptions extends Partial<SpringParams> {
  /** Designer parameterisation (used when stiffness/damping are not given). */
  bounce?: number;
  /** Seconds until the motion visually arrives (time-defined springs). */
  visualDuration?: number;
  /** Initial velocity in value-units per second. */
  velocity?: number;
  /** Rest thresholds (value units). */
  restDelta?: number;
  restSpeed?: number;
}

export interface SpringState {
  value: number;
  velocity: number;
  done: boolean;
}

const DEFAULT: SpringParams = { stiffness: 100, damping: 10, mass: 1 };

/** bounce (−1..1) → damping ratio ζ. 0 = critical, →1 = undamped, <0 = overdamped. */
export function bounceToDampingRatio(bounce: number): number {
  return bounce < 0 ? 1 / Math.max(1 + bounce, 0.05) : Math.max(1 - bounce, 0.05);
}

/** Physical parameters from bounce + visual duration (mass 1). */
export function springFromBounce(bounce: number, visualDuration: number): SpringParams {
  const zeta = bounceToDampingRatio(bounce);
  // ω0 chosen so the first arrival happens at ≈ visualDuration (period × 1.2 heuristic)
  const w0 = (2 * Math.PI) / Math.max(0.05, visualDuration * 1.2);
  const stiffness = w0 * w0;
  return { stiffness, damping: 2 * zeta * Math.sqrt(stiffness), mass: 1 };
}

export function resolveSpring(o: SpringOptions = {}): SpringParams {
  if (o.stiffness === undefined && o.damping === undefined && (o.bounce !== undefined || o.visualDuration !== undefined)) {
    return springFromBounce(o.bounce ?? 0.2, o.visualDuration ?? 0.5);
  }
  return {
    stiffness: Math.max(1e-3, o.stiffness ?? DEFAULT.stiffness),
    damping: Math.max(0, o.damping ?? DEFAULT.damping),
    mass: Math.max(1e-3, o.mass ?? DEFAULT.mass),
  };
}

export function dampingRatio(p: SpringParams): number {
  return p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
}

/**
 * Closed-form spring from `from` to `to` with initial velocity `v0`, at time t (s).
 * Returns value and velocity. Handles under-, critically- and over-damped cases.
 */
export function springAt(t: number, from: number, to: number, opts: SpringOptions = {}): SpringState {
  const p = resolveSpring(opts);
  const v0 = opts.velocity ?? 0;
  const restDelta = opts.restDelta ?? Math.max(1e-4, Math.abs(to - from) * 0.001);
  const restSpeed = opts.restSpeed ?? Math.max(1e-3, Math.abs(to - from) * 0.01);
  if (t <= 0) return { value: from, velocity: v0, done: false };
  const x0 = from - to; // displacement from rest
  const w0 = Math.sqrt(p.stiffness / p.mass);
  const z = dampingRatio(p);
  let x: number;
  let v: number;
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w0 * t);
    const A = x0;
    const B = (v0 + z * w0 * x0) / wd;
    const c = Math.cos(wd * t);
    const s = Math.sin(wd * t);
    x = e * (A * c + B * s);
    v = e * ((B * wd - z * w0 * A) * c - (A * wd + z * w0 * B) * s);
  } else if (Math.abs(z - 1) < 1e-6) {
    const e = Math.exp(-w0 * t);
    const B = v0 + w0 * x0;
    x = e * (x0 + B * t);
    v = e * (B - w0 * (x0 + B * t));
  } else {
    const r = w0 * Math.sqrt(z * z - 1);
    const s1 = -z * w0 + r;
    const s2 = -z * w0 - r;
    const C2 = (v0 - s1 * x0) / (s2 - s1);
    const C1 = x0 - C2;
    x = C1 * Math.exp(s1 * t) + C2 * Math.exp(s2 * t);
    v = C1 * s1 * Math.exp(s1 * t) + C2 * s2 * Math.exp(s2 * t);
  }
  const done = Math.abs(x) < restDelta && Math.abs(v) < restSpeed;
  return { value: done ? to : to + x, velocity: done ? 0 : v, done };
}

/** Normalised 0→1 spring progress at frame (scene-local), starting `delay` s in. */
export function springProgress(frame: number, fps: number, opts: SpringOptions = {}, delay = 0): number {
  return springAt(frame / fps - delay, 0, 1, opts).value;
}

/** Seconds until the spring rests (sampled at 240 Hz, capped at 10 s). */
export function springSettleTime(opts: SpringOptions = {}, from = 0, to = 1): number {
  for (let i = 1; i <= 2400; i++) if (springAt(i / 240, from, to, opts).done) return i / 240;
  return 10;
}

/** Peak overshoot beyond the target as a fraction of the travel. */
export function springOvershoot(opts: SpringOptions = {}): number {
  let peak = 0;
  for (let i = 1; i <= 2400; i++) {
    const s = springAt(i / 240, 0, 1, opts);
    peak = Math.max(peak, s.value);
    if (s.done) break;
  }
  return Math.max(0, peak - 1);
}

// ── inertia ──────────────────────────────────────────────────────────────────────

export interface InertiaOptions {
  /** Initial velocity (value-units / s). */
  velocity: number;
  /** Multiplier on velocity → travel distance (Motion default 0.8). */
  power?: number;
  /** Decay time constant in seconds (Motion default 0.35). */
  timeConstant?: number;
  /** Optional snapping of the natural resting point (e.g. snap to a grid). */
  modifyTarget?: (target: number) => number;
  /** Boundaries: when crossed, a spring catches the value and settles on the boundary. */
  min?: number;
  max?: number;
  bounceStiffness?: number;
  bounceDamping?: number;
}

/**
 * Momentum decay from `from` with a velocity — the "throw" a designer feels when
 * an element glides to a stop. Boundary springs catch overshoots, deterministic.
 */
export function inertiaAt(t: number, from: number, o: InertiaOptions): SpringState {
  const power = o.power ?? 0.8;
  const tc = o.timeConstant ?? 0.35;
  const amplitude = power * o.velocity;
  const ideal = from + amplitude;
  const target = o.modifyTarget ? o.modifyTarget(ideal) : ideal;
  const amp = target - from;
  const decay = (tt: number) => ({ value: target - amp * Math.exp(-tt / tc), velocity: (amp / tc) * Math.exp(-tt / tc) });
  const out = (x: number) => (o.min !== undefined && x < o.min) || (o.max !== undefined && x > o.max);
  if (t <= 0) return { value: from, velocity: o.velocity, done: false };
  if (o.min === undefined && o.max === undefined) {
    const d = decay(t);
    return { ...d, done: Math.abs(target - d.value) < 0.5e-3 * Math.max(1, Math.abs(amp)) };
  }
  // find when the decay crosses a boundary (coarse scan + bisection)
  let tCross = -1;
  const step = 1 / 240;
  for (let s = step; s <= Math.min(t, 10); s += step) {
    if (out(decay(s).value)) {
      let lo = s - step;
      let hi = s;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (out(decay(mid).value)) hi = mid;
        else lo = mid;
      }
      tCross = hi;
      break;
    }
  }
  if (tCross < 0 || t < tCross) {
    const d = decay(t);
    return { ...d, done: false };
  }
  const at = decay(tCross);
  const bound = o.max !== undefined && at.value > o.max ? o.max : (o.min ?? at.value);
  return springAt(t - tCross, at.value, bound, { stiffness: o.bounceStiffness ?? 500, damping: o.bounceDamping ?? 25, mass: 1, velocity: at.velocity });
}

// ── momentum chains (velocity-aware retargeting) ────────────────────────────────

export interface SpringLeg {
  /** Seconds from the chain start when this leg takes over. */
  at: number;
  to: number;
  spring?: SpringOptions;
}

/**
 * A value that is retargeted over time (hero element moves to A, then B, then C)
 * where every new leg starts with the position AND velocity the previous leg had
 * at the hand-off — no velocity discontinuity, so motion never "restarts".
 */
export function momentumAt(t: number, from: number, legs: SpringLeg[]): SpringState {
  const sorted = [...legs].sort((a, b) => a.at - b.at);
  let start = 0;
  let origin = from;
  let v0 = 0;
  let target = from;
  let opts: SpringOptions = {};
  for (const leg of sorted) {
    if (leg.at > t) break;
    // position and velocity at the hand-off carry into the new leg
    const h = leg.at <= start ? { value: origin, velocity: v0 } : springAt(leg.at - start, origin, target, { ...opts, velocity: v0 });
    origin = h.value;
    v0 = h.velocity;
    start = leg.at;
    target = leg.to;
    opts = leg.spring ?? {};
  }
  return springAt(t - start, origin, target, { ...opts, velocity: v0 });
}
