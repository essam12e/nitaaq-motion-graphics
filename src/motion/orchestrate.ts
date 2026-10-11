/**
 * Orchestration for Motion Engine 2.0: stagger, delay choreography, keyframe
 * tracks with per-segment easing, velocity-aware tracks, overlap/offset
 * sequencing (the "<" / "+=" placement of a timeline), and the motion
 * principles combined into one element track (anticipation → main move →
 * overshoot → settle, with follow-through for children).
 *
 * Pure functions of time. A scene asks "where is element i at t?" — nothing is
 * stored between frames, so seeking to any frame gives the same picture.
 */
import { curve, type EasingFn } from './easing';
import { springAt, type SpringOptions } from './spring';

// ── stagger ───────────────────────────────────────────────────────────────────────

export type StaggerFrom = 'first' | 'last' | 'center' | 'edges' | 'reading' | number;

export interface StaggerOptions {
  /** Seconds between neighbours (at the centre of the distribution). */
  each: number;
  from?: StaggerFrom;
  /** Distributes delays along an easing (front-loaded crowds, accelerating cascades). */
  ease?: EasingFn | string;
  /** Total delay cap in seconds (long lists compress instead of dragging). */
  maxTotal?: number;
  /** Reading direction: 'rtl' makes `reading` start at the right-most item. */
  dir?: 'rtl' | 'ltr';
  /** Grid stagger: [cols, rows] — distance is measured in 2D. */
  grid?: [number, number];
}

/** Delay (s) of item `i` of `n` under a stagger distribution. */
export function staggerDelay(i: number, n: number, o: StaggerOptions): number {
  if (n <= 1) return 0;
  let dist: number;
  let maxDist: number;
  if (o.grid) {
    const [cols, rows] = o.grid;
    const x = i % cols;
    const y = Math.floor(i / cols);
    const origin = o.from === 'center' ? [(cols - 1) / 2, (rows - 1) / 2] : o.from === 'last' ? [cols - 1, rows - 1] : o.dir === 'rtl' && (o.from === 'reading' || o.from === undefined) ? [cols - 1, 0] : [0, 0];
    dist = Math.hypot(x - origin[0], y - origin[1]);
    maxDist = Math.max(...[[0, 0], [cols - 1, 0], [0, rows - 1], [cols - 1, rows - 1]].map(([a, b]) => Math.hypot(a - origin[0], b - origin[1])));
  } else {
    const from = o.from ?? 'first';
    const c = (n - 1) / 2;
    if (from === 'first' || (from === 'reading' && o.dir !== 'rtl')) dist = i;
    else if (from === 'last' || from === 'reading') dist = n - 1 - i;
    else if (from === 'center') dist = Math.abs(i - c);
    else if (from === 'edges') dist = c - Math.abs(i - c);
    else dist = Math.abs(i - from);
    maxDist = from === 'center' || from === 'edges' ? c : typeof from === 'number' ? Math.max(from, n - 1 - from) : n - 1;
  }
  const e = typeof o.ease === 'string' ? curve(o.ease) : o.ease;
  const norm = maxDist > 0 ? dist / maxDist : 0;
  let delay = (e ? e(norm) : norm) * maxDist * o.each;
  if (o.maxTotal !== undefined && maxDist * o.each > o.maxTotal) delay *= o.maxTotal / (maxDist * o.each);
  return delay;
}

// ── keyframe tracks ────────────────────────────────────────────────────────────────

export interface Keyframe {
  /** Seconds. */
  t: number;
  v: number;
  /** Easing INTO this keyframe from the previous one. */
  ease?: EasingFn | string;
  /** Use a spring into this keyframe instead of a curve (velocity carried from the previous segment). */
  spring?: SpringOptions;
}

/** Value of a keyframe track at time t. Spring segments carry incoming velocity. */
export function trackAt(keys: Keyframe[], t: number): number {
  if (!keys.length) return 0;
  if (t <= keys[0].t) return keys[0].v;
  let v0 = 0;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (b.spring) {
      // a spring segment runs until the next key's time (or forever on the last segment)
      const next = keys[i + 1];
      const end = next ? next.t : Infinity;
      if (t < end || !next) {
        if (t < a.t) return a.v;
        return springAt(t - a.t, a.v, b.v, { ...b.spring, velocity: v0 }).value;
      }
      const s = springAt(end - a.t, a.v, b.v, { ...b.spring, velocity: v0 });
      v0 = s.velocity;
      continue;
    }
    if (t <= b.t) {
      const e = typeof b.ease === 'string' ? curve(b.ease) : (b.ease ?? curve('ease-out-quint'));
      const span = Math.max(1e-6, b.t - a.t);
      return a.v + (b.v - a.v) * e((t - a.t) / span);
    }
    // velocity at the end of a curve segment (finite difference) feeds a following spring
    const e = typeof b.ease === 'string' ? curve(b.ease) : (b.ease ?? curve('ease-out-quint'));
    const span = Math.max(1e-6, b.t - a.t);
    v0 = ((b.v - a.v) * (e(1) - e(1 - 1e-3))) / (1e-3 * span);
  }
  return keys[keys.length - 1].v;
}

/** Numerical velocity of any time function (value units / s). */
export function velocityOf(fn: (t: number) => number, t: number, h = 1 / 240): number {
  return (fn(t + h) - fn(t - h)) / (2 * h);
}

// ── sequencing ─────────────────────────────────────────────────────────────────────

export interface SeqItem {
  id: string;
  dur: number;
  /** Placement: 'after' (default), 'with' (same start as previous), or seconds offset relative to the previous end (negative = overlap). */
  at?: 'after' | 'with' | number;
}

/** Resolves start times of a choreography (overlapping action without hand-typed delays). */
export function sequence(items: SeqItem[], start = 0): Record<string, { start: number; end: number }> {
  const out: Record<string, { start: number; end: number }> = {};
  let prevStart = start;
  let prevEnd = start;
  for (const it of items) {
    const s = it.at === 'with' ? prevStart : typeof it.at === 'number' ? Math.max(start, prevEnd + it.at) : prevEnd;
    out[it.id] = { start: s, end: s + it.dur };
    prevStart = s;
    prevEnd = s + it.dur;
  }
  return out;
}

// ── principled element track ──────────────────────────────────────────────────────

export interface ElementMotion {
  /** Seconds the move starts. */
  delay: number;
  spring: SpringOptions;
  /** Counter-move amplitude (fraction of travel) and its duration (s). 0 = none. */
  anticipation?: number;
  anticipationSec?: number;
  /** Extra lag for a child (follow-through). */
  follow?: number;
}

/**
 * 0→1 progress of a principled move: anticipation dip, a spring with the velocity
 * the wind-up release gives it, overshoot/settle from the spring itself.
 */
export function elementProgress(t: number, m: ElementMotion): number {
  const start = m.delay + (m.follow ?? 0);
  const ant = m.anticipation ?? 0;
  const antSec = ant ? (m.anticipationSec ?? 0.12) : 0;
  const local = t - start;
  if (local <= 0) return 0;
  if (ant && local < antSec) {
    const x = local / antSec;
    return -ant * Math.sin(x * Math.PI * 0.5);
  }
  // release: the spring starts from the wind-up position with a forward kick
  const from = ant ? -ant : 0;
  const kick = ant ? (ant / antSec) * 1.4 : 0;
  return springAt(local - antSec, from, 1, { ...m.spring, velocity: (m.spring.velocity ?? 0) + kick }).value;
}
